import { z } from "zod";
import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import {
  decideApproval,
  pendingApprovals,
} from "@/lib/local/operation-approval";

type Params = { params: Promise<{ id: string }> };
async function context(req: Request, params: Params["params"]) {
  const { db, tenantId } = await localWorkspace(req);
  const id = uuid.parse((await params).id);
  if (db.get("projects", id)?.tenant_id !== tenantId)
    throw new HttpError(404, "Project not found.");
  return { db, id };
}
export async function GET(req: Request, { params }: Params) {
  try {
    const { db, id } = await context(req, params);
    return Response.json(
      { pending: pendingApprovals(db, id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request, { params }: Params) {
  try {
    const input = z
      .object({
        id: uuid,
        outcome: z.enum(["approved", "rejected", "cancelled"]),
      })
      .strict()
      .parse(await jsonBody(req, 1024));
    const { db, id } = await context(req, params);
    if (!decideApproval(db, id, input.id, input.outcome))
      throw new HttpError(409, "Approval unavailable.");
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
