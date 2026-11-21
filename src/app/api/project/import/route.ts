import { after } from "next/server";
import { isDesktop } from "@/lib/runtime";
import { templateBundleSchema, materializeTemplateOrchestration } from "@/lib/templates";
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
    const createdIds: string[] = [];
    try {
      for (const assistant of input.project.assistants) {
        const { data: created, error } = await db.from("assistants").insert({
          tenant_id: tenantId,
          project_id: projectId,
          name: assistant.name,
          description: assistant.description,
          instructions: assistant.instructions,
          model_id: null,
        }).select("id").single();
        if (error) throw error;
        createdIds.push(created.id);
      }
      const { error: updateError } = await db.from("projects").update({
        name: input.project.name,
        description: input.project.description,
        color: input.project.color,
        orchestration: materializeTemplateOrchestration(input.project.orchestration, createdIds),
      }).eq("id", projectId).eq("tenant_id", tenantId);
      if (updateError) throw updateError;
    } catch (error) {
      // The pre-existing empty project must survive a failed import without
      // any partially imported assistants or portable/invalid UUID references.
      for (const id of createdIds)
        await db.from("assistants").delete().eq("id", id).eq("tenant_id", tenantId);
      throw error;
    }
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
