import type { LocalDatabase } from "./local/database";
import {
  BUILTIN_TEMPLATES,
  templateProjectSchema,
  type ProjectTemplate,
} from "./templates";

// Resolve only the former official defaults at read time. Saved rows and projects
// are untouched; user-selected colors and all other configuration remain intact.
const LEGACY_BUILTIN_COLORS: Readonly<Record<string, string>> = {
  "production-planning": "#173D35",
  "personal-finance": "#244C78",
};

export function resolveTemplateColor<
  T extends { builtin_key?: string | null; color: string },
>(template: T): T {
  const key = template.builtin_key;
  const official =
    key && Object.hasOwn(BUILTIN_TEMPLATES, key)
      ? BUILTIN_TEMPLATES[key]
      : undefined;
  return official &&
    template.color.toUpperCase() === LEGACY_BUILTIN_COLORS[key!]
    ? { ...template, color: official.color }
    : template;
}

export async function listTemplates(
  db: LocalDatabase,
  tenantId: string,
): Promise<ProjectTemplate[]> {
  const { data, error } = await db
    .from("project_templates")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  const rows = data ?? [];
  for (const [key, preset] of Object.entries(BUILTIN_TEMPLATES)) {
    if (rows.some((row) => row.builtin_key === key)) continue;
    const project = templateProjectSchema.parse(preset);
    const { data: inserted, error: insertError } = await db
      .from("project_templates")
      .insert({
        ...project,
        id: `${tenantId}:${key}`,
        tenant_id: tenantId,
        builtin_key: key,
        deleted: false,
      })
      .select()
      .single();
    if (insertError) {
      // A concurrent request may have seeded this same preset, including its tombstone.
      const { data: concurrent, error: readError } = await db
        .from("project_templates")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("builtin_key", key)
        .maybeSingle();
      if (readError || !concurrent) throw insertError;
      rows.push(concurrent);
    } else rows.push(inserted);
  }
  return rows
    .filter(
      (row) =>
        !row.deleted &&
        (!row.builtin_key || row.builtin_key in BUILTIN_TEMPLATES),
    )
    .map((row) =>
      resolveTemplateColor({
        ...templateProjectSchema.parse(row),
        id: row.id,
        builtin_key: row.builtin_key,
      }),
    );
}
