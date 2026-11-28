import { z } from "zod";
import {
  isProjectPaletteKey,
  resolvePaletteColor,
  type ProjectPaletteKey,
} from "./project-colors";
import {
  parseProjectOrchestration,
  type ProjectOrchestrationConfig,
} from "./project-orchestration";
import { publicWebURL } from "./research";
import builtinTemplates from "../generated/builtin-templates.json";

// Explicit allowlist: local IDs, private files, chats and retrieval indexes never travel.
export const templateAssistantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  instructions: z.string().trim().max(6000).default(""),
  sources: z
    .array(
      z.string().trim().max(1500).transform((value, ctx) => {
        try {
          return publicWebURL(value).href;
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Enter a public HTTP/HTTPS URL without credentials.",
          });
          return z.NEVER;
        }
      }),
    )
    .max(100)
    .default([])
    .transform((urls) => [...new Set(urls)]),
  // Accept legacy models, but let the destination computer choose its own.
  model: z.string().max(150).nullable().optional().transform(() => null),
});

// A portable template refers to its assistants by array index, never by
// the UUIDs assigned to assistants on a particular machine.
export const templateOrchestrationSchema = z
  .object({
    enabled: z.boolean().default(false),
    instructions: z.string().trim().max(4000).default(""),
    share_results: z.boolean().default(false),
    assistant_indices: z.array(z.number().int().min(0).max(49)).max(8).default([]),
    max_steps: z.number().int().min(1).max(8).default(4),
  })
  .strict()
  .refine(
    (value) => new Set(value.assistant_indices).size === value.assistant_indices.length,
    { message: "Select unique assistant indices.", path: ["assistant_indices"] },
  );

const ref = z.object({ name:z.string().min(1).max(80), digest:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const requestedTools = z.object({
  actions:z.array(ref).max(100),
  skills:z.array(ref.extend({ assistant_indices:z.array(z.number().int().min(0).max(49)).max(50) })).max(100),
  rules:z.array(z.object({capability:z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/),decision:z.enum(["allow","ask","deny"])}).strict()).max(100),
}).strict();
export const templateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#FFFFFF"),
    palette: z.custom<ProjectPaletteKey>(isProjectPaletteKey, "Unknown project palette").optional(),
    assistants: z.array(templateAssistantSchema).max(50),
    orchestration: templateOrchestrationSchema.optional(),
    requested_tools:requestedTools.optional(),
  })
  .superRefine((value, ctx) => {
    for (const skill of value.requested_tools?.skills ?? [])
      if (skill.assistant_indices.some(i=>i>=value.assistants.length) || new Set(skill.assistant_indices).size!==skill.assistant_indices.length)
        ctx.addIssue({code:"custom",message:"Invalid Skill assistant references."});
    const rules = value.requested_tools?.rules ?? [];
    if (new Set(rules.map(r=>r.capability)).size!==rules.length)
      ctx.addIssue({code:"custom",message:"Duplicate requested permission."});
    const orchestration = value.orchestration;
    if (!orchestration) return;
    for (const index of orchestration.assistant_indices) {
      if (index >= value.assistants.length)
        ctx.addIssue({
          code: "custom",
          message: "Unknown template assistant index.",
          path: ["orchestration", "assistant_indices"],
        });
    }
    if (
      orchestration.enabled &&
      (orchestration.assistant_indices.length === 0 ||
        orchestration.assistant_indices.length > orchestration.max_steps)
    )
      ctx.addIssue({
        code: "custom",
        message: "Enabled orchestration must select assistants within the step budget.",
        path: ["orchestration", "max_steps"],
      });
  })
  .transform(resolvePaletteColor);

export const templateBundleSchema = z
  .object({
    format: z.enum(["siaas-project-v1", "siaas-project-v2", "siaas-project-v3"]),
    project: templateProjectSchema,
  })
  .superRefine((bundle, ctx) => {
    if (Boolean(bundle.project.requested_tools) !== (bundle.format === "siaas-project-v3"))
      ctx.addIssue({code:"custom",message:"Portable tool requests require v3."});
    if (bundle.format === "siaas-project-v1" && bundle.project.orchestration)
      ctx.addIssue({ code: "custom", message: "Project orchestration requires template format v2.", path: ["project", "orchestration"] });
    if (bundle.format !== "siaas-project-v1" && !bundle.project.orchestration)
      ctx.addIssue({ code: "custom", message: "Template v2 requires project orchestration.", path: ["project", "orchestration"] });
  });

export type TemplateProject = z.infer<typeof templateProjectSchema>;
export type ProjectTemplate = TemplateProject & {
  id: string;
  builtin_key: string | null;
};

export function materializeTemplateOrchestration(
  value: TemplateProject["orchestration"],
  assistantIds: string[],
): ProjectOrchestrationConfig {
  if (!value) return parseProjectOrchestration(null);
  const assistant_ids = value.assistant_indices.map((index) => {
    const id = assistantIds[index];
    if (!id) throw new Error("Template references an unavailable assistant.");
    return id;
  });
  return parseProjectOrchestration({
    enabled: value.enabled,
    instructions: value.instructions,
    share_results: value.share_results,
    assistant_ids,
    max_steps: value.max_steps,
  });
}

export function portableTemplateOrchestration(
  value: unknown,
  assistantIds: string[],
): NonNullable<TemplateProject["orchestration"]> {
  const configuration = parseProjectOrchestration(value);
  const assistant_indices = configuration.assistant_ids.map((id) => {
    const index = assistantIds.indexOf(id);
    if (index < 0) throw new Error("Project orchestration references an unavailable assistant.");
    return index;
  });
  return templateOrchestrationSchema.parse({
    enabled: configuration.enabled,
    instructions: configuration.instructions,
    share_results: configuration.share_results,
    assistant_indices,
    max_steps: configuration.max_steps,
  });
}

export function templateBundle(project: unknown) {
  const config = templateProjectSchema.parse(project);
  return {
    format: config.requested_tools ? "siaas-project-v3" as const : "siaas-project-v2" as const,
    project: {
      ...config,
      orchestration: config.orchestration ?? templateOrchestrationSchema.parse({}),
    },
  };
}

// Generated from the pinned siaas-templates catalog; update with npm run templates:sync.
export const BUILTIN_TEMPLATES: Record<string, TemplateProject> =
  Object.fromEntries(
    Object.entries(builtinTemplates).map(([id, project]) => [
      id,
      templateProjectSchema.parse(project),
    ]),
  );
