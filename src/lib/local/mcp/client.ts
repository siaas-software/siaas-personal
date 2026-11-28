import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { endpointFetch, remoteEndpoint } from "./http";
import { normalizedTool, validateToolArguments, type McpTool } from "./tools";

export const serverConfig = z.discriminatedUnion("transport", [
  z
    .object({
      transport: z.literal("stdio"),
      executable: z.string().max(2048),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
  z
    .object({
      transport: z.literal("http"),
      endpoint: z.string().max(2048),
      allowLoopback: z.boolean().default(false),
    })
    .strict(),
]);
export type McpConfig = z.infer<typeof serverConfig>;
const page = z.object({
  tools: z.array(z.unknown()).max(64),
  nextCursor: z.string().max(1024).optional(),
});
const result = z.object({
  isError: z.boolean().optional(),
  content: z
    .array(z.object({ type: z.literal("text"), text: z.string().max(16000) }))
    .max(8),
});

async function stageExecutable(
  config: Extract<McpConfig, { transport: "stdio" }>,
  dir: string,
  signal: AbortSignal,
) {
  if (
    !isAbsolute(config.executable) ||
    (await realpath(config.executable)) !== config.executable
  )
    throw new Error(
      "Select the canonical path of the approved native executable.",
    );
  const info = await lstat(config.executable);
  if (!info.isFile() || info.size > 128 * 1024 * 1024)
    throw new Error("Invalid MCP executable.");
  const path = join(
    dir,
    process.platform === "win32" ? "server.exe" : "server",
  );
  const hash = createHash("sha256");
  let size = 0;
  let magic = Buffer.alloc(0);
  await pipeline(
    createReadStream(config.executable),
    new Transform({
      transform(chunk, _enc, next) {
        size += chunk.length;
        if (size > 128 * 1024 * 1024)
          return next(new Error("MCP executable too large."));
        if (magic.length < 4)
          magic = Buffer.concat([magic, chunk.subarray(0, 4 - magic.length)]);
        hash.update(chunk);
        next(null, chunk);
      },
    }),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
    { signal },
  );
  const marker = magic.toString("hex");
  if (
    !(
      marker === "7f454c46" ||
      marker.startsWith("4d5a") ||
      ["cffaedfe", "feedfacf", "cafebabe", "cafebabf"].includes(marker)
    ) ||
    hash.digest("hex") !== config.sha256
  )
    throw new Error("MCP executable verification failed.");
  await chmod(path, 0o700);
  return path;
}

export async function connectMcp(
  config: McpConfig,
  signal: AbortSignal,
  bearer?: string,
) {
  signal.throwIfAborted();
  let directory: string | undefined;
  const client = new Client(
    { name: "siaas-personal", version: "1" },
    { capabilities: {} },
  );
  let remote: StreamableHTTPClientTransport | undefined;
  async function close() {
    try {
      if (remote?.sessionId) await remote.terminateSession().catch(() => {});
    } finally {
      try {
        await client.close();
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }
  try {
    let transport;
    if (config.transport === "stdio") {
      directory = await mkdtemp(join(tmpdir(), "siaas-mcp-"));
      const command = await stageExecutable(config, directory, signal);
      const env: Record<string, string> = Object.fromEntries(
        DEFAULT_INHERITED_ENV_VARS.map((k) => [k, ""]),
      );
      if (process.platform === "win32" && process.env.SystemRoot)
        env.SYSTEMROOT = process.env.SystemRoot;
      env.TMPDIR = env.TEMP = env.TMP = directory;
      transport = new StdioClientTransport({
        command,
        args: [],
        cwd: directory,
        env,
        stderr: "ignore",
        maxBufferSize: 131072,
      });
    } else {
      const url = remoteEndpoint(config.endpoint, config.allowLoopback);
      remote = new StreamableHTTPClientTransport(url, {
        fetch: endpointFetch(url, bearer),
        requestInit: { redirect: "error" },
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 0,
          maxReconnectionDelay: 0,
          reconnectionDelayGrowFactor: 1,
        },
      });
      transport = remote;
    }
    const lost = new AbortController();
    client.onclose = () => lost.abort();
    client.onerror = () => lost.abort();
    client.setNotificationHandler(ToolListChangedNotificationSchema, () =>
      lost.abort(),
    );
    await client.connect(transport, { signal, timeout: 10000 });
    if (!client.getServerCapabilities()?.tools)
      throw new Error("MCP server has no tools.");
    const registry = new Map<string, McpTool>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const list = await client.request(
        { method: "tools/list", params: cursor ? { cursor } : {} },
        page,
        { signal, timeout: 8000 },
      );
      for (const raw of list.tools) {
        const tool = normalizedTool(raw);
        if (registry.has(tool.name.toLowerCase()) || registry.size >= 64)
          throw new Error("Invalid MCP tool catalog.");
        registry.set(tool.name.toLowerCase(), tool);
      }
      cursor = list.nextCursor;
      if (cursor && (seen.has(cursor) || seen.size >= 8))
        throw new Error("Invalid MCP pagination.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return {
      tools: [...registry.values()],
      lost: lost.signal,
      close,
      async call(name: string, args: unknown, signal: AbortSignal) {
        lost.signal.throwIfAborted();
        const tool = registry.get(name.toLowerCase());
        if (!tool || tool.name !== name)
          throw new Error("MCP tool unavailable.");
        const reply = await client.request(
          {
            method: "tools/call",
            params: { name, arguments: validateToolArguments(tool, args) },
          },
          result,
          { signal, timeout: 15000 },
        );
        if (reply.isError) throw new Error("MCP tool reported failure.");
        const text = reply.content.map((c) => c.text).join("\n");
        if (Buffer.byteLength(text) > 24000)
          throw new Error("MCP output too large.");
        return text;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
