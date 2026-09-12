import { describe, expect, it } from "vitest";
import { type AiGatewayError, RegistryAiGateway } from "./index.js";

describe("RegistryAiGateway", () => {
  it("fails closed when no provider is registered", async () => {
    const gateway = new RegistryAiGateway();
    await expect(
      gateway.complete({
        model: { providerId: "openai", model: "gpt-4.1" },
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({ code: "NO_PROVIDER" } satisfies Partial<AiGatewayError>);
  });
});
