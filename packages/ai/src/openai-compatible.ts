import {
  AiGatewayError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiMessage,
  type AiStreamChunk,
  type AiTokenUsage,
  type AiToolCall,
  type ModelProviderAdapter,
} from "./types.js";

export interface OpenAiCompatibleConfig {
  id?: string;
  apiKey: string;
  baseUrl?: string;
}

type OpenAiChatResponse = {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

function mapFinishReason(
  value: string | null | undefined,
): AiCompletion["finishReason"] {
  if (
    value === "stop" ||
    value === "length" ||
    value === "content_filter" ||
    value === "tool_calls"
  ) {
    return value;
  }
  return "unknown";
}

function mapToolCalls(
  raw:
    | Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>
    | undefined,
): AiToolCall[] | undefined {
  if (!raw || raw.length === 0) {
    return undefined;
  }
  return raw
    .map((item, index) => ({
      id: item.id ?? `call_${index}`,
      name: item.function?.name ?? "",
      arguments: item.function?.arguments ?? "{}",
    }))
    .filter((item) => item.name.length > 0);
}

function toProviderMessages(messages: readonly AiMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        content: message.content,
        tool_call_id: message.toolCallId ?? "call_unknown",
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

export class OpenAiCompatibleAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly kind = "openai_compatible" as const;
  readonly supportsTools = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: OpenAiCompatibleConfig) {
    this.id = config.id ?? "openai";
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const body: Record<string, unknown> = {
      model: request.model.model,
      messages: toProviderMessages(request.messages),
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? {
            type: "object",
            properties: {},
          },
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as OpenAiChatResponse;
    if (!response.ok) {
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.error?.message ?? `Provider request failed with ${response.status}`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }

    const choice = payload.choices?.[0];
    const toolCalls = mapToolCalls(choice?.message?.tool_calls);
    const content = choice?.message?.content?.trim() ?? "";
    if (!content && !toolCalls?.length) {
      throw new AiGatewayError("PROVIDER_ERROR", "Provider returned an empty completion", 502);
    }

    return {
      id: payload.id ?? `cmpl_${Date.now()}`,
      model: request.model,
      message: {
        role: "assistant",
        content,
        toolCalls,
      },
      finishReason: mapFinishReason(choice?.finish_reason),
      usage:
        payload.usage?.prompt_tokens !== undefined &&
        payload.usage.completion_tokens !== undefined
          ? {
              inputTokens: payload.usage.prompt_tokens,
              outputTokens: payload.usage.completion_tokens,
            }
          : null,
      toolCalls,
    };
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    // Tool-enabled rounds use non-streaming complete for reliable tool_calls parsing.
    if (request.tools && request.tools.length > 0) {
      const completion = await this.complete(request);
      if (completion.message.content && !completion.toolCalls?.length) {
        yield { type: "token", text: completion.message.content };
      }
      yield { type: "done", completion };
      return;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model.model,
        messages: toProviderMessages(request.messages),
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.error?.message ?? `Provider stream failed with ${response.status}`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage: AiTokenUsage | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            yield { type: "token", text: delta };
          }
          if (
            json.usage?.prompt_tokens !== undefined &&
            json.usage.completion_tokens !== undefined
          ) {
            usage = {
              inputTokens: json.usage.prompt_tokens,
              outputTokens: json.usage.completion_tokens,
            };
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    yield {
      type: "done",
      completion: {
        id: `cmpl_${Date.now()}`,
        model: request.model,
        message: { role: "assistant", content: full.trim() },
        finishReason: "stop",
        usage,
      },
    };
  }
}
