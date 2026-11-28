import { fail, HttpError, jsonBody, localWorkspace, uuid } from "@/lib/http";
import { settings, owner, saveMedia } from "@/lib/local/media/service";
import { checkPng } from "@/lib/local/media/processing";
import { z } from "zod";
type Params = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Params) {
  try {
    const { db } = await localWorkspace(req),
      a = uuid.parse((await params).id),
      p = owner(db, a);
    const file = new URL(req.url).searchParams.get("file");
    if (!file)
      return Response.json(
        db.sql
          .prepare(
            "SELECT id,mime,digest FROM media_files WHERE assistant_id=? AND project_id=? ORDER BY rowid",
          )
          .all(a, p),
      );
    const r = db.sql
      .prepare(
        "SELECT mime,bytes FROM media_files WHERE id=? AND assistant_id=? AND project_id=?",
      )
      .get(uuid.parse(file), a, p);
    if (!r) throw new HttpError(404, "Media unavailable.");
    return new Response(new Uint8Array(r.bytes as Uint8Array), {
      headers: {
        "Content-Type": String(r.mime),
        "Content-Disposition": `attachment; filename="${file}.${r.mime === "image/png" ? "png" : "mp4"}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request, { params }: Params) {
  try {
    const { db } = await localWorkspace(req),
      a = uuid.parse((await params).id),
      p = owner(db, a);
    const { png } = z
      .object({ png: z.string().base64() })
      .strict()
      .parse(await jsonBody(req, 5600000));
    if (!settings(db).enabled)
      throw new HttpError(403, "Media processing disabled.");
    const bytes = Buffer.from(png, "base64");
    try {
      checkPng(bytes);
    } catch {
      throw new HttpError(400, "Unsupported PNG.");
    }
    return Response.json(
      { id: saveMedia(db, p, a, "image/png", bytes) },
      { status: 201 },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { db } = await localWorkspace(req),
      a = uuid.parse((await params).id);
    const id = uuid.parse(new URL(req.url).searchParams.get("file"));
    if (
      !db.sql
        .prepare(
          "DELETE FROM media_files WHERE id=? AND assistant_id=? AND project_id=?",
        )
        .run(id, a, owner(db, a)).changes
    )
      throw new HttpError(404, "Media unavailable.");
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
