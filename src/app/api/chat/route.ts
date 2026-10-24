import { actionInvocation } from "@/lib/actions";
import { getAction } from "@/lib/local/actions";
import {
  prepareAssistantResearch,
  researchLimitations,
} from "@/lib/local/assistant-research";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { localWorkspace, fail, HttpError, jsonBody, uuid } from "@/lib/http";
import {
  requireOllama,
  streamLocal,
  OllamaError,
  type OllamaMessage,
} from "@/lib/ollama";
import { isDesktop } from "@/lib/runtime";
import { ragPrompt } from "@/lib/rag";
import type { Source } from "@/lib/catalog";
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
    const { data: conversation } = await db
      .from("conversations")
      .select("*")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conversation) throw new HttpError(404, "Conversazione non trovata.");
    const { data: assistant } = await db
      .from("assistants")
      .select("*")
      .eq("id", conversation.assistant_id)
      .single();
    if (!assistant) throw new HttpError(404, "Assistente non trovato.");
    if (!assistant.model_id)
      throw new HttpError(
        409,
        "Scegli prima un modello per questo assistente.",
      );
    const action = action_id ? getAction(db, action_id) : undefined;
    const invocation = actionInvocation(question, action);
    const inferenceContext = {
      assistantId: assistant.id,
      projectId: assistant.project_id,
      conversationId: conversation_id,
    };
    const runtime = await requireOllama(assistant.model_id);
    const useAgent = isDesktop() && runtime.agent.enabled;
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
          ...(isDesktop() ? { agent_mode: useAgent } : {}),
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
            try {
              send({ type: "start", id: responseId, agent_mode: useAgent });
              let sources: Source[] = [];
              let inputTokens = 0,
                outputTokens = 0;
              const { structuredChat } = await import("@/lib/structured/chat");
              const structured = await structuredChat({
                db,
                assistantId: assistant.id,
                modelId: assistant.model_id,
                question: invocation,
                instructions: assistant.instructions,
                embeddingProfile: runtime.embeddingProfile,
                signal: AbortSignal.any([agentAbort.signal, req.signal]),
                emit(delta) {
                  text += delta;
                  send({ type: "delta", text: delta });
                },
              });
              if (structured) {
                sources = structured.sources;
                send({ type: "sources", sources });
                if (structured.result) {
                  const artifacts = [
                    {
                      id: randomUUID(),
                      title: "Structured Data Analysis",
                      content: structured.content,
                    },
                  ];
                  await db
                    .from("messages")
                    .update({
                      structured_analysis: structured.result,
                      artifacts,
                    })
                    .eq("id", responseId);
                  send({ type: "artifacts", artifacts });
                }
              } else {
                const research = await prepareAssistantResearch({
                  db,
                  assistantId: assistant.id,
                  modelId: assistant.model_id,
                  question,
                  embeddingProfile: runtime.embeddingProfile,
                  conversationId: conversation_id,
                  language,
                  signal: AbortSignal.any([
                    agentAbort.signal,
                    req.signal,
                    AbortSignal.timeout(240_000),
                  ]),
                  emit(event) {
                    if (event.type === "sources") sources = event.sources;
                    send(event);
                    if (
                      event.type === "sources" ||
                      event.type === "steps" ||
                      event.type === "research"
                    ) {
                      const current = db.get("messages", responseId);
                      if (!current) throw new Error("Conversation removed");
                      db.put(
                        "messages",
                        {
                          ...current,
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
                        },
                        true,
                      );
                    }
                  },
                });
                sources = research.sources;
                if (useAgent) {
                  const [{ runLocalAgent }, { localDatabase }] =
                    await Promise.all([
                      import("@/lib/local/agent"),
                      import("@/lib/local/database"),
                    ]);
                  const local = localDatabase();
                  let savedAt = Date.now();
                  const result = await runLocalAgent({
                    db: local,
                    language,
                    preparedResearch: research,
                    assistantId: assistant.id,
                    conversationId: conversation_id,
                    modelId: assistant.model_id,
                    instructions: assistant.instructions,
                    question: invocation,
                    history: prior.map((message) => ({
                      role: message.role as "user" | "assistant",
                      content: message.content,
                    })),
                    embeddingProfile: runtime.embeddingProfile,
                    signal: AbortSignal.any([
                      agentAbort.signal,
                      req.signal,
                      AbortSignal.timeout(240_000),
                    ]),
                    emit(event) {
                      if (event.type === "delta") text += event.text;
                      if (event.type === "sources") sources = event.sources;
                      send(event);
                      if (
                        event.type === "steps" ||
                        event.type === "research" ||
                        Date.now() - savedAt > 1500
                      ) {
                        const current = local.get("messages", responseId);
                        if (!current) throw new Error("Conversation removed");
                        local.put(
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
                          },
                          true,
                        );
                        savedAt = Date.now();
                      }
                    },
                    async saveArtifacts(artifacts) {
                      const current = local.get("messages", responseId);
                      if (!current) throw new Error("Conversation removed");
                      local.put("messages", { ...current, artifacts }, true);
                    },
                  });
                  sources = result.sources;
                  inputTokens = result.inputTokens;
                  outputTokens = result.outputTokens;
                  if (!text.trim()) throw new Error("Empty generation");
                } else {
                  const { error: sError } = await db
                    .from("messages")
                    .update({ sources })
                    .eq("id", responseId);
                  if (sError) throw sError;
                  send({ type: "sources", sources });
                  {
                    const messages: OllamaMessage[] = [
                      {
                        role: "system",
                        content:
                          (sources.length
                            ? ragPrompt(
                                assistant.instructions.slice(0, 1000),
                                // Bound the model context; full sources remain in SQLite and the UI.
                                sources.map((source) => ({
                                  ...source,
                                  title: source.title.slice(0, 100),
                                  url: undefined,
                                  content: source.content.slice(
                                    0,
                                    Math.floor(
                                      5000 / Math.max(1, sources.length),
                                    ),
                                  ),
                                })),
                              )
                            : assistant.instructions.slice(0, 1000) ||
                              "You are a helpful assistant. Explain when no relevant sources are available.") +
                          researchLimitations(research),
                      },
                      ...prior.slice(-2).map((m) => ({
                        role: m.role as "user" | "assistant",
                        content: m.content.slice(0, 400),
                      })),
                      { role: "user", content: invocation },
                    ];
                    let savedAt = Date.now();
                    for await (const event of streamLocal(
                      assistant.model_id,
                      messages,
                      fetch,
                      inferenceContext,
                    )) {
                      if (event.type === "done") {
                        inputTokens = event.inputTokens;
                        outputTokens = event.outputTokens;
                        continue;
                      }
                      text += event.text;
                      send({ type: "delta", text: event.text });
                      if (Date.now() - savedAt > 1500) {
                        const { error: pError } = await db
                          .from("messages")
                          .update({ content: text })
                          .eq("id", responseId);
                        if (pError) throw pError;
                        savedAt = Date.now();
                      }
                    }
                    if (!text.trim()) throw new Error("Empty generation");
                  }
                }
              }
              const { error: saveError } = await db
                .from("messages")
                .update({
                  content: text,
                  status: "complete",
                  sources,
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                })
                .eq("id", responseId);
              if (saveError) throw saveError;
              send({ type: "done", id: responseId });
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
