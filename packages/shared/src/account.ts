import type { Brand } from "./ids.js";

export type SubscriptionPlanId =
  | "free"
  | "starter"
  | "pro"
  | "max"
  | "family_free"
  | "family"
  | "family_plus"
  | "business"
  | "enterprise"
  /** Legacy ids — still accepted for old accounts; always hard-capped. */
  | "solo"
  | "studio"
  | "team"
  | "unlimited";

export type PlanAudience = "individual" | "family" | "organization";
/** Control-plane category — teams maps to the organization studio shell. */
export type PlanCategory = "individuals" | "family" | "teams";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";
export type AccountId = Brand<string, "AccountId">;

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  audience: PlanAudience;
  /** Monthly token budget (input + output). Always a positive hard cap. */
  monthlyTokenLimit: number;
  description: string;
  /**
   * Price in halalas (1 SAR = 100). 0 = free.
   * For seat-priced org plans this is the *per-seat* monthly price when
   * `pricePerSeatHalalas` is set; otherwise the flat monthly price.
   */
  monthlyPriceHalalas: number;
  currency: "SAR";
  interval: "month";
  highlight?: boolean;
  badge?: string | null;
  features: string[];
  /** Optional household / team seat guidance shown in catalog. */
  seatLimit?: number | null;
  /** Org plans: minimum billable seats. */
  minSeats?: number | null;
  /** When set, `monthlyPriceHalalas` is the per-seat price. */
  pricePerSeatHalalas?: number | null;
  /** Included DeepSeek model credit in SAR halalas (shared for family/org pools). */
  includedDeepseekHalalas?: number;
  /** Included other-model credit in SAR halalas. */
  includedOtherHalalas?: number;
  /** Hidden from the in-app catalog but still recognized for old accounts. */
  legacy?: boolean;
}

/** Built-in Arrab Studio plans. Every plan is hard-capped — no unlimited SKU. */
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlan> = {
  free: {
    id: "free",
    name: "Free",
    audience: "individual",
    monthlyTokenLimit: 100_000,
    description: "Start a studio, hire your first companion, and feel the product.",
    monthlyPriceHalalas: 0,
    currency: "SAR",
    interval: "month",
    badge: null,
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: ["1× included usage", "Desktop Studio", "Hard stop when tokens are used up"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    audience: "individual",
    monthlyTokenLimit: 2_500_000,
    description: "Daily companions for founders getting started.",
    monthlyPriceHalalas: 8_000,
    currency: "SAR",
    interval: "month",
    badge: null,
    includedDeepseekHalalas: 500,
    includedOtherHalalas: 2_000,
    features: ["Hard-capped monthly tokens", "Included model credits", "Desktop Studio"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    audience: "individual",
    monthlyTokenLimit: 10_000_000,
    description: "Daily cowork for founders who live in Arrab.",
    monthlyPriceHalalas: 18_000,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Most chosen",
    includedDeepseekHalalas: 1_500,
    includedOtherHalalas: 6_000,
    features: [
      "Larger monthly token pool",
      "Included DeepSeek + other credits",
      "Priority model routing",
      "Desktop Studio",
    ],
  },
  max: {
    id: "max",
    name: "Max",
    audience: "individual",
    monthlyTokenLimit: 25_000_000,
    description: "Highest individual monthly pool for heavy daily use.",
    monthlyPriceHalalas: 39_500,
    currency: "SAR",
    interval: "month",
    badge: "Max",
    includedDeepseekHalalas: 3_000,
    includedOtherHalalas: 12_000,
    features: [
      "Largest individual token pool",
      "Included DeepSeek + other credits",
      "Priority routing",
      "Hard stop when the pool is full",
    ],
  },
  family_free: {
    id: "family_free",
    name: "Family Free",
    audience: "family",
    monthlyTokenLimit: 100_000,
    description: "Free family trial — share seats at home.",
    monthlyPriceHalalas: 0,
    currency: "SAR",
    interval: "month",
    badge: "Trial",
    seatLimit: 3,
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: [
      "Shared household usage",
      "Up to 3 family seats",
      "PIN profiles + parental pause",
    ],
  },
  family: {
    id: "family",
    name: "Family 3",
    audience: "family",
    monthlyTokenLimit: 8_000_000,
    description: "One shared studio for a household of three.",
    monthlyPriceHalalas: 20_000,
    currency: "SAR",
    interval: "month",
    badge: "Household",
    seatLimit: 3,
    includedDeepseekHalalas: 1_500,
    includedOtherHalalas: 5_000,
    features: [
      "Shared tokens & credits across the household",
      "Up to 3 family seats",
      "15 SAR DeepSeek + 50 SAR other credits",
      "Hard pause when the shared pool is full",
    ],
  },
  family_plus: {
    id: "family_plus",
    name: "Family 5",
    audience: "family",
    monthlyTokenLimit: 15_000_000,
    description: "More room for larger households.",
    monthlyPriceHalalas: 30_000,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Family pick",
    seatLimit: 5,
    includedDeepseekHalalas: 2_500,
    includedOtherHalalas: 8_000,
    features: [
      "Shared tokens & credits across the household",
      "Up to 5 family seats",
      "25 SAR DeepSeek + 80 SAR other credits",
      "Hard pause when the shared pool is full",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    audience: "organization",
    monthlyTokenLimit: 15_000_000,
    description: "Pooled seats and credits for growing companies.",
    monthlyPriceHalalas: 40_000,
    pricePerSeatHalalas: 40_000,
    minSeats: 10,
    seatLimit: 10,
    currency: "SAR",
    interval: "month",
    badge: "Growth",
    // Pooled: 10 SAR DeepSeek + 40 SAR other per seat × 10 seats.
    includedDeepseekHalalas: 10_000,
    includedOtherHalalas: 40_000,
    features: [
      "400 SAR per seat · 10 seats",
      "15M shared monthly tokens",
      "Pooled DeepSeek + other credits",
      "Workforce ops & Live Map",
      "Hard stop when the pool is full",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    audience: "organization",
    monthlyTokenLimit: 80_000_000,
    description: "Largest pooled allowance for production teams.",
    monthlyPriceHalalas: 70_000,
    pricePerSeatHalalas: 70_000,
    minSeats: 50,
    seatLimit: 50,
    currency: "SAR",
    interval: "month",
    badge: "Enterprise",
    // Pooled: 12 SAR DeepSeek + 70 SAR other per seat × 50 seats.
    includedDeepseekHalalas: 60_000,
    includedOtherHalalas: 350_000,
    features: [
      "700 SAR per seat · 50 seats",
      "80M shared monthly tokens",
      "Pooled DeepSeek + other credits",
      "Workforce ops & Live Map",
      "Hard stop when the pool is full",
    ],
  },
  /** Legacy — capped individual. */
  solo: {
    id: "solo",
    name: "Solo",
    audience: "individual",
    monthlyTokenLimit: 5_000_000,
    description: "Legacy individual plan (capped).",
    monthlyPriceHalalas: 11_900,
    currency: "SAR",
    interval: "month",
    legacy: true,
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: ["Hard-capped monthly tokens", "Desktop Studio"],
  },
  /** Legacy — capped individual. */
  studio: {
    id: "studio",
    name: "Studio",
    audience: "individual",
    monthlyTokenLimit: 12_000_000,
    description: "Legacy individual plan (capped).",
    monthlyPriceHalalas: 24_900,
    currency: "SAR",
    interval: "month",
    legacy: true,
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: ["Hard-capped monthly tokens", "Desktop Studio"],
  },
  /** Legacy — capped organization. */
  team: {
    id: "team",
    seatLimit: 10,
    minSeats: 1,
    name: "Team",
    audience: "organization",
    monthlyTokenLimit: 10_000_000,
    description: "Legacy organization plan (capped).",
    monthlyPriceHalalas: 14_900,
    currency: "SAR",
    interval: "month",
    legacy: true,
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: ["Hard-capped monthly tokens", "Team chat & cowork"],
  },
  /** Legacy Scale — capped organization (never unlimited). */
  unlimited: {
    id: "unlimited",
    seatLimit: 25,
    minSeats: 1,
    name: "Scale",
    audience: "organization",
    monthlyTokenLimit: 50_000_000,
    description: "Legacy organization plan (hard-capped).",
    monthlyPriceHalalas: 39_900,
    currency: "SAR",
    interval: "month",
    legacy: true,
    badge: "Legacy",
    includedDeepseekHalalas: 0,
    includedOtherHalalas: 0,
    features: ["Hard-capped monthly tokens — not unlimited", "Workforce ops"],
  },
};

/** Plans shown in the desktop catalog (excludes legacy SKUs). */
export const LIVE_CATALOG_PLAN_IDS: readonly SubscriptionPlanId[] = [
  "free",
  "starter",
  "pro",
  "max",
  "family_free",
  "family",
  "family_plus",
  "business",
  "enterprise",
] as const;

/** Redeem codes map to plans (dev / internal builds). */
export const SUBSCRIPTION_REDEEM_CODES: Record<string, SubscriptionPlanId> = {
  "FREE-ARRAB": "free",
  "STARTER-ARRAB": "starter",
  "PRO-ARRAB": "pro",
  "MAX-ARRAB": "max",
  "FAMILY-FREE-ARRAB": "family_free",
  "FAMILY-ARRAB": "family",
  "FAMILY-PLUS-ARRAB": "family_plus",
  "BUSINESS-ARRAB": "business",
  "ENTERPRISE-ARRAB": "enterprise",
  "TEAM-ARRAB": "team",
  "SOLO-ARRAB": "solo",
  "STUDIO-ARRAB": "studio",
  "UNLIMITED-ARRAB": "unlimited",
  "SCALE-ARRAB": "unlimited",
};

/** True for any household plan (Family Free trial, Family 3, Family 5). */
export function isFamilyPlanId(
  planId: string | null | undefined,
): planId is "family_free" | "family" | "family_plus" {
  const id = (planId ?? "").toLowerCase().replace(/_/g, "-");
  return id === "family-free" || id === "family" || id === "family-plus";
}

/**
 * Normalize website / Tap / control-plane plan ids onto the catalog.
 * `scale` → legacy capped `unlimited`. Never alias individual `studio`/`max` to org.
 */
export function normalizePlanId(raw: string | null | undefined): SubscriptionPlanId | null {
  const id = (raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (!id) return null;
  if (id === "scale") return "unlimited";
  if (Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, id)) {
    return id as SubscriptionPlanId;
  }
  return null;
}

/** True for live production SKUs (never legacy solo/studio/team/unlimited). */
export function isLiveCatalogPlanId(
  planId: string | null | undefined,
): planId is (typeof LIVE_CATALOG_PLAN_IDS)[number] {
  const normalized = normalizePlanId(planId);
  return Boolean(
    normalized && (LIVE_CATALOG_PLAN_IDS as readonly string[]).includes(normalized),
  );
}

/** Control-plane category for a catalog audience (teams → organization shell). */
export function planCategoryForAudience(audience: PlanAudience): PlanCategory {
  if (audience === "organization") return "teams";
  if (audience === "family") return "family";
  return "individuals";
}

/**
 * Resolve studio audience from control-plane signals.
 * Known catalog plan ids are authoritative. Category only fills gaps for unknown ids.
 */
export function resolvePlanAudience(input: {
  planId?: string | null;
  planCategory?: string | null;
  planName?: string | null;
}): PlanAudience {
  const rawId = (input.planId ?? "").trim();
  const normalized = normalizePlanId(rawId);
  if (normalized) {
    return SUBSCRIPTION_PLANS[normalized].audience;
  }

  const cat = (input.planCategory ?? "").trim().toLowerCase();
  if (cat === "teams" || cat === "organization" || cat === "business") {
    return "organization";
  }
  if (cat === "family" || cat === "families") {
    return "family";
  }
  if (cat === "individuals" || cat === "individual" || cat === "solo") {
    return "individual";
  }

  const id = rawId.toLowerCase().replace(/_/g, "-");
  if (["team", "business", "enterprise", "scale", "unlimited"].includes(id)) {
    return "organization";
  }
  if (["family", "family-plus", "family-free"].includes(id)) {
    return "family";
  }
  if (["free", "pro", "solo", "studio", "starter", "max"].includes(id)) {
    return "individual";
  }

  const name = (input.planName ?? "").trim().toLowerCase();
  if (
    name === "business" ||
    name === "team" ||
    name === "enterprise" ||
    name === "scale" ||
    name === "platform admin"
  ) {
    return "organization";
  }
  if (name.startsWith("family")) {
    return "family";
  }

  return "individual";
}

/** Org employee seats included in a plan. Non-org plans and unknown ids fall back to 8. */
export function orgSeatLimitForPlan(planId: string | null | undefined): number {
  const normalized = normalizePlanId(planId);
  if (normalized) {
    const plan = SUBSCRIPTION_PLANS[normalized];
    if (plan.audience === "organization" && plan.seatLimit) return plan.seatLimit;
  }
  return 8;
}

/** Soft local allowance when no account is connected. */
export const LOCAL_UNCONNECTED_TOKEN_LIMIT = 25_000;

export type TokenTopUpPackId = "boost_500k" | "boost_2m" | "boost_10m";

/** One-off usage packs. Tokens are added on top of the plan until the current period ends. */
export interface TokenTopUpPack {
  id: TokenTopUpPackId;
  name: string;
  nameAr: string;
  tokens: number;
  /** Price in halalas (1 SAR = 100). */
  priceHalalas: number;
  currency: "SAR";
  badge?: string | null;
}

export const TOKEN_TOP_UP_PACKS: Record<TokenTopUpPackId, TokenTopUpPack> = {
  boost_500k: {
    id: "boost_500k",
    name: "Quick boost",
    nameAr: "دفعة سريعة",
    tokens: 500_000,
    priceHalalas: 1_500,
    currency: "SAR",
  },
  boost_2m: {
    id: "boost_2m",
    name: "Work boost",
    nameAr: "دفعة عمل",
    tokens: 2_000_000,
    priceHalalas: 4_500,
    currency: "SAR",
    badge: "Popular",
  },
  boost_10m: {
    id: "boost_10m",
    name: "Studio boost",
    nameAr: "دفعة الاستوديو",
    tokens: 10_000_000,
    priceHalalas: 19_900,
    currency: "SAR",
  },
};

/**
 * Custom credit is paid in SAR but metered in tokens like everything else. It converts at the rate of
 * the smallest usage pack (the least generous one): 500,000 tokens for 15 SAR.
 */
export const CUSTOM_CREDIT_TOKENS_PER_HALALA =
  TOKEN_TOP_UP_PACKS.boost_500k.tokens / TOKEN_TOP_UP_PACKS.boost_500k.priceHalalas;

export function tokensForCredit(amountHalalas: number): number {
  return Math.max(0, Math.floor(amountHalalas * CUSTOM_CREDIT_TOKENS_PER_HALALA));
}

export interface TokenTopUpRecord {
  /** Tap charge id (or redeem reference) — makes applying a purchase idempotent. */
  invoiceId: string;
  packId: TokenTopUpPackId | "custom_credit";
  tokens: number;
  purchasedAt: string;
  /** Tokens only count while this matches the account's current period end. */
  periodEnd: string;
}

/** Spendable credit from a custom top-up. Prices are SAR halalas and do not include VAT. */
export interface ModelCreditBalance {
  deepseekHalalas: number;
  otherHalalas: number;
  appliedInvoiceIds?: string[];
}

export interface CreditQuote {
  amountSar: number;
  amountHalalas: number;
  currency: "SAR";
  /** The amount is the price before VAT. */
  vatIncluded: false;
  deepseekHalalas: number;
  otherHalalas: number;
  profitHalalas: number;
}

const CREDIT_MIN_HALALAS = 100;
const CREDIT_MAX_HALALAS = 500_000;

/** 10% DeepSeek, 60% other models, 30% profit. The remainder of rounding stays in profit. */
export function quoteCredit(amountSar: number): CreditQuote {
  if (!Number.isFinite(amountSar)) {
    throw new Error("Enter an amount in SAR");
  }
  const amountHalalas = Math.round(amountSar * 100);
  if (amountHalalas < CREDIT_MIN_HALALAS || amountHalalas > CREDIT_MAX_HALALAS) {
    throw new Error("Credit amount must be between 1 and 5,000 SAR");
  }
  const deepseekHalalas = Math.floor((amountHalalas * 10) / 100);
  const otherHalalas = Math.floor((amountHalalas * 60) / 100);
  const profitHalalas = amountHalalas - deepseekHalalas - otherHalalas;
  return {
    amountSar: amountHalalas / 100,
    amountHalalas,
    currency: "SAR",
    vatIncluded: false,
    deepseekHalalas,
    otherHalalas,
    profitHalalas,
  };
}

/** ok < 80% used · low ≥ 80% · critical ≥ 95% · exhausted = paused. */
export type TokenUsageLevel = "ok" | "low" | "critical" | "exhausted";

export interface StudioAccountRecord {
  id: AccountId;
  workspaceId: string;
  email: string;
  displayName: string;
  /** scrypt hash — never returned to desktop */
  passwordHash: string;
  planId: SubscriptionPlanId;
  subscriptionStatus: SubscriptionStatus;
  periodStart: string;
  periodEnd: string;
  /** hashed session token */
  sessionTokenHash: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Purchased usage packs. Absent on accounts created before top-ups existed. */
  tokenTopUps?: TokenTopUpRecord[];
  /** Custom credit balances. Absent until the first custom top-up. */
  modelCredit?: ModelCreditBalance;
  /**
   * Paid plan invoices / Tap charge ids already applied (most recent 100). A paid charge is
   * single-use: without this, one payment could be re-confirmed every month to renew for free.
   */
  paidInvoiceIds?: string[];
  /** Signed-in devices. `sessionTokenHash` is kept only so sessions issued before this existed still work. */
  sessions?: AccountSession[];
  /** TOTP MFA is on for this account owner. */
  mfaEnabled?: boolean;
  /** Base32 TOTP secret — never returned on public account shapes. */
  mfaSecret?: string | null;
}

/** One signed-in device. Tokens are stored only as hashes. */
export interface AccountSession {
  id: string;
  tokenHash: string;
  deviceName: string;
  /** e.g. macos, windows, ios, android, huawei, web, cli */
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /**
   * Set for a family seat signed in with its own login. The session is *bound to that seat*: the
   * server derives the acting member from it (never from a header or global state) and refuses
   * account-level actions (plan, billing, disconnect, other devices' sessions).
   */
  seatMemberId?: string | null;
  /**
   * Short-lived access + rotating refresh (opt-in per client). `tokenHash` stops working at
   * `accessExpiresAt`; `refreshHash` is exchanged for a new pair. `prevRefreshHash` detects theft: a
   * refresh token that was already rotated away and shows up again ends the whole session.
   */
  accessExpiresAt?: string | null;
  refreshHash?: string | null;
  prevRefreshHash?: string | null;
  rotatedAt?: string | null;
}

/** What a client may see about its own sessions (never the hash). */
export interface AccountSessionPublic {
  id: string;
  deviceName: string;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AccountPublic {
  id: AccountId;
  email: string;
  displayName: string;
  planId: SubscriptionPlanId | string;
  planName: string;
  /** Control-plane category when present (teams → organization shell). */
  planCategory?: PlanCategory | string;
  subscriptionStatus: SubscriptionStatus;
  periodStart: string;
  periodEnd: string;
  connectedAt: string;
  /** e.g. platform_admin — optional control-plane role. */
  role?: string;
  /** Whether TOTP MFA is enabled (secret is never exposed). */
  mfaEnabled?: boolean;
}

export interface AccountEntitlements {
  connected: boolean;
  planId: SubscriptionPlanId | string | null;
  planName: string;
  /** Prefer this over account.planCategory when routing shells. */
  planCategory?: PlanCategory | string;
  subscriptionStatus: SubscriptionStatus | null;
  /** Hard monthly token cap. Never invent a higher local limit. */
  tokenLimit: number | null;
  tokensUsed: number;
  tokensRemaining: number | null;
  /** True when the monthly token pool is exhausted — studio AI work is paused. */
  overLimit: boolean;
  /**
   * How the operator can continue after a pause:
   * - upgrade_required: Local unconnected — must connect/upgrade to resume
   * - upgrade_or_wait: Paid capped plan mid-period — upgrade now or wait until periodEnd
   * - payment_required: Any plan’s month ended — chat stays paused until payment (paid renew or upgrade from Free)
   * - null: not paused
   */
  pauseMode: "upgrade_required" | "upgrade_or_wait" | "payment_required" | null;
  periodStart: string;
  periodEnd: string;
  /** The plan's own monthly allowance, before usage packs. `tokenLimit` includes packs. */
  planTokenLimit?: number | null;
  /** Usage-pack tokens added for this period. */
  topUpTokens?: number;
  /** Custom / included credit for DeepSeek, in halalas. */
  deepseekCreditHalalas?: number;
  /** Custom / included credit for every model other than DeepSeek, in halalas. */
  otherCreditHalalas?: number;
  usageLevel?: TokenUsageLevel;
  /** Whether buying a usage pack would unpause (false while a renewal payment is due). */
  canTopUp?: boolean;
  /** Modes the control plane allows (workforce, etc.). */
  allowedModes?: string[];
  /** Seat limit for family/org plans when the API reports it. */
  seatLimit?: number | null;
}

export interface AccountStatusResponse {
  connected: boolean;
  account: AccountPublic | null;
  entitlements: AccountEntitlements;
  plans: SubscriptionPlan[];
}

/** True when AI send/compose must be blocked from entitlements alone. */
export function entitlementsBlockAi(entitlements: AccountEntitlements | null | undefined): boolean {
  if (!entitlements) return false;
  return Boolean(entitlements.overLimit) || entitlements.pauseMode != null;
}
