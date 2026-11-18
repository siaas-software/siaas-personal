export type AgentEligibility = {
  enabled: boolean;
  parameterCount: number | null;
  supportsTools: boolean;
  reason: "ready" | "no-tools" | "not-local";
};
// Parameter metadata is informational, not an eligibility gate.
// Only local completion models declaring native Ollama tool support may run agents.
// Declared support does not certify tool-call reliability; that requires testing.
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
      : !supportsTools
        ? "no-tools"
        : "ready";
  return { enabled: reason === "ready", parameterCount, supportsTools, reason };
}
export function agentStatusText(status?: AgentEligibility) {
  if (!status) return "Standard chat · model check unavailable.";
  switch (status.reason) {
    case "ready":
      return "Agent active · tool calling available; verify results carefully.";
    case "no-tools":
      return "Standard chat · this model does not declare tool support.";
    default:
      return "Standard chat · agent mode requires a local chat model.";
  }
}
