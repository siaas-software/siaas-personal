"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Assistant, Project, Source } from "@/lib/catalog";
import type { ProjectOrchestrationConfig } from "@/lib/project-orchestration";
import { ChatMarkdown } from "./chat-markdown";
import { ChatComposer } from "./chat-composer";

type Run = {
  id: string;
  question: string;
  status: "running" | "complete" | "error";
  result: string | null;
  error?: string;
  steps: {
    assistant_id: string;
    status: string;
    text: string;
    execution_path?: string;
    sources?: Source[];
    artifacts?: { id: string; title: string; content: string }[];
  }[];
  created_at: string;
};

const defaults: ProjectOrchestrationConfig = {
  enabled: false,
  instructions: "",
  assistant_ids: [],
  max_steps: 4,
  share_results: false,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Operazione non riuscita.");
  return data as T;
}

/**
 * A dedicated project-level chat. All delegated results and traces are stored
 * as project runs, never in the assistants' personal conversation histories.
 */
export function ProjectChat({
  project,
  assistants,
  onSaved,
}: {
  project: Project;
  assistants: Assistant[];
  onSaved: (project: Project) => void;
}) {
  const [config, setConfig] = useState<ProjectOrchestrationConfig>(
    project.orchestration ?? defaults,
  );
  const [runs, setRuns] = useState<Run[]>([]);
  const [it, setItalian] = useState(false);
  const [selectedAction, setSelectedAction] = useState("");
  useEffect(
    () => setItalian(document.documentElement.lang.startsWith("it")),
    [],
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const activeRun = useRef<string | null>(null);
  const mounted = useRef(true);
  const path = `/api/projects/${encodeURIComponent(project.id)}/runs`;

  useEffect(() => {
    setConfig(project.orchestration ?? defaults);
  }, [project.id, project.orchestration]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void request<Run[]>(path)
      .then((items) => {
        if (active) setRuns(items);
      })
      .catch((error) => {
        if (active) setFailure((error as Error).message);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [path]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    let active = true;
    const timer = setInterval(() => {
      void request<Run[]>(path)
        .then((items) => {
          if (active) setRuns(items);
        })
        .catch((error) => {
          if (active) setFailure((error as Error).message);
        });
    }, 500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, runs.some((run) => run.status === "running")]);

  async function saveConfig() {
    setSaving(true);
    setFailure("");
    try {
      const result = await request<Project>(
        `/api/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: project.name, orchestration: config }),
        },
      );
      onSaved(result);
      setShowSettings(false);
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runTask(event: FormEvent) {
    event.preventDefault();
    if (busy || !question.trim() || !project.orchestration?.enabled) return;
    setBusy(true);
    setFailure("");
    try {
      const run = await request<Run>(path, {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          action_id: selectedAction || undefined,
          language: it ? "it" : "en",
        }),
      });
      if (mounted.current) setQuestion("");
      activeRun.current = run.id;
      for (;;) {
        const items = await request<Run[]>(path);
        if (!mounted.current) break;
        setRuns(items);
        if (items.find((item) => item.id === run.id)?.status !== "running")
          break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (error) {
      if (mounted.current) setFailure((error as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
      activeRun.current = null;
    }
  }

  async function cancelTask(runId = activeRun.current) {
    if (!runId) return;
    try {
      await request(path, {
        method: "DELETE",
        body: JSON.stringify({ run_id: runId }),
      });
    } catch (error) {
      setFailure((error as Error).message);
    }
  }

  return (
    <section
      className="panel"
      aria-label={it ? "Chat di progetto" : "Project chat"}
      style={{ marginBottom: 24 }}
    >
      <div
        className="section-toolbar"
        style={{ gap: 12, alignItems: "center" }}
      >
        <div>
          <h2>{it ? "Chat del progetto" : "Project chat"}</h2>
          <p className="muted small">
            {it
              ? "Coordina gli assistenti selezionati. Le loro chat individuali restano separate."
              : "Run the selected assistants in order."}
          </p>
        </div>
        <button
          type="button"
          className="button compact"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((value) => !value)}
        >
          {it ? "Configura orchestratore" : "Configure orchestration"}
        </button>
      </div>
      {showSettings && (
        <div className="panel" style={{ marginTop: 12, padding: 16 }}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                setConfig((value) => ({
                  ...value,
                  enabled: event.target.checked,
                }))
              }
            />{" "}
            {it
              ? "Abilita orchestrazione nel progetto"
              : "Enable project orchestration"}
          </label>
          <p className="muted small">
            {it
              ? "Modalità iniziale: esecuzione sequenziale nell'ordine selezionato, senza pianificatore LLM di progetto."
              : "Assistants run sequentially in selection order."}
          </p>
          <fieldset style={{ marginTop: 10 }}>
            <legend>
              {it
                ? "Assistenti autorizzati (ordine di selezione)"
                : "Authorized assistants (selection order)"}
            </legend>
            {assistants.map((assistant) => (
              <label
                key={assistant.id}
                style={{ display: "block", margin: "8px 0" }}
              >
                <input
                  type="checkbox"
                  checked={config.assistant_ids.includes(assistant.id)}
                  onChange={(event) =>
                    setConfig((value) => ({
                      ...value,
                      assistant_ids: event.target.checked
                        ? [...value.assistant_ids, assistant.id]
                        : value.assistant_ids.filter(
                            (id) => id !== assistant.id,
                          ),
                    }))
                  }
                />{" "}
                {assistant.name}
              </label>
            ))}
            {!assistants.length && (
              <p className="muted">
                {it
                  ? "Crea prima un assistente nel progetto."
                  : "Create an assistant in this project first."}
              </p>
            )}
          </fieldset>
          <label style={{ display: "block", marginTop: 12 }}>
            {it
              ? "Istruzioni dell'orchestratore (preferenze per gli assistenti; non concedono permessi)"
              : "Coordinator preferences"}
            <textarea
              aria-label={
                it ? "Istruzioni dell'orchestratore" : "Coordinator preferences"
              }
              value={config.instructions}
              rows={3}
              maxLength={4000}
              onChange={(event) =>
                setConfig((value) => ({
                  ...value,
                  instructions: event.target.value,
                }))
              }
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ display: "block", marginTop: 12 }}>
            {it ? "Massimo passaggi" : "Maximum steps"}{" "}
            <select
              aria-label={it ? "Massimo passaggi" : "Maximum steps"}
              value={config.max_steps}
              onChange={(event) =>
                setConfig((value) => ({
                  ...value,
                  max_steps: Number(event.target.value),
                }))
              }
            >
              {Array.from({ length: 8 }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={config.share_results}
              onChange={(event) =>
                setConfig((value) => ({
                  ...value,
                  share_results: event.target.checked,
                }))
              }
            />{" "}
            {it
              ? "Consenti il passaggio dei risultati testuali tra assistenti selezionati"
              : "Share text results between selected assistants"}
          </label>
          <p className="muted small">
            {it
              ? "La condivisione non autorizza ad accedere direttamente ai file o alle URL degli altri assistenti."
              : "Each assistant uses its own authorized sources."}
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => void saveConfig()}
            disabled={saving || busy}
          >
            {saving
              ? it
                ? "Salvataggio…"
                : "Saving…"
              : it
                ? "Salva configurazione"
                : "Save configuration"}
          </button>
        </div>
      )}
      {failure && (
        <p role="alert" style={{ marginTop: 12 }}>
          {failure}
        </p>
      )}
      {project.orchestration?.enabled ? (
        <>
          <div style={{ marginTop: 16 }}>
            {runs.length === 0 ? (
              <p className="muted">
                {it
                  ? "Nessuna esecuzione. Invia una richiesta al progetto."
                  : "Send a request to start a project run."}
              </p>
            ) : (
              runs.map((run) => (
                <article
                  className="panel"
                  key={run.id}
                  style={{ marginBottom: 10, padding: 12 }}
                >
                  <p>
                    <strong>{it ? "Richiesta:" : "Request"}</strong>{" "}
                    {run.question}
                  </p>
                  <p className="muted small">
                    {run.status === "complete"
                      ? it
                        ? "Completata"
                        : "Completed"
                      : run.status === "error"
                        ? it
                          ? "Errore"
                          : "Error"
                        : it
                          ? "In corso"
                          : "Running"}
                    {" · "}
                    {new Date(run.created_at).toLocaleString(
                      it ? "it-IT" : "en-GB",
                    )}
                  </p>
                  <details>
                    <summary>
                      {it ? "Passaggi degli assistenti" : "Assistant steps"} (
                      {run.steps?.length ?? 0})
                    </summary>
                    {(run.steps ?? []).map((step, index) => (
                      <div key={index} style={{ marginTop: 8 }}>
                        <strong>
                          {assistants.find((a) => a.id === step.assistant_id)
                            ?.name ??
                            (it
                              ? "Assistente non disponibile"
                              : "Assistant unavailable")}
                        </strong>
                        <p className="muted small">
                          {step.execution_path ??
                            (it ? "Esecuzione" : "Execution")}{" "}
                          · {step.status}
                        </p>
                        <div className="message-text">
                          <ChatMarkdown content={step.text} />
                        </div>
                        {!!step.sources?.length && (
                          <details className="sources">
                            <summary>
                              {it ? "Fonti" : "Sources"} ({step.sources.length})
                            </summary>
                            {step.sources.map((source, sourceIndex) => (
                              <div key={sourceIndex}>
                                <strong>{source.title}</strong>
                                {source.fetched_at && (
                                  <p className="muted small">
                                    {it ? "Acquisita:" : "Acquired:"}{" "}
                                    {source.fetched_at}
                                  </p>
                                )}
                                <blockquote>{source.content}</blockquote>
                              </div>
                            ))}
                          </details>
                        )}
                        {!!step.artifacts?.length && (
                          <div
                            className="sources"
                            aria-label={
                              it ? "Documenti generati" : "Generated reports"
                            }
                          >
                            {step.artifacts.map((artifact) => (
                              <a
                                key={artifact.id}
                                className="button compact"
                                href={`/api/projects/${encodeURIComponent(project.id)}/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`}
                              >
                                {artifact.title} · Markdown
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </details>
                  {run.status === "complete" && run.result && (
                    <div
                      className="message-text"
                      aria-label={it ? "Risultato finale" : "Final result"}
                    >
                      <ChatMarkdown content={run.result} />
                    </div>
                  )}
                  {run.status === "running" && (
                    <button
                      type="button"
                      className="button compact"
                      onClick={() => void cancelTask(run.id)}
                    >
                      {it ? "Annulla" : "Cancel"}
                    </button>
                  )}
                  {run.status === "error" && (
                    <p role="alert">
                      {run.error ??
                        (it
                          ? "Esecuzione interrotta."
                          : "Execution interrupted.")}
                    </p>
                  )}
                </article>
              ))
            )}
          </div>
          <label>
            {it ? "Action facoltativa" : "Optional Action"}
            <select
              aria-label={it ? "Action facoltativa" : "Optional Action"}
              value={selectedAction}
              disabled={busy}
              onChange={(event) => setSelectedAction(event.target.value)}
            >
              <option value="">
                {it ? "Richiesta normale" : "Normal request"}
              </option>
              <option value="builtin:list-sources">
                {it ? "Elenca fonti" : "List sources"}
              </option>
            </select>
          </label>
          <ChatComposer
            id="project-chat-input"
            label={it ? "Richiesta al progetto" : "Project request"}
            value={question}
            onChange={setQuestion}
            onSubmit={runTask}
            busy={busy}
            disabled={
              !project.orchestration?.enabled ||
              (!busy && runs.some((run) => run.status === "running"))
            }
            placeholder={
              it
                ? "Chiedi agli assistenti di collaborare..."
                : "Ask the selected assistants…"
            }
            busyLabel={it ? "Esecuzione in corso…" : "Execution in progress…"}
            cancelLabel={it ? "Annulla" : "Cancel"}
            onCancel={() => void cancelTask()}
          />
        </>
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>
          {it
            ? "Orchestrazione disattivata. Le chat dei singoli assistenti continuano a funzionare."
            : "Enable orchestration to send a project request."}
        </p>
      )}
    </section>
  );
}
