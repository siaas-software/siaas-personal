import { z } from "zod";
import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import { mcpServerName, type TemplateProject } from "@/lib/templates";
import { serverConfig } from "@/lib/local/mcp/client";
import {
  listServers,
  saveServer,
  openServer,
  disconnectServer,
  removeServer,
  assignMcp,
} from "@/lib/local/mcp/registry";

type Params = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Params) {
  try {
    const { db, tenantId } = await localWorkspace(req),
      id = uuid.parse((await params).id);
    const assistant = new URL(req.url).searchParams.get("assistant");
    const servers = listServers(db, id);
    const project = db.get("projects", id)!;
    const requests: TemplateProject["requested_tools"] =
      project.requested_tools;
    const requested = (requests?.mcp ?? [])
      .filter(
        (r) =>
          !assistant ||
          r.assistant_indices.some(
            (i) => project.requested_tool_assistant_ids?.[i] === assistant,
          ),
      )
      .map((r) => {
        const matches = servers.filter((s) => s.name === r.server);
        const matched =
          matches.length === 1 &&
          matches[0].tools.some(
            (t) => t.name === r.tool && t.digest === r.digest,
          );
        return { server: r.server, tool: r.tool, digest: r.digest, matched };
      });
    if (!assistant) return Response.json({ servers, requested });
    const a = db.get("assistants", uuid.parse(assistant));
    if (!a || a.tenant_id !== tenantId || a.project_id !== id)
      throw new HttpError(404, "Assistant unavailable.");
    return Response.json({
      servers,
      requested,
      assignments: a.mcp_assignments ?? {},
    });
  } catch (e) {
    return fail(e);
  }
}
const operation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("save"),
      name: mcpServerName,
      config: serverConfig,
    })
    .strict(),
  z
    .object({
      op: z.literal("connect"),
      id: uuid,
      bearer: z
        .string()
        .regex(/^[A-Za-z0-9._~+/=-]{1,4096}$/)
        .optional(),
    })
    .strict(),
  z.object({ op: z.literal("disconnect"), id: uuid }).strict(),
  z.object({ op: z.literal("remove"), id: uuid }).strict(),
  z
    .object({
      op: z.literal("assign"),
      id: uuid,
      assistant: uuid,
      name: z.string().max(64),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
      enabled: z.boolean(),
    })
    .strict(),
]);
export async function POST(req: Request, { params }: Params) {
  try {
    const { db } = await localWorkspace(req),
      p = uuid.parse((await params).id);
    const input = operation.parse(await jsonBody(req, 8192));
    switch (input.op) {
      case "save":
        return Response.json(
          { id: saveServer(db, p, input.name, input.config) },
          { status: 201 },
        );
      case "connect":
        await openServer(db, p, input.id, req.signal, input.bearer);
        break;
      case "disconnect":
        await disconnectServer(db, p, input.id);
        break;
      case "remove":
        await removeServer(db, p, input.id);
        break;
      case "assign":
        assignMcp(
          db,
          p,
          input.assistant,
          input.id,
          input.name,
          input.digest,
          input.enabled,
        );
        break;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
