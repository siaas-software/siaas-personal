import { localWorkspace, fail, uuid, HttpError } from "@/lib/http";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await localWorkspace();
    const id = uuid.parse((await params).id);
    const { data: c } = await db
      .from("conversations")
      .select("id,assistant_id")
      .eq("id", id)
      .maybeSingle();
    if (!c) throw new HttpError(404, "Conversazione non trovata.");
    const { data, error } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at")
      .limit(500);
    if (error) throw error;
    return Response.json({ conversation: c, messages: data });
  } catch (error) {
    return fail(error);
  }
}
