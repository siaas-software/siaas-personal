import { ActionError, type ActionSkill } from "../actions";
import type { LocalDatabase } from "./database";

/**
 * Native Actions are fixed application capabilities, not user-supplied code.
 * Every execution is scoped to the assistant already chosen by the chat.
 */
export function executeNativeAction(
  db: LocalDatabase,
  assistantId: string,
  action: ActionSkill,
  signal: AbortSignal,
): { content: string; sources: []; result: null } {
  signal.throwIfAborted();
  const assistant = db.get("assistants", assistantId);
  if (!assistant)
    throw new ActionError(404, "Assistente non trovato.");
  // Never trust a persisted/custom Action to declare executable capabilities.
  if (
    action.kind !== "builtin" ||
    action.id !== "builtin:list-sources" ||
    action.execution !== "native" ||
    action.capability !== "list_assistant_sources"
  )
    throw new ActionError(403, "Capacità applicativa non autorizzata.");
  const documents = db.rows("documents")
    .filter((d) =>
      d.tenant_id === assistant.tenant_id &&
      d.assistant_id === assistantId &&
      d.enabled !== false &&
      d.status === "ready",
    )
    .sort((a, b) =>
      String(a.title ?? "").localeCompare(String(b.title ?? "")) ||
      String(a.id).localeCompare(String(b.id)),
    );
  signal.throwIfAborted();
  const visible = documents.slice(0, 50);
  const entries = visible.map((document) => {
    const name = String(document.title ?? "Documento senza titolo")
      .slice(0, 180)
      .replace(/[\\`\r\n]/g, " ");
    return `- ${name}`;
  });
  const content = visible.length
    ? [
        "Fonti indicizzate, abilitate e pronte per questo assistente:",
        ...entries,
        ...(documents.length > visible.length ? ["- (altre fonti non visualizzate)"] : []),
      ].join("\n")
    : "Questo assistente non ha fonti indicizzate, abilitate e pronte.";
  return { content, sources: [], result: null };
}
