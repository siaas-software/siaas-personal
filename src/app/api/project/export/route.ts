import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
import { exportProjectBundle } from "@/lib/export-bundle";

export async function GET(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse(new URL(req.url).searchParams.get("project"));
    const { data: project, error: projectError } = await db
      .from("projects")
      .select("name,description,color")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) throw new HttpError(404, "Progetto non trovato.");
    const { data: assistants, error: assistantsError } = await db
      .from("assistants")
      .select("id,name,description,instructions,model_id,color")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (assistantsError) throw assistantsError;
    const local = isDesktop()
      ? (await import("@/lib/local/database")).localDatabase()
      : null;
    const localSources = local
      ? (await import("@/lib/local/template-project")).localAssistantSources
      : null;
    const portableAssistants = (assistants ?? []).map((a) => ({
      name: a.name,
      description: a.description,
      instructions: a.instructions,
      model: null,
      sources: local && localSources ? localSources(local, a.id) : [],
    }));
    const bundle = exportProjectBundle({
      name: project.name,
      description: project.description,
      color: project.color,
      assistants: portableAssistants,
    });
    return new Response(bundle.content, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${bundle.fileName}"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
