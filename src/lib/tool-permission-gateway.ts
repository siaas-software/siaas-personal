/**
 * RC7 project-level permission decisions. Pure, local, and fail-closed.
 *
 * This is a policy foundation, not an executor hook: callers MUST authenticate
 * project/assistant membership and invoke it immediately before EVERY tool call.
 * A rule never registers a capability or widens an assistant's own source scope.
 */
export type ToolDecision = "allow" | "ask" | "deny";
export type ToolPermissionRule = {
  capability: string;
  decision: ToolDecision;
};
export type ProjectToolPermissions = { rules: ToolPermissionRule[] };
export type PermissionResolution = {
  decision: ToolDecision;
  reason: "hard-deny" | "unregistered" | "assistant-scope" | "project-rule" | "default" | "unknown";
};

const CAPABILITY = /^[a-z][a-z0-9._:-]{0,127}$/;
const BASELINE = new Map<string, ToolDecision>([
  ["documents.read", "allow"],
  ["datasets.query", "allow"],
  ["reports.create", "allow"],
  ["mcp.read", "ask"],
  ["mcp.write", "ask"],
  ["files.write", "ask"],
  ["media.image.generate", "ask"],
  ["media.video.generate", "ask"],
]);
const IMMUTABLE_DENY = new Set([
  "workspace.cross-project",
  "secrets.read",
  "system.shell",
  "permissions.bypass",
]);

export function defaultToolPermissions(): ProjectToolPermissions {
  return { rules: [...BASELINE].map(([capability, decision]) => ({ capability, decision })) };
}

/** Stored/project-template input validation. Never parse permissions by trusting the model. */
export function parseProjectToolPermissions(input: unknown): ProjectToolPermissions {
  if (input == null) return { rules: [] };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid project permissions.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "rules") || !Array.isArray(record.rules) || record.rules.length > 100)
    throw new Error("Invalid project permission rules.");
  const seen = new Set<string>();
  const rules: ToolPermissionRule[] = [];
  for (const raw of record.rules) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid permission rule.");
    const rule = raw as Record<string, unknown>;
    if (Object.keys(rule).some(key => key !== "capability" && key !== "decision") ||
        typeof rule.capability !== "string" || !CAPABILITY.test(rule.capability) ||
        !["allow", "ask", "deny"].includes(String(rule.decision)) ||
        seen.has(rule.capability)) throw new Error("Invalid or duplicate permission rule.");
    seen.add(rule.capability);
    rules.push({ capability: rule.capability, decision: rule.decision as ToolDecision });
  }
  return { rules };
}

/**
 * The caller MUST independently establish registered=true from the current
 * native/MCP capability registry, and assistantScopeAllowed from the actual
 * assistant's authorized resources. Never derive either flag from a prompt.
 */
export function resolveToolPermission(input: {
  capability: string;
  projectPermissions: unknown;
  registered: boolean;
  assistantScopeAllowed: boolean;
}): PermissionResolution {
  if (IMMUTABLE_DENY.has(input.capability))
    return { decision: "deny", reason: "hard-deny" };
  if (!CAPABILITY.test(input.capability) || !input.registered)
    return { decision: "deny", reason: "unregistered" };
  if (!input.assistantScopeAllowed)
    return { decision: "deny", reason: "assistant-scope" };
  const config = parseProjectToolPermissions(input.projectPermissions);
  const override = config.rules.find(r => r.capability === input.capability);
  if (override) return { decision: override.decision, reason: "project-rule" };
  const fallback = BASELINE.get(input.capability);
  return fallback
    ? { decision: fallback, reason: "default" }
    : { decision: "deny", reason: "unknown" };
}

/** A caller must block for explicit user consent on ask; it is never allow. */
export function requireAllow(resolution: PermissionResolution): void {
  if (resolution.decision !== "allow")
    throw new Error(resolution.decision === "ask" ? "User approval required." : "Tool operation denied.");
}
