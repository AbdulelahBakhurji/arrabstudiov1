import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  QuotaExceededError,
  UnauthorizedError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  LOCAL_UNCONNECTED_TOKEN_LIMIT,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_REDEEM_CODES,
  brandId,
  type AccountEntitlements,
  type AccountPublic,
  type AccountStatusResponse,
  type ActivateSubscriptionRequest,
  type ConnectAccountRequest,
  type ConnectAccountResponse,
  type SignInAccountRequest,
  type StudioAccountRecord,
  type SubscriptionPlanId,
  type UpdateAccountProfileRequest,
  type StartWebAuthResponse,
  type PollWebAuthResponse,
  type CompleteWebAuthRequest,
} from "@arrab/shared";

type PendingWebAuth = {
  state: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "completed" | "expired";
  result?: ConnectAccountResponse;
};

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(expected, derived);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function billingPeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublic(account: StudioAccountRecord): AccountPublic {
  const plan = SUBSCRIPTION_PLANS[account.planId];
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    planId: account.planId,
    planName: plan.name,
    subscriptionStatus: account.subscriptionStatus,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    connectedAt: account.connectedAt,
  };
}

export class AccountService {
  private readonly pendingWebAuth = new Map<string, PendingWebAuth>();

  constructor(
    private readonly persistence: Persistence,
    private readonly publicBaseUrl = "http://127.0.0.1:8787",
    private readonly authWebUrl: string | undefined = undefined,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async periodTokensUsed(periodStart: string, periodEnd: string): Promise<number> {
    const events = await this.persistence.usage.listAll();
    let total = 0;
    for (const event of events) {
      if (event.createdAt >= periodStart && event.createdAt < periodEnd) {
        total += event.inputTokens + event.outputTokens;
      }
    }
    return total;
  }

  private async ensurePeriod(account: StudioAccountRecord): Promise<StudioAccountRecord> {
    const now = this.clock.isoNow();
    if (now < account.periodEnd) {
      return account;
    }
    const period = billingPeriod(new Date(now));
    const next: StudioAccountRecord = {
      ...account,
      periodStart: period.start,
      periodEnd: period.end,
      updatedAt: now,
    };
    await this.persistence.accounts.upsert(next);
    return next;
  }

  async buildEntitlements(account: StudioAccountRecord | null): Promise<AccountEntitlements> {
    if (!account) {
      const period = billingPeriod(new Date(this.clock.isoNow()));
      const tokensUsed = await this.periodTokensUsed(period.start, period.end);
      const tokenLimit = LOCAL_UNCONNECTED_TOKEN_LIMIT;
      return {
        connected: false,
        planId: null,
        planName: "Local (not connected)",
        subscriptionStatus: null,
        tokenLimit,
        tokensUsed,
        tokensRemaining: Math.max(0, tokenLimit - tokensUsed),
        overLimit: tokensUsed >= tokenLimit,
        periodStart: period.start,
        periodEnd: period.end,
      };
    }

    const current = await this.ensurePeriod(account);
    const plan = SUBSCRIPTION_PLANS[current.planId];
    const tokensUsed = await this.periodTokensUsed(current.periodStart, current.periodEnd);
    const tokenLimit = plan.monthlyTokenLimit;
    const overLimit = tokenLimit !== null && tokensUsed >= tokenLimit;
    return {
      connected: true,
      planId: current.planId,
      planName: plan.name,
      subscriptionStatus: current.subscriptionStatus,
      tokenLimit,
      tokensUsed,
      tokensRemaining: tokenLimit === null ? null : Math.max(0, tokenLimit - tokensUsed),
      overLimit,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
    };
  }

  async status(): Promise<AccountStatusResponse> {
    const account = await this.persistence.accounts.get();
    const entitlements = await this.buildEntitlements(account);
    return {
      connected: Boolean(account),
      account: account ? toPublic(account) : null,
      entitlements,
      plans: Object.values(SUBSCRIPTION_PLANS),
    };
  }

  async assertWithinQuota(): Promise<AccountEntitlements> {
    const account = await this.persistence.accounts.get();
    const entitlements = await this.buildEntitlements(account);
    if (entitlements.overLimit) {
      const limitLabel =
        entitlements.tokenLimit === null ? "unlimited" : entitlements.tokenLimit.toLocaleString();
      throw new QuotaExceededError(
        entitlements.connected
          ? `Token limit reached for ${entitlements.planName} (${entitlements.tokensUsed.toLocaleString()} / ${limitLabel}). Upgrade with a subscription code in Settings → Account.`
          : `Local token allowance reached (${entitlements.tokensUsed.toLocaleString()} / ${limitLabel}). Connect an Arrab account in Settings → Account to continue.`,
      );
    }
    return entitlements;
  }

  private validateCredentials(email: string, password: string): string {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new ValidationError("Enter a valid email address");
    }
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    return normalized;
  }

  async connect(input: ConnectAccountRequest): Promise<ConnectAccountResponse> {
    const email = this.validateCredentials(input.email ?? "", input.password ?? "");
    const existing = await this.persistence.accounts.get();
    if (existing) {
      throw new ValidationError("An account is already connected. Sign out first.");
    }

    const now = this.clock.isoNow();
    const period = billingPeriod(new Date(now));
    const sessionToken = randomBytes(32).toString("hex");
    const displayName = input.displayName?.trim() || email.split("@")[0] || "Arrab operator";
    const account: StudioAccountRecord = {
      id: brandId(this.ids.next("acc")),
      workspaceId: this.persistence.workspaceId,
      email,
      displayName,
      passwordHash: hashPassword(input.password),
      planId: "free",
      subscriptionStatus: "active",
      periodStart: period.start,
      periodEnd: period.end,
      sessionTokenHash: hashSessionToken(sessionToken),
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.accounts.upsert(account);

    const operator = await this.persistence.operator.get();
    if (operator) {
      await this.persistence.operator.upsert({
        ...operator,
        displayName,
        updatedAt: now,
      });
    } else {
      await this.persistence.operator.upsert({
        workspaceId: this.persistence.workspaceId,
        displayName,
        title: null,
        seats: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      account: toPublic(account),
      entitlements: await this.buildEntitlements(account),
      sessionToken,
    };
  }

  async signIn(input: SignInAccountRequest): Promise<ConnectAccountResponse> {
    const email = this.validateCredentials(input.email ?? "", input.password ?? "");
    const account = await this.persistence.accounts.get();
    if (!account || account.email !== email || !verifyPassword(input.password, account.passwordHash)) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const now = this.clock.isoNow();
    const sessionToken = randomBytes(32).toString("hex");
    const updated = await this.ensurePeriod({
      ...account,
      sessionTokenHash: hashSessionToken(sessionToken),
      connectedAt: now,
      updatedAt: now,
    });
    await this.persistence.accounts.upsert(updated);

    return {
      account: toPublic(updated),
      entitlements: await this.buildEntitlements(updated),
      sessionToken,
    };
  }

  async requireConnectedAccount(): Promise<StudioAccountRecord> {
    const account = await this.persistence.accounts.get();
    if (!account) {
      throw new UnauthorizedError("Sign in with email and password first");
    }
    return this.ensurePeriod(account);
  }

  async verifySession(token: string): Promise<AccountStatusResponse> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new UnauthorizedError("Sign in with email and password");
    }
    const account = await this.persistence.accounts.get();
    if (!account?.sessionTokenHash || account.sessionTokenHash !== hashSessionToken(trimmed)) {
      throw new UnauthorizedError("Session expired. Sign in with email and password");
    }
    return this.status();
  }

  async applyPlan(planId: SubscriptionPlanId): Promise<AccountStatusResponse> {
    const account = await this.requireConnectedAccount();
    const now = this.clock.isoNow();
    const period = billingPeriod(new Date(now));
    const updated: StudioAccountRecord = {
      ...account,
      planId,
      subscriptionStatus: "active",
      periodStart: period.start,
      periodEnd: period.end,
      updatedAt: now,
    };
    await this.persistence.accounts.upsert(updated);
    return this.status();
  }

  async disconnect(): Promise<AccountStatusResponse> {
    await this.persistence.accounts.delete();
    return this.status();
  }

  /** Alias used by desktop signed-in UX. */
  async logout(): Promise<AccountStatusResponse> {
    return this.disconnect();
  }

  private prunePendingAuth(nowIso: string): void {
    for (const [state, pending] of this.pendingWebAuth) {
      if (pending.expiresAt <= nowIso && pending.status === "pending") {
        pending.status = "expired";
      }
      if (pending.status === "expired" || pending.status === "completed") {
        const ageMs = Date.parse(nowIso) - Date.parse(pending.createdAt);
        if (ageMs > 30 * 60_000) {
          this.pendingWebAuth.delete(state);
        }
      }
    }
  }

  startWebAuth(): StartWebAuthResponse {
    const now = this.clock.isoNow();
    this.prunePendingAuth(now);
    const state = randomBytes(18).toString("hex");
    const expiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    this.pendingWebAuth.set(state, {
      state,
      createdAt: now,
      expiresAt,
      status: "pending",
    });

    const builtIn = `${this.publicBaseUrl}/v1/account/auth/web?state=${encodeURIComponent(state)}`;
    const authorizationUrl = this.authWebUrl
      ? this.authWebUrl.replaceAll("{state}", encodeURIComponent(state)).replaceAll("{callback}", encodeURIComponent(`${this.publicBaseUrl}/v1/account/auth/web/complete`))
      : builtIn;

    return {
      state,
      authorizationUrl,
      expiresAt,
      pollIntervalMs: 1500,
    };
  }

  async pollWebAuth(state: string): Promise<PollWebAuthResponse> {
    const now = this.clock.isoNow();
    this.prunePendingAuth(now);
    const pending = this.pendingWebAuth.get(state.trim());
    if (!pending) {
      return { status: "expired", message: "Sign-in session not found or expired" };
    }
    if (pending.expiresAt <= now && pending.status === "pending") {
      pending.status = "expired";
    }
    if (pending.status === "expired") {
      return { status: "expired", message: "Sign-in session expired. Start again." };
    }
    if (pending.status === "completed" && pending.result) {
      return {
        status: "completed",
        account: pending.result.account,
        entitlements: pending.result.entitlements,
        sessionToken: pending.result.sessionToken,
      };
    }
    return { status: "pending" };
  }

  async completeWebAuth(input: CompleteWebAuthRequest): Promise<ConnectAccountResponse> {
    const now = this.clock.isoNow();
    this.prunePendingAuth(now);
    const state = input.state?.trim() ?? "";
    const pending = this.pendingWebAuth.get(state);
    if (!pending || pending.status === "expired" || pending.expiresAt <= now) {
      throw new ValidationError("Sign-in session expired. Start again from Arrab Studio.");
    }
    if (pending.status === "completed" && pending.result) {
      return pending.result;
    }

    const email = this.validateCredentials(input.email ?? "", input.password ?? "");
    const displayName = input.displayName?.trim() || email.split("@")[0] || "Arrab operator";
    const period = billingPeriod(new Date(now));
    const sessionToken = randomBytes(32).toString("hex");

    let planId: SubscriptionPlanId = "free";
    if (input.planCode?.trim()) {
      const mapped = SUBSCRIPTION_REDEEM_CODES[input.planCode.trim().toUpperCase()];
      if (!mapped) {
        throw new ValidationError("Unknown plan code");
      }
      planId = mapped;
    }

    const existing = await this.persistence.accounts.get();
    let account: StudioAccountRecord;
    if (existing && existing.email === email) {
      if (!verifyPassword(input.password, existing.passwordHash)) {
        throw new UnauthorizedError("Invalid email or password");
      }
      account = {
        ...existing,
        displayName: displayName || existing.displayName,
        planId: existing.planId === "free" ? planId : existing.planId,
        subscriptionStatus: "active",
        sessionTokenHash: hashSessionToken(sessionToken),
        connectedAt: now,
        updatedAt: now,
      };
    } else if (existing) {
      throw new ValidationError(
        "Another account is already connected on this studio. Sign in with that email and password.",
      );
    } else {
      account = {
        id: brandId(this.ids.next("acc")),
        workspaceId: this.persistence.workspaceId,
        email,
        displayName,
        passwordHash: hashPassword(input.password),
        planId,
        subscriptionStatus: "active",
        periodStart: period.start,
        periodEnd: period.end,
        sessionTokenHash: hashSessionToken(sessionToken),
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    }

    await this.persistence.accounts.upsert(account);
    const operator = await this.persistence.operator.get();
    if (operator) {
      await this.persistence.operator.upsert({
        ...operator,
        displayName,
        updatedAt: now,
      });
    } else {
      await this.persistence.operator.upsert({
        workspaceId: this.persistence.workspaceId,
        displayName,
        title: null,
        seats: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    const result: ConnectAccountResponse = {
      account: toPublic(account),
      entitlements: await this.buildEntitlements(account),
      sessionToken,
    };
    pending.status = "completed";
    pending.result = result;
    this.pendingWebAuth.set(state, pending);
    return result;
  }

  async activateSubscription(input: ActivateSubscriptionRequest): Promise<AccountStatusResponse> {
    const code = input.code?.trim().toUpperCase() ?? "";
    const planId = SUBSCRIPTION_REDEEM_CODES[code] as SubscriptionPlanId | undefined;
    if (!planId) {
      throw new ValidationError(
        "Unknown subscription code. Use FREE-ARRAB, PRO-ARRAB, TEAM-ARRAB, or UNLIMITED-ARRAB.",
      );
    }
    return this.applyPlan(planId);
  }

  async updateProfile(input: UpdateAccountProfileRequest): Promise<AccountStatusResponse> {
    const account = await this.persistence.accounts.get();
    if (!account) {
      throw new ValidationError("No account connected");
    }
    const displayName = input.displayName?.trim();
    if (!displayName) {
      throw new ValidationError("Display name is required");
    }
    const now = this.clock.isoNow();
    await this.persistence.accounts.upsert({
      ...account,
      displayName,
      updatedAt: now,
    });
    const operator = await this.persistence.operator.get();
    if (operator) {
      await this.persistence.operator.upsert({
        ...operator,
        displayName,
        updatedAt: now,
      });
    }
    return this.status();
  }
}
