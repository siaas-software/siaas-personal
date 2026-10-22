import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { research, requestSchema, boundedJSON } from "./adapter.mjs";

const ollamaHealthSchema = z.object({
  models: z.array(z.object({ name: z.string() })).max(10_000),
});
const token = process.env.SIAAS_RESEARCH_TOKEN || "";
if (token.length < 32)
  throw Error("SIAAS_RESEARCH_TOKEN must contain at least 32 characters");
let busy = false;
const server = createServer(async (req, res) => {
  const send = (status, body) => {
    if (!res.destroyed) {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    }
  };
  const actual = Buffer.from(req.headers.authorization || ""),
    expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    send(401, { error: "Unauthorized" });
    return;
  }
  if (req.method === "POST" && req.url === "/shutdown") {
    send(200, { ok: true });
    server.close();
    server.closeIdleConnections();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    try {
      const signal = AbortSignal.timeout(2500);
      await Promise.all([
        fetch(
          new URL(
            "/api/tags",
            process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434",
          ),
          { signal, redirect: "error" },
        ).then(async (r) => ollamaHealthSchema.parse(await boundedJSON(r))),
        fetch(
          new URL(
            "/healthz",
            process.env.SEARXNG_BASE_URL || "http://searxng:8080",
          ),
          { signal, redirect: "error" },
        ).then((r) => {
          if (!r.ok) throw Error();
          return r.body?.cancel();
        }),
      ]);
      send(200, { ok: true });
    } catch {
      send(503, { ok: false });
    }
    return;
  }
  if (req.method !== "POST" || req.url !== "/research") {
    send(404, { error: "Not found" });
    return;
  }
  if (busy) {
    send(503, { error: "Research already running" });
    return;
  }
  busy = true;
  const controller = new AbortController();
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", disconnect);
  try {
    const parts = [];
    let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 8000) {
        send(413, { error: "Request too large" });
        return;
      }
      parts.push(part);
    }
    let parsed;
    try {
      parsed = requestSchema.parse(
        JSON.parse(Buffer.concat(parts).toString("utf8")),
      );
    } catch {
      send(400, { error: "Invalid research request" });
      return;
    }
    send(200, await research(parsed, controller.signal));
  } catch {
    send(500, { error: "Research unavailable" });
  } finally {
    busy = false;
    res.removeListener("close", disconnect);
  }
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(7822, process.env.SIAAS_RESEARCH_BIND || "127.0.0.1");
