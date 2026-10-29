import { z } from "zod";
import {
  isProjectPaletteKey,
  resolvePaletteColor,
  type ProjectPaletteKey,
} from "./project-colors";
import { publicWebURL } from "./research";
import builtinTemplates from "../generated/builtin-templates.json";

// Explicit allowlist: private files, chats, IDs and retrieval indexes never travel.
export const templateAssistantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  instructions: z.string().trim().max(6000).default(""),
  sources: z
    .array(
      z
        .string()
        .trim()
        .max(1500)
        .transform((value, ctx) => {
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
  model: z
    .string()
    .max(150)
    .nullable()
    .optional()
    .transform(() => null),
});
export const templateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#FFFFFF"),
    palette: z
      .custom<ProjectPaletteKey>(isProjectPaletteKey, "Unknown project palette")
      .optional(),
    assistants: z.array(templateAssistantSchema).max(50),
  })
  .transform(resolvePaletteColor);
export const templateBundleSchema = z.object({
  format: z.literal("siaas-project-v1"),
  project: templateProjectSchema,
});
export type TemplateProject = z.infer<typeof templateProjectSchema>;
export type ProjectTemplate = TemplateProject & {
  id: string;
  builtin_key: string | null;
};
export function templateBundle(project: unknown) {
  return {
    format: "siaas-project-v1" as const,
    project: templateProjectSchema.parse(project),
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
