import {
  AiGatewayError,
  clientStatusForProvider,
  type AiCompletion,
  type AiCompletionRequest,
  type AiStreamChunk,
  type ModelProviderAdapter,
} from "@arrab/ai";

export type FakeBehavior =
  | {
      kind: "reply";
      text?: string;
      usage?: { inputTokens: number; outputTokens: number } | null;
      delayMs?: number;
    }
  | { kind: "error"; status: number; message?: string }
  | { kind: "hang" } // never answers until aborted
  | { kind: "stream-then-break"; text: string };

/**
 * A scriptable model provider. It records every request (model, size, whether a cancel signal was
 * wired) so tests can assert on *what the server asked the provider*, not just on the HTTP reply.
 */
export class FakeProvider implements ModelProviderAdapter {
  readonly kind = "openai_compatible" as const;
  readonly supportsTools = false;
  readonly calls: Array<{ model: string; messages: number; hadSignal: boolean; aborted: boolean }> =
    [];
  behavior: FakeBehavior = { kind: "reply" };

  constructor(readonly id = "bedrock") {}

  private record(request: AiCompletionRequest) {
    const entry = {
      model: request.model.model,
      messages: request.messages.length,
      hadSignal: Boolean(request.signal),
      aborted: false,
    };
    request.signal?.addEventListener("abort", () => {
      entry.aborted = true;
    });
    this.calls.push(entry);
  }

  private completion(
    request: AiCompletionRequest,
    text: string,
    usage: AiCompletion["usage"],
  ): AiCompletion {
    return {
      id: `fake_${this.calls.length}`,
      model: request.model,
      message: { role: "assistant", content: text },
      finishReason: "stop",
      usage,
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    this.record(request);
    const b = this.behavior;
    if (b.kind === "error")
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        b.message ?? "provider failed",
        clientStatusForProvider(b.status),
      );
    if (b.kind === "hang") {
      await new Promise<never>((_, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(new AiGatewayError("CANCELLED", "cancelled", 499)),
        );
      });
    }
    if (b.kind === "reply" && b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    const usage =
      b.kind === "reply" && b.usage === null
        ? null
        : b.kind === "reply" && b.usage
          ? b.usage
          : { inputTokens: 10, outputTokens: 20 };
    return this.completion(request, b.kind === "reply" ? (b.text ?? "ok") : "ok", usage);
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    this.record(request);
    const b = this.behavior;
    if (b.kind === "error")
      throw new AiGatewayError(
        "PROVIDER_ERROR",
        b.message ?? "provider failed",
        clientStatusForProvider(b.status),
      );
    if (b.kind === "stream-then-break") {
      yield { type: "token", text: b.text };
      throw new AiGatewayError("PROVIDER_STALLED", "The model stopped responding mid-stream", 504);
    }
    const completion = await this.complete({ ...request });
    this.calls.pop(); // complete() recorded a second time
    yield { type: "token", text: completion.message.content };
    yield { type: "done", completion };
  }
}
