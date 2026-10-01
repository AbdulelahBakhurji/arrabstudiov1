import type { BindProjectRepoRequest, CollectionResponse, ConnectConnectorRequest, ConnectorPublic, ConnectorResource, EmailMessageDetail, ControlConnector, GithubCommitRequest, GithubCommitResponse, GithubCreatePullRequest, GithubPullRequestResponse, GithubRepoMetaResponse, GithubTreeResponse, ListEmailMessagesResponse, ProjectRepoBinding, SendEmailRequest, SendEmailResponse, OpenWaLinkStartRequest, OpenWaLinkStartResponse, OpenWaLinkStatusResponse, SendWhatsAppRequest, SendWhatsAppResponse, ListWhatsAppMessagesResponse, ArrangeEmailRequest, ArrangeEmailResponse, StartGmailOAuthResponse } from "@arrab/shared";
import { readAccountSessionToken } from "@/domains/account/account-session";
import { ApiRequestError, request } from "@/core/api/http";


export const connectorsApi = {

  connectors: async () => {
    const { localSshConnectors } = await import("@/domains/connectors/ssh-config");
    const local = localSshConnectors();
    if (!readAccountSessionToken()) return { items: local };
    const remote = await request<CollectionResponse<ConnectorPublic>>("/v1/connectors");
    const remoteIds = new Set(remote.items.map((item) => item.id));
    return { items: [...local.filter((item) => !remoteIds.has(item.id)), ...remote.items] };
  },
  connectorCatalog: () =>
    request<CollectionResponse<{ provider: string; available: boolean }>>("/v1/connectors/catalog"),
  connectConnector: (body: ConnectConnectorRequest) => {
    if (!readAccountSessionToken()) {
      throw new ApiRequestError("Sign in to connect a tool", 401, "UNAUTHORIZED");
    }
    return request<ConnectorPublic>("/v1/connectors", { method: "POST", body, timeoutMs: 45_000 });
  },
  startGmailOAuth: () => {
    if (!readAccountSessionToken()) {
      throw new ApiRequestError("Sign in to connect a tool", 401, "UNAUTHORIZED");
    }
    return request<StartGmailOAuthResponse>("/v1/connectors/gmail/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    });
  },
  startGithubOAuth: () => {
    if (!readAccountSessionToken()) {
      throw new ApiRequestError("Sign in to connect a tool", 401, "UNAUTHORIZED");
    }
    return request<StartGmailOAuthResponse>("/v1/connectors/github/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    });
  },
  startOutlookOAuth: () => {
    if (!readAccountSessionToken()) {
      throw new ApiRequestError("Sign in to connect a tool", 401, "UNAUTHORIZED");
    }
    return request<StartGmailOAuthResponse>("/v1/connectors/outlook/oauth/start", {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    });
  },
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
  ) => {
    if (!readAccountSessionToken()) {
      throw new ApiRequestError("Sign in to connect a tool", 401, "UNAUTHORIZED");
    }
    return request<StartGmailOAuthResponse>(`/v1/connectors/${provider}/oauth/start`, {
      method: "POST",
      body: {},
      timeoutMs: 20_000,
    });
  },
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
  disconnectConnector: async (id: string) => {
    if (id.startsWith("sshcfg:")) {
      const { forgetLocalSsh } = await import("@/domains/connectors/ssh-config");
      forgetLocalSsh(id);
      return { ok: true as const };
    }
    return request<{ ok: true }>(`/v1/connectors/${id}`, { method: "DELETE" });
  },
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
  openWaLinkStart: (body: OpenWaLinkStartRequest = {}) =>
    request<OpenWaLinkStartResponse>("/v1/connectors/openwa/link/start", {
      method: "POST",
      body,
      timeoutMs: 60_000,
    }),
  openWaLinkStatus: () =>
    request<OpenWaLinkStatusResponse>("/v1/connectors/openwa/link/status", {
      timeoutMs: 30_000,
    }),
  sshExec: async (id: string, body: { command: string }) => {
    if (id.startsWith("sshcfg:")) {
      const { execSshConfig, localSshAlias } = await import("@/domains/connectors/ssh-config");
      const alias = localSshAlias(id);
      if (!alias) throw new ApiRequestError("SSH host is no longer on this Mac", 404, "NOT_FOUND");
      return execSshConfig(alias, body.command);
    }
    return request<{ code: number | null; stdout: string; stderr: string }>(
      `/v1/connectors/${id}/ssh/exec`,
      {
        method: "POST",
        body,
        timeoutMs: 45_000,
      },
    );
  },
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
  bindings: () => request<CollectionResponse<ProjectRepoBinding>>("/v1/bindings"),
  projectRepo: (projectId: string) =>
    request<{ item: ProjectRepoBinding | null }>(`/v1/projects/${projectId}/repo`),
  bindProjectRepo: (projectId: string, body: BindProjectRepoRequest) =>
    request<ProjectRepoBinding>(`/v1/projects/${projectId}/repo`, { method: "PUT", body }),
  unbindProjectRepo: (projectId: string) =>
    request<{ ok: true }>(`/v1/projects/${projectId}/repo`, { method: "DELETE" }),
  controlConnectors: () => request<{ items: ControlConnector[] }>("/erp/connectors"),
};
