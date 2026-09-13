/** OpenRouter — OpenAI-compatible multi-model gateway. */
export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Fast, cheap default while Bedrock is unavailable. */
export const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

export const OPENROUTER_DEFAULT_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "google/gemini-2.5-flash",
  "anthropic/claude-3.5-haiku",
  "deepseek/deepseek-chat",
] as const;

/** OpenRouter model IDs use org/model (slash). */
export function isOpenRouterModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const value = model.trim();
  if (!value.includes("/")) return false;
  // Bedrock uses dots (openai.gpt-oss…); OpenRouter uses slashes.
  return !value.startsWith("amazon.") && !value.startsWith("eu.") && !value.startsWith("us.");
}

export function parseOpenRouterModels(raw: string | null | undefined): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv.slice(0, 12);
  }
  return [...OPENROUTER_DEFAULT_MODELS];
}
