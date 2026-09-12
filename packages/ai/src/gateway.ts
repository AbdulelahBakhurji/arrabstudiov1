import {
  AiGatewayError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiGateway,
  type AiStreamChunk,
  type ModelProviderAdapter,
} from "./types.js";

export class RegistryAiGateway implements AiGateway {
  private readonly adapters = new Map<string, ModelProviderAdapter>();

  register(adapter: ModelProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getProvider(id: string): ModelProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  listProviders(): readonly ModelProviderAdapter[] {
    return [...this.adapters.values()];
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const adapter = this.requireAdapter(request.model.providerId);
    return adapter.complete(request);
  }

  async *streamComplete(request: AiCompletionRequest): AsyncIterable<AiStreamChunk> {
    const adapter = this.requireAdapter(request.model.providerId);
    if (adapter.streamComplete) {
      yield* adapter.streamComplete(request);
      return;
    }
    const completion = await adapter.complete(request);
    if (completion.message.content) {
      yield { type: "token", text: completion.message.content };
    }
    yield { type: "done", completion };
  }

  private requireAdapter(providerId: string): ModelProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new AiGatewayError(
        "NO_PROVIDER",
        this.adapters.size === 0
          ? "No model provider is configured"
          : `Unknown model provider '${providerId}'`,
      );
    }
    return adapter;
  }
}
