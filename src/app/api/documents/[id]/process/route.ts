import { isDesktop } from "@/lib/runtime";
import { localWorkspace, fail, HttpError, uuid } from "@/lib/http";
import { requireOllama, embedLocal, OllamaError } from "@/lib/ollama";
import { chunkText } from "@/lib/chunk";
import { extractDocument } from "@/lib/ingestion";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await localWorkspace(req);
    const id = uuid.parse((await params).id);
    const { data: doc, error } = await db
      .from("documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new HttpError(404, "Documento non trovato.");
    if (isDesktop() && doc.source_url) {
      const { localDatabase } = await import("@/lib/local/database");
      const { processWebSource } = await import("@/lib/local/web-ingestion");
      const result = await processWebSource(localDatabase(), id);
      return Response.json(result, {
        status: result.status === "ready" ? 200 : 202,
      });
    }
    if (["xlsx", "csv"].includes(doc.kind)) {
      const { importStructured } = await import("@/lib/structured/store");
      return Response.json(await importStructured(db, id));
    }
    const runtime = await requireOllama();
    if (
      doc.status === "ready" &&
      doc.embedding_model === runtime.embeddingProfile
    )
      return Response.json({ ok: true });
    const { data: token, error: claimError } = await db.rpc(
      "claim_document_local",
      {
        target_profile: runtime.embeddingProfile,
        target_document: id,
      },
    );
    if (claimError) throw claimError;
    if (!token)
      throw new HttpError(
        409,
        "Elaborazione già in corso. Riprova tra qualche minuto.",
      );
    try {
      let text = doc.raw_text ?? "";
      if (isDesktop() && doc.source_id) {
        const { localDatabase } = await import("@/lib/local/database");
        const { readLinkedDocument } = await import("@/lib/local/knowledge");
        text = await extractDocument(
          new Blob([readLinkedDocument(localDatabase(), doc)]),
          doc.kind,
        );
      } else if (doc.storage_path) {
        const { data: file, error: e } = await db.storage
          .from("documents")
          .download(doc.storage_path);
        if (e || !file)
          throw new Error(
            "Importazione del file incompleta. Rimuovi il documento e importalo nuovamente.",
          );
        text = await extractDocument(file, doc.kind);
      }
      const chunks = chunkText(text);
      const embeddings = await embedLocal(
        chunks,
        "document",
        runtime.embeddingProfile,
        fetch,
        { assistantId: doc.assistant_id },
      );
      const { error: e } = await db.rpc("complete_document_local", {
        target_profile: runtime.embeddingProfile,
        target_document: id,
        token,
        chunks: chunks.map((content, i) => ({
          content,
          embedding: embeddings[i],
        })),
      });
      if (e) throw e;
      return Response.json({ ok: true, chunks: chunks.length });
    } catch (error) {
      const safe =
        error instanceof OllamaError ||
        (error instanceof Error &&
          /documento|file|OCR|caratteri|PDF|DOCX/i.test(error.message))
          ? error.message
          : "Elaborazione non riuscita. Verifica il servizio AI e riprova.";
      await db
        .from("documents")
        .update({
          status: "error",
          error: safe,
          lease_token: null,
          lease_until: null,
        })
        .eq("id", id)
        .eq("lease_token", token);
      throw new HttpError(422, safe);
    }
  } catch (error) {
    return fail(error);
  }
}
