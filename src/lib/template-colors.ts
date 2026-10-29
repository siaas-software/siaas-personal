import { BUILTIN_TEMPLATES } from "./templates";
import { resolvePaletteColor, type ProjectPaletteKey } from "./project-colors";

// Only historical official defaults are upgraded on read. No persisted row is rewritten.
const LEGACY_BUILTIN_COLORS: Readonly<Record<string, string>> = {
  "production-planning": "#173D35",
  "personal-finance": "#244C78",
};

export function resolveTemplateColor<
  T extends {
    builtin_key?: string | null;
    color: string;
    palette?: ProjectPaletteKey;
  },
>(template: T): T & { palette?: ProjectPaletteKey } {
  if (template.palette) return resolvePaletteColor(template);
  const key = template.builtin_key;
  const official =
    key && Object.hasOwn(BUILTIN_TEMPLATES, key)
      ? BUILTIN_TEMPLATES[key]
      : undefined;
  if (
    official &&
    [official.color.toUpperCase(), LEGACY_BUILTIN_COLORS[key!]].includes(
      template.color.toUpperCase(),
    )
  ) {
    return resolvePaletteColor({ ...template, palette: official.palette });
  }
  return template;
}
