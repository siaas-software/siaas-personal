import { tool } from "ai";
import { z } from "zod";
import { createResearcher } from "./researcher.mjs";
import {
  readPublicPage,
  excerptForQuery,
} from "../../src/lib/local/public-web.ts";
import { publicWebURL, redactSearchQuery } from "../../src/lib/research.ts";

export const requestSchema = z.object({
  version: z.literal(1),
  query: z.string().trim().min(1).max(600),
  model: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9_.:/-]+$/),
  maxPages: z.number().int().min(1).max(12),
  maxSearches: z.number().int().min(1).max(4),
  timeoutSeconds: z.number().int().min(1).max(120),
});

export async function boundedJSON(response, maxBytes = 150_000) {
  if (!response.ok) throw Error("Service unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty response");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw Error("Response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function research(input, parentSignal, dependencies = {}) {
  const request = requestSchema.parse(input);
  const signal = AbortSignal.any([
    parentSignal,
    AbortSignal.timeout(request.timeoutSeconds * 1000),
  ]);
  const transport = dependencies.fetch ?? fetch;
  const read = dependencies.read ?? readPublicPage;
  const run =
    dependencies.run ??
    (async (tools) => {
      const baseURL =
        process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
      const base = new URL(baseURL);
      if (
        ![
          "localhost",
          "127.0.0.1",
          "[::1]",
          "host.docker.internal",
          "ollama",
        ].includes(base.hostname) ||
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password
      )
        throw Error("Ollama must be local");
      const metadata = await boundedJSON(
        await transport(new URL("/api/show", base), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: request.model }),
          signal,
          redirect: "error",
        }),
      );
      if (
        metadata.remote_model ||
        metadata.remote_host ||
        !metadata.capabilities?.includes("completion") ||
        !metadata.capabilities?.includes("tools")
      )
        throw Error("A local tool-capable model is required");
      const agent = createResearcher({
        model: request.model,
        tools,
        maxSteps: request.maxSearches + request.maxPages + 2,
        baseURL,
        fetch: (url, init) => {
          const dest = new URL(url instanceof Request ? url.url : String(url));
          if (
            dest.origin !== base.origin ||
            !["/api/chat", "/api/show"].includes(dest.pathname)
          )
            throw Error("Ollama endpoint refused");
          return transport(url, {
            ...init,
            redirect: "error",
            signal: AbortSignal.any([
              signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
        },
      });
      await agent.generate({
        prompt: redactSearchQuery(request.query),
        abortSignal: signal,
      });
    });
  const evidence = new Map(),
    allowed = new Set(),
    attempted = new Set(),
    missing = new Set();
  let searches = 0,
    pages = 0,
    failed = false;
  async function readEvidence(raw) {
    signal.throwIfAborted();
    const url = publicWebURL(raw).href;
    if (evidence.has(url)) return evidence.get(url);
    if (!allowed.has(url)) return { error: "URL not in search results" };
    if (attempted.has(url)) return { error: "Page already attempted" };
    if (pages >= request.maxPages) {
      missing.add("Limite di pagine raggiunto.");
      return { error: "Page budget exhausted" };
    }
    attempted.add(url);
    pages++;
    try {
      const page = await read(url, signal);
      const entry = {
        url: page.url,
        title: page.title,
        content: excerptForQuery(page.content, request.query, 3000),
        fetchedAt: page.fetchedAt,
      };
      evidence.set(url, entry);
      return { ...entry, label: `S${evidence.size}` };
    } catch {
      if (signal.aborted) throw signal.reason;
      missing.add("Una o più pagine non sono leggibili.");
      return { error: "Page unavailable" };
    }
  }
  const tools = {
    search: tool({
      description:
        "Search public web via local SearXNG. Returns readable page evidence; search snippets alone are not evidence.",
      inputSchema: z.object({
        query: z.string().min(1).max(600),
        include_domains: z.array(z.string().max(200)).max(10).optional(),
        exclude_domains: z.array(z.string().max(200)).max(10).optional(),
      }),
      execute: async ({
        query,
        include_domains = [],
        exclude_domains = [],
      }) => {
        signal.throwIfAborted();
        if (searches >= request.maxSearches) {
          missing.add("Limite di ricerche raggiunto.");
          return { error: "Search budget exhausted" };
        }
        searches++;
        try {
          const base = new URL(
            process.env.SEARXNG_BASE_URL || "http://searxng:8080",
          );
          if (
            !["http:", "https:"].includes(base.protocol) ||
            !["searxng", "localhost", "127.0.0.1", "[::1]"].includes(
              base.hostname,
            ) ||
            base.username ||
            base.password
          )
            throw Error("SearXNG must be local");
          const q = redactSearchQuery(query);
          const url = new URL("/search", base);
          url.search = new URLSearchParams({
            q,
            format: "json",
            categories: "general",
            safesearch: "1",
          }).toString();
          const body = await boundedJSON(
            await transport(url, {
              signal,
              redirect: "error",
              headers: { Accept: "application/json" },
            }),
            500_000,
          );
          const domainMatches = (host, domain) => {
            const d = domain.toLowerCase().replace(/^www\./, "");
            return host === d || host.endsWith("." + d);
          };
          const hits = (Array.isArray(body.results) ? body.results : [])
            .slice(0, 30)
            .flatMap((item) => {
              try {
                const u = publicWebURL(item.url);
                if (
                  include_domains.length &&
                  !include_domains.some((d) => domainMatches(u.hostname, d))
                )
                  return [];
                if (exclude_domains.some((d) => domainMatches(u.hostname, d)))
                  return [];
                return [u.href];
              } catch {
                return [];
              }
            });
          hits.forEach((url) => allowed.add(url));
          const results = [];
          for (const url of hits) {
            if (pages >= request.maxPages || results.length >= 3) break;
            const page = await readEvidence(url);
            if (!page.error) results.push(page);
          }
          if (!results.length)
            missing.add("Nessuna pagina leggibile trovata per una ricerca.");
          return {
            query: q,
            results,
            urls: [...new Set(hits)].slice(0, 12),
            remainingPages: request.maxPages - pages,
            remainingSearches: request.maxSearches - searches,
          };
        } catch {
          if (signal.aborted) throw signal.reason;
          missing.add("SearXNG non disponibile o risposta non valida.");
          return { error: "Search unavailable" };
        }
      },
    }),
    fetch: tool({
      description:
        "Read a URL previously returned by search, within the remaining page budget.",
      inputSchema: z.object({ url: z.string().max(2000) }),
      execute: async ({ url }) => {
        try {
          return await readEvidence(url);
        } catch {
          if (signal.aborted) throw signal.reason;
          return { error: "Invalid URL" };
        }
      },
    }),
  };
  try {
    await run(tools, signal);
    if (!searches) missing.add("Il modello non ha eseguito una ricerca.");
  } catch {
    failed = true;
    missing.add(
      signal.aborted
        ? "Tempo di ricerca esaurito o richiesta annullata."
        : "Modello locale non disponibile o risposta non valida.",
    );
  }
  if (!evidence.size)
    missing.add("Nessuna evidenza web verificabile raccolta.");
  return {
    version: 1,
    status:
      failed && !evidence.size
        ? "error"
        : missing.size
          ? "partial"
          : "complete",
    evidence: [...evidence.values()],
    missing: [...missing].slice(0, 10),
    searches,
    pages,
  };
}
