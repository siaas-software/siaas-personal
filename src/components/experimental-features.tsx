"use client";
import { useCallback, useEffect, useState } from "react";
import { useInterfaceLanguage } from "./interface-language";
import type {
  ExperimentalFeature,
  ExperimentalStatus,
} from "@/lib/experimental";

export function useExperimentalStatus() {
  const [status, setStatus] = useState<ExperimentalStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/local/experimental", {
        cache: "no-store",
      });
      if (!response.ok) throw Error();
      setStatus(await response.json());
      setFailed(false);
    } catch {
      setStatus(null);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const update = () => {
      void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("siaas-experimental-change", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("siaas-experimental-change", update);
    };
  }, [refresh]);
  return { status, setStatus, failed, refresh };
}
export function ExperimentalFeaturesPanel() {
  const italian = useInterfaceLanguage();
  const t = (en: string, it: string) => (italian ? it : en);
  const { status, setStatus, failed, refresh } = useExperimentalStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function change(feature: ExperimentalFeature, enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/local/experimental", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, enabled }),
      });
      if (!response.ok) throw Error();
      const next = await response.json();
      setStatus(next);
      if (next.cleanupPending)
        setMessage(
          t(
            "Feature disabled. Service shutdown is pending: start Docker and use Retry shutdown.",
            "Funzionalità disattivata. Arresto del servizio in sospeso: avvia Docker e usa Riprova arresto.",
          ),
        );
      window.dispatchEvent(new Event("siaas-experimental-change"));
    } catch {
      setMessage(
        t(
          "Change failed. Check Docker, service logs, available memory, disk and Internet access, then refresh. No new enabled preference was saved.",
          "Modifica non riuscita. Controlla Docker, log dei servizi, memoria, spazio e accesso Internet, poi aggiorna. Nessuna nuova attivazione è stata salvata.",
        ),
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<ExperimentalFeature, string> = {
    advancedReasoning: t(
      "Advanced Reasoning (Beta)",
      "Ragionamento avanzato (Beta)",
    ),
    advancedWebResearch: t(
      "Advanced Web Research (Beta)",
      "Ricerca web avanzata (Beta)",
    ),
  };
  const states = {
    disabled: t("Off", "Disattivata"),
    docker_unavailable: t("Unavailable: Docker", "Non disponibile: Docker"),
    not_configured: t("Service not configured", "Servizio non configurato"),
    starting: t("Starting / downloading model", "Avvio / download modello"),
    ready: t("Ready", "Pronta"),
    error: t("Service unavailable", "Servizio non disponibile"),
  };
  const reasons: Record<string, string> = {
    not_installed: t(
      "Docker is not installed or not on PATH.",
      "Docker non è installato o non è nel PATH.",
    ),
    inaccessible: t(
      "Docker cannot be executed. Check permissions and PATH.",
      "Docker non può essere eseguito. Controlla permessi e PATH.",
    ),
    compose_unavailable: t(
      "Docker Compose v2 is required.",
      "È richiesto Docker Compose v2.",
    ),
    engine_unavailable: t(
      "Docker Engine is stopped or inaccessible. Check your user permissions.",
      "Docker Engine è arrestato o inaccessibile. Controlla i permessi del tuo utente.",
    ),
    unsupported_engine: t(
      "Use Linux containers on an x64/arm64 Engine 20.10 or newer.",
      "Usa container Linux su Engine 20.10 o successivo, x64/arm64.",
    ),
  };
  return (
    <section
      className="panel settings-panel experimental-features"
      aria-labelledby="experimental-heading"
    >
      <h2 id="experimental-heading">
        {t("Experimental Features", "Funzionalità sperimentali")}
      </h2>
      <p>
        {t(
          "Two independent, optional Beta features. Both are off by default and require Docker. Normal chat, local knowledge, selected websites and standard agents work without Docker.",
          "Due funzionalità Beta indipendenti e opzionali. Entrambe sono disattivate per impostazione predefinita e richiedono Docker. Chat normale, conoscenza locale, siti selezionati e agenti standard funzionano senza Docker.",
        )}
      </p>
      <p role="status">
        {!status
          ? failed
            ? t(
                "Status unavailable. Activation is blocked.",
                "Stato non disponibile. Attivazione bloccata.",
              )
            : t("Checking Docker…", "Verifica Docker…")
          : status.docker.ready
            ? t(
                "Docker is ready. Features remain off until you enable them.",
                "Docker è pronto. Le funzionalità restano disattivate finché non le attivi.",
              )
            : reasons[status.docker.reason]}
      </p>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {t("Refresh Status", "Aggiorna stato")}
      </button>
      <div className="experimental-options">
        {(Object.keys(labels) as ExperimentalFeature[]).map((feature) => (
          <div className="experimental-option" key={feature}>
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={status?.preferences[feature] ?? false}
                disabled={busy || !status?.docker.ready}
                onChange={(e) => void change(feature, e.target.checked)}
              />
              {labels[feature]}
            </label>
            <p>
              {feature === "advancedReasoning"
                ? t(
                    "Evaluate evidence coverage with a local decision service. The model downloads on first activation.",
                    "Valuta la copertura delle fonti con un servizio decisionale locale. Il modello viene scaricato alla prima attivazione.",
                  )
                : t(
                    "Discover additional Internet sources. Search queries and page requests leave your computer; documents and chat history are not attached.",
                    "Trova ulteriori fonti su Internet. Query e richieste di pagine escono dal computer; documenti e cronologia non vengono allegati.",
                  )}
            </p>
            <p role="status">
              {status ? states[status.services[feature].state] : "…"}
              {status?.preferences[feature] &&
              !status.services[feature].available
                ? t(
                    " — saved preference is on; capability is unavailable.",
                    " — preferenza salvata attiva; funzionalità non disponibile.",
                  )
                : ""}
            </p>
            {status?.services[feature].cleanupPending && (
              <p role="status">
                {t(
                  "Off; service shutdown is pending. Restore Docker, then retry shutdown.",
                  "Disattivata; arresto del servizio in sospeso. Ripristina Docker, poi riprova l’arresto.",
                )}{" "}
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void change(feature, false)}
                >
                  {t("Retry shutdown", "Riprova arresto")}
                </button>
              </p>
            )}
            {status?.preferences[feature] &&
              !status.services[feature].available &&
              status.docker.ready && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void change(feature, true)}
                >
                  {t("Retry service", "Riprova servizio")}
                </button>
              )}
            {status?.preferences[feature] && !status.docker.ready && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void change(feature, false)}
              >
                {t("Disable saved preference", "Disattiva preferenza salvata")}
              </button>
            )}
          </div>
        ))}
      </div>
      {busy && (
        <p role="status">
          {t(
            "Preparing service… First activation may take several minutes. Keep this page open.",
            "Preparazione servizio… La prima attivazione può richiedere diversi minuti. Mantieni aperta questa pagina.",
          )}
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      <details>
        <summary>
          {t("Docker setup instructions", "Istruzioni per Docker")}
        </summary>
        <ul>
          <li>
            {t(
              "Windows: install Docker Desktop, enable WSL 2 / hardware virtualization and Linux containers. Start Docker Desktop and wait for the engine.",
              "Windows: installa Docker Desktop, abilita WSL 2 / virtualizzazione hardware e container Linux. Avvia Docker Desktop e attendi il motore.",
            )}
          </li>
          <li>
            {t(
              "macOS: install Docker Desktop for your Intel or Apple Silicon computer and start it.",
              "macOS: installa Docker Desktop per il tuo computer Intel o Apple Silicon e avvialo.",
            )}
          </li>
          <li>
            {t(
              "Linux: install Docker Engine and the Compose v2 plugin, start the daemon and ensure your user can access Docker.",
              "Linux: installa Docker Engine e il plugin Compose v2, avvia il daemon e verifica l’accesso Docker del tuo utente.",
            )}
          </li>
        </ul>
        <p>
          <code>docker --version</code> · <code>docker compose version</code> ·{" "}
          <code>docker info</code>
        </p>
        <p>
          {t(
            "Use Linux containers, x64/arm64 and Docker Engine 20.10+. First setup needs Internet, disk space and enough memory for the evidence model. Refresh after fixing prerequisites; features never enable automatically.",
            "Usa container Linux, x64/arm64 e Docker Engine 20.10+. La prima configurazione richiede Internet, spazio e memoria sufficiente per il modello di valutazione. Aggiorna dopo aver sistemato i prerequisiti; le funzionalità non si attivano automaticamente.",
          )}
        </p>
      </details>
    </section>
  );
}
