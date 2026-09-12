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
      content?: unknown;
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

type OpenAiStreamDelta = {
  content?: unknown;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

function isGpt5ChatModel(model: string): boolean {
  return /^gpt-5/i.test(model.trim());
}

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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
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

function buildChatBody(
  request: AiCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const model = request.model.model;
  const gpt5 = isGpt5ChatModel(model);
  const body: Record<string, unknown> = {
    model,
    messages: toProviderMessages(request.messages),
  };
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.maxOutputTokens !== undefined) {
    if (gpt5) {
      // GPT-5.x rejects max_tokens; reasoning tokens must not eat the reply budget.
      body.max_completion_tokens = request.maxOutputTokens;
    } else {
      body.max_tokens = request.maxOutputTokens;
    }
  }
  if (gpt5) {
    // Default is medium reasoning — that is the long "Thinking…" stall.
    // Chat Completions also rejects function tools unless effort is none.
    body.reasoning_effort = "none";
    body.reasoning = { effort: "none" };
    // Temperature is only valid with reasoning off; keep it low for snappy replies.
    if (body.temperature === undefined) {
      body.temperature = 0.2;
    }
  }
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
  if (stream) {
    body.stream = true;
  }
  return body;
}

function mapUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): AiTokenUsage | null {
  if (usage?.prompt_tokens === undefined || usage.completion_tokens === undefined) {
    return null;
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatBody(request, false)),
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
    const content = extractTextContent(choice?.message?.content).trim();
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
      usage: mapUsage(payload.usage),
      toolCalls,
    };
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatBody(request, true)),
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
    let finishReason: AiCompletion["finishReason"] = "stop";
    let completionId = `cmpl_${Date.now()}`;
    const toolAcc: Array<{ id: string; name: string; arguments: string }> = [];

    const applyToolDelta = (delta: OpenAiStreamDelta["tool_calls"]) => {
      if (!delta) return;
      for (const item of delta) {
        const index = item.index ?? 0;
        const current = toolAcc[index] ?? { id: `call_${index}`, name: "", arguments: "" };
        if (item.id) current.id = item.id;
        if (item.function?.name) current.name += item.function.name;
        if (item.function?.arguments) current.arguments += item.function.arguments;
        toolAcc[index] = current;
      }
    };

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
            id?: string;
            choices?: Array<{
              delta?: OpenAiStreamDelta;
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (json.id) {
            completionId = json.id;
          }
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          const text = extractTextContent(delta?.content);
          if (text) {
            full += text;
            yield { type: "token", text };
          }
          applyToolDelta(delta?.tool_calls);
          if (choice?.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
          const nextUsage = mapUsage(json.usage);
          if (nextUsage) {
            usage = nextUsage;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    const toolCalls = mapToolCalls(
      toolAcc.map((item) => ({
        id: item.id,
        function: { name: item.name, arguments: item.arguments || "{}" },
      })),
    );
    const content = full.trim();
    if (!content && !toolCalls?.length) {
      throw new AiGatewayError("PROVIDER_ERROR", "Provider returned an empty completion", 502);
    }

    yield {
      type: "done",
      completion: {
        id: completionId,
        model: request.model,
        message: { role: "assistant", content, toolCalls },
        finishReason: toolCalls?.length ? "tool_calls" : finishReason,
        usage,
        toolCalls,
      },
    };
  }
}
