/** Accessible project palettes. Legacy arbitrary colors are mapped on display, not deleted. */
export const PROJECT_PALETTES = [
  { id: "mint", name: "Mint", background: "#E5F7EE", foreground: "#174B35", accent: "#24754F" },
  { id: "sky", name: "Sky", background: "#E9F0FA", foreground: "#1C416C", accent: "#3468A3" },
  { id: "lavender", name: "Lavender", background: "#F0EAFE", foreground: "#4B327C", accent: "#7452B0" },
  { id: "peach", name: "Peach", background: "#FCEDE4", foreground: "#754029", accent: "#A75D39" },
  { id: "rose", name: "Rose", background: "#FBEAF0", foreground: "#79344E", accent: "#A74C6E" },
  { id: "lemon", name: "Lemon", background: "#F9F3D9", foreground: "#625016", accent: "#867021" },
  { id: "aqua", name: "Aqua", background: "#E1F5F4", foreground: "#19585B", accent: "#26787A" },
  { id: "slate", name: "Slate", background: "#E9EDF1", foreground: "#344453", accent: "#536779" },
] as const;

export const DEFAULT_PROJECT_COLOR = PROJECT_PALETTES[0].background;

function rgb(hex: string) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(value => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function resolveProjectPalette(color?: string | null) {
  const exact = PROJECT_PALETTES.find(p => p.background.toLowerCase() === color?.toLowerCase());
  if (exact) return exact;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return PROJECT_PALETTES[0];
  const [r, g, b] = rgb(color);
  return PROJECT_PALETTES.reduce((best, palette) => {
    const distance = (p: typeof PROJECT_PALETTES[number]) => {
      const [pr, pg, pb] = rgb(p.background);
      return (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    };
    return distance(palette) < distance(best) ? palette : best;
  }, PROJECT_PALETTES[0] as typeof PROJECT_PALETTES[number]);
}
export function projectForeground(color: string) {
  return resolveProjectPalette(color).foreground;
}

export type ProjectPaletteKey = (typeof PROJECT_PALETTES)[number]["id"];

export function isProjectPaletteKey(value: unknown): value is ProjectPaletteKey {
  return PROJECT_PALETTES.some(palette => palette.id === value);
}

export function projectPaletteByKey(key?: ProjectPaletteKey) {
  return PROJECT_PALETTES.find(palette => palette.id === key);
}

/** Semantic keys take precedence in templates; legacy hex-only bundles stay intact. */
export function resolvePaletteColor<T extends { color: string; palette?: ProjectPaletteKey }>(config: T): T {
  const palette = projectPaletteByKey(config.palette);
  return palette ? { ...config, color: palette.background } : config;
}

/** Foreground for an actual (possibly custom) background, without recoloring it. */
export function colorForeground(background: string) {
  const foreground = projectForeground(background);
  if (contrastRatio(background, foreground) >= 4.5) return foreground;
  return contrastRatio(background, "#FFFFFF") > contrastRatio(background, "#000000")
    ? "#FFFFFF" : "#000000";
}
