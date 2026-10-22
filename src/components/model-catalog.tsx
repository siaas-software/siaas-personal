"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from "lucide-react";
import type { OllamaRuntime } from "@/lib/ollama";
import type { CatalogModel } from "@/lib/model-catalog";

import { recommendations, type ModelAdvice } from "@/lib/hardware";
import { ModelHardwareNote } from "./model-recommendation";

const PAGE_SIZE = 12;
export function ModelCatalog({
  runtime,
  advice,
  selected,
  busy,
  onDownload,
  onSelect,
}: {
  runtime: OllamaRuntime;
  advice: ModelAdvice;
  selected?: string | null;
  busy: boolean;
  onDownload: (id: string) => void;
  onSelect?: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setWarning("");
    fetch(`/api/local/model-catalog${refreshKey ? "?refresh=1" : ""}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Catalog unavailable.");
        if (controller.signal.aborted) return;
        setCatalog(data.models);
        advice.onCatalogChange?.(data.models);
        setUpdatedAt(data.updatedAt);
        setWarning(data.warning ?? "");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setWarning(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, advice.onCatalogChange]);
  const models = useMemo(() => {
    const all = new Map(catalog.map((m) => [m.id, { ...m, installed: false }]));
    for (const m of runtime.models.filter((m) => m.available)) {
      const id = m.id.slice(7);
      all.set(id, {
        ...(all.get(id) ?? { id, name: m.name, family: id.split(":")[0] }),
        installed: true,
      });
    }
    const q = query.trim().toLowerCase();
    return [...all.values()]
      .filter(
        (m) =>
          (!installedOnly || m.installed) &&
          `${m.id} ${m.name}`.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(b.installed) - Number(a.installed) ||
          a.name.localeCompare(b.name),
      );
  }, [catalog, runtime.models, query, installedOnly]);
  const compatibility = recommendations(advice.hardware, models);
  const pages = Math.max(1, Math.ceil(models.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = models.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <section
      className="panel delivery-panel model-catalog"
      aria-label="Model catalog"
    >
      <div className="section-toolbar">
        <div>
          <h2>All models</h2>
          <p className="muted small">
            Local chat models from Ollama and models installed on this PC. Check
            the requirements for models outside the recommendations.
          </p>
        </div>
        <button
          className="button compact"
          disabled={loading || busy}
          onClick={() => setRefreshKey((n) => n + 1)}
        >
          Refresh catalog
        </button>
      </div>
      <div className="model-catalog-filters">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search models"
            type="search"
            placeholder="Name, family or size…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Show
          <select
            aria-label="Filter models"
            value={installedOnly ? "installed" : "all"}
            onChange={(e) => {
              setInstalledOnly(e.target.value === "installed");
              setPage(1);
            }}
          >
            <option value="all">All models</option>
            <option value="installed">Installed only</option>
          </select>
        </label>
      </div>
      {warning && (
        <p className="notice" role="status">
          {warning}
        </p>
      )}
      <p className="muted small" role="status">
        {loading
          ? "Loading catalog…"
          : `${models.length} ${models.length === 1 ? "modello" : "modelli"} · pagina ${current} di ${pages}`}
        {updatedAt && ` · catalog from ${updatedAt}`}
      </p>
      <div className="hardware-models">
        {visible.map((m) => (
          <article
            key={m.id}
            className={`hardware-card ${selected === `ollama/${m.id}` ? "chosen" : ""}`}
          >
            <span className="eyebrow">
              {m.installed ? "INSTALLED" : "OLLAMA CATALOG"}
            </span>
            <h3>{m.name}</h3>
            <ModelHardwareNote
              model={compatibility.find((option) => option.id === m.id)}
            />
            {(() => {
              const estimate = compatibility.find(
                (option) => option.id === m.id,
              );
              return estimate ? (
                <p className="small">
                  {estimate.sizeB}B · {estimate.quantization}
                  <br />
                  {estimate.estimated ? "Estimated" : "Catalog"} download:{" "}
                  {estimate.downloadGB} GB · RAM budget: {estimate.ramGB} GB ·
                  runtime: {estimate.memoryGB} GB · free disk: {estimate.diskGB}{" "}
                  GB
                </p>
              ) : (
                <p className="small">
                  Parameter size unknown. Check model requirements before
                  downloading.
                </p>
              );
            })()}
            <code>{m.id}</code>
            <a
              href={`https://ollama.com/${m.family.includes("/") ? "" : "library/"}${m.family}`}
              target="_blank"
              rel="noreferrer"
            >
              Details and requirements ↗
            </a>
            <button
              className="button compact"
              disabled={busy || !runtime.connected || m.installed}
              onClick={() => onDownload(m.id)}
            >
              {m.installed ? <Check size={14} /> : <Download size={14} />}{" "}
              {m.installed ? "Installed" : "Download model"}
            </button>
            {onSelect && (
              <button
                className="button compact"
                disabled={busy || !m.installed || selected === `ollama/${m.id}`}
                onClick={() => onSelect(m.id)}
              >
                {selected === `ollama/${m.id}`
                  ? "Selected"
                  : "Use for assistant"}
              </button>
            )}
          </article>
        ))}
      </div>
      {!loading && !visible.length && <p>No models match your search.</p>}
      <nav className="catalog-pagination" aria-label="Model pages">
        <button
          className="button compact"
          disabled={current === 1}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <span>
          Pagina {current} di {pages}
        </span>
        <button
          className="button compact"
          disabled={current === pages}
          onClick={() => setPage(current + 1)}
        >
          Next
          <ChevronRight size={16} />
        </button>
      </nav>
    </section>
  );
}
