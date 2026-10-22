// Real Morphic HTTP process with local dependency fixtures for fault injection.
// No Docker daemon, Ollama model, Internet search or classifier is exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";

test(
  "Morphic HTTP authentication, dependency health, timeout, recovery and process restart",
  { timeout: 25_000 },
  async () => {
    // Refuse to interfere with an existing service on the adapter's fixed port.
    const probe = createServer();
    await new Promise((accept, reject) =>
      probe.once("error", reject).listen(7822, "127.0.0.1", accept),
    );
    await new Promise((accept) => probe.close(accept));
    let mode = "invalid",
      child,
      logs = "";
    const token = randomBytes(32).toString("hex");
    const dependencies = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (mode === "timeout") return;
      if (mode === "failed" || req.url === "/api/show")
        return res.writeHead(503).end("{}");
      res.end(
        req.url === "/api/tags" && mode === "valid" ? '{"models":[]}' : "{}",
      );
    });
    await new Promise((accept) => dependencies.listen(0, "127.0.0.1", accept));
    const dependencyURL = `http://127.0.0.1:${dependencies.address().port}`;
    const request = (path, body, authenticated = true) =>
      fetch(`http://127.0.0.1:7822${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
    async function start() {
      child = spawn(
        process.execPath,
        ["--import", "tsx", resolve("services/morphic/server.mjs")],
        {
          env: {
            ...process.env,
            SIAAS_RESEARCH_TOKEN: token,
            SIAAS_RESEARCH_BIND: "127.0.0.1",
            OLLAMA_BASE_URL: dependencyURL,
            SEARXNG_BASE_URL: dependencyURL,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (d) => {
        logs += d;
      });
      child.stderr.on("data", (d) => {
        logs += d;
      });
      for (let n = 0; n < 80; n++) {
        assert.equal(child.exitCode, null, logs);
        try {
          if ((await request("/health", undefined, false)).status === 401)
            return;
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail(`Morphic did not listen: ${logs}`);
    }
    async function shutdown() {
      const exit = once(child, "exit");
      assert.equal((await request("/shutdown", {})).status, 200);
      await exit;
      assert.equal(child.exitCode, 0, logs);
    }
    try {
      await start();
      assert.equal(
        (await request("/health")).status,
        503,
        "Malformed Ollama JSON must not report ready",
      );
      mode = "valid";
      assert.deepEqual(await (await request("/health")).json(), { ok: true });
      mode = "failed";
      assert.equal((await request("/health")).status, 503);
      mode = "timeout";
      const began = Date.now();
      assert.equal((await request("/health")).status, 503);
      assert(
        Date.now() - began < 4500,
        "Dependency timeout must remain bounded",
      );
      mode = "valid";
      assert.equal((await request("/health")).status, 200);
      assert.equal((await request("/research", {})).status, 400);
      assert.equal((await request("/research", "x".repeat(8001))).status, 413);
      const failure = await (
        await request("/research", {
          version: 1,
          query: "public astronomy facts",
          model: "test:8b",
          maxPages: 1,
          maxSearches: 1,
          timeoutSeconds: 1,
        })
      ).json();
      assert.equal(failure.status, "error");
      assert.deepEqual(failure.evidence, []);
      assert.equal((await request("/shutdown", {}, false)).status, 401);
      await shutdown();
      await start();
      assert.equal((await request("/health")).status, 200);
      await shutdown();
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      dependencies.closeAllConnections();
      await new Promise((accept) => dependencies.close(accept));
    }
  },
);
