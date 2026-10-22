"use client";
import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import {
  recommendations,
  sizeProfiles,
  type Hardware,
  type ModelAdvice,
} from "@/lib/hardware";
import type { CatalogModel } from "@/lib/model-catalog";
import snapshot from "@/lib/ollama-catalog.json";

export function HardwareAdvisor({
  desktop = false,
  renderCatalog,
}: {
  desktop?: boolean;
  renderCatalog?: (advice: ModelAdvice) => React.ReactNode;
}) {
  const [hardware, setHardware] = useState<Hardware>({
    ram: 16,
    gpu: "cpu",
    vram: 0,
    disk: 20,
  });
  const [catalog, setCatalog] = useState<CatalogModel[]>(snapshot.models);
  const manual = useRef(false);
  const [detected, setDetected] = useState("");
  useEffect(() => {
    if (!desktop) return;
    const controller = new AbortController();
    fetch("/api/local/hardware", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            "Detection unavailable: enter specifications manually.",
          );
        const d = await res.json();
        if (manual.current) return;
        setHardware(d.hardware);
        setDetected(
          `${d.cpu} · ${d.gpuName}. RAM libera al rilevamento: ${d.freeRam} GB. ${d.note}`,
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError" && !manual.current)
          setDetected(
            `${e.message} Initial values are examples; enter your specifications.`,
          );
      });
    return () => controller.abort();
  }, [desktop]);
  const options = recommendations(hardware, catalog);
  const profiles = sizeProfiles(options);
  function updateHardware(next: Hardware) {
    manual.current = true;
    setHardware(next);
    setDetected("Using your manual specifications.");
  }
  return (
    <>
      <section className="panel delivery-panel">
        <div className="delivery-title">
          <Monitor size={22} />
          <div>
            <span className="eyebrow">DESTINATION · YOUR PC</span>
            <h2>Find the right model</h2>
          </div>
        </div>
        <p className="muted">
          {desktop
            ? detected ||
              "Detecting computer resources… Initial values are examples until detection completes."
            : "Enter the specifications of the computer that will run the assistant. Initial values are examples."}
        </p>
        <div className="hardware-fields">
          <label>
            Total RAM (GB)
            <input
              type="number"
              min="1"
              max="1024"
              value={hardware.ram}
              onChange={(e) =>
                updateHardware({
                  ...hardware,
                  ram: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </label>
          <label>
            Graphics processor
            <select
              value={hardware.gpu}
              onChange={(e) =>
                updateHardware({
                  ...hardware,
                  gpu: e.target.value as Hardware["gpu"],
                })
              }
            >
              <option value="cpu">CPU / integrated graphics</option>
              <option value="dedicated">Dedicated GPU</option>
              <option value="unified">Apple Silicon · unified memory</option>
            </select>
          </label>
          {hardware.gpu === "dedicated" && (
            <label>
              Dedicated VRAM (GB)
              <input
                type="number"
                min="0"
                max="256"
                value={hardware.vram}
                onChange={(e) =>
                  updateHardware({
                    ...hardware,
                    vram: Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </label>
          )}
          <label>
            Free disk space (GB)
            <input
              type="number"
              min="0"
              max="100000"
              value={hardware.disk}
              onChange={(e) =>
                updateHardware({
                  ...hardware,
                  disk: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </label>
        </div>
        <p className="notice" role="status">
          Compatible parameter sizes from the Ollama catalog are shown below.
          Each size has at least one entry within your memory and disk budgets;
          other models or quantizations of the same size may not fit. Choose and
          download a specific model in the catalog yourself.
        </p>
        <div className="hardware-models">
          {profiles.map((profile) => (
            <article className="hardware-card" key={profile.tier}>
              <span className="eyebrow">{profile.tier}</span>
              <h3>
                {profile.sizes.length
                  ? profile.sizes.map((n) => `${n}B`).join(" · ")
                  : "No compatible sizes"}
              </h3>
              <p>{profile.description}</p>
              <p role="status">
                {profile.compatible.length} catalog entries fit the planning
                budget.
              </p>
              {profile.compatible.length > 0 ? (
                <p className="small">
                  RAM budgets:{" "}
                  {Math.min(...profile.compatible.map((m) => m.ramGB))}–
                  {Math.max(...profile.compatible.map((m) => m.ramGB))} GB. Free
                  disk budgets:{" "}
                  {Math.min(...profile.compatible.map((m) => m.diskGB))}–
                  {Math.max(...profile.compatible.map((m) => m.diskGB))} GB.{" "}
                  {profile.compatible.some((m) => m.accelerated)
                    ? "Some entries fit GPU memory; verify Ollama GPU support."
                    : "CPU · slower response. GPU memory may be insufficient for full offload."}
                </p>
              ) : (
                <p className="hardware-warning">
                  {profile.entries.length
                    ? "Increase RAM or free disk space; inspect individual requirements in the catalog."
                    : "No catalog entries with a known parameter size in this profile."}
                </p>
              )}
            </article>
          ))}
        </div>
        <p className="field-help">
          Planning estimates for one user at 4,096 tokens, not measured
          performance. Catalog metadata is used when available. Otherwise
          weights are estimated from total parameters and quantization (FP16
          when unknown), with 20% overhead; runtime adds 20% plus 2 GB, system
          RAM reserves 4 GB, and free disk reserves twice the download plus 1
          GB. Context, architecture, GPU support and other applications can
          increase requirements. Dedicated RAM and VRAM are separate; unified
          memory is counted once. Unknown-size entries remain available in the
          catalog without a compatibility claim. CPU-only inference may be slow.
          Parameter count alone predicts neither speed nor quality.{" "}
          <a
            href="https://docs.ollama.com/context-length"
            target="_blank"
            rel="noreferrer"
          >
            Contesto e memoria ↗
          </a>
        </p>
      </section>
      {renderCatalog?.({
        options,
        hardware,
        onCatalogChange: setCatalog,
      })}
    </>
  );
}
