import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import { localIntent } from "@/lib/local/chat-router";
import { getAction } from "@/lib/local/actions";
import {
  executeAssistantTask,
  type AssistantExecutionEvent,
} from "@/lib/local/assistant-execution";
import { OllamaError } from "@/lib/ollama";
import type { Assistant, Source } from "@/lib/catalog";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { db, tenantId } = await localWorkspace(req);
    const { conversation_id, question, language, action_id } = z
      .object({
        language: z.enum(["en", "it"]).default("en"),
        conversation_id: uuid,
        action_id: z.string().min(1).max(100).optional(),
        question: z.string().trim().min(1).max(1800),
      })
      .parse(await jsonBody(req, 30_000));
    const { data: conversation, error: cError } = await db
      .from("conversations")
      .select("*")
      .eq("id", conversation_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (cError) throw cError;
    if (!conversation) throw new HttpError(404, "Conversazione non trovata.");
    const { data: assistant, error: aError } = await db
      .from("assistants")
      .select("*")
      .eq("id", conversation.assistant_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (aError) throw aError;
    if (!assistant) throw new HttpError(404, "Assistente non trovato.");
    const action = action_id ? getAction(db, action_id) : undefined;
    if (
      !assistant.model_id &&
      !(action?.kind === "builtin" && action.execution === "native") &&
      !(action === undefined && localIntent(question))
    )
      throw new OllamaError(
        409,
        language === "it"
          ? "Questa richiesta richiede un modello locale oppure una domanda più specifica. Scrivi /aiuto."
          : "This request needs a local model or a more specific question. Type /help.",
      );
    const { count, error: countError } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "user")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= 12)
      throw new HttpError(
        429,
        "Troppe richieste. Attendi un minuto e riprova.",
      );
    const { data: lease, error: leaseError } = await db.rpc(
      "claim_conversation",
      { target_conversation: conversation_id },
    );
    if (leaseError) throw leaseError;
    if (!lease)
      throw new HttpError(
        409,
        "Una risposta è già in corso in questa conversazione.",
      );
    const responseId = randomUUID();
    try {
      const { data: history, error: hError } = await db
        .from("messages")
        .select("role,content")
        .eq("conversation_id", conversation_id)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(12);
      if (hError) throw hError;
      const prior = (history ?? []).reverse();
      const { error: insertError } = await db.from("messages").insert([
        {
          id: randomUUID(),
          tenant_id: tenantId,
          assistant_id: assistant.id,
          conversation_id,
          role: "user",
          content: question,
          ...(action ? { action_id: action.id, action_name: action.name } : {}),
        },
        {
          id: responseId,
          tenant_id: tenantId,
          assistant_id: assistant.id,
          conversation_id,
          role: "assistant",
          status: "pending",
          model_id: assistant.model_id,
          created_at: new Date(Date.now() + 1).toISOString(),
        },
      ]);
      if (insertError) throw insertError;
      if (!prior.length)
        await db
          .from("conversations")
          .update({ title: question.slice(0, 80) })
          .eq("id", conversation_id);
      let disconnected = false;
      const agentAbort = new AbortController();
      let task: Promise<void>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: object) => {
            if (!disconnected)
              try {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(event) + "\n"),
                );
              } catch {
                disconnected = true;
              }
          };
          task = (async () => {
            let text = "";
            let sources: Source[] = [];
            let savedAt = Date.now();
            try {
              const result = await executeAssistantTask({
                db,
                assistant: assistant as Assistant,
                question,
                action,
                language,
                history: prior.map((message) => ({
                  role: message.role as "user" | "assistant",
                  content: message.content,
                })),
                conversationId: conversation_id,
                signal: AbortSignal.any([agentAbort.signal, req.signal]),
                emit(event: AssistantExecutionEvent) {
                  if (event.type === "delta" && typeof event.text === "string")
                    text += event.text;
                  if (event.type === "sources" && Array.isArray(event.sources))
                    sources = event.sources as Source[];
                  send(
                    event.type === "start"
                      ? { ...event, id: responseId }
                      : event,
                  );
                  if (
                    event.type === "steps" ||
                    event.type === "research" ||
                    event.type === "artifacts" ||
                    Date.now() - savedAt > 1500
                  ) {
                    const current = db.get("messages", responseId);
                    if (!current) throw new Error("Conversation removed");
                    db.put(
                      "messages",
                      {
                        ...current,
                        content: text,
                        sources,
                        ...(event.type === "steps"
                          ? { agent_steps: event.steps }
                          : {}),
                        ...(event.type === "research"
                          ? {
                              research_warnings: event.warnings,
                              research_missing: event.missing,
                            }
                          : {}),
                        ...(event.type === "artifacts"
                          ? { artifacts: event.artifacts }
                          : {}),
                      },
                      true,
                    );
                    savedAt = Date.now();
                  }
                },
                async saveArtifacts(artifacts) {
                  const current = db.get("messages", responseId);
                  if (!current) throw new Error("Conversation removed");
                  db.put("messages", { ...current, artifacts }, true);
                },
              });
              const { error: saveError } = await db
                .from("messages")
                .update({
                  content: result.text || result.error || "",
                  status: result.status,
                  error: result.error,
                  sources: result.sources,
                  ...(result.artifacts.length
                    ? { artifacts: result.artifacts }
                    : {}),
                  ...(result.structuredAnalysis
                    ? { structured_analysis: result.structuredAnalysis }
                    : {}),
                  agent_mode: result.agentMode,
                  execution_path: result.executionPath,
                  model_id: [
                    "native-action",
                    "arithmetic",
                    "structured",
                    "document",
                    "website",
                    "help",
                    "clarify",
                  ].includes(result.executionPath)
                    ? null
                    : assistant.model_id,
                  input_tokens: result.inputTokens,
                  output_tokens: result.outputTokens,
                })
                .eq("id", responseId);
              if (saveError) throw saveError;
              if (result.status === "error")
                send({ type: "error", error: result.error, id: responseId });
              else send({ type: "done", id: responseId });
            } catch (error) {
              const message =
                error instanceof OllamaError
                  ? error.message
                  : "La risposta è stata interrotta. Riprova tra poco; il testo già ricevuto è conservato quando possibile.";
              await db
                .from("messages")
                .update({ content: text || message, status: "error" })
                .eq("id", responseId);
              send({ type: "error", error: message });
            } finally {
              await db
                .from("conversations")
                .update({ lease_token: null, lease_until: null })
                .eq("id", conversation_id)
                .eq("lease_token", lease);
              if (!disconnected) controller.close();
            }
          })();
        },
        cancel() {
          disconnected = true;
          agentAbort.abort();
        },
      });
      after(async () => {
        await task;
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      await db
        .from("messages")
        .update({ status: "error" })
        .eq("id", responseId);
      await db
        .from("conversations")
        .update({ lease_token: null, lease_until: null })
        .eq("id", conversation_id)
        .eq("lease_token", lease);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
