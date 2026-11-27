"use client";
import { useEffect, useState } from "react";
import type { Assistant } from "@/lib/catalog";
import type {
  ToolPermissionRule,
  ToolDecision,
} from "@/lib/tool-permission-gateway";
import type { ApprovalView } from "@/lib/local/operation-approval";
import type { ExecutionEventRecord } from "@/lib/local/execution-events";

type Props = { projectId: string; assistants: Assistant[]; italian: boolean };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

const labels: Record<string, [string, string]> = {
  list_sources: ["List available sources", "Elencare le fonti disponibili"],
  search_documents: ["Search documents", "Cercare nei documenti"],
  read_document: ["Read document passages", "Leggere parti di un documento"],
  retrieve_sources: ["Retrieve sources", "Consultare le fonti"],
  inspect_datasets: [
    "Inspect dataset structure",
    "Consultare la struttura dei dati",
  ],
  query_datasets: ["Run dataset calculation", "Eseguire il calcolo sui dati"],
  calculate_dataset: [
    "Calculate on a dataset",
    "Calcolare su un insieme di dati",
  ],
  plan_dataset_query: [
    "Plan dataset calculation",
    "Preparare il calcolo sui dati",
  ],
  create_report: ["Create report", "Creare un report"],
};

export function ApprovalRequests({ projectId, assistants, italian }: Props) {
  const [items, setItems] = useState<ApprovalView[]>([]);
  const [error, setError] = useState(false);
  const url = "/api/projects/" + projectId + "/approvals";
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await request<{ pending: ApprovalView[] }>(url, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setItems(response.pending);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url]);
  async function decide(id: string, outcome: string) {
    try {
      await request(url, {
        method: "POST",
        body: JSON.stringify({ id, outcome }),
      });
      setError(false);
      setItems((rows) => rows.filter((row) => row.id !== id));
    } catch {
      setError(true);
    }
  }
  return (
    <>
      {items.map((item) => (
        <section
          className="notice"
          key={item.id}
          aria-label={
            italian ? "Richiesta di approvazione" : "Approval request"
          }
        >
          <strong>
            {assistants.find((a) => a.id === item.assistantId)?.name} —{" "}
            {labels[item.operation]?.[italian ? 1 : 0] ?? item.operation}
          </strong>
          <p>
            {italian
              ? "Autorizzare questa operazione una volta?"
              : "Allow this operation once?"}{" "}
            {italian ? "Scade alle" : "Expires at"}{" "}
            {new Date(item.expiresAt).toLocaleTimeString()}
          </p>
          <details>
            <summary>
              {italian ? "Parametri dell’operazione" : "Operation parameters"}
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {item.parameters}
            </pre>
          </details>
          {(["approved", "rejected", "cancelled"] as const).map((value, i) => (
            <button
              type="button"
              className="button"
              key={value}
              onClick={() => void decide(item.id, value)}
            >
              {
                (italian
                  ? ["Approva", "Rifiuta", "Annulla"]
                  : ["Approve", "Reject", "Cancel"])[i]
              }
            </button>
          ))}
        </section>
      ))}
      {error && (
        <p role="alert">
          {italian
            ? "Richiesta scaduta o non disponibile."
            : "Request expired or unavailable."}
        </p>
      )}
    </>
  );
}

export function ProjectSecurity({ projectId, assistants, italian }: Props) {
  const url = "/api/projects/" + projectId;
  const [rules, setRules] = useState<ToolPermissionRule[]>([]);
  const [defaults, setDefaults] = useState<ToolPermissionRule[]>([]);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [events, setEvents] = useState<ExecutionEventRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const fail = italian ? "Operazione non riuscita." : "Operation failed.";
  useEffect(() => {
    const c = new AbortController();
    request<{
      defaults: { rules: ToolPermissionRule[] };
      revision: number;
      overrides: { rules: ToolPermissionRule[] };
    }>(url + "/permissions", { signal: c.signal })
      .then((data) => {
        setRevision(data.revision);
        setRules(data.overrides.rules);
        setDefaults(data.defaults.rules);
        setLoaded(true);
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage(fail);
      });
    return () => c.abort();
  }, [url, fail]);
  useEffect(() => {
    const c = new AbortController();
    const query = new URLSearchParams({ limit: "20" });
    if (filter) query.set("assistant", filter);
    if (page) query.set("before", page);
    request<{ events: ExecutionEventRecord[]; next: string | null }>(
      url + "/trace?" + query,
      { signal: c.signal },
    )
      .then((data) => {
        setEvents(data.events);
        setCursor(data.next);
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage(fail);
      });
    return () => c.abort();
  }, [url, filter, page, fail]);
  async function save() {
    try {
      const saved = await request<{ revision: number }>(url + "/permissions", {
        headers: { "If-Match": `"${revision}"` },
        method: "PUT",
        body: JSON.stringify({ rules }),
      });
      setRevision(saved.revision);
      setMessage(italian ? "Regole salvate." : "Rules saved.");
    } catch (error) {
      setMessage(error instanceof Error && error.message === "412" ? (italian ? "Le regole sono cambiate. Riapri le impostazioni." : "Rules changed. Reopen settings to review them.") : fail);
    }
  }
  const decisions = italian
    ? { ask: "Chiedi", allow: "Consenti", deny: "Nega" }
    : { ask: "Ask", allow: "Allow", deny: "Deny" };
  return (
    <section>
      <h3>{italian ? "Permessi degli strumenti" : "Tool permissions"}</h3>
      <details>
        <summary>{italian ? "Regole predefinite" : "Default rules"}</summary>
        <ul>
          {defaults.map((r) => (
            <li key={r.capability}>
              {r.capability} · {decisions[r.decision]}
            </li>
          ))}
        </ul>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {rules.map((r, i) => (
          <div key={i}>
            <input
              required
              aria-label={italian ? "Capacità" : "Capability"}
              value={r.capability}
              onChange={(e) =>
                setRules(
                  rules.map((v, j) =>
                    j === i ? { ...v, capability: e.target.value } : v,
                  ),
                )
              }
            />
            <select
              aria-label={italian ? "Decisione" : "Decision"}
              value={r.decision}
              onChange={(e) =>
                setRules(
                  rules.map((v, j) =>
                    j === i
                      ? { ...v, decision: e.target.value as ToolDecision }
                      : v,
                  ),
                )
              }
            >
              {Object.entries(decisions).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              {italian ? "Rimuovi" : "Remove"}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={!loaded}
          onClick={() =>
            setRules([...rules, { capability: "", decision: "ask" }])
          }
        >
          {italian ? "Aggiungi regola" : "Add rule"}
        </button>
        <button disabled={!loaded}>
          {italian ? "Salva regole" : "Save rules"}
        </button>
      </form>
      <p role="status">{message}</p>
      <h3>{italian ? "Registro esecuzioni" : "Execution trace"}</h3>
      <select
        aria-label={italian ? "Filtra per assistente" : "Filter by assistant"}
        value={filter}
        onChange={(e) => {
          setEvents([]);
          setCursor(null);
          setPage(null);
          setFilter(e.target.value);
        }}
      >
        <option value="">
          {italian ? "Tutto il progetto" : "Entire project"}
        </option>
        {assistants.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            {new Date(e.created_at).toLocaleString()} · {e.kind}{" "}
            {e.details.tool_key} {e.details.permission}
          </li>
        ))}
      </ul>
      {cursor && (
        <button type="button" onClick={() => setPage(cursor)}>
          {italian ? "Eventi precedenti" : "Older events"}
        </button>
      )}
      {page && (
        <button type="button" onClick={() => setPage(null)}>
          {italian ? "Torna ai più recenti" : "Newest events"}
        </button>
      )}
    </section>
  );
}
