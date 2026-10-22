import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InferenceStore,
  monitoredFetch,
} from "../src/lib/local/inference-telemetry";
import { modelState } from "../src/lib/overview";
import { OverviewReader } from "../src/lib/local/overview";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
process.env.SIAAS_RUNTIME = "desktop";
delete process.env.VERCEL;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "siaas-overview-"));
  const store = new InferenceStore(dir);
  return {
    dir,
    store,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const init = {
  method: "POST",
  body: JSON.stringify({
    model: "qwen:test",
    messages: [{ content: "private prompt" }],
  }),
};
const endpoint = "http://127.0.0.1:11434/api/chat";
function response(events: object[]) {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n"));
}

test("telemetry forwards streaming bytes and measures real metrics without storing text", async () => {
  const f = fixture();
  try {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = monitoredFetch(
      { assistantId: "assistant", projectId: "project" },
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              upstream = c;
            },
          }),
        ),
      f.store,
    );
    const result = await fetcher(endpoint, init);
    assert.equal(f.store.records()[0].status, "loading");
    const reader = result.body!.getReader(),
      encoder = new TextEncoder();
    const delta =
      JSON.stringify({ message: { content: "private response" } }) + "\n";
    upstream.enqueue(encoder.encode(delta));
    assert.equal(new TextDecoder().decode((await reader.read()).value), delta);
    assert.equal(f.store.records()[0].status, "generating");
    const end = JSON.stringify({
      done: true,
      prompt_eval_count: 23,
      eval_count: 12,
      eval_duration: 2e9,
      load_duration: 5e8,
    });
    upstream.enqueue(encoder.encode(end.slice(0, 20)));
    upstream.enqueue(encoder.encode(end.slice(20)));
    upstream.close();
    while (!(await reader.read()).done) {
      /* consume */
    }
    const record = f.store.records()[0];
    assert.equal(record.status, "complete");
    assert.equal(record.tokensPerSecond, 6);
    assert.equal(record.loadMs, 500);
    assert.equal(record.inputTokens, 23);
    assert.equal(record.projectId, "project");
    assert.ok(record.durationMs! >= 0);
    assert.doesNotMatch(JSON.stringify(record), /private/);
  } finally {
    f.close();
  }
});
test("missing metrics stay null, including embedding output and throughput", async () => {
  const f = fixture();
  try {
    const fetcher = monitoredFetch(
      {},
      async () => response([{ embeddings: [[1, 2]] }]),
      f.store,
    );
    await (await fetcher("http://127.0.0.1:11434/api/embed", init)).text();
    const record = f.store.records()[0];
    assert.equal(record.kind, "embedding");
    assert.equal(record.status, "complete");
    assert.equal(record.inputTokens, null);
    assert.equal(record.outputTokens, null);
    assert.equal(record.tokensPerSecond, null);
  } finally {
    f.close();
  }
});
test("truncated streams, Ollama errors, HTTP errors and network failures leave no active request", async () => {
  const f = fixture();
  try {
    for (const request of [
      async () => response([{ message: { content: "partial" } }]),
      async () => response([{ error: "private details" }]),
      async () => new Response("failed", { status: 500 }),
      async () => {
        throw new Error("connection");
      },
    ]) {
      try {
        await (
          await monitoredFetch({}, request, f.store)(endpoint, init)
        ).text();
      } catch {
        /* expected */
      }
    }
    assert.equal(f.store.records().length, 4);
    assert.ok(f.store.records().every((r) => r.status === "error"));
    assert.doesNotMatch(JSON.stringify(f.store.records()), /private details/);
  } finally {
    f.close();
  }
});
test("concurrent requests and cancellation are independent", async () => {
  const f = fixture();
  try {
    const fetcher = monitoredFetch(
      {},
      async () => new Response(new ReadableStream()),
      f.store,
    );
    const [first, second] = await Promise.all([
      fetcher(endpoint, init),
      fetcher(endpoint, init),
    ]);
    assert.equal(
      f.store.records().filter((r) => r.status === "loading").length,
      2,
    );
    await first.body!.cancel();
    assert.equal(
      f.store.records().filter((r) => r.status === "loading").length,
      1,
    );
    await second.body!.cancel();
    assert.ok(f.store.records().every((r) => r.status === "cancelled"));
  } finally {
    f.close();
  }
});
test("restarts mark unfinished requests interrupted, retention is bounded", async () => {
  const f = fixture();
  const result = await monitoredFetch(
    {},
    async () => new Response(new ReadableStream()),
    f.store,
  )(endpoint, init);
  const original = f.store.records()[0];
  await result.body!.cancel();
  f.store.put({
    ...original,
    id: "old",
    status: "complete",
    startedAt: new Date(Date.now() - 31 * 86400_000).toISOString(),
  });
  f.store.put(original);
  f.store.close();
  const reopened = new InferenceStore(f.dir);
  assert.equal(reopened.records().length, 1);
  assert.equal(reopened.records()[0].status, "interrupted");
  reopened.close();
  rmSync(f.dir, { recursive: true, force: true });
});
test("Overview includes every local model and links across projects, handles partial failure and recovery", async () => {
  const f = fixture(),
    db = new LocalDatabase(f.dir);
  try {
    const p1 = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "First" });
    const p2 = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "Second" });
    for (const p of [p1, p2])
      db.put("assistants", {
        tenant_id: LOCAL_USER_ID,
        project_id: p.id,
        name: "Assistant",
        model_id: "ollama/custom",
      });
    const reader = new OverviewReader();
    let offline = false,
      psFail = false;
    const request: typeof fetch = async (url) => {
      if (offline || (psFail && String(url).endsWith("/ps")))
        throw new Error("offline");
      return Response.json({
        models: String(url).endsWith("/ps")
          ? [{ name: "custom:latest", size: 1024, size_vram: 256 }]
          : [
              { name: "custom:latest", size: 2048 },
              { name: "embeddinggemma:latest" },
              { name: "unassigned:3b" },
              { name: "cloud-alias", remote_host: "https://example.com" },
            ],
      });
    };
    const resources = async () => ({
      sampledAt: new Date().toISOString(),
      cpuPercent: 30,
      cpuName: "fixture",
      ramUsed: 100,
      ramTotal: 200,
      gpus: [],
      disks: [],
      cpuTemperature: null,
    });
    const read = () =>
      reader.read(db, request, resources, () => f.store.records());
    const snapshot = await read();
    assert.equal(snapshot.models.length, 3);
    assert.equal(snapshot.models[0].assistants.length, 2);
    assert.equal(snapshot.models[0].projects.length, 2);
    assert.equal(snapshot.models[0].state, "loaded");
    assert.equal(snapshot.models[0].vram, 256);
    assert.equal(snapshot.models[1].state, "installed");
    assert.equal(snapshot.models[1].size, null);
    psFail = true;
    const partial = await read();
    assert.equal(partial.connected, true);
    assert.equal(partial.loadedCount, null);
    assert.equal(partial.models[0].state, "unknown");
    assert.equal(partial.models[0].memory, null);
    offline = true;
    const stale = await read();
    assert.equal(stale.connected, false);
    assert.equal(stale.models.length, 3);
    assert.equal(stale.modelsUpdatedAt, partial.modelsUpdatedAt);
    assert.equal(stale.loadedCount, null);
    offline = false;
    psFail = false;
    assert.equal((await read()).models[0].state, "loaded");
    assert.equal(modelState(false, [], []), "installed");
  } finally {
    db.close();
    f.close();
  }
});
