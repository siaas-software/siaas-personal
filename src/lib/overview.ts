import { canonicalModelName } from "./model-name";

export type InferenceContext = {
  assistantId?: string;
  projectId?: string;
  conversationId?: string;
};
export type InferenceRecord = InferenceContext & {
  id: string;
  model: string;
  kind: "chat" | "embedding";
  status:
    | "loading"
    | "generating"
    | "complete"
    | "error"
    | "cancelled"
    | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  loadMs: number | null;
  error: string | null;
};
export type SystemResources = {
  sampledAt: string;
  cpuPercent: number | null;
  cpuName: string;
  ramUsed: number;
  ramTotal: number;
  gpus: {
    name: string;
    utilization: number | null;
    memoryUsed: number | null;
    memoryTotal: number | null;
    temperature: number | null;
    power: number | null;
  }[];
  cpuTemperature: number | null;
  disks: {
    name: string;
    readBytesPerSecond: number;
    writeBytesPerSecond: number;
  }[];
};
export type ModelState =
  "installed" | "loaded" | "loading" | "in-use" | "error" | "unknown";
export type OverviewModel = {
  name: string;
  size: number | null;
  digest: string | null;
  details: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    format?: string;
  };
  state: ModelState;
  loaded: boolean | null;
  memory: number | null;
  vram: number | null;
  contextLength: number | null;
  assistants: { id: string; name: string; projectId: string }[];
  projects: { id: string; name: string }[];
  active: InferenceRecord[];
  recent: InferenceRecord[];
};
export type OverviewSnapshot = {
  checkedAt: string;
  modelsUpdatedAt: string | null;
  loadedUpdatedAt: string | null;
  connected: boolean;
  models: OverviewModel[];
  loadedCount: number | null;
  activeCount: number;
  embeddingCount: number;
  resources: SystemResources | null;
  warnings: string[];
  historyAvailable: boolean;
};
export const isActiveInference = (record: InferenceRecord) =>
  record.status === "loading" || record.status === "generating";
export const modelKey = (name: string) =>
  canonicalModelName(name.replace(/^ollama\//, ""));
export function modelState(
  loaded: boolean | null,
  active: InferenceRecord[],
  recent: InferenceRecord[],
): ModelState {
  if (active.some((r) => r.status === "generating")) return "in-use";
  if (active.length) return "loading";
  if (recent[0]?.status === "error") return "error";
  return loaded === null ? "unknown" : loaded ? "loaded" : "installed";
}
