import { researchSettingsSchema } from "../research";
import { researchTerms } from "../research-policy";
import { embedLocal } from "../ollama";
import type { Source } from "../catalog";
import type { LocalDatabase } from "./database";
import { runResearchWorkflow, type ResearchResult } from "./research-workflow";

type Options = {
  db: LocalDatabase;
  assistantId: string;
  modelId: string;
  question: string;
  embeddingProfile: string | null;
  signal: AbortSignal;
  language?: "en" | "it";
  emit: Parameters<typeof runResearchWorkflow>[0]["emit"];
  conversationId?: string;
};
export async function retrieveAssistantSources(
  options: Options,
): Promise<Source[]> {
  const docs = new Map(
    options.db
      .rows("documents")
      .filter(
        (d) =>
          d.assistant_id === options.assistantId &&
          d.status === "ready" &&
          d.enabled !== false,
      )
      .map((d) => [d.id, d]),
  );
  let sources: Source[] = [];
  if (
    options.embeddingProfile &&
    [...docs.values()].some(
      (d) => d.embedding_model === options.embeddingProfile,
    )
  ) {
    try {
      const context = {
        assistantId: options.assistantId,
        projectId: options.db.get("assistants", options.assistantId)
          ?.project_id,
        conversationId: options.conversationId,
      };
      const request: typeof fetch = (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            options.signal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
      const [embedding] = await embedLocal(
        [options.question],
        "query",
        options.embeddingProfile,
        request,
        context,
      );
      options.signal.throwIfAborted();
      const result = await options.db.rpc("match_documents_local", {
        target_profile: options.embeddingProfile,
        query_embedding: embedding,
        target_assistant: options.assistantId,
        match_count: 3,
        match_threshold: 0.25,
      });
      if (result.error) throw result.error;
      sources = (result.data ?? []) as Source[];
    } catch {
      options.signal.throwIfAborted();
    }
  }
  // Deterministic fallback when embeddings are unavailable, without external inference.
  if (!sources.length) {
    const terms = researchTerms(options.question);
    sources = options.db
      .rows("document_chunks")
      .filter(
        (c) =>
          c.assistant_id === options.assistantId && docs.has(c.document_id),
      )
      .map((c) => ({
        c,
        score: terms.filter((w) =>
          `${docs.get(c.document_id)!.title} ${c.content}`
            .toLowerCase()
            .includes(w),
        ).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
      .slice(0, 3)
      .map(({ c, score }) => ({
        id: c.id,
        document_id: c.document_id,
        title: docs.get(c.document_id)!.title,
        content: c.content,
        position: c.position,
        similarity: score / Math.max(1, terms.length),
        ...(docs.get(c.document_id)!.source_url
          ? {
              kind: "website" as const,
              url: docs.get(c.document_id)!.source_url,
              fetched_at: docs.get(c.document_id)!.fetched_at,
            }
          : { kind: "document" as const }),
      }));
  }
  return sources.map((s) => ({ ...s, content: s.content.slice(0, 1600) }));
}
export async function prepareAssistantResearch(
  options: Options,
): Promise<ResearchResult> {
  const sources = await retrieveAssistantSources(options);
  options.emit({ type: "sources", sources });
  return runResearchWorkflow({
    ...options,
    sources,
    settings: researchSettingsSchema.parse(
      options.db.get("assistants", options.assistantId)?.research ?? {},
    ),
  });
}
export function researchLimitations(result: ResearchResult) {
  return `\nSource workflow completed. Use numbered citations for the supplied sources. Do not claim evidence was verified merely because routing found matching terms. Explain these limitations: ${JSON.stringify({ warnings: result.warnings.slice(0, 6).map((value) => value.slice(0, 160)), missing: result.missing.slice(0, 6).map((value) => value.slice(0, 160)) })}`;
}
