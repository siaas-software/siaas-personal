import { fail, HttpError, localWorkspace, uuid } from "@/lib/http";
import { ExecutionEventStore } from "@/lib/local/execution-events";
import { z } from "zod";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const projectId = uuid.parse((await params).id);
    const query = new URL(req.url).searchParams;
    const limit = z.coerce.number().int().min(1).max(200).parse(query.get("limit") ?? 50);
    const before = uuid.nullable().parse(query.get("before"));
    const assistantId = uuid.nullable().parse(query.get("assistant"));
    const project = db.get("projects", projectId);
    if (project?.tenant_id !== tenantId) throw new HttpError(404, "Project not found.");
    if (assistantId) {
      const assistant = db.get("assistants", assistantId);
      if (assistant?.tenant_id !== tenantId || assistant.project_id !== projectId)
        throw new HttpError(404, "Assistant not found.");
    }
    return Response.json(new ExecutionEventStore(db).page(projectId, assistantId, before, limit));
  } catch (error) { return fail(error); }
}
