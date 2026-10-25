import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPOSITORY,
  compareVersions,
  releaseVersion,
  NODE_VERSION,
  runtimeAsset,
  resolveManifest,
  validateManifest,
} from "../scripts/lib/distribution.mjs";
import { runtimeEnv, verifyRuntime } from "../scripts/lib/managed-runtime.mjs";
const version = "1.2.0",
  prefix = `SIAAS-Personal-${version}-`,
  base = `https://github.com/${REPOSITORY}/releases/download/v${version}/`;
const spec = JSON.stringify({
  schemaVersion: 1,
  version,
  nodeVersion: NODE_VERSION,
});
const hash = (s) => createHash("sha256").update(s).digest("hex");
const assets = [
  {
    name: prefix + "source.zip",
    size: 100,
    digest: "sha256:" + "a".repeat(64),
    browser_download_url: base + prefix + "source.zip",
  },
  {
    name: prefix + "install.json",
    size: Buffer.byteLength(spec),
    digest: "sha256:" + hash(spec),
    browser_download_url: base + prefix + "install.json",
  },
];
const release = {
  tag_name: "v" + version,
  draft: false,
  prerelease: false,
  assets,
};
const request = async (url, options) => {
  assert(!options.headers.Authorization);
  if (url.endsWith("/releases/latest"))
    return new Response(JSON.stringify(release));
  if (url.endsWith("install.json")) return new Response(spec);
  if (url.endsWith("SHASUMS256.txt"))
    return new Response(
      ["win32", "darwin", "linux"]
        .flatMap((p) =>
          ["x64", "arm64"].map(
            (a) =>
              "b".repeat(64) + "  " + runtimeAsset(NODE_VERSION, p, a).name,
          ),
        )
        .join("\n"),
    );
  throw Error("Unexpected URL: " + url);
};
test("all six platforms resolve validated public assets without authentication", async () => {
  for (const platform of ["win32", "darwin", "linux"])
    for (const arch of ["x64", "arm64"]) {
      const m = await resolveManifest(platform, arch, request);
      assert.equal(validateManifest(m, platform, arch), m);
      assert.equal(m.runtime.version, NODE_VERSION);
    }
});
test("missing public release and unsupported platform have actionable errors", async () => {
  await assert.rejects(
    resolveManifest(
      "win32",
      "x64",
      async () => new Response("", { status: 404 }),
    ),
    (e) => e.status === 404 && /public stable/.test(e.message),
  );
  await assert.rejects(
    resolveManifest("linux", "ia32", request),
    (e) => e.status === 400,
  );
});
test("manifest rejects tampered URLs, hashes, sizes and runtime target", async () => {
  const m = await resolveManifest("linux", "x64", request);
  for (const changed of [
    { ...m, downloadUrl: "https://evil.test/a" },
    { ...m, sha256: "bad" },
    { ...m, size: 0 },
    { ...m, arch: "arm64" },
    { ...m, runtime: { ...m.runtime, url: "http://nodejs.org/x" } },
  ])
    assert.throws(() => validateManifest(changed, "linux", "x64"));
  await assert.rejects(
    resolveManifest("linux", "x64", async (u, o) =>
      u.endsWith("install.json") ? new Response(spec + " ") : request(u, o),
    ),
    /integrity/,
  );
});
test("child environment uses explicit runtime without changing global Node or NVM", () => {
  const source = {
    Path: "/global/bin",
    NODE_OPTIONS: "--require unsafe",
    NODE_PATH: "/global/modules",
    NVM_DIR: "/nvm",
    OTHER: "preserve",
  };
  const env = runtimeEnv("/managed/bin/node", source);
  assert.equal(env.SIAAS_SOURCE_NODE, "/managed/bin/node");
  assert(env.PATH.startsWith("/managed/bin"));
  assert.equal(env.NVM_DIR, "/nvm");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(source.NODE_OPTIONS, "--require unsafe");
});
test("corrupt or missing runtime fails before executing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "siaas-runtime-"));
  try {
    const node = join(root, "node");
    await writeFile(node, "not executable");
    await assert.rejects(
      verifyRuntime(
        {
          node,
          npm: node,
          version: NODE_VERSION,
          binarySha256: "0".repeat(64),
        },
        NODE_VERSION,
      ),
      /corrupted/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit RC versions validate while stable discovery rejects prereleases',async()=>{
 assert(releaseVersion('1.1.0-rc.1'));assert(!releaseVersion('1.1.0-rc.01'));assert(!releaseVersion('../1.1.0'));
 assert.equal(compareVersions('1.1.0-rc.2','1.1.0-rc.1'),1);
 assert.equal(compareVersions('1.1.0','1.1.0-rc.2'),1);
 assert.equal(compareVersions('1.0.0','1.1.0-rc.1'),-1);
 const m=await resolveManifest('linux','x64',request);m.version='1.1.0-rc.1';m.name='SIAAS-Personal-'+m.version+'-source.zip';m.downloadUrl='https://github.com/'+REPOSITORY+'/releases/download/v'+m.version+'/'+m.name;assert.equal(validateManifest(m,'linux','x64'),m);
 await assert.rejects(resolveManifest('linux','x64',async(url,opts)=>url.endsWith('/releases/latest')?new Response(JSON.stringify({...release,tag_name:'v1.1.0-rc.1',prerelease:true})):request(url,opts)),/No valid stable/);
});
