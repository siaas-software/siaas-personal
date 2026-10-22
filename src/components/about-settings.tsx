"use client";
import { useEffect, useRef, useState } from "react";
import type { LicenseDocument } from "@/lib/licenses";
import { useInterfaceLanguage } from "./interface-language";

export function AboutSettings({ version }: { version?: string }) {
  const italian = useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [documents, setDocuments] = useState<LicenseDocument[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const current = documents.find((document) => document.id === selected);

  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    else if (!selected) dialog.current?.close();
  }, [selected]);

  async function openDocument(id: string) {
    setSelected(id);
    if (documents.length) return;
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/licenses", { cache: "no-store" });
      if (!response.ok) throw new Error("License files unavailable");
      setDocuments(await response.json());
    } catch {
      setError(
        italian
          ? "Impossibile leggere le licenze locali. Riprova o ripara l’installazione."
          : "Unable to read local license files. Retry or repair the installation.",
      );
    } finally {
      setLoading(false);
    }
  }

  const technologies = [
    {
      id: "siaas",
      name: "SIAAS Personal",
      license: "MIT",
      repository: "https://github.com/siaas-software/siaas-personal",
      description: italian
        ? "Assistenti AI locali, gratuiti e open source."
        : "Free, open-source local AI assistants.",
    },
    {
      id: "laya",
      name: "Laya",
      license: "Apache-2.0",
      repository: "https://github.com/NandhaKishorM/laya",
      description: italian
        ? "Advanced Reasoning e workflow decisionali: pacchetto Python Laya 0.4.6 non modificato, installato nel servizio Docker opzionale."
        : "Supports Advanced Reasoning and decision workflows through the unmodified Laya 0.4.6 Python package installed in the optional Docker service.",
    },
    {
      id: "morphic",
      name: "Morphic",
      license: "Apache-2.0",
      repository: "https://github.com/miurla/morphic",
      description: italian
        ? "L’adattamento SIAAS del ricercatore Morphic (revisione 62e0816) supporta Advanced Web Research opzionale come servizio Node locale; SearXNG è separato."
        : "The SIAAS adaptation supports optional Advanced Web Research as a local Node service, based on Morphic revision 62e0816; SearXNG runs separately.",
    },
  ];

  return (
    <section
      className="panel settings-panel about-settings"
      aria-labelledby="about-title"
    >
      <h2 id="about-title">{italian ? "Informazioni" : "About"}</h2>
      <p>
        SIAAS Personal · {italian ? "Versione" : "Version"} {version || "…"}
      </p>
      <h3>{italian ? "Open source e licenze" : "Open Source & Licenses"}</h3>
      <p>
        {italian
          ? "Licenze e avvisi sono inclusi nell’applicazione e consultabili anche senza Internet. I collegamenti GitHub si aprono nel browser e richiedono Internet."
          : "Licenses and notices are included with the application and available offline. GitHub links open in your browser and require Internet."}
      </p>
      <div className="license-technologies">
        {technologies.map((technology) => (
          <article key={technology.id} className="license-technology">
            <h4>{technology.name}</h4>
            <p>
              {italian ? "Licenza" : "License"}:{" "}
              <strong>{technology.license}</strong>
            </p>
            <p>{technology.description}</p>
            <div className="button-row">
              <button
                className="button compact"
                onClick={() => void openDocument(technology.id)}
              >
                {italian ? "Visualizza licenza" : "View License"}
                <span className="sr-only"> — {technology.name}</span>
              </button>
              <a
                className="button compact"
                href={technology.repository}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${technology.name} GitHub (${italian ? "browser esterno" : "external browser"})`}
              >
                GitHub ↗
              </a>
            </div>
          </article>
        ))}
      </div>
      <p>
        {italian
          ? "SIAAS Personal è un progetto indipendente, non ufficialmente affiliato né approvato da questi progetti di terze parti."
          : "SIAAS Personal is an independent project and is not officially affiliated with or endorsed by these third-party projects."}
      </p>
      <button className="button" onClick={() => void openDocument("notices")}>
        {italian
          ? "Visualizza avvisi di terze parti"
          : "View Third-Party Notices"}
      </button>
      <dialog
        ref={dialog}
        className="license-dialog"
        aria-labelledby="license-dialog-title"
        onClose={() => setSelected(null)}
      >
        <div className="license-dialog-header">
          <h3 id="license-dialog-title">
            {italian ? "Licenze e avvisi" : "Licenses & Notices"}
          </h3>
          <button
            autoFocus
            className="button compact"
            onClick={() => setSelected(null)}
          >
            {italian ? "Chiudi" : "Close"}
          </button>
        </div>
        {loading && (
          <p role="status">
            {italian ? "Lettura dei file locali…" : "Reading local files…"}
          </p>
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              className="button"
              onClick={() => void openDocument(selected || "notices")}
            >
              {italian ? "Riprova" : "Retry"}
            </button>
          </div>
        )}
        {!!documents.length && (
          <>
            <label className="license-document-select">
              {italian ? "Documento" : "Document"}
              <select
                value={selected || "notices"}
                onChange={(event) => setSelected(event.target.value)}
              >
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </label>
            <h4>{current?.title}</h4>
            <pre className="license-text" tabIndex={0}>
              {current?.content}
            </pre>
          </>
        )}
      </dialog>
    </section>
  );
}
