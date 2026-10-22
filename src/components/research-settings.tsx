"use client";
import { useExperimentalStatus } from "./experimental-features";
import { useState } from "react";
import { useInterfaceLanguage } from "./interface-language";
import { researchSettingsSchema, type ResearchSettings } from "@/lib/research";
export function ResearchSettingsFields({
  initial,
}: {
  initial?: ResearchSettings;
}) {
  const italian = useInterfaceLanguage();
  const t = (en: string, it: string) => (italian ? it : en);
  const [value, setValue] = useState<ResearchSettings>(() =>
    researchSettingsSchema.parse(initial ?? {}),
  );
  const { status, refresh } = useExperimentalStatus();
  const advancedAvailable = !!status?.services.advancedWebResearch.available;
  return (
    <fieldset className="research-settings">
      <legend>{t("Assistant research", "Ricerca dell’assistente")}</legend>
      <input type="hidden" name="research" value={JSON.stringify(value)} />
      <p className="field-help">
        {t(
          "Local indexed documents come first, then approved configured websites when needed. Both work without Docker. Websites are read on demand, not automatically imported into persistent knowledge.",
          "Prima i documenti locali indicizzati, poi i siti configurati autorizzati quando servono. Entrambi funzionano senza Docker. I siti vengono letti su richiesta, senza importazione automatica nella conoscenza persistente.",
        )}
      </p>
      <details className="field-help">
        <summary>
          {t("How sources are chosen", "Come vengono scelte le fonti")}
        </summary>
        <p className="field-help">
          {t(
            "Every assistant can use both local indexed documents and configured websites. Local sources come first. Websites are consulted only when local sources cover less than 80% of meaningful question terms, or current/website information is requested. This deterministic routing rule needs no Docker and does not verify correctness. Greetings and explicit local-only requests do not access websites.",
            "Ogni assistente può usare documenti locali indicizzati e siti configurati. Prima vengono le fonti locali. I siti vengono consultati solo se le fonti coprono meno dell’80% dei termini significativi della domanda, o sono richieste informazioni attuali/dai siti. La regola è deterministica, non richiede Docker e non verifica la correttezza. Saluti e richieste esplicitamente limitate ai documenti non accedono ai siti.",
          )}
        </p>
      </details>
      {value.migrationNotice === "legacy_web" && (
        <p className="notice" role="status">
          {t(
            "Your previous Advanced mode was migrated with this assistant’s Beta OFF. Websites and limits were preserved. Enable the Beta explicitly when the global service is ready.",
            "La precedente modalità avanzata è stata migrata con la Beta di questo assistente DISATTIVATA. Siti e limiti sono conservati. Attiva la Beta esplicitamente quando il servizio globale è pronto.",
          )}
        </p>
      )}
      {!value.websitesConfirmed && value.websites.length > 0 && (
        <div className="notice">
          <p>
            {t(
              "These saved websites were inactive in the previous Local Knowledge configuration. Confirm their use before the first request; no website is contacted by migration.",
              "Questi siti salvati erano inattivi nella precedente configurazione Conoscenza locale. Conferma l’utilizzo prima della prima richiesta; la migrazione non contatta i siti.",
            )}
          </p>
          <button
            type="button"
            className="button"
            onClick={() =>
              setValue({
                ...value,
                websitesConfirmed: true,
                migrationNotice:
                  value.migrationNotice === "legacy_documents"
                    ? undefined
                    : value.migrationNotice,
              })
            }
          >
            {t(
              "Allow configured website consultation",
              "Consenti consultazione dei siti configurati",
            )}
          </button>
        </div>
      )}
      <label className="research-beta-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={value.advancedWebResearch}
          disabled={!advancedAvailable && !value.advancedWebResearch}
          onChange={(e) =>
            setValue({
              ...value,
              advancedWebResearch: e.target.checked,
              migrationNotice: undefined,
            })
          }
        />
        {t("Advanced Web Research (Beta)", "Ricerca web avanzata (Beta)")}
      </label>
      <p className="field-help" role="status">
        {advancedAvailable
          ? t(
              "Available as an optional fallback after local sources and configured websites. Enable for this assistant only if you want generic Internet discovery.",
              "Disponibile come ripiego opzionale dopo fonti locali e siti configurati. Attivala per questo assistente solo se vuoi la scoperta Internet generica.",
            )
          : t(
              "Unavailable: enable the global Beta in Settings > Experimental Features and check Docker and service readiness. Saved consent is preserved; sources still work normally.",
              "Non disponibile: attiva la Beta globale in Impostazioni > Funzionalità sperimentali e verifica Docker e servizio. Il consenso salvato è conservato; le fonti standard continuano a funzionare.",
            )}
      </p>
      <button type="button" className="button" onClick={() => void refresh()}>
        {t("Refresh Beta status", "Aggiorna stato Beta")}
      </button>
      <p className="field-help">
        {t(
          "Advanced Reasoning (Beta) is a separate global option that evaluates evidence. It is independent of this assistant’s web fallback. Both Beta services require Docker.",
          "Ragionamento avanzato (Beta) è un’opzione globale separata che valuta le fonti. È indipendente dal ripiego web di questo assistente. Entrambi i servizi Beta richiedono Docker.",
        )}
      </p>
      <p className="field-help">
        {t(
          "Knowledge Sources are imported and stored as persistent assistant knowledge. Selected Websites are consulted on demand and are not automatically imported into Knowledge Sources.",
          "Le fonti di conoscenza vengono importate e conservate come conoscenza persistente dell’assistente. I siti selezionati vengono consultati su richiesta e non sono importati automaticamente nelle fonti di conoscenza.",
        )}
      </p>
      <>
        <p className="field-help">
          {t(
            "Documents and configured websites work with standard chat models too. Optional advanced Internet discovery uses the local model and may be limited by its tool capabilities.",
            "Documenti e siti configurati funzionano anche con modelli per chat standard. La scoperta Internet opzionale usa il modello locale e può essere limitata dalle sue capacità con gli strumenti.",
          )}
        </p>
        {value.websites.map((site, index) => (
          <div className="research-website" key={index}>
            <label>
              {t("Website URL", "URL del sito")} {index + 1}
              <input
                type="url"
                required
                value={site.url}
                maxLength={1500}
                placeholder="https://esempio.it/documentazione/"
                onChange={(e) =>
                  setValue({
                    ...value,
                    websites: value.websites.map((s, i) =>
                      i === index ? { ...s, url: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label>
              {t("Scope", "Ambito")}
              <select
                value={site.scope}
                onChange={(e) =>
                  setValue({
                    ...value,
                    websites: value.websites.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            scope: e.target.value as "page" | "section",
                          }
                        : s,
                    ),
                  })
                }
              >
                <option value="page">{t("Page", "Pagina")}</option>
                <option value="section">
                  {t(
                    "Section and direct links",
                    "Sezione e collegamenti diretti",
                  )}
                </option>
              </select>
            </label>
            <button
              type="button"
              className="button"
              aria-label={`${t("Remove website", "Rimuovi sito")} ${index + 1}`}
              onClick={() =>
                setValue({
                  ...value,
                  websites: value.websites.filter((_, i) => i !== index),
                })
              }
            >
              {t("Remove", "Rimuovi")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button"
          disabled={value.websites.length >= 10}
          onClick={() =>
            setValue({
              ...value,
              websites: [...value.websites, { url: "", scope: "page" }],
            })
          }
        >
          {t("Add website", "Aggiungi sito")}
        </button>
        <p className="field-help">
          {t(
            "Page reads only the configured page. Section also follows direct links within the same website and path. Evidence remains in the conversation; it is not automatically imported.",
            "Pagina legge solo la pagina configurata. Sezione segue anche i collegamenti diretti nello stesso sito e percorso. Le fonti rimangono nella conversazione e non vengono importate automaticamente.",
          )}
        </p>
        <div className="research-limits">
          <label>
            {t("Maximum pages", "Numero massimo di pagine")}
            <input
              type="number"
              min={1}
              max={12}
              required
              value={value.maxPages}
              onChange={(e) =>
                setValue({ ...value, maxPages: Number(e.target.value) })
              }
            />
          </label>
          <label>
            {t(
              "Research timeout (seconds)",
              "Tempo massimo di ricerca (secondi)",
            )}
            <input
              type="number"
              min={20}
              max={120}
              required
              value={value.timeoutSeconds}
              onChange={(e) =>
                setValue({ ...value, timeoutSeconds: Number(e.target.value) })
              }
            />
          </label>
          {value.advancedWebResearch && (
            <label>
              {t("Maximum web searches", "Numero massimo di ricerche web")}
              <input
                type="number"
                min={1}
                max={4}
                required
                value={value.maxSearches}
                onChange={(e) =>
                  setValue({ ...value, maxSearches: Number(e.target.value) })
                }
              />
            </label>
          )}
        </div>
        {value.advancedWebResearch && (
          <p className="notice">
            {t(
              "Advanced Web Research requires Docker. Only public search terms from your current question may be sent to search engines. No query is generated from documents or history. Searches with detected private context are skipped; detection is conservative and cannot guarantee anonymisation. Avoid confidential questions.",
              "La Ricerca web avanzata richiede Docker. Solo termini pubblici della domanda attuale possono essere inviati ai motori. Non vengono generate query da documenti o cronologia. Ricerche con contesto privato rilevato vengono saltate; il controllo è prudente e non garantisce anonimizzazione. Evita domande riservate.",
            )}
          </p>
        )}
      </>
    </fieldset>
  );
}
