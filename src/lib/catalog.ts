export const MODELS = [
  {
    id: "ollama/qwen2.5:1.5b",
    name: "Qwen 2.5 · 1.5B",
    provider: "Ollama",
    description: "Leggero · consigliato per iniziare sul PC",
  },
  {
    id: "ollama/qwen2.5:7b",
    name: "Qwen 2.5 · 7B",
    provider: "Ollama",
    description: "Bilanciato · richiede più memoria",
  },
  {
    id: "ollama/qwen2.5:14b",
    name: "Qwen 2.5 · 14B",
    provider: "Ollama",
    description: "Avanzato · per PC con più risorse",
  },
] as const;
export type ModelId = `ollama/${string}`;
export type RuntimeModel = {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  available: boolean;
};
export const DEFAULT_MODEL = "ollama/qwen2.5:1.5b";
export const EMBEDDING_MODEL = "embeddinggemma:latest";
export const EMBEDDING_DIMENSIONS = 768;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 150_000;
export const FILE_EXTENSIONS = ["pdf", "docx", "txt", "md", "xlsx", "csv"];
export type Project = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  template_id: string | null;
  color: string;
  created_at: string;
};
export type Assistant = {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  description: string;
  instructions: string;
  model_id: ModelId | null;
  color: string;
  created_at: string;
  research?: import("./research").ResearchSettings;
};
export type DocumentRecord = {
  enabled?: boolean;
  source_url?: string;
  resolved_url?: string;
  fetched_at?: string;
  source_id?: string;
  relative_path?: string;
  id: string;
  assistant_id: string;
  title: string;
  kind: string;
  status: "queued" | "processing" | "ready" | "error";
  error: string | null;
  chunk_count: number;
  created_at: string;
  storage_path: string | null;
  byte_size: number;
  lease_until: string | null;
  embedding_model: string;
};
export type Source = {
  kind?: "document" | "website" | "web";
  url?: string;
  fetched_at?: string;
  id: string;
  document_id: string;
  title: string;
  content: string;
  similarity: number;
  position: number;
};
export type Message = {
  action_id?: string;
  action_name?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  sources: Source[];
  model_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  agent_mode?: boolean;
  agent_activity?: string;
  research_warnings?: string[];
  research_missing?: string[];
  agent_steps?: AgentStep[];
  artifacts?: AgentArtifact[];
};
export type AgentStep = {
  tool:
    | "search_documents"
    | "read_document"
    | "create_report"
    | "assess_evidence"
    | "search_websites"
    | "research_web"
    | "inspect_datasets"
    | "query_datasets"
    | "unknown";
  status: "success" | "error";
  detail: string;
};
export type AgentArtifact = { id: string; title: string; content: string };

export function isDocumentReady(
  doc: Pick<DocumentRecord, "status" | "embedding_model" | "enabled">,
  profile: string | null | undefined,
) {
  return (
    doc.enabled !== false &&
    !!profile &&
    doc.status === "ready" &&
    doc.embedding_model === profile
  );
}
export function needsReindex(
  doc: Pick<DocumentRecord, "status" | "embedding_model" | "enabled">,
  profile: string | null | undefined,
) {
  return (
    doc.status === "ready" &&
    doc.embedding_model !== "structured-v1" &&
    (!doc.embedding_model.startsWith("ollama/embeddinggemma:latest@") ||
      (!!profile && doc.embedding_model !== profile))
  );
}
