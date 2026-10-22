"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Cpu,
  Database,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  InferenceRecord,
  ModelState,
  OverviewModel,
  OverviewSnapshot,
} from "@/lib/overview";
const states: Record<ModelState, string> = {
  installed: "Installed",
  loaded: "Loaded",
  loading: "Starting / loading",
  "in-use": "In use",
  error: "Last request failed",
  unknown: "Not detected",
};
const outcomes: Record<InferenceRecord["status"], string> = {
  loading: "Starting / loading",
  generating: "Generating",
  complete: "Completed",
  error: "Error",
  cancelled: "Interrupted",
  interrupted: "Interrupted by restart",
};
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
function bytes(value: number | null | undefined) {
  if (value == null) return "Not detected";
  if (value >= 1024 ** 3) return `${number.format(value / 1024 ** 3)} GB`;
  if (value >= 1024 ** 2) return `${number.format(value / 1024 ** 2)} MB`;
  return `${number.format(value / 1024)} KB`;
}
function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-US") : "Not detected";
}
function seconds(value: number | null) {
  return value === null ? "Not detected" : `${number.format(value / 1000)} s`;
}
function percent(value: number | null | undefined) {
  return value == null ? "Not detected" : `${number.format(value)}%`;
}
function State({ model }: { model: OverviewModel }) {
  return (
    <span className={`overview-state state-${model.state}`}>
      {states[model.state]}
    </span>
  );
}
function Resource({
  title,
  value,
  detail,
  usage,
}: {
  title: string;
  value: string;
  detail?: string;
  usage?: number | null;
}) {
  return (
    <article className="overview-resource">
      <span>{title}</span>
      <strong>{value}</strong>
      {usage != null && (
        <meter aria-label={title} min={0} max={100} value={usage} />
      )}
      {detail && <small>{detail}</small>}
    </article>
  );
}
type Props = {
  onAssistant: (id: string) => void;
  onProject: (id: string) => void;
};
function ModelDetail({
  model,
  stale,
  onClose,
  onAssistant,
  onProject,
}: Props & { model: OverviewModel; stale: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal overview-detail"
      onCancel={onClose}
      aria-labelledby="overview-model-title"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MODEL DETAILS</span>
          <h2 id="overview-model-title">{model.name}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close model details"
        >
          <X size={20} />
        </button>
      </div>
      <State model={model} />
      {stale && (
        <p className="overview-warning">
          Ollama is unreachable: details and size reflect the last available update.
        </p>
      )}
      <dl className="overview-facts">
        <div>
          <dt>Disk size</dt>
          <dd>{bytes(model.size)}</dd>
        </div>
        <div>
          <dt>Family</dt>
          <dd>{model.details.family || "Not detected"}</dd>
        </div>
        <div>
          <dt>Parameters</dt>
          <dd>{model.details.parameter_size || "Not detected"}</dd>
        </div>
        <div>
          <dt>Quantization</dt>
          <dd>{model.details.quantization_level || "Not detected"}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{model.details.format || "Not detected"}</dd>
        </div>
        <div>
          <dt>Loaded in memory</dt>
          <dd>
            {model.loaded === null
              ? "Not detected"
              : model.loaded
                ? "Yes"
                : "No"}
          </dd>
        </div>
        <div>
          <dt>Model memory (Ollama)</dt>
          <dd>{bytes(model.memory)}</dd>
        </div>
        <div>
          <dt>GPU share (Ollama)</dt>
          <dd>{bytes(model.vram)}</dd>
        </div>
        <div>
          <dt>Loaded context</dt>
          <dd>
            {model.contextLength == null
              ? "Not detected"
              : `${number.format(model.contextLength)} token`}
          </dd>
        </div>
      </dl>
      <p className="overview-note">
        Model memory and GPU share are reported by Ollama. Total CPU and GPU usage is not attributed to this model.
      </p>
      <h3>Linked assistants and projects</h3>
      {!model.assistants.length ? (
        <p className="overview-note">
          No assistants use this model.
        </p>
      ) : (
        <div className="overview-links">
          {model.assistants.map((a) => (
            <button
              className="button compact"
              key={a.id}
              onClick={() => onAssistant(a.id)}
            >
              {a.name}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="overview-links">
        {model.projects.map((p) => (
          <button
            className="overview-text-link"
            key={p.id}
            onClick={() => onProject(p.id)}
          >
            {p.name}
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <h3>
        Richieste SIAAS Personal in corso{" "}
        <span className="overview-muted">({model.active.length})</span>
      </h3>
      {!model.active.length ? (
        <p className="overview-note">
          No current SIAAS Personal activity detected.
        </p>
      ) : (
        model.active.map((r) => (
          <div className="overview-request" key={r.id}>
            <strong>
              {r.kind === "embedding" ? "Embedding" : outcomes[r.status]}
            </strong>
            <span>Avviata: {when(r.startedAt)}</span>
            {r.assistantId && (
              <button
                className="overview-text-link"
                onClick={() => onAssistant(r.assistantId!)}
              >
                Open assistant
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        ))
      )}
      <h3>Recent requests</h3>
      <p className="overview-note">
        Last 20 calls per model. Each agent step and embedding batch is a separate call. Duration is measured by SIAAS Personal; tokens and speed come from Ollama.
      </p>
      {!model.recent.length ? (
        <p className="overview-empty">
          No requests recorded for this model.
        </p>
      ) : (
        <div className="overview-table-scroll">
          <table className="overview-history">
            <thead>
              <tr>
                <th>Request</th>
                <th>Result</th>
                <th>Duration</th>
                <th>Token in / out</th>
                <th>Speed</th>
              </tr>
            </thead>
            <tbody>
              {model.recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    {when(r.startedAt)}
                    <small>
                      {r.kind === "embedding" ? "Embedding" : "Chat"}
                    </small>
                    {r.assistantId && (
                      <button
                        className="overview-text-link"
                        onClick={() => onAssistant(r.assistantId!)}
                      >
                        Assistant
                        <ArrowUpRight size={12} />
                      </button>
                    )}
                  </td>
                  <td>
                    {outcomes[r.status]}
                    {r.error && <small>{r.error}</small>}
                  </td>
                  <td>{seconds(r.durationMs)}</td>
                  <td>
                    {r.inputTokens ?? "—"} / {r.outputTokens ?? "—"}
                  </td>
                  <td>
                    {r.tokensPerSecond === null
                      ? "Not detected"
                      : `${number.format(r.tokensPerSecond)} token/s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="overview-note">
        Telemetry keeps only metadata on this PC: up to 1,000 requests for up to 30 days. Requests made before the update are not reconstructed.
      </p>
    </dialog>
  );
}
export function Overview({ onAssistant, onProject }: Props) {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(""),
    [state, setState] = useState("all"),
    [project, setProject] = useState(""),
    [assistant, setAssistant] = useState(""),
    [sort, setSort] = useState("recent"),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function refresh() {
      setRefreshing(true);
      try {
        const response = await fetch("/api/local/overview", {
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok)
          throw new Error("Refresh failed. Please retry shortly.");
        const data: OverviewSnapshot = await response.json();
        if (!disposed) {
          setSnapshot(data);
          setError("");
        }
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error && e.name !== "TimeoutError"
              ? e.message
              : "Refresh timed out. Please retry.",
          );
      } finally {
        if (!disposed) {
          setRefreshing(false);
          timer = setTimeout(refresh, 5000);
        }
      }
    }
    void refresh();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  const models = snapshot?.models ?? [];
  const projects = [
    ...new Map(
      models.flatMap((m) => m.projects).map((p) => [p.id, p]),
    ).values(),
  ];
  const assistants = [
    ...new Map(
      models.flatMap((m) => m.assistants).map((a) => [a.id, a]),
    ).values(),
  ].filter((a) => !project || a.projectId === project);
  const lastActivity = (m: OverviewModel) =>
    Math.max(
      0,
      ...m.active.concat(m.recent).map((r) => Date.parse(r.startedAt)),
    );
  const filtered = models
    .filter(
      (m) =>
        m.name.toLowerCase().includes(query.toLowerCase()) &&
        (state === "all" ||
          (state === "in-use"
            ? m.active.length > 0
            : state === "loaded"
              ? m.loaded === true
              : m.state === state)) &&
        (!project || m.projects.some((p) => p.id === project)) &&
        (!assistant || m.assistants.some((a) => a.id === assistant)),
    )
    .sort(
      (a, b) =>
        (sort === "size"
          ? (b.size ?? -1) - (a.size ?? -1)
          : sort === "assistants"
            ? b.assistants.length - a.assistants.length
            : lastActivity(b) - lastActivity(a)) ||
        a.name.localeCompare(b.name),
    );
  const detail = models.find((m) => m.name === selected);
  const resources = error ? null : snapshot?.resources;
  const stale = !!error || !snapshot?.connected;
  const activity = (m: OverviewModel) =>
    m.active.length
      ? m.active.some((r) => r.status === "generating")
        ? "Generating"
        : "Waiting for the first result"
      : stale || !m.recent.length || m.loaded === null
        ? "No SIAAS Personal activity detected"
        : "Idle in SIAAS Personal";
  return (
    <section className="overview">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR AI ENVIRONMENT</span>
          <h1>
            Overview<span className="title-dot">.</span>
          </h1>
          <p>
            All local models, computer resources and assistant activity.
          </p>
        </div>
        <button
          className="button"
          disabled={refreshing}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          {refreshing ? "Refreshing…" : stale ? "Retry" : "Refresh"}
        </button>
      </div>
      <div className="overview-update">
        <span
          className={`overview-dot ${snapshot?.connected && !error ? "connected" : ""}`}
        />
        Refreshes automatically every 5 seconds
        <span>Ultimo controllo: {when(snapshot?.checkedAt)}</span>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error} I dati visualizzati si riferiscono all’ultimo controllo
          riuscito e non sono attuali.
        </div>
      )}
      {snapshot?.warnings.map((w) => (
        <div className="overview-warning" key={w} role="status">
          {w}
        </div>
      ))}
      <div className="overview-summary">
        <article>
          <Activity size={20} />
          <span>Ollama</span>
          <strong>
            {error
              ? "Not detected"
              : snapshot
                ? snapshot.connected
                  ? "Connected"
                  : "Unreachable"
                : "Checking…"}
          </strong>
        </article>
        <article>
          <Database size={20} />
          <span>Installed models</span>
          <strong>{snapshot?.modelsUpdatedAt ? models.length : "—"}</strong>
          {stale && snapshot?.modelsUpdatedAt && (
            <small>Last available reading</small>
          )}
        </article>
        <article>
          <Cpu size={20} />
          <span>Loaded in memory</span>
          <strong>{error ? "—" : (snapshot?.loadedCount ?? "—")}</strong>
        </article>
        <article>
          <Activity size={20} />
          <span>Active SIAAS Personal generations</span>
          <strong>
            {error || snapshot?.historyAvailable === false
              ? "—"
              : (snapshot?.activeCount ?? "—")}
          </strong>
          <small>
            Embedding in corso:{" "}
            {error || snapshot?.historyAvailable === false
              ? "—"
              : (snapshot?.embeddingCount ?? "—")}
          </small>
        </article>
      </div>
      <div className="overview-section-heading">
        <h2>Computer resources</h2>
        <span>Carico complessivo · {when(resources?.sampledAt)}</span>
      </div>
      <div className="overview-resources">
        <Resource
          title="CPU"
          value={percent(resources?.cpuPercent)}
          usage={resources?.cpuPercent}
          detail={resources?.cpuName}
        />
        <Resource
          title="RAM"
          value={
            resources
              ? `${bytes(resources.ramUsed)} / ${bytes(resources.ramTotal)}`
              : "Not detected"
          }
          usage={
            resources ? (resources.ramUsed / resources.ramTotal) * 100 : null
          }
          detail="Total computer memory"
        />
        {resources?.gpus.length ? (
          resources.gpus.map((gpu, i) => (
            <Resource
              key={i}
              title={`GPU · ${gpu.name}`}
              value={percent(gpu.utilization)}
              usage={gpu.utilization}
              detail={`VRAM ${bytes(gpu.memoryUsed)} / ${bytes(gpu.memoryTotal)} · ${gpu.temperature === null ? "Temperature unavailable" : number.format(gpu.temperature) + " °C"} · ${gpu.power === null ? "Power unavailable" : number.format(gpu.power) + " W"}`}
            />
          ))
        ) : (
          <Resource
            title="GPU / VRAM"
            value="Not detected"
            detail="GPU sensors are unavailable on this system"
          />
        )}
        <Resource
          title="CPU temperature"
          value={
            resources?.cpuTemperature == null
              ? "Not detected"
              : `${number.format(resources.cpuTemperature)} °C`
          }
        />
        {resources?.disks.length ? (
          resources.disks.map((d) => (
            <Resource
              key={d.name}
              title={`Disk · ${d.name}`}
              value={`${bytes(d.readBytesPerSecond)}/s`}
              detail={`Read · Write ${bytes(d.writeBytesPerSecond)}/s`}
            />
          ))
        ) : (
          <Resource
            title="Disk activity"
            value="Not detected"
            detail="Waiting for a reading or sensor unavailable"
          />
        )}
      </div>
      <p className="overview-note">
        CPU, RAM and sensors describe the whole computer. Activity from other applications is not attributed to SIAAS Personal models.
      </p>
      <div className="overview-section-heading">
        <h2>
          Modelli locali{" "}
          <span className="overview-muted">
            {snapshot?.modelsUpdatedAt ? models.length : ""}
          </span>
        </h2>
        <span>Elenco aggiornato: {when(snapshot?.modelsUpdatedAt)}</span>
      </div>
      <div className="overview-filters">
        <label className="overview-search">
          <span>Search models</span>
          <div>
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or tag…"
            />
          </div>
        </label>
        <label>
          Status
          <select aria-label="Status" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">All</option>
            <option value="in-use">In use (including startup)</option>
            <option value="loaded">Loaded</option>
            <option value="installed">Installed, not loaded</option>
            <option value="loading">Starting / loading</option>
            <option value="error">With errors</option>
          </select>
        </label>
        <label>
          Project
          <select
            aria-label="Project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setAssistant("");
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assistant
          <select
            value={assistant}
            onChange={(e) => setAssistant(e.target.value)}
          >
            <option value="">All assistants</option>
            {assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Recent activity</option>
            <option value="size">Size</option>
            <option value="assistants">Linked assistants</option>
          </select>
        </label>
      </div>
      {!error &&
        snapshot?.connected &&
        !snapshot.activeCount &&
        !snapshot.embeddingCount &&
        snapshot.historyAvailable && (
          <p className="overview-note">
            SIAAS Personal is not using any models right now. Installed models remain available.
          </p>
        )}
      <div className="overview-table-scroll">
        <table className="overview-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Size</th>
              <th>Status</th>
              <th>SIAAS Personal activity</th>
              <th>Assistants</th>
              <th>Projects</th>
              <th>Recent usage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.name} onClick={() => setSelected(m.name)}>
                <td>
                  <button
                    className="overview-model-button"
                    onClick={() => setSelected(m.name)}
                  >
                    {m.name}
                    <ArrowUpRight size={15} />
                  </button>
                  <small>
                    {[m.details.parameter_size, m.details.quantization_level]
                      .filter(Boolean)
                      .join(" · ") || "Local model"}
                  </small>
                </td>
                <td>{bytes(m.size)}</td>
                <td>{error ? "Out of date" : <State model={m} />}</td>
                <td>{error ? "Not detected" : activity(m)}</td>
                <td>{m.assistants.length}</td>
                <td>{m.projects.length}</td>
                <td>
                  {when(m.active[0]?.startedAt ?? m.recent[0]?.startedAt)}
                  {m.recent.length > 0 && (
                    <small>
                      {m.recent.length} richieste recenti · ultima{" "}
                      {seconds(m.recent[0].durationMs)}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="overview-empty" role="status">
            {!snapshot
              ? refreshing
                ? "Loading models…"
                : "Unable to load models. Select Retry."
              : !snapshot.connected && !models.length
                ? "Model data unavailable. Start Ollama and select Retry."
                : !models.length
                  ? "No installed local models to monitor."
                  : "No models match the selected filters."}
          </div>
        )}
      </div>
      <p className="overview-note">
        Installed: available in Ollama. Loaded: in memory. In use: a monitored SIAAS Personal call. Startup includes waiting and loading; Ollama does not expose activity from other applications. “Error” marks the last failed SIAAS Personal call.
      </p>
      {detail && (
        <ModelDetail
          model={
            error
              ? {
                  ...detail,
                  state: "unknown",
                  loaded: null,
                  memory: null,
                  vram: null,
                  contextLength: null,
                  active: [],
                }
              : detail
          }
          stale={stale}
          onClose={() => setSelected(null)}
          onAssistant={onAssistant}
          onProject={onProject}
        />
      )}
    </section>
  );
}
