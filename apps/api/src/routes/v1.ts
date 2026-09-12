import type { AiGateway } from "@arrab/ai";
import { ValidationError } from "@arrab/core";
import type {
  ActivateSubscriptionRequest,
  AddTeamMemberRequest,
  BindProjectRepoRequest,
  ConnectAccountRequest,
  ConnectConnectorRequest,
  CreateAgentRequest,
  CreateConversationRequest,
  CreateGoalRequest,
  CreateKnowledgeRequest,
  CreateMemoryRequest,
  CreateSkillRequest,
  CreateApprovalRequest,
  ResolveApprovalRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  CreateTeamRequest,
  GithubCommitRequest,
  GithubCreatePullRequest,
  PersistenceMode,
  SendEmailRequest,
  SendMessageRequest,
  SignInAccountRequest,
  StartWebAuthRequest,
  CompleteWebAuthRequest,
  UpdateAccountProfileRequest,
  UpdateAgentRequest,
  UpdateGoalRequest,
  UpdateKnowledgeRequest,
  UpdateOperatorRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UpdateTeamRequest,
} from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { ConnectorService } from "../services/connector-service.js";
import type { ConversationService } from "../services/conversation-service.js";
import type { AccountService } from "../services/account-service.js";
import type { GoalService } from "../services/goal-service.js";
import type { TaskExecutionService } from "../services/task-execution-service.js";
import type { WorkspaceCommandService } from "../services/workspace-commands.js";
import type { WorkspaceQueryService } from "../services/workspace-query.js";

export function registerV1Routes(
  app: FastifyInstance,
  deps: {
    queries: WorkspaceQueryService;
    commands: WorkspaceCommandService;
    conversations: ConversationService;
    connectors: ConnectorService;
    accounts: AccountService;
    goals: GoalService;
    taskExecution: TaskExecutionService;
    gateway: AiGateway;
    persistence: PersistenceMode;
    workspaceId: string;
    defaultModel: string | null;
  },
): void {
  app.get("/v1/meta", async () => {
    const status = await deps.accounts.status();
    return {
      name: "arrab-api" as const,
      version: "0.12.0",
      phase: "12",
      persistence: deps.persistence,
      workspaceId: deps.workspaceId,
      aiProviders: deps.gateway.listProviders().map((provider) => provider.id),
      account: {
        connected: status.connected,
        planId: status.entitlements.planId,
        tokenLimit: status.entitlements.tokenLimit,
        tokensUsed: status.entitlements.tokensUsed,
        tokensRemaining: status.entitlements.tokensRemaining,
        overLimit: status.entitlements.overLimit,
      },
    };
  });

  app.get("/v1/dashboard", async () => deps.queries.dashboard());
  app.get("/v1/usage", async () => deps.queries.usageSummary(deps.accounts));
  app.get("/v1/reports/summary", async () => deps.queries.reportSummary());

  app.get("/v1/account", async () => deps.accounts.status());
  app.post<{ Body: ConnectAccountRequest }>("/v1/account/connect", async (request) =>
    deps.accounts.connect(request.body ?? { email: "", password: "" }),
  );
  app.post<{ Body: SignInAccountRequest }>("/v1/account/sign-in", async (request) =>
    deps.accounts.signIn(request.body ?? { email: "", password: "" }),
  );
  app.post("/v1/account/disconnect", async () => deps.accounts.disconnect());
  app.post("/v1/account/logout", async () => deps.accounts.logout());
  app.post<{ Body: ActivateSubscriptionRequest }>("/v1/account/subscribe", async (request) =>
    deps.accounts.activateSubscription(request.body ?? { code: "" }),
  );
  app.patch<{ Body: UpdateAccountProfileRequest }>("/v1/account", async (request) =>
    deps.accounts.updateProfile(request.body ?? {}),
  );

  app.post<{ Body: StartWebAuthRequest }>("/v1/account/auth/web/start", async () =>
    deps.accounts.startWebAuth(),
  );
  app.get<{ Querystring: { state?: string } }>("/v1/account/auth/web/poll", async (request) =>
    deps.accounts.pollWebAuth(request.query.state ?? ""),
  );
  app.post<{ Body: CompleteWebAuthRequest }>("/v1/account/auth/web/complete", async (request) =>
    deps.accounts.completeWebAuth(
      request.body ?? { state: "", email: "" },
    ),
  );
  app.get<{ Querystring: { state?: string } }>("/v1/account/auth/web", async (request, reply) => {
    const state = request.query.state ?? "";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arrab Studio · Sign in</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #050505; color: #f5f5f5; }
    .card { width: min(420px, calc(100vw - 2rem)); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #0a0a0a; padding: 28px; }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 560; letter-spacing: -0.03em; }
    p { color: #a3a3a3; font-size: .9rem; line-height: 1.5; }
    label { display: grid; gap: 6px; margin-top: 14px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #737373; }
    input { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: #000; color: #fff; padding: 12px 14px; font-size: 14px; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 999px; background: #fff; color: #000; font-weight: 600; padding: 12px 16px; cursor: pointer; }
    .ok { color: #bbf7d0; } .err { color: #fecaca; }
  </style>
</head>
<body>
  <form class="card" id="form">
    <h1>Sign in to Arrab Studio</h1>
    <p>Complete sign-in in the browser. The desktop app will detect this and show you as signed in.</p>
    <input type="hidden" name="state" value="${state.replace(/"/g, "&quot;")}" />
    <label>Display name<input name="displayName" placeholder="Your name" /></label>
    <label>Email<input name="email" type="email" required placeholder="you@company.com" /></label>
    <label>Plan code (optional)<input name="planCode" placeholder="PRO-ARRAB" /></label>
    <button type="submit">Sign in</button>
    <p id="msg"></p>
  </form>
  <script>
    const form = document.getElementById('form');
    const msg = document.getElementById('msg');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      msg.textContent = 'Signing in…';
      msg.className = '';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await fetch('/v1/account/auth/web/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || 'Sign-in failed');
        msg.className = 'ok';
        msg.textContent = 'Signed in as ' + payload.account.email + '. You can return to Arrab Studio.';
        form.querySelector('button').disabled = true;
      } catch (error) {
        msg.className = 'err';
        msg.textContent = error instanceof Error ? error.message : 'Sign-in failed';
      }
    });
  </script>
</body>
</html>`;
    return reply.type("text/html").send(html);
  });

  app.get("/v1/operator", async () => deps.queries.getOperator());
  app.put<{ Body: UpdateOperatorRequest }>("/v1/operator", async (request) =>
    deps.commands.updateOperator(request.body ?? {}),
  );

  app.get("/v1/tasks", async () => ({ items: await deps.queries.listTasks() }));
  app.post<{ Body: CreateTaskRequest }>("/v1/tasks", async (request) =>
    deps.commands.createTask(request.body ?? { title: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateTaskRequest }>(
    "/v1/tasks/:id",
    async (request) => deps.commands.updateTask(request.params.id, request.body ?? {}),
  );
  app.delete<{ Params: { id: string } }>("/v1/tasks/:id", async (request) =>
    deps.commands.deleteTask(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { requireApproval?: boolean } }>(
    "/v1/tasks/:id/run",
    async (request) =>
      deps.taskExecution.runTask(request.params.id, {
        requireApproval: Boolean(request.body?.requireApproval),
      }),
  );
  app.get("/v1/task-runs", async () => ({ items: await deps.queries.listTaskRuns() }));
  app.get<{ Params: { id: string } }>("/v1/tasks/:id/runs", async (request) => ({
    items: await deps.queries.listTaskRuns(request.params.id),
  }));

  app.get("/v1/knowledge", async () => ({ items: await deps.queries.listKnowledge() }));
  app.post<{ Body: CreateKnowledgeRequest }>("/v1/knowledge", async (request) =>
    deps.commands.createKnowledge(request.body ?? { title: "", content: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateKnowledgeRequest }>(
    "/v1/knowledge/:id",
    async (request) => deps.commands.updateKnowledge(request.params.id, request.body ?? {}),
  );
  app.delete<{ Params: { id: string } }>("/v1/knowledge/:id", async (request) =>
    deps.commands.deleteKnowledge(request.params.id),
  );

  app.get("/v1/memories", async () => ({ items: await deps.queries.listMemories() }));
  app.post<{ Body: CreateMemoryRequest }>("/v1/memories", async (request) =>
    deps.commands.createMemory(request.body ?? { content: "" }),
  );
  app.delete<{ Params: { id: string } }>("/v1/memories/:id", async (request) =>
    deps.commands.deleteMemory(request.params.id),
  );

  app.get<{ Querystring: { agentId?: string } }>("/v1/skills", async (request) => ({
    items: await deps.queries.listSkills(request.query.agentId),
  }));
  app.post<{ Body: CreateSkillRequest }>("/v1/skills", async (request) =>
    deps.commands.createSkill(
      request.body ?? { agentId: "", title: "", instructions: "" },
    ),
  );
  app.delete<{ Params: { id: string } }>("/v1/skills/:id", async (request) =>
    deps.commands.deleteSkill(request.params.id),
  );

  app.get("/v1/approvals", async () => ({ items: await deps.queries.listApprovals() }));
  app.get("/v1/approvals/pending", async () => ({
    items: await deps.queries.listPendingApprovals(),
  }));
  app.post<{ Body: CreateApprovalRequest }>("/v1/approvals", async (request) =>
    deps.commands.createApproval(
      request.body ?? { kind: "activate_agent", title: "" },
    ),
  );
  app.post<{ Params: { id: string }; Body: ResolveApprovalRequest }>(
    "/v1/approvals/:id/resolve",
    async (request) => {
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
          { toolResult: request.body?.toolResult },
        );
        return { ...resolved, continued };
      }
      return resolved;
    },
  );

  app.get("/v1/projects", async () => ({ items: await deps.queries.listProjects() }));
  app.post<{ Body: CreateProjectRequest }>("/v1/projects", async (request) =>
    deps.commands.createProject(request.body ?? { name: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateProjectRequest }>(
    "/v1/projects/:id",
    async (request) => deps.commands.updateProject(request.params.id, request.body ?? {}),
  );
  app.get<{ Params: { id: string } }>("/v1/projects/:id/repo", async (request) => ({
    item: await deps.queries.getBinding(request.params.id),
  }));
  app.put<{ Params: { id: string }; Body: BindProjectRepoRequest }>(
    "/v1/projects/:id/repo",
    async (request) =>
      deps.commands.bindProjectRepo(request.params.id, request.body ?? {
        connectorId: "",
        repoFullName: "",
      }),
  );
  app.delete<{ Params: { id: string } }>("/v1/projects/:id/repo", async (request) =>
    deps.commands.unbindProjectRepo(request.params.id),
  );

  app.get("/v1/bindings", async () => ({ items: await deps.queries.listBindings() }));

  app.get("/v1/agents", async () => ({ items: await deps.queries.listAgents() }));
  app.post<{ Body: CreateAgentRequest }>("/v1/agents", async (request) =>
    deps.commands.createAgent(request.body ?? { name: "", role: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateAgentRequest }>(
    "/v1/agents/:id",
    async (request) => deps.commands.updateAgent(request.params.id, request.body ?? {}),
  );
  app.delete<{ Params: { id: string } }>("/v1/agents/:id", async (request) =>
    deps.commands.deleteAgent(request.params.id),
  );
  app.get<{ Params: { agentId: string } }>(
    "/v1/agents/:agentId/conversations",
    async (request) => ({
      items: await deps.conversations.listByAgent(request.params.agentId),
    }),
  );

  app.get("/v1/teams", async () => ({ items: await deps.queries.listTeams() }));
  app.post<{ Body: CreateTeamRequest }>("/v1/teams", async (request) =>
    deps.commands.createTeam(request.body ?? { name: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateTeamRequest }>(
    "/v1/teams/:id",
    async (request) => deps.commands.updateTeam(request.params.id, request.body ?? {}),
  );
  app.get("/v1/memberships", async () => ({ items: await deps.queries.listMemberships() }));
  app.get<{ Params: { id: string } }>("/v1/teams/:id/members", async (request) => ({
    items: await deps.queries.listMembershipsByTeam(request.params.id),
  }));
  app.post<{ Params: { id: string }; Body: AddTeamMemberRequest }>(
    "/v1/teams/:id/members",
    async (request) =>
      deps.commands.addTeamMember(request.params.id, request.body ?? { agentId: "" }),
  );
  app.delete<{ Params: { id: string; agentId: string } }>(
    "/v1/teams/:id/members/:agentId",
    async (request) =>
      deps.commands.removeTeamMember(request.params.id, request.params.agentId),
  );

  app.get("/v1/conversations", async () => ({
    items: await deps.conversations.listConversations(),
  }));
  app.post<{ Body: CreateConversationRequest }>("/v1/conversations", async (request) =>
    deps.conversations.createConversation(request.body ?? { agentId: "" }),
  );
  app.get<{ Params: { id: string } }>("/v1/conversations/:id", async (request) =>
    deps.conversations.getConversation(request.params.id),
  );
  app.delete<{ Params: { id: string } }>("/v1/conversations/:id", async (request) =>
    deps.conversations.deleteConversation(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages",
    async (request) =>
      deps.conversations.sendMessage(request.params.id, request.body ?? { content: "" }),
  );
  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages/stream",
    async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const write = (event: string, data: unknown) => {
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
      try {
        const response = await deps.conversations.sendMessage(
          request.params.id,
          request.body ?? { content: "" },
          {
            onToken: (text) => write("token", { text }),
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

  app.get<{ Querystring: { status?: string } }>("/v1/goals", async (request) => ({
    items: await deps.goals.list(request.query.status),
  }));
  app.get<{ Params: { agentId: string } }>("/v1/agents/:agentId/goals", async (request) => ({
    items: await deps.goals.listActiveByAgent(request.params.agentId),
  }));
  app.post<{ Body: CreateGoalRequest }>("/v1/goals", async (request) =>
    deps.goals.create(request.body ?? { title: "" }),
  );
  app.patch<{ Params: { id: string }; Body: UpdateGoalRequest }>(
    "/v1/goals/:id",
    async (request) => deps.goals.update(request.params.id, request.body ?? {}),
  );

  app.get("/v1/activity", async () => ({ items: await deps.queries.listActivity() }));

  app.get("/v1/ai/status", async () => ({
    configured: deps.gateway.listProviders().length > 0,
    providers: deps.gateway.listProviders().map((provider) => provider.id),
    defaultModel: deps.defaultModel,
    reasoningEffort: "none" as const,
  }));

  app.get("/v1/connectors/catalog", async () => ({ items: deps.connectors.catalog() }));
  app.get("/v1/connectors", async () => ({ items: await deps.connectors.list() }));
  app.post<{ Body: ConnectConnectorRequest }>("/v1/connectors", async (request) =>
    deps.connectors.connect(request.body ?? { provider: "github", token: "" }),
  );
  app.post<{ Params: { id: string } }>("/v1/connectors/:id/verify", async (request) =>
    deps.connectors.verify(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    "/v1/connectors/:id/resources",
    async (request) => ({
      items: await deps.connectors.resources(request.params.id, request.query.q),
    }),
  );
  app.delete<{ Params: { id: string } }>("/v1/connectors/:id", async (request) =>
    deps.connectors.disconnect(request.params.id),
  );

  app.get<{
    Params: { id: string };
    Querystring: { mailbox?: string; limit?: string };
  }>("/v1/connectors/:id/email/messages", async (request) => {
    const limit = Number(request.query.limit || "30");
    return deps.connectors.listEmailMessages(
      request.params.id,
      request.query.mailbox || "INBOX",
      Number.isFinite(limit) ? limit : 30,
    );
  });
  app.get<{
    Params: { id: string; uid: string };
    Querystring: { mailbox?: string };
  }>("/v1/connectors/:id/email/messages/:uid", async (request) =>
    deps.connectors.readEmail(request.params.id, request.params.uid, request.query.mailbox || "INBOX"),
  );
  app.post<{ Params: { id: string }; Body: SendEmailRequest }>(
    "/v1/connectors/:id/email/send",
    async (request) =>
      deps.connectors.sendEmail(request.params.id, request.body ?? { to: "", subject: "", text: "" }),
  );

  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string };
  }>("/v1/github/repos/:owner/:repo", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubRepoMeta(
      connectorId,
      request.params.owner,
      request.params.repo,
    );
  });
  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string; ref?: string };
  }>("/v1/github/repos/:owner/:repo/tree", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubTree(
      connectorId,
      request.params.owner,
      request.params.repo,
      request.query.ref,
    );
  });
  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCommitRequest;
  }>("/v1/github/repos/:owner/:repo/commits", async (request) =>
    deps.connectors.githubCommit(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", message: "", files: [] },
    ),
  );
  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCreatePullRequest;
  }>("/v1/github/repos/:owner/:repo/pulls", async (request) =>
    deps.connectors.githubPullRequest(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", title: "", head: "" },
    ),
  );
}
