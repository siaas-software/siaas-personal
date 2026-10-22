import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { localDatabase } from "@/lib/local/database";
import {
  registerWebSource,
  setWebSourceEnabled,
  WebKnowledgeError,
} from "@/lib/local/web-knowledge";
import { processWebSource } from "@/lib/local/web-ingestion";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    if (!isDesktop())
      throw new HttpError(
        404,
        "Web knowledge is available in the desktop app.",
      );
    await localWorkspace(req);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("add"),
          assistant_id: uuid,
          url: z.string().trim().min(1).max(1500),
        }),
        z.object({
          action: z.literal("refresh"),
          assistant_id: uuid,
          document_id: uuid,
        }),
        z.object({
          action: z.literal("toggle"),
          assistant_id: uuid,
          document_id: uuid,
          enabled: z.boolean(),
        }),
      ])
      .parse(await jsonBody(req));
    const db = localDatabase();
    if (input.action === "toggle") {
      const doc = setWebSourceEnabled(
        db,
        input.assistant_id,
        input.document_id,
        input.enabled,
      );
      return Response.json({ id: doc.id, enabled: doc.enabled });
    }
    const doc =
      input.action === "add"
        ? registerWebSource(db, input.assistant_id, input.url)
        : db.get("documents", input.document_id);
    if (!doc?.source_url || doc.assistant_id !== input.assistant_id)
      throw new HttpError(404, "Web source not found for this assistant.");
    db.syncKnowledgeFiles(input.assistant_id);
    const result = await processWebSource(
      db,
      doc.id,
      input.action === "refresh",
    );
    return Response.json(
      { id: doc.id, ...result },
      { status: input.action === "add" ? 201 : 200 },
    );
  } catch (error) {
    return fail(
      error instanceof WebKnowledgeError
        ? new HttpError(400, error.message)
        : error,
    );
  }
}
