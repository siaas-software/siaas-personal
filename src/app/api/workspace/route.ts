import { version } from "../../../../package.json";
import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, jsonBody } from "@/lib/http";
import { ollamaStatus } from "@/lib/ollama";
import { z } from "zod";
export async function GET() {
  try {
    const { db, tenantId } = await localWorkspace();
    const { data: workspace, error } = await db
      .from("workspaces")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) throw error;
    const { data: projects, error: pError } = await db
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (pError) throw pError;
    const { data: assistants, error: aError } = await db
      .from("assistants")
      .select("*")
      .order("created_at", { ascending: false });
    if (aError) throw aError;
    const { data: usage, error: uError } = await db
      .from("messages")
      .select("input_tokens,output_tokens")
      .eq("role", "assistant")
      .eq("status", "complete")
      .gte(
        "created_at",
        new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        ).toISOString(),
      )
      .limit(10000);
    if (uError) throw uError;
    const runtime = await ollamaStatus();
    return Response.json(
      {
        desktop: isDesktop(),
        version,
        workspace,
        projects,
        assistants,
        models: runtime.models,
        runtime,
        tokens:
          usage?.reduce((n, m) => n + m.input_tokens + m.output_tokens, 0) ?? 0,
        aiReady: runtime.embeddingReady,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await jsonBody(req));
    const { data, error } = await db
      .from("workspaces")
      .upsert({ id: tenantId, name })
      .select()
      .single();
    if (error)
      throw new HttpError(400, "Impossibile salvare lo spazio di lavoro.");
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}
