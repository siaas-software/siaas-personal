import { researchSettingsSchema } from "./research";
import { isLocalModelId } from "./model-name";
import { MODELS, DEFAULT_MODEL } from "./catalog";
import { z } from "zod";
export const assistantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  instructions: z.string().trim().max(6000).default(""),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#173D35"),
  model_id: z.enum(MODELS.map((m) => m.id)).default(DEFAULT_MODEL),
});

export const desktopAssistantSchema = assistantSchema.extend({
  research: researchSettingsSchema.optional(),
  model_id: z
    .string()
    .refine(isLocalModelId, "Scegli un modello Ollama locale.")
    .nullable()
    .default(null),
});
