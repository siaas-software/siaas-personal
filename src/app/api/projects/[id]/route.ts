import type { Project, Assistant } from "@/lib/catalog";
import { removeProjectFiles } from "@/lib/delete-resource";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import {
  parseProjectOrchestration,
  validateProjectParticipants,
  ProjectOrchestrationError,
} from "@/lib/project-orchestration";
import { z } from "zod";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional(),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        orchestration: z.unknown().optional(),
      })
      .parse(await jsonBody(req));
    const update: Record<string, unknown> = {
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    };
    if (input.orchestration !== undefined) {
      const { data: project, error: pError } = await db
        .from("projects")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (pError) throw pError;
      if (!project) throw new HttpError(404, "Progetto non trovato.");
      const config = parseProjectOrchestration(input.orchestration);
      const { data: members, error: aError } = await db
        .from("assistants")
        .select("*")
        .eq("project_id", id)
        .eq("tenant_id", tenantId);
      if (aError) throw aError;
      validateProjectParticipants(
        project as Project,
        tenantId,
        config,
        (members ?? []) as Assistant[],
      );
      update.orchestration = config;
    }
    const { data, error } = await db
      .from("projects")
      .update(update)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Progetto non trovato.");
    return Response.json(data);
  } catch (error) {
    if (error instanceof ProjectOrchestrationError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return fail(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { data: project, error } = await db
      .from("projects")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!project) throw new HttpError(404, "Progetto non trovato.");
    const {listServers,disconnectServer}=await import("@/lib/local/mcp/registry");
    await Promise.all(listServers(db,id).map(server=>disconnectServer(db,id,server.id)));
    await removeProjectFiles(db, tenantId, id);
    const { error: deleteError } = await db
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (deleteError) throw deleteError;
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
