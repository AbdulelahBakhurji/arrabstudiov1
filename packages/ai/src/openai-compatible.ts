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

type ResponsesPayload = {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    role?: string;
    call_id?: string;
    id?: string;
    name?: string;
    arguments?: string;
    content?: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
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
      body.max_completion_tokens = request.maxOutputTokens;
      // Experiential keys off max_tokens for reasoning headroom.
      body.max_tokens = request.maxOutputTokens;
    } else {
      body.max_tokens = request.maxOutputTokens;
    }
  }
  if (gpt5) {
    body.reasoning_effort = "none";
    body.reasoning = { effort: "none" };
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

function buildResponsesBody(
  request: AiCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? "call_unknown",
        output: message.content,
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      if (message.content.trim()) {
        input.push({ role: "assistant", content: message.content });
      }
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }

  const body: Record<string, unknown> = {
    model: request.model.model,
    input,
    reasoning: { effort: "none" },
    store: false,
  };
  if (instructions) body.instructions = instructions;
  if (request.maxOutputTokens !== undefined) {
    body.max_output_tokens = request.maxOutputTokens;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
      strict: false,
    }));
  }
  if (stream) body.stream = true;
  return body;
}

function mapUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined,
): AiTokenUsage | null {
  const input = usage?.input_tokens ?? usage?.prompt_tokens;
  const output = usage?.output_tokens ?? usage?.completion_tokens;
  if (input === undefined || output === undefined) {
    return null;
  }
  return { inputTokens: input, outputTokens: output };
}

function completionFromResponses(
  payload: ResponsesPayload,
  request: AiCompletionRequest,
): AiCompletion {
  const toolCalls: AiToolCall[] = [];
  let text = typeof payload.output_text === "string" ? payload.output_text : "";
  for (const item of payload.output ?? []) {
    if (item.type === "function_call" && item.name) {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length}`,
        name: item.name,
        arguments: item.arguments ?? "{}",
      });
    }
    if (item.type === "message" || item.role === "assistant") {
      const piece = extractTextContent(item.content);
      if (piece && !text.includes(piece)) {
        text += piece;
      }
    }
  }
  const mapped = toolCalls.length > 0 ? toolCalls : undefined;
  const content = text.trim();
  if (!content && !mapped?.length) {
    throw new AiGatewayError("PROVIDER_ERROR", "Provider returned an empty completion", 502);
  }
  return {
    id: payload.id ?? `cmpl_${Date.now()}`,
    model: request.model,
    message: { role: "assistant", content, toolCalls: mapped },
    finishReason: mapped?.length ? "tool_calls" : "stop",
    usage: mapUsage(payload.usage),
    toolCalls: mapped,
  };
}

function completionFromChat(
  payload: OpenAiChatResponse,
  request: AiCompletionRequest,
): AiCompletion {
  const choice = payload.choices?.[0];
  const toolCalls = mapToolCalls(choice?.message?.tool_calls);
  const content = extractTextContent(choice?.message?.content).trim();
  if (!content && !toolCalls?.length) {
    throw new AiGatewayError("PROVIDER_ERROR", "Provider returned an empty completion", 502);
  }
  return {
    id: payload.id ?? `cmpl_${Date.now()}`,
    model: request.model,
    message: { role: "assistant", content, toolCalls },
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: mapUsage(payload.usage),
    toolCalls,
  };
}

function providerError(payload: { error?: { message?: string } }, status: number): never {
  throw new AiGatewayError(
    "PROVIDER_ERROR",
    payload.error?.message ?? `Provider request failed with ${status}`,
    status >= 400 && status < 500 ? status : 502,
  );
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

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const gpt5 = isGpt5ChatModel(request.model.model);
    if (gpt5) {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(buildResponsesBody(request, false)),
      });
      const payload = (await response.json()) as ResponsesPayload & OpenAiChatResponse;
      if (response.ok) {
        if (payload.output || payload.output_text) {
          return completionFromResponses(payload, request);
        }
        if (payload.choices) {
          return completionFromChat(payload, request);
        }
      }
      if (response.status !== 404 && response.status !== 405) {
        providerError(payload, response.status);
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(buildChatBody(request, false)),
    });
    const payload = (await response.json()) as OpenAiChatResponse;
    if (!response.ok) {
      providerError(payload, response.status);
    }
    return completionFromChat(payload, request);
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    const gpt5 = isGpt5ChatModel(request.model.model);
    const url = gpt5 ? `${this.baseUrl}/responses` : `${this.baseUrl}/chat/completions`;
    const body = gpt5 ? buildResponsesBody(request, true) : buildChatBody(request, true);
    let response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if ((!response.ok || !response.body) && gpt5 && (response.status === 404 || response.status === 405)) {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(buildChatBody(request, true)),
      });
    }

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
      providerError(payload, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage: AiTokenUsage | null = null;
    let finishReason: AiCompletion["finishReason"] = "stop";
    let completionId = `cmpl_${Date.now()}`;
    const toolAcc: Array<{ id: string; name: string; arguments: string }> = [];

    const applyChatTools = (delta: OpenAiStreamDelta["tool_calls"]) => {
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
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            type?: string;
            delta?: string | OpenAiStreamDelta;
            id?: string;
            response?: ResponsesPayload;
            name?: string;
            call_id?: string;
            arguments?: string;
            item?: { type?: string; call_id?: string; id?: string; name?: string };
            choices?: Array<{
              delta?: OpenAiStreamDelta;
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              input_tokens?: number;
              output_tokens?: number;
            };
          };

          if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
            full += json.delta;
            yield { type: "token", text: json.delta };
            continue;
          }
          if (json.type === "response.output_item.added" && json.item?.type === "function_call") {
            toolAcc.push({
              id: json.item.call_id ?? json.item.id ?? `call_${toolAcc.length}`,
              name: json.item.name ?? "",
              arguments: "",
            });
            continue;
          }
          if (json.type === "response.function_call_arguments.delta" && typeof json.delta === "string") {
            const last = toolAcc[toolAcc.length - 1];
            if (last) last.arguments += json.delta;
            continue;
          }
          if (json.type === "response.completed" && json.response) {
            if (json.response.id) completionId = json.response.id;
            const parsed = completionFromResponses(json.response, request);
            if (!full && parsed.message.content) {
              full = parsed.message.content;
              yield { type: "token", text: parsed.message.content };
            }
            if (parsed.toolCalls?.length && toolAcc.length === 0) {
              for (const call of parsed.toolCalls) toolAcc.push(call);
            }
            if (parsed.usage) usage = parsed.usage;
            continue;
          }

          if (json.id) completionId = json.id;
          const choice = json.choices?.[0];
          const delta = choice?.delta;
          const text = extractTextContent(delta?.content);
          if (text) {
            full += text;
            yield { type: "token", text };
          }
          applyChatTools(delta?.tool_calls);
          if (choice?.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
          const nextUsage = mapUsage(json.usage);
          if (nextUsage) usage = nextUsage;
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
