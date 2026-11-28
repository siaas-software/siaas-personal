"use client";
import { useEffect, useState } from "react";
import type { Assistant } from "@/lib/catalog";

type Server = {
  id: string;
  name: string;
  status: string;
  config: { transport: string; endpoint?: string; executable?: string };
  tools: {
    name: string;
    description?: string;
    digest: string;
    capability: string;
    inputSchema: object;
  }[];
};

export function ProjectMcp({
  projectId,
  assistants,
  italian,
}: {
  projectId: string;
  assistants: Assistant[];
  italian: boolean;
}) {
  const url = "/api/projects/" + projectId + "/mcp";
  const [assistant, setAssistant] = useState(""),
    [servers, setServers] = useState<Server[]>([]),
    [assigned, setAssigned] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("http"),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const t = (en: string, it: string) => (italian ? it : en);
  useEffect(() => {
    const c = new AbortController();
    fetch(url + (assistant ? "?assistant=" + assistant : ""), {
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!c.signal.aborted) {
          setServers(data.servers);
          setAssigned(data.assignments ?? {});
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [url, assistant, refresh]);
  async function apply(body: object) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setRefresh((n) => n + 1);
    }
  }
  return (
    <fieldset disabled={busy}>
      <legend>{t("MCP connections", "Connessioni MCP")}</legend>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void apply({
            op: "save",
            name: data.get("name"),
            config:
              mode === "http"
                ? {
                    transport: mode,
                    endpoint: data.get("endpoint"),
                    allowLoopback: data.has("loopback"),
                  }
                : {
                    transport: mode,
                    executable: data.get("executable"),
                    sha256: data.get("sha256"),
                  },
          });
        }}
      >
        <label>
          {t("Connection name", "Nome connessione")}
          <input name="name" required maxLength={80} />
        </label>
        <label>
          {t("Transport", "Trasporto")}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="http">Streamable HTTP</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
        {mode === "http" ? (
          <>
            <label>
              Endpoint
              <input name="endpoint" type="url" required />
            </label>
            <label>
              <input type="checkbox" name="loopback" />
              {t(
                "Allow this local 127.0.0.1 endpoint",
                "Autorizza questo endpoint locale 127.0.0.1",
              )}
            </label>
          </>
        ) : (
          <>
            <label>
              {t("Standalone executable path", "Percorso eseguibile autonomo")}
              <input name="executable" required />
            </label>
            <label>
              SHA-256
              <input name="sha256" pattern="[0-9a-f]{64}" required />
            </label>
          </>
        )}
        <button>{t("Save connection", "Salva connessione")}</button>
      </form>
      <label>
        {t("Assign tools to assistant", "Assegna strumenti all’assistente")}
        <select
          value={assistant}
          onChange={(e) => {
            setAssigned({});
            setAssistant(e.target.value);
          }}
        >
          <option value="">
            {t("Select assistant", "Seleziona assistente")}
          </option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {servers.map((s) => (
        <section key={s.id}>
          <h4>{s.name}</h4>
          <p>
            {s.config.endpoint ?? s.config.executable} · {s.status}
          </p>
          {s.status === "disconnected" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const bearer =
                  new FormData(e.currentTarget).get("bearer") || undefined;
                e.currentTarget.reset();
                void apply({ op: "connect", id: s.id, bearer });
              }}
            >
              {s.config.endpoint?.startsWith("https:") && (
                <label>
                  {t(
                    "Bearer token for this session (optional)",
                    "Token bearer per questa sessione (opzionale)",
                  )}
                  <input type="password" name="bearer" autoComplete="off" />
                </label>
              )}
              <button>
                {t("Connect and discover tools", "Connetti e cerca strumenti")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => void apply({ op: "disconnect", id: s.id })}
            >
              {t("Disconnect", "Disconnetti")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void apply({ op: "remove", id: s.id })}
          >
            {t("Remove connection", "Rimuovi connessione")}
          </button>
          {s.tools.map((tool) => (
            <details key={tool.name}>
              <summary>{tool.name}</summary>
              <p>{tool.description}</p>
              <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
              <code>
                /mcp {s.id} {tool.name} {"{}"}
              </code>
              <p>
                <code>{tool.capability}</code>
              </p>
              <label>
                <input
                  type="checkbox"
                  disabled={!assistant}
                  checked={assigned[tool.capability] === tool.digest}
                  onChange={(e) =>
                    void apply({
                      op: "assign",
                      id: s.id,
                      assistant,
                      name: tool.name,
                      digest: tool.digest,
                      enabled: e.target.checked,
                    })
                  }
                />
                {t(
                  "Available to selected assistant",
                  "Disponibile per l’assistente selezionato",
                )}
              </label>
            </details>
          ))}
        </section>
      ))}
      {failed && (
        <p role="alert">
          {t(
            "Check the connection, tool schema and current assignments.",
            "Verifica connessione, schema dello strumento e assegnazioni correnti.",
          )}
        </p>
      )}
    </fieldset>
  );
}
