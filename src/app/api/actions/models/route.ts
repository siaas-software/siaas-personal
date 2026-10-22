import { z } from "zod";
import { localWorkspace, jsonBody, fail } from "@/lib/http";
import {
  builderModelStatus,
  setBuilderModel,
} from "@/lib/local/action-builder-model";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    return Response.json(await builderModelStatus(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const { modelId } = z
      .object({ modelId: z.string().min(1).max(150).nullable() })
      .parse(await jsonBody(req, 1024));
    await setBuilderModel(db, modelId);
    return Response.json(await builderModelStatus(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
