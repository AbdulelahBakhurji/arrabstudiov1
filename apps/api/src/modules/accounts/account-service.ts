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
  type TokenTopUpPack,
  type TokenUsageLevel,
  type UpdateAccountProfileRequest,
  type StartWebAuthResponse,
  type PollWebAuthResponse,
  type CompleteWebAuthRequest,
} from "@arrab/shared";

type PendingWebAuth = {
  state: string;
  pollSecret: string;
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

function activeTopUpTokens(account: StudioAccountRecord): number {
  return (account.tokenTopUps ?? [])
    .filter((entry) => entry.periodEnd === account.periodEnd)
    .reduce((sum, entry) => sum + Math.max(0, entry.tokens), 0);
}

function usageLevel(used: number, limit: number): TokenUsageLevel {
  if (limit <= 0 || used >= limit) return "exhausted";
  const ratio = used / limit;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.8) return "low";
  return "ok";
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

    // Every plan (including Free / Family Free): billing day freezes AI until payment.
    if (account.subscriptionStatus === "past_due") {
      return account;
    }
    const pastDue: StudioAccountRecord = {
      ...account,
      subscriptionStatus: "past_due",
      updatedAt: now,
    };
    await this.persistence.accounts.upsert(pastDue);
    return pastDue;
  }

  async buildEntitlements(account: StudioAccountRecord | null): Promise<AccountEntitlements> {
    if (!account) {
      const period = billingPeriod(new Date(this.clock.isoNow()));
      // Local / not signed in — cloud quota does not apply; local models are free on-device.
      return {
        connected: false,
        planId: null,
        planName: "Local (not connected)",
        subscriptionStatus: null,
        tokenLimit: null,
        tokensUsed: 0,
        tokensRemaining: null,
        overLimit: false,
        pauseMode: null,
        periodStart: period.start,
        periodEnd: period.end,
        planTokenLimit: null,
        topUpTokens: 0,
        deepseekCreditHalalas: 0,
        otherCreditHalalas: 0,
        usageLevel: "ok",
        canTopUp: false,
      };
    }

    const current = await this.ensurePeriod(account);
    const plan = SUBSCRIPTION_PLANS[current.planId];
    const tokensUsed = await this.periodTokensUsed(current.periodStart, current.periodEnd);
    const planTokenLimit = plan.monthlyTokenLimit;
    const topUpTokens = activeTopUpTokens(current);
    const tokenLimit = planTokenLimit + topUpTokens;
    const tokensRemaining = Math.max(0, tokenLimit - tokensUsed);
    const overLimit = tokensUsed >= tokenLimit;
    const freeTier = current.planId === "free" || current.planId === "family_free";
    const paymentDue =
      current.subscriptionStatus === "past_due" ||
      current.subscriptionStatus === "canceled" ||
      this.clock.isoNow() >= current.periodEnd;

    if (paymentDue) {
      return {
        connected: true,
        planId: current.planId,
        planName: plan.name,
        subscriptionStatus: current.subscriptionStatus === "canceled" ? "canceled" : "past_due",
        tokenLimit,
        tokensUsed,
        tokensRemaining,
        overLimit: true,
        pauseMode: "payment_required",
        periodStart: current.periodStart,
        periodEnd: current.periodEnd,
        planTokenLimit,
        topUpTokens,
        deepseekCreditHalalas: current.modelCredit?.deepseekHalalas ?? 0,
        otherCreditHalalas: current.modelCredit?.otherHalalas ?? 0,
        usageLevel: "exhausted",
        canTopUp: false,
      };
    }

    // Every plan pauses when its pool (plan + usage packs) is used up. Free can only
    // upgrade or add usage; paid plans can also wait for the monthly reset.
    const pauseMode = !overLimit ? null : freeTier ? "upgrade_required" : "upgrade_or_wait";
    return {
      connected: true,
      planId: current.planId,
      planName: plan.name,
      subscriptionStatus: freeTier ? "trialing" : current.subscriptionStatus,
      tokenLimit,
      tokensUsed,
      tokensRemaining,
      overLimit,
      pauseMode,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      planTokenLimit,
      topUpTokens,
      deepseekCreditHalalas: current.modelCredit?.deepseekHalalas ?? 0,
      otherCreditHalalas: current.modelCredit?.otherHalalas ?? 0,
      usageLevel: usageLevel(tokensUsed, tokenLimit),
      canTopUp: true,
    };
  }

  /** Adds a paid usage pack to the current period. Applying the same invoice twice is a no-op. */
  async addTopUp(pack: TokenTopUpPack, invoiceId: string): Promise<AccountStatusResponse> {
    const account = await this.ensurePeriod(await this.requireConnectedAccount());
    const existing = account.tokenTopUps ?? [];
    if (existing.some((entry) => entry.invoiceId === invoiceId)) {
      return this.status();
    }
    const now = this.clock.isoNow();
    const updated: StudioAccountRecord = {
      ...account,
      tokenTopUps: [
        // Packs from earlier periods no longer count; keep a short history only.
        ...existing.filter((entry) => entry.periodEnd === account.periodEnd).slice(-49),
        {
          invoiceId,
          packId: pack.id,
          tokens: pack.tokens,
          purchasedAt: now,
          periodEnd: account.periodEnd,
        },
      ],
      updatedAt: now,
    };
    await this.persistence.accounts.upsert(updated);
    return this.status();
  }

  /** Adds custom credit: 10% DeepSeek, 60% other models. The same invoice is applied once. */
  async addModelCredit(
    quote: { deepseekHalalas: number; otherHalalas: number },
    invoiceId: string,
  ): Promise<AccountStatusResponse> {
    const account = await this.ensurePeriod(await this.requireConnectedAccount());
    const current = account.modelCredit ?? { deepseekHalalas: 0, otherHalalas: 0, appliedInvoiceIds: [] };
    const applied = current.appliedInvoiceIds ?? [];
    if (applied.includes(invoiceId)) {
      return this.status();
    }
    const now = this.clock.isoNow();
    await this.persistence.accounts.upsert({
      ...account,
      modelCredit: {
        deepseekHalalas: current.deepseekHalalas + quote.deepseekHalalas,
        otherHalalas: current.otherHalalas + quote.otherHalalas,
        appliedInvoiceIds: [...applied, invoiceId].slice(-50),
      },
      updatedAt: now,
    });
    return this.status();
  }

  async statusFor(account: StudioAccountRecord | null): Promise<AccountStatusResponse> {
    const entitlements = await this.buildEntitlements(account);
    return {
      connected: Boolean(account),
      account: account ? toPublic(account) : null,
      entitlements,
      plans: Object.values(SUBSCRIPTION_PLANS),
    };
  }

  async status(): Promise<AccountStatusResponse> {
    return this.statusFor(await this.persistence.accounts.get());
  }

  async assertWithinQuota(): Promise<AccountEntitlements> {
    const account = await this.persistence.accounts.get();
    const entitlements = await this.buildEntitlements(account);

    if (entitlements.pauseMode === "payment_required") {
      const due = new Date(entitlements.periodEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      throw new QuotaExceededError(
        `Paused — ${entitlements.planName} billing was due on ${due}. Chat and AI stay stopped until this month’s payment is completed.`,
      );
    }

    if (!entitlements.overLimit) {
      return entitlements;
    }

    const used = entitlements.tokensUsed.toLocaleString();
    const limit =
      entitlements.tokenLimit === null ? "unlimited" : entitlements.tokenLimit.toLocaleString();
    const renews = new Date(entitlements.periodEnd).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    if (entitlements.pauseMode === "upgrade_or_wait") {
      throw new QuotaExceededError(
        `Paused — ${entitlements.planName} token limit reached (${used} / ${limit}). Add usage or upgrade to keep working, or wait until ${renews} when your monthly allowance resets.`,
      );
    }

    if (!entitlements.connected) {
      throw new QuotaExceededError(
        `Paused — local allowance reached (${used} / ${limit}). Connect an Arrab account and upgrade to continue.`,
      );
    }

    throw new QuotaExceededError(
      `Paused — ${entitlements.planName} token limit reached (${used} / ${limit}). Add usage or upgrade to a paid plan to continue.`,
    );
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
      accountCreated: true,
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
      accountCreated: false,
    };
  }

  async requireConnectedAccount(): Promise<StudioAccountRecord> {
    const account = await this.persistence.accounts.get();
    if (!account) {
      throw new UnauthorizedError("Sign in with email and password first");
    }
    return this.ensurePeriod(account);
  }

  /** True when a studio account exists (signed-up workspace). */
  async hasAccount(): Promise<boolean> {
    const account = await this.persistence.accounts.get();
    return Boolean(account);
  }

  /**
   * Resolve a raw session token to the studio account, or null if invalid.
   * Does not throw — used by the request auth guard.
   */
  async resolveSessionToken(token: string | null | undefined): Promise<StudioAccountRecord | null> {
    const trimmed = token?.trim() ?? "";
    if (!trimmed) return null;
    const account = await this.persistence.accounts.get();
    if (!account?.sessionTokenHash) return null;
    if (account.sessionTokenHash !== hashSessionToken(trimmed)) return null;
    return this.ensurePeriod(account);
  }

  async verifySession(token: string): Promise<AccountStatusResponse> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new UnauthorizedError("Sign in with email and password");
    }
    const account = await this.resolveSessionToken(trimmed);
    if (!account) {
      throw new UnauthorizedError("Session expired. Sign in with email and password");
    }
    return this.statusFor(account);
  }

  async applyPlan(planId: SubscriptionPlanId): Promise<AccountStatusResponse> {
    const account = await this.requireConnectedAccount();
    const now = this.clock.isoNow();
    const period = billingPeriod(new Date(now));
    const freeTier = planId === "free" || planId === "family_free";
    const updated: StudioAccountRecord = {
      ...account,
      planId,
      subscriptionStatus: freeTier ? "trialing" : "active",
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

  async logout(): Promise<AccountStatusResponse> {
    const account = await this.persistence.accounts.get();
    if (!account) {
      return this.status();
    }
    const now = this.clock.isoNow();
    // End this device session only — keep the account so the app can reconnect.
    await this.persistence.accounts.upsert({
      ...account,
      sessionTokenHash: null,
      updatedAt: now,
    });
    return this.status();
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
    const pollSecret = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    this.pendingWebAuth.set(state, {
      state,
      pollSecret,
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
      pollSecret,
      authorizationUrl,
      expiresAt,
      pollIntervalMs: 1500,
    };
  }

  async pollWebAuth(state: string, pollSecret = ""): Promise<PollWebAuthResponse> {
    const now = this.clock.isoNow();
    this.prunePendingAuth(now);
    const pending = this.pendingWebAuth.get(state.trim());
    if (!pending) {
      return { status: "expired", message: "Sign-in session not found or expired" };
    }
    const provided = Buffer.from(pollSecret.trim(), "utf8");
    const expected = Buffer.from(pending.pollSecret, "utf8");
    if (
      provided.length === 0 ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedError("Invalid poll credentials");
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
        accountCreated: pending.result.accountCreated,
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
    let accountCreated = false;
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
      accountCreated = true;
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
      accountCreated,
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
        "Unknown subscription code. Use FREE-ARRAB, PRO-ARRAB, FAMILY-FREE-ARRAB, FAMILY-ARRAB, FAMILY-PLUS-ARRAB, TEAM-ARRAB, or SCALE-ARRAB.",
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
