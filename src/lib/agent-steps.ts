import type { AgentStep } from "./catalog";

export function agentToolLabel(tool: AgentStep["tool"], italian = false) {
  const labels = {
    search_documents: ["Document search", "Ricerca nei documenti"],
    read_document: ["Read document", "Lettura documento"],
    create_report: ["Create report", "Creazione report"],
    assess_evidence: ["Evidence Evaluation", "Valutazione delle fonti"],
    search_websites: ["Selected Websites", "Siti selezionati"],
    research_web: ["Advanced Web Research", "Ricerca web avanzata"],
    inspect_datasets: ["Dataset schemas", "Schemi dataset"],
    query_datasets: ["Structured calculation", "Calcolo strutturato"],
    unknown: ["Tool", "Strumento"],
  };
  return labels[tool][italian ? 1 : 0];
}

// Store summaries locally, never raw arguments, model errors or document contents.
export function summarizeAgentTool(
  name: string | undefined,
  content: unknown,
  status?: string,
): AgentStep {
  const tool: AgentStep["tool"] =
    name === "search_documents" ||
    name === "read_document" ||
    name === "create_report" ||
    name === "inspect_datasets" ||
    name === "query_datasets"
      ? name
      : "unknown";
  let result: Record<string, unknown> = {};
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      result = parsed;
  } catch {
    /* Framework validation errors are not JSON. */
  }
  if (status === "error" || result.error) {
    const known: Record<string, string> = {
      document_not_found:
        "Document reference not found in this assistant’s sources.",
      empty_document_range: "No passages in the requested range.",
      report_limit: "Report limit reached for this response.",
    };
    return {
      tool,
      status: "error",
      detail:
        typeof result.code === "string" && Object.hasOwn(known, result.code)
          ? known[result.code]
          : "Call failed: invalid parameters or unavailable tool.",
    };
  }
  const detail =
    tool === "search_documents"
      ? `${Array.isArray(result.matches) ? result.matches.length : 0} passages found; ${Array.isArray(result.documents) ? result.documents.length : 0} documents in catalog.`
      : tool === "read_document"
        ? `${Array.isArray(result.chunks) ? result.chunks.length : 0} passages read.`
        : tool === "create_report" && result.saved === true
          ? "Report saved and ready to download."
          : "Operation completed.";
  return { tool, status: "success", detail };
}
