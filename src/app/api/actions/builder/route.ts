import { requireBuilderModel } from "@/lib/local/action-builder-model";
import { localWorkspace, jsonBody, fail } from "@/lib/http";
import { editableAction, validateActionName } from "@/lib/local/actions";
import {
  builderRequestSchema,
  buildAction,
  signActionPreview,
} from "@/lib/local/action-builder";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const input = builderRequestSchema.parse(await jsonBody(req, 65_000));
    const current = input.actionId
      ? editableAction(db, input.actionId)
      : undefined;
    input.name = validateActionName(db, input.name, input.actionId);
    const modelId = await requireBuilderModel(db);
    const result = await buildAction(
      { ...input, modelId },
      current?.markdown,
      req.signal,
    );
    return Response.json({
      ...result,
      preview: result.markdown
        ? signActionPreview({
            name: input.name,
            markdown: result.markdown,
            id: current?.id,
            updated_at: current?.updated_at,
          })
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}
