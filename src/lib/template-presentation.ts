import type { CSSProperties } from "react";
import { colorForeground, projectPaletteByKey } from "./project-colors";
import { resolveTemplateColor } from "./template-colors";
import type { ProjectTemplate } from "./templates";

export function templateCardStyle(
  template: Pick<ProjectTemplate, "builtin_key" | "color" | "palette">,
): CSSProperties {
  const resolved = resolveTemplateColor(template);
  const palette = projectPaletteByKey(resolved.palette);
  const foreground = palette?.foreground ?? colorForeground(resolved.color);
  return {
    backgroundColor: resolved.color,
    color: foreground,
    "--muted": foreground,
    "--template-accent": palette?.accent ?? foreground,
  } as CSSProperties;
}
