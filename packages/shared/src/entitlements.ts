import { SUBSCRIPTION_PLANS, type PlanAudience, type SubscriptionPlanId } from "./account.js";

/**
 * What a plan actually unlocks, as machine-checkable data. The marketing copy in `SUBSCRIPTION_PLANS`
 * is for humans; the server enforces *this*. Adding a plan without an entry here fails the tests,
 * so a new SKU can never silently inherit another plan's access.
 */
export interface PlanFeatures {
  /** AI employees that may exist at once (non-archived). `null` = no plan limit. */
  maxAgents: number | null;
  /** Organization workforce: employee seats, departments, org-wide views. */
  orgWorkforce: boolean;
  /** Household seats, parental controls. */
  familyHousehold: boolean;
  /** Live office map. */
  liveMap: boolean;
}

export interface PlanEntitlements extends PlanFeatures {
  planId: SubscriptionPlanId;
  audience: PlanAudience;
  /** Monthly token pool (plan only; packs are added on top). Always hard-capped. */
  monthlyTokens: number;
  /** Seats the plan includes for its audience (org employees / household members); 0 when n/a. */
  seats: number;
  includedDeepseekHalalas: number;
  includedOtherHalalas: number;
}

const INDIVIDUAL: PlanFeatures = {
  maxAgents: null,
  orgWorkforce: false,
  familyHousehold: false,
  liveMap: false,
};
const FAMILY: PlanFeatures = {
  maxAgents: null,
  orgWorkforce: false,
  familyHousehold: true,
  liveMap: false,
};
const ORG: PlanFeatures = {
  maxAgents: null,
  orgWorkforce: true,
  familyHousehold: false,
  liveMap: false,
};

/**
 * Keep in step with the plan descriptions ("Workforce ops & Live Map" = Business, Enterprise).
 *
 * `maxAgents` is `null` everywhere ON PURPOSE. The Free plan advertises a single desk, but the
 * desktop creates one backing agent per companion / chat room / workspace, so a hard server cap of 1
 * would break Free users' ordinary chats.
 */
const FEATURES: Record<SubscriptionPlanId, PlanFeatures> = {
  free: INDIVIDUAL,
  starter: INDIVIDUAL,
  pro: INDIVIDUAL,
  max: INDIVIDUAL,
  solo: INDIVIDUAL,
  studio: INDIVIDUAL,
  family_free: FAMILY,
  family: FAMILY,
  family_plus: FAMILY,
  team: ORG,
  business: { ...ORG, liveMap: true },
  enterprise: { ...ORG, liveMap: true },
  unlimited: ORG,
};

export function entitlementsForPlan(planId: SubscriptionPlanId): PlanEntitlements {
  const plan = SUBSCRIPTION_PLANS[planId];
  return {
    planId,
    audience: plan.audience,
    monthlyTokens: plan.monthlyTokenLimit,
    seats: plan.seatLimit ?? 0,
    includedDeepseekHalalas: plan.includedDeepseekHalalas ?? 0,
    includedOtherHalalas: plan.includedOtherHalalas ?? 0,
    ...FEATURES[planId],
  };
}

export function isKnownPlanId(value: string | null | undefined): value is SubscriptionPlanId {
  return (
    Boolean(value) && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, value as string)
  );
}

/** Plan ids a plan change to `to` counts as a downgrade for (monthly price strictly lower). */
export function isDowngrade(from: SubscriptionPlanId, to: SubscriptionPlanId): boolean {
  const fromPrice =
    SUBSCRIPTION_PLANS[from].pricePerSeatHalalas ?? SUBSCRIPTION_PLANS[from].monthlyPriceHalalas;
  const toPrice =
    SUBSCRIPTION_PLANS[to].pricePerSeatHalalas ?? SUBSCRIPTION_PLANS[to].monthlyPriceHalalas;
  return toPrice < fromPrice;
}

export const ALL_PLAN_IDS = Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlanId[];
