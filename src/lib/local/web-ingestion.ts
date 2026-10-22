import type { LocalDatabase } from "./database";
import { saveWebKnowledge } from "./web-knowledge";
import { requireOllama, embedLocal } from "../ollama";
import { readPublicPage } from "./public-web";
import { chunkText } from "../chunk";

type Dependencies = {
  read?: typeof readPublicPage;
  runtime?: () => Promise<{ embeddingProfile: string }>;
  embed?: typeof embedLocal;
};
const running = new Map<string, Promise<{ status: string; error?: string }>>();

// Shared by automatic template ingestion and explicit retry/refresh. Repeated
// requests for the same source join the current task instead of duplicating it.
export function processWebSource(
  db: LocalDatabase,
  id: string,
  refresh = false,
  dependencies: Dependencies = {},
) {
  const key = `${db.directory}:${id}`;
  const active = running.get(key);
  if (active) return active;
  const job = processSource(db, id, refresh, dependencies).finally(() =>
    running.delete(key),
  );
  running.set(key, job);
  return job;
}

async function processSource(
  db: LocalDatabase,
  id: string,
  refresh: boolean,
  dependencies: Dependencies,
) {
  let doc = db.get("documents", id);
  if (!doc?.source_url) return { status: "removed" };
  if (doc.enabled === false) return { status: doc.status };
  try {
    if (refresh || !doc.fetched_at) {
      await saveWebKnowledge(
        db,
        doc.assistant_id,
        { documentId: id },
        dependencies.read,
      );
      doc = db.get("documents", id);
    }
  } catch {
    const current = db.get("documents", id);
    const error =
      "Page unavailable. Check your connection or the website, then retry. Only readable public HTML and text pages are supported.";
    if (current) {
      db.put("documents", { ...current, error }, true);
      db.syncKnowledgeFiles(current.assistant_id);
    }
    return { status: current?.status ?? "removed", error };
  }
  if (!doc || doc.enabled === false)
    return { status: doc?.status ?? "removed" };
  let runtime: { embeddingProfile: string };
  try {
    const available = await (dependencies.runtime ?? requireOllama)();
    if (!available.embeddingProfile)
      throw new Error("Embedding model unavailable.");
    runtime = { embeddingProfile: available.embeddingProfile };
  } catch {
    const error =
      "Waiting for the local document model. Start Ollama and configure the embedding model, then retry.";
    const current = db.get("documents", id);
    if (current) {
      db.put("documents", { ...current, error }, true);
      db.syncKnowledgeFiles(current.assistant_id);
    }
    return { status: "queued", error };
  }
  if (
    doc.status === "ready" &&
    doc.embedding_model === runtime.embeddingProfile
  )
    return { status: "ready" };
  const claim = await db.rpc("claim_document_local", {
    target_profile: runtime.embeddingProfile,
    target_document: id,
  });
  if (claim.error) throw claim.error;
  if (!claim.data)
    return { status: db.get("documents", id)?.status ?? "removed" };
  try {
    const chunks = chunkText(doc.raw_text ?? "");
    const vectors = await (dependencies.embed ?? embedLocal)(
      chunks,
      "document",
      runtime.embeddingProfile,
      fetch,
      { assistantId: doc.assistant_id },
    );
    const result = await db.rpc("complete_document_local", {
      target_profile: runtime.embeddingProfile,
      target_document: id,
      token: claim.data,
      chunks: chunks.map((content, i) => ({ content, embedding: vectors[i] })),
    });
    if (result.error) throw result.error;
    return { status: "ready" };
  } catch {
    const current = db.get("documents", id);
    const error = "Indexing failed. Check the local document model and retry.";
    if (current && current.lease_token === claim.data) {
      db.put(
        "documents",
        {
          ...current,
          status: "error",
          error,
          lease_token: null,
          lease_until: null,
        },
        true,
      );
      db.syncKnowledgeFiles(current.assistant_id);
    }
    return { status: current ? "error" : "removed", error };
  }
}

export async function processTemplateSources(db: LocalDatabase, ids: string[]) {
  // Bound parallel downloads and embedding work, including templates with many sources.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          await processWebSource(db, id);
        } catch {
          console.warn(
            "A template source could not be indexed; retry from Knowledge.",
          );
        }
      }
    }),
  );
}
