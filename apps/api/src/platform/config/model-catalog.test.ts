import { describe, expect, it } from "vitest";
import {
  buildModelCatalog,
  buildModelRegistry,
  fallbackChainFor,
  providerForModel,
} from "./model-catalog.js";

describe("model registry", () => {
  it("keeps status catalog and registry ids in lockstep", () => {
    const input = {
      primaryProviderId: "bedrock",
      defaultModel: "amazon.nova-lite-v1:0",
      openRouterModels: [] as string[],
      bedrockModels: ["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0", "google.gemma-3-12b-it"],
    };
    expect(buildModelCatalog(input)).toEqual(buildModelRegistry(input).models.map((m) => m.id));
  });

  it("builds same-provider fallbacks ending at the default", () => {
    const registry = buildModelRegistry({
      primaryProviderId: "bedrock",
      defaultModel: "amazon.nova-lite-v1:0",
      openRouterModels: [],
      bedrockModels: ["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0", "google.gemma-3-12b-it"],
    });
    const pro = registry.models.find((m) => m.id === "amazon.nova-pro-v1:0");
    expect(pro?.providerId).toBe("bedrock");
    expect(pro?.fallbacks[0]).toBe("amazon.nova-lite-v1:0");
    expect(fallbackChainFor(registry, "amazon.nova-pro-v1:0")).toEqual([
      "amazon.nova-pro-v1:0",
      ...pro!.fallbacks,
    ]);
  });

  it("unknown requests resolve to the default chain, never an unlisted model", () => {
    const registry = buildModelRegistry({
      primaryProviderId: "bedrock",
      defaultModel: "amazon.nova-lite-v1:0",
      openRouterModels: [],
      bedrockModels: ["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0"],
    });
    expect(fallbackChainFor(registry, "openai/o1-pro")[0]).toBe("amazon.nova-lite-v1:0");
    expect(fallbackChainFor(registry, "  ")).toEqual(
      fallbackChainFor(registry, "amazon.nova-lite-v1:0"),
    );
  });

  it("labels models by provider without crossing families", () => {
    expect(providerForModel("amazon.nova-pro-v1:0", "bedrock")).toBe("bedrock");
    expect(providerForModel("deepseek/deepseek-chat", "openrouter")).toBe("openrouter");
    expect(providerForModel("grok-3-mini", "xai")).toBe("xai");
    expect(providerForModel("gpt-4o-mini", "openai")).toBe("openai");
  });

  it("caps the backup list so a cascading outage cannot multiply spend", () => {
    const many = Array.from({ length: 12 }, (_, i) => `amazon.nova-extra-${i}-v1:0`);
    const registry = buildModelRegistry({
      primaryProviderId: "bedrock",
      defaultModel: "amazon.nova-lite-v1:0",
      openRouterModels: [],
      bedrockModels: ["amazon.nova-lite-v1:0", ...many],
    });
    const entry = registry.models.find((m) => m.id === many[0]);
    expect(entry!.fallbacks.length).toBeLessThanOrEqual(3);
  });
});
