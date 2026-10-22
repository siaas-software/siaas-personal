import { templateBundleSchema } from "@/lib/templates";
import { localWorkspace, fail, jsonBody } from "@/lib/http";
import { listTemplates } from "@/lib/template-store";
export async function GET(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    return Response.json(await listTemplates(db, tenantId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const { project } = templateBundleSchema.parse(await jsonBody(req, 512_000));
    const { data, error } = await db.from("project_templates").insert({
      ...project, tenant_id: tenantId, builtin_key: null, deleted: false,
    }).select().single();
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (error) { return fail(error); }
}
