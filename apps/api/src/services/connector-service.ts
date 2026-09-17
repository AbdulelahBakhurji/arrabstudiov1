import { NotFoundError, ValidationError } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import type {
  Approval,
  ArrangeEmailRequest,
  ArrangeEmailResponse,
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
  SshExecRequest,
  SshExecResponse,
  StartGmailOAuthResponse,
  WorkspaceId,
} from "@arrab/shared";
import { brandId } from "@arrab/shared";
import { randomUUID } from "node:crypto";
import { decryptField, encryptField } from "../lib/field-crypto.js";
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
import {
  arrangeGmailMessages,
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  listGmailMailboxes,
  listGmailMessages,
  newGmailOAuthState,
  parseGmailSecret,
  readGmailMessage,
  sendGmailMessage,
  verifyGmailSecret,
  type GoogleOAuthConfig,
} from "./gmail-connector.js";
import {
  buildGithubAuthUrl,
  exchangeGithubAuthCode,
  githubAccessTokenFromSecret,
  newGithubOAuthState,
  parseGithubOAuthSecret,
  refreshGithubOAuthSecret,
  verifyGithubOAuthSecret,
  type GithubOAuthConfig,
} from "./github-oauth.js";
import {
  arrangeOutlookMessages,
  buildOutlookAuthUrl,
  exchangeOutlookAuthCode,
  listOutlookMailboxes,
  listOutlookMessages,
  newOutlookOAuthState,
  parseOutlookSecret,
  readOutlookMessage,
  sendOutlookMessage,
  verifyOutlookSecret,
  type MicrosoftOAuthConfig,
} from "./outlook-connector.js";
import {
  buildSshSecret,
  execSshCommand,
  listSshHomeEntries,
  parseSshSecret,
  verifySshSecret,
} from "./ssh-connector.js";

const AVAILABLE = new Set<ConnectorProvider>([
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "slack",
  "notion",
  "gmail",
  "outlook",
  "email",
  "ssh",
]);

type PendingOAuth = {
  state: string;
  createdAt: number;
  expiresAt: number;
};
const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Arrab-Studio",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

type VerifiedAccount = { login: string; scopes: string[]; secret: string };

export class ConnectorService {
  private readonly pendingGmailOAuth = new Map<string, PendingOAuth>();
  private readonly pendingOutlookOAuth = new Map<string, PendingOAuth>();
  private readonly pendingGithubOAuth = new Map<string, PendingOAuth>();

  constructor(
    private readonly persistence: Persistence,
    private readonly commands?: WorkspaceCommandService,
    private readonly google?: GoogleOAuthConfig | null,
    private readonly siteUrl = "http://127.0.0.1:8787",
    private readonly microsoft?: MicrosoftOAuthConfig | null,
    private readonly githubOAuth?: GithubOAuthConfig | null,
  ) {}

  private openConnector(record: ConnectorSecretRecord): ConnectorSecretRecord {
    return { ...record, secret: decryptField(record.secret) };
  }

  private sealConnector(record: ConnectorSecretRecord): ConnectorSecretRecord {
    return { ...record, secret: encryptField(record.secret) };
  }

  private async loadConnector(id: string): Promise<ConnectorSecretRecord | null> {
    const record = await this.persistence.connectors.getById(id);
    return record ? this.openConnector(record) : null;
  }

  private async saveConnector(record: ConnectorSecretRecord, mode: "create" | "update"): Promise<void> {
    const sealed = this.sealConnector(record);
    if (mode === "create") {
      await this.persistence.connectors.create(sealed);
    } else {
      await this.persistence.connectors.update(sealed);
    }
  }

  async list(): Promise<ConnectorPublic[]> {
    const items = await this.persistence.connectors.list();
    return items.map(toPublic);
  }

  catalog(): Array<{ provider: ConnectorProvider; available: boolean; description: string }> {
    const providers: Array<{ provider: ConnectorProvider; description: string }> = [
      {
        provider: "github",
        description:
          "Connect GitHub with browser OAuth — browse repos, commit, push, and open pull requests.",
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
        provider: "gmail",
        description: "Connect Gmail with Google OAuth — AI can list, read, arrange, and send mail.",
      },
      {
        provider: "outlook",
        description: "Connect Outlook with Microsoft OAuth — AI can list, read, arrange, and send mail.",
      },
      {
        provider: "email",
        description: "Connect IMAP/SMTP inboxes (iCloud, Yahoo, custom) with an app password.",
      },
      {
        provider: "ssh",
        description: "Connect a remote SSH host with password or private key — list files and run commands.",
      },
    ];
    return providers.map((item) => ({
      ...item,
      available: AVAILABLE.has(item.provider),
    }));
  }

  startGmailOAuth(): StartGmailOAuthResponse {
    const config = this.requireGoogleConfig();
    this.prunePendingGmailOAuth();
    const state = newGmailOAuthState();
    const now = Date.now();
    this.pendingGmailOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
    });
    return buildGmailAuthUrl(config, state);
  }

  startGithubOAuth(): StartGmailOAuthResponse {
    const config = this.requireGithubOAuthConfig();
    this.prunePendingGithubOAuth();
    const state = newGithubOAuthState();
    const now = Date.now();
    this.pendingGithubOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
    });
    return buildGithubAuthUrl(config, state);
  }

  async completeGithubOAuth(input: {
    code?: string | null;
    state?: string | null;
    error?: string | null;
    errorDescription?: string | null;
    installationId?: string | null;
  }): Promise<{ redirectUrl: string }> {
    const site = this.siteUrl.replace(/\/$/, "");
    const fail = (message: string) => ({
      redirectUrl: `${site}/app?view=connectors&github=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error?.trim()) {
      return fail(input.errorDescription?.trim() || input.error.trim());
    }
    const state = input.state?.trim() ?? "";
    const code = input.code?.trim() ?? "";
    this.prunePendingGithubOAuth();
    const pending = this.pendingGithubOAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingGithubOAuth.delete(state);
      return fail("OAuth session expired — start Connect GitHub again");
    }
    this.pendingGithubOAuth.delete(state);
    if (!code) {
      return fail("Missing GitHub authorization code");
    }
    try {
      const config = this.requireGithubOAuthConfig();
      const secret = await exchangeGithubAuthCode(config, code, input.installationId);
      const now = new Date().toISOString();
      const record: ConnectorSecretRecord = {
        id: randomUUID(),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        provider: "github",
        status: "connected",
        accountLabel: secret.login,
        scopes: secret.scopes.length > 0 ? secret.scopes : ["github-app"],
        connectedAt: now,
        lastVerifiedAt: now,
        error: null,
        secret: JSON.stringify(secret),
      };
      await this.saveConnector(record, "create");
      return {
        redirectUrl: `${site}/app?view=connectors&github=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "GitHub connect failed";
      return fail(message);
    }
  }

  async completeGmailOAuth(input: {
    code?: string | null;
    state?: string | null;
    error?: string | null;
  }): Promise<{ redirectUrl: string }> {
    const site = this.siteUrl.replace(/\/$/, "");
    const fail = (message: string) => ({
      redirectUrl: `${site}/app?view=connectors&gmail=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error?.trim()) {
      return fail(input.error.trim());
    }
    const state = input.state?.trim() ?? "";
    const code = input.code?.trim() ?? "";
    this.prunePendingGmailOAuth();
    const pending = this.pendingGmailOAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingGmailOAuth.delete(state);
      return fail("OAuth session expired — start Connect Gmail again");
    }
    this.pendingGmailOAuth.delete(state);
    if (!code) {
      return fail("Missing Google authorization code");
    }
    try {
      const config = this.requireGoogleConfig();
      const secret = await exchangeGmailAuthCode(config, code);
      const now = new Date().toISOString();
      const record: ConnectorSecretRecord = {
        id: randomUUID(),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        provider: "gmail",
        status: "connected",
        accountLabel: secret.email,
        scopes: secret.scopes,
        connectedAt: now,
        lastVerifiedAt: now,
        error: null,
        secret: JSON.stringify(secret),
      };
      await this.saveConnector(record, "create");
      return {
        redirectUrl: `${site}/app?view=connectors&gmail=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Gmail connect failed";
      return fail(message);
    }
  }

  startOutlookOAuth(): StartGmailOAuthResponse {
    const config = this.requireMicrosoftConfig();
    this.prunePendingOutlookOAuth();
    const state = newOutlookOAuthState();
    const now = Date.now();
    this.pendingOutlookOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
    });
    return buildOutlookAuthUrl(config, state);
  }

  async completeOutlookOAuth(input: {
    code?: string | null;
    state?: string | null;
    error?: string | null;
  }): Promise<{ redirectUrl: string }> {
    const site = this.siteUrl.replace(/\/$/, "");
    const fail = (message: string) => ({
      redirectUrl: `${site}/app?view=connectors&outlook=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error?.trim()) {
      return fail(input.error.trim());
    }
    const state = input.state?.trim() ?? "";
    const code = input.code?.trim() ?? "";
    this.prunePendingOutlookOAuth();
    const pending = this.pendingOutlookOAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingOutlookOAuth.delete(state);
      return fail("OAuth session expired — start Connect Outlook again");
    }
    this.pendingOutlookOAuth.delete(state);
    if (!code) {
      return fail("Missing Microsoft authorization code");
    }
    try {
      const config = this.requireMicrosoftConfig();
      const secret = await exchangeOutlookAuthCode(config, code);
      const now = new Date().toISOString();
      const record: ConnectorSecretRecord = {
        id: randomUUID(),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        provider: "outlook",
        status: "connected",
        accountLabel: secret.email,
        scopes: secret.scopes,
        connectedAt: now,
        lastVerifiedAt: now,
        error: null,
        secret: JSON.stringify(secret),
      };
      await this.saveConnector(record, "create");
      return {
        redirectUrl: `${site}/app?view=connectors&outlook=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Outlook connect failed";
      return fail(message);
    }
  }

  async connect(input: ConnectConnectorRequest): Promise<ConnectorPublic> {
    const provider = input.provider;
    if (!provider) {
      throw new ValidationError("Connector provider is required");
    }
    if (provider === "gmail") {
      throw new ValidationError("Use Google OAuth to connect Gmail (Connect Gmail button)");
    }
    if (provider === "outlook") {
      throw new ValidationError("Use Microsoft OAuth to connect Outlook (Connect Outlook button)");
    }
    if (provider === "github" && this.githubOAuth?.clientId && this.githubOAuth?.clientSecret) {
      throw new ValidationError("Use GitHub OAuth to connect GitHub (Connect GitHub button)");
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
    await this.saveConnector(record, "create");
    return toPublic(record);
  }

  async verify(id: string): Promise<ConnectorPublic> {
    const existing = await this.loadConnector(id);
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
    await this.saveConnector(existing, "update");
    return toPublic(existing);
  }

  async resources(id: string, query?: string): Promise<ConnectorResource[]> {
    const existing = await this.loadConnector(id);
    if (!existing) {
      throw new NotFoundError("Connector", id);
    }
    switch (existing.provider) {
      case "github":
        return listGithubRepos(await this.resolveGithubAccessToken(existing), query);
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
      case "gmail": {
        const secret = parseGmailSecret(existing.secret);
        if (!secret) throw new ValidationError("Invalid Gmail connector secret");
        return listGmailMailboxes(this.requireGoogleConfig(), secret);
      }
      case "outlook": {
        const secret = parseOutlookSecret(existing.secret);
        if (!secret) throw new ValidationError("Invalid Outlook connector secret");
        return listOutlookMailboxes(this.requireMicrosoftConfig(), secret);
      }
      case "ssh": {
        const secret = parseSshSecret(existing.secret);
        if (!secret) throw new ValidationError("Invalid SSH connector secret");
        return listSshHomeEntries(secret, query);
      }
      default:
        return [];
    }
  }

  async execSsh(id: string, body: SshExecRequest): Promise<SshExecResponse> {
    const connector = await this.loadConnector(id);
    if (!connector) throw new NotFoundError("Connector", id);
    if (connector.provider !== "ssh") {
      throw new ValidationError("Only SSH connectors support remote command execution");
    }
    if (connector.status !== "connected") {
      throw new ValidationError("Reconnect SSH before running remote commands");
    }
    const secret = parseSshSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid SSH connector secret");
    return execSshCommand(secret, body.command ?? "");
  }

  async findPreferredSshConnector(): Promise<ConnectorPublic | null> {
    const items = await this.persistence.connectors.list();
    const match = items.find((item) => item.provider === "ssh" && item.status === "connected");
    return match ? toPublic(match) : null;
  }

  async listEmailMessages(
    id: string,
    mailbox = "INBOX",
    limit = 30,
  ): Promise<ListEmailMessagesResponse> {
    const connector = await this.requireMailConnector(id);
    if (connector.provider === "gmail") {
      const secret = parseGmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      const items = await listGmailMessages(
        this.requireGoogleConfig(),
        secret,
        mailbox || "INBOX",
        Math.min(50, Math.max(1, limit)),
      );
      return { mailbox: mailbox || "INBOX", items };
    }
    if (connector.provider === "outlook") {
      const secret = parseOutlookSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      const items = await listOutlookMessages(
        this.requireMicrosoftConfig(),
        secret,
        mailbox || "inbox",
        Math.min(50, Math.max(1, limit)),
      );
      return { mailbox: mailbox || "inbox", items };
    }
    const secret = parseEmailSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid email connector secret");
    const items = await listEmailMessages(secret, mailbox || "INBOX", Math.min(50, Math.max(1, limit)));
    return { mailbox: mailbox || "INBOX", items };
  }

  async readEmail(id: string, uid: string, mailbox = "INBOX"): Promise<EmailMessageDetail> {
    const connector = await this.requireMailConnector(id);
    if (connector.provider === "gmail") {
      const secret = parseGmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      return readGmailMessage(this.requireGoogleConfig(), secret, uid);
    }
    if (connector.provider === "outlook") {
      const secret = parseOutlookSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      return readOutlookMessage(this.requireMicrosoftConfig(), secret, uid);
    }
    const secret = parseEmailSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid email connector secret");
    return readEmailMessage(secret, uid, mailbox || "INBOX");
  }

  async sendEmail(id: string, body: SendEmailRequest): Promise<SendEmailResponse> {
    const connector = await this.requireMailConnector(id);
    if (connector.provider === "gmail") {
      const secret = parseGmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      return sendGmailMessage(this.requireGoogleConfig(), secret, body);
    }
    if (connector.provider === "outlook") {
      const secret = parseOutlookSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      return sendOutlookMessage(this.requireMicrosoftConfig(), secret, body);
    }
    const secret = parseEmailSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid email connector secret");
    return sendEmailMessage(secret, body);
  }

  async arrangeEmail(id: string, body: ArrangeEmailRequest): Promise<ArrangeEmailResponse> {
    const connector = await this.requireMailConnector(id);
    if (connector.provider === "gmail") {
      const secret = parseGmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      return arrangeGmailMessages(this.requireGoogleConfig(), secret, body);
    }
    if (connector.provider === "outlook") {
      const secret = parseOutlookSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      return arrangeOutlookMessages(this.requireMicrosoftConfig(), secret, body);
    }
    throw new ValidationError("Arrange is available for Gmail and Outlook OAuth connectors");
  }

  /** Prefer connected Gmail/Outlook OAuth, else legacy IMAP email. */
  async findPreferredMailConnector(): Promise<ConnectorPublic | null> {
    const items = await this.list();
    const connected = items.filter((item) => item.status === "connected");
    return (
      connected.find((item) => item.provider === "gmail") ??
      connected.find((item) => item.provider === "outlook") ??
      connected.find((item) => item.provider === "email") ??
      null
    );
  }

  async getSecret(id: string): Promise<string | null> {
    const existing = await this.loadConnector(id);
    if (!existing) return null;
    if (existing.provider === "github") {
      return this.resolveGithubAccessToken(existing);
    }
    return existing.secret;
  }

  async disconnect(id: string): Promise<{ ok: true }> {
    const existing = await this.loadConnector(id);
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

  private async requireMailConnector(id: string): Promise<ConnectorSecretRecord> {
    const connector = await this.loadConnector(id);
    if (!connector) throw new NotFoundError("Connector", id);
    if (
      connector.provider !== "email" &&
      connector.provider !== "gmail" &&
      connector.provider !== "outlook"
    ) {
      throw new ValidationError("Only email/Gmail/Outlook connectors support this action");
    }
    if (connector.status !== "connected") {
      throw new ValidationError("Reconnect email before using inbox actions");
    }
    return connector;
  }

  private requireGoogleConfig(): GoogleOAuthConfig {
    const clientId = this.google?.clientId?.trim() ?? "";
    const clientSecret = this.google?.clientSecret?.trim() ?? "";
    const redirectUri = this.google?.redirectUri?.trim() ?? "";
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ValidationError(
        "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.",
      );
    }
    return { clientId, clientSecret, redirectUri };
  }

  private requireMicrosoftConfig(): MicrosoftOAuthConfig {
    const clientId = this.microsoft?.clientId?.trim() ?? "";
    const clientSecret = this.microsoft?.clientSecret?.trim() ?? "";
    const redirectUri = this.microsoft?.redirectUri?.trim() ?? "";
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ValidationError(
        "Outlook OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET on the API.",
      );
    }
    return { clientId, clientSecret, redirectUri };
  }

  private requireGithubOAuthConfig(): GithubOAuthConfig {
    const clientId = this.githubOAuth?.clientId?.trim() ?? "";
    const clientSecret = this.githubOAuth?.clientSecret?.trim() ?? "";
    const redirectUri = this.githubOAuth?.redirectUri?.trim() ?? "";
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ValidationError(
        "GitHub OAuth is not configured. Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET on the API.",
      );
    }
    return {
      clientId,
      clientSecret,
      redirectUri,
      appSlug: this.githubOAuth?.appSlug?.trim() || undefined,
    };
  }

  private prunePendingGmailOAuth(): void {
    const now = Date.now();
    for (const [state, pending] of this.pendingGmailOAuth) {
      if (pending.expiresAt < now) {
        this.pendingGmailOAuth.delete(state);
      }
    }
  }

  private prunePendingGithubOAuth(): void {
    const now = Date.now();
    for (const [state, pending] of this.pendingGithubOAuth) {
      if (pending.expiresAt < now) {
        this.pendingGithubOAuth.delete(state);
      }
    }
  }

  private prunePendingOutlookOAuth(): void {
    const now = Date.now();
    for (const [state, pending] of this.pendingOutlookOAuth) {
      if (pending.expiresAt < now) {
        this.pendingOutlookOAuth.delete(state);
      }
    }
  }

  private async requireEmailSecret(id: string): Promise<EmailSecret> {
    const connector = await this.loadConnector(id);
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

    if (provider === "ssh") {
      const authMode = (config.authMode || "password").toLowerCase() === "key" ? "key" : "password";
      const secret = buildSshSecret({
        host: config.host || "",
        port: config.port || "22",
        username: config.username || "",
        authMode,
        password: authMode === "password" ? token : undefined,
        privateKey: authMode === "key" ? config.privateKey || token : undefined,
        passphrase: config.passphrase,
      });
      const verified = await verifySshSecret(secret);
      return {
        login: input.label?.trim() || verified.label,
        scopes: verified.scopes,
        secret: JSON.stringify(secret),
      };
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
    if (provider === "ssh") {
      const secret = parseSshSecret(existing.secret);
      if (!secret) throw new ValidationError("Invalid SSH connector secret");
      const verified = await verifySshSecret(secret);
      return { login: verified.label, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "gmail") {
      const secret = parseGmailSecret(existing.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      const verified = await verifyGmailSecret(this.requireGoogleConfig(), secret);
      return {
        login: verified.label,
        scopes: verified.scopes,
        secret: JSON.stringify(verified.secret),
      };
    }
    if (provider === "outlook") {
      const secret = parseOutlookSecret(existing.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      const verified = await verifyOutlookSecret(this.requireMicrosoftConfig(), secret);
      return {
        login: verified.label,
        scopes: verified.scopes,
        secret: JSON.stringify(verified.secret),
      };
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
      const oauth = parseGithubOAuthSecret(existing.secret);
      if (oauth) {
        const verified = await verifyGithubOAuthSecret(this.requireGithubOAuthConfig(), oauth);
        return {
          login: verified.label,
          scopes: verified.scopes,
          secret: JSON.stringify(verified.secret),
        };
      }
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
    const connector = await this.loadConnector(connectorId);
    if (!connector) {
      throw new NotFoundError("Connector", connectorId);
    }
    if (connector.provider !== "github") {
      throw new ValidationError("Only GitHub connectors support this action");
    }
    if (connector.status !== "connected") {
      throw new ValidationError("Reconnect GitHub before using workspace git actions");
    }
    return this.resolveGithubAccessToken(connector);
  }

  /** Resolve PAT or OAuth secret → Bearer access token; persist refreshed OAuth secrets. */
  private async resolveGithubAccessToken(connector: ConnectorSecretRecord): Promise<string> {
    const oauth = parseGithubOAuthSecret(connector.secret);
    if (!oauth) {
      return githubAccessTokenFromSecret(connector.secret);
    }
    if (!this.githubOAuth?.clientId || !this.githubOAuth?.clientSecret) {
      return oauth.accessToken;
    }
    const fresh = await refreshGithubOAuthSecret(this.requireGithubOAuthConfig(), oauth);
    if (JSON.stringify(fresh) !== connector.secret) {
      connector.secret = JSON.stringify(fresh);
      await this.saveConnector(connector, "update");
    }
    return fresh.accessToken;
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
