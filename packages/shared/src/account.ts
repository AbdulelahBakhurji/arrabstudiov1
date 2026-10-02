import type { Brand } from "./ids.js";

export type SubscriptionPlanId =
  | "free"
  | "pro"
  | "family_free"
  | "family"
  | "family_plus"
  | "team"
  | "unlimited"
  /** Production control-plane plan ids (teams category). */
  | "business"
  | "enterprise"
  | "solo"
  | "studio";
export type PlanAudience = "individual" | "family" | "organization";
/** Control-plane category — teams maps to the organization studio shell. */
export type PlanCategory = "individuals" | "family" | "teams";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";
export type AccountId = Brand<string, "AccountId">;

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  audience: PlanAudience;
  /** Monthly token budget (input + output). Always a positive limit. */
  monthlyTokenLimit: number;
  description: string;
  /** Price in halalas (1 SAR = 100). 0 = free. */
  monthlyPriceHalalas: number;
  currency: "SAR";
  interval: "month";
  highlight?: boolean;
  badge?: string | null;
  features: string[];
  /** Optional household / team seat guidance shown in catalog. */
  seatLimit?: number | null;
}

/** Built-in Arrab Studio plans. Limits are total tokens per billing period. */
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlan> = {
  free: {
    id: "free",
    name: "Free",
    audience: "individual",
    monthlyTokenLimit: 100_000,
    description: "Start a studio, hire your first employee, and feel the product.",
    monthlyPriceHalalas: 0,
    currency: "SAR",
    interval: "month",
    badge: null,
    features: [
      "1× included usage",
      "1 AI employee desk",
      "Web workspace + macOS Studio",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    audience: "individual",
    monthlyTokenLimit: 2_000_000,
    description: "Daily cowork for founders who live in Arrab.",
    monthlyPriceHalalas: 4_900,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Most chosen",
    features: [
      "20× included usage",
      "Unlimited employees & projects",
      "Priority model routing",
      "Desktop Studio + testing workspace",
    ],
  },
  family_free: {
    id: "family_free",
    name: "Family Free",
    audience: "family",
    monthlyTokenLimit: 100_000,
    description: "Free family trial — share seats at home and try household companions together.",
    monthlyPriceHalalas: 0,
    currency: "SAR",
    interval: "month",
    badge: "Trial",
    seatLimit: 6,
    features: [
      "1× shared household usage",
      "Up to 6 family seats",
      "Add parents, partners, and kids",
      "PIN profiles + parental pause",
      "macOS Studio on every home Mac",
    ],
  },
  family: {
    id: "family",
    name: "Family",
    audience: "family",
    monthlyTokenLimit: 4_000_000,
    description: "One shared studio for the household — companions, chats, and desks together.",
    monthlyPriceHalalas: 7_900,
    currency: "SAR",
    interval: "month",
    badge: "Household",
    seatLimit: 6,
    features: [
      "40× shared household usage",
      "Up to 6 family seats",
      "Shared companions & chat history",
      "Parental-friendly usage overview",
      "macOS Studio on every home Mac",
    ],
  },
  family_plus: {
    id: "family_plus",
    name: "Family Plus",
    audience: "family",
    monthlyTokenLimit: 8_000_000,
    description: "More room for larger households and heavier daily use.",
    monthlyPriceHalalas: 12_900,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Family pick",
    seatLimit: 10,
    features: [
      "80× shared household usage",
      "Up to 10 family seats",
      "Priority routing for every member",
      "Shared knowledge & memories",
      "Priority household support",
    ],
  },
  team: {
    id: "team",
    seatLimit: 10,
    name: "Team",
    audience: "organization",
    monthlyTokenLimit: 10_000_000,
    description: "Multi-agent studios shipping together.",
    monthlyPriceHalalas: 14_900,
    currency: "SAR",
    interval: "month",
    badge: null,
    features: [
      "100× studio usage",
      "Shared goals, tasks, and memory",
      "Team chat & cowork rooms",
      "Usage controls per session",
      "Priority support",
    ],
  },
  /** Production Business plan — organization shell (Workforce, Live Map, admin). */
  business: {
    id: "business",
    seatLimit: 25,
    name: "Business",
    audience: "organization",
    monthlyTokenLimit: 40_000_000,
    description: "Higher throughput for growing companies.",
    monthlyPriceHalalas: 74_900,
    currency: "SAR",
    interval: "month",
    badge: "Growth",
    features: [
      "400× studio usage",
      "Usage controls & priority support",
      "Team chat & cowork rooms",
      "Workforce ops & Live Map",
    ],
  },
  /** Production Enterprise plan — organization shell. */
  enterprise: {
    id: "enterprise",
    seatLimit: 100,
    name: "Enterprise",
    audience: "organization",
    monthlyTokenLimit: 80_000_000,
    description: "Largest monthly allowance for production teams.",
    monthlyPriceHalalas: 129_900,
    currency: "SAR",
    interval: "month",
    badge: "Scale",
    features: [
      "800× studio usage",
      "Dedicated onboarding",
      "Workforce ops & Live Map",
      "Usage controls per session",
    ],
  },
  /** Production Solo — individual shell (alias of Pro-class). */
  solo: {
    id: "solo",
    name: "Solo",
    audience: "individual",
    monthlyTokenLimit: 5_000_000,
    description: "Best for founders working alone every day.",
    monthlyPriceHalalas: 11_900,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Best",
    features: [
      "Daily companions & studio",
      "Unlimited employees & projects",
      "Priority model routing",
    ],
  },
  /** Production Studio — individual shell. */
  studio: {
    id: "studio",
    name: "Studio",
    audience: "individual",
    monthlyTokenLimit: 12_000_000,
    description: "More room for multi-project studios.",
    monthlyPriceHalalas: 24_900,
    currency: "SAR",
    interval: "month",
    badge: null,
    features: [
      "Larger monthly pool",
      "Priority model routing",
      "Desktop Studio",
    ],
  },
  /** Legacy plan id kept for existing accounts — always capped (no unlimited SKUs). */
  unlimited: {
    id: "unlimited",
    seatLimit: 250,
    name: "Scale",
    audience: "organization",
    monthlyTokenLimit: 50_000_000,
    description: "Highest monthly pool for production studios shipping at volume.",
    monthlyPriceHalalas: 39_900,
    currency: "SAR",
    interval: "month",
    highlight: true,
    badge: "Scale",
    features: [
      "500× studio usage",
      "Highest throughput routing",
      "Dedicated onboarding",
      "Custom workforce playbooks",
      "Usage controls per session",
    ],
  },
};

/** Redeem codes map to plans (studio billing stub until Stripe). */
export const SUBSCRIPTION_REDEEM_CODES: Record<string, SubscriptionPlanId> = {
  "FREE-ARRAB": "free",
  "PRO-ARRAB": "pro",
  "FAMILY-FREE-ARRAB": "family_free",
  "FAMILY-ARRAB": "family",
  "FAMILY-PLUS-ARRAB": "family_plus",
  "TEAM-ARRAB": "team",
  "BUSINESS-ARRAB": "business",
  "ENTERPRISE-ARRAB": "enterprise",
  "SOLO-ARRAB": "solo",
  "STUDIO-ARRAB": "studio",
  "UNLIMITED-ARRAB": "unlimited", // legacy alias → capped Scale
  "SCALE-ARRAB": "unlimited",
};

/** True for any household plan (Family Free trial, Family, Family Plus). */
export function isFamilyPlanId(
  planId: string | null | undefined,
): planId is "family_free" | "family" | "family_plus" {
  const id = (planId ?? "").toLowerCase().replace(/_/g, "-");
  return id === "family-free" || id === "family" || id === "family-plus";
}

/**
 * Resolve studio audience from control-plane signals.
 * Prefer planCategory (teams → organization); then known plan ids / names.
 */
export function resolvePlanAudience(input: {
  planId?: string | null;
  planCategory?: string | null;
  planName?: string | null;
}): PlanAudience {
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

  const rawId = (input.planId ?? "").trim();
  if (rawId && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, rawId)) {
    return SUBSCRIPTION_PLANS[rawId as SubscriptionPlanId].audience;
  }

  const id = rawId.toLowerCase().replace(/_/g, "-");
  if (["team", "business", "enterprise", "scale", "unlimited"].includes(id)) {
    return "organization";
  }
  if (["family", "family-plus", "family-free"].includes(id)) {
    return "family";
  }
  // Include live control-plane aliases (starter / max) still served by api.arrabai.com 0.14.x.
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
  const id = (planId ?? "").trim();
  if (id && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, id)) {
    const plan = SUBSCRIPTION_PLANS[id as SubscriptionPlanId];
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
 * the smallest usage pack (the least generous one): 500,000 tokens for 15 SAR. Previously the credit
 * was recorded and shown but never spent, so a customer could pay and receive nothing.
 */
export const CUSTOM_CREDIT_TOKENS_PER_HALALA = TOKEN_TOP_UP_PACKS.boost_500k.tokens / TOKEN_TOP_UP_PACKS.boost_500k.priceHalalas;

export function tokensForCredit(amountHalalas: number): number {
  return Math.max(0, Math.floor(amountHalalas * CUSTOM_CREDIT_TOKENS_PER_HALALA));
}

export interface TokenTopUpRecord {
  /** Moyasar invoice id (or redeem reference) — makes applying a purchase idempotent. */
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
   * Paid plan invoices already applied (most recent 100). A paid invoice is single-use: without
   * this, one payment could be re-confirmed every month to renew a plan for free.
   */
  paidInvoiceIds?: string[];
  /** Signed-in devices. `sessionTokenHash` is kept only so sessions issued before this existed still work. */
  sessions?: AccountSession[];
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
}

export interface AccountEntitlements {
  connected: boolean;
  planId: SubscriptionPlanId | string | null;
  planName: string;
  /** Prefer this over account.planCategory when routing shells. */
  planCategory?: PlanCategory | string;
  subscriptionStatus: SubscriptionStatus | null;
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
  /** Custom credit for DeepSeek, in halalas. VAT is not included in the purchase price. */
  deepseekCreditHalalas?: number;
  /** Custom credit for every model other than DeepSeek, in halalas. */
  otherCreditHalalas?: number;
  usageLevel?: TokenUsageLevel;
  /** Whether buying a usage pack would unpause (false while a renewal payment is due). */
  canTopUp?: boolean;
  /** Modes the control plane allows (workforce, etc.). */
  allowedModes?: string[];
}

export interface AccountStatusResponse {
  connected: boolean;
  account: AccountPublic | null;
  entitlements: AccountEntitlements;
  plans: SubscriptionPlan[];
}
