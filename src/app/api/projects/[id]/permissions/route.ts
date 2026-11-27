import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import { defaultToolPermissions, parseProjectToolPermissions } from "@/lib/tool-permission-gateway";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const project = db.get("projects", id);
    if (!project || project.tenant_id !== tenantId) throw new HttpError(404, "Project not found.");
    return Response.json({ revision: project.permission_revision ?? 0, defaults: defaultToolPermissions(), overrides: parseProjectToolPermissions(project.permissions) });
  } catch (error) { return fail(error); }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const body = await jsonBody(req, 32_000);
    let permissions;
    try {
      if (body == null) throw new Error();
      permissions = parseProjectToolPermissions(body);
    } catch { throw new HttpError(400, "Invalid project permission rules."); }
    const revision = db.transaction(() => {
      const project = db.get("projects", id);
      if (!project || project.tenant_id !== tenantId) throw new HttpError(404, "Project not found.");
      const current = project.permission_revision ?? 0;
      const expected = req.headers.get("if-match");
      if (expected !== null && expected !== `"${current}"`) throw new HttpError(412, "Project permissions changed.");
      db.put("projects", { ...project, permissions, permission_revision: current + 1 }, true);
      return current + 1;
    });
    return Response.json({ overrides: permissions, revision });
  } catch (error) { return fail(error); }
}
