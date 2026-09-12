/** Amazon Bedrock via long-term API key bearer token. */
export const BEDROCK_PROVIDER_ID = "bedrock";
export const BEDROCK_DEFAULT_REGION = "eu-north-1";

/** Default Arrab desk models — override with BEDROCK_MODELS on Railway. */
export const BEDROCK_DEFAULT_MODELS = [
  "google.gemma-3-12b-it",
  "amazon.nova-lite-v1:0",
  "amazon.nova-pro-v1:0",
  "openai.gpt-oss-120b",
] as const;

export const BEDROCK_DEFAULT_MODEL = BEDROCK_DEFAULT_MODELS[0];

export function bedrockRuntimeBaseUrl(region: string): string {
  return `https://bedrock-runtime.${region.trim() || BEDROCK_DEFAULT_REGION}.amazonaws.com`;
}

/** OpenAI-compatible Chat Completions base for openai.* models on Bedrock. */
export function bedrockOpenAiBaseUrl(region: string): string {
  return `${bedrockRuntimeBaseUrl(region)}/openai/v1`;
}

export function isBedrockOpenAiModel(model: string | null | undefined): boolean {
  return (model ?? "").trim().toLowerCase().startsWith("openai.");
}

export function parseBedrockModels(raw: string | null | undefined): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv.slice(0, 12);
  }
  return [...BEDROCK_DEFAULT_MODELS];
}

export function isBedrockModel(
  model: string | null | undefined,
  knownModels: readonly string[] = BEDROCK_DEFAULT_MODELS,
): boolean {
  const value = (model ?? "").trim();
  if (!value) return false;
  if (knownModels.includes(value)) return true;
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
