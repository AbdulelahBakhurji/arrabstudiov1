import { ForbiddenError, ServiceUnavailableError } from "@arrab/core";
import {
  type CreateConversationRequest,
  type CreateKnowledgeRequest,
  type CreateMemoryRequest,
  type CreateSkillRequest,
  type CreateApprovalRequest,
  type ResolveApprovalRequest,
  type SendMessageRequest,
  type IngestConversationMessagesRequest,
  type UpdateKnowledgeRequest,
} from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import { generateGeminiFlashPhoto } from "../workspace/image-service.js";
import type { V1Deps } from "../../http/deps.js";
import { buildModelCatalog, buildModelRegistry } from "../../platform/config/model-catalog.js";

export function registerConversationsRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.post<{ Body: { url?: string } }>("/v1/unfurl", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot unfurl links");
    }
    const { unfurlPage } = await import("@arrab/agents");
    return unfurlPage(request.body?.url ?? "");
  });

  app.get("/v1/knowledge", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listKnowledge() };
  });

  app.post<{ Body: CreateKnowledgeRequest }>("/v1/knowledge", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household knowledge");
    }
    return deps.commands.createKnowledge(request.body ?? { title: "", content: "" });
  });

  app.patch<{ Params: { id: string }; Body: UpdateKnowledgeRequest }>(
    "/v1/knowledge/:id",
    async (request) => {
      if (await deps.familyHousehold.isActiveChildSeat()) {
        throw new ForbiddenError("Children cannot manage household knowledge");
      }
      return deps.commands.updateKnowledge(request.params.id, request.body ?? {});
    },
  );

  app.delete<{ Params: { id: string } }>("/v1/knowledge/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household knowledge");
    }
    return deps.commands.deleteKnowledge(request.params.id);
  });


  app.get("/v1/memories", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listMemories() };
  });

  app.post<{ Body: CreateMemoryRequest }>("/v1/memories", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household memories");
    }
    return deps.commands.createMemory(request.body ?? { content: "" });
  });

  app.delete<{ Params: { id: string } }>("/v1/memories/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household memories");
    }
    return deps.commands.deleteMemory(request.params.id);
  });


  app.get<{ Querystring: { agentId?: string } }>("/v1/skills", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listSkills(request.query.agentId) };
  });

  app.post<{ Body: CreateSkillRequest }>("/v1/skills", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household skills");
    }
    return deps.commands.createSkill(
      request.body ?? { agentId: "", title: "", instructions: "" },
    );
  });

  app.delete<{ Params: { id: string } }>("/v1/skills/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household skills");
    }
    return deps.commands.deleteSkill(request.params.id);
  });


  app.get("/v1/approvals", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listApprovals() };
  });

  app.get("/v1/approvals/pending", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return {
      items: await deps.queries.listPendingApprovals(),
    };
  });

  app.post<{ Body: CreateApprovalRequest }>("/v1/approvals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage approvals");
    }
    return deps.commands.createApproval(
      request.body ?? { kind: "activate_agent", title: "" },
    );
  });

  app.post<{ Params: { id: string }; Body: ResolveApprovalRequest }>(
    "/v1/approvals/:id/resolve",
    async (request) => {
      if (await deps.familyHousehold.isActiveChildSeat()) {
        throw new ForbiddenError("Children cannot resolve approvals");
      }
      const resolved = await deps.commands.resolveApproval(
        request.params.id,
        request.body ?? { status: "approved" },
      );
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "run_task" &&
        resolved.approval.taskId
      ) {
        const run = await deps.taskExecution.runTask(resolved.approval.taskId);
        return { ...resolved, run };
      }
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "git_push"
      ) {
        const git = await deps.connectors.resumeApprovalAction(resolved.approval);
        return { ...resolved, ...git };
      }
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "call_tool"
      ) {
        const continued = await deps.conversations.resumeAfterToolApproval(
          resolved.approval,
          {
            toolResult: request.body?.toolResult,
            toolResultAttestation: request.body?.toolResultAttestation,
          },
        );
        return { ...resolved, continued };
      }
      return resolved;
    },
  );


  app.get("/v1/conversations", async (request) => {
    const items = await deps.orgWorkforce.filterConversations(
      await deps.conversations.listConversations(),
      request.orgEmployee,
    );
    return { items: await deps.familyHousehold.filterConversations(items) };
  });

  app.post<{ Body: CreateConversationRequest }>("/v1/conversations", async (request) => {
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.conversations.createConversation(
      request.body ?? { agentId: "" },
      request.orgEmployee?.id ?? null,
    );
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id", async (request) => {
    const detail = await deps.conversations.getConversation(request.params.id);
    await deps.orgWorkforce.assertCanOpenConversation(
      detail.conversation,
      request.orgEmployee,
    );
    await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
    return detail;
  });

  app.delete<{ Params: { id: string } }>("/v1/conversations/:id", async (request) => {
    const detail = await deps.conversations.getConversation(request.params.id);
    await deps.orgWorkforce.assertCanOpenConversation(
      detail.conversation,
      request.orgEmployee,
    );
    await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.conversations.deleteConversation(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages",
    async (request) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      return deps.conversations.sendMessage(request.params.id, request.body ?? { content: "" });
    },
  );

  app.post<{ Params: { id: string }; Body: IngestConversationMessagesRequest }>(
    "/v1/conversations/:id/messages/ingest",
    async (request) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      return deps.conversations.ingestMessages(
        request.params.id,
        request.body ?? { messages: [] },
      );
    },
  );

  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages/stream",
    async (request, reply) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const write = (event: string, data: unknown) => {
        // The peer may already be gone; a write to a closed socket must not crash the handler.
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const flushable = reply.raw as { flush?: () => void };
        flushable.flush?.();
      };
      // Flush immediately so proxies don't wait for the first model token.
      write("ready", { ok: true });
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: ping\n\n`);
        } catch {
          // closed
        }
      }, 15_000);
      // Closing the tab / pressing stop must end the upstream model call, not let it run (and bill) to completion.
      const upstream = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) upstream.abort();
      });
      try {
        const response = await deps.conversations.sendMessage(
          request.params.id,
          request.body ?? { content: "" },
          {
            signal: upstream.signal,
            onToken: (text) => write("token", { text }),
            onThinking: (text) => write("thinking", { text }),
            onToolStart: (name, detail) => write("tool_start", { name, detail }),
            onTool: (name, result) => write("tool", { name, result }),
            onApproval: (approval) => write("approval", { approval }),
          },
        );
        write("done", response);
      } catch (error) {
        write("error", {
          message: error instanceof Error ? error.message : "Stream failed",
        });
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    },
  );


  app.post<{ Body: { prompt?: string } }>("/v1/images", async (request) => {
    await deps.accounts.assertWithinQuota();
    const apiKey = deps.openRouterApiKey?.trim();
    if (!apiKey) throw new ServiceUnavailableError("Photo generation is not configured");
    return generateGeminiFlashPhoto({
      apiKey,
      prompt: request.body?.prompt ?? "",
    });
  });


  app.get("/v1/ai/status", async () => {
    const primary = deps.primaryProviderId ?? "bedrock";
    const defaultModel = deps.defaultModel ?? null;
    const models =
      deps.modelRegistry?.models.map((entry) => entry.id) ??
      buildModelCatalog({
        primaryProviderId: primary,
        defaultModel,
        openRouterModels: deps.openRouterModels,
        bedrockModels: deps.bedrockModels,
      });
    return {
      configured: deps.gateway.listProviders().length > 0,
      providers: deps.gateway.listProviders().map((provider) => provider.id),
      defaultModel,
      models,
      region: deps.bedrockRegion ?? null,
      primaryProvider: primary,
      replyPath:
        primary === "openrouter"
          ? ("openrouter-chat" as const)
          : primary === "openai"
            ? ("openai-chat" as const)
            : primary === "anthropic"
              ? ("anthropic-messages" as const)
              : primary === "xai"
                ? ("xai-chat" as const)
                : ("bedrock-converse" as const),
    };
  });

  app.get("/v1/ai/models", async () => {
    const primary = deps.primaryProviderId ?? "bedrock";
    const defaultModel = deps.defaultModel ?? null;
    const registry =
      deps.modelRegistry ??
      buildModelRegistry({
        primaryProviderId: primary,
        defaultModel,
        openRouterModels: deps.openRouterModels,
        bedrockModels: deps.bedrockModels,
      });
    return {
      defaultModel: registry.defaultModel,
      primaryProvider: registry.primaryProviderId,
      models: registry.models,
    };
  });
}
