import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { isDesktop } from "@/lib/runtime";
import { localDatabase } from "@/lib/local/database";
import {
  connectFolder,
  disconnectFolder,
  KnowledgeError,
  listSources,
  refreshSource,
  scanFolder,
} from "@/lib/local/knowledge";
export const runtime = "nodejs";
function failure(error: unknown) {
  return fail(
    error instanceof KnowledgeError ? new HttpError(400, error.message) : error,
  );
}
async function database(req: Request) {
  if (!isDesktop()) throw new HttpError(404, "Disponibile nell’app desktop.");
  await localWorkspace(req);
  return localDatabase();
}
export async function GET(req: Request) {
  try {
    const db = await database(req);
    const id = new URL(req.url).searchParams.get("assistant");
    return Response.json({
      directory: db.directory,
      sources: id ? listSources(db, uuid.parse(id)) : [],
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    const db = await database(req);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("preview"),
          assistant_id: uuid,
          path: z.string().min(1).max(4096),
          recursive: z.boolean(),
        }),
        z.object({
          action: z.literal("connect"),
          assistant_id: uuid,
          source_id: uuid.optional(),
          path: z.string().min(1).max(4096),
          recursive: z.boolean(),
        }),
        z.object({
          action: z.literal("refresh"),
          assistant_id: uuid,
          source_id: uuid,
        }),
        z.object({ action: z.literal("refresh-project"), project_id: uuid }),
      ])
      .parse(await jsonBody(req));
    if (input.action === "refresh-project") {
      if (!db.get("projects", input.project_id))
        throw new HttpError(404, "Progetto non trovato.");
      const assistants = db
        .rows("assistants")
        .filter((a) => a.project_id === input.project_id);
      const results = [],
        errors: string[] = [];
      for (const source of db
        .rows("knowledge_sources")
        .filter((s) => assistants.some((a) => a.id === s.assistant_id))) {
        try {
          results.push(refreshSource(db, source.id));
        } catch (e) {
          errors.push(
            e instanceof KnowledgeError
              ? e.message
              : "Aggiornamento di una cartella non riuscito.",
          );
        }
      }
      return Response.json({
        queued: results.flatMap((r) => r.queued),
        unavailable: results.filter((r) => r.source?.status === "unavailable")
          .length,
        errors,
      });
    }
    db.assistantDirectory(input.assistant_id);
    if (input.action === "preview")
      return Response.json(scanFolder(db, input.path, input.recursive));
    if (input.action === "connect")
      return Response.json(
        connectFolder(
          db,
          input.assistant_id,
          input.path,
          input.recursive,
          input.source_id,
        ),
      );
    const source = db.get("knowledge_sources", input.source_id);
    if (!source || source.assistant_id !== input.assistant_id)
      throw new HttpError(404, "Fonte non trovata.");
    return Response.json(refreshSource(db, input.source_id));
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(req: Request) {
  try {
    const db = await database(req);
    const input = z
      .object({ assistant_id: uuid, source_id: uuid })
      .parse(await jsonBody(req));
    const source = db.get("knowledge_sources", input.source_id);
    if (!source || source.assistant_id !== input.assistant_id)
      throw new HttpError(404, "Fonte non trovata.");
    disconnectFolder(db, input.source_id);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
