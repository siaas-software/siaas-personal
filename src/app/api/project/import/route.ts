import { after } from "next/server";
import { isDesktop } from "@/lib/runtime";
import { templateBundleSchema } from "@/lib/templates";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";

const portableProject = templateBundleSchema;

export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse(new URL(req.url).searchParams.get("project"));
    const input = portableProject.parse(await jsonBody(req, 512_000));
    const { data: existing, error: existingError } = await db
      .from("assistants")
      .select("id")
      .eq("project_id", projectId)
      .limit(1);
    if (existingError) throw existingError;
    if (existing?.length)
      throw new HttpError(
        409,
        "Il progetto contiene già assistenti. Importa in un progetto vuoto per evitare sovrascritture.",
      );

    const { data: project, error: projectError } = await db
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) throw new HttpError(404, "Progetto non trovato.");

    if (isDesktop()) {
      const { localDatabase } = await import("@/lib/local/database");
      const { importLocalTemplate } =
        await import("@/lib/local/template-project");
      const { processTemplateSources } =
        await import("@/lib/local/web-ingestion");
      const local = localDatabase();
      const result = importLocalTemplate(local, input.project, projectId);
      if (result.documents.length)
        after(() => processTemplateSources(local, result.documents));
      return Response.json(
        {
          name: input.project.name,
          assistants: result.assistantIds.length,
          sources: result.documents.length,
        },
        { status: 201 },
      );
    }
    if (input.project.assistants.some((a) => a.sources.length))
      throw new HttpError(
        400,
        "Templates with web sources require SIAAS Personal on your computer.",
      );
    if (input.project.assistants.length) {
      const { error } = await db.from("assistants").insert(
        input.project.assistants.map((a) => ({
          tenant_id: tenantId,
          project_id: projectId,
          name: a.name,
          description: a.description,
          instructions: a.instructions,
          model_id: null,
        })),
      );
      if (error) throw error;
    }
    const { error: updateError } = await db
      .from("projects")
      .update({
        name: input.project.name,
        description: input.project.description,
        color: input.project.color,
      })
      .eq("id", projectId)
      .eq("tenant_id", tenantId);
    if (updateError) throw updateError;
    return Response.json(
      {
        name: input.project.name,
        assistants: input.project.assistants.length,
      },
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
