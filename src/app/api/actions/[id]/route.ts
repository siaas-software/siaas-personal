import { requireBuilderModel } from "@/lib/local/action-builder-model";
import { z } from "zod";
import { localWorkspace, jsonBody, fail, HttpError } from "@/lib/http";
import {
  getAction,
  editableAction,
  saveAction,
  deleteAction,
} from "@/lib/local/actions";
import { verifyActionPreview } from "@/lib/local/action-builder";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: Context) {
  try {
    const { db } = await localWorkspace(req);
    return Response.json(getAction(db, (await context.params).id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(req: Request, context: Context) {
  try {
    const { db } = await localWorkspace(req);
    const { id } = await context.params;
    editableAction(db, id);
    const body = z
      .object({ preview: z.string().max(40_000), confirmed: z.literal(true) })
      .parse(await jsonBody(req, 45_000));
    await requireBuilderModel(db);
    const draft = verifyActionPreview(body.preview);
    if (draft.id !== id)
      throw new HttpError(400, "Preview belongs to another Action.");
    return Response.json(saveAction(db, draft));
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(req: Request, context: Context) {
  try {
    const { db } = await localWorkspace(req);
    z.object({ confirmed: z.literal(true) }).parse(await jsonBody(req, 1000));
    deleteAction(db, (await context.params).id);
    return Response.json({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
