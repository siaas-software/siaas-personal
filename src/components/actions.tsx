"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Zap, Plus, X } from "lucide-react";
import {
  actionNameSchema,
  normalizedActionName,
  type ActionSkill,
} from "@/lib/actions";
import type { OllamaRuntime } from "@/lib/ollama";
import { useInterfaceLanguage } from "./interface-language";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error ?? "Operation failed. / Operazione non riuscita.",
    );
  return body;
}
export function useActions() {
  const [actions, setActions] = useState<ActionSkill[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setActions(await api<ActionSkill[]>("/api/actions"));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { actions, error, refresh };
}
export function ActionsPage({ onModels }: { onModels: () => void }) {
  const italian = useInterfaceLanguage();
  const { actions, error, refresh } = useActions();
  const [editing, setEditing] = useState<ActionSkill | "new" | null>(null);
  const [removing, setRemoving] = useState<ActionSkill | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  async function openBuilder(action: ActionSkill | "new") {
    setFailure("");
    try {
      const status = await api<BuilderModelStatus>("/api/actions/models");
      if (!status.ready) {
        setFailure(status.message);
        return;
      }
      setEditing(action);
    } catch (error) {
      setFailure((error as Error).message);
    }
  }
  return (
    <section className="actions-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SIAAS PERSONAL</span>
          <div className="actions-title-row">
            <h1>
              <Zap aria-hidden="true" /> Actions
            </h1>
            <ActionsMenu onModels={onModels} />
          </div>
          <p>
            {italian
              ? "Istruzioni riutilizzabili per il tuo assistente. Restano su questo PC."
              : "Reusable instructions for your assistant. Stored on this PC."}
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => void openBuilder("new")}
        >
          <Plus size={18} />
          {italian ? "Aggiungi Action" : "Add Action"}
        </button>
      </div>
      <p className="muted">
        {italian
          ? "Le Actions guidano il modello: non sono plugin eseguibili e non aggiungono nuove capacità. Data Cell (Tabella dati) resta una funzione separata, solo in chat."
          : "Actions guide the model: they are not executable plugins and do not add capabilities. Data Cell (Data table) remains a separate chat-only feature."}
      </p>
      {(error || failure) && (
        <p role="alert">
          {error || failure}{" "}
          <button className="button" onClick={onModels}>
            Models
          </button>
          <button className="button" onClick={() => void refresh()}>
            {italian ? "Riprova" : "Retry"}
          </button>
        </p>
      )}
      {(["builtin", "custom"] as const).map((kind) => (
        <section
          key={kind}
          className="actions-group"
          aria-label={kind === "builtin" ? "Built-in Actions" : "My Actions"}
        >
          <h2>
            {kind === "builtin"
              ? italian
                ? "Actions integrate"
                : "Built-in Actions"
              : italian
                ? "Le mie Actions"
                : "My Actions"}
          </h2>
          {kind === "builtin" && (
            <p className="muted">
              {italian
                ? "Pronte all'uso, di sola lettura."
                : "Ready to use, read-only."}
            </p>
          )}
          {kind === "custom" && !actions.some((a) => a.kind === kind) && (
            <p>
              {italian
                ? "Crea la tua prima Action con il chatbot locale."
                : "Create your first Action with the local chatbot."}
            </p>
          )}
          <div className="actions-grid">
            {actions
              .filter((a) => a.kind === kind)
              .map((action) => (
                <article className="panel action-card" key={action.id}>
                  <h3>
                    <Zap size={20} aria-hidden="true" /> {action.name}
                  </h3>
                  <details>
                    <summary>
                      {italian
                        ? "Visualizza istruzioni Markdown"
                        : "View Markdown instructions"}
                    </summary>
                    <pre className="action-markdown" tabIndex={0}>
                      {action.markdown}
                    </pre>
                  </details>
                  {kind === "custom" && (
                    <div className="action-controls">
                      <button
                        className="button"
                        onClick={() => void openBuilder(action)}
                      >
                        {italian ? "Modifica con AI" : "Edit with AI"}
                      </button>
                      <button
                        className="button danger"
                        onClick={() => {
                          setFailure("");
                          setRemoving(action);
                        }}
                      >
                        {italian ? "Elimina" : "Delete"}
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
      {editing && (
        <ActionBuilder
          action={editing === "new" ? undefined : editing}
          actions={actions}
          onModels={() => {
            setEditing(null);
            onModels();
          }}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {removing && (
        <ActionDialog
          title={italian ? "Elimina Action" : "Delete Action"}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <p>
            {italian
              ? `Eliminare “${removing.name}”? Le conversazioni esistenti saranno conservate.`
              : `Delete “${removing.name}”? Existing conversations will be preserved.`}
          </p>
          {failure && <p role="alert">{failure}</p>}
          <div className="action-controls">
            <button
              className="button"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              {italian ? "Annulla" : "Cancel"}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setFailure("");
                try {
                  await api(`/api/actions/${encodeURIComponent(removing.id)}`, {
                    method: "DELETE",
                    body: JSON.stringify({ confirmed: true }),
                  });
                  setRemoving(null);
                  await refresh();
                } catch (error) {
                  setFailure((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {italian ? "Conferma eliminazione" : "Confirm delete"}
            </button>
          </div>
        </ActionDialog>
      )}
    </section>
  );
}
function ActionDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal action-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
type Turn = { role: "user" | "assistant"; content: string };
function ActionBuilder({
  action,
  actions,
  onClose,
  onSaved,
  onModels,
}: {
  action?: ActionSkill;
  onModels: () => void;
  actions: ActionSkill[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const italian = useInterfaceLanguage();
  const [name, setName] = useState(action?.name ?? "");
  const [step, setStep] = useState(action ? 2 : 1);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [markdown, setMarkdown] = useState(action?.markdown ?? "");
  const [preview, setPreview] = useState<string | null>(null);

  const [modelId, setModelId] = useState("");
  const [modelError, setModelError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refreshModels = useCallback(async () => {
    try {
      const status = await api<BuilderModelStatus>("/api/actions/models");
      setModelId(status.ready ? status.modelId! : "");
      setModelError(status.message);
    } catch (error) {
      setModelId("");
      setModelError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void refreshModels();
    return () => controller.current?.abort();
  }, [refreshModels]);
  const close = () => {
    if (saving) return;
    controller.current?.abort();
    onClose();
  };
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || saving || !input.trim() || !modelId) return;
    const turns: Turn[] = [
      ...messages,
      { role: "user" as const, content: input.trim() },
    ].slice(-19);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await api<{
        reply: string;
        markdown: string | null;
        preview: string | null;
      }>("/api/actions/builder", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          name,
          actionId: action?.id,
          messages: turns,
          draft: markdown || undefined,
        }),
      });
      if (abort.signal.aborted) return;
      setMessages([...turns, { role: "assistant", content: result.reply }]);
      setInput("");
      if (result.markdown) {
        setMarkdown(result.markdown);
        setPreview(result.preview);
      }
    } catch (error) {
      setError(
        abort.signal.aborted
          ? italian
            ? "Generazione interrotta. Nessun salvataggio."
            : "Generation stopped. Nothing was saved."
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <ActionDialog
      title={
        action
          ? italian
            ? "Modifica con AI"
            : "Edit with AI"
          : italian
            ? "Aggiungi Action"
            : "Add Action"
      }
      onClose={close}
    >
      {step === 1 && modelError && (
        <p role="alert">
          {modelError}{" "}
          <button className="button" onClick={onModels}>
            Actions → Models
          </button>
        </p>
      )}
      {step === 1 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = actionNameSchema.safeParse(name);
            if (!parsed.success) {
              setError(
                italian
                  ? "Inserisci un nome valido di massimo 80 caratteri."
                  : "Enter a valid name of up to 80 characters.",
              );
              return;
            }
            if (
              actions.some(
                (a) =>
                  normalizedActionName(a.name) ===
                  normalizedActionName(parsed.data),
              )
            ) {
              setError(
                italian
                  ? "Nome già utilizzato. Scegline un altro."
                  : "This name is already used. Choose another.",
              );
              return;
            }
            setName(parsed.data);
            setError("");
            setStep(2);
          }}
        >
          <label htmlFor="action-name">
            {italian ? "Nome Action" : "Action name"}
          </label>
          <input
            id="action-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={!modelId}>
            {italian ? "Continua" : "Continue"}
          </button>
        </form>
      ) : (
        <>
          <h3>
            <Zap size={19} aria-hidden="true" /> {name}
          </h3>
          <p>
            {italian
              ? "Descrivi cosa deve fare il tuo assistente. Questa chat crea solo Actions, senza eseguire il compito. Le istruzioni saranno in inglese."
              : "Describe what your assistant should do. This chat only creates Actions; it does not perform the task. The instructions will be in English."}
          </p>
          <p>
            {italian ? "Modello Builder" : "Builder model"}:{" "}
            {modelId?.replace("ollama/", "") || "—"}
          </p>
          {modelError && <p role="alert">{modelError}</p>}
          <button
            className="button"
            disabled={busy || saving}
            onClick={onModels}
          >
            Actions → Models
          </button>
          <button
            className="button"
            disabled={busy || saving}
            onClick={() => void refreshModels()}
          >
            {italian ? "Ricontrolla Ollama" : "Check Ollama again"}
          </button>
          <div
            className="builder-conversation"
            role="log"
            aria-live="polite"
            aria-label="Action builder conversation"
          >
            {!messages.length && (
              <p>
                {action
                  ? italian
                    ? "Cosa vuoi cambiare? Le istruzioni attuali sono visibili sotto."
                    : "What would you like to change? The current instructions are shown below."
                  : italian
                    ? "Quale compito vuoi rendere riutilizzabile? Puoi indicare anche il risultato desiderato."
                    : "What task would you like to reuse? You can include the result you expect."}
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`builder-message builder-${message.role}`}
              >
                <strong>
                  {message.role === "user" ? (italian ? "Tu" : "You") : "SIAAS"}
                </strong>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
          <form onSubmit={send}>
            <label htmlFor="action-request">
              {italian
                ? "Descrivi o migliora la tua Action"
                : "Describe or improve your Action"}
            </label>
            <textarea
              id="action-request"
              required
              maxLength={2000}
              rows={3}
              value={input}
              disabled={busy || saving}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="action-controls">
              <button
                className="button primary"
                disabled={busy || saving || !modelId || !input.trim()}
              >
                {busy
                  ? italian
                    ? "Preparazione…"
                    : "Preparing…"
                  : italian
                    ? "Invia al builder"
                    : "Send to builder"}
              </button>
              {busy && (
                <button
                  type="button"
                  className="button"
                  onClick={() => controller.current?.abort()}
                >
                  {italian ? "Interrompi" : "Stop"}
                </button>
              )}
            </div>
          </form>
          {error && <p role="alert">{error}</p>}
          {markdown && (
            <section aria-label="Markdown preview">
              <h3>{italian ? "Anteprima Markdown" : "Markdown preview"}</h3>
              <pre className="action-markdown" tabIndex={0}>
                {markdown}
              </pre>
              <p className="muted">
                {italian
                  ? "Controlla le istruzioni. Puoi chiedere altre modifiche prima di confermare."
                  : "Review the instructions. You can request more changes before confirming."}
              </p>
            </section>
          )}
          <div className="action-controls">
            <button className="button" disabled={saving} onClick={close}>
              {italian ? "Annulla" : "Cancel"}
            </button>
            <button
              className="button primary"
              disabled={!preview || busy || saving || !modelId}
              onClick={async () => {
                if (!preview || saving) return;
                setSaving(true);
                setError("");
                try {
                  await api(
                    action
                      ? `/api/actions/${encodeURIComponent(action.id)}`
                      : "/api/actions",
                    {
                      method: action ? "PUT" : "POST",
                      body: JSON.stringify({ preview, confirmed: true }),
                    },
                  );
                  await onSaved();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? italian
                  ? "Salvataggio…"
                  : "Saving…"
                : italian
                  ? "Conferma e salva Action"
                  : "Confirm and save Action"}
            </button>
          </div>
        </>
      )}
    </ActionDialog>
  );
}

type BuilderModelStatus = {
  modelId: string | null;
  models: OllamaRuntime["models"];
  connected: boolean;
  ready: boolean;
  message: string;
};
function ActionsMenu({ onModels }: { onModels: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="project-actions"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="icon-button project-actions-trigger"
        aria-label="Actions menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={24} />
      </button>
      {open && (
        <div
          className="project-actions-menu"
          role="menu"
          aria-label="Actions menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onModels();
            }}
          >
            Models
          </button>
        </div>
      )}
    </div>
  );
}
export function ActionsModelsPage({ onBack }: { onBack: () => void }) {
  const italian = useInterfaceLanguage();
  const [status, setStatus] = useState<BuilderModelStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await api<BuilderModelStatus>("/api/actions/models"));
      setError("");
    } catch (error) {
      setStatus(null);
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function select(modelId: string | null) {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await api<BuilderModelStatus>("/api/actions/models", {
          method: "PUT",
          body: JSON.stringify({ modelId }),
        }),
      );
    } catch (error) {
      setError((error as Error).message);
      await refresh();
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="actions-page">
      <button className="button" onClick={onBack}>
        ← Actions
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACTIONS</span>
          <h1>Models</h1>
          <p>
            {italian
              ? "Scegli un solo modello globale per creare e modificare Actions. Gli assistenti mantengono i propri modelli."
              : "Choose one global model to create and edit Actions. Assistants keep their own models."}
          </p>
        </div>
      </div>
      <p aria-live="polite">
        {italian ? "Modello salvato" : "Saved model"}:{" "}
        <strong>
          {status?.modelId?.replace("ollama/", "") ||
            (italian ? "Nessuno" : "None")}
        </strong>
      </p>
      {status && !status.ready && <p role="alert">{status.message}</p>}
      {error && <p role="alert">{error}</p>}
      <button className="button" disabled={busy} onClick={() => void refresh()}>
        {italian ? "Ricontrolla Ollama" : "Check Ollama again"}
      </button>
      <fieldset
        disabled={busy || !status?.connected}
        className="panel actions-models"
      >
        <legend>
          {italian ? "Modelli Ollama installati" : "Installed Ollama models"}
        </legend>
        <label>
          <input
            type="radio"
            name="builder-model"
            checked={!status?.modelId}
            onChange={() => void select(null)}
          />
          {italian ? "Nessun modello" : "No model"}
        </label>
        {status?.models.map((model) => (
          <label key={model.id}>
            <input
              type="radio"
              name="builder-model"
              value={model.id}
              checked={status.modelId === model.id}
              onChange={() => void select(model.id)}
            />
            {model.name}
          </label>
        ))}
      </fieldset>
      {status && !status.models.length && (
        <p>
          {italian
            ? "Nessun modello disponibile. Avvia Ollama e installa un modello chat dalle Impostazioni, poi riprova."
            : "No models available. Start Ollama and install a chat model in Settings, then retry."}
        </p>
      )}
      {busy && (
        <p role="status">{italian ? "Verifica in corso…" : "Checking…"}</p>
      )}
    </section>
  );
}
