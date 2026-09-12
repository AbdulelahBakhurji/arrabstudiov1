import { AppError } from "@arrab/core";
import type { ModelProviderKind } from "@arrab/shared";

export class AiGatewayError extends AppError {
  constructor(code: string, message: string, statusCode = 503) {
    super(code, message, statusCode, true);
    this.name = "AiGatewayError";
  }
}

export interface AiModelRef {
  providerId: string;
  model: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for tool arguments. */
  parameters?: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string from the provider. */
  arguments: string;
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: AiToolCall[];
  /** Present on tool result messages. */
  toolCallId?: string;
}

export interface AiCompletionRequest {
  model: AiModelRef;
  messages: readonly AiMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Native function/tool calling definitions (OpenAI-compatible). */
  tools?: readonly AiToolDefinition[];
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletion {
  id: string;
  model: AiModelRef;
  message: AiMessage;
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | "unknown";
  usage: AiTokenUsage | null;
  toolCalls?: AiToolCall[];
}

export type AiStreamChunk =
  | { type: "token"; text: string }
  | { type: "done"; completion: AiCompletion };

export interface ModelProviderAdapter {
  readonly id: string;
  readonly kind: ModelProviderKind;
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
  streamComplete?(request: AiCompletionRequest): AsyncIterable<AiStreamChunk>;
  /** Whether this adapter can send native tool definitions to the provider. */
  supportsTools?: boolean;
}

export interface AiGateway {
  register(adapter: ModelProviderAdapter): void;
  getProvider(id: string): ModelProviderAdapter | undefined;
  listProviders(): readonly ModelProviderAdapter[];
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
  streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk>;
}
