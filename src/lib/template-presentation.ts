import type { CSSProperties } from "react";
import { PROJECT_PALETTES, projectForeground } from "./project-colors";
import type { ProjectTemplate } from "./templates";

// Card presentation only; preserve official bundles and stored project colors.
// Matches siaas-public-site's homepage (9e4995a): Sky, Slate and Mint.
const BUILTIN_CARD_PALETTES: Readonly<
  Record<string, (typeof PROJECT_PALETTES)[number]["id"]>
> = {
  "computer-science-study": "sky",
  "production-planning": "slate",
  "personal-finance": "mint",
};

export function templateCardStyle(
  template: Pick<ProjectTemplate, "builtin_key" | "color">,
): CSSProperties {
  const palette = PROJECT_PALETTES.find(
    (candidate) =>
      candidate.id ===
      (template.builtin_key
        ? BUILTIN_CARD_PALETTES[template.builtin_key]
        : undefined),
  );
  if (!palette) {
    return {
      backgroundColor: template.color,
      color: projectForeground(template.color),
    };
  }
  return {
    backgroundColor: palette.background,
    color: palette.foreground,
    "--muted": palette.foreground,
  } as CSSProperties;
}
