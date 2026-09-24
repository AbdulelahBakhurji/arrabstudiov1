import { ForbiddenError, NotFoundError, ValidationError } from "@arrab/core";
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
  ListWhatsAppMessagesResponse,
  SendEmailRequest,
  SendEmailResponse,
  SendWhatsAppRequest,
  SendWhatsAppResponse,
  SshExecRequest,
  SshExecResponse,
  StartGmailOAuthResponse,
  WorkspaceId,
} from "@arrab/shared";
import { brandId } from "@arrab/shared";
import { createHash, randomUUID } from "node:crypto";
import { decryptField, encryptField } from "../lib/field-crypto.js";
import type { WorkspaceCommandService } from "./workspace-commands.js";
import type { FamilyHouseholdService } from "./family-household-service.js";

/** Prevent accidental double-sends when a stream falls back mid-turn. */
const RECENT_EMAIL_SENDS = new Map<string, { at: number; response: SendEmailResponse }>();
const EMAIL_SEND_DEDUP_MS = 90_000;

function emailSendFingerprint(
  connectorId: string,
  body: SendEmailRequest,
): string {
  return createHash("sha256")
    .update(
      [
        connectorId,
        body.to.trim().toLowerCase(),
        (body.cc ?? "").trim().toLowerCase(),
        body.subject.trim(),
        (body.text ?? "").trim(),
        (body.html ?? "").trim(),
      ].join("\n"),
    )
    .digest("hex");
}
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
import {
  buildWhatsAppSecret,
  extractWhatsAppInbound,
  parseWhatsAppSecret,
  sendWhatsAppText,
  verifyWhatsAppSecret,
  verifyWhatsAppWebhookSignature,
  type WhatsAppInboundMessage as WhatsAppInboundStored,
} from "./whatsapp-connector.js";
import {
  fetchFinnhubNews,
  fetchFinnhubQuote,
  verifyFinnhubApiKey,
  verifyFinnhubWebhookSecret,
} from "./finnhub-connector.js";
import {
  buildGenericAuthUrl,
  exchangeGenericAuthCode,
  genericAccessTokenFromSecret,
  isGenericOAuthProvider,
  newGenericOAuthState,
  parseGenericOAuthSecret,
  type GenericOAuthConfig,
  type GenericOAuthProvider,
} from "./generic-oauth.js";

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
  "whatsapp",
  "finnhub",
  "whoop",
  "fitbit",
  "google_drive",
  "google_calendar",
  "figma",
]);

const WHATSAPP_INBOUND_MAX = 200;

type PendingOAuth = {
  state: string;
  createdAt: number;
  expiresAt: number;
  /** Seat that started OAuth — callbacks may not carry the family header. */
  familyMemberId: string | null;
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
  private readonly pendingGenericOAuth = new Map<string, PendingOAuth & { provider: GenericOAuthProvider }>();
  /** Recent inbound WhatsApp messages keyed by phone_number_id. */
  private readonly whatsappInbound = new Map<string, WhatsAppInboundStored[]>();
  private familyHousehold: FamilyHouseholdService | null = null;

  constructor(
    private readonly persistence: Persistence,
    private readonly commands?: WorkspaceCommandService,
    private readonly google?: GoogleOAuthConfig | null,
    private readonly siteUrl = "http://127.0.0.1:8787",
    private readonly microsoft?: MicrosoftOAuthConfig | null,
    private readonly githubOAuth?: GithubOAuthConfig | null,
    private readonly whatsappWebhookVerifyToken?: string | null,
    private readonly whatsappAppSecret?: string | null,
    private readonly finnhubApiKey?: string | null,
    private readonly finnhubWebhookSecret?: string | null,
    private readonly genericOAuth: Partial<Record<GenericOAuthProvider, GenericOAuthConfig>> = {},
  ) {}

  /** Wire after construction (FamilyHousehold is created later in app bootstrap). */
  setFamilyHousehold(service: FamilyHouseholdService): void {
    this.familyHousehold = service;
  }

  /** Family seat for isolation; null means workspace-wide (non-family plans). */
  private async activeSeatId(explicit?: string | null): Promise<string | null> {
    if (explicit !== undefined) return explicit;
    if (!this.familyHousehold) return null;
    if (!(await this.familyHousehold.isFamilyPlanActive())) return null;
    return this.familyHousehold.getActiveMemberId();
  }

  /**
   * Credentials connected under a child seat that clearly belong to the household
   * owner (studio email / display name) are stamped on the owner instead — never
   * on the device's kid profile by accident.
   */
  private async seatForNewConnector(
    seatId: string | null,
    accountLabel: string | null | undefined,
  ): Promise<string | null> {
    if (!seatId || !this.familyHousehold) return seatId;
    const members = await this.persistence.familyMembers.list();
    const seat = members.find((m) => m.id === seatId);
    const owner = members.find((m) => m.isOwner);
    if (!seat || seat.role !== "child" || !owner) return seatId;
    const account = await this.persistence.accounts.get();
    const label = (accountLabel || "").trim().toLowerCase();
    if (!label) return seatId;
    const accountEmail = account?.email?.trim().toLowerCase() || "";
    const accountLocal = (accountEmail.split("@")[0] || "").replace(/[^a-z0-9]/g, "");
    const accountName = (account?.displayName || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const compact = label.replace(/[^a-z0-9]/g, "");
    if (accountEmail && label === accountEmail) return owner.id;
    if (accountLocal && compact && (compact === accountLocal || compact.includes(accountLocal) || accountLocal.includes(compact))) {
      return owner.id;
    }
    if (accountName && compact && (compact === accountName || compact.includes(accountName) || accountName.includes(compact))) {
      return owner.id;
    }
    return seatId;
  }

  private async assertSeatCanAccess(record: ConnectorSecretRecord): Promise<void> {
    if (!this.familyHousehold || !(await this.familyHousehold.isFamilyPlanActive())) return;
    const seatId = await this.familyHousehold.getActiveMemberId();
    if (!seatId) {
      throw new ForbiddenError("Switch to a family profile before using connectors");
    }
    if (record.familyMemberId && record.familyMemberId !== seatId) {
      throw new ForbiddenError("This connector belongs to another family profile");
    }
    if (!record.familyMemberId) {
      // Legacy unowned row — only the owner seat may touch it until reconnected.
      const members = await this.persistence.familyMembers.list();
      const seat = members.find((m) => m.id === seatId);
      if (!seat?.isOwner) {
        throw new ForbiddenError("This connector belongs to another family profile");
      }
    }
  }

  private openConnector(record: ConnectorSecretRecord): ConnectorSecretRecord {
    return { ...record, secret: decryptField(record.secret) };
  }

  private sealConnector(record: ConnectorSecretRecord): ConnectorSecretRecord {
    return { ...record, secret: encryptField(record.secret) };
  }

  private async loadConnector(id: string): Promise<ConnectorSecretRecord | null> {
    const record = await this.persistence.connectors.getById(id);
    if (!record) return null;
    const opened = this.openConnector(record);
    await this.assertSeatCanAccess(opened);
    return opened;
  }

  private async saveConnector(record: ConnectorSecretRecord, mode: "create" | "update"): Promise<void> {
    const sealed = this.sealConnector(record);
    if (mode === "create") {
      await this.persistence.connectors.create(sealed);
    } else {
      await this.persistence.connectors.update(sealed);
    }
  }

  /** Create or replace the seat/workspace connector for an OAuth provider (reconnect-safe). */
  private async upsertOAuthConnector(
    record: Omit<ConnectorSecretRecord, "id"> & { id?: string },
  ): Promise<void> {
    const seatId = await this.seatForNewConnector(
      record.familyMemberId ?? null,
      record.accountLabel,
    );
    const existing = (await this.persistence.connectors.list()).find((item) => {
      if (item.provider !== record.provider) return false;
      if (seatId) return item.familyMemberId === seatId;
      return !item.familyMemberId;
    });
    if (existing) {
      await this.saveConnector(
        {
          ...this.openConnector(existing),
          ...record,
          id: existing.id,
          familyMemberId: seatId ?? existing.familyMemberId ?? null,
          connectedAt: existing.connectedAt || record.connectedAt,
        },
        "update",
      );
      return;
    }
    await this.saveConnector(
      {
        ...record,
        id: record.id ?? randomUUID(),
        familyMemberId: seatId,
      } as ConnectorSecretRecord,
      "create",
    );
  }

  async list(): Promise<ConnectorPublic[]> {
    const items = await this.persistence.connectors.list();
    if (!this.familyHousehold || !(await this.familyHousehold.isFamilyPlanActive())) {
      return items.map(toPublic);
    }
    const seatId = await this.familyHousehold.getActiveMemberId();
    // No active seat → never leak workspace-wide / other-seat connectors.
    if (!seatId) return [];

    const members = await this.persistence.familyMembers.list();
    const seat = members.find((m) => m.id === seatId);
    const owner = members.find((m) => m.isOwner);
    const managerIds = new Set(
      members
        .filter((m) => m.isOwner || m.role === "parent" || m.role === "partner")
        .map((m) => String(m.id)),
    );

    // Heal bleed: credentials that landed on a child seat but belong to a parent
    // (studio account identity, or same provider+account as a manager seat) move home.
    if (owner && seat?.role === "child") {
      const account = await this.persistence.accounts.get();
      const accountEmail = account?.email?.trim().toLowerCase() || "";
      const accountLocal = accountEmail.split("@")[0] || "";
      const accountName = (account?.displayName || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      const parentKeys = new Set(
        items
          .filter((item) => item.familyMemberId && managerIds.has(String(item.familyMemberId)))
          .map((item) => `${item.provider}:${(item.accountLabel || "").trim().toLowerCase()}`),
      );
      const relatedToAccount = (label: string): boolean => {
        if (!label) return false;
        if (accountEmail && label === accountEmail) return true;
        const compact = label.replace(/[^a-z0-9]/g, "");
        if (accountLocal) {
          const local = accountLocal.replace(/[^a-z0-9]/g, "");
          if (local && (compact === local || compact.includes(local) || local.includes(compact))) {
            return true;
          }
        }
        if (accountName && compact && (compact === accountName || compact.includes(accountName) || accountName.includes(compact))) {
          return true;
        }
        return false;
      };
      for (const item of items) {
        if (item.familyMemberId !== seatId) continue;
        const label = (item.accountLabel || "").trim().toLowerCase();
        const key = `${item.provider}:${label}`;
        const looksLikeParent = relatedToAccount(label) || (label.length > 0 && parentKeys.has(key));
        if (!looksLikeParent) continue;
        const opened = this.openConnector(item);
        await this.saveConnector(
          { ...opened, familyMemberId: owner.id },
          "update",
        );
        item.familyMemberId = owner.id;
      }
    }

    return items
      .filter((item) => item.familyMemberId != null && item.familyMemberId === seatId)
      .map(toPublic);
  }

  catalog(): Array<{
    provider: ConnectorProvider;
    available: boolean;
    description: string;
    webhook?: boolean;
  }> {
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
      {
        provider: "whatsapp",
        description:
          "WhatsApp Business Cloud API — connect a Business number; agents can receive webhooks and send replies.",
      },
      {
        provider: "finnhub",
        description:
          "Finnhub market data — quotes and company news for Trader companions (platform key or workspace API key).",
      },
      {
        provider: "whoop",
        description:
          "WHOOP recovery, sleep, strain, and workouts via browser OAuth — connect your band for health companions.",
      },
      {
        provider: "fitbit",
        description:
          "Fitbit activity, heart rate, sleep, and weight via browser OAuth — connect your tracker for health companions.",
      },
      {
        provider: "google_drive",
        description:
          "Google Drive files via browser OAuth — browse and work with docs your agents create or open.",
      },
      {
        provider: "google_calendar",
        description:
          "Google Calendar via browser OAuth — list, create, and update events for scheduling companions.",
      },
      {
        provider: "figma",
        description:
          "Figma files via browser OAuth — read designs, metadata, and comments for design companions.",
      },
    ];
    return providers.map((item) => ({
      ...item,
      available: AVAILABLE.has(item.provider),
      webhook: item.provider === "whatsapp" || item.provider === "finnhub",
    }));
  }

  async startGmailOAuth(): Promise<StartGmailOAuthResponse> {
    const config = this.requireGoogleConfig();
    this.prunePendingGmailOAuth();
    const state = newGmailOAuthState();
    const now = Date.now();
    this.pendingGmailOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      familyMemberId: await this.activeSeatId(),
    });
    return buildGmailAuthUrl(config, state);
  }

  async startGithubOAuth(): Promise<StartGmailOAuthResponse> {
    const config = this.requireGithubOAuthConfig();
    this.prunePendingGithubOAuth();
    const state = newGithubOAuthState();
    const now = Date.now();
    this.pendingGithubOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      familyMemberId: await this.activeSeatId(),
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
        familyMemberId: pending.familyMemberId,
      };
      await this.upsertOAuthConnector(record);
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
        familyMemberId: pending.familyMemberId,
      };
      await this.upsertOAuthConnector(record);
      return {
        redirectUrl: `${site}/app?view=connectors&gmail=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Gmail connect failed";
      return fail(message);
    }
  }

  async startOutlookOAuth(): Promise<StartGmailOAuthResponse> {
    const config = this.requireMicrosoftConfig();
    this.prunePendingOutlookOAuth();
    const state = newOutlookOAuthState();
    const now = Date.now();
    this.pendingOutlookOAuth.set(state, {
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      familyMemberId: await this.activeSeatId(),
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
        familyMemberId: pending.familyMemberId,
      };
      await this.upsertOAuthConnector(record);
      return {
        redirectUrl: `${site}/app?view=connectors&outlook=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Outlook connect failed";
      return fail(message);
    }
  }

  async startGenericOAuth(provider: GenericOAuthProvider): Promise<StartGmailOAuthResponse> {
    const config = this.requireGenericOAuthConfig(provider);
    this.prunePendingGenericOAuth();
    const state = newGenericOAuthState();
    const now = Date.now();
    this.pendingGenericOAuth.set(`${provider}:${state}`, {
      provider,
      state,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      familyMemberId: await this.activeSeatId(),
    });
    return buildGenericAuthUrl(provider, config, state);
  }

  async completeGenericOAuth(
    provider: GenericOAuthProvider,
    input: {
      code?: string | null;
      state?: string | null;
      error?: string | null;
      errorDescription?: string | null;
    },
  ): Promise<{ redirectUrl: string }> {
    const site = this.siteUrl.replace(/\/$/, "");
    const fail = (message: string) => ({
      redirectUrl: `${site}/app?view=connectors&${provider}=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error?.trim()) {
      return fail(input.errorDescription?.trim() || input.error.trim());
    }
    const state = input.state?.trim() ?? "";
    const code = input.code?.trim() ?? "";
    this.prunePendingGenericOAuth();
    const pending = this.pendingGenericOAuth.get(`${provider}:${state}`);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingGenericOAuth.delete(`${provider}:${state}`);
      return fail(`OAuth session expired — start Connect ${provider} again`);
    }
    this.pendingGenericOAuth.delete(`${provider}:${state}`);
    if (!code) {
      return fail(`Missing ${provider} authorization code`);
    }
    try {
      const config = this.requireGenericOAuthConfig(provider);
      const secret = await exchangeGenericAuthCode(provider, config, code);
      const now = new Date().toISOString();
      const record: ConnectorSecretRecord = {
        id: randomUUID(),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        provider,
        status: "connected",
        accountLabel: secret.accountLabel,
        scopes: secret.scopes,
        connectedAt: now,
        lastVerifiedAt: now,
        error: null,
        secret: JSON.stringify(secret),
        familyMemberId: pending.familyMemberId,
      };
      await this.upsertOAuthConnector(record);
      return {
        redirectUrl: `${site}/app?view=connectors&${provider}=connected`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `${provider} connect failed`;
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
    if (isGenericOAuthProvider(provider) && this.genericOAuth[provider]?.clientId) {
      throw new ValidationError(
        `Use ${provider} OAuth to connect ${provider} (Connect ${provider} button)`,
      );
    }
    if (!AVAILABLE.has(provider)) {
      throw new ValidationError(`Connector ${provider} is not available yet`);
    }

    const verified = await this.verifyProvider(provider, input);
    const now = new Date().toISOString();
    const seatId = await this.seatForNewConnector(
      await this.activeSeatId(),
      input.label?.trim() || verified.login,
    );
    const existing = (await this.persistence.connectors.list()).find((item) => {
      if (item.provider !== provider) return false;
      if (seatId) return item.familyMemberId === seatId;
      return !item.familyMemberId;
    });
    const record: ConnectorSecretRecord = {
      id: existing?.id ?? randomUUID(),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      provider,
      status: "connected",
      accountLabel: input.label?.trim() || verified.login,
      scopes: verified.scopes,
      connectedAt: existing?.connectedAt ?? now,
      lastVerifiedAt: now,
      error: null,
      secret: verified.secret,
      familyMemberId: seatId,
    };
    await this.saveConnector(record, existing ? "update" : "create");
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
      case "linear": {
        const oauth = parseGenericOAuthSecret("linear", existing.secret);
        const token = oauth ? `Bearer ${oauth.accessToken}` : existing.secret;
        return listLinearTeams(token);
      }
      case "slack":
        return listSlackChannels(genericAccessTokenFromSecret("slack", existing.secret));
      case "notion":
        return listNotionPages(genericAccessTokenFromSecret("notion", existing.secret), query);
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
      case "whatsapp": {
        const secret = parseWhatsAppSecret(existing.secret);
        if (!secret) throw new ValidationError("Invalid WhatsApp connector secret");
        return [
          {
            id: secret.phoneNumberId,
            name: secret.displayPhoneNumber || secret.verifiedName || "WhatsApp Business",
            url: null,
            kind: "whatsapp_phone",
          },
          {
            id: secret.wabaId,
            name: `WABA ${secret.wabaId}`,
            url: null,
            kind: "whatsapp_waba",
          },
        ];
      }
      case "finnhub":
        return [
          {
            id: "quote",
            name: "Quotes (get_quote)",
            url: "https://finnhub.io/docs/api/quote",
            kind: "market_quote",
          },
          {
            id: "news",
            name: "Company news (get_news)",
            url: "https://finnhub.io/docs/api/company-news",
            kind: "market_news",
          },
        ];
      case "whoop":
        return [
          {
            id: "recovery",
            name: "Recovery",
            url: "https://developer.whoop.com/api#tag/Recovery",
            kind: "whoop_recovery",
          },
          {
            id: "sleep",
            name: "Sleep",
            url: "https://developer.whoop.com/api#tag/Sleep",
            kind: "whoop_sleep",
          },
          {
            id: "workout",
            name: "Workouts",
            url: "https://developer.whoop.com/api#tag/Workout",
            kind: "whoop_workout",
          },
          {
            id: "cycle",
            name: "Cycles / Strain",
            url: "https://developer.whoop.com/api#tag/Cycle",
            kind: "whoop_cycle",
          },
        ];
      case "fitbit":
        return [
          {
            id: "activity",
            name: "Activity",
            url: "https://dev.fitbit.com/build/reference/web-api/activity/",
            kind: "fitbit_activity",
          },
          {
            id: "heartrate",
            name: "Heart rate",
            url: "https://dev.fitbit.com/build/reference/web-api/heartrate-timeseries/",
            kind: "fitbit_heartrate",
          },
          {
            id: "sleep",
            name: "Sleep",
            url: "https://dev.fitbit.com/build/reference/web-api/sleep/",
            kind: "fitbit_sleep",
          },
          {
            id: "profile",
            name: "Profile",
            url: "https://dev.fitbit.com/build/reference/web-api/user/",
            kind: "fitbit_profile",
          },
        ];
      case "google_drive":
        return [
          {
            id: "files",
            name: "My Drive files",
            url: "https://developers.google.com/drive/api/guides/about-sdk",
            kind: "google_drive_files",
          },
        ];
      case "google_calendar":
        return [
          {
            id: "primary",
            name: "Primary calendar",
            url: "https://developers.google.com/calendar/api/guides/overview",
            kind: "google_calendar",
          },
        ];
      case "figma":
        return [
          {
            id: "files",
            name: "Figma files",
            url: "https://developers.figma.com/docs/rest-api/",
            kind: "figma_files",
          },
        ];
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
    const items = await this.list();
    const match = items.find((item) => item.provider === "ssh" && item.status === "connected");
    return match ?? null;
  }

  /**
   * Resolve Finnhub access: seat/workspace connector first, then platform FINNHUB_API_KEY.
   */
  async resolveFinnhubAccess(): Promise<{ apiKey: string; accountLabel: string } | null> {
    const seatId = await this.activeSeatId();
    const items = await this.persistence.connectors.list();
    const match = items.find((item) => {
      if (item.provider !== "finnhub" || item.status !== "connected") return false;
      if (seatId) return item.familyMemberId === seatId;
      return true;
    });
    const opened = match ? this.openConnector(match) : null;
    const workspaceKey = opened?.secret?.trim();
    if (workspaceKey) {
      return {
        apiKey: workspaceKey,
        accountLabel: opened?.accountLabel?.trim() || "Finnhub",
      };
    }
    const platform = this.finnhubApiKey?.trim();
    if (platform) {
      return { apiKey: platform, accountLabel: "Finnhub (platform)" };
    }
    return null;
  }

  async getFinnhubQuote(symbol: string) {
    const access = await this.resolveFinnhubAccess();
    if (!access) {
      throw new ValidationError("Finnhub is not configured — set FINNHUB_API_KEY or Connect Finnhub");
    }
    return fetchFinnhubQuote(access.apiKey, symbol);
  }

  async getFinnhubNews(symbol: string, days = 7) {
    const access = await this.resolveFinnhubAccess();
    if (!access) {
      throw new ValidationError("Finnhub is not configured — set FINNHUB_API_KEY or Connect Finnhub");
    }
    return fetchFinnhubNews(access.apiKey, symbol, days);
  }

  handleFinnhubWebhook(input: {
    secretHeader?: string | null;
    payload?: unknown;
  }): { ok: true; accepted: number } {
    verifyFinnhubWebhookSecret(this.finnhubWebhookSecret, input.secretHeader);
    const accepted = input.payload == null ? 0 : 1;
    return { ok: true, accepted };
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
    const fingerprint = emailSendFingerprint(connector.id, body);
    const cached = RECENT_EMAIL_SENDS.get(fingerprint);
    const now = Date.now();
    if (cached && now - cached.at < EMAIL_SEND_DEDUP_MS) {
      return cached.response;
    }
    // Drop stale entries occasionally.
    if (RECENT_EMAIL_SENDS.size > 200) {
      for (const [key, value] of RECENT_EMAIL_SENDS) {
        if (now - value.at >= EMAIL_SEND_DEDUP_MS) RECENT_EMAIL_SENDS.delete(key);
      }
    }

    let response: SendEmailResponse;
    if (connector.provider === "gmail") {
      const secret = parseGmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Gmail connector secret");
      response = await sendGmailMessage(this.requireGoogleConfig(), secret, body);
    } else if (connector.provider === "outlook") {
      const secret = parseOutlookSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid Outlook connector secret");
      response = await sendOutlookMessage(this.requireMicrosoftConfig(), secret, body);
    } else {
      const secret = parseEmailSecret(connector.secret);
      if (!secret) throw new ValidationError("Invalid email connector secret");
      response = await sendEmailMessage(secret, body);
    }
    RECENT_EMAIL_SENDS.set(fingerprint, { at: now, response });
    return response;
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

  async sendWhatsApp(id: string, body: SendWhatsAppRequest): Promise<SendWhatsAppResponse> {
    const connector = await this.loadConnector(id);
    if (!connector) throw new NotFoundError("Connector", id);
    if (connector.provider !== "whatsapp") {
      throw new ValidationError("Connector is not WhatsApp");
    }
    const secret = parseWhatsAppSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid WhatsApp connector secret");
    return sendWhatsAppText(secret, body);
  }

  async listWhatsAppMessages(
    id: string,
    limit = 40,
  ): Promise<ListWhatsAppMessagesResponse> {
    const connector = await this.loadConnector(id);
    if (!connector) throw new NotFoundError("Connector", id);
    if (connector.provider !== "whatsapp") {
      throw new ValidationError("Connector is not WhatsApp");
    }
    const secret = parseWhatsAppSecret(connector.secret);
    if (!secret) throw new ValidationError("Invalid WhatsApp connector secret");
    const items = this.whatsappInbound.get(secret.phoneNumberId) ?? [];
    const capped = Math.max(1, Math.min(100, limit));
    return { items: items.slice(0, capped) };
  }

  verifyWhatsAppWebhookChallenge(query: {
    "hub.mode"?: string;
    "hub.verify_token"?: string;
    "hub.challenge"?: string;
  }): string {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];
    const expected = this.whatsappWebhookVerifyToken?.trim();
    if (!expected) {
      throw new ValidationError("WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured on the API");
    }
    if (mode !== "subscribe" || token !== expected || !challenge) {
      throw new ValidationError("WhatsApp webhook verification failed");
    }
    return challenge;
  }

  async handleWhatsAppWebhook(input: {
    rawBody: string;
    signatureHeader: string | undefined;
    payload: unknown;
  }): Promise<{ ok: true; accepted: number }> {
    const appSecret = this.whatsappAppSecret?.trim();
    if (appSecret) {
      const ok = verifyWhatsAppWebhookSignature(input.rawBody, input.signatureHeader, appSecret);
      if (!ok) {
        throw new ValidationError("Invalid WhatsApp webhook signature");
      }
    }

    const phoneIds = new Set(
      extractWhatsAppInbound(input.payload)
        .map((item) => item.phoneNumberId)
        .filter(Boolean),
    );
    const connectors = await this.persistence.connectors.list();
    const byPhone = new Map<string, string>();
    for (const record of connectors) {
      if (record.provider !== "whatsapp") continue;
      const opened = this.openConnector(record);
      const secret = parseWhatsAppSecret(opened.secret);
      if (secret?.phoneNumberId) {
        byPhone.set(secret.phoneNumberId, record.id);
      }
    }

    let accepted = 0;
    for (const phoneNumberId of phoneIds.size ? phoneIds : [""]) {
      const connectorId = phoneNumberId ? byPhone.get(phoneNumberId) ?? null : null;
      const inbound = extractWhatsAppInbound(input.payload, connectorId);
      for (const message of inbound) {
        const key = message.phoneNumberId || phoneNumberId;
        if (!key) continue;
        const list = this.whatsappInbound.get(key) ?? [];
        if (list.some((item) => item.id === message.id)) continue;
        list.unshift(message);
        this.whatsappInbound.set(key, list.slice(0, WHATSAPP_INBOUND_MAX));
        accepted += 1;
      }
    }
    return { ok: true, accepted };
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

  private requireGenericOAuthConfig(provider: GenericOAuthProvider): GenericOAuthConfig {
    const config = this.genericOAuth[provider];
    const clientId = config?.clientId?.trim() ?? "";
    const clientSecret = config?.clientSecret?.trim() ?? "";
    const redirectUri = config?.redirectUri?.trim() ?? "";
    if (!clientId || !clientSecret || !redirectUri) {
      const envPrefix = provider.toUpperCase();
      throw new ValidationError(
        `${provider} OAuth is not configured. Set ${envPrefix}_CLIENT_ID and ${envPrefix}_CLIENT_SECRET on the API.`,
      );
    }
    return { clientId, clientSecret, redirectUri };
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

  private prunePendingGenericOAuth(): void {
    const now = Date.now();
    for (const [key, pending] of this.pendingGenericOAuth) {
      if (pending.expiresAt < now) {
        this.pendingGenericOAuth.delete(key);
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

    if (provider === "whatsapp") {
      const secret = buildWhatsAppSecret({
        accessToken: token,
        phoneNumberId: config.phone_number_id || config.phoneNumberId || "",
        wabaId: config.waba_id || config.wabaId || "",
      });
      const verified = await verifyWhatsAppSecret(secret);
      return {
        login: input.label?.trim() || verified.label,
        scopes: verified.scopes,
        secret: JSON.stringify(verified.secret),
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
      case "finnhub": {
        const verified = await verifyFinnhubApiKey(token);
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
    if (provider === "whatsapp") {
      const secret = parseWhatsAppSecret(existing.secret);
      if (!secret) throw new ValidationError("Invalid WhatsApp connector secret");
      const verified = await verifyWhatsAppSecret(secret);
      return {
        login: verified.label,
        scopes: verified.scopes,
        secret: JSON.stringify(verified.secret),
      };
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
      const oauth = parseGenericOAuthSecret("gitlab", existing.secret);
      if (oauth) {
        const verified = await verifyGitlabOAuth(oauth.accessToken);
        return {
          login: verified.login,
          scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
          secret: existing.secret,
        };
      }
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
      const oauth = parseGenericOAuthSecret("bitbucket", existing.secret);
      if (oauth) {
        const verified = await verifyBitbucketOAuth(oauth.accessToken);
        return {
          login: verified.login,
          scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
          secret: existing.secret,
        };
      }
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
      const oauth = parseGenericOAuthSecret("linear", existing.secret);
      const token = oauth ? `Bearer ${oauth.accessToken}` : existing.secret;
      const verified = await verifyLinear(token);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "slack") {
      const token = genericAccessTokenFromSecret("slack", existing.secret);
      const verified = await verifySlack(token);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "notion") {
      const token = genericAccessTokenFromSecret("notion", existing.secret);
      const verified = await verifyNotion(token);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "finnhub") {
      const verified = await verifyFinnhubApiKey(existing.secret);
      return { login: verified.login, scopes: verified.scopes, secret: existing.secret };
    }
    if (provider === "whoop") {
      const oauth = parseGenericOAuthSecret("whoop", existing.secret);
      if (!oauth) throw new ValidationError("Invalid WHOOP connector secret");
      const verified = await verifyWhoopOAuth(oauth.accessToken);
      return {
        login: verified.login,
        scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
        secret: existing.secret,
      };
    }
    if (provider === "fitbit") {
      const oauth = parseGenericOAuthSecret("fitbit", existing.secret);
      if (!oauth) throw new ValidationError("Invalid Fitbit connector secret");
      const verified = await verifyFitbitOAuth(oauth.accessToken);
      return {
        login: verified.login,
        scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
        secret: existing.secret,
      };
    }
    if (provider === "google_drive" || provider === "google_calendar") {
      const oauth = parseGenericOAuthSecret(provider, existing.secret);
      if (!oauth) throw new ValidationError(`Invalid ${provider} connector secret`);
      const verified = await verifyGoogleUserinfo(oauth.accessToken, provider);
      return {
        login: verified.login,
        scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
        secret: existing.secret,
      };
    }
    if (provider === "figma") {
      const oauth = parseGenericOAuthSecret("figma", existing.secret);
      if (!oauth) throw new ValidationError("Invalid Figma connector secret");
      const verified = await verifyFigmaOAuth(oauth.accessToken);
      return {
        login: verified.login,
        scopes: oauth.scopes.length ? oauth.scopes : verified.scopes,
        secret: existing.secret,
      };
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
    familyMemberId: connector.familyMemberId ?? null,
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

async function verifyGitlabOAuth(accessToken: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://gitlab.com/api/v4/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("GitLab rejected this OAuth token.");
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

async function verifyBitbucketOAuth(
  accessToken: string,
): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.bitbucket.org/2.0/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Bitbucket rejected this OAuth token.");
  }
  const payload = (await response.json()) as { username?: string; display_name?: string };
  return {
    login: payload.username || payload.display_name || "bitbucket-user",
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

async function verifyWhoopOAuth(accessToken: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.prod.whoop.com/developer/v1/user/profile/basic", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("WHOOP rejected this OAuth token.");
  }
  const payload = (await response.json()) as {
    user_id?: number;
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  const name = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim();
  return {
    login: payload.email || name || (payload.user_id ? `WHOOP ${payload.user_id}` : "whoop-user"),
    scopes: [
      "read:recovery",
      "read:cycles",
      "read:workout",
      "read:sleep",
      "read:profile",
      "read:body_measurement",
      "offline",
    ],
  };
}

async function verifyFitbitOAuth(accessToken: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.fitbit.com/1/user/-/profile.json", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Fitbit rejected this OAuth token.");
  }
  const payload = (await response.json()) as {
    user?: { displayName?: string; fullName?: string; encodedId?: string };
  };
  return {
    login:
      payload.user?.displayName ||
      payload.user?.fullName ||
      (payload.user?.encodedId ? `Fitbit ${payload.user.encodedId}` : "fitbit-user"),
    scopes: [
      "activity",
      "heartrate",
      "sleep",
      "profile",
      "weight",
      "nutrition",
      "oxygen_saturation",
      "respiratory_rate",
      "temperature",
    ],
  };
}

async function verifyGoogleUserinfo(
  accessToken: string,
  provider: "google_drive" | "google_calendar",
): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Google rejected this OAuth token.");
  }
  const payload = (await response.json()) as { email?: string; name?: string };
  return {
    login: payload.email || payload.name || provider,
    scopes:
      provider === "google_drive"
        ? [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
          ]
        : [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.events",
          ],
  };
}

async function verifyFigmaOAuth(accessToken: string): Promise<{ login: string; scopes: string[] }> {
  const response = await fetch("https://api.figma.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Figma rejected this OAuth token.");
  }
  const payload = (await response.json()) as { email?: string; handle?: string; id?: string };
  return {
    login: payload.email || payload.handle || (payload.id ? `Figma ${payload.id}` : "figma-user"),
    scopes: [
      "current_user:read",
      "file_content:read",
      "file_metadata:read",
      "file_comments:read",
    ],
  };
}

async function listGitlabProjects(secret: string, query?: string): Promise<ConnectorResource[]> {
  const oauth = parseGenericOAuthSecret("gitlab", secret);
  const parsed = oauth ? null : parseJsonSecret(secret);
  const token = oauth?.accessToken || parsed?.token || secret;
  const baseUrl = (parsed?.baseUrl || "https://gitlab.com").replace(/\/$/, "");
  const q = query?.trim() ? `&search=${encodeURIComponent(query.trim())}` : "";
  const headers: Record<string, string> = { "User-Agent": "Arrab-Studio" };
  if (oauth) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers["PRIVATE-TOKEN"] = token;
  }
  const response = await fetch(
    `${baseUrl}/api/v4/projects?membership=true&simple=true&per_page=50${q}`,
    { headers },
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
  const oauth = parseGenericOAuthSecret("bitbucket", secret);
  const parsed = oauth ? null : parseJsonSecret(secret);
  const headers: Record<string, string> = { "User-Agent": "Arrab-Studio" };
  if (oauth) {
    headers.Authorization = `Bearer ${oauth.accessToken}`;
  } else {
    const username = parsed?.username || "";
    const token = parsed?.token || secret;
    headers.Authorization = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  }
  const response = await fetch("https://api.bitbucket.org/2.0/repositories?role=member&pagelen=50", {
    headers,
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
