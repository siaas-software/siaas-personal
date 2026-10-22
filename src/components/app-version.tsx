"use client";
import { useEffect, useState } from "react";
import { useInterfaceLanguage } from "./interface-language";

export function AppVersion({ version }: { version?: string }) {
  const [installed, setInstalled] = useState<string>();
  const italian = useInterfaceLanguage();
  useEffect(() => {
    const bridge = window.siaasDesktop;
    if (!bridge) return;
    let active = true;
    void bridge
      .updateState()
      .then((state) => {
        if (active) setInstalled(state.version);
      })
      .catch(() => {});
    const unsubscribe = bridge.onUpdateState((state) =>
      setInstalled(state.version),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <small className="app-version">
      {italian ? "Versione" : "Version"} {installed || version || "…"}
    </small>
  );
}
