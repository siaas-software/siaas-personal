import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
import { MAX_FILE_BYTES } from "@/lib/catalog";
import { readFileSync } from "node:fs";
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    await localWorkspace(req);
    const { localDatabase } = await import("@/lib/local/database");
    const db = localDatabase(),
      doc = db.get("documents", uuid.parse((await params).id));
    if (!doc?.storage_path) throw new HttpError(404, "File non trovato.");
    const reader = req.body?.getReader();
    if (!reader) throw new HttpError(400, "File vuoto.");
    let size = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES || size > doc.byte_size) {
        await reader.cancel();
        throw new HttpError(413, "File troppo grande.");
      }
      parts.push(value);
    }
    if (size !== doc.byte_size || !size)
      throw new HttpError(400, "File incompleto.");
    const { saveImportedFile } = await import("@/lib/local/knowledge");
    return Response.json(saveImportedFile(db, doc.id, Buffer.concat(parts)));
  } catch (error) {
    return fail(error);
  }
}
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isDesktop()) throw new HttpError(404, "Solo desktop.");
    const { localDatabase } = await import("@/lib/local/database");
    const db = localDatabase(),
      doc = db.get("documents", uuid.parse((await params).id));
    if (!doc || (!doc.storage_path && !doc.source_id))
      throw new HttpError(404, "File non trovato.");
    const { readLinkedDocument } = await import("@/lib/local/knowledge");
    const bytes = doc.source_id
      ? readLinkedDocument(db, doc)
      : readFileSync(db.filePath(doc.storage_path));
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
