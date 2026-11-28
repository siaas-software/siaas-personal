import { runNativeOperation, type ToolTrace } from "./native-permissions";
import { ActionError, type ActionSkill } from "../actions";
import type { LocalDatabase } from "./database";

/**
 * Native Actions are fixed application capabilities, not user-supplied code.
 * Every execution is scoped to the assistant already chosen by the chat.
 */
export async function executeNativeAction(
  db: LocalDatabase,
  assistantId: string,
  action: ActionSkill,
  signal: AbortSignal,
  trace?: ToolTrace,
  question?:string,
): Promise<{ content: string; sources: []; result: null }> {
  signal.throwIfAborted();
  const assistant = db.get("assistants", assistantId);
  if (!assistant) throw new ActionError(404, "Assistente non trovato.");
  if (action.kind==="builtin" && action.id==="builtin:media" && action.execution==="native" && action.capability==="process_assistant_media"){
    if(!trace || !question) throw new ActionError(400,"A typed media request is required.");
    const {executeMedia}=await import("./media/service");
    const input=JSON.parse(question.replace(/^\/media\s+/,""));
    return {content:await executeMedia(db,assistantId,trace,input,signal),sources:[],result:null};
  }
  // Never trust a persisted/custom Action to declare executable capabilities.
  if (
    action.kind !== "builtin" ||
    action.id !== "builtin:list-sources" ||
    action.execution !== "native" ||
    action.capability !== "list_assistant_sources"
  )
    throw new ActionError(403, "Capacità applicativa non autorizzata.");
  return runNativeOperation(
    db,
    assistantId,
    trace,
    signal,
    "list_sources",
    { action: action.id },
    () => {
      const documents = db
        .rows("documents")
        .filter(
          (d) =>
            d.tenant_id === assistant.tenant_id &&
            d.assistant_id === assistantId &&
            d.enabled !== false &&
            d.status === "ready",
        )
        .sort(
          (a, b) =>
            String(a.title ?? "").localeCompare(String(b.title ?? "")) ||
            String(a.id).localeCompare(String(b.id)),
        );
      signal.throwIfAborted();
      const visible = documents.slice(0, 50);
      const entries = visible.map((document) => {
        const name = String(document.title ?? "Documento senza titolo")
          .slice(0, 180)
          .replace(/[^\p{L}\p{N} .,()'_-]/gu, " ");
        return `- ${name}`;
      });
      const content = visible.length
        ? [
            "Fonti indicizzate, abilitate e pronte per questo assistente:",
            ...entries,
            ...(documents.length > visible.length
              ? ["- (altre fonti non visualizzate)"]
              : []),
          ].join("\n")
        : "Questo assistente non ha fonti indicizzate, abilitate e pronte.";
      return { content, sources: [] as [], result: null };
    },
  );
}
