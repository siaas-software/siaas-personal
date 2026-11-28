import {
  runNativeOperation,
  type ToolTrace,
} from "../local/native-permissions";
import { requestsDatasetCalculation } from "../local/chat-router";
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
  trace?: ToolTrace;
  assistantId: string;
  modelId: string;
  question: string;
  instructions: string;
  embeddingProfile: string | null;
  signal: AbortSignal;
  emit: (text: string) => void;
  request?: typeof fetch;
  onUsage?: (input: number | null, output: number | null) => void;
}) {
  if (
    isGeneralRequest(options.question) ||
    !datasets(options.db, options.assistantId).length
  ) {
    if (!requestsDatasetCalculation(options.question)) return null;
    const content =
      "No available dataset for this calculation. Check the file and its mapping.";
    options.emit(content);
    return { content, sources: [], result: null };
  }
  let planning;
  try {
    planning = await runNativeOperation(
      options.db,
      options.assistantId,
      options.trace,
      options.signal,
      "plan_dataset_query",
      { question: options.question, model: options.modelId },
      async (revalidate) => {
        const plan = await planQuestion(
          options.db,
          options.assistantId,
          options.modelId,
          options.question,
          options.signal,
          options.request,
          options.onUsage,
        );
        revalidate();
        return plan;
      },
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
  if (planning.status === "narrative") {
    if (!requestsDatasetCalculation(options.question)) return null;
    const content =
      "Specify the dataset, column and operation. No calculation was executed.";
    options.emit(content);
    return { content, sources: [], result: null };
  }
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
  // Planning can await a slow model. Check current policy again before executing its plan.
  let result;
  try {
    const plan = planning.plan;
    result = await runNativeOperation(
      options.db,
      options.assistantId,
      options.trace,
      options.signal,
      "query_datasets",
      { plan },
      () => queryStructured(options.db, options.assistantId, plan),
    );
  } catch (e) {
    const content =
      e instanceof AnalysisError
        ? e.message
        : "Invalid analytical plan. No result was produced.";
    options.emit(content);
    return { content, sources: [], result: null };
  }
  let content = analysisMarkdown(result, false);
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
