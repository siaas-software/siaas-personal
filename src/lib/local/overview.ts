import { z } from "zod";
import { ollamaURL } from "../ollama";
import { isLocalModelName } from "../model-name";
import {
  isActiveInference,
  modelKey,
  modelState,
  type OverviewSnapshot,
  type OverviewModel,
} from "../overview";
import { inferenceStore } from "./inference-telemetry";
import { systemResources } from "./system-resources";
import type { LocalDatabase } from "./database";
const metric = z.number().finite().nonnegative().optional();
const entry = z.object({
  name: z.string(),
  digest: z.string().optional(),
  size: metric,
  remote_model: z.string().nullish(),
  remote_host: z.string().nullish(),
  size_vram: metric,
  context_length: metric,
  details: z
    .object({
      family: z.string().optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional(),
      format: z.string().optional(),
    })
    .optional(),
});
const list = z.object({ models: z.array(entry).max(10000) });
type Model = z.infer<typeof entry>;
export class OverviewReader {
  private installed: Model[] = [];
  private installedAt: string | null = null;
  private loadedAt: string | null = null;
  async read(
    db: LocalDatabase,
    request: typeof fetch = fetch,
    resources = systemResources,
    recordsSource = () => inferenceStore().records(),
  ): Promise<OverviewSnapshot> {
    const read = async (path: string) => {
      const response = await request(ollamaURL() + path, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error("Ollama unavailable");
      return list
        .parse(await response.json())
        .models.filter(
          (m) => isLocalModelName(m.name) && !m.remote_model && !m.remote_host,
        );
    };
    const [tags, ps, hardware] = await Promise.allSettled([
      read("/api/tags"),
      read("/api/ps"),
      resources(),
    ]);
    const now = new Date().toISOString(),
      warnings: string[] = [];
    if (tags.status === "fulfilled") {
      this.installed = tags.value;
      this.installedAt = now;
    } else
      warnings.push(
        "Ollama non raggiungibile: l’elenco dei modelli non è aggiornabile. Avvia Ollama e riprova.",
      );
    const loaded = ps.status === "fulfilled" ? ps.value : null;
    if (loaded) this.loadedAt = now;
    else
      warnings.push(
        "Modelli caricati in memoria non rilevati. Lo stato precedente non viene considerato attuale.",
      );
    let records: ReturnType<ReturnType<typeof inferenceStore>["records"]> = [];
    let historyAvailable = true;
    try {
      records = recordsSource();
    } catch {
      historyAvailable = false;
      warnings.push("Statistiche delle richieste non disponibili.");
    }
    if (hardware.status === "rejected")
      warnings.push("Risorse del computer non rilevate.");
    const assistants = db.rows("assistants"),
      projects = db.rows("projects");
    const models: OverviewModel[] = this.installed.map((model) => {
      const name = modelKey(model.name);
      const matching = records.filter((r) => r.model === name);
      const active = matching.filter(isActiveInference),
        recent = matching.filter((r) => !isActiveInference(r));
      const resident = loaded?.find((m) => modelKey(m.name) === name);
      const linked = assistants.filter(
        (a) => typeof a.model_id === "string" && modelKey(a.model_id) === name,
      );
      const linkedProjects = projects.filter((p) =>
        linked.some((a) => a.project_id === p.id),
      );
      const isLoaded = loaded === null ? null : !!resident;
      return {
        name,
        size: model.size ?? null,
        digest: model.digest ?? null,
        details: model.details ?? {},
        loaded: isLoaded,
        state: modelState(isLoaded, active, recent),
        memory: resident?.size ?? null,
        vram: resident?.size_vram ?? null,
        contextLength: resident?.context_length ?? null,
        assistants: linked.map((a) => ({
          id: a.id,
          name: a.name,
          projectId: a.project_id,
        })),
        projects: linkedProjects.map((p) => ({ id: p.id, name: p.name })),
        active,
        recent: recent.slice(0, 20),
      };
    });
    return {
      checkedAt: now,
      modelsUpdatedAt: this.installedAt,
      loadedUpdatedAt: this.loadedAt,
      connected: tags.status === "fulfilled",
      models,
      loadedCount: loaded?.length ?? null,
      activeCount: records.filter(
        (r) => isActiveInference(r) && r.kind === "chat",
      ).length,
      embeddingCount: records.filter(
        (r) => isActiveInference(r) && r.kind === "embedding",
      ).length,
      resources: hardware.status === "fulfilled" ? hardware.value : null,
      warnings,
      historyAvailable,
    };
  }
}
const shared = globalThis as typeof globalThis & {
  siaasOverviewReader?: OverviewReader;
};
export function overviewReader() {
  return (shared.siaasOverviewReader ??= new OverviewReader());
}
