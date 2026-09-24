import type { AiGatewayStatusResponse } from "@arrab/shared";
import { canUseCloudAi } from "@/lib/guest-mode";
import { readPrefs, type StudioPrefs } from "@/lib/prefs";

export { canUseCloudAi } from "@/lib/guest-mode";

/** Throw when cloud Arrab AI is requested without a signed-in session. */
export function assertCloudAiAllowed(): void {
  if (canUseCloudAi()) return;
  throw new Error(
    "Sign in to use cloud AI. Without an account you can only run local models.",
  );
}

const CHATGPT_FALLBACK = "openai/gpt-4o-mini";
const CLAUDE_FALLBACK = "anthropic/claude-3.5-haiku";
/** Prefer DeepSeek flash when the API lists it — lowest TTFT on Arrab. */
const FAST_OPENROUTER_FALLBACK = "deepseek/deepseek-v4.1-flash";

function isChatGptModel(model: string): boolean {
  const value = model.toLowerCase();
  return value.startsWith("openai/") || value.startsWith("gpt-");
}

function isClaudeModel(model: string): boolean {
  const value = model.toLowerCase();
  return value.startsWith("anthropic/") || value.startsWith("claude-");
}

function isFastOpenRouterModel(model: string): boolean {
  const value = model.toLowerCase();
  return (
    value.includes("flash") ||
    value.includes("haiku") ||
    value.includes("deepseek") ||
    value.includes("mini")
  );
}

/** Higher = better for companion TTFT. Avoids picking slow gpt-4o-mini first. */
function companionSpeedScore(model: string): number {
  const value = model.toLowerCase();
  if (value.includes("v4.1-flash") || value.includes("flash-0731")) return 100;
  if (value.includes("gemini") && value.includes("flash")) return 92;
  if (value.includes("flash")) return 88;
  if (value.includes("haiku")) return 80;
  if (value.includes("deepseek")) return 75;
  if (value.includes("mini")) return 35;
  return 10;
}

/** Resolve the model id Chat/Cowork should send to the Arrab API. */
export function resolvePreferredModel(
  status: AiGatewayStatusResponse | null | undefined,
  prefs: StudioPrefs = readPrefs(),
): string | null {
  const models = status?.models?.filter(Boolean) ?? [];
  const preferred = prefs.aiPreferredModel.trim();
  if (preferred) {
    if (models.length === 0 || models.includes(preferred)) return preferred;
  }

  if (prefs.aiPreferredFamily === "chatgpt") {
    return models.find(isChatGptModel) ?? CHATGPT_FALLBACK;
  }
  if (prefs.aiPreferredFamily === "claude") {
    return models.find(isClaudeModel) ?? CLAUDE_FALLBACK;
  }

  // Auto: prefer the API default (OpenRouter flash when configured), else a fast model.
  if (status?.defaultModel) return status.defaultModel;
  return models.find(isFastOpenRouterModel) ?? models[0] ?? FAST_OPENROUTER_FALLBACK;
}

/**
 * Companion chat always picks the fastest flash-class OpenRouter model,
 * unless the operator pinned an exact model in Settings → AI.
 */
export function resolveCompanionModel(
  status: AiGatewayStatusResponse | null | undefined,
  prefs: StudioPrefs = readPrefs(),
): string {
  const models = status?.models?.filter(Boolean) ?? [];
  const preferred = prefs.aiPreferredModel.trim();
  if (preferred && (models.length === 0 || models.includes(preferred))) {
    return preferred;
  }
  const ranked = [...models].sort((a, b) => companionSpeedScore(b) - companionSpeedScore(a));
  if (ranked[0] && companionSpeedScore(ranked[0]) >= 70) return ranked[0]!;
  if (status?.defaultModel && companionSpeedScore(status.defaultModel) >= 70) {
    return status.defaultModel;
  }
  return ranked[0] ?? FAST_OPENROUTER_FALLBACK;
}

/** True when a local Ollama model was downloaded and selected in Settings. */
export function hasLocalModelSelected(prefs: StudioPrefs = readPrefs()): boolean {
  return Boolean(prefs.aiLocalEnabled && prefs.aiLocalModel.trim());
}

/**
 * Local wins when selected. Cloud needs a signed-in session.
 * Unsigned + no local model → blocked (prompt sign-in or pick Ollama).
 */
export function resolveAiRuntime(
  prefs: StudioPrefs = readPrefs(),
): "local" | "cloud" | "blocked" {
  if (hasLocalModelSelected(prefs)) return "local";
  if (canUseCloudAi()) return "cloud";
  return "blocked";
}

export function providerConnected(
  status: AiGatewayStatusResponse | null | undefined,
  kind: "chatgpt" | "claude" | "openrouter" | "bedrock" | "openai" | "anthropic",
): boolean {
  const providers = new Set((status?.providers ?? []).map((item) => item.toLowerCase()));
  if (!status?.configured) return false;
  if (kind === "openrouter") return providers.has("openrouter");
  if (kind === "bedrock") return providers.has("bedrock");
  if (kind === "openai") return providers.has("openai");
  if (kind === "anthropic") return providers.has("anthropic");
  if (kind === "chatgpt") {
    return providers.has("openai") || providers.has("openrouter");
  }
  if (kind === "claude") {
    return providers.has("anthropic") || providers.has("openrouter");
  }
  return false;
}
