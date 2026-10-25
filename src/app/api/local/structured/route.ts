import { localWorkspace, fail, jsonBody, uuid } from "@/lib/http";
import { z } from "zod";
import {
  inspectDatasets,
  relations,
  updateMapping,
  saveRelationship,
  initStructured,
} from "@/lib/structured/store";
import { queryStructured } from "@/lib/structured/service";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace();
    const id = uuid.parse(new URL(req.url).searchParams.get("assistant"));
    return Response.json(
      { datasets: inspectDatasets(db, id), relationships: relations(db, id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    const { db } = await localWorkspace(req);
    const body = z
      .object({
        assistantId: uuid,
        action: z.enum([
          "mapping",
          "relationship",
          "query",
          "deleteRelationship",
          "deleteDataset",
        ]),
        id: uuid.optional(),
        value: z.unknown().optional(),
      })
      .strict()
      .parse(await jsonBody(req, 64000));
    db.assistantDirectory(body.assistantId);
    initStructured(db);
    if (body.action === "query")
      return Response.json(queryStructured(db, body.assistantId, body.value));
    if (body.action === "mapping")
      updateMapping(db, body.assistantId, uuid.parse(body.id), body.value);
    if (body.action === "relationship")
      return Response.json(saveRelationship(db, body.assistantId, body.value));
    if (body.action === "deleteRelationship")
      db.sql
        .prepare(
          "DELETE FROM structured_relationships WHERE id=? AND assistant_id=?",
        )
        .run(uuid.parse(body.id), body.assistantId);
    if (body.action === "deleteDataset")
      db.sql
        .prepare(
          "DELETE FROM structured_datasets WHERE id=? AND assistant_id=?",
        )
        .run(uuid.parse(body.id), body.assistantId);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
