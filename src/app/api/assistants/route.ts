import { assertAssistantResearchChange } from "@/lib/local/research-services";
import { verifyLocalChatModel } from "@/lib/ollama";
import { localWorkspace, fail, jsonBody } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { assistantSchema, desktopAssistantSchema } from "@/lib/validation";
import { z } from "zod";

export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const body = await jsonBody(req);
    const project_id = z.string().uuid().parse(body.project_id);
    const input = (
      isDesktop() ? desktopAssistantSchema : assistantSchema
    ).parse(body);
    const { data: project, error: projectError } = await db
      .from("projects")
      .select("id")
      .eq("id", project_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (projectError || !project) throw new Error("Progetto non valido.");

    if (isDesktop() && input.model_id)
      await verifyLocalChatModel(input.model_id);
    await assertAssistantResearchChange(
      undefined,
      "research" in input ? input.research : undefined,
      db,
    );
    const { data, error } = await db
      .from("assistants")
      .insert({ ...input, tenant_id: tenantId, project_id })
      .select()
      .single();
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
