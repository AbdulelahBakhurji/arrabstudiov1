/** Amazon Bedrock via long-term API key bearer token. */
export const BEDROCK_PROVIDER_ID = "bedrock";
export const BEDROCK_DEFAULT_REGION = "eu-north-1";

/**
 * Default Arrab desk models for eu-north-1.
 * Nova uses EU geo inference profiles; gpt-oss uses the runtime model id.
 * Override with BEDROCK_MODELS on Railway.
 */
export const BEDROCK_DEFAULT_MODELS = [
  "eu.amazon.nova-lite-v1:0",
  "eu.amazon.nova-pro-v1:0",
  "google.gemma-3-12b-it",
  "openai.gpt-oss-120b-1:0",
] as const;

export const BEDROCK_DEFAULT_MODEL = BEDROCK_DEFAULT_MODELS[0];

export function bedrockRuntimeBaseUrl(region: string): string {
  return `https://bedrock-runtime.${region.trim() || BEDROCK_DEFAULT_REGION}.amazonaws.com`;
}

/** OpenAI-compatible Chat Completions base for openai.* / gemma models on Bedrock. */
export function bedrockOpenAiBaseUrl(region: string): string {
  return `${bedrockRuntimeBaseUrl(region)}/openai/v1`;
}

/** Models that must use Bedrock's OpenAI-compatible Chat Completions endpoint. */
export function isBedrockOpenAiModel(model: string | null | undefined): boolean {
  const value = (model ?? "").trim().toLowerCase();
  return value.startsWith("openai.") || value.startsWith("google.gemma");
}

/**
 * Map friendly / bare IDs to ones that work from eu-north-1 (and other EU regions).
 * Railway may still have older aliases — normalize before every request.
 */
export function normalizeBedrockModelId(
  model: string | null | undefined,
  region: string = BEDROCK_DEFAULT_REGION,
): string {
  const value = (model ?? "").trim();
  if (!value) return BEDROCK_DEFAULT_MODEL;
  const eu = (region || BEDROCK_DEFAULT_REGION).toLowerCase().startsWith("eu");

  if (value === "openai.gpt-oss-120b") return "openai.gpt-oss-120b-1:0";
  if (value === "openai.gpt-oss-20b") return "openai.gpt-oss-20b-1:0";

  if (eu) {
    if (value === "amazon.nova-lite-v1:0") return "eu.amazon.nova-lite-v1:0";
    if (value === "amazon.nova-pro-v1:0") return "eu.amazon.nova-pro-v1:0";
    if (value === "amazon.nova-micro-v1:0") return "eu.amazon.nova-micro-v1:0";
  }

  return value;
}

export function parseBedrockModels(raw: string | null | undefined): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv.slice(0, 12).map((id) => normalizeBedrockModelId(id));
  }
  return [...BEDROCK_DEFAULT_MODELS];
}

export function isBedrockModel(
  model: string | null | undefined,
  knownModels: readonly string[] = BEDROCK_DEFAULT_MODELS,
): boolean {
  const value = (model ?? "").trim();
  if (!value) return false;
  const normalized = normalizeBedrockModelId(value);
  if (knownModels.includes(value) || knownModels.includes(normalized)) return true;
  // Common Bedrock id shapes / inference profiles.
  return (
    value.startsWith("amazon.") ||
    value.startsWith("google.") ||
    value.startsWith("anthropic.") ||
    value.startsWith("meta.") ||
    value.startsWith("mistral.") ||
    value.startsWith("cohere.") ||
    value.startsWith("openai.") ||
    value.startsWith("eu.") ||
    value.startsWith("us.") ||
    value.startsWith("apac.") ||
    /^[a-z]{2}\./i.test(value)
  );
}
