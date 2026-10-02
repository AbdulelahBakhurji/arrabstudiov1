import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  AppError,
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
  tokensForCredit,
  isFamilyPlanId,
  entitlementsForPlan,
  type PlanEntitlements,
  type RefreshSessionResponse,
  type ChangePasswordRequest,
  type AccountSession,
  type AccountSessionPublic,
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

/** Who is signing in — shown in the user's device list so they can recognise and revoke it. */
export interface SessionMeta {
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  /** Client supports short-lived access tokens + refresh rotation (`X-Arrab-Refresh: 1`). */
  refresh?: boolean;
}

/** Access tokens of refresh-capable clients live this long. */
const ACCESS_TTL_MS = 15 * 60_000;
/** A just-rotated refresh token shown again within this window is a race (two windows), not theft. */
const REFRESH_RACE_GRACE_MS = 20_000;

/** A session lasts this long after its last use. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;
/** `lastSeenAt` is only rewritten this often, so ordinary requests do not each cause a write. */
const SESSION_TOUCH_MS = 10 * 60_000;
const MAX_SESSIONS = 20;
const KNOWN_PLATFORMS = new Set(["macos", "windows", "linux", "ios", "android", "huawei", "web", "cli"]);

function cleanMeta(meta: SessionMeta | undefined): Required<Omit<SessionMeta, "refresh">> {
  const platform = (meta?.platform ?? "").trim().toLowerCase();
  return {
    deviceName: (meta?.deviceName ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Unknown device",
    platform: KNOWN_PLATFORMS.has(platform) ? platform : "unknown",
    appVersion: (meta?.appVersion ?? "").replace(/[^0-9A-Za-z.+-]/g, "").slice(0, 32),
  };
}

type PendingWebAuth = {
  meta?: SessionMeta;
  state: string;
  pollSecret: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "completed" | "expired";
  result?: ConnectAccountResponse;
};

// Async scrypt runs on the libuv pool: the synchronous variant blocks the whole API
// (every other user's request) for the duration of each sign-in attempt.
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

const MAX_PASSWORD_LENGTH = 256;
/** Verified against when the account/email does not match, so response time does not reveal which one failed. */
const DUMMY_PASSWORD_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<string> {
  const derived = (await scryptAsync(password, salt, 64)).toString("hex");
  return `${salt}:${derived}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }
  const derived = await scryptAsync(password, salt, 64);
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

export interface AccountServiceOptions {
  /** Allow paid-plan redeem codes (dev / internal builds only). */
  allowPlanCodes?: boolean;
  /** When non-empty, only these (lower-case) emails can create the studio account. */
  signupEmails?: readonly string[];
}

export class AccountService {
  private readonly pendingWebAuth = new Map<string, PendingWebAuth>();
  private readonly resetHooks: Array<() => Promise<unknown>> = [];

  /** Run when the account is removed or a new one is created (private data must not carry over). */
  onAccountReset(hook: () => Promise<unknown>): void {
    this.resetHooks.push(hook);
  }

  private async resetAccountScopedData(): Promise<void> {
    for (const hook of this.resetHooks) await hook();
  }

  constructor(
    private readonly persistence: Persistence,
    private readonly publicBaseUrl = "http://127.0.0.1:8787",
    private readonly authWebUrl: string | undefined = undefined,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
    private readonly options: AccountServiceOptions = {},
  ) {}

  /**
   * Redeem codes are public constants (they ship in the shared package). Unless the operator
   * explicitly enables them (dev / internal builds), a code can only select a free tier — a paid
   * plan has to be bought through Billing, never typed in.
   */
  private resolveRedeemCode(raw: string | undefined | null): SubscriptionPlanId | null {
    const code = raw?.trim().toUpperCase() ?? "";
    const planId = SUBSCRIPTION_REDEEM_CODES[code] as SubscriptionPlanId | undefined;
    if (!planId) return null;
    if (!this.options.allowPlanCodes && SUBSCRIPTION_PLANS[planId].monthlyPriceHalalas > 0) {
      throw new ValidationError("Paid plans are purchased in Billing. Choose a plan and complete checkout.");
    }
    return planId;
  }

  private assertMaySignUp(email: string): void {
    const allowed = this.options.signupEmails;
    if (allowed && allowed.length > 0 && !allowed.includes(email)) {
      throw new ValidationError("Sign-up is not open for this email address");
    }
  }

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
    quote: { deepseekHalalas: number; otherHalalas: number; amountHalalas: number },
    invoiceId: string,
  ): Promise<AccountStatusResponse> {
    const account = await this.ensurePeriod(await this.requireConnectedAccount());
    const current = account.modelCredit ?? { deepseekHalalas: 0, otherHalalas: 0, appliedInvoiceIds: [] };
    const applied = current.appliedInvoiceIds ?? [];
    if (applied.includes(invoiceId)) {
      return this.status();
    }
    const now = this.clock.isoNow();
    const existingPacks = account.tokenTopUps ?? [];
    await this.persistence.accounts.upsert({
      ...account,
      modelCredit: {
        deepseekHalalas: current.deepseekHalalas + quote.deepseekHalalas,
        otherHalalas: current.otherHalalas + quote.otherHalalas,
        appliedInvoiceIds: [...applied, invoiceId].slice(-50),
      },
      // The credit must buy something: it becomes a usage allowance for this period, like a pack.
      tokenTopUps: [
        ...existingPacks.filter((entry) => entry.periodEnd === account.periodEnd).slice(-49),
        {
          invoiceId,
          packId: "custom_credit" as const,
          tokens: tokensForCredit(quote.amountHalalas),
          purchasedAt: now,
          periodEnd: account.periodEnd,
        },
      ],
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

  /** Tokens promised to replies that are still being generated (this process). */
  private reservedTokens = 0;

  /**
   * Admit one reply. `assertWithinQuota` alone is check-then-act: twelve requests that arrive while
   * a model is thinking all see the same "tokens remaining" and all pass. Each admitted reply
   * therefore *reserves* an estimate of its cost up front and returns it when it finishes (the real
   * usage has been recorded by then), so concurrent replies can never be promised the same tokens.
   */
  async reserveTokens(estimate: number): Promise<{ granted: number; release: () => void }> {
    const entitlements = await this.assertWithinQuota();
    let granted = Math.max(1, Math.floor(estimate));
    if (entitlements.tokensRemaining !== null) {
      const free = entitlements.tokensRemaining - this.reservedTokens;
      if (free <= 0) {
        throw new AppError(
          "RATE_LIMITED",
          "Your remaining allowance is being used by other requests in progress. Try again in a moment.",
          429,
          true,
        );
      }
      granted = Math.min(granted, free);
    }
    this.reservedTokens += granted;
    let released = false;
    return {
      granted,
      release: () => {
        if (released) return;
        released = true;
        this.reservedTokens = Math.max(0, this.reservedTokens - granted);
      },
    };
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
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`);
    }
    return normalized;
  }

  /** Extra strength rules for create / change only — never block an existing sign-in (SEC-07). */
  private assertNewPassword(password: string): void {
    const lowered = password.toLowerCase();
    const common = new Set([
      "password",
      "password1",
      "password12",
      "password123",
      "12345678",
      "123456789",
      "qwerty12",
      "qwerty123",
      "letmein1",
      "welcome1",
      "arrab123",
      "arrabstudio",
    ]);
    if (common.has(lowered)) {
      throw new ValidationError("Choose a less common password");
    }
  }

  /** Add a device session. Expired sessions are dropped and the list is capped (oldest first). */
  private withNewSession(
    account: StudioAccountRecord,
    meta: SessionMeta | undefined,
    now: string,
    seatMemberId: string | null = null,
  ): { account: StudioAccountRecord; sessionToken: string; refreshToken?: string; accessExpiresAt?: string } {
    const sessionToken = randomBytes(32).toString("hex");
    const refreshToken = meta?.refresh ? randomBytes(32).toString("hex") : undefined;
    const accessExpiresAt = refreshToken ? new Date(Date.parse(now) + ACCESS_TTL_MS).toISOString() : undefined;
    const clean = cleanMeta(meta);
    const session: AccountSession = {
      id: randomBytes(9).toString("hex"),
      tokenHash: hashSessionToken(sessionToken),
      deviceName: clean.deviceName,
      platform: clean.platform,
      appVersion: clean.appVersion || null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(),
      seatMemberId,
      ...(refreshToken ? { accessExpiresAt, refreshHash: hashSessionToken(refreshToken), prevRefreshHash: null, rotatedAt: null } : {}),
    };
    // Each kind has its own cap, so a seat that signs in over and over can never push the
    // owner's devices out of the list (or the other way round).
    const live = (account.sessions ?? []).filter((item) => item.expiresAt > now);
    const sameKind = (item: AccountSession) => (item.seatMemberId ?? null) === seatMemberId;
    const kept = [...live.filter((item) => !sameKind(item)), ...live.filter(sameKind).slice(-(MAX_SESSIONS - 1)), session];
    const sessions = kept.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { account: { ...account, sessions, connectedAt: now, updatedAt: now }, sessionToken, refreshToken, accessExpiresAt };
  }

  async connect(input: ConnectAccountRequest, meta?: SessionMeta): Promise<ConnectAccountResponse> {
    const email = this.validateCredentials(input.email ?? "", input.password ?? "");
    this.assertNewPassword(input.password ?? "");
    const existing = await this.persistence.accounts.get();
    if (existing) {
      throw new ValidationError("An account is already connected. Sign out first.");
    }
    this.assertMaySignUp(email);

    // A brand-new account starts clean — never inherit a previous account's connectors or chats.
    await this.resetAccountScopedData();
    const now = this.clock.isoNow();
    const period = billingPeriod(new Date(now));
    const displayName = input.displayName?.trim() || email.split("@")[0] || "Arrab operator";
    const base: StudioAccountRecord = {
      id: brandId(this.ids.next("acc")),
      workspaceId: this.persistence.workspaceId,
      email,
      displayName,
      passwordHash: await hashPassword(input.password),
      planId: "free",
      subscriptionStatus: "active",
      periodStart: period.start,
      periodEnd: period.end,
      sessionTokenHash: null,
      sessions: [],
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const { account, sessionToken, refreshToken, accessExpiresAt } = this.withNewSession(base, meta, now);
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
      ...(refreshToken ? { refreshToken, accessExpiresAt } : {}),
      accountCreated: true,
    };
  }

  async signIn(input: SignInAccountRequest, meta?: SessionMeta): Promise<ConnectAccountResponse> {
    const email = this.validateCredentials(input.email ?? "", input.password ?? "");
    const account = await this.persistence.accounts.get();
    const matches = Boolean(account) && account!.email === email;
    // Always do the scrypt work so a wrong email and a wrong password take the same time.
    const passwordOk = await verifyPassword(input.password, matches ? account!.passwordHash : DUMMY_PASSWORD_HASH);
    if (!account || !matches || !passwordOk) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const now = this.clock.isoNow();
    // Signing in on another device adds a session; it no longer signs the first device out.
    const issued = this.withNewSession(account, meta, now);
    const sessionToken = issued.sessionToken;
    const updated = await this.ensurePeriod(issued.account);
    await this.persistence.accounts.upsert(updated);

    return {
      account: toPublic(updated),
      entitlements: await this.buildEntitlements(updated),
      sessionToken,
      ...(issued.refreshToken ? { refreshToken: issued.refreshToken, accessExpiresAt: issued.accessExpiresAt } : {}),
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

  /**
   * What the signed-in plan unlocks (feature flags, limits). `null` when no account exists yet
   * (the empty local studio). Server-side enforcement reads this — never client state.
   */
  async planEntitlements(): Promise<PlanEntitlements | null> {
    const account = await this.persistence.accounts.get();
    return account ? entitlementsForPlan(account.planId) : null;
  }

  /** True when a studio account exists (signed-up workspace). */
  async hasAccount(): Promise<boolean> {
    const account = await this.persistence.accounts.get();
    return Boolean(account);
  }

  /**
   * Resolve a raw session token to the account and the device session it belongs to, or null.
   * Does not throw — used by the request auth guard.
   */
  async resolveSession(
    token: string | null | undefined,
  ): Promise<{ account: StudioAccountRecord; sessionId: string; seatMemberId: string | null } | null> {
    const trimmed = token?.trim() ?? "";
    if (!trimmed) return null;
    const account = await this.persistence.accounts.get();
    if (!account) return null;
    const hash = hashSessionToken(trimmed);
    const now = this.clock.isoNow();

    let current = account;
    let session = (account.sessions ?? []).find((item) => item.tokenHash === hash);
    if (!session && account.sessionTokenHash && account.sessionTokenHash === hash) {
      // A session issued before device sessions existed: adopt it, with an expiry.
      const adopted: AccountSession = {
        id: randomBytes(9).toString("hex"),
        tokenHash: hash,
        deviceName: "This device",
        platform: "unknown",
        appVersion: null,
        createdAt: account.connectedAt,
        lastSeenAt: now,
        expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(),
      };
      current = {
        ...account,
        sessionTokenHash: null,
        sessions: [...(account.sessions ?? []), adopted].slice(-MAX_SESSIONS),
        updatedAt: now,
      };
      await this.persistence.accounts.upsert(current);
      session = adopted;
    }
    if (!session || session.expiresAt <= now) return null;
    // Short-lived access token of a refresh-capable client: expired means "refresh", handled by accessTokenState().
    if (session.accessExpiresAt && session.accessExpiresAt <= now) return null;
    // A seat session only means something while the plan has a household; after a downgrade it is dead.
    if (session.seatMemberId && !isFamilyPlanId(account.planId)) return null;

    if (Date.parse(now) - Date.parse(session.lastSeenAt) > SESSION_TOUCH_MS) {
      const touched: AccountSession = {
        ...session,
        lastSeenAt: now,
        expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(),
      };
      current = {
        ...current,
        sessions: (current.sessions ?? []).map((item) => (item.id === session!.id ? touched : item)),
      };
      await this.persistence.accounts.upsert(current);
      session = touched;
    }
    return {
      account: await this.ensurePeriod(current),
      sessionId: session.id,
      seatMemberId: session.seatMemberId ?? null,
    };
  }

  /**
   * Why did this token not resolve? `expired` = a real session whose short-lived access token ran out
   * (the client should refresh); `unknown` = never valid / revoked / session expired (sign in again).
   */
  async accessTokenState(token: string | null | undefined): Promise<"expired" | "unknown"> {
    const trimmed = token?.trim() ?? "";
    if (!trimmed) return "unknown";
    const account = await this.persistence.accounts.get();
    const hash = hashSessionToken(trimmed);
    const now = this.clock.isoNow();
    const session = (account?.sessions ?? []).find((item) => item.tokenHash === hash);
    return session && session.expiresAt > now && session.accessExpiresAt && session.accessExpiresAt <= now ? "expired" : "unknown";
  }

  /**
   * Exchange a refresh token for a new access + refresh pair. Every use rotates the refresh token.
   * Presenting one that was already rotated away means it leaked: the whole session is revoked.
   */
  async refreshSession(refreshToken: string): Promise<RefreshSessionResponse> {
    const presented = typeof refreshToken === "string" ? refreshToken.trim() : "";
    if (presented.length < 32 || presented.length > 256) throw new UnauthorizedError("Invalid refresh token");
    const account = await this.persistence.accounts.get();
    const hash = hashSessionToken(presented);
    const now = this.clock.isoNow();
    const sessions = account?.sessions ?? [];

    const current = sessions.find((item) => item.refreshHash === hash);
    if (!account || !current) {
      const stolen = sessions.find((item) => item.prevRefreshHash === hash);
      if (account && stolen) {
        const within = stolen.rotatedAt && Date.parse(now) - Date.parse(stolen.rotatedAt) <= REFRESH_RACE_GRACE_MS;
        if (within) {
          // Two windows refreshed at once: ask the loser to re-read the winner's tokens.
          throw new AppError("REFRESH_RACE", "The session was just refreshed. Retry with the newest tokens.", 409, true);
        }
        await this.persistence.accounts.upsert({
          ...account,
          sessions: sessions.filter((item) => item.id !== stolen.id),
          updatedAt: now,
        });
        throw new AppError("REFRESH_REUSED", "This refresh token was already used. The session was ended for your safety.", 401, true);
      }
      throw new UnauthorizedError("Invalid refresh token");
    }
    if (current.expiresAt <= now) throw new UnauthorizedError("Session expired. Sign in again.");
    if (current.seatMemberId && !isFamilyPlanId(account.planId)) throw new UnauthorizedError("Session expired. Sign in again.");

    const sessionToken = randomBytes(32).toString("hex");
    const nextRefresh = randomBytes(32).toString("hex");
    const accessExpiresAt = new Date(Date.parse(now) + ACCESS_TTL_MS).toISOString();
    const rotated: AccountSession = {
      ...current,
      tokenHash: hashSessionToken(sessionToken),
      refreshHash: hashSessionToken(nextRefresh),
      prevRefreshHash: hash,
      rotatedAt: now,
      accessExpiresAt,
      lastSeenAt: now,
      expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(),
    };
    await this.persistence.accounts.upsert({
      ...account,
      sessions: sessions.map((item) => (item.id === current.id ? rotated : item)),
      updatedAt: now,
    });
    return { sessionToken, refreshToken: nextRefresh, accessExpiresAt };
  }

  /**
   * Change the owner's password. The current password must be proven, and every *other* owner device is
   * signed out: whoever knew the old password (or holds a stolen token) loses access.
   */
  async changePassword(input: ChangePasswordRequest, currentSessionId: string | null): Promise<AccountStatusResponse> {
    const account = await this.requireConnectedAccount();
    const current = input.currentPassword ?? "";
    const next = input.newPassword ?? "";
    if (!(await verifyPassword(current, account.passwordHash))) {
      throw new UnauthorizedError("Your current password is not correct");
    }
    this.validateCredentials(account.email, next);
    this.assertNewPassword(next);
    if (next === current) throw new ValidationError("Choose a password you have not used just now");
    const now = this.clock.isoNow();
    await this.persistence.accounts.upsert({
      ...account,
      passwordHash: await hashPassword(next),
      sessionTokenHash: null,
      // Keep this device and household seats (they sign in with their own credentials); end other owner devices.
      sessions: (account.sessions ?? []).filter((item) => item.id === currentSessionId || item.seatMemberId),
      updatedAt: now,
    });
    return this.status();
  }

  async resolveSessionToken(token: string | null | undefined): Promise<StudioAccountRecord | null> {
    return (await this.resolveSession(token))?.account ?? null;
  }

  /** The signed-in devices of this account (never exposes token hashes). */
  async listSessions(currentSessionId: string | null): Promise<AccountSessionPublic[]> {
    const account = await this.persistence.accounts.get();
    const now = this.clock.isoNow();
    return (account?.sessions ?? [])
      .filter((item) => item.expiresAt > now)
      .map((item) => ({
        id: item.id,
        deviceName: item.deviceName,
        platform: item.platform,
        appVersion: item.appVersion,
        createdAt: item.createdAt,
        lastSeenAt: item.lastSeenAt,
        expiresAt: item.expiresAt,
        current: item.id === currentSessionId,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /**
   * Issue a session for a family seat that signed in with its own login. It lives beside the owner's
   * sessions (nobody is signed out) and is bound to that seat for its whole life.
   */
  async issueSeatSession(
    seatMemberId: string,
    meta?: SessionMeta,
  ): Promise<{ sessionToken: string; refreshToken?: string; accessExpiresAt?: string }> {
    const account = await this.requireConnectedAccount();
    const issued = this.withNewSession(account, meta, this.clock.isoNow(), seatMemberId);
    await this.persistence.accounts.upsert(issued.account);
    return { sessionToken: issued.sessionToken, refreshToken: issued.refreshToken, accessExpiresAt: issued.accessExpiresAt };
  }

  /** End every session bound to a family seat (the seat was removed). */
  async revokeSeatSessions(seatMemberId: string): Promise<void> {
    const account = await this.persistence.accounts.get();
    if (!account) return;
    const sessions = (account.sessions ?? []).filter((item) => item.seatMemberId !== seatMemberId);
    if (sessions.length !== (account.sessions ?? []).length) {
      await this.persistence.accounts.upsert({ ...account, sessions, updatedAt: this.clock.isoNow() });
    }
  }

  /** Sign one device out. Returns how many sessions remain. */
  async revokeSession(sessionId: string): Promise<number> {
    const account = await this.persistence.accounts.get();
    if (!account) return 0;
    const sessions = (account.sessions ?? []).filter((item) => item.id !== sessionId);
    await this.persistence.accounts.upsert({ ...account, sessions, updatedAt: this.clock.isoNow() });
    return sessions.length + (account.sessionTokenHash ? 1 : 0);
  }

  /** "Sign out everywhere", optionally keeping the device that asked. */
  async revokeAllSessions(exceptSessionId?: string | null): Promise<number> {
    const account = await this.persistence.accounts.get();
    if (!account) return 0;
    const sessions = (account.sessions ?? []).filter((item) => item.id === exceptSessionId);
    await this.persistence.accounts.upsert({
      ...account,
      sessionTokenHash: null,
      sessions,
      updatedAt: this.clock.isoNow(),
    });
    return sessions.length;
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

  /**
   * Apply a plan that was paid for. The invoice is consumed: confirming the same paid invoice again
   * (callback retries, a second tab, or a deliberate replay next month) changes nothing.
   */
  async applyPaidPlan(planId: SubscriptionPlanId, invoiceId: string): Promise<AccountStatusResponse> {
    const account = await this.requireConnectedAccount();
    const consumed = account.paidInvoiceIds ?? [];
    if (consumed.includes(invoiceId)) {
      return this.status();
    }
    const now = this.clock.isoNow();
    const period = billingPeriod(new Date(now));
    await this.persistence.accounts.upsert({
      ...account,
      planId,
      subscriptionStatus: "active",
      periodStart: period.start,
      periodEnd: period.end,
      paidInvoiceIds: [...consumed, invoiceId].slice(-100),
      updatedAt: now,
    });
    return this.status();
  }

  async disconnect(): Promise<AccountStatusResponse> {
    await this.resetAccountScopedData();
    await this.persistence.accounts.delete();
    return this.status();
  }

  /** End this device's session only; other devices stay signed in. */
  async logout(sessionId?: string | null): Promise<{ status: AccountStatusResponse; remainingSessions: number }> {
    const account = await this.persistence.accounts.get();
    if (!account) {
      return { status: await this.status(), remainingSessions: 0 };
    }
    const remainingSessions = sessionId
      ? await this.revokeSession(sessionId)
      : await this.revokeAllSessions(null);
    return { status: await this.status(), remainingSessions };
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

  startWebAuth(meta?: SessionMeta): StartWebAuthResponse {
    const now = this.clock.isoNow();
    this.prunePendingAuth(now);
    const state = randomBytes(18).toString("hex");
    const pollSecret = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    this.pendingWebAuth.set(state, {
      meta,
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
        ...(pending.result.refreshToken
          ? { refreshToken: pending.result.refreshToken, accessExpiresAt: pending.result.accessExpiresAt }
          : {}),
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

    let planId: SubscriptionPlanId = "free";
    if (input.planCode?.trim()) {
      const mapped = this.resolveRedeemCode(input.planCode);
      if (!mapped) {
        throw new ValidationError("Unknown plan code");
      }
      planId = mapped;
    }

    const existing = await this.persistence.accounts.get();
    let account: StudioAccountRecord;
    let sessionToken = "";
    let refreshToken: string | undefined;
    let accessExpiresAt: string | undefined;
    let accountCreated = false;
    if (existing && existing.email === email) {
      if (!(await verifyPassword(input.password, existing.passwordHash))) {
        throw new UnauthorizedError("Invalid email or password");
      }
      const issued = this.withNewSession(
        {
          ...existing,
          displayName: displayName || existing.displayName,
          planId: existing.planId === "free" ? planId : existing.planId,
          subscriptionStatus: "active",
        },
        pending.meta,
        now,
      );
      account = issued.account;
      sessionToken = issued.sessionToken;
      refreshToken = issued.refreshToken;
      accessExpiresAt = issued.accessExpiresAt;
    } else if (existing) {
      throw new ValidationError(
        "Another account is already connected on this studio. Sign in with that email and password.",
      );
    } else {
      this.assertMaySignUp(email);
      this.assertNewPassword(input.password ?? "");
      accountCreated = true;
      await this.resetAccountScopedData();
      const issued = this.withNewSession(
        {
          id: brandId(this.ids.next("acc")),
          workspaceId: this.persistence.workspaceId,
          email,
          displayName,
          passwordHash: await hashPassword(input.password),
          planId,
          subscriptionStatus: "active",
          periodStart: period.start,
          periodEnd: period.end,
          sessionTokenHash: null,
          sessions: [],
          connectedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        pending.meta,
        now,
      );
      account = issued.account;
      sessionToken = issued.sessionToken;
      refreshToken = issued.refreshToken;
      accessExpiresAt = issued.accessExpiresAt;
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
      ...(refreshToken ? { refreshToken, accessExpiresAt } : {}),
      accountCreated,
    };
    pending.status = "completed";
    pending.result = result;
    this.pendingWebAuth.set(state, pending);
    return result;
  }

  async activateSubscription(input: ActivateSubscriptionRequest): Promise<AccountStatusResponse> {
    const planId = this.resolveRedeemCode(input.code);
    if (!planId) {
      throw new ValidationError("Unknown subscription code");
    }
    if (!this.options.allowPlanCodes) {
      // A free-tier code must not be a way around the "free month ended, pay to continue" gate.
      const entitlements = await this.buildEntitlements(await this.requireConnectedAccount());
      if (entitlements.pauseMode === "payment_required") {
        throw new ValidationError(
          "Your free month ended. Choose a paid plan and complete payment to unlock chat.",
        );
      }
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
