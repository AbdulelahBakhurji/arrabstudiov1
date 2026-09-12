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
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_DEFAULT_REGION,
  BEDROCK_PROVIDER_ID,
  bedrockOpenAiBaseUrl,
  bedrockRuntimeBaseUrl,
  isBedrockOpenAiModel,
  normalizeBedrockModelId,
} from "./bedrock.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

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
    const response = await fetch(`${this.baseUrl}/model/${modelId}/converse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(this.buildBody(normalized)),
    });

    const payload = (await response.json()) as BedrockConverseResponse;
    if (!response.ok) {
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.message ??
          payload.Message ??
          `Bedrock request failed with ${response.status}`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }
    return extractCompletion(payload, normalized);
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    try {
      return await this.completeOnce(request);
    } catch (error) {
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
    // Prefer a real completion (with Nova fallback) then emit tokens quickly.
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
}
