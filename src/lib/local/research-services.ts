import { LOCAL_USER_ID } from "../runtime";
import {
  experimentalPreferences,
  inspectDocker,
  requireFeature,
  isFeatureStarting,
  featureBecameReady,
  FeatureUnavailableError,
} from "./experimental-features";
import { localClient, type LocalDatabase } from "./database";
import type {
  ExperimentalStatus,
  ExperimentalFeature,
  DockerStatus,
} from "../experimental";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { dataDirectory } from "./database";
import {
  researchSettingsSchema,
  decisionSchema,
  researchResponseSchema,
  type ResearchSettings,
} from "../research";
import type { Source } from "../catalog";

export function researchServiceConfig() {
  let saved: Record<string, string> = {};
  for (const directory of [join(homedir(), ".siaas"), dataDirectory()]) {
    try {
      saved = JSON.parse(
        readFileSync(join(directory, "research-services.json"), "utf8"),
      );
    } catch {
      /* optional services */
    }
  }
  return {
    laya: process.env.SIAAS_LAYA_URL || saved.laya || "http://127.0.0.1:7821",
    morphic:
      process.env.SIAAS_MORPHIC_URL || saved.morphic || "http://127.0.0.1:7822",
    token: process.env.SIAAS_RESEARCH_TOKEN || saved.token || "",
  };
}
export async function serviceRequest(
  service: "laya" | "morphic",
  path: string,
  signal: AbortSignal,
  body?: unknown,
  assistantId?: string,
) {
  const checkAssistant = () => {
    if (service === "morphic" && path !== "/health") {
      const saved = assistantId
        ? localClient().get("assistants", assistantId)?.research
        : undefined;
      if (!saved || !researchSettingsSchema.parse(saved).advancedWebResearch)
        throw new FeatureUnavailableError("assistant_feature_disabled");
    }
  };
  checkAssistant();
  if (path !== "/health") {
    await requireFeature(
      service === "laya" ? "advancedReasoning" : "advancedWebResearch",
    );
    // An old healthy response cannot authorize new work after Docker or a dependency stops.
    z.object({ ok: z.literal(true) }).parse(
      await serviceRequest(
        service,
        "/health",
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      ),
    );
  }
  if (
    path !== "/health" &&
    !experimentalPreferences()[
      service === "laya" ? "advancedReasoning" : "advancedWebResearch"
    ]
  )
    throw new FeatureUnavailableError("feature_disabled");
  checkAssistant();
  const config = researchServiceConfig();
  const base = new URL(config[service]);
  // These integrations receive private evidence: remote endpoints are intentionally refused.
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    !["http:", "https:"].includes(base.protocol)
  )
    throw new Error("Il servizio deve essere locale.");
  if (!config.token) throw new Error("Servizi di ricerca non configurati.");
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Servizio di ricerca non disponibile.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Risposta vuota.");
  let size = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 150_000) {
      await reader.cancel();
      throw new Error("Risposta troppo grande.");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export async function assessEvidence(
  question: string,
  sources: Source[],
  signal: AbortSignal,
) {
  return decisionSchema.parse(
    await serviceRequest(
      "laya",
      "/assess",
      AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      {
        question: question.slice(0, 1800),
        evidence: sources.slice(0, 12).map((s) => ({
          title: s.title,
          text: s.content.slice(0, 1200),
          kind: s.kind || "document",
          fetchedAt: s.fetched_at,
        })),
        date: new Date().toISOString().slice(0, 10),
      },
    ),
  );
}
export async function researchWithMorphic(
  query: string,
  modelId: string,
  settings: ResearchSettings,
  signal: AbortSignal,
  assistantId?: string,
) {
  const saved = assistantId
    ? localClient().get("assistants", assistantId)?.research
    : undefined;
  if (
    !saved ||
    !researchSettingsSchema.parse(saved).advancedWebResearch ||
    !settings.advancedWebResearch
  )
    throw new FeatureUnavailableError("assistant_feature_disabled");
  return researchResponseSchema.parse(
    await serviceRequest(
      "morphic",
      "/research",
      signal,
      {
        version: 1,
        query,
        model: modelId.slice(7),
        maxPages: settings.maxPages,
        maxSearches: settings.maxSearches,
        timeoutSeconds: settings.timeoutSeconds,
      },
      assistantId,
    ),
  );
}
export async function experimentalStatus(
  db: LocalDatabase = localClient(),
  deps = {
    detect: inspectDocker,
    configured: () => !!researchServiceConfig().token,
    health: (feature: ExperimentalFeature) =>
      serviceRequest(
        feature === "advancedReasoning" ? "laya" : "morphic",
        "/health",
        AbortSignal.timeout(3000),
      ),
  },
): Promise<ExperimentalStatus> {
  const preferences = experimentalPreferences(db);
  const docker: DockerStatus = await deps.detect();
  const services = {} as ExperimentalStatus["services"];
  await Promise.all(
    (["advancedReasoning", "advancedWebResearch"] as ExperimentalFeature[]).map(
      async (feature) => {
        let state: ExperimentalStatus["services"][ExperimentalFeature]["state"] =
          "disabled";
        if (preferences[feature]) {
          if (!docker.ready) state = "docker_unavailable";
          else if (!deps.configured()) state = "not_configured";
          else {
            try {
              z.object({ ok: z.literal(true) }).parse(
                await deps.health(feature),
              );
              featureBecameReady(feature, db);
              state = "ready";
            } catch {
              state = isFeatureStarting(feature, db) ? "starting" : "error";
            }
          }
        }
        services[feature] = {
          state,
          available: state === "ready",
          cleanupPending:
            db.get("workspaces", LOCAL_USER_ID)?.experimental_cleanup_pending?.[
              feature
            ] === true,
        };
      },
    ),
  );
  return { preferences, docker, services };
}
export async function researchHealth() {
  const status = await experimentalStatus();
  return {
    ...status,
    laya: status.services.advancedReasoning.available,
    morphic: status.services.advancedWebResearch.available,
    advanced: status.services.advancedWebResearch.state,
  };
}
export async function assertAssistantResearchChange(
  previous: unknown,
  next: unknown,
  db: LocalDatabase,
  authorize = async () => {
    await requireFeature("advancedWebResearch", db);
    try {
      z.object({ ok: z.literal(true) }).parse(
        await serviceRequest("morphic", "/health", AbortSignal.timeout(3000)),
      );
    } catch {
      throw new FeatureUnavailableError("service_unavailable");
    }
    await requireFeature("advancedWebResearch", db);
  },
) {
  if (!next) return;
  const input = researchSettingsSchema.parse(next);
  const saved = researchSettingsSchema.parse(previous ?? {});
  // Existing saved consent may remain on while runtime is down; unrelated edits must work.
  if (!input.advancedWebResearch || saved.advancedWebResearch) return;
  await authorize();
}
