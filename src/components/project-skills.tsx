"use client";
import { useEffect, useState } from "react";
import type { Assistant } from "@/lib/catalog";
type Item = {
  id: string;
  name: string;
  digest: string;
  description: string;
  recoverable: boolean;
};
type Preview = {
  slug: string;
  description: string;
  version: string | null;
  license: string | null;
  author: string | null;
  digest: string;
  files: Record<string, string>;
};
export function ProjectSkills({
  projectId,
  assistants,
  italian,
}: {
  projectId: string;
  assistants: Assistant[];
  italian: boolean;
}) {
  const [requested,setRequested]=useState<{name:string;digest:string}[]>([]);
  const url = "/api/projects/" + projectId + "/skill-packages";
  const [assistant, setAssistant] = useState(""),
    [items, setItems] = useState<Item[]>([]),
    [enabled, setEnabled] = useState<string[]>([]);
  const [archive, setArchive] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const text = (en: string, it: string) => (italian ? it : en);
  useEffect(() => {
    const c = new AbortController();
    fetch(url + (assistant ? "?assistant=" + assistant : ""), {
      signal: c.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setRequested(data.requested);
        setItems(data.skills);
        setEnabled(data.enabled);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            italian ? "Lettura non riuscita." : "Failed to load Skills.",
          );
      });
    return () => c.abort();
  }, [url, assistant, reload, italian]);
  async function post(body: object) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    return r.json();
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setReload((n) => n + 1);
    } catch {
      setError(
        text(
          "Operation failed. Review the package and current settings.",
          "Operazione non riuscita. Verifica il pacchetto e le impostazioni correnti.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const existing = items.find((i) => i.name === preview?.slug);
  async function install(conflict: string) {
    if (!preview) return;
    await post({
      op: "install",
      archive,
      digest: preview.digest,
      conflict,
      expected: existing?.digest,
    });
    setPreview(null);
    setArchive("");
  }
  return (
    <fieldset disabled={busy}>
      <legend>
        {text("Procedural Skills", "Competenze procedurali (Skills)")}
      </legend>
      {requested.length>0 && <details><summary>{text("Skills requested by template","Skills richieste dal template")}</summary>
        <ul>{requested.map((r,index)=><li key={index}>{r.name} · {items.some(s=>s.digest===r.digest)?text("Available","Disponibile"):text("Matching package required","Serve il pacchetto corrispondente")}</li>)}</ul></details>}
      <label>
        {text(
          "Preview a Markdown Skill ZIP",
          "Anteprima ZIP di una Skill Markdown",
        )}
        <input
          type="file"
          accept=".zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            setPreview(null);
            setArchive("");
            if (file)
              void act(async () => {
                if (file.size > 262144) throw new Error();
                const reader = new FileReader();
                const raw = await new Promise<string>((ok, fail) => {
                  reader.onload = () => ok(String(reader.result).split(",")[1]);
                  reader.onerror = fail;
                  reader.readAsDataURL(file);
                });
                const data = await post({ op: "preview", archive: raw });
                setArchive(raw);
                setPreview(data);
              });
          }}
        />
      </label>
      {preview && (
        <section>
          <strong>{preview.slug}</strong>
          <p>{preview.description}</p>
          <p>
            {[preview.author, preview.version, preview.license]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {Object.entries(preview.files).map(([path, md]) => (
            <details key={path}>
              <summary>{path}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{md}</pre>
            </details>
          ))}
          {archive && (
            <>
              {existing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void act(() => install("keep"))}
                  >
                    {text("Keep existing", "Mantieni esistente")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void act(() => install("copy"))}
                  >
                    {text("Import a copy", "Importa copia")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void act(() => install("replace"))}
                  >
                    {text("Replace and disable", "Sostituisci e disabilita")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void act(() => install("keep"))}
                >
                  {text("Import disabled Skill", "Importa Skill disabilitata")}
                </button>
              )}
            </>
          )}
        </section>
      )}
      <label>
        {text("Enable for assistant", "Abilita per assistente")}
        <select
          value={assistant}
          onChange={(e) => {
            setAssistant(e.target.value);
            setEnabled([]);
          }}
        >
          <option value="">
            {text("Select an assistant", "Seleziona un assistente")}
          </option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {items.map((i) => (
        <div key={i.id}>
          <label>
            <input
              type="checkbox"
              disabled={!assistant}
              checked={enabled.includes(i.id)}
              onChange={(e) => {
                const value = e.target.checked;
                void act(async () => {
                  await post({
                    op: "assign",
                    id: i.id,
                    assistant,
                    digest: i.digest,
                    enabled: value,
                  });
                });
              }}
            />
            {i.name}
          </label>
          <button
            type="button"
            onClick={() =>
              void act(async () => {
                const r = await fetch(url + "?id=" + i.id);
                if (!r.ok) throw new Error();
                setArchive("");
                setPreview(await r.json());
              })
            }
          >
            {text("Preview", "Anteprima")}
          </button>
          <a href={url + "?id=" + i.id + "&export=1"} download>
            {text("Export ZIP", "Esporta ZIP")}
          </a>
          {i.recoverable && (
            <button
              type="button"
              onClick={() =>
                void act(async () => {
                  await post({ op: "restore", id: i.id, digest: i.digest });
                })
              }
            >
              {text(
                "Restore previous version",
                "Ripristina versione precedente",
              )}
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
