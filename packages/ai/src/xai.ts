/** xAI (Grok) — OpenAI-compatible chat API. */
export const XAI_PROVIDER_ID = "xai";
export const XAI_BASE_URL = "https://api.x.ai/v1";
export const XAI_DEFAULT_MODEL = "grok-3-mini";

export function isXaiGrokModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith("grok-") || normalized === "grok";
}
