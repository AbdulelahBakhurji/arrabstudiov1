/** OpenRouter — OpenAI-compatible multi-model gateway. */
export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Fast default for chat — Flash-class models keep TTFT low on OpenRouter. */
export const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

export const OPENROUTER_DEFAULT_MODELS = [
  "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-chat",
  "google/gemini-2.5-flash",
  "anthropic/claude-3.5-haiku",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
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
    // Preserve order; drop duplicates so OPENROUTER_MODELS can grow freely.
    return [...new Set(fromEnv)];
  }
  return [...OPENROUTER_DEFAULT_MODELS];
}
