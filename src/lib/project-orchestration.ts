/**
 * Project-level orchestration contract. This module does not call Ollama, touch
 * documents, or bypass the per-assistant Hybrid Router.
 *
 * An adapter supplied by the assistant execution service must perform every
 * delegated task under the target assistant's existing permissions.
 */
export type ProjectOrchestrationConfig = {
  enabled: boolean;
  instructions: string;
  share_results: boolean;
  assistant_ids: string[];
  max_steps: number;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  tenant_id: string;
};

export type OrchestrationStep = {
  assistant_id: string;
  task: string;
};

export type OrchestrationPlan = {
  steps: OrchestrationStep[];
};

export type DelegatedResult = {
  status: "complete" | "error";
  text: string;
};

export type DelegationRequest = {
  projectId: string;
  assistantId: string;
  task: string;
  previousResult: { assistant_id: string; text: string } | null;
  signal: AbortSignal;
};

export type Delegation = (
  request: DelegationRequest,
) => Promise<DelegatedResult>;

export class ProjectOrchestrationError extends Error {
  constructor(
    public readonly status: 400 | 403 | 409 | 502,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectOrchestrationError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProjectOrchestrationError(
      400,
      "invalid_body",
      "Configurazione non valida.",
    );
  return value as Record<string, unknown>;
}
function validId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function invalid(message: string): never {
  throw new ProjectOrchestrationError(400, "invalid_configuration", message);
}

export function parseProjectOrchestration(
  value: unknown,
): ProjectOrchestrationConfig {
  if (value === undefined || value === null)
    return {
      enabled: false,
      instructions: "",
      share_results: false,
      assistant_ids: [],
      max_steps: 4,
    };
  const input = record(value);
  if (
    !keys(input, [
      "enabled",
      "instructions",
      "share_results",
      "assistant_ids",
      "max_steps",
    ])
  )
    invalid("Campi di orchestrazione non riconosciuti.");
  const enabled = input.enabled ?? false;
  const instructions = input.instructions ?? "";
  const shareResults = input.share_results ?? false;
  const assistantIds = input.assistant_ids ?? [];
  const maxSteps = input.max_steps ?? 4;
  if (typeof enabled !== "boolean") invalid("enabled deve essere booleano.");
  if (typeof instructions !== "string" || instructions.length > 4000)
    invalid("Istruzioni troppo lunghe o non valide.");
  if (typeof shareResults !== "boolean")
    invalid("share_results deve essere booleano.");
  if (
    !Array.isArray(assistantIds) ||
    assistantIds.length > 8 ||
    !assistantIds.every(validId) ||
    new Set(assistantIds).size !== assistantIds.length
  )
    invalid("Seleziona fino a otto assistenti univoci.");
  if (
    !Number.isInteger(maxSteps) ||
    (maxSteps as number) < 1 ||
    (maxSteps as number) > 8
  )
    invalid("Il limite dei passaggi deve essere compreso tra uno e otto.");
  if (enabled && assistantIds.length === 0)
    invalid("Seleziona almeno un assistente per abilitare l'orchestrazione.");
  return {
    enabled: enabled as boolean,
    instructions: instructions.trim(),
    share_results: shareResults,
    assistant_ids: [...assistantIds] as string[],
    max_steps: maxSteps as number,
  };
}

export function validateProjectParticipants(
  project: { id: string; tenant_id: string },
  tenantId: string,
  config: ProjectOrchestrationConfig,
  members: readonly ProjectMember[],
): void {
  if (project.tenant_id !== tenantId)
    throw new ProjectOrchestrationError(
      403,
      "project_forbidden",
      "Progetto non autorizzato.",
    );
  const authorized = new Set(
    members
      .filter(
        (member) =>
          member.project_id === project.id && member.tenant_id === tenantId,
      )
      .map((member) => member.id),
  );
  if (config.assistant_ids.some((id) => !authorized.has(id)))
    throw new ProjectOrchestrationError(
      403,
      "assistant_forbidden",
      "Uno o più assistenti non appartengono al progetto.",
    );
}

export function validateOrchestrationPlan(
  value: unknown,
  config: ProjectOrchestrationConfig,
): OrchestrationPlan {
  if (!config.enabled)
    throw new ProjectOrchestrationError(
      409,
      "orchestration_disabled",
      "Orchestrazione non abilitata.",
    );
  const input = record(value);
  if (
    !keys(input, ["steps"]) ||
    !Array.isArray(input.steps) ||
    input.steps.length < 1 ||
    input.steps.length > config.max_steps
  )
    invalid("Piano non valido o numero massimo di passaggi superato.");
  const selected = new Set(config.assistant_ids);
  const steps: OrchestrationStep[] = input.steps.map((entry: unknown) => {
    const step = record(entry);
    if (
      !keys(step, ["assistant_id", "task"]) ||
      !validId(step.assistant_id) ||
      typeof step.task !== "string" ||
      step.task.trim().length < 1 ||
      step.task.length > 1800
    )
      invalid("Passaggio non valido.");
    if (!selected.has(step.assistant_id as string))
      throw new ProjectOrchestrationError(
        403,
        "assistant_not_selected",
        "Assistente non autorizzato per questo workflow.",
      );
    return {
      assistant_id: step.assistant_id as string,
      task: (step.task as string).trim(),
    };
  });
  return { steps };
}

/**
 * Bounded sequential dispatch. The injected delegate MUST be the same
 * assistant execution path used by the direct chat (including its router).
 * No model invocation, filesystem access, or cross-assistant permission is
 * provided by this coordinator.
 */
export async function executeProjectPlan(options: {
  project: { id: string; tenant_id: string };
  tenantId: string;
  config: ProjectOrchestrationConfig;
  members: readonly ProjectMember[];
  plan: unknown;
  signal: AbortSignal;
  delegate: Delegation;
}): Promise<{
  status: "complete";
  steps: { assistant_id: string; text: string }[];
}> {
  const { project, tenantId, config, members, signal, delegate } = options;
  const plan = validateOrchestrationPlan(options.plan, config);
  validateProjectParticipants(project, tenantId, config, members);
  const steps: { assistant_id: string; text: string }[] = [];
  for (const step of plan.steps) {
    signal.throwIfAborted();
    const previousResult =
      config.share_results && steps.length
        ? { ...steps[steps.length - 1] }
        : null;
    const result = await delegate({
      projectId: project.id,
      assistantId: step.assistant_id,
      task: step.task,
      previousResult,
      signal,
    });
    signal.throwIfAborted();
    if (
      result.status !== "complete" ||
      !result.text.trim() ||
      result.text.length > 12000
    )
      throw new ProjectOrchestrationError(
        502,
        "delegation_failed",
        "Esecuzione delegata incompleta: workflow interrotto.",
      );
    steps.push({ assistant_id: step.assistant_id, text: result.text });
  }
  return { status: "complete", steps };
}
