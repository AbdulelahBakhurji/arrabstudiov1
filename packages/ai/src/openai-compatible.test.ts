import { describe, expect, it } from "vitest";
import { AiGatewayError, OpenAiCompatibleAdapter } from "./index.js";

describe("OpenAiCompatibleAdapter", () => {
  it("maps a successful chat completion", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "cmpl_1",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const adapter = new OpenAiCompatibleAdapter({ apiKey: "test-key" });
      const result = await adapter.complete({
        model: { providerId: "openai", model: "gpt-4o-mini" },
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(result.message.content).toBe("Hello");
      expect(result.usage?.inputTokens).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces provider errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const adapter = new OpenAiCompatibleAdapter({ apiKey: "bad" });
      await expect(
        adapter.complete({
          model: { providerId: "openai", model: "gpt-4o-mini" },
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toBeInstanceOf(AiGatewayError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
