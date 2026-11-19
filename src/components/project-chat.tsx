"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Assistant, Project } from "@/lib/catalog";
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
  const [config, setConfig] = useState<ProjectOrchestrationConfig>(project.orchestration ?? defaults);
  const [runs, setRuns] = useState<Run[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const cancel = useRef<AbortController | null>(null);
  const path = `/api/projects/${encodeURIComponent(project.id)}/runs`;

  useEffect(() => {
    setConfig(project.orchestration ?? defaults);
  }, [project.id, project.orchestration]);
  useEffect(() => {
    let active = true;
    void request<Run[]>(path)
      .then((items) => { if (active) setRuns(items); })
      .catch((error) => { if (active) setFailure((error as Error).message); });
    return () => {
      active = false;
      cancel.current?.abort();
    };
  }, [path]);

  async function saveConfig() {
    setSaving(true);
    setFailure("");
    try {
      const result = await request<Project>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: project.name, orchestration: config }),
      });
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
    const controller = new AbortController();
    cancel.current = controller;
    try {
      await request<Run>(path, {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          language: document.documentElement.lang.startsWith("it") ? "it" : "en",
        }),
        signal: controller.signal,
      });
      setQuestion("");
    } catch (error) {
      if (controller.signal.aborted)
        setFailure("Richiesta annullata. Controlla lo stato dell'esecuzione nella cronologia.");
      else setFailure((error as Error).message);
    } finally {
      setBusy(false);
      cancel.current = null;
      try { setRuns(await request<Run[]>(path)); } catch { /* prior error retained */ }
    }
  }

  return (
    <section className="panel" aria-label="Chat di progetto" style={{ marginBottom: 24 }}>
      <div className="section-toolbar" style={{ gap: 12, alignItems: "center" }}>
        <div>
          <h2>Chat del progetto</h2>
          <p className="muted small">Coordina gli assistenti selezionati. Le loro chat individuali restano separate.</p>
        </div>
        <button
          type="button"
          className="button compact"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((value) => !value)}
        >
          Configura orchestratore
        </button>
      </div>
      {showSettings && (
        <div className="panel" style={{ marginTop: 12, padding: 16 }}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => setConfig((value) => ({ ...value, enabled: event.target.checked }))}
            />{" "}
            Abilita orchestrazione nel progetto
          </label>
          <p className="muted small">Modalità iniziale: esecuzione sequenziale nell'ordine selezionato, senza pianificatore LLM di progetto.</p>
          <fieldset style={{ marginTop: 10 }}>
            <legend>Assistenti autorizzati (ordine di selezione)</legend>
            {assistants.map((assistant) => (
              <label key={assistant.id} style={{ display: "block", margin: "8px 0" }}>
                <input
                  type="checkbox"
                  checked={config.assistant_ids.includes(assistant.id)}
                  onChange={(event) => setConfig((value) => ({
                    ...value,
                    assistant_ids: event.target.checked
                      ? [...value.assistant_ids, assistant.id]
                      : value.assistant_ids.filter((id) => id !== assistant.id),
                  }))}
                />{" "}
                {assistant.name}
              </label>
            ))}
            {!assistants.length && <p className="muted">Crea prima un assistente nel progetto.</p>}
          </fieldset>
          <label style={{ display: "block", marginTop: 12 }}>
            Istruzioni dell'orchestratore (preferenze per gli assistenti; non concedono permessi)
            <textarea
              aria-label="Istruzioni dell'orchestratore"
              value={config.instructions}
              rows={3}
              maxLength={4000}
              onChange={(event) => setConfig((value) => ({ ...value, instructions: event.target.value }))}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ display: "block", marginTop: 12 }}>
            Massimo passaggi{" "}
            <select
              aria-label="Massimo passaggi"
              value={config.max_steps}
              onChange={(event) => setConfig((value) => ({ ...value, max_steps: Number(event.target.value) }))}
            >
              {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={config.share_results}
              onChange={(event) => setConfig((value) => ({ ...value, share_results: event.target.checked }))}
            />{" "}
            Consenti il passaggio dei risultati testuali tra assistenti selezionati
          </label>
          <p className="muted small">La condivisione non autorizza ad accedere direttamente ai file o alle URL degli altri assistenti.</p>
          <button
            type="button"
            className="button primary"
            onClick={() => void saveConfig()}
            disabled={saving || busy}
          >
            {saving ? "Salvataggio…" : "Salva configurazione"}
          </button>
        </div>
      )}
      {failure && <p role="alert" style={{ marginTop: 12 }}>{failure}</p>}
      {project.orchestration?.enabled ? (
        <>
          <div style={{ marginTop: 16 }}>
            {runs.length === 0 ? (
              <p className="muted">Nessuna esecuzione. Invia una richiesta al progetto.</p>
            ) : runs.map((run) => (
              <article className="panel" key={run.id} style={{ marginBottom: 10, padding: 12 }}>
                <p><strong>Richiesta:</strong> {run.question}</p>
                <p className="muted small">
                  {run.status === "complete" ? "Completata" : run.status === "error" ? "Errore" : "In corso"}
                  {" · "}{new Date(run.created_at).toLocaleString("it-IT")}
                </p>
                <details>
                  <summary>Passaggi degli assistenti ({run.steps?.length ?? 0})</summary>
                  {(run.steps ?? []).map((step, index) => (
                    <div key={index} style={{ marginTop: 8 }}>
                      <strong>{assistants.find((a) => a.id === step.assistant_id)?.name ?? "Assistente non disponibile"}</strong>
                      <p className="muted small">{step.execution_path ?? "Esecuzione"} · {step.status}</p>
                      <div className="message-text"><ChatMarkdown content={step.text} /></div>
                      {!!step.artifacts?.length && (
                        <div className="sources" aria-label="Documenti generati">
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
                  <div className="message-text" aria-label="Risultato finale"><ChatMarkdown content={run.result} /></div>
                )}
                {run.status === "error" && <p role="alert">{run.error ?? "Esecuzione interrotta."}</p>}
              </article>
            ))}
          </div>
          <ChatComposer
            id="project-chat-input"
            label="Richiesta al progetto"
            value={question}
            onChange={setQuestion}
            onSubmit={runTask}
            busy={busy}
            disabled={!project.orchestration?.enabled}
            placeholder="Chiedi agli assistenti di collaborare..."
            busyLabel="Esecuzione in corso…"
            onCancel={() => cancel.current?.abort()}
          />
        </>
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>
          Orchestrazione disattivata. Le chat dei singoli assistenti continuano a funzionare.
        </p>
      )}
    </section>
  );
}
