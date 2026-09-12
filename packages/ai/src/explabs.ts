/** Experiential Labs OpenAI-compatible gateway for gpt-5.6-luna. */
export const EXPLABS_PROVIDER_ID = "experiential";
export const EXPLABS_BASE_URL = "https://api.experientiallabs.ai/v1";
export const EXPLABS_LUNA_MODEL = "gpt-5.6-luna";

export function isExplabsLunaModel(model: string | null | undefined): boolean {
  return (model ?? "").trim() === EXPLABS_LUNA_MODEL;
}
