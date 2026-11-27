import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import { defaultToolPermissions, parseProjectToolPermissions } from "@/lib/tool-permission-gateway";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const project = db.get("projects", uuid.parse((await params).id));
    if (!project || project.tenant_id !== tenantId) throw new HttpError(404, "Project not found.");
    return Response.json({ defaults: defaultToolPermissions(), overrides: parseProjectToolPermissions(project.permissions) });
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
    db.transaction(() => {
      const project = db.get("projects", id);
      if (!project || project.tenant_id !== tenantId) throw new HttpError(404, "Project not found.");
      db.put("projects", { ...project, permissions }, true);
    });
    return Response.json({ overrides: permissions });
  } catch (error) { return fail(error); }
}
