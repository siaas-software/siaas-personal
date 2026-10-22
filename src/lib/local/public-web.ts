import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import http from "node:http";
import https from "node:https";
import { publicWebURL, withinWebsite, type Website } from "../research";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [ip, bits] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const)
  blockedV6.addSubnet(ip, bits, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blockedV6.check(address, "ipv6");
}
export async function validatePublicDestination(
  raw: string,
  sites?: Website[],
  signal = AbortSignal.timeout(8000),
) {
  const url = publicWebURL(raw);
  if (sites && !sites.some((s) => withinWebsite(url.href, s)))
    throw new Error("Fonte fuori dai siti consentiti.");
  signal.throwIfAborted();
  const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>(
    (resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      lookup(url.hostname, { all: true, verbatim: true })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Destinazione di rete non consentita.");
  return { url, address: addresses[0] };
}

export async function readPublicPage(
  raw: string,
  signal: AbortSignal,
  sites?: Website[],
) {
  let next = raw;
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const { url, address } = await validatePublicDestination(
      next,
      sites,
      AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    );
    signal.throwIfAborted();
    // Resolve once and pin the connection, including every redirect (DNS rebinding).
    const result = await new Promise<{
      status: number;
      location?: string;
      type: string;
      body: string;
    }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(
        url,
        {
          signal,
          timeout: 8000,
          headers: {
            "User-Agent": "SIAAS-Personal/1.0 (document research)",
            Accept: "text/html,text/plain",
            "Accept-Encoding": "identity",
          },
          lookup: ((
            _host: string,
            opts: { all?: boolean },
            cb: (...args: any[]) => void,
          ) =>
            opts.all
              ? cb(null, [address])
              : cb(null, address.address, address.family)) as any,
        },
        (response) => {
          if (
            response.statusCode &&
            [301, 302, 303, 307, 308].includes(response.statusCode)
          ) {
            response.resume();
            resolve({
              status: response.statusCode,
              location: response.headers.location,
              type: "",
              body: "",
            });
            return;
          }
          const type = String(response.headers["content-type"] || "")
            .split(";")[0]
            .toLowerCase();
          if (
            response.statusCode !== 200 ||
            !["text/html", "application/xhtml+xml", "text/plain"].includes(type)
          ) {
            response.destroy();
            reject(
              new Error(
                "Pagina non leggibile: formato o risposta non supportati.",
              ),
            );
            return;
          }
          let size = 0;
          const parts: Buffer[] = [];
          response.on("data", (part: Buffer) => {
            size += part.length;
            if (size > 1_000_000) {
              response.destroy(new Error("Pagina troppo grande."));
            } else parts.push(part);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: 200,
              type,
              body: Buffer.concat(parts).toString("utf8"),
            }),
          );
        },
      );
      request.on("timeout", () =>
        request.destroy(new Error("Tempo di lettura scaduto.")),
      );
      request.on("error", reject);
    });
    if (result.status !== 200) {
      if (!result.location) throw new Error("Redirect non valido.");
      next = new URL(result.location, url).href;
      continue;
    }
    const html = result.type !== "text/plain";
    const clean = html
      ? result.body
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(
            /<(script|style|nav|footer|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
            " ",
          )
      : result.body;
    const title = html
      ? decodeText(
          result.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
            url.hostname,
        )
      : url.hostname;
    const links = html
      ? Array.from(clean.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi))
          .slice(0, 150)
          .flatMap((m) => {
            try {
              return [new URL(decodeText(m[1]), url).href];
            } catch {
              return [];
            }
          })
      : [];
    const content = decodeText(html ? clean.replace(/<[^>]*>/g, " ") : clean)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60_000);
    if (content.length < 40)
      throw new Error(
        "Pagina priva di testo sufficiente; potrebbe richiedere JavaScript.",
      );
    return {
      url: url.href,
      title: title.slice(0, 250),
      content,
      links,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error("Troppi redirect.");
}
function decodeText(text: string) {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (m, k: string) => {
      if (k[0] === "#") {
        const n =
          k[1].toLowerCase() === "x"
            ? parseInt(k.slice(2), 16)
            : parseInt(k.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
      }
      return (
        (
          {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            nbsp: " ",
          } as Record<string, string>
        )[k.toLowerCase()] || m
      );
    },
  );
}
export function excerptForQuery(content: string, query: string, limit = 4000) {
  const words = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []),
  ];
  const passages = content.match(/[\s\S]{1,1000}/g) || [];
  return passages
    .map((text, index) => ({
      text,
      index,
      score: words.filter((w) => text.toLowerCase().includes(w)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.ceil(limit / 1000))
    .sort((a, b) => a.index - b.index)
    .map((p) => p.text)
    .join("\n[…]\n")
    .slice(0, limit);
}
