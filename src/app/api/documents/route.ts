import { isDesktop } from "@/lib/runtime";
import { randomUUID } from "node:crypto";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import {
  FILE_EXTENSIONS,
  MAX_DOCUMENT_CHARS,
  MAX_FILE_BYTES,
} from "@/lib/catalog";
import { z } from "zod";
export async function GET(req: Request) {
  try {
    const { db } = await localWorkspace();
    const id = uuid.parse(new URL(req.url).searchParams.get("assistant"));
    const { data, error } = await db
      .from("documents")
      .select("*")
      .eq("assistant_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const fields =
      "id,assistant_id,title,kind,status,error,chunk_count,created_at,storage_path,byte_size,lease_until,embedding_model".split(
        ",",
      );
    if (isDesktop())
      fields.push(
        "enabled",
        "source_id",
        "relative_path",
        "source_url",
        "resolved_url",
        "fetched_at",
      );
    return Response.json(
      data?.map((doc) =>
        Object.fromEntries(fields.map((key) => [key, doc[key]])),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const input = z
      .object({
        assistant_id: uuid,
        title: z.string().trim().min(1).max(180),
        kind: z.enum(["text", "pdf", "docx", "txt", "md", "xlsx", "csv"]),
        text: z.string().trim().min(1).max(MAX_DOCUMENT_CHARS).optional(),
        byte_size: z.number().int().positive().max(MAX_FILE_BYTES).optional(),
      })
      .parse(await jsonBody(req, 650_000));
    if (input.kind === "text" && !input.text)
      throw new HttpError(400, "Inserisci un testo.");
    if (
      input.kind !== "text" &&
      (!FILE_EXTENSIONS.includes(input.kind) || !input.byte_size)
    )
      throw new HttpError(400, "File non valido.");
    const { data: assistant } = await db
      .from("assistants")
      .select("id")
      .eq("id", input.assistant_id)
      .maybeSingle();
    if (!assistant) throw new HttpError(404, "Assistente non trovato.");
    const { count } = await db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("assistant_id", input.assistant_id);
    if ((count ?? 0) >= 100)
      throw new HttpError(
        400,
        "Limite di 100 documenti per assistente raggiunto.",
      );
    const id = randomUUID();
    const local = isDesktop()
      ? (await import("@/lib/local/database")).localDatabase()
      : null;
    const { data, error } = await db
      .from("documents")
      .insert({
        id,
        tenant_id: tenantId,
        assistant_id: input.assistant_id,
        title: input.title,
        kind: input.kind,
        raw_text: input.kind === "text" ? input.text : null,
        storage_path:
          input.kind === "text"
            ? null
            : local
              ? local.managedPath(
                  input.assistant_id,
                  id,
                  input.title,
                  input.kind,
                )
              : `${tenantId}/${input.assistant_id}/${id}.${input.kind}`,
        byte_size: input.byte_size ?? Buffer.byteLength(input.text ?? ""),
      })
      .select("id,storage_path")
      .single();
    if (error) throw error;
    local?.syncKnowledgeFiles(input.assistant_id);
    return Response.json(data, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
