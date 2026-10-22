import { publicWebURL } from "../research";
import { LOCAL_USER_ID } from "../runtime";
import type { LocalDatabase } from "./database";
import { readPublicPage } from "./public-web";

export class WebKnowledgeError extends Error {}

// Store a readable snapshot as a normal document, so all chat modes use the
// same indexing, isolation, deletion and citation pipeline (including offline).
export async function saveWebKnowledge(
  db: LocalDatabase,
  assistantId: string,
  input: { url?: string; documentId?: string },
  read = readPublicPage,
) {
  db.assistantDirectory(assistantId);
  const previous = input.documentId
    ? db.get("documents", input.documentId)
    : null;
  if (
    input.documentId &&
    (!previous?.source_url || previous.assistant_id !== assistantId)
  )
    throw new WebKnowledgeError("Web source not found for this assistant.");
  let url: string;
  try {
    url = publicWebURL(previous?.source_url ?? input.url ?? "").href;
  } catch {
    throw new WebKnowledgeError(
      "Enter a public HTTP or HTTPS URI without credentials.",
    );
  }
  const page = await read(url, AbortSignal.timeout(25_000));
  const result = db.transaction(() => {
    db.assistantDirectory(assistantId); // The assistant may have been deleted during the request.
    const current = previous ? db.get("documents", previous.id) : null;
    if (previous && !current)
      throw new WebKnowledgeError(
        "Web source was removed. Add it again to import it.",
      );
    if (current?.lease_until && current.lease_until > new Date().toISOString())
      throw new WebKnowledgeError(
        "This source is being indexed. Wait before refreshing it.",
      );
    const docs = db
      .rows("documents")
      .filter((d) => d.assistant_id === assistantId);
    if (
      docs.some(
        (d) =>
          d.id !== current?.id &&
          (d.source_url === url || d.resolved_url === page.url),
      )
    )
      throw new WebKnowledgeError(
        "This URI is already in this assistant’s knowledge.",
      );
    if (!current && docs.length >= 100)
      throw new WebKnowledgeError("The limit is 100 sources per assistant.");
    if (current)
      db.sql
        .prepare("DELETE FROM document_chunks WHERE document_id=?")
        .run(current.id);
    return db.put(
      "documents",
      {
        ...(current ?? {}),
        tenant_id: LOCAL_USER_ID,
        assistant_id: assistantId,
        title: page.title.slice(0, 180),
        kind: "text",
        source_url: url,
        resolved_url: page.url,
        fetched_at: page.fetchedAt,
        raw_text: page.content,
        byte_size: Buffer.byteLength(page.content),
        storage_path: null,
        status: "queued",
        error: null,
        chunk_count: 0,
        embedding_model: "pending-local",
        lease_token: null,
        lease_until: null,
      },
      !!current,
    );
  });
  db.syncKnowledgeFiles(assistantId);
  return { id: result.id, title: result.title, source_url: result.source_url };
}

// URLs are durable even when this computer is offline. No fetched content travels.
export function registerWebSource(
  db: LocalDatabase,
  assistantId: string,
  raw: string,
) {
  db.assistantDirectory(assistantId);
  let url: string;
  try {
    url = publicWebURL(raw).href;
  } catch {
    throw new WebKnowledgeError(
      "Enter a public HTTP or HTTPS URI without credentials.",
    );
  }
  const docs = db
    .rows("documents")
    .filter((d) => d.assistant_id === assistantId);
  if (docs.some((d) => d.source_url === url))
    throw new WebKnowledgeError(
      "This URI is already in this assistant’s knowledge.",
    );
  if (docs.length >= 100)
    throw new WebKnowledgeError("The limit is 100 sources per assistant.");
  return db.put("documents", {
    tenant_id: LOCAL_USER_ID,
    assistant_id: assistantId,
    title: new URL(url).hostname,
    kind: "text",
    source_url: url,
    raw_text: null,
    enabled: true,
    byte_size: 0,
  });
}

export function setWebSourceEnabled(
  db: LocalDatabase,
  assistantId: string,
  id: string,
  enabled: boolean,
) {
  const doc = db.get("documents", id);
  if (!doc?.source_url || doc.assistant_id !== assistantId)
    throw new WebKnowledgeError("Web source not found for this assistant.");
  const updated = db.put("documents", { ...doc, enabled }, true);
  db.syncKnowledgeFiles(assistantId);
  return updated;
}
