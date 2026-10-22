import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    if (isDesktop()) {
      const { localDatabase } = await import("@/lib/local/database");
      const { removeLocalDocument } = await import("@/lib/local/knowledge");
      if (!localDatabase().get("documents", id))
        throw new HttpError(404, "Documento non trovato.");
      removeLocalDocument(
        localDatabase(),
        id,
        new URL(req.url).searchParams.get("deleteCopy") === "true",
      );
      return Response.json({ ok: true });
    }
    const { data: doc, error } = await db
      .from("documents")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new HttpError(404, "Documento non trovato.");
    if (doc.storage_path) {
      const { error: e } = await db.storage
        .from("documents")
        .remove([doc.storage_path]);
      if (e) throw e;
    }
    const { error: e } = await db.from("documents").delete().eq("id", id);
    if (e) throw e;
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await localWorkspace();
    const id = uuid.parse((await params).id);
    const { data: doc, error } = await db
      .from("documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new HttpError(404, "Documento non trovato.");
    if (isDesktop() && doc.source_id)
      return Response.json({ url: `/api/local/files/${id}`, title: doc.title });
    if (doc.storage_path) {
      const { data } = await db.storage
        .from("documents")
        .fileUrl(doc.storage_path);
      return Response.json({ url: data.url });
    }
    return Response.json({ text: doc.raw_text, title: doc.title });
  } catch (error) {
    return fail(error);
  }
}
