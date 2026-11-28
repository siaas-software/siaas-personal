"use client";
import { useEffect, useState } from "react";
import { mediaJob, videoInputs } from "@/lib/local/media/plan";
import type { Assistant } from "@/lib/catalog";
type Config = { enabled: boolean; threads: number; ffmpeg: boolean };
type FileEntry = { id: string; mime: string };
export function MediaSettings({
  assistants,
  italian,
}: {
  assistants: Assistant[];
  italian: boolean;
}) {
  const t = (en: string, it: string) => (italian ? it : en);
  const [config, setConfig] = useState<Config>(),
    [assistant, select] = useState(""),
    [files, setFiles] = useState<FileEntry[]>([]),
    [revision, refresh] = useState(0),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const url = "/api/assistants/" + assistant + "/media";
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/local/media", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const value = await r.json();
        if (!c.signal.aborted) setConfig(value);
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [revision]);
  useEffect(() => {
    const c = new AbortController();
    setFiles([]);
    if (assistant)
      fetch(url, { signal: c.signal, cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw Error();
          const value = await r.json();
          if (!c.signal.aborted) setFiles(value);
        })
        .catch(() => {
          if (!c.signal.aborted) setError(true);
        });
    return () => c.abort();
  }, [assistant, url, revision]);
  async function change(fn: () => Promise<Response>) {
    setBusy(true);
    setError(false);
    try {
      if (!(await fn()).ok) throw Error();
      refresh((r) => r + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const [operation, setOperation] = useState<
    | "resize"
    | "compose"
    | "overlay"
    | "photos-to-video"
    | "transition"
    | "transcode"
    | "join-videos"
  >("resize");
  const candidates = files.filter(
    (f) => f.mime === (videoInputs(operation) ? "video/mp4" : "image/png"),
  );
  const count =
    operation === "resize" || operation === "transcode"
      ? 1
      : operation === "photos-to-video"
        ? 12
        : 2;
  const command = mediaJob.safeParse({
    kind: operation,
    inputs: candidates.slice(0, count).map((f) => f.id),
    width: 640,
    height: 480,
  });
  return (
    <section className="panel settings-panel">
      <h2>Media Engine</h2>
      <p>
        {t(
          "Local PNG resize and photo-to-video assembly with FFmpeg.",
          "Ridimensionamento PNG e montaggio di foto in video con FFmpeg locale.",
        )}
      </p>
      {config && (
        <fieldset disabled={busy}>
          <legend>{t("CPU processing", "Elaborazione CPU")}</legend>
          <label>
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!config.ffmpeg && !config.enabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                void change(() =>
                  fetch("/api/local/media", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled, threads: config.threads }),
                  }),
                );
              }}
            />
            {t(
              "Enable local CPU processing",
              "Abilita elaborazione CPU locale",
            )}
          </label>
          {!config.ffmpeg && (
            <p>
              {t(
                "FFmpeg executable unavailable.",
                "Eseguibile FFmpeg non disponibile.",
              )}
            </p>
          )}
          <label>
            CPU threads{" "}
            <select
              value={config.threads}
              onChange={(e) => {
                const threads = Number(e.target.value);
                void change(() =>
                  fetch("/api/local/media", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: config.enabled, threads }),
                  }),
                );
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Assistant files", "File dell’assistente")}
            <select value={assistant} onChange={(e) => select(e.target.value)}>
              <option value="">—</option>
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {assistant && (
            <>
              <label>
                {t("Add PNG", "Aggiungi PNG")}
                <input
                  type="file"
                  accept="image/png"
                  disabled={!config.enabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void change(async () => {
                      if (file.size > 4194304) throw Error();
                      const png = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onerror = () => reject(Error());
                          reader.onload = () =>
                            resolve(String(reader.result).split(",")[1]);
                          reader.readAsDataURL(file);
                        },
                      );
                      return fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ png }),
                      });
                    });
                  }}
                />
              </label>
              <ul>
                {files.map((f) => (
                  <li key={f.id}>
                    <a href={url + "?file=" + f.id} download>
                      {f.id} · {f.mime}
                    </a>{" "}
                    <code>
                      {"/media " +
                        JSON.stringify({ kind: "inspect", inputs: [f.id] })}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        void change(() =>
                          fetch(url + "?file=" + f.id, { method: "DELETE" }),
                        )
                      }
                    >
                      {t("Delete", "Elimina")}
                    </button>
                  </li>
                ))}
              </ul>
              <label>
                {t("Operation", "Operazione")}
                <select
                  value={operation}
                  onChange={(e) =>
                    setOperation(e.target.value as typeof operation)
                  }
                >
                  {[
                    "resize",
                    "compose",
                    "overlay",
                    "photos-to-video",
                    "transition",
                    "transcode",
                    "join-videos",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              {command.success ? (
                <>
                  <p>
                    {t(
                      "Paste in the assistant’s chat. Edit the input order or dimensions as needed.",
                      "Incolla nella chat dell’assistente. Puoi modificare ordine dei file e dimensioni.",
                    )}
                  </p>
                  <pre>{"/media " + JSON.stringify(command.data)}</pre>
                </>
              ) : (
                <p>
                  {t(
                    "Add the required media files for this operation.",
                    "Aggiungi i file richiesti per questa operazione.",
                  )}
                </p>
              )}
            </>
          )}
        </fieldset>
      )}
      {error && (
        <p role="alert">
          {t(
            "Media request failed. Check the file and storage limits.",
            "Richiesta media fallita. Controlla file e limiti di spazio.",
          )}
        </p>
      )}
    </section>
  );
}
