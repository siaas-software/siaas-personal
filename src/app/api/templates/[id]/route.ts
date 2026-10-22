import { localWorkspace, fail, HttpError } from "@/lib/http";
import { templateBundle } from "@/lib/templates";

async function ownedTemplate(req: Request, params: Promise<{ id: string }>) {
  const { db, tenantId } = await localWorkspace(req);
  const { id } = await params;
  const { data, error } = await db.from("project_templates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data || data.deleted) throw new HttpError(404, "Template non trovato.");
  return { db, tenantId, template: data };
}
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { template } = await ownedTemplate(req, params);
    return new Response(JSON.stringify(templateBundle(template), null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="siaas-template.json"',
    } });
  } catch (error) { return fail(error); }
}
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId, template } = await ownedTemplate(req, params);
    // Keep a tombstone for built-ins so they are not restored on the next launch.
    const query = template.builtin_key
      ? db.from("project_templates").update({ deleted: true })
      : db.from("project_templates").delete();
    const { error } = await query.eq("id", template.id).eq("tenant_id", tenantId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) { return fail(error); }
}
