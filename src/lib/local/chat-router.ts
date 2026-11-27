import { checkNativePermission, type ToolTrace } from "./native-permissions";
import type { LocalDatabase } from "./database";
import { retrieveAssistantSources } from "./assistant-research";
import {
  AnalysisDecimal,
  binaryDecimal,
  type BinaryOperator,
} from "../structured/decimal";
import { AnalysisError } from "../structured/types";
import { analysisMarkdown, queryStructured } from "../structured/service";
import { datasets } from "../structured/store";
import { profile } from "../structured/profile";
import type { Plan } from "../structured/engine";
import type { Source } from "../catalog";

const operators: Record<string, BinaryOperator> = {
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "×": "multiply",
  "/": "divide",
  "÷": "divide",
};

type Intent =
  | {
      kind: "arithmetic";
      left: string;
      operator: BinaryOperator;
      right: string;
    }
  | { kind: "structured"; file: string; column?: string }
  | { kind: "document" | "website"; terms: string }
  | { kind: "help" | "clarify" };

export function localIntent(question: string): Intent | null {
  const q = question.trim();
  if (/^(?:\/help|\/aiuto)$/i.test(q)) return { kind: "help" };
  const math =
    /^(?:(?:what is|calculate|quanto fa|quanto fanno|calcola)\s+)?([+-]?\d+(?:[.,]\d+)?)\s*([+*/×÷-])\s*([+-]?\d+(?:[.,]\d+)?)[?=]?$/i.exec(
      q,
    );
  if (math) {
    if ([math[1], math[3]].some((n) => n.replace(/\D/g, "").length > 40))
      return { kind: "clarify" };
    return {
      kind: "arithmetic",
      left: math[1].replace(",", "."),
      operator: operators[math[2]],
      right: math[3].replace(",", "."),
    };
  }
  if (
    /^(?:(?:what is|calculate|quanto fa|calcola)\s+)?[+\-\d(][\d\s+*/×÷^().,=?%-]*$/i.test(
      q,
    )
  )
    return { kind: "clarify" };
  const search =
    /^(?:search|cerca) (documents|documenti|websites|siti)\s*:\s*(.{1,250})$/i.exec(
      q,
    );
  if (search)
    return {
      kind: /^(websites|siti)$/i.test(search[1]) ? "website" : "document",
      terms: search[2],
    };
  const aggregate =
    /^(?:(?:what is the |show the )?total (?:of )?|(?:qual è il |mostra il )?totale (?:di )?)([\p{L}\w -]{1,70}?) (?:in|nel file|in file) ([\p{L}\w .-]{1,160}\.(?:csv|xlsx))[?.!]?(?: show the result, currency, and number of rows used in the calculation\.)?$/iu.exec(
      q,
    );
  if (aggregate)
    return { kind: "structured", file: aggregate[2], column: aggregate[1] };
  const duplicates =
    /^(?:find duplicates|show duplicates|trova duplicati|mostra i duplicati) (?:in|nel file) ([\p{L}\w .-]{1,160}\.(?:csv|xlsx))[?.!]?$/iu.exec(
      q,
    );
  if (duplicates) return { kind: "structured", file: duplicates[1] };
  return null;
}

export function requestsDatasetCalculation(question: string) {
  return (
    /\.(?:csv|xlsx)\b/i.test(question) &&
    /\b(total|totale|sum|somma|count|conta|average|media|duplicates?|duplicati|calculate|calcola)\b/i.test(
      question,
    )
  );
}

export async function executeLocalChat(
  db: LocalDatabase,
  assistantId: string,
  intent: Intent,
  language: "en" | "it",
  signal: AbortSignal,
  trace?: ToolTrace,
) {
  signal.throwIfAborted();
  if (intent.kind === "structured")
    checkNativePermission(db, assistantId, "datasets.query", trace);
  let content: string;
  let result: ReturnType<typeof queryStructured> | null = null;
  let sources: Source[] = [];
  const it = language === "it";
  try {
    switch (intent.kind) {
      case "arithmetic":
        content = binaryDecimal(
          intent.operator,
          new AnalysisDecimal(intent.left),
          new AnalysisDecimal(intent.right),
        ).toString();
        break;
      case "structured": {
        const matches = datasets(db, assistantId).filter(
          (d) => d.filename.toLowerCase() === intent.file.toLowerCase(),
        );
        if (matches.length !== 1)
          throw new AnalysisError(
            it
              ? "Seleziona un unico foglio disponibile in Analisi dati."
              : "Choose one available file and worksheet in Structured Data Analysis.",
          );
        const [dataset] = matches;
        if (!dataset.mapping.confirmed)
          throw new AnalysisError(
            it
              ? "Conferma la mappatura del foglio."
              : "Confirm the worksheet mapping first.",
          );
        const { columns } = profile(dataset);
        let step: Plan["stages"][number]["steps"][number];
        if (intent.column) {
          const matches = columns.filter(
            (c) => c.name.toLowerCase() === intent.column!.toLowerCase(),
          );
          if (matches.length !== 1 || matches[0].type !== "number")
            throw new AnalysisError(
              it
                ? "Specifica una sola colonna numerica confermata."
                : "Specify one confirmed numeric column by its exact name.",
            );
          const column = matches[0].id;
          step = {
            op: "group",
            by: dataset.mapping.partitionColumns,
            aggregates: [
              { fn: "sum", column, as: "total" },
              { fn: "count", column, as: "rowsUsed" },
            ],
          };
        } else {
          if (columns.length > 8)
            throw new AnalysisError(
              it
                ? "Seleziona le colonne da confrontare in Analisi dati."
                : "Choose comparison columns in Structured Data Analysis.",
            );
          step = { op: "duplicates", by: columns.map((c) => c.id) };
        }
        result = queryStructured(db, assistantId, {
          stages: [{ id: "data", datasetId: dataset.id, steps: [step] }],
          output: "data",
        });
        content = analysisMarkdown(result, false);
        break;
      }
      case "website":
      case "document":
        sources = await retrieveAssistantSources({
          db,
          assistantId,
          trace,
          question: intent.terms,
          signal,
          embeddingProfile: null,
          kind: intent.kind,
        });
        content = sources.length
          ? sources
              .map(
                (s, i) =>
                  `[${i + 1}] ${s.title}\n\n> ${s.content.replace(/\n/g, "\n> ")}`,
              )
              .join("\n\n")
          : it
            ? "Nessun estratto corrispondente tra le fonti preparate e abilitate."
            : "No matching excerpt in the prepared, enabled sources.";
        break;
      case "help":
        content = it
          ? "Prova 2 + 2, totale Budget in budgets.csv, cerca documenti: parola oppure cerca siti: parola. La generazione di testo richiede Ollama."
          : "Try 2 + 2, total Budget in budgets.csv, search documents: keyword, or search websites: keyword. Text generation requires Ollama.";
        break;
      case "clarify":
        content = it
          ? "Specifica due numeri e un operatore (+, −, ×, ÷)."
          : "Specify two numbers and one operator (+, -, ×, ÷).";
    }
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof AnalysisError)) throw error;
    content = error.message;
  }
  signal.throwIfAborted();
  return { sources, content, result };
}
