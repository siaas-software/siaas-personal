"use client";
import { useEffect, useRef, useState } from "react";
import { Download, HardDrive, LoaderCircle, Check, X } from "lucide-react";
import { EMBEDDING_MODEL } from "@/lib/catalog";
import type { OllamaRuntime } from "@/lib/ollama";
import { ModelCatalog } from "./model-catalog";
import { HardwareAdvisor } from "./hardware-advisor";
export function LocalSetup({
  runtime,
  model,
  onModel,
  refresh,
}: {
  runtime: OllamaRuntime;
  model?: string | null;
  onModel?: (id: string) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const [selecting, setSelecting] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const [desktopBridge, setDesktopBridge] = useState(false);
  useEffect(() => {
    setDesktopBridge(!!window.siaasDesktop);
    let active = true;
    void window.siaasDesktop?.getSetupError().then((message) => {
      if (active && message) setError(message);
    });
    const unsubscribe = window.siaasDesktop?.onSetupProgress((event) =>
      setSetupMessage(event.message),
    );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  async function setupOllama() {
    if (!window.siaasDesktop) return;
    setSetup(true);
    setError("");
    setSetupMessage("Checking Ollama…");
    try {
      const result = await window.siaasDesktop.setupOllama();
      if (!result.ok) throw new Error(result.error || "Setup failed.");
      setSetupMessage(result.message || "Ollama is ready.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSetup(false);
    }
  }
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function download(id: string) {
    setDownloading(id);
    setError("");
    setProgress("Starting download…");
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/local/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
        signal: abort.current.signal,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const reader = res.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        success = false;
      try {
        for (;;) {
          const part = await reader.read();
          buffer += decoder.decode(part.value, { stream: !part.done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          if (part.done && buffer.trim()) lines.push(buffer);
          if (buffer.length > 1_000_000)
            throw new Error("Invalid download response.");
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.error)
              throw new Error(
                "Ollama did not complete the download: " +
                  String(event.error).slice(0, 300),
              );
            if (event.status === "success") success = true;
            setProgress(
              event.total
                ? `Download: ${Math.min(100, Math.round((100 * (event.completed || 0)) / event.total))}%`
                : event.status === "success"
                  ? "Model ready"
                  : "Preparing model…",
            );
          }
          if (part.done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!success)
        throw new Error(
          "Download interrupted. Retry to resume from the downloaded parts.",
        );
      await refresh();
    } catch (e) {
      setError(
        (e as Error).name === "AbortError"
          ? "Download stopped. You can resume it at any time."
          : (e as Error).message,
      );
    } finally {
      setDownloading("");
      abort.current = null;
    }
  }
  function selectModel(id: string) {
    if (!onModel) return;
    setSelecting(true);
    setError("");
    void onModel("ollama/" + id)
      .catch((e) => setError(e.message))
      .finally(() => setSelecting(false));
  }
  return (
    <div className="delivery-stack local-setup">
      <section className="panel delivery-panel">
        <div className="delivery-title">
          <HardDrive size={24} />
          <div>
            <span className="eyebrow">ON YOUR PC · LOCAL AI</span>
            <h2>Set up your local AI</h2>
          </div>
        </div>
        <p>
          Documents and conversations stay on this PC. No API fees: you use your
          computer’s resources and energy.
        </p>
        {!runtime.connected ? (
          <div className="notice">
            <div>
              <strong>Open Ollama to begin</strong>
              <p>
                SIAAS Personal can find and start an existing Ollama
                installation, or download it for this PC. Choose models in the
                next step.
              </p>
              {desktopBridge && (
                <p>
                  <button
                    className="button primary"
                    disabled={setup}
                    onClick={() => void setupOllama()}
                  >
                    {setup ? "Setting up…" : "Set up Ollama automatically"}
                  </button>
                </p>
              )}
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noreferrer"
              >
                Manual installation ↗
              </a>
              <p>
                <button className="button" onClick={() => void refresh()}>
                  Check connection
                </button>
              </p>
            </div>
          </div>
        ) : (
          <p className="status ready">
            <Check size={14} /> Ollama connected
          </p>
        )}
        {setupMessage && (
          <div className="notice" role="status">
            {setup && <LoaderCircle className="spin" size={18} />}
            <span>{setupMessage}</span>
            {setup && (
              <button
                className="button compact"
                onClick={() => void window.siaasDesktop?.cancelSetup()}
              >
                Cancel download
              </button>
            )}
          </div>
        )}
        <div className="model-download-row">
          <div>
            <strong>Document understanding</strong>
            <p className="muted small">
              EmbeddingGemma · about 0.6 GB. Finds relevant passages in your
              sources.
            </p>
          </div>
          <button
            className="button"
            disabled={
              !runtime.connected || !!downloading || runtime.embeddingReady
            }
            onClick={() => void download(EMBEDDING_MODEL)}
          >
            {runtime.embeddingReady ? "Ready" : "Download for documents"}
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {downloading && (
          <div className="notice" role="status">
            <LoaderCircle className="spin" size={18} />
            {downloading} · {progress}
            <button
              className="button compact"
              onClick={() => abort.current?.abort()}
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        )}
      </section>
      <HardwareAdvisor
        renderCatalog={(advice) => (
          <ModelCatalog
            runtime={runtime}
            advice={advice}
            selected={model}
            busy={selecting || !!downloading}
            onDownload={(id) => void download(id)}
            onSelect={onModel ? selectModel : undefined}
          />
        )}
        desktop
      />
    </div>
  );
}
