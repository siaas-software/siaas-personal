import { assertAssistantResearchChange } from "@/lib/local/research-services";
import { verifyLocalChatModel } from "@/lib/ollama";
import { removeAssistantFiles } from "@/lib/delete-resource";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { assistantSchema, desktopAssistantSchema } from "@/lib/validation";
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const input = (
      isDesktop() ? desktopAssistantSchema : assistantSchema
    ).parse(await jsonBody(req));

    if (isDesktop() && input.model_id) {
      const { data: previous, error: readError } = await db
        .from("assistants")
        .select("model_id")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!previous) throw new HttpError(404, "Assistente non trovato.");
      if (input.model_id !== previous.model_id)
        await verifyLocalChatModel(input.model_id);
    }
    await assertAssistantResearchChange(
      db.get("assistants", id)?.research,
      "research" in input ? input.research : undefined,
      db,
    );
    const { data, error } = await db
      .from("assistants")
      .update(input)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Assistente non trovato.");
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { data: assistant, error } = await db
      .from("assistants")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!assistant) throw new HttpError(404, "Assistente non trovato.");
    await removeAssistantFiles(db, tenantId, id);
    const { error: deleteError } = await db
      .from("assistants")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (deleteError) throw deleteError;
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
