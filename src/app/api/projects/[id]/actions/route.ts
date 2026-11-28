import { z } from "zod";
import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import { actionReference } from "@/lib/local/portable-tools";
import { listActions } from "@/lib/local/actions";

type Params = { params: Promise<{ id: string }> };
async function context(req: Request, params: Params["params"]) {
  const { db, tenantId } = await localWorkspace(req);
  const id = uuid.parse((await params).id);
  const project = db.get("projects", id);
  if (!project || project.tenant_id !== tenantId)
    throw new HttpError(404, "Project not found.");
  return { db, project };
}
export async function GET(req: Request, { params }: Params) {
  try {
    const { db, project } = await context(req, params);
    const requested: {name:string;digest:string}[] = project.requested_tools?.actions ?? [];
    const local = listActions(db);
    const suggestions = requested.map(ref => ({name:ref.name, id:local.find(a=>a.name===ref.name && actionReference(a).digest===ref.digest)?.id ?? null}));
    const available = listActions(db).map(({ id, name }) => ({ id, name }));
    return Response.json({
      suggestions, available,
      selected: available
        .filter((a) => project.action_ids?.includes(a.id))
        .map((a) => a.id),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(req: Request, { params }: Params) {
  try {
    const { ids } = z
      .object({ ids: z.array(z.string().min(1).max(128)).max(100) })
      .strict()
      .parse(await jsonBody(req, 16000));
    const { db, project } = await context(req, params);
    db.transaction(() => {
      const current = db.get("projects", project.id);
      if (!current || current.tenant_id !== project.tenant_id)
        throw new HttpError(404, "Project not found.");
      const available = new Set(listActions(db).map((a) => a.id));
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !available.has(id))
      )
        throw new HttpError(400, "Invalid project Actions.");
      db.put("projects", { ...current, action_ids: ids }, true);
    });
    return Response.json({ selected: ids });
  } catch (e) {
    return fail(e);
  }
}
