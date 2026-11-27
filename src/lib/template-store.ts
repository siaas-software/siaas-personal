import type { LocalDatabase } from "./local/database";
import rc5Builtins from "../generated/builtin-templates-rc5.json";
import {
  BUILTIN_TEMPLATES,
  templateProjectSchema,
  type ProjectTemplate,
} from "./templates";

import { resolveTemplateColor } from "./template-colors";
export { resolveTemplateColor } from "./template-colors";

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
    const previous = rows.find((row) => row.builtin_key === key);
    if (previous) {
      // Upgrade only a pristine, still-active RC5 official seed. Never change a
      // deleted (tombstoned) or user-customized preset, nor any existing project.
      const baseline = rc5Builtins[key as keyof typeof rc5Builtins];
      // Re-read and compare inside the write transaction: a settings edit or
      // tombstone may have committed while the initial query was awaited.
      const current = db.transaction(() => {
        const row = db.get("project_templates", previous.id);
        if (!row || row.tenant_id !== tenantId) return null;
        const isPristine =
          !row.deleted && row.orchestration === undefined && baseline !== undefined &&
          JSON.stringify(templateProjectSchema.parse(row)) ===
            JSON.stringify(templateProjectSchema.parse(baseline));
        return isPristine
          ? db.put("project_templates", { ...row, ...templateProjectSchema.parse(preset) }, true)
          : row;
      });
      if (current) Object.assign(previous, current);
      else previous.deleted = true;
      continue;
    }
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
