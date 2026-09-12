import { NotFoundError, ValidationError } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import type {
  Approval,
  ConnectConnectorRequest,
  ConnectorProvider,
  ConnectorPublic,
  ConnectorResource,
  ConnectorSecretRecord,
  EmailMessageDetail,
  GithubCommitRequest,
  GithubCommitResponse,
  GithubCreatePullRequest,
  GithubPullRequestResponse,
  GithubRepoMetaResponse,
  GithubTreeResponse,
  ListEmailMessagesResponse,
  SendEmailRequest,
  SendEmailResponse,
  WorkspaceId,
} from "@arrab/shared";
import { brandId } from "@arrab/shared";
import { randomUUID } from "node:crypto";
import type { WorkspaceCommandService } from "./workspace-commands.js";
import {
  buildEmailSecret,
  listEmailMailboxes,
  listEmailMessages,
  parseEmailSecret,
  readEmailMessage,
  sendEmailMessage,
  verifyEmailSecret,
  type EmailSecret,
} from "./email-connector.js";

const AVAILABLE = new Set<ConnectorProvider>([
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "slack",
  "notion",
  "email",
]);
const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Arrab-Studio",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

type VerifiedAccount = { login: string; scopes: string[]; secret: string };

export class ConnectorService {
  constructor(
    private readonly persistence: Persistence,
    private readonly commands?: WorkspaceCommandService,
  ) {}

  async list(): Promise<ConnectorPublic[]> {
    const items = await this.persistence.connectors.list();
    return items.map(toPublic);
  }

  catalog(): Array<{ provider: ConnectorProvider; available: boolean; description: string }> {
    const providers: Array<{ provider: ConnectorProvider; description: string }> = [
      {
        provider: "github",
        description: "Repositories, commit, push, and pull requests for agent workspace.",
      },
      {
        provider: "gitlab",
        description: "GitLab projects via personal access token (api scope).",
      },
      {
        provider: "bitbucket",
        description: "Bitbucket repos via app password (account + repository read).",
      },
      {
        provider: "linear",
        description: "Linear issues and teams via personal API key.",
      },
      {
        provider: "slack",
        description: "Slack workspace channels via bot or user token.",
      },
      {
        provider: "notion",
        description: "Notion pages and databases via integration token.",
      },
      {
        provider: "email",
        description: "Connect Gmail/Outlook/iCloud/Yahoo with an app password — inbox, read, and send.",
      },
    ];
    return providers.map((item) => ({
      ...item,
      available: AVAILABLE.has(item.provider),
    }));
  }

  async connect(input: ConnectConnectorRequest): Promise<ConnectorPublic> {
    const provider = input.provider;
    if (!provider) {
      throw new ValidationError("Connector provider is required");
    }
    if (!AVAILABLE.has(provider)) {
      throw new ValidationError(`Connector ${provider} is not available yet`);
    }

    const verified = await this.verifyProvider(provider, input);
    const now = new Date().toISOString();
    const record: ConnectorSecretRecord = {
      id: randomUUID(),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      provider,
      status: "connected",
      accountLabel: input.label?.trim() || verified.login,
      scopes: verified.scopes,
      connectedAt: now,
      lastVerifiedAt: now,
      error: null,
      secret: verified.secret,
    };
    await this.persistence.connectors.create(record);
    return toPublic(record);
  }

  async verify(id: string): Promise<ConnectorPublic> {
    const existing = await this.persistence.connectors.getById(id);
    if (!existing) {
      throw new NotFoundError("Connector", id);
    }
    try {
      const verified = await this.reverifyRecord(existing);
      existing.status = "connected";
      existing.accountLabel = existing.accountLabel || verified.login;
      existing.scopes = verified.scopes;
      existing.lastVerifiedAt = new Date().toISOString();
      existing.error = null;
      if (verified.secret !== existing.secret) {
        existing.secret = verified.secret;
      }
    } catch (error: unknown) {
      existing.status = "error";
      existing.error = error instanceof Error ? error.message : "Verification failed";
      existing.lastVerifiedAt = new Date().toISOString();
    }
    await this.persistence.connectors.update(existing);
    return toPublic(existing);
  }

  async resources(id: string, query?: string): Promise<ConnectorResource[]> {
    const existing = await this.persistence.connectors.getById(id);
    if (!existing) {
      throw new NotFoundError("Connector", id);
    }
    switch (existing.provider) {
      case "github":
        return listGithubRepos(existing.secret, query);
      case "gitlab":
        return listGitlabProjects(existing.secret, query);
      case "bitbucket":
        return listBitbucketRepos(existing.secret, query);
      case "linear":
        return listLinearTeams(existing.secret);
      case "slack":
        return listSlackChannels(existing.secret);
      case "notion":
        return listNotionPages(existing.secret, query);
      case "email": {
        const secret = parseEmailSecret(existing.secret);
        if (!secret) throw new ValidationError("Invalid email connector secret");
        return listEmailMailboxes(secret);
      }
      default:
        return [];
    }
  }

  async listEmailMessages(
    id: string,
    mailbox = "INBOX",
    limit = 30,
  ): Promise<ListEmailMessagesResponse> {
    const secret = await this.requireEmailSecret(id);
    const items = await listEmailMessages(secret, mailbox || "INBOX", Math.min(50, Math.max(1, limit)));
    return { mailbox: mailbox || "INBOX", items };
  }

  async readEmail(id: string, uid: string, mailbox = "INBOX"): Promise<EmailMessageDetail> {
    const secret = await this.requireEmailSecret(id);
    return readEmailMessage(secret, uid, mailbox || "INBOX");
  }

  async sendEmail(id: string, body: SendEmailRequest): Promise<SendEmailResponse> {
    const secret = await this.requireEmailSecret(id);
    return sendEmailMessage(secret, body);
  }

  async getSecret(id: string): Promise<string | null> {
    const existing = await this.persistence.connectors.getById(id);
    return existing?.secret ?? null;
  }

  async disconnect(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.connectors.getById(id);
    if (!existing) {
      throw new NotFoundError("Connector", id);
    }
    const bindings = await this.persistence.bindings.list();
    for (const binding of bindings) {
      if (binding.connectorId === id) {
        await this.persistence.bindings.deleteByProject(binding.projectId);
      }
    }
    await this.persistence.connectors.delete(id);
    return { ok: true };
  }

  private async requireEmailSecret(id: string): Promise<EmailSecret> {
    const connector = await this.persistence.connectors.getById(id);
    if (!connector) throw new NotFoundError("Connector", id);
    if (connector.provider !== "email") {
      throw new ValidationError("Only email connectors support this action");
    }
    if (connector.status !== "connected") {
      throw new ValidationError("Reconnect email before using inbox actions");
    }
    const secret = parseEmailSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid email connector secret");
    return secret;
  }

  private async verifyProvider(
    provider: ConnectorProvider,
    input: ConnectConnectorRequest,
  ): Promise<VerifiedAccount> {
    const token = input.token?.trim() ?? "";
    const config = input.config ?? {};

    if (provider === "email") {
      const preset = (config.preset || "").toLowerCase();
      const defaults =
        preset === "gmail"
          ? { imapHost: "imap.gmail.com", imapPort: "993", smtpHost: "smtp.gmail.com", smtpPort: "465" }
          : preset === "outlook"
            ? {
                imapHost: "outlook.office365.com",
                imapPort: "993",
                smtpHost: "smtp.office365.com",
                smtpPort: "587",
              }
            : preset === "icloud"
              ? { imapHost: "imap.mail.me.com", imapPort: "993", smtpHost: "smtp.mail.me.com", smtpPort: "587" }
              : preset === "yahoo"
                ? {
                    imapHost: "imap.mail.yahoo.com",
                    imapPort: "993",
                    smtpHost: "smtp.mail.yahoo.com",
                    smtpPort: "465",
                  }
                : null;
      const secret = buildEmailSecret({
        address: config.address || input.label || "",
        password: token,
        imapHost: config.imapHost || defaults?.imapHost || "",
        imapPort: config.imapPort || defaults?.imapPort || "993",
        smtpHost: config.smtpHost || defaults?.smtpHost || "",
        smtpPort: config.smtpPort || defaults?.smtpPort || "465",
        secure: config.secure ?? "true",
      });
      const verified = await verifyEmailSecret(secret);
      return { login: verified.label, scopes: verified.scopes, secret: JSON.stringify(secret) };
    }

    if (token.length < 8) {
      throw new ValidationError("A valid access token is required");
    }

    switch (provider) {
      case "github": {
        const verified = await verifyGithub(token);
        return { login: verified.login, scopes: verified.scopes, secret: token };
      }
      case "gitlab": {
        const baseUrl = (config.baseUrl || "https://gitlab.com").replace(/\/$/, "");
        const verified = await verifyGitlab(token, baseUrl);
        return {
          login: verified.login,
          scopes: verified.scopes,
          secret: JSON.stringify({ kind: "gitlab", token, baseUrl }),
        };
      }
      case "bitbucket": {
        const username = (config.username || input.label || "").trim();
        if (!username) {
          throw new ValidationError("Bitbucket username is required in config.username");
        }
        const verified = await verifyBitbucket(username, token);
        return {
          login: verified.login,
          scopes: verified.scopes,
          secret: JSON.stringify({ kind: "bitbucket", username, token }),
        };
      }
      case "linear": {
        const verified = await verifyLinear(token);
        return { login: verified.login, scopes: verified.scopes, secret: token };
      }
      case "slack": {
        const verified = await verifySlack(token);
        return { login: verified.login, scopes: verified.scopes, secret: token };
      }
      case "notion": {
        const verified = await verifyNotion(token);
        return { login: verified.login, scopes: verified.scopes, secret: token };
      }
      default:
        throw new ValidationError(`Unsupported provider ${provider}`);
    }
  }

  private async reverifyRecord(existing: ConnectorSecretRecord): Promise<VerifiedAccount> {
    const provider = existing.provider as ConnectorProvider;
    if (provider === "email") {
      const secret = parseEmailSecret(existing.secret);
      if (!secret) throw new ValidationError("Invalid email connector secret");
      const verified = await verifyEmailSecret(secret);
      return { login: verified.label, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "gitlab") {
      const parsed = parseJsonSecret(existing.secret);
      const token = parsed?.token || existing.secret;
      const baseUrl = parsed?.baseUrl || "https://gitlab.com";
      const verified = await verifyGitlab(token, baseUrl);
      return {
        login: verified.login,
        scopes: verified.scopes,
        secret: JSON.stringify({ kind: "gitlab", token, baseUrl }),
      };
    }
    if (provider === "bitbucket") {
      const parsed = parseJsonSecret(existing.secret);
      const username = parsed?.username || existing.accountLabel || "";
      const token = parsed?.token || existing.secret;
      const verified = await verifyBitbucket(username, token);
      return {
        login: verified.login,
        scopes: verified.scopes,
        secret: JSON.stringify({ kind: "bitbucket", username, token }),
      };
    }
    if (provider === "github") {
      const verified = await verifyGithub(existing.secret);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "linear") {
      const verified = await verifyLinear(existing.secret);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "slack") {
      const verified = await verifySlack(existing.secret);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "notion") {
      const verified = await verifyNotion(existing.secret);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    throw new ValidationError(`Unsupported provider ${provider}`);
  }

  private async requireGithubToken(connectorId: string): Promise<string> {
    const connector = await this.persistence.connectors.getById(connectorId);
    if (!connector) {
      throw new NotFoundError("Connector", connectorId);
    }
    if (connector.provider !== "github") {
      throw new ValidationError("Only GitHub connectors support this action");
    }
    if (connector.status !== "connected") {
      throw new ValidationError("Reconnect GitHub before using workspace git actions");
    }
    return connector.secret;
  }

  async githubRepoMeta(
    connectorId: string,
    owner: string,
    repo: string,
  ): Promise<GithubRepoMetaResponse> {
    const token = await this.requireGithubToken(connectorId);
    const response = await githubFetch(token, `/repos/${owner}/${repo}`);
    if (!response.ok) {
      throw new ValidationError("Could not load GitHub repository metadata");
    }
    const meta = (await response.json()) as {
      full_name?: string;
      html_url?: string;
      description?: string | null;
      default_branch?: string;
      private?: boolean;
      language?: string | null;
    };
    return {
      fullName: meta.full_name ?? `${owner}/${repo}`,
      url: meta.html_url ?? null,
      description: meta.description ?? null,
      defaultBranch: meta.default_branch ?? "main",
      private: Boolean(meta.private),
      language: meta.language ?? null,
    };
  }

  async githubTree(
    connectorId: string,
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GithubTreeResponse> {
    const token = await this.requireGithubToken(connectorId);
    const meta = await this.githubRepoMeta(connectorId, owner, repo);
    const branch = ref?.trim() || meta.defaultBranch;
    const response = await githubFetch(
      token,
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    if (!response.ok) {
      throw new ValidationError("Could not load repository tree");
    }
    const payload = (await response.json()) as {
      truncated?: boolean;
      tree?: Array<{ path: string; type: string; sha: string; size?: number }>;
    };
    const entries = (payload.tree ?? [])
      .filter((item) => item.type === "blob" || item.type === "tree")
      .slice(0, 200)
      .map((item) => ({
        path: item.path,
        type: item.type as "blob" | "tree",
        sha: item.sha,
        size: item.size,
      }));
    return {
      ref: branch,
      truncated: Boolean(payload.truncated) || (payload.tree?.length ?? 0) > 200,
      entries,
    };
  }

  async githubCommit(
    owner: string,
    repo: string,
    input: GithubCommitRequest,
  ): Promise<GithubCommitResponse> {
    const message = input.message?.trim() ?? "";
    if (message.length === 0) {
      throw new ValidationError("Commit message is required");
    }
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new ValidationError("At least one file is required to commit");
    }
    for (const file of input.files) {
      if (!file.path?.trim()) {
        throw new ValidationError("Each file needs a path");
      }
      if (file.content === undefined || file.content === null) {
        throw new ValidationError(`File ${file.path} needs content`);
      }
      if (file.content.length > 400_000) {
        throw new ValidationError(`File ${file.path} is too large`);
      }
    }

    if (input.requireApproval && this.commands) {
      const approval = await this.commands.createApproval({
        kind: "git_push",
        title: `Commit to ${owner}/${repo}: ${message.slice(0, 80)}`,
        detail: JSON.stringify({
          owner,
          repo,
          connectorId: input.connectorId,
          message,
          branch: input.branch ?? null,
          files: input.files.map((file) => ({
            path: file.path,
            content: file.content,
          })),
        }),
      });
      return {
        sha: "",
        branch: input.branch?.trim() || "pending",
        url: null,
        approval,
      };
    }

    return this.executeGithubCommit(owner, repo, input);
  }

  async executeGithubCommit(
    owner: string,
    repo: string,
    input: GithubCommitRequest,
  ): Promise<GithubCommitResponse> {
    const token = await this.requireGithubToken(input.connectorId);
    const meta = await this.githubRepoMeta(input.connectorId, owner, repo);
    const branch = input.branch?.trim() || meta.defaultBranch;

    const refResponse = await githubFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    let baseCommitSha: string | null = null;
    let baseTreeSha: string | null = null;

    if (refResponse.ok) {
      const refPayload = (await refResponse.json()) as { object?: { sha?: string } };
      baseCommitSha = refPayload.object?.sha ?? null;
      if (baseCommitSha) {
        const commitResponse = await githubFetch(
          token,
          `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
        );
        if (commitResponse.ok) {
          const commitPayload = (await commitResponse.json()) as { tree?: { sha?: string } };
          baseTreeSha = commitPayload.tree?.sha ?? null;
        }
      }
    } else if (refResponse.status !== 404) {
      throw new ValidationError(`Could not read branch ${branch}`);
    }

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const file of input.files) {
      const blobResponse = await githubFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(file.content, "utf8").toString("base64"),
          encoding: "base64",
        }),
      });
      if (!blobResponse.ok) {
        throw new ValidationError(`Could not create blob for ${file.path}`);
      }
      const blob = (await blobResponse.json()) as { sha?: string };
      if (!blob.sha) {
        throw new ValidationError(`Missing blob sha for ${file.path}`);
      }
      treeItems.push({
        path: file.path.trim(),
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const treeResponse = await githubFetch(token, `/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha ?? undefined,
        tree: treeItems,
      }),
    });
    if (!treeResponse.ok) {
      throw new ValidationError("Could not create git tree");
    }
    const tree = (await treeResponse.json()) as { sha?: string };
    if (!tree.sha) {
      throw new ValidationError("Missing tree sha");
    }

    const commitResponse = await githubFetch(token, `/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: input.message.trim(),
        tree: tree.sha,
        parents: baseCommitSha ? [baseCommitSha] : [],
      }),
    });
    if (!commitResponse.ok) {
      const errText = await commitResponse.text();
      throw new ValidationError(`Could not create commit: ${errText.slice(0, 200)}`);
    }
    const commit = (await commitResponse.json()) as { sha?: string; html_url?: string };
    if (!commit.sha) {
      throw new ValidationError("Missing commit sha");
    }

    if (baseCommitSha) {
      const update = await githubFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      if (!update.ok) {
        throw new ValidationError(`Could not update branch ${branch}. Check token repo scope.`);
      }
    } else {
      const create = await githubFetch(token, `/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: commit.sha,
        }),
      });
      if (!create.ok) {
        throw new ValidationError(`Could not create branch ${branch}`);
      }
    }

    return {
      sha: commit.sha,
      branch,
      url: commit.html_url ?? `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
      approval: null,
    };
  }

  async githubPullRequest(
    owner: string,
    repo: string,
    input: GithubCreatePullRequest,
  ): Promise<GithubPullRequestResponse> {
    const title = input.title?.trim() ?? "";
    const head = input.head?.trim() ?? "";
    if (!title) {
      throw new ValidationError("Pull request title is required");
    }
    if (!head) {
      throw new ValidationError("Head branch is required");
    }

    if (input.requireApproval && this.commands) {
      const approval = await this.commands.createApproval({
        kind: "git_push",
        title: `Open PR on ${owner}/${repo}: ${title.slice(0, 80)}`,
        detail: JSON.stringify({
          action: "pull_request",
          owner,
          repo,
          connectorId: input.connectorId,
          title,
          body: input.body ?? null,
          head,
          base: input.base ?? null,
        }),
      });
      return {
        number: 0,
        url: "",
        title,
        approval,
      };
    }

    return this.executeGithubPullRequest(owner, repo, input);
  }

  async executeGithubPullRequest(
    owner: string,
    repo: string,
    input: GithubCreatePullRequest,
  ): Promise<GithubPullRequestResponse> {
    const token = await this.requireGithubToken(input.connectorId);
    const meta = await this.githubRepoMeta(input.connectorId, owner, repo);
    const base = input.base?.trim() || meta.defaultBranch;
    const response = await githubFetch(token, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: input.title.trim(),
        body: input.body?.trim() || undefined,
        head: input.head.trim(),
        base,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new ValidationError(`Could not open pull request: ${errText.slice(0, 240)}`);
    }
    const payload = (await response.json()) as {
      number?: number;
      html_url?: string;
      title?: string;
    };
    return {
      number: payload.number ?? 0,
      url: payload.html_url ?? "",
      title: payload.title ?? input.title,
      approval: null,
    };
  }

  async resumeApprovalAction(approval: Approval): Promise<{
    commit?: GithubCommitResponse;
    pullRequest?: GithubPullRequestResponse;
  }> {
    if (approval.kind !== "git_push" || !approval.detail) {
      return {};
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(approval.detail) as Record<string, unknown>;
    } catch {
      throw new ValidationError("Approval detail is not valid JSON");
    }
    const owner = String(payload.owner ?? "");
    const repo = String(payload.repo ?? "");
    const connectorId = String(payload.connectorId ?? "");
    if (!owner || !repo || !connectorId) {
      throw new ValidationError("Approval is missing repository details");
    }

    if (payload.action === "pull_request") {
      const pullRequest = await this.executeGithubPullRequest(owner, repo, {
        connectorId,
        title: String(payload.title ?? "Pull request"),
        body: (payload.body as string | null) ?? null,
        head: String(payload.head ?? ""),
        base: (payload.base as string | null) ?? undefined,
      });
      return { pullRequest };
    }

    const files = Array.isArray(payload.files)
      ? (payload.files as Array<{ path: string; content: string }>)
      : [];
    const commit = await this.executeGithubCommit(owner, repo, {
      connectorId,
      message: String(payload.message ?? "Arrab Studio commit"),
      branch: (payload.branch as string | null) ?? undefined,
      files,
    });
    return { commit };
  }
}

function toPublic(connector: ConnectorSecretRecord): ConnectorPublic {
  return {
    id: connector.id,
    provider: connector.provider as ConnectorProvider,
    status: connector.status,
    accountLabel: connector.accountLabel,
    scopes: connector.scopes,
    connectedAt: connector.connectedAt,
    lastVerifiedAt: connector.lastVerifiedAt,
    error: connector.error,
  };
}

function parseJsonSecret(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

async function verifyGithub(token: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      ...GITHUB_HEADERS_BASE,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new ValidationError("GitHub rejected this token. Check scopes and try again.");
  }
  const payload = (await response.json()) as { login?: string };
  const scopesHeader = response.headers.get("x-oauth-scopes") ?? "";
  const scopes = scopesHeader
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    login: payload.login ?? "github-user",
    scopes: scopes.length > 0 ? scopes : ["read:user"],
  };
}

async function verifyGitlab(
  token: string,
  baseUrl: string,
): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch(`${baseUrl}/api/v4/user`, {
    headers: { "PRIVATE-TOKEN": token, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("GitLab rejected this token.");
  }
  const payload = (await response.json()) as { username?: string; name?: string };
  return {
    login: payload.username || payload.name || "gitlab-user",
    scopes: ["api"],
  };
}

async function verifyBitbucket(
  username: string,
  appPassword: string,
): Promise<{ login: string; scopes: string[] }> {
  const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");
  const response = await fetch("https://api.bitbucket.org/2.0/user", {
    headers: { Authorization: `Basic ${auth}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Bitbucket rejected this username/app password.");
  }
  const payload = (await response.json()) as { username?: string; display_name?: string };
  return {
    login: payload.username || payload.display_name || username,
    scopes: ["account", "repository"],
  };
}

async function verifyLinear(token: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "User-Agent": "Arrab-Studio",
    },
    body: JSON.stringify({ query: "{ viewer { id name email } }" }),
  });
  if (!response.ok) {
    throw new ValidationError("Linear rejected this API key.");
  }
  const payload = (await response.json()) as {
    data?: { viewer?: { name?: string; email?: string } };
    errors?: unknown[];
  };
  if (payload.errors?.length || !payload.data?.viewer) {
    throw new ValidationError("Linear rejected this API key.");
  }
  return {
    login: payload.data.viewer.name || payload.data.viewer.email || "linear-user",
    scopes: ["read"],
  };
}

async function verifySlack(token: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Arrab-Studio",
    },
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    user?: string;
    team?: string;
    error?: string;
  };
  if (!payload.ok) {
    throw new ValidationError(payload.error || "Slack rejected this token.");
  }
  return {
    login: payload.user ? `${payload.user}@${payload.team || "slack"}` : payload.team || "slack",
    scopes: ["channels:read", "chat:write"],
  };
}

async function verifyNotion(token: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.notion.com/v1/users/me", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "User-Agent": "Arrab-Studio",
    },
  });
  if (!response.ok) {
    throw new ValidationError("Notion rejected this integration token.");
  }
  const payload = (await response.json()) as {
    name?: string;
    bot?: { owner?: { user?: { name?: string } } };
  };
  return {
    login: payload.name || payload.bot?.owner?.user?.name || "notion-bot",
    scopes: ["read_content"],
  };
}

async function listGitlabProjects(secret: string, query?: string): Promise<ConnectorResource[]> {
  const parsed = parseJsonSecret(secret);
  const token = parsed?.token || secret;
  const baseUrl = (parsed?.baseUrl || "https://gitlab.com").replace(/\/$/, "");
  const q = query?.trim() ? `&search=${encodeURIComponent(query.trim())}` : "";
  const response = await fetch(
    `${baseUrl}/api/v4/projects?membership=true&simple=true&per_page=50${q}`,
    { headers: { "PRIVATE-TOKEN": token, "User-Agent": "Arrab-Studio" } },
  );
  if (!response.ok) throw new ValidationError("Could not list GitLab projects.");
  const payload = (await response.json()) as Array<{
    id: number;
    path_with_namespace: string;
    web_url: string;
  }>;
  return payload.slice(0, 80).map((project) => ({
    id: String(project.id),
    name: project.path_with_namespace,
    url: project.web_url,
    kind: "project",
  }));
}

async function listBitbucketRepos(secret: string, query?: string): Promise<ConnectorResource[]> {
  const parsed = parseJsonSecret(secret);
  const username = parsed?.username || "";
  const token = parsed?.token || secret;
  const auth = Buffer.from(`${username}:${token}`).toString("base64");
  const response = await fetch("https://api.bitbucket.org/2.0/repositories?role=member&pagelen=50", {
    headers: { Authorization: `Basic ${auth}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) throw new ValidationError("Could not list Bitbucket repositories.");
  const payload = (await response.json()) as {
    values?: Array<{ uuid: string; full_name: string; links?: { html?: { href?: string } } }>;
  };
  const q = query?.trim().toLowerCase() ?? "";
  return (payload.values ?? [])
    .filter((repo) => !q || repo.full_name.toLowerCase().includes(q))
    .slice(0, 80)
    .map((repo) => ({
      id: repo.uuid,
      name: repo.full_name,
      url: repo.links?.html?.href ?? null,
      kind: "repository",
    }));
}

async function listLinearTeams(token: string): Promise<ConnectorResource[]> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "User-Agent": "Arrab-Studio",
    },
    body: JSON.stringify({ query: "{ teams { nodes { id name key } } }" }),
  });
  if (!response.ok) throw new ValidationError("Could not list Linear teams.");
  const payload = (await response.json()) as {
    data?: { teams?: { nodes?: Array<{ id: string; name: string; key: string }> } };
  };
  return (payload.data?.teams?.nodes ?? []).slice(0, 50).map((team) => ({
    id: team.id,
    name: `${team.key} · ${team.name}`,
    url: `https://linear.app/team/${team.key}`,
    kind: "team",
  }));
}

async function listSlackChannels(token: string): Promise<ConnectorResource[]> {
  const response = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100",
    {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "Arrab-Studio" },
    },
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    channels?: Array<{ id: string; name?: string; is_private?: boolean }>;
    error?: string;
  };
  if (!payload.ok) {
    throw new ValidationError(payload.error || "Could not list Slack channels.");
  }
  return (payload.channels ?? []).slice(0, 80).map((channel) => ({
    id: channel.id,
    name: `#${channel.name || channel.id}`,
    url: null,
    kind: channel.is_private ? "private_channel" : "channel",
  }));
}

async function listNotionPages(token: string, query?: string): Promise<ConnectorResource[]> {
  const response = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      "User-Agent": "Arrab-Studio",
    },
    body: JSON.stringify({
      query: query?.trim() || undefined,
      page_size: 30,
      filter: { property: "object", value: "page" },
    }),
  });
  if (!response.ok) throw new ValidationError("Could not search Notion pages.");
  const payload = (await response.json()) as {
    results?: Array<{
      id: string;
      url?: string;
      properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
    }>;
  };
  return (payload.results ?? []).map((page) => {
    const titleProp = Object.values(page.properties ?? {}).find((prop) => prop.type === "title");
    const title = titleProp?.title?.map((part) => part.plain_text || "").join("") || "Untitled";
    return {
      id: page.id,
      name: title,
      url: page.url ?? null,
      kind: "page",
    };
  });
}

async function listGithubRepos(token: string, query?: string): Promise<ConnectorResource[]> {
  const q = query?.trim().toLowerCase() ?? "";
  const pages = q ? 1 : 2;
  const repos: ConnectorResource[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const response = await fetch(
      `${GITHUB_API}/user/repos?per_page=50&sort=updated&page=${page}`,
      {
        headers: {
          ...GITHUB_HEADERS_BASE,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!response.ok) {
      throw new ValidationError("Could not list GitHub repositories with this token.");
    }
    const payload = (await response.json()) as Array<{
      id: number;
      full_name: string;
      html_url: string;
      private: boolean;
      default_branch?: string;
    }>;
    for (const repo of payload) {
      if (q && !repo.full_name.toLowerCase().includes(q)) {
        continue;
      }
      repos.push({
        id: String(repo.id),
        name: repo.full_name,
        url: repo.html_url,
        kind: repo.private ? "private_repo" : "public_repo",
      });
    }
    if (payload.length < 50) {
      break;
    }
  }
  return repos.slice(0, 100);
}

async function githubFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: string },
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      ...GITHUB_HEADERS_BASE,
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
  });
}

export async function fetchGithubRepoContext(
  token: string,
  repoFullName: string,
): Promise<string | null> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return null;
  }
  const headers = {
    ...GITHUB_HEADERS_BASE,
    Authorization: `Bearer ${token}`,
  };
  const metaResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!metaResponse.ok) {
    return null;
  }
  const meta = (await metaResponse.json()) as {
    full_name?: string;
    description?: string | null;
    default_branch?: string;
    html_url?: string;
    language?: string | null;
    stargazers_count?: number;
    open_issues_count?: number;
  };

  let readmeSnippet = "";
  const readmeResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, {
    headers: { ...headers, Accept: "application/vnd.github.raw+json" },
  });
  if (readmeResponse.ok) {
    const text = await readmeResponse.text();
    readmeSnippet = text.slice(0, 2500);
  }

  let treeSnippet = "";
  const branch = meta.default_branch ?? "main";
  const treeResponse = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers },
  );
  if (treeResponse.ok) {
    const treePayload = (await treeResponse.json()) as {
      tree?: Array<{ path: string; type: string }>;
    };
    const paths = (treePayload.tree ?? [])
      .filter((item) => item.type === "blob")
      .slice(0, 40)
      .map((item) => item.path);
    if (paths.length > 0) {
      treeSnippet = `\nFile tree sample:\n${paths.map((path) => `- ${path}`).join("\n")}`;
    }
  }

  return [
    `Linked GitHub repository (agent workspace context):`,
    `- Name: ${meta.full_name ?? repoFullName}`,
    `- URL: ${meta.html_url ?? "n/a"}`,
    `- Description: ${meta.description ?? "n/a"}`,
    `- Default branch: ${meta.default_branch ?? "n/a"}`,
    `- Language: ${meta.language ?? "n/a"}`,
    `- Stars: ${meta.stargazers_count ?? 0}`,
    `- Open issues: ${meta.open_issues_count ?? 0}`,
    treeSnippet,
    readmeSnippet ? `\nREADME excerpt:\n${readmeSnippet}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
