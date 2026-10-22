import { z } from "zod";
export const experimentalFeaturesSchema = z.object({
  version: z.literal(1).default(1),
  advancedReasoning: z.boolean().default(false),
  advancedWebResearch: z.boolean().default(false),
});
export type ExperimentalFeatures = z.infer<typeof experimentalFeaturesSchema>;
export type ExperimentalFeature = "advancedReasoning" | "advancedWebResearch";
export const experimentalFeatureSchema = z.enum([
  "advancedReasoning",
  "advancedWebResearch",
]);
export type DockerStatus = {
  ready: boolean;
  reason: string;
  message: string;
  help: string;
};
export type FeatureState =
  | "disabled"
  | "docker_unavailable"
  | "not_configured"
  | "starting"
  | "ready"
  | "error";
export type ExperimentalStatus = {
  preferences: ExperimentalFeatures;
  docker: DockerStatus;
  services: Record<
    ExperimentalFeature,
    { state: FeatureState; available: boolean; cleanupPending: boolean }
  >;
};
// Legacy assistant modes and service endpoints are preferences, never opt-in consent.
export function migrateExperimentalFeatures(
  value: unknown,
): ExperimentalFeatures {
  const parsed = experimentalFeaturesSchema.safeParse(value);
  return parsed.success ? parsed.data : experimentalFeaturesSchema.parse({});
}
