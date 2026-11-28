import { createHash } from "node:crypto";
import { z } from "zod";

const name = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
  .refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
const description = z.string().max(1024);
const field = z
  .object({
    type: z.enum(["string", "boolean", "integer", "number"]),
    description: description.optional(),
    enum: z
      .array(z.union([z.string().max(512), z.number().finite(), z.boolean()]))
      .min(1)
      .max(32)
      .optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    minLength: z.number().int().min(0).max(8192).optional(),
    maxLength: z.number().int().min(0).max(8192).optional(),
  })
  .strict();
const input = z
  .object({
    type: z.literal("object"),
    properties: z.record(name, field).default({}),
    required: z.array(name).max(32).default([]),
    additionalProperties: z.literal(false).optional(),
    $schema: z
      .enum([
        "https://json-schema.org/draft/2020-12/schema",
        "http://json-schema.org/draft-07/schema#",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (s) =>
      Object.keys(s.properties).length <= 32 &&
      s.required.every((k) => Object.hasOwn(s.properties, k)),
  );
export const discoveredTool = z.object({
  name,
  description: description.optional(),
  inputSchema: input,
});
export type McpTool = z.infer<typeof discoveredTool>;

export function normalizedTool(raw: unknown): McpTool {
  const tool = discoveredTool.parse(raw);
  for (const f of Object.values(tool.inputSchema.properties)) {
    const numeric = f.type === "number" || f.type === "integer";
    if (
      (!numeric && (f.minimum !== undefined || f.maximum !== undefined)) ||
      (f.type !== "string" &&
        (f.minLength !== undefined || f.maxLength !== undefined)) ||
      (f.minimum ?? -Infinity) > (f.maximum ?? Infinity) ||
      (f.minLength ?? 0) > (f.maxLength ?? Infinity) ||
      f.enum?.some((v) => typeof v !== (numeric ? "number" : f.type))
    )
      throw new Error("Unsupported MCP schema.");
  }
  return tool;
}
export const toolDigest = (tool: McpTool) =>
  createHash("sha256").update(JSON.stringify(tool)).digest("hex");
export function validateToolArguments(tool: McpTool, value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Invalid tool arguments.");
  const args = value as Record<string, unknown>,
    schema = tool.inputSchema;
  if (
    Object.keys(args).length > 32 ||
    schema.required.some((k) => !Object.hasOwn(args, k))
  )
    throw new Error("Missing tool argument.");
  for (const [key, v] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key))
      throw new Error("Unknown tool argument.");
    const f = schema.properties[key];
    if (
      typeof v !== (f.type === "integer" ? "number" : f.type) ||
      (f.type === "integer" && !Number.isSafeInteger(v)) ||
      (typeof v === "number" &&
        (!Number.isFinite(v) ||
          v < (f.minimum ?? -Infinity) ||
          v > (f.maximum ?? Infinity))) ||
      (typeof v === "string" &&
        (v.length < (f.minLength ?? 0) || v.length > (f.maxLength ?? 8192))) ||
      (f.enum && !f.enum.some((e) => e === v))
    )
      throw new Error("Invalid tool argument.");
  }
  if (Buffer.byteLength(JSON.stringify(args)) > 16384)
    throw new Error("Tool arguments too large.");
  return Object.fromEntries(Object.entries(args)) as Record<
    string,
    string | number | boolean
  >;
}
