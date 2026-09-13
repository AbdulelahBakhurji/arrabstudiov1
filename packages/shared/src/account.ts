import type { Brand } from "./ids.js";

export type SubscriptionPlanId = "free" | "pro" | "team" | "unlimited";
export type PlanAudience = "individual" | "organization";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";
export type AccountId = Brand<string, "AccountId">;

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  audience: PlanAudience;
  /** Monthly token budget (input + output). null = unlimited. */
  monthlyTokenLimit: number | null;
  description: string;
  /** Price in halalas (1 SAR = 100). 0 = free. */
  monthlyPriceHalalas: number;
  currency: "SAR";
  interval: "month";
  highlight?: boolean;
  badge?: string | null;
  features: string[];
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
      "100,000 tokens every month",
      "1 AI employee desk",
      "Web workspace + macOS Studio",
      "Moyasar-ready billing later",
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
      "2,000,000 tokens every month",
      "Unlimited employees & projects",
      "Priority model routing",
      "Desktop Studio + testing workspace",
      "Mada, Visa, Apple Pay, STC Pay",
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
      "10,000,000 tokens every month",
      "Shared goals, tasks, and memory",
      "Team chat & cowork rooms",
      "Usage controls per session",
      "Priority support",
    ],
  },
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    audience: "organization",
    monthlyTokenLimit: null,
    description: "No monthly token cap for production studios.",
    monthlyPriceHalalas: 39_900,
    currency: "SAR",
    interval: "month",
    badge: "Scale",
    features: [
      "No monthly token cap",
      "Highest throughput routing",
      "Dedicated onboarding",
      "Custom workforce playbooks",
      "Invoice + card via Moyasar",
    ],
  },
};

/** Redeem codes map to plans (studio billing stub until Stripe). */
export const SUBSCRIPTION_REDEEM_CODES: Record<string, SubscriptionPlanId> = {
  "FREE-ARRAB": "free",
  "PRO-ARRAB": "pro",
  "TEAM-ARRAB": "team",
  "UNLIMITED-ARRAB": "unlimited",
};

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
  overLimit: boolean;
  periodStart: string;
  periodEnd: string;
}

export interface AccountStatusResponse {
  connected: boolean;
  account: AccountPublic | null;
  entitlements: AccountEntitlements;
  plans: SubscriptionPlan[];
}
