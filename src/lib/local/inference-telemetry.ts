import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./database";
import { isDesktop } from "../runtime";
import {
  modelKey,
  type InferenceContext,
  type InferenceRecord,
} from "../overview";

// Kept separate from conversations: bounded metadata only, never prompts or output.
export class InferenceStore {
  readonly sql: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.sql = new DatabaseSync(join(directory, "telemetry.sqlite"));
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS inference (id TEXT PRIMARY KEY, started TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS inference_started ON inference(started);`);
    // A server restart cannot leave yesterday's requests marked as running.
    this.sql
      .exec(`UPDATE inference SET body=json_set(body, '$.status', 'interrupted')
      WHERE json_extract(body, '$.status') IN ('loading','generating')`);
    this.prune();
  }
  put(record: InferenceRecord) {
    this.sql
      .prepare("INSERT OR REPLACE INTO inference VALUES (?, ?, ?)")
      .run(record.id, record.startedAt, JSON.stringify(record));
  }
  records(): InferenceRecord[] {
    this.prune();
    return this.sql
      .prepare("SELECT body FROM inference ORDER BY started DESC, rowid DESC")
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  prune() {
    this.sql
      .prepare(
        `DELETE FROM inference WHERE json_extract(body, '$.status') NOT IN ('loading','generating')
      AND (started < ? OR id NOT IN (SELECT id FROM inference ORDER BY started DESC, rowid DESC LIMIT 1000))`,
      )
      .run(new Date(Date.now() - 30 * 86400_000).toISOString());
  }
  close() {
    this.sql.close();
  }
}
const globalStore = globalThis as typeof globalThis & {
  siaasInferenceStore?: InferenceStore;
};
export function inferenceStore() {
  return (globalStore.siaasInferenceStore ??= new InferenceStore(
    dataDirectory(),
  ));
}
function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

// Instrument at the transport boundary, so each agent turn and embedding batch is
// measured once. The stream is forwarded with backpressure, without a clone/tee.
export function monitoredFetch(
  context: InferenceContext = {},
  request: typeof fetch = fetch,
  store?: InferenceStore,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      !isDesktop() ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["/api/chat", "/api/embed"].includes(url.pathname)
    )
      return request(input, init);
    let payload;
    try {
      payload = JSON.parse(String(init?.body));
    } catch {
      return request(input, init);
    }
    if (typeof payload.model !== "string") return request(input, init);
    let db: InferenceStore;
    try {
      db = store ?? inferenceStore();
    } catch {
      return request(input, init);
    }
    const start = performance.now();
    const record: InferenceRecord = {
      ...context,
      id: randomUUID(),
      model: modelKey(payload.model),
      kind: url.pathname === "/api/embed" ? "embedding" : "chat",
      status: "loading",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      tokensPerSecond: null,
      loadMs: null,
      error: null,
    };
    const save = () => {
      try {
        db.put(record);
      } catch {
        /* Monitoring must not break inference. */
      }
    };
    save();
    let finished = false;
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    const finish = (
      status: InferenceRecord["status"],
      error: string | null = null,
    ) => {
      if (finished) return;
      finished = true;
      record.status = status;
      record.error = error;
      record.finishedAt = new Date().toISOString();
      record.durationMs = performance.now() - start;
      signal?.removeEventListener("abort", abort);
      save();
      try {
        db.prune();
      } catch {
        /* Optional telemetry. */
      }
    };
    const abort = () =>
      finish(
        signal?.reason?.name === "TimeoutError" ? "error" : "cancelled",
        "Richiesta interrotta o scaduta.",
      );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const observe = (line: string) => {
      if (!line.trim() || finished) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.error) {
        finish("error", "Ollama ha segnalato un errore durante la richiesta.");
        return;
      }
      if (record.status === "loading" && event.message) {
        record.status = "generating";
        save();
      }
      if (
        event.done === true ||
        (record.kind === "embedding" && Array.isArray(event.embeddings))
      ) {
        record.inputTokens = metric(event.prompt_eval_count);
        record.outputTokens = metric(event.eval_count);
        const duration = metric(event.eval_duration);
        record.tokensPerSecond =
          duration && record.outputTokens !== null
            ? (record.outputTokens / duration) * 1e9
            : null;
        const load = metric(event.load_duration);
        record.loadMs = load === null ? null : load / 1e6;
        finish("complete");
      }
    };
    try {
      const response = await request(input, init);
      if (!response.ok || !response.body) {
        finish("error", `Ollama: HTTP ${response.status}.`);
        return response;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read();
            pending += decoder.decode(part.value, { stream: !part.done });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) observe(line);
            // Embedding batches are bounded by the caller. Never retain an unbounded stream.
            if (pending.length > 2_000_000) {
              pending = "";
              finish(
                "error",
                "Statistiche non rilevabili: risposta troppo grande.",
              );
            }
            if (part.done) {
              observe(pending);
              if (!finished)
                finish(
                  "error",
                  "Risposta terminata senza conferma di completamento.",
                );
              reader.releaseLock();
              controller.close();
            } else controller.enqueue(part.value);
          } catch (error) {
            finish("error", "Connessione con Ollama interrotta.");
            reader.releaseLock();
            controller.error(error);
          }
        },
        async cancel(reason) {
          finish("cancelled", "Lettura della risposta interrotta.");
          try {
            await reader.cancel(reason);
          } finally {
            reader.releaseLock();
          }
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      finish("error", "Ollama non raggiungibile o richiesta scaduta.");
      throw error;
    }
  };
}
