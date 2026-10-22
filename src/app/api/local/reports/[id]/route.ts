import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import type { AgentArtifact } from "@/lib/catalog";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    const { db } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const conversation = uuid.parse(
      new URL(req.url).searchParams.get("conversation"),
    );
    const { data, error } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation)
      .eq("role", "assistant");
    if (error) throw error;
    const artifact = data
      ?.flatMap((m) => (m.artifacts ?? []) as AgentArtifact[])
      .find((a: AgentArtifact) => a.id === id);
    if (!artifact) throw new HttpError(404, "Report non trovato.");
    const filename =
      artifact.title
        .replace(/[^\p{L}\p{N} _-]/gu, "")
        .trim()
        .slice(0, 80) || "report";
    return new Response(artifact.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename + ".md")}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
