import type {
  Activity,
  AddTeamMemberRequest,
  Agent,
  AiGatewayStatusResponse,
  Approval,
  BindProjectRepoRequest,
  CollectionResponse,
  ConnectAccountRequest,
  ConnectAccountResponse,
  ConnectConnectorRequest,
  ConnectorPublic,
  ConnectorResource,
  Conversation,
  ConversationDetailResponse,
  CreateAgentRequest,
  CreateApprovalRequest,
  CreateConversationRequest,
  CreateGoalRequest,
  CreateProjectRequest,
  CreateSkillRequest,
  CreateTaskRequest,
  CreateTeamRequest,
  CreateKnowledgeRequest,
  CreateMemoryRequest,
  DashboardResponse,
  EmailMessageDetail,
  Goal,
  GithubCommitRequest,
  GithubCommitResponse,
  GithubCreatePullRequest,
  GithubPullRequestResponse,
  GithubRepoMetaResponse,
  GithubTreeResponse,
  HealthResponse,
  Knowledge,
  ListEmailMessagesResponse,
  Memory,
  OperatorProfile,
  AccountStatusResponse,
  ActivateSubscriptionRequest,
  BillingCheckoutRequest,
  BillingCheckoutResponse,
  SignInAccountRequest,
  StartWebAuthRequest,
  StartWebAuthResponse,
  PollWebAuthResponse,
  UpdateAccountProfileRequest,
  VerifyAccountSessionRequest,
  Project,
  ProjectRepoBinding,
  ReportSummaryResponse,
  ResolveApprovalRequest,
  RunTaskResponse,
  SendEmailRequest,
  SendEmailResponse,
  SendMessageRequest,
  SendMessageResponse,
  Skill,
  Task,
  TaskRun,
  Team,
  TeamMembership,
  UpdateAgentRequest,
  UpdateGoalRequest,
  UpdateKnowledgeRequest,
  UpdateOperatorRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UpdateTeamRequest,
  UsageSummaryResponse,
} from "@arrab/shared";

import { readApiBaseOverride } from "./prefs";

const envApiBaseUrl = (import.meta.env.VITE_ARRAB_API_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

/** Runtime base URL (Settings override wins over build-time env). */
export function getApiBaseUrl(): string {
  return readApiBaseOverride() ?? envApiBaseUrl;
}

/** @deprecated Prefer getApiBaseUrl() so Settings overrides apply. */
export const apiBaseUrl = envApiBaseUrl;

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

/** Network blips / offline — hide from the main UI chrome. */
export function isTransientApiError(message: string): boolean {
  return /cannot reach|can't reach|unavailable|timed out|failed to fetch|network|arrab api timed out|check your connection|unexpected error/i.test(
    message,
  );
}

function isLocalApiBase(url: string): boolean {
  return /127\.0\.0\.1|localhost/i.test(url);
}

function unreachableMessage(kind: "timeout" | "network", detail?: string): string {
  const base = getApiBaseUrl();
  if (isLocalApiBase(base)) {
    if (kind === "timeout") {
      return `Arrab API timed out at ${base} — is pnpm dev:api running?`;
    }
    return detail
      ? `Cannot reach the Arrab API at ${base}: ${detail}`
      : `Cannot reach the Arrab API at ${base} — start it with pnpm dev:api`;
  }
  return kind === "timeout"
    ? "Arrab timed out. Check your connection and try again."
    : "Can't reach Arrab right now. Check your connection and try again.";
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const base = getApiBaseUrl();
  const timeoutMs = init?.timeoutMs ?? (isLocalApiBase(base) ? 15_000 : 25_000);
  const url = `${base}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: init?.method ?? "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (!response.ok) {
        let message = `Arrab API returned ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: { message?: string } };
          if (payload.error?.message) {
            message = payload.error.message;
          }
        } catch {
          // keep status message
        }
        throw new ApiRequestError(message, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }
      lastError = error;
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && /abort/i.test(error.message));
      // Retry once on transient network / restart races.
      if (attempt === 0 && !aborted) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        continue;
      }
      if (aborted) {
        throw new ApiRequestError(unreachableMessage("timeout"), 0);
      }
      throw new ApiRequestError(unreachableMessage("network"), 0);
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new ApiRequestError(
    unreachableMessage(
      "network",
      lastError instanceof Error ? lastError.message : undefined,
    ),
    0,
  );
}

export const arrabApi = {
  health: () => request<HealthResponse>("/health"),
  meta: () =>
    request<{
      name: "arrab-api";
      version: string;
      persistence: string;
      workspaceId: string;
      aiProviders: string[];
      account?: {
        connected: boolean;
        planId: string | null;
        tokenLimit: number | null;
        tokensUsed: number;
        tokensRemaining: number | null;
        overLimit: boolean;
      };
    }>("/v1/meta"),
  account: () => request<AccountStatusResponse>("/v1/account"),
  connectAccount: (body: ConnectAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/connect", { method: "POST", body }),
  signInAccount: (body: SignInAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/sign-in", { method: "POST", body }),
  disconnectAccount: () =>
    request<AccountStatusResponse>("/v1/account/disconnect", { method: "POST" }),
  logoutAccount: () =>
    request<AccountStatusResponse>("/v1/account/logout", { method: "POST" }),
  startWebAuth: (body: StartWebAuthRequest = {}) =>
    request<StartWebAuthResponse>("/v1/account/auth/web/start", { method: "POST", body }),
  pollWebAuth: (state: string) =>
    request<PollWebAuthResponse>(
      `/v1/account/auth/web/poll?state=${encodeURIComponent(state)}`,
    ),
  activateSubscription: (body: ActivateSubscriptionRequest) =>
    request<AccountStatusResponse>("/v1/account/subscribe", { method: "POST", body }),
  updateAccountProfile: (body: UpdateAccountProfileRequest) =>
    request<AccountStatusResponse>("/v1/account", { method: "PATCH", body }),
  verifyAccountSession: (body: VerifyAccountSessionRequest) =>
    request<AccountStatusResponse>("/v1/account/session", { method: "POST", body }),
  billingCheckout: (body: BillingCheckoutRequest) =>
    request<BillingCheckoutResponse>("/v1/billing/checkout", { method: "POST", body }),
  billingConfirm: (invoiceId: string) =>
    request<AccountStatusResponse>(
      `/v1/billing/confirm?invoice=${encodeURIComponent(invoiceId)}`,
    ),
  dashboard: () => request<DashboardResponse>("/v1/dashboard"),
  projects: () => request<CollectionResponse<Project>>("/v1/projects"),
  createProject: (body: CreateProjectRequest) =>
    request<Project>("/v1/projects", { method: "POST", body }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<Project>(`/v1/projects/${id}`, { method: "PATCH", body }),
  agents: () => request<CollectionResponse<Agent>>("/v1/agents"),
  createAgent: (body: CreateAgentRequest) =>
    request<Agent>("/v1/agents", { method: "POST", body }),
  updateAgent: (id: string, body: UpdateAgentRequest) =>
    request<Agent>(`/v1/agents/${id}`, { method: "PATCH", body }),
  deleteAgent: (id: string) =>
    request<{ ok: true }>(`/v1/agents/${id}`, { method: "DELETE" }),
  teams: () => request<CollectionResponse<Team>>("/v1/teams"),
  createTeam: (body: CreateTeamRequest) =>
    request<Team>("/v1/teams", { method: "POST", body }),
  updateTeam: (id: string, body: UpdateTeamRequest) =>
    request<Team>(`/v1/teams/${id}`, { method: "PATCH", body }),
  activity: () => request<CollectionResponse<Activity>>("/v1/activity"),
  aiStatus: () => request<AiGatewayStatusResponse>("/v1/ai/status"),
  conversations: () => request<CollectionResponse<Conversation>>("/v1/conversations"),
  agentConversations: (agentId: string) =>
    request<CollectionResponse<Conversation>>(`/v1/agents/${agentId}/conversations`),
  createConversation: (body: CreateConversationRequest) =>
    request<Conversation>("/v1/conversations", { method: "POST", body }),
  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/v1/conversations/${id}`, { method: "DELETE" }),
  conversation: (id: string) => request<ConversationDetailResponse>(`/v1/conversations/${id}`),
  sendMessage: (id: string, body: SendMessageRequest) =>
    request<SendMessageResponse>(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body,
      timeoutMs: 90_000,
    }),
  sendMessageStream: async (
    id: string,
    body: SendMessageRequest,
    handlers: {
      onToken?: (text: string) => void;
      onToolStart?: (name: string, detail?: string) => void;
      onTool?: (name: string, result: string) => void;
      onApproval?: (approval: Approval) => void;
      onDone?: (response: SendMessageResponse) => void;
      onError?: (message: string) => void;
    } = {},
  ) => {
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(`${getApiBaseUrl()}/v1/conversations/${id}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        throw new ApiRequestError(text || `Stream failed (${response.status})`, response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
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
            } else if (eventName === "tool_start" && parsed.name) {
              handlers.onToolStart?.(parsed.name, parsed.detail);
            } else if (eventName === "tool" && parsed.name) {
              handlers.onTool?.(parsed.name, parsed.result ?? "");
            } else if (eventName === "approval" && parsed.approval) {
              handlers.onApproval?.(parsed.approval);
            } else if (eventName === "done") {
              sawDone = true;
              handlers.onDone?.(parsed as SendMessageResponse);
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
        // Proxies sometimes drop SSE; fall back to the solid non-stream path.
        const fallback = await arrabApi.sendMessage(id, body);
        if (fallback.assistantMessage?.content) {
          handlers.onToken?.(fallback.assistantMessage.content);
        }
        if (fallback.approval) {
          handlers.onApproval?.(fallback.approval);
        }
        handlers.onDone?.(fallback);
      }
    } catch (err: unknown) {
      if (err instanceof ApiRequestError) throw err;
      // Network / abort — try non-stream once.
      try {
        const fallback = await arrabApi.sendMessage(id, body);
        if (fallback.assistantMessage?.content) {
          handlers.onToken?.(fallback.assistantMessage.content);
        }
        if (fallback.approval) {
          handlers.onApproval?.(fallback.approval);
        }
        handlers.onDone?.(fallback);
      } catch (fallbackErr: unknown) {
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
    }
  },
  goals: (status?: string) =>
    request<CollectionResponse<Goal>>(
      status ? `/v1/goals?status=${encodeURIComponent(status)}` : "/v1/goals",
    ),
  agentGoals: (agentId: string) =>
    request<CollectionResponse<Goal>>(`/v1/agents/${agentId}/goals`),
  createGoal: (body: CreateGoalRequest) =>
    request<Goal>("/v1/goals", { method: "POST", body }),
  updateGoal: (id: string, body: UpdateGoalRequest) =>
    request<Goal>(`/v1/goals/${id}`, { method: "PATCH", body }),
  connectors: () => request<CollectionResponse<ConnectorPublic>>("/v1/connectors"),
  connectorCatalog: () =>
    request<CollectionResponse<{ provider: string; available: boolean }>>("/v1/connectors/catalog"),
  connectConnector: (body: ConnectConnectorRequest) =>
    request<ConnectorPublic>("/v1/connectors", { method: "POST", body, timeoutMs: 45_000 }),
  verifyConnector: (id: string) =>
    request<ConnectorPublic>(`/v1/connectors/${id}/verify`, { method: "POST", timeoutMs: 45_000 }),
  connectorResources: (id: string, q?: string) =>
    request<CollectionResponse<ConnectorResource>>(
      q
        ? `/v1/connectors/${id}/resources?q=${encodeURIComponent(q)}`
        : `/v1/connectors/${id}/resources`,
      {
        timeoutMs: 20_000,
      },
    ),
  disconnectConnector: (id: string) =>
    request<{ ok: true }>(`/v1/connectors/${id}`, { method: "DELETE" }),
  emailMessages: (id: string, mailbox = "INBOX", limit = 30) =>
    request<ListEmailMessagesResponse>(
      `/v1/connectors/${id}/email/messages?mailbox=${encodeURIComponent(mailbox)}&limit=${limit}`,
      { timeoutMs: 45_000 },
    ),
  emailMessage: (id: string, uid: string, mailbox = "INBOX") =>
    request<EmailMessageDetail>(
      `/v1/connectors/${id}/email/messages/${encodeURIComponent(uid)}?mailbox=${encodeURIComponent(mailbox)}`,
      { timeoutMs: 45_000 },
    ),
  sendEmail: (id: string, body: SendEmailRequest) =>
    request<SendEmailResponse>(`/v1/connectors/${id}/email/send`, {
      method: "POST",
      body,
      timeoutMs: 45_000,
    }),
  githubRepoMeta: (owner: string, repo: string, connectorId: string) =>
    request<GithubRepoMetaResponse>(
      `/v1/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?connectorId=${encodeURIComponent(connectorId)}`,
      { timeoutMs: 20_000 },
    ),
  githubTree: (owner: string, repo: string, connectorId: string, ref?: string) =>
    request<GithubTreeResponse>(
      `/v1/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree?connectorId=${encodeURIComponent(connectorId)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`,
      { timeoutMs: 20_000 },
    ),
  githubCommit: (owner: string, repo: string, body: GithubCommitRequest) =>
    request<GithubCommitResponse>(
      `/v1/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
      { method: "POST", body, timeoutMs: 60_000 },
    ),
  githubPullRequest: (owner: string, repo: string, body: GithubCreatePullRequest) =>
    request<GithubPullRequestResponse>(
      `/v1/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      { method: "POST", body, timeoutMs: 30_000 },
    ),
  usage: () => request<UsageSummaryResponse>("/v1/usage"),
  memberships: () => request<CollectionResponse<TeamMembership>>("/v1/memberships"),
  teamMembers: (teamId: string) =>
    request<CollectionResponse<TeamMembership>>(`/v1/teams/${teamId}/members`),
  addTeamMember: (teamId: string, body: AddTeamMemberRequest) =>
    request<TeamMembership>(`/v1/teams/${teamId}/members`, { method: "POST", body }),
  removeTeamMember: (teamId: string, agentId: string) =>
    request<{ ok: true }>(`/v1/teams/${teamId}/members/${agentId}`, { method: "DELETE" }),
  bindings: () => request<CollectionResponse<ProjectRepoBinding>>("/v1/bindings"),
  projectRepo: (projectId: string) =>
    request<{ item: ProjectRepoBinding | null }>(`/v1/projects/${projectId}/repo`),
  bindProjectRepo: (projectId: string, body: BindProjectRepoRequest) =>
    request<ProjectRepoBinding>(`/v1/projects/${projectId}/repo`, { method: "PUT", body }),
  unbindProjectRepo: (projectId: string) =>
    request<{ ok: true }>(`/v1/projects/${projectId}/repo`, { method: "DELETE" }),
  operator: () => request<OperatorProfile>("/v1/operator"),
  updateOperator: (body: UpdateOperatorRequest) =>
    request<OperatorProfile>("/v1/operator", { method: "PUT", body }),
  tasks: () => request<CollectionResponse<Task>>("/v1/tasks"),
  createTask: (body: CreateTaskRequest) =>
    request<Task>("/v1/tasks", { method: "POST", body }),
  updateTask: (id: string, body: UpdateTaskRequest) =>
    request<Task>(`/v1/tasks/${id}`, { method: "PATCH", body }),
  deleteTask: (id: string) => request<{ ok: true }>(`/v1/tasks/${id}`, { method: "DELETE" }),
  runTask: (id: string, options?: { requireApproval?: boolean }) =>
    request<RunTaskResponse>(`/v1/tasks/${id}/run`, {
      method: "POST",
      body: options?.requireApproval ? { requireApproval: true } : {},
      timeoutMs: 60_000,
    }),
  taskRuns: (taskId?: string) =>
    request<CollectionResponse<TaskRun>>(
      taskId ? `/v1/tasks/${taskId}/runs` : "/v1/task-runs",
    ),
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
  deleteMemory: (id: string) =>
    request<{ ok: true }>(`/v1/memories/${id}`, { method: "DELETE" }),
  skills: (agentId?: string) =>
    request<CollectionResponse<Skill>>(
      agentId ? `/v1/skills?agentId=${encodeURIComponent(agentId)}` : "/v1/skills",
    ),
  createSkill: (body: CreateSkillRequest) =>
    request<{ skill: Skill; task: Task | null }>("/v1/skills", { method: "POST", body }),
  deleteSkill: (id: string) =>
    request<{ ok: true }>(`/v1/skills/${id}`, { method: "DELETE" }),
  approvals: () => request<CollectionResponse<Approval>>("/v1/approvals"),
  pendingApprovals: () =>
    request<CollectionResponse<Approval>>("/v1/approvals/pending"),
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
  reportSummary: () => request<ReportSummaryResponse>("/v1/reports/summary"),
};
