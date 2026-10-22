import { requireBuilderModel } from "@/lib/local/action-builder-model";
import { z } from "zod";
import { localWorkspace, jsonBody, fail, HttpError } from "@/lib/http";
import { listActions, saveAction } from "@/lib/local/actions";
import { verifyActionPreview } from "@/lib/local/action-builder";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    return Response.json(listActions(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const { preview, confirmed } = z
      .object({ preview: z.string().max(40_000), confirmed: z.literal(true) })
      .parse(await jsonBody(req, 45_000));
    if (!confirmed) throw new HttpError(400, "Review and confirm the preview.");
    await requireBuilderModel(db);
    const draft = verifyActionPreview(preview);
    if (draft.id)
      throw new HttpError(400, "Use the existing Action to save this edit.");
    return Response.json(saveAction(db, draft), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
