import { isDesktop } from "@/lib/runtime";
import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { templateProjectSchema } from "@/lib/templates";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await jsonBody(req));
    const { data: project, error } = await db
      .from("projects")
      .select("name,description,color")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!project) throw new HttpError(404, "Progetto non trovato.");
    const { data: assistants, error: assistantError } = await db
      .from("assistants")
      .select("id,name,description,instructions,model_id,color")
      .eq("project_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(51);
    if (assistantError) throw assistantError;
    if ((assistants?.length ?? 0) > 50)
      throw new HttpError(
        400,
        "Un template può contenere al massimo 50 assistenti.",
      );
    const local = isDesktop()
      ? (await import("@/lib/local/database")).localDatabase()
      : null;
    const localSources = local
      ? (await import("@/lib/local/template-project")).localAssistantSources
      : null;
    const portableAssistants = (assistants ?? []).map((a) => ({
      ...a,
      model: null,
      sources: local && localSources ? localSources(local, a.id) : [],
    }));
    const config = templateProjectSchema.parse({
      ...project,
      name,
      assistants: portableAssistants,
    });
    const { data: template, error: insertError } = await db
      .from("project_templates")
      .insert({
        ...config,
        tenant_id: tenantId,
        builtin_key: null,
        deleted: false,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return Response.json(template, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
