import { randomUUID, createHash } from "node:crypto";
import { ActionError } from "../../actions";
import { LOCAL_USER_ID } from "../../runtime";
import type { LocalDatabase } from "../database";
import { runNativeOperation, type ToolTrace } from "../native-permissions";
import { connectMcp, serverConfig, type McpConfig } from "./client";
import { toolDigest, validateToolArguments } from "./tools";
import { remoteEndpoint } from "./http";

type Row = { id: string; project_id: string; name: string; config: string };
type Live = {
  cancel: AbortController;
  session?: Awaited<ReturnType<typeof connectMcp>>;
  done?: Promise<void>;
};
const runtime = process as NodeJS.Process & {
  siaasMcpConnections?: Map<string, Live>;
};
const connections = (runtime.siaasMcpConnections ??= new Map<string, Live>());
const key = (db: LocalDatabase, id: string) => db.directory + "\0" + id;
const token = (id: string, name: string) =>
  "mcp." +
  createHash("sha256")
    .update(id + "\0" + name)
    .digest("hex");
function project(db: LocalDatabase, id: string) {
  if (db.get("projects", id)?.tenant_id !== LOCAL_USER_ID)
    throw new ActionError(404, "Project unavailable.");
}
function row(db: LocalDatabase, p: string, id: string) {
  project(db, p);
  const found = db.sql
    .prepare("SELECT * FROM mcp_connections WHERE project_id=? AND id=?")
    .get(p, id) as Row | undefined;
  if (!found) throw new ActionError(404, "MCP connection unavailable.");
  return found;
}
export function saveServer(
  db: LocalDatabase,
  p: string,
  name: string,
  value: McpConfig,
) {
  project(db, p);
  const config = serverConfig.parse(value);
  if (config.transport === "http")
    remoteEndpoint(config.endpoint, config.allowLoopback);
  const id = randomUUID();
  db.transaction(() => {
    if (
      Number(
        db.sql
          .prepare(
            "SELECT count(*) AS n FROM mcp_connections WHERE project_id=?",
          )
          .get(p)?.n,
      ) >= 16
    )
      throw new ActionError(409, "Project connection limit reached.");
    db.sql
      .prepare("INSERT INTO mcp_connections VALUES(?,?,?,?)")
      .run(id, p, name, JSON.stringify(config));
  });
  return id;
}
export function listServers(db: LocalDatabase, p: string) {
  project(db, p);
  return (
    db.sql
      .prepare("SELECT * FROM mcp_connections WHERE project_id=? ORDER BY name")
      .all(p) as Row[]
  ).map((r) => {
    const live = connections.get(key(db, r.id));
    return {
      id: r.id,
      name: r.name,
      config: serverConfig.parse(JSON.parse(r.config)),
      status: live?.session
        ? "connected"
        : live
          ? "connecting"
          : "disconnected",
      tools:
        live?.session?.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          capability: token(r.id, t.name),
          digest: toolDigest(t),
        })) ?? [],
    };
  });
}
export async function disconnectServer(
  db: LocalDatabase,
  p: string,
  id: string,
) {
  row(db, p, id);
  const active = connections.get(key(db, id));
  if (!active) return;
  connections.delete(key(db, id));
  active.cancel.abort();
  await active.done?.catch(() => {});
  await active.session?.close();
}
export async function openServer(
  db: LocalDatabase,
  p: string,
  id: string,
  signal: AbortSignal,
  bearer?: string,
) {
  const r = row(db, p, id),
    k = key(db, id);
  if (connections.has(k) || connections.size >= 24)
    throw new ActionError(409, "MCP connection busy.");
  const live: Live = { cancel: new AbortController() };
  connections.set(k, live);
  const stop = async () => {
    if (connections.get(k) !== live) return;
    connections.delete(k);
    live.cancel.abort();
    await live.session?.close().catch(() => {});
  };
  live.done = (async () => {
    try {
      const session = await connectMcp(
        serverConfig.parse(JSON.parse(r.config)),
        AbortSignal.any([
          signal,
          live.cancel.signal,
          AbortSignal.timeout(16000),
        ]),
        bearer,
      );
      live.session = session;
      if (
        connections.get(k) !== live ||
        session.lost.aborted ||
        !db.sql.prepare("SELECT id FROM mcp_connections WHERE id=?").get(id)
      ) {
        await session.close();
        throw new Error("Revoked connection.");
      }
      session.lost.addEventListener("abort", () => void stop(), { once: true });
    } catch {
      await stop();
      throw new ActionError(409, "MCP connection or discovery failed.");
    }
  })();
  await live.done;
}
export async function removeServer(db: LocalDatabase, p: string, id: string) {
  row(db, p, id);
  db.sql
    .prepare("DELETE FROM mcp_connections WHERE project_id=? AND id=?")
    .run(p, id);
  const k = key(db, id),
    active = connections.get(k);
  if (active) {
    connections.delete(k);
    active.cancel.abort();
    await active.done?.catch(() => {});
    await active.session?.close();
  }
}
export function assignMcp(
  db: LocalDatabase,
  p: string,
  a: string,
  id: string,
  name: string,
  digest: string,
  enabled: boolean,
) {
  row(db, p, id);
  db.transaction(() => {
    const assistant = db.get("assistants", a);
    if (assistant?.tenant_id !== LOCAL_USER_ID || assistant.project_id !== p)
      throw new ActionError(404, "Assistant unavailable.");
    const capability = token(id, name);
    const grants = { ...assistant.mcp_assignments };
    if (enabled) {
      const tool = connections
        .get(key(db, id))
        ?.session?.tools.find((t) => t.name === name);
      if (!tool || toolDigest(tool) !== digest)
        throw new ActionError(409, "Review the current tool first.");
      if (
        !Object.hasOwn(grants, capability) &&
        Object.keys(grants).length >= 64
      )
        throw new ActionError(409, "Assignment limit reached.");
      grants[capability] = digest;
    } else delete grants[capability];
    db.put("assistants", { ...assistant, mcp_assignments: grants }, true);
  });
}
export async function invokeMcp(
  db: LocalDatabase,
  a: string,
  trace: ToolTrace,
  id: string,
  name: string,
  args: unknown,
  signal: AbortSignal,
) {
  const config = row(db, trace.projectId, id);
  const live = connections.get(key(db, id));
  const session = live?.session,
    tool = session?.tools.find((t) => t.name === name);
  if (!live || !session || !tool)
    throw new ActionError(409, "MCP tool disconnected.");
  const capability = token(id, name),
    digest = toolDigest(tool),
    validated = validateToolArguments(tool, args);
  const assigned = () =>
    connections.get(key(db, id)) === live &&
    !session.lost.aborted &&
    db.get("assistants", a)?.mcp_assignments?.[capability] === digest &&
    Boolean(
      db.sql
        .prepare("SELECT 1 FROM mcp_connections WHERE id=? AND project_id=?")
        .get(id, trace.projectId),
    );
  const scopedSignal = AbortSignal.any([
    signal,
    live.cancel.signal,
    session.lost,
  ]);
  return runNativeOperation(
    db,
    a,
    trace,
    scopedSignal,
    "mcp_call",
    {
      server: config.name,
      serverId: id,
      tool: name,
      arguments: validated,
      digest,
    },
    async (revalidate) => {
      try {
        const output = await session.call(name, validated, scopedSignal);
        revalidate();
        return output;
      } catch {
        throw new ActionError(409, "MCP operation failed or was cancelled.");
      }
    },
    { capability, assigned },
  );
}
