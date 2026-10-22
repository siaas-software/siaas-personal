"use client";
import { useEffect, useState } from "react";
import type { DesktopUpdateState } from "@/desktop";

export function DesktopUpdatesPanel() {
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [error, setError] = useState("");
  const [italian, setItalian] = useState(false);
  useEffect(() => {
    setItalian(document.documentElement.lang.startsWith("it"));
    const bridge = window.siaasDesktop;
    if (!bridge) return;
    void bridge
      .updateState()
      .then(setUpdate)
      .catch(() => setError("Updates unavailable."));
    return bridge.onUpdateState(setUpdate);
  }, []);
  async function action(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const busy = update?.phase === "checking" || update?.phase === "activating";
  return (
    <section className="panel settings-panel">
      <h2>{italian ? "Aggiornamenti applicazione" : "Application updates"}</h2>
      <p>
        {italian
          ? "SIAAS Personal funziona localmente senza account. Gli aggiornamenti richiedono Internet e una release stabile ufficiale accessibile."
          : "SIAAS Personal runs locally without an account. Updates require Internet and an accessible official stable release."}
      </p>
      <p>
        <strong>
          {italian ? "Versione" : "Version"} {update?.version || "…"}
        </strong>
      </p>
      <p role="status">{update?.message}</p>
      {update?.nextVersion && (
        <p>
          {italian ? "Ultima versione stabile" : "Latest stable version"}:{" "}
          {update.nextVersion}
        </p>
      )}
      <div className="update-actions">
        <button
          className="button"
          disabled={!update || busy}
          onClick={() => void action(() => window.siaasDesktop!.checkUpdate())}
        >
          {italian ? "Verifica aggiornamenti" : "Check for updates"}
        </button>
        {update?.phase === "available" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void action(() => window.siaasDesktop!.installUpdate())
            }
          >
            {italian ? "Aggiorna ora" : "Update now"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
