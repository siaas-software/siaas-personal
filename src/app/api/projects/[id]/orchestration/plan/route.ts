import type { Project, Assistant } from "@/lib/catalog";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import {
  parseProjectOrchestration,
  validateOrchestrationPlan,
  validateProjectParticipants,
  ProjectOrchestrationError,
} from "@/lib/project-orchestration";

/**
 * Preflight only. Does not invoke any assistant, model, action or filesystem.
 * Execution uses the separate project runs endpoint and the shared assistant executor.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { data: project, error: pError } = await db
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (pError) throw pError;
    if (!project) throw new HttpError(404, "Progetto non trovato.");
    const config = parseProjectOrchestration(project.orchestration);
    const plan = validateOrchestrationPlan(await jsonBody(req, 16_000), config);
    const { data: members, error: aError } = await db
      .from("assistants")
      .select("*")
      .eq("project_id", id)
      .eq("tenant_id", tenantId);
    if (aError) throw aError;
    validateProjectParticipants(
      project as Project,
      tenantId,
      config,
      (members ?? []) as Assistant[],
    );
    return Response.json({
      status: "validated_not_executed",
      project_id: id,
      steps: plan.steps.map((step) => ({
        assistant_id: step.assistant_id,
        task: step.task,
      })),
      message: "Piano validato. Per eseguirlo usa la chat del progetto.",
    });
  } catch (error) {
    if (error instanceof ProjectOrchestrationError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return fail(error);
  }
}
