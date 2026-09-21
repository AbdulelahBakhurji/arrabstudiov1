import type { Brand } from "./ids.js";

export type SubscriptionPlanId =
  | "free"
  | "pro"
  | "family_free"
  | "family"
  | "family_plus"
  | "team"
  | "unlimited";
export type PlanAudience = "individual" | "family" | "organization";
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
  /** Legacy plan id kept for existing accounts — always capped (no unlimited SKUs). */
  unlimited: {
    id: "unlimited",
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
  "UNLIMITED-ARRAB": "unlimited", // legacy alias → capped Scale
  "SCALE-ARRAB": "unlimited",
};

/** True for any household plan (Family Free trial, Family, Family Plus). */
export function isFamilyPlanId(
  planId: string | null | undefined,
): planId is "family_free" | "family" | "family_plus" {
  return planId === "family_free" || planId === "family" || planId === "family_plus";
}

/** Soft local allowance when no account is connected. */
export const LOCAL_UNCONNECTED_TOKEN_LIMIT = 25_000;

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
}

export interface AccountPublic {
  id: AccountId;
  email: string;
  displayName: string;
  planId: SubscriptionPlanId;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
  periodStart: string;
  periodEnd: string;
  connectedAt: string;
}

export interface AccountEntitlements {
  connected: boolean;
  planId: SubscriptionPlanId | null;
  planName: string;
  subscriptionStatus: SubscriptionStatus | null;
  tokenLimit: number | null;
  tokensUsed: number;
  tokensRemaining: number | null;
  /** True when the monthly token pool is exhausted — studio AI work is paused. */
  overLimit: boolean;
  /**
   * How the operator can continue after a pause:
   * - upgrade_required: Free / local — must upgrade (or connect) to resume
   * - upgrade_or_wait: Paid capped plan — upgrade now or wait until periodEnd
   * - null: not paused
   */
  pauseMode: "upgrade_required" | "upgrade_or_wait" | null;
  periodStart: string;
  periodEnd: string;
}

export interface AccountStatusResponse {
  connected: boolean;
  account: AccountPublic | null;
  entitlements: AccountEntitlements;
  plans: SubscriptionPlan[];
}
