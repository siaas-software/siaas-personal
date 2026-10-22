import { removeProjectFiles } from "@/lib/delete-resource";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { z } from "zod";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const input = z.object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }).parse(await jsonBody(req));
    const { data, error } = await db.from("projects").update(input)
      .eq("id", id).eq("tenant_id", tenantId).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Progetto non trovato.");
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { data: project, error } = await db.from("projects").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!project) throw new HttpError(404, "Progetto non trovato.");
    await removeProjectFiles(db, tenantId, id);
    const { error: deleteError } = await db.from("projects").delete().eq("id", id).eq("tenant_id", tenantId);
    if (deleteError) throw deleteError;
    return Response.json({ ok: true });
  } catch (error) { return fail(error); }
}
