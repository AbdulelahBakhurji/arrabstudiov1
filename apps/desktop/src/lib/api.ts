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
  ErpCompanion,
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
  SendWhatsAppRequest,
  SendWhatsAppResponse,
  ListWhatsAppMessagesResponse,
  ArrangeEmailRequest,
  ArrangeEmailResponse,
  StartGmailOAuthResponse,
  SendMessageRequest,
  IngestConversationMessagesRequest,
  IngestConversationMessagesResponse,
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
  FamilyHouseholdSnapshot,
  FamilyMemberPublic,
  FamilyGuidancePublic,
  CreateFamilyMemberRequest,
  UpdateFamilyMemberRequest,
  FamilyMemberSignInRequest,
  FamilyMemberSignInResponse,
  SwitchFamilyProfileRequest,
  SwitchFamilyProfileResponse,
  GrantFamilyTokensRequest,
  PurchaseFamilySeatsRequest,
  CreateFamilyGuidanceRequest,
} from "@arrab/shared";

import { readAccountSessionToken } from "./account-session";
import {
  normalizeApiRoutePrefix,
  readApiBaseOverride,
  readApiRoutePrefixOverride,
  splitApiBaseAndPrefix,
  writeApiBaseOverride,
  writeApiRoutePrefixOverride,
} from "./prefs";
import { isTauriRuntime } from "./terminal";
import { applySkillsToSendBody, ensureSkillCatalogWarm } from "./user-skills";
import { invoke } from "@tauri-apps/api/core";

const envSplit = splitApiBaseAndPrefix(
  import.meta.env.VITE_ARRAB_API_URL ?? "http://127.0.0.1:8787",
);
const envApiBaseUrl = envSplit.base;
const envApiRoutePrefix = normalizeApiRoutePrefix(
  import.meta.env.VITE_ARRAB_API_ROUTE_PREFIX || envSplit.prefix || "",
);

const DEAD_API_HOSTS = /185\.197\.250\.43/i;

/** Origin (scheme + host) for the Arrab API — no path prefix. */
export function getApiBaseUrl(): string {
  const override = readApiBaseOverride();
  if (override && DEAD_API_HOSTS.test(override)) {
    writeApiBaseOverride(null);
    return envApiBaseUrl;
  }
  const raw = override ?? envApiBaseUrl;
  const { base, prefix } = splitApiBaseAndPrefix(raw);
  // Heal prefs that stored Coolify path inside the base URL field.
  if (override && prefix && override !== base) {
    writeApiBaseOverride(base);
    if (readApiRoutePrefixOverride() === null) {
      writeApiRoutePrefixOverride(prefix);
    }
  }
  return base;
}

/** Optional Coolify/Traefik path prefix before `/health` and `/v1/*`. */
export function getApiRoutePrefix(): string {
  const override = readApiRoutePrefixOverride();
  if (override !== null) return override;
  // Never glue a production proxy path onto a local API host.
  if (isLocalApiBase(getApiBaseUrl())) return "";
  return envApiRoutePrefix;
}

/** Full API root: base URL + route prefix (no trailing slash). */
export function getApiRoot(): string {
  return `${getApiBaseUrl()}${getApiRoutePrefix()}`;
}

export function getEnvApiBaseUrl(): string {
  return envApiBaseUrl;
}

export function getEnvApiRoutePrefix(): string {
  return envApiRoutePrefix;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
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
  const root = getApiRoot();
  if (isLocalApiBase(root)) {
    if (kind === "timeout") {
      return `Arrab API timed out at ${root} — is pnpm dev:api running?`;
    }
    return detail
      ? `Cannot reach the Arrab API at ${root}: ${detail}`
      : `Cannot reach the Arrab API at ${root} — start it with pnpm dev:api`;
  }
  return kind === "timeout"
    ? "Arrab timed out. Check your connection and try again."
    : "Can't reach Arrab right now. Check your connection and try again.";
}

function buildAuthHeaders(): Record<string, string> {
  const authHeaders: Record<string, string> = {};
  try {
    const accountToken = readAccountSessionToken();
    if (accountToken) {
      authHeaders.Authorization = `Bearer ${accountToken}`;
      authHeaders["X-Arrab-Account-Session"] = accountToken;
    }
  } catch {
    // ignore storage failures
  }
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (raw) {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      if (parsed.sessionToken) {
        authHeaders["X-Arrab-Employee-Session"] = parsed.sessionToken;
      }
    }
  } catch {
    // ignore
  }
  try {
    const familyMemberId = localStorage.getItem("arrab.family.activeMemberId");
    if (familyMemberId?.trim()) {
      authHeaders["X-Arrab-Family-Member"] = familyMemberId.trim();
    }
  } catch {
    // ignore
  }
  return authHeaders;
}

function parseErrorPayload(raw: string, status: number): ApiRequestError {
  let message = `Arrab API returned ${status}`;
  let code: string | null = null;
  try {
    const payload = JSON.parse(raw) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      code?: string;
    };
    if (typeof payload.error === "object" && payload.error) {
      if (payload.error.message) message = payload.error.message;
      if (payload.error.code) code = payload.error.code;
    } else if (typeof payload.error === "string") {
      message = payload.error;
    } else if (payload.message) {
      message = payload.message;
    }
    if (!code && typeof payload.code === "string") code = payload.code;
  } catch {
    // keep status message
  }
  if (!code && status === 402) {
    code = /session budget/i.test(message) ? "SESSION_BUDGET_EXCEEDED" : "QUOTA_EXCEEDED";
  }
  return new ApiRequestError(message, status, code);
}

async function nativeRequest(
  url: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; body: string }> {
  return invoke<{ status: number; body: string }>("native_http_request", {
    args: {
      method: init?.method ?? "GET",
      url,
      timeoutMs: init?.timeoutMs ?? 25_000,
      headers: {
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeaders(),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
  });
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const root = getApiRoot();
  const timeoutMs = init?.timeoutMs ?? (isLocalApiBase(root) ? 15_000 : 25_000);
  const url = `${root}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    init?.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(init?.signal?.reason);
    init?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Desktop WebView is blocked by Coolify CORP:same-site — use native HTTP.
      if (isTauriRuntime()) {
        const native = await nativeRequest(url, {
          method: init?.method,
          body: init?.body,
          timeoutMs,
        });
        if (native.status < 200 || native.status >= 300) {
          throw parseErrorPayload(native.body, native.status);
        }
        return JSON.parse(native.body) as T;
      }

      const response = await fetch(url, {
        method: init?.method ?? "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...buildAuthHeaders(),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (!response.ok) {
        const raw = await response.text();
        throw parseErrorPayload(raw, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      // A caller cancellation is intentional: never turn it into a timeout or retry it.
      init?.signal?.throwIfAborted();
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
      init?.signal?.removeEventListener("abort", abort);
    }
  }

  throw new ApiRequestError(
    unreachableMessage("network", lastError instanceof Error ? lastError.message : undefined),
    0,
  );
}

export const arrabApi = {
  health: async () => {
    try {
      return await request<HealthResponse>("/health");
    } catch (err) {
      // Coolify may expose `/v1/*` under the prefix while omitting `/health`.
      if (err instanceof ApiRequestError && err.status === 404) {
        await request<{ name?: string }>("/v1/meta");
        return {
          status: "ok" as const,
          service: "arrab-api" as const,
          time: new Date().toISOString(),
        };
      }
      throw err;
    }
  },
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
        pauseMode: "upgrade_required" | "upgrade_or_wait" | null;
      };
    }>("/v1/meta"),
  account: () => request<AccountStatusResponse>("/v1/account", { timeoutMs: 15_000 }),
  connectAccount: (body: ConnectAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/connect", { method: "POST", body }),
  signInAccount: (body: SignInAccountRequest) =>
    request<ConnectAccountResponse>("/v1/account/sign-in", { method: "POST", body }),
  disconnectAccount: () =>
    request<AccountStatusResponse>("/v1/account/disconnect", { method: "POST" }),
  logoutAccount: () => request<AccountStatusResponse>("/v1/account/logout", { method: "POST" }),
  startWebAuth: (body: StartWebAuthRequest = {}) =>
    request<StartWebAuthResponse>("/v1/account/auth/web/start", { method: "POST", body, timeoutMs: 20_000 }),
  pollWebAuth: (state: string, pollSecret: string) =>
    request<PollWebAuthResponse>(
      `/v1/account/auth/web/poll?state=${encodeURIComponent(state)}&pollSecret=${encodeURIComponent(pollSecret)}`,
      { timeoutMs: 15_000 },
    ),
  activateSubscription: (body: ActivateSubscriptionRequest) =>
    request<AccountStatusResponse>("/v1/account/subscribe", { method: "POST", body }),
  updateAccountProfile: (body: UpdateAccountProfileRequest) =>
    request<AccountStatusResponse>("/v1/account", { method: "PATCH", body }),
  verifyAccountSession: (body: VerifyAccountSessionRequest, timeoutMs = 12_000) =>
    request<AccountStatusResponse>("/v1/account/session", {
      method: "POST",
      body,
      timeoutMs,
    }),
  billingCheckout: (body: BillingCheckoutRequest) =>
    request<BillingCheckoutResponse>("/v1/billing/checkout", { method: "POST", body }),
  billingConfirm: (invoiceId: string) =>
    request<AccountStatusResponse>(`/v1/billing/confirm?invoice=${encodeURIComponent(invoiceId)}`),
  dashboard: () => request<DashboardResponse>("/v1/dashboard"),
  projects: () => request<CollectionResponse<Project>>("/v1/projects"),
  createProject: (body: CreateProjectRequest) =>
    request<Project>("/v1/projects", { method: "POST", body }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<Project>(`/v1/projects/${id}`, { method: "PATCH", body }),
  agents: () => request<CollectionResponse<Agent>>("/v1/agents"),
  createAgent: (body: CreateAgentRequest, signal?: AbortSignal) =>
    request<Agent>("/v1/agents", { method: "POST", body, signal }),
  updateAgent: (id: string, body: UpdateAgentRequest, signal?: AbortSignal) =>
    request<Agent>(`/v1/agents/${id}`, { method: "PATCH", body, signal }),
  deleteAgent: (id: string) => request<{ ok: true }>(`/v1/agents/${id}`, { method: "DELETE" }),
  /** POST archive — works when CORS only allows GET/HEAD/POST. */
  archiveAgent: (id: string) =>
    request<Agent>(`/v1/agents/${id}/archive`, { method: "POST", body: {} }),
  /** POST remove — hard delete with chats retained; CORS-safe. */
  removeAgent: (id: string) =>
    request<{ ok: true }>(`/v1/agents/${id}/remove`, { method: "POST", body: {} }),
  teams: () => request<CollectionResponse<Team>>("/v1/teams"),
  createTeam: (body: CreateTeamRequest) => request<Team>("/v1/teams", { method: "POST", body }),
  updateTeam: (id: string, body: UpdateTeamRequest) =>
    request<Team>(`/v1/teams/${id}`, { method: "PATCH", body }),
  activity: () => request<CollectionResponse<Activity>>("/v1/activity"),
  aiStatus: () => request<AiGatewayStatusResponse>("/v1/ai/status"),
  conversations: () => request<CollectionResponse<Conversation>>("/v1/conversations"),
  agentConversations: (agentId: string) =>
    request<CollectionResponse<Conversation>>(`/v1/agents/${agentId}/conversations`),
  createConversation: (body: CreateConversationRequest, signal?: AbortSignal) =>
    request<Conversation>("/v1/conversations", { method: "POST", body, signal }),
  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/v1/conversations/${id}`, { method: "DELETE" }),
  conversation: (id: string) => request<ConversationDetailResponse>(`/v1/conversations/${id}`),
  sendMessage: (id: string, body: SendMessageRequest, signal?: AbortSignal) =>
    request<SendMessageResponse>(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body,
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
      onToolStart?: (name: string, detail?: string) => void;
      onTool?: (name: string, result: string) => void;
      onApproval?: (approval: Approval) => void;
      onDone?: (response: SendMessageResponse) => void;
      onError?: (message: string) => void;
    } = {},
    signal?: AbortSignal,
  ) => {
    await ensureSkillCatalogWarm().catch(() => []);
    body = applySkillsToSendBody(body);
    // WebView fetch is blocked by CORP:same-site — use non-stream native request.
    if (isTauriRuntime()) {
      try {
        const result = await request<SendMessageResponse>(`/v1/conversations/${id}/messages`, {
          method: "POST",
          body,
          timeoutMs: 180_000,
          signal,
        });
        const text = result.assistantMessage?.content ?? "";
        if (text) handlers.onToken?.(text);
        if (result.approval) handlers.onApproval?.(result.approval);
        handlers.onDone?.(result);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof ApiRequestError
            ? err.message
            : err instanceof Error
              ? err.message
              : unreachableMessage("network");
        handlers.onError?.(message);
        throw err instanceof ApiRequestError
          ? err
          : new ApiRequestError(message, 0);
      }
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
      const response = await fetch(`${getApiRoot()}/v1/conversations/${id}/messages/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...buildAuthHeaders(),
        },
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
        signal?.throwIfAborted();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
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
  goals: (status?: string) =>
    request<CollectionResponse<Goal>>(
      status ? `/v1/goals?status=${encodeURIComponent(status)}` : "/v1/goals",
    ),
  agentGoals: (agentId: string) => request<CollectionResponse<Goal>>(`/v1/agents/${agentId}/goals`),
  createGoal: (body: CreateGoalRequest) => request<Goal>("/v1/goals", { method: "POST", body }),
  updateGoal: (id: string, body: UpdateGoalRequest) =>
    request<Goal>(`/v1/goals/${id}`, { method: "PATCH", body }),
  connectors: () => request<CollectionResponse<ConnectorPublic>>("/v1/connectors"),
  connectorCatalog: () =>
    request<CollectionResponse<{ provider: string; available: boolean }>>("/v1/connectors/catalog"),
  connectConnector: (body: ConnectConnectorRequest) =>
    request<ConnectorPublic>("/v1/connectors", { method: "POST", body, timeoutMs: 45_000 }),
  startGmailOAuth: () =>
    request<StartGmailOAuthResponse>("/v1/connectors/gmail/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    }),
  startGithubOAuth: () =>
    request<StartGmailOAuthResponse>("/v1/connectors/github/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    }),
  startOutlookOAuth: () =>
    request<StartGmailOAuthResponse>("/v1/connectors/outlook/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    }),
  startGenericOAuth: (
    provider:
      | "gitlab"
      | "bitbucket"
      | "linear"
      | "slack"
      | "notion"
      | "whoop"
      | "fitbit"
      | "google_drive"
      | "google_calendar"
      | "figma",
  ) =>
    request<StartGmailOAuthResponse>(`/v1/connectors/${provider}/oauth/start`, {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    }),
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
  arrangeEmail: (id: string, body: ArrangeEmailRequest) =>
    request<ArrangeEmailResponse>(`/v1/connectors/${id}/email/arrange`, {
      method: "POST",
      body,
      timeoutMs: 45_000,
    }),
  whatsappMessages: (id: string, limit = 40) =>
    request<ListWhatsAppMessagesResponse>(
      `/v1/connectors/${id}/whatsapp/messages?limit=${limit}`,
      { timeoutMs: 20_000 },
    ),
  sendWhatsApp: (id: string, body: SendWhatsAppRequest) =>
    request<SendWhatsAppResponse>(`/v1/connectors/${id}/whatsapp/send`, {
      method: "POST",
      body,
      timeoutMs: 45_000,
    }),
  sshExec: (id: string, body: { command: string }) =>
    request<{ code: number | null; stdout: string; stderr: string }>(
      `/v1/connectors/${id}/ssh/exec`,
      {
        method: "POST",
        body,
        timeoutMs: 45_000,
      },
    ),
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
  familyHousehold: () => request<FamilyHouseholdSnapshot>("/v1/family"),
  createFamilyMember: (body: CreateFamilyMemberRequest) =>
    request<FamilyMemberPublic>("/v1/family/members", { method: "POST", body }),
  updateFamilyMember: (id: string, body: UpdateFamilyMemberRequest) =>
    request<FamilyMemberPublic>(`/v1/family/members/${id}`, { method: "PATCH", body }),
  deleteFamilyMember: (id: string) =>
    request<{ ok: true }>(`/v1/family/members/${id}`, { method: "DELETE" }),
  familyMemberSignIn: (body: FamilyMemberSignInRequest) =>
    request<FamilyMemberSignInResponse>("/v1/family/members/sign-in", {
      method: "POST",
      body,
    }),
  switchFamilyProfile: (body: SwitchFamilyProfileRequest) =>
    request<SwitchFamilyProfileResponse>("/v1/family/switch", { method: "POST", body }),
  grantFamilyTokens: (body: GrantFamilyTokensRequest) =>
    request<FamilyHouseholdSnapshot>("/v1/family/tokens/grant", { method: "POST", body }),
  purchaseFamilySeats: (body: PurchaseFamilySeatsRequest) =>
    request<FamilyHouseholdSnapshot>("/v1/family/seats/purchase", { method: "POST", body }),
  addFamilyGuidance: (body: CreateFamilyGuidanceRequest) =>
    request<FamilyGuidancePublic>("/v1/family/guidance", { method: "POST", body }),
  familyGuidanceForCompanion: (companionId: string) =>
    request<{ items: FamilyGuidancePublic[] }>(
      `/v1/family/guidance?companionId=${encodeURIComponent(companionId)}`,
    ),
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
  erpCompanions: () =>
    request<{ items: ErpCompanion[] }>("/erp/companions?limit=500"),
  companionState: () =>
    request<{ updatedAt: string | null; state: unknown | null }>("/v1/companions/state"),
  putCompanionState: (body: { updatedAt: string; state: unknown }) =>
    request<{ updatedAt: string; state: unknown }>("/v1/companions/state", {
      method: "PUT",
      body,
    }),
  updateOperator: (body: UpdateOperatorRequest) =>
    request<OperatorProfile>("/v1/operator", { method: "PUT", body }),
  tasks: () => request<CollectionResponse<Task>>("/v1/tasks"),
  createTask: (body: CreateTaskRequest) => request<Task>("/v1/tasks", { method: "POST", body }),
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
    request<CollectionResponse<TaskRun>>(taskId ? `/v1/tasks/${taskId}/runs` : "/v1/task-runs"),
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
  reportSummary: () => request<ReportSummaryResponse>("/v1/reports/summary"),
  orgWorkforce: async () => {
    try {
      return await request<import("@arrab/shared").OrgWorkforceSnapshot>("/v1/org/workforce");
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("./org-workforce-local");
      return localOrgSnapshot(readOrgEmployeePublic());
    }
  },
  orgDepartments: async () => {
    try {
      return await request<CollectionResponse<import("@arrab/shared").OrgDepartment>>(
        "/v1/org/departments",
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("./org-workforce-local");
      const snap = await localOrgSnapshot();
      return { items: snap.departments };
    }
  },
  createOrgDepartment: async (body: import("@arrab/shared").CreateOrgDepartmentRequest) => {
    try {
      return await request<import("@arrab/shared").OrgDepartment>("/v1/org/departments", {
        method: "POST",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localCreateDepartment } = await import("./org-workforce-local");
        return await localCreateDepartment(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not create department",
          400,
        );
      }
    }
  },
  updateOrgDepartment: async (
    id: string,
    body: import("@arrab/shared").UpdateOrgDepartmentRequest,
  ) => {
    try {
      return await request<import("@arrab/shared").OrgDepartment>(`/v1/org/departments/${id}`, {
        method: "PATCH",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localUpdateDepartment } = await import("./org-workforce-local");
        return await localUpdateDepartment(id, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not update department",
          400,
        );
      }
    }
  },
  deleteOrgDepartment: async (id: string) => {
    try {
      return await request<{ ok: true }>(`/v1/org/departments/${id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localDeleteDepartment } = await import("./org-workforce-local");
      return localDeleteDepartment(id);
    }
  },
  orgEmployees: async () => {
    try {
      return await request<CollectionResponse<import("@arrab/shared").OrgEmployeePublic>>(
        "/v1/org/employees",
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("./org-workforce-local");
      const snap = await localOrgSnapshot(readOrgEmployeePublic());
      return { items: snap.employees };
    }
  },
  createOrgEmployee: async (body: import("@arrab/shared").CreateOrgEmployeeRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeePublic>("/v1/org/employees", {
        method: "POST",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localCreateEmployee } = await import("./org-workforce-local");
        return await localCreateEmployee(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not create employee",
          400,
        );
      }
    }
  },
  updateOrgEmployee: async (id: string, body: import("@arrab/shared").UpdateOrgEmployeeRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeePublic>(`/v1/org/employees/${id}`, {
        method: "PATCH",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localUpdateEmployee } = await import("./org-workforce-local");
        return await localUpdateEmployee(id, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not update employee",
          400,
        );
      }
    }
  },
  deleteOrgEmployee: async (id: string) => {
    try {
      return await request<{ ok: true }>(`/v1/org/employees/${id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localDeleteEmployee } = await import("./org-workforce-local");
      return localDeleteEmployee(id);
    }
  },
  orgEmployeeSignIn: async (body: import("@arrab/shared").OrgEmployeeSignInRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeeSessionResponse>(
        "/v1/org/employees/sign-in",
        { method: "POST", body },
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localEmployeeSignIn } = await import("./org-workforce-local");
        return await localEmployeeSignIn(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Sign-in failed",
          401,
        );
      }
    }
  },
  orgEmployeeSignOut: async () => {
    try {
      return await request<{ ok: true }>("/v1/org/employees/sign-out", {
        method: "POST",
        body: {},
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localEmployeeSignOut } = await import("./org-workforce-local");
      return localEmployeeSignOut(readOrgEmployeeSessionToken());
    }
  },
  orgEmployeeChangePassword: async (
    body: import("@arrab/shared").OrgEmployeeChangePasswordRequest,
  ) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeeSessionResponse>(
        "/v1/org/employees/change-password",
        { method: "POST", body },
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const token = readOrgEmployeeSessionToken();
      if (!token) throw new ApiRequestError("Employee session required", 401);
      try {
        const { localEmployeeChangePassword } = await import("./org-workforce-local");
        return await localEmployeeChangePassword(token, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not change password",
          400,
        );
      }
    }
  },
};

function readOrgEmployeeSessionToken(): string | null {
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionToken?: string };
    return parsed.sessionToken ?? null;
  } catch {
    return null;
  }
}

function readOrgEmployeePublic(): import("@arrab/shared").OrgEmployeePublic | null {
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { employee?: import("@arrab/shared").OrgEmployeePublic };
    return parsed.employee ?? null;
  } catch {
    return null;
  }
}
