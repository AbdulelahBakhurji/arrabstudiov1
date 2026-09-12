import {
  AiGatewayError,
  type AiCompletion,
  type AiCompletionRequest,
  type ModelProviderAdapter,
} from "./types.js";

export interface AnthropicMessagesConfig {
  id?: string;
  apiKey: string;
  baseUrl?: string;
}

type AnthropicResponse = {
  id?: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

function mapFinishReason(value: string | null | undefined): AiCompletion["finishReason"] {
  if (value === "end_turn" || value === "stop_sequence") {
    return "stop";
  }
  if (value === "max_tokens") {
    return "length";
  }
  return "unknown";
}

export class AnthropicMessagesAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly kind = "anthropic" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicMessagesConfig) {
    this.id = config.id ?? "anthropic";
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const systemParts: string[] = [];
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const message of request.messages) {
      if (message.role === "system") {
        systemParts.push(message.content);
        continue;
      }
      messages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      });
    }
    if (messages.length === 0) {
      throw new AiGatewayError("PROVIDER_ERROR", "Anthropic requires at least one user message", 400);
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model.model,
        max_tokens: request.maxOutputTokens ?? 1200,
        temperature: request.temperature,
        system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
        messages,
      }),
    });

    const payload = (await response.json()) as AnthropicResponse;
    if (!response.ok) {
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        payload.error?.message ?? `Anthropic request failed with ${response.status}`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }

    const content = payload.content
      ?.filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
    if (!content) {
      throw new AiGatewayError("PROVIDER_ERROR", "Anthropic returned an empty completion", 502);
    }

    return {
      id: payload.id ?? `cmpl_${Date.now()}`,
      model: request.model,
      message: { role: "assistant", content },
      finishReason: mapFinishReason(payload.stop_reason),
      usage:
        payload.usage?.input_tokens !== undefined && payload.usage.output_tokens !== undefined
          ? {
              inputTokens: payload.usage.input_tokens,
              outputTokens: payload.usage.output_tokens,
            }
          : null,
    };
  }
}
