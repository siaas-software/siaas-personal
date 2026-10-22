import { sourceWorkflowDecision, publicSearchQuery } from "../research-policy";
import { experimentalPreferences } from "./experimental-features";
import { createHash } from "node:crypto";
import type { AgentStep, Source } from "../catalog";
import {
  researchSettingsSchema,
  withinWebsite,
  type ResearchSettings,
  type ResearchDecision,
} from "../research";
import {
  readPublicPage,
  excerptForQuery,
  validatePublicDestination,
} from "./public-web";
import { assessEvidence, researchWithMorphic } from "./research-services";

export type ResearchResult = {
  sources: Source[];
  steps: AgentStep[];
  warnings: string[];
  missing: string[];
};
type Dependencies = {
  assess: typeof assessEvidence;
  read: typeof readPublicPage;
  research: typeof researchWithMorphic;
  validate: typeof validatePublicDestination;
  features: () => { advancedReasoning: boolean; advancedWebResearch: boolean };
};
const defaultDependencies: Dependencies = {
  features: experimentalPreferences,
  assess: assessEvidence,
  read: readPublicPage,
  research: researchWithMorphic,
  validate: validatePublicDestination,
};
export function webSource(
  page: { url: string; title: string; content: string; fetchedAt: string },
  kind: "website" | "web",
  question: string,
): Source {
  const id =
    "web_" + createHash("sha256").update(page.url).digest("hex").slice(0, 24);
  return {
    id,
    document_id: id,
    title: page.title,
    content: excerptForQuery(page.content, question, 3000),
    similarity: 0,
    position: 0,
    kind,
    url: page.url,
    fetched_at: page.fetchedAt,
  };
}
export async function runResearchWorkflow(
  options: {
    settings: ResearchSettings;
    assistantId?: string;
    question: string;
    modelId: string;
    sources: Source[];
    signal: AbortSignal;
    language?: "en" | "it";
    emit: (
      event:
        | { type: "activity"; text: string }
        | { type: "sources"; sources: Source[] }
        | { type: "steps"; steps: AgentStep[] }
        | { type: "research"; warnings: string[]; missing: string[] },
    ) => void;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<ResearchResult> {
  const settings = researchSettingsSchema.parse(options.settings);
  const t = (en: string, it: string) => (options.language === "it" ? it : en);
  const result: ResearchResult = {
    sources: [...options.sources],
    steps: [],
    warnings: [],
    missing: [],
  };
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(settings.timeoutSeconds * 1000),
  ]);
  const step = (
    tool: AgentStep["tool"],
    detail: string,
    status: AgentStep["status"] = "success",
  ) => {
    result.steps.push({ tool, detail, status });
    options.emit({ type: "steps", steps: [...result.steps] });
  };
  const remember = (s: Source) => {
    const index = result.sources.findIndex((x) => x.id === s.id);
    if (index >= 0) result.sources[index] = s;
    else if (result.sources.length < 20) result.sources.push(s);
    options.emit({ type: "sources", sources: [...result.sources] });
  };
  let activeTool: AgentStep["tool"] = "search_websites";
  try {
    signal.throwIfAborted();
    const local = sourceWorkflowDecision(options.question, result.sources);
    if (settings.migrationNotice === "legacy_web")
      result.warnings.push(
        t(
          "The previous Advanced mode was migrated with the assistant Beta OFF. Enable it explicitly in assistant configuration after the global service is ready.",
          "La precedente modalità avanzata è stata migrata con la Beta dell’assistente DISATTIVATA. Attivala esplicitamente nella configurazione quando il servizio globale è pronto.",
        ),
      );
    if (local.reason === "conversation") return result;
    if (!settings.websitesConfirmed && settings.websites.length)
      result.warnings.push(
        t(
          "Saved websites were inactive in the previous configuration. Confirm their use in assistant configuration before on-demand consultation; URLs are preserved.",
          "I siti salvati erano inattivi nella configurazione precedente. Conferma il loro utilizzo nella configurazione dell’assistente prima della consultazione; gli URL sono conservati.",
        ),
      );
    const features = dependencies.features();
    let pages = 0;
    if (
      local.consultWebsites &&
      settings.websites.length &&
      settings.websitesConfirmed
    ) {
      options.emit({
        type: "activity",
        text:
          local.reason === "freshness"
            ? t(
                "Current or website information requested: consulting configured websites…",
                "Richieste informazioni attuali o dai siti: consulto i siti configurati…",
              )
            : t(
                "Local sources do not cover enough question terms: consulting configured websites…",
                "Le fonti locali non coprono abbastanza termini della domanda: consulto i siti configurati…",
              ),
      });
      const queue = settings.websites.map((s) => s.url);
      const visited = new Set<string>();
      const siteBudget =
        settings.advancedWebResearch && features.advancedWebResearch
          ? Math.max(
              1,
              settings.maxPages -
                Math.min(2, Math.floor(settings.maxPages / 2)),
            )
          : settings.maxPages;
      while (queue.length && pages < siteBudget) {
        signal.throwIfAborted();
        const url = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);
        pages++;
        try {
          const page = await dependencies.read(url, signal, settings.websites);
          remember(webSource(page, "website", options.question));
          if (
            settings.websites.some(
              (s) => s.url === url && s.scope === "section",
            )
          )
            queue.push(
              ...page.links
                .filter(
                  (l) =>
                    settings.websites.some((s) => withinWebsite(l, s)) &&
                    !visited.has(l),
                )
                .slice(0, settings.maxPages),
            );
        } catch {
          signal.throwIfAborted();
          result.warnings.push(
            t(
              "A configured page could not be read or was not allowed.",
              "Una pagina configurata non è leggibile o non è consentita.",
            ),
          );
        }
      }
      step(
        "search_websites",
        t(
          `${pages} pages attempted; configured scope and page limits enforced.`,
          `${pages} pagine tentate; ambito configurato e limiti rispettati.`,
        ),
      );
      if (queue.length)
        result.warnings.push(
          t(
            "Configured website consultation reached the page budget.",
            "Consultazione dei siti limitata dal budget di pagine.",
          ),
        );
    } else if (local.reason === "local_coverage") {
      options.emit({
        type: "activity",
        text: t(
          "Local sources cover at least 80% of question terms; skipping website requests. This routing rule is not evidence verification.",
          "Le fonti locali coprono almeno l’80% dei termini della domanda; evito richieste ai siti. Questa regola decide il percorso, non verifica le fonti.",
        ),
      });
    }
    let assessed: ResearchDecision | null = null;
    if (features.advancedReasoning) {
      activeTool = "assess_evidence";
      try {
        assessed = await dependencies.assess(
          options.question,
          result.sources,
          signal,
        );
        step(
          "assess_evidence",
          t(
            `Advanced Reasoning (Beta): ${assessed.coverage}${assessed.uncertain ? " (uncertain)" : ""}.`,
            `Ragionamento avanzato (Beta): ${assessed.coverage}${assessed.uncertain ? " (incerto)" : ""}.`,
          ),
        );
      } catch {
        signal.throwIfAborted();
        result.warnings.push(
          t(
            "Advanced Reasoning (Beta) unavailable; sources are preserved and independently enabled web research can continue.",
            "Ragionamento avanzato (Beta) non disponibile; le fonti sono conservate e la ricerca web attivata separatamente può continuare.",
          ),
        );
      }
    }
    if (local.reason === "local_only") return result;
    const combined = sourceWorkflowDecision(options.question, result.sources);
    const freshSource = result.sources.some(
      (s) => s.fetched_at && Date.now() - Date.parse(s.fetched_at) < 86400_000,
    );
    const sufficient = assessed
      ? assessed.coverage === "sufficient" &&
        !assessed.uncertain &&
        (!assessed.needsFreshness || freshSource)
      : result.sources.length > 0 &&
        combined.coverage >= 0.8 &&
        (combined.reason !== "freshness" || freshSource);
    if (sufficient) return result;
    if (
      !settings.advancedWebResearch ||
      !dependencies.features().advancedWebResearch
    ) {
      if (settings.advancedWebResearch)
        result.warnings.push(
          t(
            "Advanced Web Research (Beta) is globally disabled. Using local and configured-website sources only.",
            "Ricerca web avanzata (Beta) disattivata globalmente. Uso solo fonti locali e siti configurati.",
          ),
        );
      if (!result.sources.length)
        result.warnings.push(
          t(
            "No relevant sources were found. Generic Internet search was not used.",
            "Nessuna fonte pertinente trovata. La ricerca Internet generica non è stata utilizzata.",
          ),
        );
      return result;
    }
    const query = publicSearchQuery(options.question, options.sources);
    if (!query) {
      result.warnings.push(
        t(
          "Advanced web fallback skipped for privacy: the current question appears to contain private context or copied local information. Ask a separate question with public search terms.",
          "Ricerca web saltata per privacy: la domanda sembra contenere contesto privato o informazioni locali copiate. Formula una domanda separata con termini pubblici.",
        ),
      );
      return result;
    }
    if (pages >= settings.maxPages) {
      result.warnings.push(
        t(
          "Page limit reached before advanced discovery.",
          "Limite di pagine raggiunto prima della ricerca avanzata.",
        ),
      );
      return result;
    }
    activeTool = "research_web";
    options.emit({
      type: "activity",
      text: t(
        "Advanced Web Research (Beta): searching public terms from the current question only…",
        "Ricerca web avanzata (Beta): cerco solo i termini pubblici della domanda attuale…",
      ),
    });
    const found = await dependencies.research(
      query,
      options.modelId,
      { ...settings, maxPages: settings.maxPages - pages },
      signal,
      options.assistantId,
    );
    for (const page of found.evidence.slice(0, settings.maxPages - pages)) {
      signal.throwIfAborted();
      try {
        await dependencies.validate(page.url, undefined, signal);
        remember(webSource(page, "web", options.question));
      } catch {
        signal.throwIfAborted();
        result.warnings.push(
          t(
            "An invalid web source was excluded.",
            "Una fonte web non valida è stata esclusa.",
          ),
        );
      }
    }
    result.missing = found.missing;
    if (found.status !== "complete")
      result.warnings.push(
        t(
          "Advanced research was partial; some information remains unverified.",
          "La ricerca avanzata è parziale; alcune informazioni restano da verificare.",
        ),
      );
    step(
      "research_web",
      t(
        `${found.searches} searches; ${found.pages} pages attempted.`,
        `${found.searches} ricerche; ${found.pages} pagine tentate.`,
      ),
    );
    if (dependencies.features().advancedReasoning) {
      try {
        const final = await dependencies.assess(
          options.question,
          result.sources,
          signal,
        );
        step(
          "assess_evidence",
          t(
            `Final evidence evaluation: ${final.coverage}.`,
            `Valutazione finale delle fonti: ${final.coverage}.`,
          ),
        );
        if (final.coverage !== "sufficient" || final.uncertain)
          result.warnings.push(
            t(
              "The available evidence may not cover every part of the question.",
              "Le fonti disponibili potrebbero non coprire tutti i punti della domanda.",
            ),
          );
      } catch {
        signal.throwIfAborted();
        result.warnings.push(
          t(
            "Final evidence evaluation unavailable; citations are preserved.",
            "Valutazione finale non disponibile; le citazioni sono conservate.",
          ),
        );
      }
    }
  } catch {
    if (options.signal.aborted) throw options.signal.reason;
    const reason = signal.aborted
      ? t(
          "Research time limit reached.",
          "Tempo massimo della ricerca raggiunto.",
        )
      : t(
          "Optional research could not complete. Check Docker and service health. Available sources and citations are preserved.",
          "Ricerca opzionale non completata. Controlla Docker e salute del servizio. Fonti e citazioni disponibili sono conservate.",
        );
    result.warnings.push(reason);
    step(activeTool, reason, "error");
  } finally {
    result.warnings = [...new Set(result.warnings)];
    options.emit({
      type: "research",
      warnings: result.warnings,
      missing: result.missing,
    });
  }
  return result;
}
