"use client";
import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  FolderOpen,
  FolderSymlink,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";

type FolderSource = {
  id: string;
  path: string;
  recursive: boolean;
  status: string;
  error: string | null;
  checked_at: string | null;
  document_count: number;
  skipped?: number;
};
type Preview = {
  path: string;
  files: { relative_path: string; byte_size: number }[];
  skipped: number;
};
async function request<T>(
  body?: object,
  method = "POST",
  assistant?: string,
): Promise<T> {
  const r = await fetch(
    `/api/local/knowledge${assistant ? `?assistant=${assistant}` : ""}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Operation failed.");
  return data;
}
export function LocalStoragePanel() {
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void request<{ directory: string }>(undefined, "GET")
      .then((d) => setDirectory(d.directory))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel local-storage-panel">
      <h2>Documents on this PC</h2>
      <p>
        Imported copies are organized by project and assistant. Linked folders
        stay in their original location.
      </p>
      {directory && <code className="local-path">{directory}</code>}
      <button
        className="button"
        disabled={!directory}
        onClick={async () => {
          try {
            if (!window.siaasDesktop)
              throw new Error("Open this path in your file manager.");
            await window.siaasDesktop.openDataDirectory();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <FolderOpen size={16} />
        Open data folder
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function LocalKnowledge({
  assistantId,
  embeddingReady,
  revision,
  onChanged,
}: {
  assistantId: string;
  embeddingReady: boolean;
  revision: number;
  onChanged: () => Promise<void>;
}) {
  const [sources, setSources] = useState<FolderSource[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [path, setPath] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const data = await request<{ sources: FolderSource[] }>(
      undefined,
      "GET",
      assistantId,
    );
    setSources(data.sources);
  }, [assistantId]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load, revision]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load().catch((e) => setError(e.message));
      await onChanged();
    }
  }
  async function index(result: {
    queued: string[];
    source?: FolderSource | null;
  }) {
    if (result.source?.status === "unavailable") {
      setNotice(result.source.error ?? "Folder unavailable.");
      return;
    }
    if (!embeddingReady && !result.queued.length) {
      setNotice(
        "Sources updated. New documents become available after indexing with the local model.",
      );
      return;
    }
    let failed = 0;
    const docs = await fetch(`/api/documents?assistant=${assistantId}`).then(
      (r) => r.json(),
    );
    for (const id of result.queued) {
      if (
        !embeddingReady &&
        !docs.some(
          (d: { id: string; kind: string }) =>
            d.id === id && ["xlsx", "csv"].includes(d.kind),
        )
      )
        continue;
      try {
        const r = await fetch(`/api/documents/${id}/process`, {
          method: "POST",
        });
        if (!r.ok) failed++;
      } catch {
        failed++;
      }
    }
    setNotice(
      failed
        ? `Folder refreshed. ${failed} documents need another attempt; check the source details.`
        : "Folder refreshed. Indexed documents are ready for chat.",
    );
  }
  function edit(source?: FolderSource) {
    setEditing(source?.id ?? null);
    setPath(source?.path ?? "");
    setRecursive(source?.recursive ?? false);
    setPreview(null);
    setError("");
    setFormOpen(true);
  }
  return (
    <section className="local-knowledge" aria-label="Linked folders">
      <div className="section-toolbar">
        <div>
          <h3>Linked folders</h3>
          <p className="muted small">
            Files stay in place. Changes are checked when you open the project
            or select Refresh now.
          </p>
        </div>
        <button className="button" disabled={busy} onClick={() => edit()}>
          <FolderSymlink size={17} />
          Link folder
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {formOpen && (
        <form
          className="folder-connect-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!preview) {
                setPreview(
                  await request<Preview>({
                    action: "preview",
                    assistant_id: assistantId,
                    path,
                    recursive,
                  }),
                );
                return;
              }
              const result = await request<{
                queued: string[];
                source: FolderSource;
              }>({
                action: "connect",
                assistant_id: assistantId,
                ...(editing ? { source_id: editing } : {}),
                path: preview.path,
                recursive,
              });
              setFormOpen(false);
              await index(result);
            });
          }}
        >
          <div className="section-toolbar">
            <h4>{editing ? "Update path" : "Choose a local folder"}</h4>
            <button
              type="button"
              className="icon-button"
              aria-label="Close folder form"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            Folder path
            <input
              required
              value={path}
              disabled={busy}
              onChange={(e) => {
                setPath(e.target.value);
                setPreview(null);
              }}
              placeholder="Full path on your PC"
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!window.siaasDesktop)
                  throw new Error(
                    "Paste the full path or use Browse in the desktop app.",
                  );
                const selected =
                  await window.siaasDesktop.chooseKnowledgeFolder();
                if (selected) {
                  setPath(selected);
                  setPreview(null);
                }
              })
            }
          >
            <FolderOpen size={16} />
            Browse
          </button>
          <label className="folder-checkbox">
            <input
              type="checkbox"
              checked={recursive}
              disabled={busy}
              onChange={(e) => {
                setRecursive(e.target.checked);
                setPreview(null);
              }}
            />
            Include subfolders
          </label>
          {preview && (
            <div className="folder-preview">
              <strong>
                {preview.files.length} supported documents · {preview.skipped}{" "}
                items excluded
              </strong>
              <p className="muted small">
                PDF, DOCX, TXT, MD, XLSX and CSV up to 10 MB. Hidden files and
                symbolic links are excluded.
              </p>
              <ul>
                {preview.files.map((file) => (
                  <li key={file.relative_path}>
                    <FileText size={14} />
                    <span>{file.relative_path}</span>
                    <small>{Math.ceil(file.byte_size / 1024)} KB</small>
                  </li>
                ))}
              </ul>
              {!preview.files.length && (
                <p>
                  This folder is empty or has no supported documents. You can
                  link it and add files later.
                </p>
              )}
            </div>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Working…"
              : preview
                ? editing
                  ? "Save link"
                  : "Confirm link"
                : "Show preview"}
          </button>
        </form>
      )}
      <div className="folder-source-list">
        {sources.map((source) => (
          <article className="folder-source" key={source.id}>
            <FolderSymlink size={24} />
            <div className="folder-source-info">
              <code className="local-path">{source.path}</code>
              <span>
                {source.status === "connected"
                  ? "Connected"
                  : "Folder unavailable"}{" "}
                · {source.document_count} documents
                {source.recursive ? " · Includes subfolders" : ""}
              </span>
              <small>
                Ultimo controllo:{" "}
                {source.checked_at
                  ? new Date(source.checked_at).toLocaleString("en-US")
                  : "Never"}
              </small>
              {!!source.skipped && (
                <small>
                  {source.skipped} elementi non supportati o esclusi
                </small>
              )}
              {source.error && <p className="error">{source.error}</p>}
            </div>
            <div className="button-row">
              <button
                className="button compact"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await index(
                      await request({
                        action: "refresh",
                        assistant_id: assistantId,
                        source_id: source.id,
                      }),
                    );
                  })
                }
              >
                <RefreshCw size={14} />
                Refresh now
              </button>
              <button
                className="button compact"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!window.siaasDesktop)
                      throw new Error("Open the path in your file manager.");
                    await window.siaasDesktop.openKnowledgeFolder(source.path);
                  })
                }
              >
                <FolderOpen size={14} />
                Open folder
              </button>
              <button
                className="button compact"
                disabled={busy}
                onClick={() => edit(source)}
              >
                Change path
              </button>
              <button
                className="button compact"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Unlink this folder? Its documents and index will be removed from this assistant. Original files stay on your PC.",
                    )
                  )
                    void run(async () => {
                      await request(
                        { assistant_id: assistantId, source_id: source.id },
                        "DELETE",
                      );
                      setNotice(
                        "Folder unlinked. Original files remain in place.",
                      );
                    });
                }}
              >
                <Unplug size={14} />
                Unlink
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
