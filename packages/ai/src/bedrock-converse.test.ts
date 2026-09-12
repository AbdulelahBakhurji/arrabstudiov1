import { describe, expect, it } from "vitest";
import { AiGatewayError, BedrockConverseAdapter } from "./index.js";

describe("BedrockConverseAdapter", () => {
  it("posts to the regional Converse endpoint with bearer auth", async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      seenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output: {
            message: {
              role: "assistant",
              content: [{ text: "Hello from Bedrock" }],
            },
          },
          stopReason: "end_turn",
          usage: { inputTokens: 4, outputTokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const adapter = new BedrockConverseAdapter({
        apiKey: "ABSK-test",
        region: "eu-north-1",
      });
      const result = await adapter.complete({
        model: { providerId: "bedrock", model: "google.gemma-3-12b-it" },
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
        maxOutputTokens: 200,
        temperature: 0.2,
      });
      expect(result.message.content).toBe("Hello from Bedrock");
      expect(seenUrl).toBe(
        "https://bedrock-runtime.eu-north-1.amazonaws.com/model/google.gemma-3-12b-it/converse",
      );
      expect(seenAuth).toBe("Bearer ABSK-test");
      expect(Array.isArray(seenBody.system)).toBe(true);
      expect((seenBody.inferenceConfig as { maxTokens?: number }).maxTokens).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps Bedrock toolUse into Arrab tool calls", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: {
            message: {
              role: "assistant",
              content: [
                {
                  toolUse: {
                    toolUseId: "call_1",
                    name: "list_files",
                    input: { relative: "." },
                  },
                },
              ],
            },
          },
          stopReason: "tool_use",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const adapter = new BedrockConverseAdapter({ apiKey: "key", region: "eu-north-1" });
      const result = await adapter.complete({
        model: { providerId: "bedrock", model: "amazon.nova-lite-v1:0" },
        messages: [{ role: "user", content: "list files" }],
        tools: [{ name: "list_files", description: "List files" }],
      });
      expect(result.finishReason).toBe("tool_calls");
      expect(result.toolCalls?.[0]?.name).toBe("list_files");
      expect(result.toolCalls?.[0]?.arguments).toContain("relative");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces Bedrock errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const adapter = new BedrockConverseAdapter({ apiKey: "bad", region: "eu-north-1" });
      await expect(
        adapter.complete({
          model: { providerId: "bedrock", model: "google.gemma-3-12b-it" },
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toBeInstanceOf(AiGatewayError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
