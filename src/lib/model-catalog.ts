import snapshot from "./ollama-catalog.json";
import { isLocalModelName } from "./model-name";
export type CatalogModel = {
  id: string;
  name: string;
  family: string;
  parameterB?: number;
  quantization?: string;
  downloadGB?: number;
  memoryGB?: number;
};
export function parseOllamaLibrary(html: string): CatalogModel[] {
  const models = new Map<string, CatalogModel>();
  for (const match of html.matchAll(
    /<a href="\/library\/([a-zA-Z0-9._-]+)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, family, body] = match;
    const labels = [...body.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(
      (m) => m[1].replace(/<[^>]*>/g, "").trim(),
    );
    const sizes = labels.filter((s) => /^(?:\d+x)?\d+(?:\.\d+)?[bm]$/.test(s));
    if (
      labels.includes("embedding") ||
      (labels.includes("cloud") && !sizes.length)
    )
      continue;
    for (const tag of sizes.length ? sizes : ["latest"]) {
      const id = `${family}:${tag}`;
      if (isLocalModelName(id))
        models.set(id, { id, name: `${family} · ${tag}`, family });
    }
  }
  if (models.size < 20)
    throw new Error(
      "Catalogo non riconosciuto. Resta disponibile la copia locale.",
    );
  return [...models.values()];
}
let cached = {
  models: snapshot.models as CatalogModel[],
  updatedAt: snapshot.updatedAt,
};
let pending: Promise<typeof cached> | undefined;
export async function modelCatalog(refresh = false) {
  if (!refresh) return cached;
  pending ??= (async () => {
    const res = await fetch("https://ollama.com/library", {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok || !res.body)
      throw new Error(
        "Catalogo Ollama non raggiungibile. Usa la copia locale.",
      );
    const reader = res.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2_000_000)
          throw new Error("Catalogo troppo grande. Usa la copia locale.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    cached = {
      models: parseOllamaLibrary(Buffer.concat(chunks).toString("utf8")),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    return cached;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
