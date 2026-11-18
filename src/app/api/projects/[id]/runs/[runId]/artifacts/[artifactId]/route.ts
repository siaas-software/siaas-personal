import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; runId: string; artifactId: string }> };

/** Download only a verified artifact stored in this project's own run. */
export async function GET(req: Request, { params }: Context) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const params = await params;
    const projectId = uuid.parse(params.id);
    const runId = uuid.parse(params.runId);
    const artifactId = uuid.parse(params.artifactId);
    const project = db.get("projects", projectId);
    if (!project || project.tenant_id !== tenantId)
      throw new HttpError(404, "Progetto non trovato.");
    const run = db.get("project_runs", runId);
    if (!run || run.project_id !== projectId || run.tenant_id !== tenantId)
      throw new HttpError(404, "Esecuzione non trovata.");
    const artifact = (Array.isArray(run.steps) ? run.steps : [])
      .flatMap((step: { artifacts?: unknown }) =>
        Array.isArray(step.artifacts) ? step.artifacts : [],
      )
      .find((item: { id?: string }) => item.id === artifactId);
    if (!artifact || typeof artifact.content !== "string" || artifact.content.length > 32_000)
      throw new HttpError(404, "Documento generato non disponibile.");
    const title = String(artifact.title ?? "report")
      .replace(/[^a-zA-Z0-9_.-]/g, "-")
      .slice(0, 70) || "report";
    return new Response(artifact.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${title}.md"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
