import type { Source } from "./catalog";
// This policy is deterministic; lexical coverage is routing evidence, not verification.
const stop = new Set(
  "what which when where who why how does do is are was were the a an and or of in on at to for with from about can could would should tell explain please mi il lo la le gli i un una uno di del della dei delle in su per con da che cosa come quale quali quanto quando dove sono è e o si me my our mio mia miei nostro nostra spiega dimmi favore".split(
    " ",
  ),
);
export function researchTerms(text: string) {
  return [
    ...new Set(
      (
        text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || []
      ).filter((w) => !stop.has(w)),
    ),
  ];
}
export function sourceWorkflowDecision(question: string, sources: Source[]) {
  if (
    /^\s*(hi|hello|hey|thanks|thank you|ciao|grazie|buongiorno|buonasera)[!.\s]*$/i.test(
      question,
    )
  )
    return {
      consultWebsites: false,
      reason: "conversation" as const,
      coverage: 1,
    };
  if (
    /(?:only|just|solo|soltanto)\s+(?:the\s+|i\s+)?(?:local\s+)?(?:documents?|files?|documenti|file)|(?:do not|don't|non)\s+(?:use|access|consult|usare|accedere|consultare)\s+(?:the\s+|a\s+)?(?:web|internet|siti)/i.test(
      question,
    )
  )
    return {
      consultWebsites: false,
      reason: "local_only" as const,
      coverage: 0,
    };
  const fresh =
    /\b(latest|current|today|now|recent|online|website|internet|web|aggiornat\w*|attual\w*|oggi|adesso|recent\w*|sito|siti)\b/i.test(
      question,
    );
  const terms = researchTerms(question).filter(
    (w) =>
      !/^(latest|current|today|now|recent|online|website|internet|web|oggi|adesso|sito|siti)$/.test(
        w,
      ) && !/^(aggiornat|attual|recent)/.test(w),
  );
  const text = researchTerms(sources.map((s) => s.content).join(" "));
  const coverage = terms.length
    ? terms.filter((w) => text.includes(w)).length / terms.length
    : 0;
  const sufficient = sources.length > 0 && terms.length > 0 && coverage >= 0.8;
  return {
    consultWebsites: fresh || !sufficient,
    reason: fresh
      ? ("freshness" as const)
      : sufficient
        ? ("local_coverage" as const)
        : ("coverage_gap" as const),
    coverage,
  };
}
// Only current-question terms can leave the app. Never generate a query from local
// documents, instructions, source titles, previous questions or conversation history.
export function publicSearchQuery(question: string, sources: Source[]) {
  if (
    /\b(?:my|our|attached|uploaded|private|confidential|mio|mia|nostr\w*|allegat\w*|caricat\w*|riservat\w*|confidenzial\w*)\b/i.test(
      question,
    ) ||
    /\b(?:document|file|invoice|customer|client|documento|fattura|cliente)\b/i.test(
      question,
    )
  )
    return null;
  if (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:sk-|Bearer\s+)\S+|\b[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\b|\+?\d[\d\s().-]{7,}\d|[A-Za-z]:\\|\/(?:home|Users|workspace)\//i.test(
      question,
    )
  )
    return null;
  const terms = researchTerms(question);
  const privateSources = sources.filter(
    (s) => !s.url || !["website", "web"].includes(s.kind || "document"),
  );
  const privateRaw = privateSources.map((s) => s.content).join(" ");
  const privateText = privateSources
    .map((s) => researchTerms(s.content).join(" "))
    .join(" ");
  const identifiers =
    privateRaw.match(/\b[A-Za-z0-9][A-Za-z0-9_-]{3,}\b/g) || [];
  if (
    identifiers.some(
      (value) =>
        /\d|_/.test(value) &&
        question.toLowerCase().includes(value.toLowerCase()),
    )
  )
    return null;
  const names = [
    ...privateRaw.matchAll(/(?=\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b)/g),
  ].map((match) => match[1]);
  if (
    names.some((value) => question.toLowerCase().includes(value.toLowerCase()))
  )
    return null;
  for (let i = 0; i <= terms.length - 3; i++)
    if (privateText.includes(terms.slice(i, i + 3).join(" "))) return null;
  return question.trim().slice(0, 600) || null;
}
