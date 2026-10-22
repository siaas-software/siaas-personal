"use client";
import { useInterfaceLanguage } from "./interface-language";
import { useState } from "react";
import { Globe, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { DocumentRecord } from "@/lib/catalog";

export function WebKnowledge({
  assistantId,
  docs,
  onChanged,
  onView,
  onRemove,
}: {
  assistantId: string;
  docs: DocumentRecord[];
  onChanged: () => Promise<void>;
  onView: (doc: DocumentRecord) => void;
  onRemove: (doc: DocumentRecord) => void;
}) {
  const italian = useInterfaceLanguage();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(document?: DocumentRecord) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/local/knowledge/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant_id: assistantId,
          ...(document
            ? { action: "refresh", document_id: document.id }
            : { action: "add", url }),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Unable to import this URI.");
      if (!document) setUrl("");
      setNotice(
        result.status === "ready"
          ? "Source indexed and available in chat."
          : (result.error ??
              "Source registered. Waiting for indexing; retry when the connection and document model are available."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await onChanged();
    }
  }
  async function index(doc: DocumentRecord) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/documents/${doc.id}/process`, {
        method: "POST",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Indexing failed.");
      setNotice(
        data.status === "ready"
          ? "Source indexed and available in chat."
          : (data.error ?? "Source is waiting for indexing."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await onChanged();
    }
  }
  async function toggle(doc: DocumentRecord) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/local/knowledge/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle",
          assistant_id: assistantId,
          document_id: doc.id,
          enabled: doc.enabled === false,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Unable to update source.");
      setNotice(
        doc.enabled === false
          ? "Source enabled for new chat responses."
          : "Source excluded from new chat responses. Existing conversation messages remain unchanged.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await onChanged();
    }
  }
  return (
    <section
      className="web-knowledge"
      aria-label={italian ? "Configurazione siti web" : "Website configuration"}
    >
      <h3>
        <Globe size={17} />{" "}
        {italian ? "Configurazione siti web" : "Website configuration"}
      </h3>
      <p className="muted small">
        Add public HTTP/HTTPS URLs. Page text is indexed locally for this
        assistant. Only URLs travel with templates. Refresh to fetch changes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="knowledge-uri">Source URI</label>
        <div className="uri-input">
          <input
            id="knowledge-uri"
            type="url"
            required
            maxLength={1500}
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button
            className="button"
            disabled={busy || !url.trim()}
            aria-label="Add URI"
          >
            <Plus size={17} />
          </button>
        </div>
      </form>
      {busy && (
        <p role="status" className="muted small">
          Reading and indexing source…
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {docs.map((doc) => (
        <article className="web-source" key={doc.id}>
          <button className="web-source-title" onClick={() => onView(doc)}>
            {doc.title}
          </button>
          <a href={doc.source_url} target="_blank" rel="noreferrer">
            {doc.source_url}
          </a>
          <label className="web-source-toggle">
            <input
              type="checkbox"
              checked={doc.enabled !== false}
              disabled={busy}
              onChange={() => void toggle(doc)}
            />{" "}
            Use in chat
          </label>
          <small>
            {doc.enabled === false ? "Disabled · " : ""}
            {doc.status === "ready"
              ? "Ready for chat"
              : doc.status === "queued"
                ? "Waiting for indexing"
                : doc.status === "error"
                  ? "Indexing failed"
                  : "Indexing…"}
            {doc.fetched_at
              ? ` · Fetched ${new Date(doc.fetched_at).toLocaleDateString("en-US")}`
              : ""}
          </small>
          {doc.error && <p className="error small">{doc.error}</p>}
          <div className="button-row">
            <button
              className="button compact"
              disabled={
                busy || doc.enabled === false || doc.status === "processing"
              }
              onClick={() => void save(doc)}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            {doc.status !== "processing" && (
              <button
                className="button compact"
                disabled={busy || doc.enabled === false}
                onClick={() => void index(doc)}
              >
                Retry indexing
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`Remove web source ${doc.title}`}
              disabled={busy}
              onClick={() => onRemove(doc)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
