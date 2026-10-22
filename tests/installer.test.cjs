const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const {
  versionCompatible,
  localURL,
  probe,
  OllamaManager,
} = require("../desktop/ollama-manager.cjs");
const {
  safeEntry,
  assetFor,
  downloadVerified,
} = require("../desktop/install-ollama.cjs");
test("Ollama compatibility and loopback policy", () => {
  for (const v of ["0.11.10", "0.35.1", "1.0.0"]) assert(versionCompatible(v));
  for (const v of ["0.11.9", "0.9.0", "", "latest", "garbage"])
    assert(!versionCompatible(v));
  assert.equal(localURL("http://localhost:11434"), "http://localhost:11434");
  for (const url of [
    "http://example.com",
    "https://127.0.0.1",
    "http://user:pass@localhost",
    "http://localhost/other",
  ])
    assert.throws(() => localURL(url));
});
test("package support and archive path validation", () => {
  assert.equal(assetFor("win32", "x64").binary, "ollama.exe");
  assert.throws(() => assetFor("linux", "riscv64"));
  for (const path of [
    "../bad",
    "x/../../bad",
    "C:\\evil",
    "/etc/passwd",
    "x\\..\\bad",
  ])
    assert(!safeEntry(path), path);
  assert(safeEntry("lib/ollama/cuda/lib.so"));
});
test("download rejects corruption and unexpected origins before execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "siaas-download-test-"));
  const originalFetch = global.fetch;
  const data = Buffer.from("test package");
  const asset = {
    url: "https://github.com/ollama/ollama/releases/download/v0.35.1/test.zip",
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
  try {
    global.fetch = async () => new Response(data);
    await downloadVerified(asset, join(dir, "good"));
    assert.deepEqual(await readFile(join(dir, "good")), data);
    await assert.rejects(
      downloadVerified({ ...asset, sha256: "0".repeat(64) }, join(dir, "bad")),
      /verifica/,
    );
    await assert.rejects(
      downloadVerified({ ...asset, bytes: 1 }, join(dir, "large")),
      /Dimensione/,
    );
    await assert.rejects(
      downloadVerified(
        { ...asset, url: "https://attacker.example/a" },
        join(dir, "host"),
      ),
      /Origine/,
    );
  } finally {
    global.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
test("existing compatible service is reused and never stopped; old service is preserved", async () => {
  let version = "0.35.1";
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(join(tmpdir(), "siaas-manager-test-"));
  const manager = new OllamaManager({
    directory: dir,
    node: process.execPath,
    helper: "must-not-run",
  });
  manager.base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await manager.install()).ready, true);
    assert.equal(manager.child, null);
    manager.close();
    assert((await probe(manager.base)).compatible);
    version = "0.10.0";
    await assert.rejects(manager.install(), /già attivo/);
    assert.equal((await probe(manager.base)).version, "0.10.0");
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
