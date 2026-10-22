import { after } from "next/server";
import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, jsonBody } from "@/lib/http";
import { listTemplates } from "@/lib/template-store";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).default(""),
  template_id: z.string().min(1).max(180).nullable().optional(),
});
export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const input = schema.parse(await jsonBody(req));
    const template = input.template_id
      ? (await listTemplates(db, tenantId)).find(
          (t) =>
            t.id === input.template_id || t.builtin_key === input.template_id,
        )
      : undefined;
    if (input.template_id && !template)
      throw new HttpError(404, "Template non trovato.");
    const name = input.name || template?.name;
    if (!name) throw new HttpError(400, "Inserisci il nome del progetto.");
    if (template && isDesktop()) {
      const { localDatabase } = await import("@/lib/local/database");
      const { importLocalTemplate } =
        await import("@/lib/local/template-project");
      const { processTemplateSources } =
        await import("@/lib/local/web-ingestion");
      const local = localDatabase();
      const result = importLocalTemplate(
        local,
        {
          ...template,
          name,
          description: input.description || template.description,
        },
        undefined,
        template.id,
      );
      if (result.documents.length)
        after(() => processTemplateSources(local, result.documents));
      return Response.json(result.project, { status: 201 });
    }
    if (template?.assistants.some((a) => a.sources.length))
      throw new HttpError(
        400,
        "Templates with web sources require SIAAS Personal on your computer.",
      );
    const { data: project, error } = await db
      .from("projects")
      .insert({
        tenant_id: tenantId,
        name,
        description: input.description || template?.description || "",
        template_id: template?.id ?? null,
        color: template?.color ?? "#FFFFFF",
      })
      .select()
      .single();
    if (error) throw error;
    if (template?.assistants.length) {
      const { error: assistantError } = await db.from("assistants").insert(
        template.assistants.map(
          ({ model: _model, sources: _sources, ...config }) => ({
            ...config,
            tenant_id: tenantId,
            project_id: project.id,
            model_id: null,
          }),
        ),
      );
      if (assistantError) {
        await db
          .from("projects")
          .delete()
          .eq("id", project.id)
          .eq("tenant_id", tenantId);
        throw assistantError;
      }
    }
    return Response.json(project, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
