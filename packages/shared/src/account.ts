import type { Brand } from "./ids.js";

export type SubscriptionPlanId = "free" | "pro" | "team" | "unlimited";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";
export type AccountId = Brand<string, "AccountId">;

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  /** Monthly token budget (input + output). null = unlimited. */
  monthlyTokenLimit: number | null;
  description: string;
}

/** Built-in Arrab Studio plans. Limits are total tokens per billing period. */
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyTokenLimit: 100_000,
    description: "Starter allowance for connecting your Arrab account.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyTokenLimit: 2_000_000,
    description: "Higher monthly token budget for daily cowork.",
  },
  team: {
    id: "team",
    name: "Team",
    monthlyTokenLimit: 10_000_000,
    description: "Team-scale token budget for multi-agent studios.",
  },
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    monthlyTokenLimit: null,
    description: "No monthly token cap.",
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
