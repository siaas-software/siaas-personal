import { z } from "zod";

export function publicWebURL(value: string): URL {
  const url = new URL(value);
  const ip = url.hostname.split(".").map(Number);
  const nonPublicIP =
    ip.length === 4 &&
    ip.every(Number.isInteger) &&
    (ip[0] === 0 ||
      ip[0] === 10 ||
      ip[0] === 127 ||
      ip[0] >= 224 ||
      (ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127) ||
      (ip[0] === 169 && ip[1] === 254) ||
      (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
      (ip[0] === 192 &&
        (ip[1] === 168 || (ip[1] === 0 && (ip[2] === 0 || ip[2] === 2)))) ||
      (ip[0] === 198 &&
        (ip[1] === 18 || ip[1] === 19 || (ip[1] === 51 && ip[2] === 100))) ||
      (ip[0] === 203 && ip[1] === 0 && ip[2] === 113));
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    !url.hostname.includes(".") ||
    nonPublicIP ||
    /(^|\.)(home|lan)\.?$/.test(url.hostname) ||
    /(^|\.)(localhost|local|internal|test|invalid)\.?$/.test(url.hostname) ||
    /%(2f|5c|25|00)/i.test(url.pathname)
  )
    throw new Error("Indirizzo web pubblico non valido.");
  url.hash = "";
  return url;
}

export const websiteSchema = z.object({
  url: z
    .string()
    .trim()
    .max(1500)
    .refine((s) => {
      try {
        publicWebURL(s);
        return true;
      } catch {
        return false;
      }
    }, "Inserisci un URL web pubblico."),
  scope: z.enum(["page", "section"]).default("page"),
});
const unifiedResearchSchema = z.object({
  version: z.literal(2).default(2),
  advancedWebResearch: z.boolean().default(false),
  websitesConfirmed: z.boolean().default(true),
  migrationNotice: z.enum(["legacy_documents", "legacy_web"]).optional(),
  websites: z.array(websiteSchema).max(10).default([]),
  maxPages: z.number().int().min(1).max(12).default(6),
  maxSearches: z.number().int().min(1).max(4).default(2),
  timeoutSeconds: z.number().int().min(20).max(120).default(90),
});
// Legacy mode is an input compatibility detail, never a new Beta opt-in.
export const researchSettingsSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as Record<string, unknown>;
  if (value.version === 2) return value;
  const { mode, ...rest } = value;
  return {
    ...rest,
    version: 2,
    advancedWebResearch: false,
    websitesConfirmed:
      mode !== "documents" ||
      !Array.isArray(value.websites) ||
      value.websites.length === 0,
    ...(mode === "web"
      ? { migrationNotice: "legacy_web" }
      : mode === "documents" &&
          Array.isArray(value.websites) &&
          value.websites.length
        ? { migrationNotice: "legacy_documents" }
        : {}),
  };
}, unifiedResearchSchema);
export type ResearchSettings = z.infer<typeof researchSettingsSchema>;
export const DEFAULT_RESEARCH_SETTINGS = researchSettingsSchema.parse({});
export type Website = z.infer<typeof websiteSchema>;
export const decisionSchema = z.object({
  coverage: z.enum(["sufficient", "partial", "insufficient"]),
  needsFreshness: z.boolean(),
  uncertain: z.boolean(),
});
export type ResearchDecision = z.infer<typeof decisionSchema>;
export const webEvidenceSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(250),
  content: z.string().min(1).max(6000),
  fetchedAt: z.string().datetime(),
});
export const researchResponseSchema = z.object({
  version: z.literal(1),
  status: z.enum(["complete", "partial", "error"]),
  evidence: z.array(webEvidenceSchema).max(12),
  missing: z.array(z.string().max(300)).max(10),
  searches: z.number().int().min(0).max(4),
  pages: z.number().int().min(0).max(12),
});
export function withinWebsite(raw: string, site: Website) {
  try {
    const url = publicWebURL(raw),
      base = publicWebURL(site.url);
    if (url.origin !== base.origin) return false;
    if (site.scope === "page") return url.href === base.href;
    const prefix = base.pathname.replace(/\/$/, "");
    return url.pathname === prefix || url.pathname.startsWith(prefix + "/");
  } catch {
    return false;
  }
}

// Best-effort removal of common identifiers; never a promise of anonymisation.
export function redactSearchQuery(query: string) {
  return query
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_-]{12,}/g, "[credenziale]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[numero]")
    .slice(0, 600);
}
