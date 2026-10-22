import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { inspectDocker } from "../../../scripts/docker-prerequisites.mjs";
import { LOCAL_USER_ID } from "../runtime";
import {
  migrateExperimentalFeatures,
  type ExperimentalFeature,
  type DockerStatus,
} from "../experimental";
import { localClient, type LocalDatabase } from "./database";

export { inspectDocker };
export function experimentalPreferences(db: LocalDatabase = localClient()) {
  return migrateExperimentalFeatures(
    db.get("workspaces", LOCAL_USER_ID)?.experimental_features,
  );
}
export class FeatureUnavailableError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function requireFeature(
  feature: ExperimentalFeature,
  db = localClient(),
  detect: () => Promise<DockerStatus> = inspectDocker,
) {
  if (!experimentalPreferences(db)[feature])
    throw new FeatureUnavailableError("feature_disabled");
  const docker = await detect();
  if (!docker.ready) throw new FeatureUnavailableError(docker.reason);
}
const inProgress = new Set<string>();
const starting = new Map<string, number>();
export function isFeatureStarting(
  feature: ExperimentalFeature,
  db: LocalDatabase,
) {
  return Date.now() - (starting.get(db.directory + feature) || 0) < 15 * 60_000;
}
export function featureBecameReady(
  feature: ExperimentalFeature,
  db: LocalDatabase,
) {
  starting.delete(db.directory + feature);
}
export async function manageFeatureService(
  feature: ExperimentalFeature,
  action: "start" | "stop",
) {
  const candidates = [process.cwd(), resolve(process.cwd(), "../..")];
  const root = candidates.find((p) =>
    existsSync(resolve(p, "scripts/research-services.mjs")),
  );
  if (!root) throw new FeatureUnavailableError("service_files_missing");
  await new Promise<void>((accept, reject) => {
    execFile(
      process.execPath,
      [
        resolve(root, "scripts/research-services.mjs"),
        action === "start" ? "setup" : "stop",
        feature === "advancedReasoning" ? "reasoning" : "web",
      ],
      {
        cwd: root,
        env: process.env,
        windowsHide: true,
        timeout: 15 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error) =>
        error
          ? reject(new FeatureUnavailableError("service_start_or_stop_failed"))
          : accept(),
    );
  });
}
type Dependencies = {
  detect: () => Promise<DockerStatus>;
  manage: typeof manageFeatureService;
};
// Single mutation path for both features. Save only the named preference; preserve all workspace data.
export async function setExperimentalFeature(
  db: LocalDatabase,
  feature: ExperimentalFeature,
  enabled: boolean,
  deps: Dependencies = { detect: inspectDocker, manage: manageFeatureService },
) {
  const key = db.directory;
  if (inProgress.has(key))
    throw new FeatureUnavailableError("feature_change_in_progress");
  inProgress.add(key);
  try {
    if (enabled) {
      const docker = await deps.detect();
      if (!docker.ready) throw new FeatureUnavailableError(docker.reason);
      starting.set(db.directory + feature, Date.now());
      try {
        await deps.manage(feature, "start");
        // Docker can stop during a lengthy build. Never record a new opt-in after that failure.
        if (!(await deps.detect()).ready)
          throw new FeatureUnavailableError("engine_unavailable");
      } catch (error) {
        starting.delete(db.directory + feature);
        throw error;
      }
    }
    db.transaction(() => {
      const workspace = db.get("workspaces", LOCAL_USER_ID)!;
      db.put(
        "workspaces",
        {
          ...workspace,
          experimental_features: {
            ...experimentalPreferences(db),
            [feature]: enabled,
          },
          experimental_cleanup_pending: {
            ...workspace.experimental_cleanup_pending,
            [feature]: !enabled,
          },
        },
        true,
      );
    });
    if (!enabled) {
      starting.delete(db.directory + feature);
      // Revocation is effective immediately, including when Docker cannot stop its service.
      try {
        await deps.manage(feature, "stop");
        db.transaction(() => {
          const workspace = db.get("workspaces", LOCAL_USER_ID)!;
          db.put(
            "workspaces",
            {
              ...workspace,
              experimental_cleanup_pending: {
                ...workspace.experimental_cleanup_pending,
                [feature]: false,
              },
            },
            true,
          );
        });
      } catch {
        return { cleanupPending: true };
      }
    }
    return { cleanupPending: false };
  } finally {
    inProgress.delete(key);
  }
}
