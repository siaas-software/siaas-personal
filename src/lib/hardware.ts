import snapshot from "./ollama-catalog.json";
import type { CatalogModel } from "./model-catalog";

export type Hardware = {
  ram: number;
  gpu: "cpu" | "dedicated" | "unified";
  vram: number;
  disk: number;
};
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (n: number) => Math.ceil(n * 10) / 10;

// Use total stored parameters for MoE, never just active parameters.
export function parameterSize(model: CatalogModel): number | undefined {
  if (positive(model.parameterB)) return model.parameterB;
  const tag = model.id.split(":")[1] ?? "";
  const match = tag.match(/^(?:(\d+)x)?(\d+(?:\.\d+)?)(b|m)(?:$|[-_])/i);
  if (!match) return undefined;
  const size =
    (Number(match[1] ?? 1) * Number(match[2])) /
    (match[3].toLowerCase() === "m" ? 1000 : 1);
  return positive(size) ? size : undefined;
}

export function recommendations(
  h: Hardware,
  catalog: CatalogModel[] = snapshot.models,
) {
  return catalog.flatMap((model) => {
    const sizeB = parameterSize(model);
    if (!sizeB) return [];
    const quantization =
      model.quantization ??
      model.id.match(
        /(?:^|[-_])(q\d+(?:_[a-z0-9]+)*|f(?:p)?(?:16|32)|bf16)(?:$|[-_])/i,
      )?.[1];
    const bits = quantization?.match(/^q(\d+)/i)?.[1];
    // Unknown quantization: budget FP16 weights, not an assumed Q4 download.
    const bytesPerParameter = bits
      ? Number(bits) / 8
      : /32/.test(quantization ?? "")
        ? 4
        : 2;
    const downloadGB = positive(model.downloadGB)
      ? model.downloadGB
      : round(sizeB * bytesPerParameter * 1.2);
    // Context/KV and runtime reserve is a planning estimate, not a benchmark.
    const memoryGB = positive(model.memoryGB)
      ? model.memoryGB
      : round(downloadGB * 1.2 + 2);
    const ramGB = round(memoryGB + 4);
    const diskGB = Math.ceil(downloadGB * 2 + 1);
    const valid =
      Number.isFinite(h.ram) &&
      Number.isFinite(h.disk) &&
      h.ram >= 0 &&
      h.disk >= 0;
    const diskOK = valid && h.disk >= diskGB;
    // Require RAM fallback, and never pool dedicated VRAM with system RAM.
    const ramOK = valid && h.ram >= ramGB;
    const accelerated =
      h.gpu === "unified"
        ? ramOK
        : h.gpu === "dedicated" &&
          Number.isFinite(h.vram) &&
          h.vram >= memoryGB;
    const fits = diskOK && ramOK;
    return [
      {
        ...model,
        sizeB,
        tier: sizeB <= 3 ? "Lightweight" : sizeB <= 8 ? "Balanced" : "Advanced",
        quantization: quantization ?? "Unknown (FP16 planning budget)",
        estimated: !positive(model.downloadGB) || !positive(model.memoryGB),
        downloadGB,
        memoryGB,
        ramGB,
        diskGB,
        fits,
        accelerated: fits && accelerated,
        label: !diskOK
          ? "Insufficient disk space"
          : !ramOK
            ? "Insufficient RAM"
            : accelerated
              ? "Memory fits acceleration budget; verify Ollama GPU support"
              : "CPU · slower response; GPU offload may be partial",
      },
    ];
  });
}

export function sizeProfiles(options: ReturnType<typeof recommendations>) {
  return [
    {
      tier: "Lightweight",
      description:
        "Smaller memory budgets for simple questions and everyday tasks. Check each model’s capabilities.",
    },
    {
      tier: "Balanced",
      description:
        "Medium parameter sizes for general tasks, with more memory needed. Size alone does not predict quality or speed.",
    },
    {
      tier: "Advanced",
      description:
        "Larger parameter sizes for exploring demanding tasks. Expect higher memory and storage needs; capability varies by model.",
    },
  ].map((profile) => {
    const entries = options.filter((m) => m.tier === profile.tier);
    const compatible = entries.filter((m) => m.fits);
    return {
      ...profile,
      entries,
      compatible,
      sizes: [...new Set(compatible.map((m) => m.sizeB))].sort((a, b) => a - b),
    };
  });
}
export type ModelAdvice = {
  options: ReturnType<typeof recommendations>;
  hardware: Hardware;
  onCatalogChange?: (models: CatalogModel[]) => void;
};
