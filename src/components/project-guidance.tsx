"use client";
import { useEffect, useState } from "react";

export function ProjectGuidance({
  projectId,
  italian,
}: {
  projectId: string;
  italian: boolean;
}) {
  const base = "/api/projects/" + projectId;
  const [actions, setActions] = useState<{ id: string; name: string }[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const error = italian ? "Operazione non riuscita." : "Operation failed.";
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      const response = await fetch(base + "/actions", { signal: c.signal });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setActions(data.available);
      setIds(data.selected);
      setReady(true);
    }
    void load().catch(() => {
      if (!c.signal.aborted) setMessage(error);
    });
    return () => c.abort();
  }, [base, error]);
  async function save() {
    const response = await fetch(base + "/actions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error();
    setPreview("");
    setMessage(
      italian ? "Azioni collegate aggiornate." : "Linked Actions saved.",
    );
  }
  async function show() {
    const response = await fetch(base + "/agents-md", { cache: "no-store" });
    if (!response.ok) throw new Error();
    setPreview((await response.json()).markdown);
  }
  return (
    <section>
      <fieldset>
        <legend>
          {italian ? "Azioni collegate al progetto" : "Project Actions"}
        </legend>
        {actions.map((a) => (
          <label key={a.id}>
            <input
              type="checkbox"
              checked={ids.includes(a.id)}
              onChange={(e) =>
                setIds(
                  e.target.checked
                    ? [...ids, a.id]
                    : ids.filter((id) => id !== a.id),
                )
              }
            />
            {a.name}
          </label>
        ))}
        <button
          type="button"
          disabled={!ready}
          onClick={() => void save().catch(() => setMessage(error))}
        >
          {italian ? "Salva azioni" : "Save Actions"}
        </button>
      </fieldset>
      <button
        type="button"
        onClick={() => void show().catch(() => setMessage(error))}
      >
        {italian ? "Visualizza AGENTS.md" : "Preview AGENTS.md"}
      </button>
      {preview && (
        <>
          <textarea aria-label="AGENTS.md" readOnly value={preview} rows={10} />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(preview).then(
                () => setMessage(italian ? "Copiato." : "Copied."),
                () => setMessage(error),
              )
            }
          >
            {italian ? "Copia" : "Copy"}
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
