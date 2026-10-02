/**
 * One source of truth for what the UI may offer (`GET /v1/ai/models`, `/v1/ai/status`)
 * and what the chat path accepts — so a client cannot request a model that was never offered.
 *
 * Fallback chains stay on the same provider (no silent provider swap).
 */
import {
  isBedrockModel,
  isOpenRouterModel,
  isXaiGrokModel,
  BEDROCK_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  XAI_PROVIDER_ID,
} from "@arrab/ai";

export type ModelProviderKey =
  | typeof BEDROCK_PROVIDER_ID
  | typeof OPENROUTER_PROVIDER_ID
  | typeof XAI_PROVIDER_ID
  | "openai"
  | "anthropic";

export interface ModelRegistryEntry {
  id: string;
  providerId: ModelProviderKey;
  /** Same-provider models tried after a retryable failure of this one (ordered). */
  fallbacks: string[];
}

export interface ModelRegistry {
  primaryProviderId: ModelProviderKey;
  defaultModel: string | null;
  models: ModelRegistryEntry[];
}

const OPENAI_CATALOG = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] as const;
const ANTHROPIC_CATALOG = [
  "claude-3-5-haiku-latest",
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
] as const;
const XAI_CATALOG = ["grok-3-mini", "grok-3"] as const;

/** Cap how many backups we try so a cascading outage cannot multiply spend. */
const MAX_FALLBACKS = 3;

export function providerForModel(
  modelId: string,
  primaryProviderId: string,
): ModelProviderKey {
  const primary = (primaryProviderId || "bedrock") as ModelProviderKey;
  if (isOpenRouterModel(modelId)) return OPENROUTER_PROVIDER_ID;
  if (isBedrockModel(modelId)) return BEDROCK_PROVIDER_ID;
  if (isXaiGrokModel(modelId)) return XAI_PROVIDER_ID;
  if (primary === "openai" || primary === "anthropic" || primary === "xai") return primary;
  if (OPENAI_CATALOG.includes(modelId as (typeof OPENAI_CATALOG)[number])) return "openai";
  if (ANTHROPIC_CATALOG.includes(modelId as (typeof ANTHROPIC_CATALOG)[number])) return "anthropic";
  return primary;
}

function baseCatalog(input: {
  primaryProviderId: string | undefined;
  openRouterModels: readonly string[] | undefined;
  bedrockModels: readonly string[] | undefined;
}): string[] {
  const primary = input.primaryProviderId ?? "bedrock";
  if (primary === "openrouter") return [...(input.openRouterModels ?? [])];
  if (primary === "openai") return [...OPENAI_CATALOG];
  if (primary === "anthropic") return [...ANTHROPIC_CATALOG];
  if (primary === "xai") return [...XAI_CATALOG];
  return [...(input.bedrockModels ?? [])];
}

function uniqueModels(ids: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      ids
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item)),
    ),
  ];
}

function fallbacksFor(
  id: string,
  catalog: readonly string[],
  defaultModel: string | null,
  providerId: ModelProviderKey,
  primaryProviderId: string,
): string[] {
  const sameProvider = catalog.filter(
    (model) => model !== id && providerForModel(model, primaryProviderId) === providerId,
  );
  const ordered = [
    ...(defaultModel &&
    defaultModel !== id &&
    providerForModel(defaultModel, primaryProviderId) === providerId
      ? [defaultModel]
      : []),
    ...sameProvider.filter((model) => model !== defaultModel),
  ];
  return [...new Set(ordered)].slice(0, MAX_FALLBACKS);
}

export function buildModelRegistry(input: {
  primaryProviderId: string | undefined;
  defaultModel: string | null | undefined;
  openRouterModels: readonly string[] | undefined;
  bedrockModels: readonly string[] | undefined;
}): ModelRegistry {
  const primaryProviderId = (input.primaryProviderId ?? "bedrock") as ModelProviderKey;
  const defaultModel = input.defaultModel?.trim() || null;
  const ids = uniqueModels([defaultModel, ...baseCatalog(input)]);
  const models: ModelRegistryEntry[] = ids.map((id) => {
    const providerId = providerForModel(id, primaryProviderId);
    return {
      id,
      providerId,
      fallbacks: fallbacksFor(id, ids, defaultModel, providerId, primaryProviderId),
    };
  });
  return { primaryProviderId, defaultModel, models };
}

/** Flat allowlist used by ConversationService.resolveModel and `/v1/ai/status`. */
export function buildModelCatalog(input: {
  primaryProviderId: string | undefined;
  defaultModel: string | null | undefined;
  openRouterModels: readonly string[] | undefined;
  bedrockModels: readonly string[] | undefined;
}): string[] {
  return buildModelRegistry(input).models.map((entry) => entry.id);
}

/**
 * Ordered try-list for a chat request: resolved primary model, then same-provider backups.
 * Unknown / empty requests resolve to the studio default (alone, or with its fallbacks).
 */
export function fallbackChainFor(
  registry: ModelRegistry,
  requested: string | null | undefined,
): string[] {
  const wanted = requested?.trim();
  const allowed = new Set(registry.models.map((entry) => entry.id));
  const primary =
    wanted && allowed.has(wanted)
      ? wanted
      : registry.defaultModel && allowed.has(registry.defaultModel)
        ? registry.defaultModel
        : (registry.models[0]?.id ?? null);
  if (!primary) return [];
  const entry = registry.models.find((model) => model.id === primary);
  return uniqueModels([primary, ...(entry?.fallbacks ?? [])]);
}
