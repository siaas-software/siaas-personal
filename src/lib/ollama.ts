import { z } from "zod";
import { isDesktop } from "./runtime";
import type { InferenceContext } from "./overview";
import { agentEligibility, type AgentEligibility } from "./agent-policy";
import {
  isLocalModelId,
  isLocalModelName,
  canonicalModelName,
} from "./model-name";
import {
  MODELS,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type RuntimeModel,
} from "./catalog";

export class OllamaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Only the server on this computer is allowed. No cloud endpoint, redirects or
// user-supplied model identifiers can silently turn this into paid inference.
export function ollamaURL(
  value = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new OllamaError(
      503,
      "OLLAMA_BASE_URL deve indicare Ollama su questo PC, ad esempio http://127.0.0.1:11434.",
    );
  }
  return url.origin;
}
export function isOnlinePreview() {
  return process.env.VERCEL === "1" || process.env.SIAAS_RUNTIME === "preview";
}
const PREVIEW_MESSAGE =
  "Demo personale online: assistenti, documenti e preventivo disponibili. Addestramento e chat online · Coming soon.";
function requireLocalRuntime() {
  if (isOnlinePreview()) throw new OllamaError(503, PREVIEW_MESSAGE);
}
export type OllamaRuntime = {
  mode: "local" | "preview";
  connected: boolean;
  embeddingReady: boolean;
  embeddingProfile: string | null;
  message: string;
  models: RuntimeModel[];
};
const tagsSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        digest: z.string(),
        remote_model: z.string().nullish(),
        remote_host: z.string().nullish(),
      }),
    )
    .max(10000),
});
export async function ollamaStatus(
  request: typeof fetch = fetch,
): Promise<OllamaRuntime> {
  if (isOnlinePreview())
    return {
      mode: "preview",
      connected: false,
      embeddingReady: false,
      embeddingProfile: null,
      message: PREVIEW_MESSAGE,
      models: MODELS.map((m) => ({ ...m, available: false })),
    };
  try {
    const res = await request(ollamaURL() + "/api/tags", {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error("Unavailable");
    const { models } = tagsSchema.parse(await res.json());
    const embedding = models.find((m) => m.name === EMBEDDING_MODEL);
    const digest = embedding?.digest.replace(/^sha256:/, "");
    const profile =
      digest && /^[a-f0-9]{64}$/.test(digest)
        ? `ollama/${EMBEDDING_MODEL}@${digest}:retrieval-v1`
        : null;
    return {
      mode: "local",
      connected: true,
      embeddingReady: !!profile,
      embeddingProfile: profile,
      message: profile
        ? "Ollama connected. Select an installed model for chat."
        : `Install the document model: ollama pull ${EMBEDDING_MODEL}`,
      models: [
        ...MODELS.map((m) => ({
          ...m,
          available: models.some(
            (installed) =>
              canonicalModelName(installed.name) === m.id.slice(7) &&
              !installed.remote_model &&
              !installed.remote_host,
          ),
        })),
        ...models
          .filter(
            (m) =>
              isLocalModelName(m.name) &&
              !m.remote_model &&
              !m.remote_host &&
              !/embed|bge-|all-minilm|rerank/i.test(m.name) &&
              !MODELS.some(
                (known) => known.id.slice(7) === canonicalModelName(m.name),
              ),
          )
          .map((m): RuntimeModel => ({
            id: `ollama/${canonicalModelName(m.name)}`,
            name: m.name,
            provider: "Ollama",
            description: "Installed on this PC",
            available: true,
          })),
      ],
    };
  } catch (error) {
    return {
      mode: "local",
      connected: false,
      embeddingReady: false,
      embeddingProfile: null,
      message:
        error instanceof OllamaError
          ? error.message
          : "Ollama is unreachable. Start Ollama on this PC and select Check Ollama.",
      models: MODELS.map((m) => ({ ...m, available: false })),
    };
  }
}
export function requireOllama(modelId: string, request?: typeof fetch): Promise<OllamaRuntime & { agent: AgentEligibility }>;
export function requireOllama(modelId?: undefined, request?: typeof fetch): Promise<OllamaRuntime & { embeddingProfile: string }>;
export async function requireOllama(
  modelId?: string,
  request: typeof fetch = fetch,
): Promise<OllamaRuntime & { agent?: AgentEligibility }> {
  requireLocalRuntime();
  if (modelId && !isLocalModelId(modelId))
    throw new OllamaError(
      400,
      "Select an Ollama model in assistant settings.",
    );
  const runtime = await ollamaStatus(request);
  if (!runtime.connected || (!modelId && !runtime.embeddingProfile))
    throw new OllamaError(503, runtime.message);
  if (modelId && !runtime.models.find((m) => m.id === modelId)?.available)
    throw new OllamaError(
      503,
      `Modello non installato. Esegui: ollama pull ${modelId.slice(7)}`,
    );
  const agent = modelId ? await verifyLocalChatModel(modelId, request) : undefined;
  return { ...runtime, agent };
}
export async function embedLocal(
  values: string[],
  purpose: "query" | "document",
  profile: string,
  request: typeof fetch = fetch,
  context: InferenceContext = {},
): Promise<number[][]> {
  requireLocalRuntime();
  if (values.length > 8) {
    const vectors: number[][] = [];
    for (let start = 0; start < values.length; start += 8)
      vectors.push(
        ...(await embedLocal(
          values.slice(start, start + 8),
          purpose,
          profile,
          request,
          context,
        )),
      );
    return vectors;
  }
  const input = values.map((value) =>
    purpose === "query"
      ? `task: search result | query: ${value}`
      : `title: none | text: ${value}`,
  );
  try {
    const send = isDesktop()
      ? (await import("./local/inference-telemetry")).monitoredFetch(context, request)
      : request;
    const response = await send(ollamaURL() + "/api/embed", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(purpose === "query" ? 60_000 : 180_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
        truncate: false,
        dimensions: EMBEDDING_DIMENSIONS,
        keep_alive: 0,
      }),
    });
    if (!response.ok)
      throw new OllamaError(
        502,
        "Ollama could not process the text: check the model, available memory and chunk size.",
      );
    const { embeddings } = z
      .object({
        embeddings: z
          .array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS))
          .length(values.length),
      })
      .parse(await response.json());
    if (embeddings.some((e) => !e.some((v) => v !== 0)))
      throw new Error("Zero embedding");
    const current = await requireOllama(undefined, request);
    if (current.embeddingProfile !== profile)
      throw new OllamaError(
        409,
        "The embedding model has changed. Check Ollama and reindex your sources.",
      );
    return embeddings;
  } catch (error) {
    if (error instanceof OllamaError) throw error;
    throw new OllamaError(
      502,
      "Local embedding failed or timed out. Check Ollama and retry.",
    );
  }
}
export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
const streamEvent = z.object({
  error: z.string().optional(),
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});
export async function* streamLocal(
  modelId: string,
  messages: OllamaMessage[],
  request: typeof fetch = fetch,
  context: InferenceContext = {},
) {
  requireLocalRuntime();
  if (!isLocalModelId(modelId))
    throw new OllamaError(400, "Invalid local model.");
  const send = isDesktop()
    ? (await import("./local/inference-telemetry")).monitoredFetch(context, request)
    : request;
  const response = await send(ollamaURL() + "/api/chat", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId.slice(7),
      messages,
      stream: true,
      think: false,
      keep_alive: 0,
      options: { num_ctx: 4096, num_predict: 768, temperature: 0.2 },
    }),
  });
  if (!response.ok || !response.body)
    throw new OllamaError(
      502,
      "Ollama did not start a response. Check the model and available memory.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    for (;;) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      if (buffer.length > 1_000_000) throw new Error("Oversized stream event");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (part.done && buffer.trim()) {
        lines.push(buffer);
        buffer = "";
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = streamEvent.parse(JSON.parse(line));
        if (event.error)
          throw new OllamaError(
            502,
            "Ollama interrupted the response. Check memory and retry.",
          );
        if (event.message?.content)
          yield { type: "delta" as const, text: event.message.content };
        if (event.done) {
          completed = true;
          yield {
            type: "done" as const,
            inputTokens: event.prompt_eval_count ?? 0,
            outputTokens: event.eval_count ?? 0,
          };
          return;
        }
      }
      if (part.done) break;
    }
    if (!completed)
      throw new OllamaError(
        502,
        "Connection to Ollama interrupted before completion.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// /api/show also rejects local aliases that point at cloud models.
export async function verifyLocalChatModel(
  modelId: string,
  request: typeof fetch = fetch,
) {
  requireLocalRuntime();
  if (!isLocalModelId(modelId))
    throw new OllamaError(400, "Invalid local model.");
  const endpoint = ollamaURL() + "/api/show";
  let res: Response;
  try {
    res = await request(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId.slice(7) }),
    });
  } catch {
    throw new OllamaError(
      503,
      "Ollama is unreachable. Start Ollama on this PC and retry.",
    );
  }
  if (res.status >= 500)
    throw new OllamaError(
      503,
      "Ollama is unavailable. Check the service and retry.",
    );
  if (!res.ok)
    throw new OllamaError(400, "Install the selected model in Ollama first.");
  let info;
  try {
    info = await res.json();
    if (!info || typeof info !== "object") throw new Error("Invalid metadata");
  } catch {
    throw new OllamaError(
      502,
      "Ollama returned invalid model information. Check the service and retry.",
    );
  }
  if (
    info.remote_model ||
    info.remote_host ||
    !Array.isArray(info.capabilities) ||
    !info.capabilities.includes("completion")
  )
    throw new OllamaError(
      400,
      "Choose a local chat model, not a cloud or embedding model.",
    );
  return agentEligibility(info);
}
