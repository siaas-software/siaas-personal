import type { LocalDatabase } from "../local/database";
import { retrieveAssistantSources } from "../local/assistant-research";
import { isGeneralRequest } from "./routing";
import { planningCatalog } from "./planner";
import { datasets } from "./store";
import { planQuestion } from "./planner";
import { queryStructured, analysisMarkdown } from "./service";
import { AnalysisError } from "./types";
export async function structuredChat(options: {
  db: LocalDatabase;
  assistantId: string;
  modelId: string;
  question: string;
  instructions: string;
  embeddingProfile: string | null;
  signal: AbortSignal;
  emit: (text: string) => void;
  request?: typeof fetch;
}) {
  if (
    isGeneralRequest(options.question) ||
    !datasets(options.db, options.assistantId).length
  )
    return null;
  let planning;
  try {
    planning = await planQuestion(
      options.db,
      options.assistantId,
      options.modelId,
      options.question,
      options.signal,
      options.request,
    );
  } catch (e) {
    options.signal.throwIfAborted();
    const content =
      e instanceof AnalysisError
        ? e.message
        : "Structured planning unavailable. No calculation was executed.";
    options.emit(content);
    return { content, sources: [], result: null };
  }
  if (planning.status === "narrative") return null;
  if (planning.status === "clarify") {
    // Model-authored explanations can falsely deny real columns/values. Show
    // authoritative schema facts instead of presenting those claims as evidence.
    const catalog = planningCatalog(options.db, options.assistantId);
    const fields = catalog.datasets
      .map(
        (d) =>
          `${d.filename} / ${d.worksheet}: ${d.columns.map((c) => c.name).join(", ")}`,
      )
      .join("; ");
    const content = `The local model could not resolve this request into a supported calculation. No calculation was executed. Specify the dataset, filters and operation, or use Advanced Settings. Available columns: ${fields}`;
    options.emit(content);
    return { content, sources: [], result: null };
  }
  let result;
  try {
    result = queryStructured(options.db, options.assistantId, planning.plan);
  } catch (e) {
    const content =
      e instanceof AnalysisError
        ? e.message
        : "Invalid analytical plan. No result was produced.";
    options.emit(content);
    return { content, sources: [], result: null };
  }
  let content = analysisMarkdown(result);
  options.emit(content);
  // Descriptive evidence stays separate from verified calculations. An
  // unconstrained second model answer cannot revise or contradict the results.
  let sources: Awaited<ReturnType<typeof retrieveAssistantSources>> = [];
  try {
    sources = await retrieveAssistantSources({ ...options, emit: () => {} });
    if (sources.length) {
      const excerpts =
        "\n\n### Related document excerpts\n\n" +
        sources
          .map(
            (s, i) =>
              `[${i + 1}] ${s.title.replace(/[<>\r\n]/g, " ")}\n\n> ${s.content.slice(0, 1600).replace(/[<>]/g, "").replace(/\n/g, "\n> ")}`,
          )
          .join("\n\n");
      content += excerpts;
      options.emit(excerpts);
    }
  } catch {
    options.signal.throwIfAborted();
    const note =
      "\n\nRelated document retrieval unavailable; the computed result remains valid.";
    content += note;
    options.emit(note);
  }
  return { content, sources, result };
}
