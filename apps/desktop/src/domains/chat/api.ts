import { loadChatHistory } from "@/domains/chat/model/chat-history";
import { isE2eeUnlocked, toPriorMessages } from "@/domains/encryption/e2ee";
import type { Agent, AiGatewayStatusResponse, Approval, CollectionResponse, Conversation, ConversationDetailResponse, CreateApprovalRequest, CreateConversationRequest, CreateSkillRequest, CreateKnowledgeRequest, CreateMemoryRequest, Knowledge, Memory, ResolveApprovalRequest, RunTaskResponse, SendMessageRequest, IngestConversationMessagesRequest, IngestConversationMessagesResponse, SendMessageResponse, Skill, Task, UpdateKnowledgeRequest } from "@arrab/shared";
import { readPrefs } from "@/shared/lib/prefs";
import { applySkillsToSendBody, ensureSkillCatalogWarm } from "@/domains/chat/lib/user-skills";
import { ApiRequestError, getApiRoot, request, openTextStream } from "@/core/api/http";
import { arrabApi } from "@/core/api/api";

/**
 * With encryption unlocked, replies run `ephemeral`: the server uses the plaintext only in
 * memory for this turn and stores no message rows. History comes from the local decrypted
 * transcript; the sealed copy syncs through the vault (see saveChatHistory).
 */
async function withE2ee(id: string, body: SendMessageRequest): Promise<SendMessageRequest> {
  if (body.ephemeral || !isE2eeUnlocked()) return body;
  let prior = (await loadChatHistory(id))?.messages ?? [];
  if (prior.length === 0) {
    // Chat started before encryption was on — seed history from the server once.
    prior = (await arrabApi.conversation(id).catch(() => null))?.messages ?? [];
  }
  return { ...body, ephemeral: true, priorMessages: toPriorMessages(prior) };
}

export const chatApi = {

  aiStatus: () => request<AiGatewayStatusResponse>("/v1/ai/status"),
  unfurlUrl: (url: string) =>
    request<{
      url?: string;
      title?: string;
      description?: string;
      image?: string | null;
      siteName?: string;
      error?: string;
    }>("/v1/unfurl", { method: "POST", body: { url }, timeoutMs: 15_000 }),
  conversations: () => request<CollectionResponse<Conversation>>("/v1/conversations"),
  agentConversations: (agentId: string) =>
    request<CollectionResponse<Conversation>>(`/v1/agents/${agentId}/conversations`),
  createConversation: (body: CreateConversationRequest, signal?: AbortSignal) =>
    request<Conversation>("/v1/conversations", { method: "POST", body, signal }),
  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/v1/conversations/${id}`, { method: "DELETE" }),
  conversation: (id: string) => request<ConversationDetailResponse>(`/v1/conversations/${id}`),
  sendMessage: async (id: string, body: SendMessageRequest, signal?: AbortSignal) =>
    request<SendMessageResponse>(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body: await withE2ee(id, body),
      timeoutMs: 90_000,
      signal,
    }),
  ingestConversationMessages: (
    id: string,
    body: IngestConversationMessagesRequest,
    signal?: AbortSignal,
  ) =>
    request<IngestConversationMessagesResponse>(`/v1/conversations/${id}/messages/ingest`, {
      method: "POST",
      body,
      timeoutMs: 30_000,
      signal,
    }),
  sendMessageStream: async (
    id: string,
    body: SendMessageRequest,
    handlers: {
      onToken?: (text: string) => void;
      /** Model reasoning, streamed before/alongside the answer. */
      onThinking?: (text: string) => void;
      onToolStart?: (name: string, detail?: string) => void;
      onTool?: (name: string, result: string) => void;
      onApproval?: (approval: Approval) => void;
      onDone?: (response: SendMessageResponse) => void;
      onError?: (message: string) => void;
    } = {},
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    // A cold skill catalog must not hold the first reply hostage.
    await Promise.race([
      ensureSkillCatalogWarm().catch(() => []),
      new Promise((resolve) => window.setTimeout(resolve, 800)),
    ]);
    body = applySkillsToSendBody(body);
    body = await withE2ee(id, body);
    if (body.thinking === undefined && readPrefs().aiExtendedThinking) {
      body = { ...body, thinking: "medium" };
    }

    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const kill = setTimeout(() => controller.abort(), 180_000);
    let sawMutatingTool = false;
    const MUTATING_STREAM_TOOLS = new Set([
      "send_email",
      "arrange_email",
      "write_file",
      "apply_patch",
      "delete_file",
      "rename_file",
      "create_dir",
      "run_terminal",
    ]);
    try {
      const stream = openTextStream(
        `${getApiRoot()}/v1/conversations/${id}/messages/stream`,
        body,
        controller.signal,
        180_000,
      );
      let buffer = "";
      let eventName = "message";
      let sawDone = false;
      for await (const text of stream) {
        signal?.throwIfAborted();
        buffer += text;
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          signal?.throwIfAborted();
          const lines = chunk.split("\n");
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data += line.slice(5).trim();
            }
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as SendMessageResponse & {
              text?: string;
              message?: string;
              name?: string;
              result?: string;
              detail?: string;
              approval?: Approval;
            };
            if (eventName === "ready") {
              // keepalive / proxy flush
            } else if (eventName === "token" && parsed.text) {
              handlers.onToken?.(parsed.text);
            } else if (eventName === "thinking" && parsed.text) {
              handlers.onThinking?.(parsed.text);
            } else if (eventName === "tool_start" && parsed.name) {
              if (MUTATING_STREAM_TOOLS.has(parsed.name)) sawMutatingTool = true;
              handlers.onToolStart?.(parsed.name, parsed.detail);
            } else if (eventName === "tool" && parsed.name) {
              if (MUTATING_STREAM_TOOLS.has(parsed.name)) sawMutatingTool = true;
              handlers.onTool?.(parsed.name, parsed.result ?? "");
            } else if (eventName === "approval" && parsed.approval) {
              handlers.onApproval?.(parsed.approval);
            } else if (eventName === "done") {
              sawDone = true;
              const done = parsed as SendMessageResponse;
              const hasReply = Boolean(done.assistantMessage?.content?.trim());
              if (!hasReply && !done.approval && done.providerConfigured === false) {
                handlers.onError?.(
                  "No model provider is configured on the Arrab API.",
                );
              } else if (!hasReply && !done.approval) {
                handlers.onError?.("Employee did not return a reply");
              } else {
                handlers.onDone?.(done);
              }
            } else if (eventName === "error") {
              handlers.onError?.(parsed.message ?? "Stream error");
            }
          } catch {
            // ignore
          }
          eventName = "message";
        }
      }
      if (!sawDone) {
        // Never replay a turn that already mutated mail/files (duplicate emails).
        if (sawMutatingTool) {
          const message =
            "Connection dropped after a tool already ran. Not retrying automatically — check results before sending again.";
          handlers.onError?.(message);
          throw new ApiRequestError(message, 0);
        }
        signal?.throwIfAborted();
        const fallback = await arrabApi.sendMessage(id, body, signal);
        signal?.throwIfAborted();
        if (fallback.assistantMessage?.content) {
          handlers.onToken?.(fallback.assistantMessage.content);
        }
        if (fallback.approval) {
          handlers.onApproval?.(fallback.approval);
        }
        handlers.onDone?.(fallback);
      }
    } catch (err: unknown) {
      signal?.throwIfAborted();
      if (err instanceof ApiRequestError) throw err;
      if (sawMutatingTool) {
        const message =
          "Connection dropped after a tool already ran. Not retrying automatically — check results before sending again.";
        handlers.onError?.(message);
        throw new ApiRequestError(message, 0);
      }
      // Retry a network/timeout failure; never restart a caller-cancelled request.
      try {
        const fallback = await arrabApi.sendMessage(id, body, signal);
        signal?.throwIfAborted();
        if (fallback.assistantMessage?.content) {
          handlers.onToken?.(fallback.assistantMessage.content);
        }
        if (fallback.approval) {
          handlers.onApproval?.(fallback.approval);
        }
        handlers.onDone?.(fallback);
      } catch (fallbackErr: unknown) {
        signal?.throwIfAborted();
        const message =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : err instanceof Error
              ? err.message
              : "Stream failed";
        handlers.onError?.(message);
        throw fallbackErr instanceof ApiRequestError
          ? fallbackErr
          : new ApiRequestError(message, 0);
      }
    } finally {
      clearTimeout(kill);
      signal?.removeEventListener("abort", abort);
    }
  },
  knowledge: () => request<CollectionResponse<Knowledge>>("/v1/knowledge"),
  createKnowledge: (body: CreateKnowledgeRequest) =>
    request<Knowledge>("/v1/knowledge", { method: "POST", body }),
  updateKnowledge: (id: string, body: UpdateKnowledgeRequest) =>
    request<Knowledge>(`/v1/knowledge/${id}`, { method: "PATCH", body }),
  deleteKnowledge: (id: string) =>
    request<{ ok: true }>(`/v1/knowledge/${id}`, { method: "DELETE" }),
  memories: () => request<CollectionResponse<Memory>>("/v1/memories"),
  createMemory: (body: CreateMemoryRequest) =>
    request<Memory>("/v1/memories", { method: "POST", body }),
  deleteMemory: (id: string) => request<{ ok: true }>(`/v1/memories/${id}`, { method: "DELETE" }),
  skills: (agentId?: string) =>
    request<CollectionResponse<Skill>>(
      agentId ? `/v1/skills?agentId=${encodeURIComponent(agentId)}` : "/v1/skills",
    ),
  createSkill: (body: CreateSkillRequest) =>
    request<{ skill: Skill; task: Task | null }>("/v1/skills", { method: "POST", body }),
  deleteSkill: (id: string) => request<{ ok: true }>(`/v1/skills/${id}`, { method: "DELETE" }),
  approvals: () => request<CollectionResponse<Approval>>("/v1/approvals"),
  pendingApprovals: () => request<CollectionResponse<Approval>>("/v1/approvals/pending"),
  createApproval: (body: CreateApprovalRequest) =>
    request<Approval>("/v1/approvals", { method: "POST", body }),
  resolveApproval: (id: string, body: ResolveApprovalRequest) =>
    request<{
      approval: Approval;
      agent?: Agent;
      run?: RunTaskResponse;
      continued?: SendMessageResponse;
    }>(`/v1/approvals/${id}/resolve`, {
      method: "POST",
      body,
      timeoutMs: 90_000,
    }),
};
