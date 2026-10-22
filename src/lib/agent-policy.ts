export const MIN_AGENT_PARAMETERS = 8_000_000_000;
export type AgentEligibility = {
  enabled: boolean;
  parameterCount: number | null;
  supportsTools: boolean;
  reason: "ready" | "unknown-size" | "too-small" | "no-tools" | "not-local";
};
// Use verified parameter metadata, never the model's name or download size.
export function agentEligibility(info: {
  model_info?: Record<string, unknown>;
  details?: { parameter_size?: string };
  capabilities?: string[];
  remote_model?: unknown;
  remote_host?: unknown;
}): AgentEligibility {
  const exact = info.model_info?.["general.parameter_count"];
  const size = info.details?.parameter_size
    ?.trim()
    .match(/^(\d+(?:\.\d+)?)\s*([KMBT])$/i);
  const parameterCount =
    typeof exact === "number" && Number.isFinite(exact) && exact > 0
      ? exact
      : size
        ? Number(size[1]) *
          ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[size[2].toUpperCase()] ?? 0)
        : null;
  const supportsTools = info.capabilities?.includes("tools") === true;
  const reason =
    info.remote_model ||
    info.remote_host ||
    !info.capabilities?.includes("completion")
      ? "not-local"
      : parameterCount === null
        ? "unknown-size"
        : parameterCount < MIN_AGENT_PARAMETERS
          ? "too-small"
          : !supportsTools
            ? "no-tools"
            : "ready";
  return { enabled: reason === "ready", parameterCount, supportsTools, reason };
}
export function agentStatusText(status?: AgentEligibility) {
  if (!status) return "Standard chat · model check unavailable.";
  switch (status.reason) {
    case "ready":
      return "Agent active · document search, source reading and report creation.";
    case "too-small":
      return "Standard chat · agent mode requires at least 8B parameters and tool support.";
    case "no-tools":
      return "Standard chat · this model does not declare tool support.";
    case "unknown-size":
      return "Standard chat · Ollama does not report this model’s parameter count.";
    default:
      return "Standard chat · agent mode requires a local chat model.";
  }
}
