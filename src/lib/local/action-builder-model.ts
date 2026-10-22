import { ActionError } from "../actions";
import { isLocalModelId } from "../model-name";
import { ollamaStatus, requireOllama } from "../ollama";
import { LOCAL_USER_ID } from "../runtime";
import type { LocalDatabase } from "./database";

export const BUILDER_MODEL_HELP =
  "Choose an installed, available model in Actions → ellipsis menu → Models. Start Ollama if it is offline. / Scegli un modello installato e disponibile in Actions → menu con tre puntini → Models. Avvia Ollama se non è attivo.";
export function builderModelId(db: LocalDatabase): string | null {
  const id = db.get("workspaces", LOCAL_USER_ID)?.action_builder_model_id;
  return typeof id === "string" && isLocalModelId(id) ? id : null;
}
export async function requireBuilderModel(
  db: LocalDatabase,
  request: typeof fetch = fetch,
) {
  const id = builderModelId(db);
  if (!id) throw new ActionError(503, BUILDER_MODEL_HELP);
  try {
    await requireOllama(id, request);
  } catch {
    throw new ActionError(503, BUILDER_MODEL_HELP);
  }
  return id;
}
export async function setBuilderModel(
  db: LocalDatabase,
  id: string | null,
  request: typeof fetch = fetch,
) {
  if (id !== null) {
    if (!isLocalModelId(id)) throw new ActionError(400, BUILDER_MODEL_HELP);
    try {
      await requireOllama(id, request);
    } catch {
      throw new ActionError(503, BUILDER_MODEL_HELP);
    }
  }
  db.transaction(() => {
    const workspace = db.get("workspaces", LOCAL_USER_ID)!;
    db.put("workspaces", { ...workspace, action_builder_model_id: id }, true);
  });
}
export async function builderModelStatus(
  db: LocalDatabase,
  request: typeof fetch = fetch,
) {
  const runtime = await ollamaStatus(request);
  const modelId = builderModelId(db);
  let ready = false;
  if (modelId && runtime.models.some((m) => m.id === modelId && m.available)) {
    try {
      await requireOllama(modelId, request);
      ready = true;
    } catch {}
  }
  return {
    modelId,
    models: runtime.models.filter((m) => m.available),
    connected: runtime.connected,
    ready,
    message: ready ? "" : BUILDER_MODEL_HELP,
  };
}
