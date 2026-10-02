import {
  AiGatewayError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiMessage,
  type AiStreamChunk,
  type AiToolCall,
  type ModelProviderAdapter,
} from "./types.js";
import {
  BEDROCK_DEFAULT_REGION,
  BEDROCK_PROVIDER_ID,
  bedrockOpenAiBaseUrl,
  bedrockRuntimeBaseUrl,
  isBedrockOpenAiModel,
  normalizeBedrockModelId,
} from "./bedrock.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import {
  STREAM_CONNECT_TIMEOUT_MS,
  clientStatusForProvider,
  providerFetch,
  readProviderJson,
  readStreamChunk,
} from "./provider-http.js";

/** Cancellation must end the request — never fall through to a "backup" model call. */
function isCancellation(error: unknown): boolean {
  return error instanceof AiGatewayError && error.code === "CANCELLED";
}

export interface BedrockConverseConfig {
  id?: string;
  apiKey: string;
  region?: string;
}

type BedrockContentBlock =
  | { text?: string; toolUse?: undefined; toolResult?: undefined }
  | {
      toolUse?: { toolUseId?: string; name?: string; input?: unknown };
      text?: undefined;
      toolResult?: undefined;
    }
  | {
      toolResult?: {
        toolUseId?: string;
        content?: Array<{ text?: string }>;
        status?: string;
      };
      text?: undefined;
      toolUse?: undefined;
    };

type BedrockConverseResponse = {
  output?: {
    message?: {
      role?: string;
      content?: BedrockContentBlock[];
    };
  };
  stopReason?: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
  message?: string;
  Message?: string;
};

function mapFinishReason(value: string | null | undefined): AiCompletion["finishReason"] {
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  if (value === "max_tokens") return "length";
  if (value === "tool_use") return "tool_calls";
  if (value === "content_filtered") return "content_filter";
  return "unknown";
}

function toBedrockMessages(messages: readonly AiMessage[]): {
  system?: Array<{ text: string }>;
  messages: Array<{ role: "user" | "assistant"; content: BedrockContentBlock[] }>;
} {
  const system: Array<{ text: string }> = [];
  const out: Array<{ role: "user" | "assistant"; content: BedrockContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) system.push({ text: message.content });
      continue;
    }
    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: message.toolCallId ?? "tool_unknown",
              content: [{ text: message.content }],
              status: "success",
            },
          },
        ],
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: BedrockContentBlock[] = [];
      if (message.content.trim()) content.push({ text: message.content });
      for (const call of message.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments || "{}");
        } catch {
          input = { raw: call.arguments };
        }
        content.push({
          toolUse: {
            toolUseId: call.id,
            name: call.name,
            input,
          },
        });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [{ text: message.content }],
    });
  }

  if (out.length === 0) {
    throw new AiGatewayError("PROVIDER_ERROR", "Bedrock requires at least one user message", 400);
  }

  // Bedrock requires alternating roles; merge consecutive same-role blocks.
  const merged: typeof out = [];
  for (const item of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.content.push(...item.content);
    } else {
      merged.push({ role: item.role, content: [...item.content] });
    }
  }

  return {
    system: system.length > 0 ? system : undefined,
    messages: merged,
  };
}

function extractCompletion(payload: BedrockConverseResponse, request: AiCompletionRequest): AiCompletion {
  const blocks = payload.output?.message?.content ?? [];
  const text = blocks
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
  const toolCalls: AiToolCall[] = [];
  for (const block of blocks) {
    if (!block.toolUse?.name) continue;
    toolCalls.push({
      id: block.toolUse.toolUseId ?? `call_${toolCalls.length}`,
      name: block.toolUse.name,
      arguments: JSON.stringify(block.toolUse.input ?? {}),
    });
  }
  if (!text && toolCalls.length === 0) {
    throw new AiGatewayError("PROVIDER_ERROR", "Bedrock returned an empty completion", 502);
  }
  return {
    id: `bedrock_${Date.now()}`,
    model: request.model,
    message: {
      role: "assistant",
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    finishReason: mapFinishReason(payload.stopReason),
    usage:
      payload.usage?.inputTokens !== undefined && payload.usage.outputTokens !== undefined
        ? {
            inputTokens: payload.usage.inputTokens,
            outputTokens: payload.usage.outputTokens,
          }
        : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

type EventStreamMessage = { headers: Record<string, string>; payload: Uint8Array };

/**
 * Decode `application/vnd.amazon.eventstream` frames:
 * [total len u32][headers len u32][prelude crc u32][headers][payload][msg crc u32].
 * Only string headers are kept; other header types are skipped.
 */
function decodeEventStreamFrames(buffer: Uint8Array): {
  messages: EventStreamMessage[];
  rest: Uint8Array;
} {
  const messages: EventStreamMessage[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  while (buffer.length - offset >= 12) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const total = view.getUint32(0);
    const headersLength = view.getUint32(4);
    if (total < 16 || buffer.length - offset < total) break;
    const headers: Record<string, string> = {};
    let cursor = offset + 12;
    const headersEnd = cursor + headersLength;
    while (cursor < headersEnd) {
      const nameLength = buffer[cursor]!;
      const name = decoder.decode(buffer.subarray(cursor + 1, cursor + 1 + nameLength));
      cursor += 1 + nameLength;
      const type = buffer[cursor]!;
      cursor += 1;
      const at = new DataView(buffer.buffer, buffer.byteOffset + cursor);
      if (type === 7 || type === 6) {
        const length = at.getUint16(0);
        if (type === 7) headers[name] = decoder.decode(buffer.subarray(cursor + 2, cursor + 2 + length));
        cursor += 2 + length;
      } else {
        const fixed: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 };
        cursor += fixed[type] ?? 0;
      }
    }
    messages.push({ headers, payload: buffer.subarray(headersEnd, offset + total - 4) });
    offset += total;
  }
  return { messages, rest: buffer.subarray(offset) };
}

type ConverseStreamEvent = {
  contentBlockIndex?: number;
  start?: { toolUse?: { toolUseId?: string; name?: string } };
  delta?: {
    text?: string;
    toolUse?: { input?: string };
    reasoningContent?: { text?: string };
  };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  message?: string;
  Message?: string;
};

export class BedrockConverseAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly kind = "openai_compatible" as const;
  readonly supportsTools = true;
  private readonly apiKey: string;
  private readonly region: string;
  private readonly baseUrl: string;
  private readonly openAiCompat: OpenAiCompatibleAdapter;

  constructor(config: BedrockConverseConfig) {
    this.id = config.id ?? BEDROCK_PROVIDER_ID;
    this.apiKey = config.apiKey;
    this.region = (config.region ?? BEDROCK_DEFAULT_REGION).trim() || BEDROCK_DEFAULT_REGION;
    this.baseUrl = bedrockRuntimeBaseUrl(this.region);
    this.openAiCompat = new OpenAiCompatibleAdapter({
      id: `${this.id}-openai`,
      apiKey: this.apiKey,
      baseUrl: bedrockOpenAiBaseUrl(this.region),
    });
  }

  private buildBody(request: AiCompletionRequest): Record<string, unknown> {
    const { system, messages } = toBedrockMessages(request.messages);
    const body: Record<string, unknown> = {
      messages,
      inferenceConfig: {
        maxTokens: request.maxOutputTokens ?? 800,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
    };
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) {
      body.toolConfig = {
        tools: request.tools.map((tool) => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: {
              json: tool.parameters ?? { type: "object", properties: {} },
            },
          },
        })),
      };
    }
    return body;
  }

  private withNormalizedModel(request: AiCompletionRequest): AiCompletionRequest {
    const model = normalizeBedrockModelId(request.model.model, this.region);
    if (model === request.model.model) return request;
    return { ...request, model: { ...request.model, model } };
  }

  private isInvalidModelError(message: string): boolean {
    return /model identifier is invalid|ValidationException|does not exist|not found|access denied|not authorized|operation not allowed|is not authorized|don't have access|do not have access/i.test(
      message,
    );
  }

  private async completeOnce(request: AiCompletionRequest): Promise<AiCompletion> {
    const normalized = this.withNormalizedModel(request);
    if (isBedrockOpenAiModel(normalized.model.model)) {
      return this.openAiCompat.complete(normalized);
    }
    const modelId = encodeURIComponent(normalized.model.model);
    const response = await providerFetch(
      `${this.baseUrl}/model/${modelId}/converse`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(this.buildBody(normalized)),
      },
      { signal: request.signal },
    );

    const payload = await readProviderJson<BedrockConverseResponse>(response);
    if (!response.ok) {
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.message ??
          payload.Message ??
          `Bedrock request failed with ${response.status}`,
        clientStatusForProvider(response.status),
      );
    }
    return extractCompletion(payload, normalized);
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    try {
      return await this.completeOnce(request);
    } catch (error) {
      if (isCancellation(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const fallback = normalizeBedrockModelId("amazon.nova-lite-v1:0", this.region);
      const current = normalizeBedrockModelId(request.model.model, this.region);
      if (
        this.isInvalidModelError(message) &&
        current !== fallback &&
        !isBedrockOpenAiModel(current)
      ) {
        return this.completeOnce({
          ...request,
          model: { ...request.model, model: fallback },
        });
      }
      // Gemma / openai short ids may fail on Converse path aliases — try Nova.
      if (this.isInvalidModelError(message) && current !== fallback) {
        return this.completeOnce({
          ...request,
          model: { ...request.model, model: fallback },
        });
      }
      throw error;
    }
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    const normalized = this.withNormalizedModel(request);
    if (isBedrockOpenAiModel(normalized.model.model)) {
      try {
        yield* this.openAiCompat.streamComplete!(normalized);
        return;
      } catch (error) {
        if (isCancellation(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const fallback = normalizeBedrockModelId("amazon.nova-lite-v1:0", this.region);
        if (!this.isInvalidModelError(message) || normalized.model.model === fallback) {
          throw error;
        }
        // Fall through to Converse Nova for a working reply.
        const completion = await this.completeOnce({
          ...normalized,
          model: { ...normalized.model, model: fallback },
        });
        if (completion.message.content && !completion.toolCalls?.length) {
          const text = completion.message.content;
          const step = Math.max(12, Math.ceil(text.length / 24));
          for (let i = 0; i < text.length; i += step) {
            yield { type: "token", text: text.slice(i, i + step) };
          }
        }
        yield { type: "done", completion };
        return;
      }
    }
    let emitted = false;
    try {
      for await (const chunk of this.converseStream(normalized)) {
        if (chunk.type !== "done") emitted = true;
        yield chunk;
      }
      return;
    } catch (error) {
      // Once text reached the user a silent retry would duplicate it; a cancelled request
      // must stay cancelled instead of re-running as a full (billed) completion.
      if (emitted || isCancellation(error)) throw error;
    }
    // Stream unavailable (model/region) — full completion with Nova fallback.
    const completion = await this.complete(normalized);
    if (completion.message.content && !completion.toolCalls?.length) {
      const text = completion.message.content;
      const step = Math.max(12, Math.ceil(text.length / 24));
      for (let i = 0; i < text.length; i += step) {
        yield { type: "token", text: text.slice(i, i + step) };
      }
    }
    yield { type: "done", completion };
  }

  private async *converseStream(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    const modelId = encodeURIComponent(request.model.model);
    const body = this.buildBody(request);
    if (request.reasoning && /anthropic\.claude/i.test(request.model.model)) {
      const budget = { low: 1024, medium: 4096, high: 8192 }[request.reasoning];
      body.additionalModelRequestFields = { thinking: { type: "enabled", budget_tokens: budget } };
      const config = body.inferenceConfig as { maxTokens: number; temperature?: number };
      config.maxTokens = Math.max(config.maxTokens, budget + 1024);
      delete config.temperature;
    }
    const response = await providerFetch(
      `${this.baseUrl}/model/${modelId}/converse-stream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.amazon.eventstream",
        },
        body: JSON.stringify(body),
      },
      { signal: request.signal, timeoutMs: STREAM_CONNECT_TIMEOUT_MS },
    );
    if (!response.ok || !response.body) {
      const payload = await readProviderJson<BedrockConverseResponse>(response);
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.message ?? payload.Message ?? `Bedrock stream failed with ${response.status}`,
        clientStatusForProvider(response.status),
      );
    }

    const reader = response.body.getReader();
    const json = new TextDecoder();
    let pending: Uint8Array = new Uint8Array(0);
    let full = "";
    let stopReason: string | null = null;
    let usage: AiCompletion["usage"] = null;
    const tools = new Map<number, { id: string; name: string; input: string }>();

    while (true) {
      const { done, value } = await readStreamChunk(reader, { signal: request.signal });
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      const { messages, rest } = decodeEventStreamFrames(merged);
      pending = rest.slice();
      for (const message of messages) {
        let event: ConverseStreamEvent = {};
        try {
          event = JSON.parse(json.decode(message.payload)) as ConverseStreamEvent;
        } catch {
          continue;
        }
        if (message.headers[":message-type"] === "exception") {
          throw new AiGatewayError(
            "PROVIDER_ERROR",
            event.message ?? event.Message ?? message.headers[":exception-type"] ?? "Bedrock stream error",
            502,
          );
        }
        const kind = message.headers[":event-type"];
        const index = event.contentBlockIndex ?? 0;
        if (kind === "contentBlockStart" && event.start?.toolUse) {
          tools.set(index, {
            id: event.start.toolUse.toolUseId ?? `call_${index}`,
            name: event.start.toolUse.name ?? "",
            input: "",
          });
        } else if (kind === "contentBlockDelta" && event.delta) {
          if (event.delta.text) {
            full += event.delta.text;
            yield { type: "token", text: event.delta.text };
          }
          if (event.delta.reasoningContent?.text) {
            yield { type: "thinking", text: event.delta.reasoningContent.text };
          }
          if (event.delta.toolUse?.input) {
            const tool = tools.get(index);
            if (tool) tool.input += event.delta.toolUse.input;
          }
        } else if (kind === "messageStop") {
          stopReason = event.stopReason ?? null;
        } else if (kind === "metadata" && event.usage) {
          if (event.usage.inputTokens !== undefined && event.usage.outputTokens !== undefined) {
            usage = { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens };
          }
        }
      }
    }

    const toolCalls: AiToolCall[] = [...tools.values()]
      .filter((tool) => tool.name)
      .map((tool) => ({ id: tool.id, name: tool.name, arguments: tool.input || "{}" }));
    const content = full.trim();
    if (!content && toolCalls.length === 0) {
      throw new AiGatewayError("PROVIDER_ERROR", "Bedrock returned an empty completion", 502);
    }
    yield {
      type: "done",
      completion: {
        id: `bedrock_${Date.now()}`,
        model: request.model,
        message: {
          role: "assistant",
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finishReason: toolCalls.length > 0 ? "tool_calls" : mapFinishReason(stopReason),
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    };
  }
}
