// Pricing snapshot, verified against https://ai.google.dev/gemini-api/docs/pricing
// on 2026-10-02. Standard paid TEXT embedding only; no model training.
export const EXTERNAL_PROVIDER = {
  name: "Google Gemini",
  model: "gemini-embedding-2",
  usdPerMillion: 0.2,
  checkedAt: "2026-10-02",
  source: "https://ai.google.dev/gemini-api/docs/pricing",
};
export function estimateExternal(text: string) {
  const characters = text.trim().length;
  // A range rather than a tokenizer claim. 15% allowance for overlapping chunks.
  const lowTokens = Math.ceil((characters / 4) * 1.15);
  const highTokens = Math.ceil((characters / 2) * 1.15);
  return {
    characters,
    lowTokens,
    highTokens,
    lowUSD: (lowTokens / 1_000_000) * EXTERNAL_PROVIDER.usdPerMillion,
    highUSD: (highTokens / 1_000_000) * EXTERNAL_PROVIDER.usdPerMillion,
  };
}
