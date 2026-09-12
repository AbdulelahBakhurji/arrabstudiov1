import { describe, expect, it } from "vitest";
import { AiGatewayError, OpenAiCompatibleAdapter } from "./index.js";

function captureFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("OpenAiCompatibleAdapter", () => {
  it("maps a successful chat completion", async () => {
    const fetch = captureFetch(async () =>
      new Response(
        JSON.stringify({
          id: "cmpl_1",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const adapter = new OpenAiCompatibleAdapter({ apiKey: "test-key" });
      const result = await adapter.complete({
        model: { providerId: "openai", model: "gpt-4o-mini" },
        messages: [{ role: "user", content: "Hi" }],
        maxOutputTokens: 280,
      });
      expect(result.message.content).toBe("Hello");
      expect(result.usage?.inputTokens).toBe(3);
      expect(fetch.calls[0]?.body.max_tokens).toBe(280);
      expect(fetch.calls[0]?.body.reasoning_effort).toBeUndefined();
    } finally {
      fetch.restore();
    }
  });

  it("turns off GPT-5.6 Luna reasoning and uses max_completion_tokens", async () => {
    const fetch = captureFetch(async () =>
      new Response(
        JSON.stringify({
          id: "cmpl_luna",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hi" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const adapter = new OpenAiCompatibleAdapter({
        id: "experiential",
        apiKey: "explabs",
        baseUrl: "https://api.experientiallabs.ai/v1",
      });
      await adapter.complete({
        model: { providerId: "experiential", model: "gpt-5.6-luna" },
        messages: [{ role: "user", content: "Hi" }],
        maxOutputTokens: 280,
        temperature: 0.4,
        tools: [{ name: "web_search", description: "Search" }],
      });
      const body = fetch.calls[0]?.body;
      expect(body?.model).toBe("gpt-5.6-luna");
      expect(body?.reasoning_effort).toBe("none");
      expect((body?.reasoning as { effort?: string } | undefined)?.effort).toBe("none");
      expect(body?.max_completion_tokens).toBe(280);
      expect(body?.max_tokens).toBeUndefined();
      expect(body?.temperature).toBe(0.4);
      expect(Array.isArray(body?.tools)).toBe(true);
    } finally {
      fetch.restore();
    }
  });

  it("streams tokens and tool calls without waiting for a non-stream complete", async () => {
    const sse = [
      "data: {\"id\":\"cmpl_s\",\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"web_search\",\"arguments\":\"{\\\"query\\\":\\\"x\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
      "data: [DONE]\n\n",
    ].join("");
    const fetch = captureFetch(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );

    try {
      const adapter = new OpenAiCompatibleAdapter({ apiKey: "test-key" });
      const tokens: string[] = [];
      let doneModel = "";
      for await (const chunk of adapter.streamComplete({
        model: { providerId: "experiential", model: "gpt-5.6-luna" },
        messages: [{ role: "user", content: "Hi" }],
        tools: [{ name: "web_search", description: "Search" }],
      })) {
        if (chunk.type === "token") tokens.push(chunk.text);
        else doneModel = chunk.completion.model.model;
      }
      expect(tokens.join("")).toBe("Hello");
      expect(doneModel).toBe("gpt-5.6-luna");
      expect(fetch.calls[0]?.body.stream).toBe(true);
      expect(fetch.calls[0]?.body.reasoning_effort).toBe("none");
    } finally {
      fetch.restore();
    }
  });

  it("surfaces provider errors", async () => {
    const fetch = captureFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );

    try {
      const adapter = new OpenAiCompatibleAdapter({ apiKey: "bad" });
      await expect(
        adapter.complete({
          model: { providerId: "openai", model: "gpt-4o-mini" },
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toBeInstanceOf(AiGatewayError);
    } finally {
      fetch.restore();
    }
  });
});
