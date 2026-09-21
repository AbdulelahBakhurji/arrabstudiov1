import {
  Activity,
  Briefcase,
  Brain,
  Building2,
  LayoutGrid,
  ListTodo,
  UserRound,
  Cable,
  MessageSquare,
  Settings2,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  SUBSCRIPTION_PLANS,
  type PlanAudience,
  type SubscriptionPlanId,
} from "@arrab/shared";
import type { MessageKey } from "@/i18n/messages";

export const ROLE_PATH = {
  individual: "/individuals",
  family: "/individuals",
  organization: "/organizations",
} as const;

/** Audience locked by the account plan (Individuals / Family / Org). */
export function audienceFromPlanId(
  planId: SubscriptionPlanId | null | undefined,
): PlanAudience {
  if (!planId) return "individual";
  return SUBSCRIPTION_PLANS[planId]?.audience ?? "individual";
}

/**
 * Studio shell from the account plan.
 * Individual + Family share the individuals routes; Org uses organizations.
 * Free trial uses the same mapping via planId.
 */
export function studioModeFromPlanId(
  planId: SubscriptionPlanId | null | undefined,
): "individual" | "organization" {
  return audienceFromPlanId(planId) === "organization" ? "organization" : "individual";
}

export function homePathForPlanId(
  planId: SubscriptionPlanId | null | undefined,
): string {
  return studioModeFromPlanId(planId) === "organization"
    ? ROLE_PATH.organization
    : ROLE_PATH.individual;
}

export type RoleNavItem = {
  key: MessageKey;
  path: string;
  icon: LucideIcon;
  end?: boolean;
};

/**
 * Individuals — studio, chat, cowork, activity, settings (no workforce).
 */
export const INDIVIDUAL_NAV: RoleNavItem[] = [
  { key: "chat", path: "", icon: MessageSquare, end: true },
  { key: "studio", path: "/studio", icon: Sparkles },
  { key: "compBoard", path: "/board", icon: LayoutGrid },
  { key: "brainNav", path: "/brain", icon: Brain },
  { key: "compWork", path: "/work", icon: ListTodo },
  { key: "compMe", path: "/me", icon: UserRound },
  { key: "settings", path: "/settings", icon: Settings2 },
];

/**
 * Family — studio, chat, cowork, connectors, activity, settings (no workforce).
 */
export const FAMILY_NAV: RoleNavItem[] = [
  { key: "chat", path: "", icon: MessageSquare, end: true },
  { key: "studio", path: "/studio", icon: Sparkles },
  { key: "compWork", path: "/work", icon: ListTodo },
  { key: "connectors", path: "/connectors", icon: Cable },
  { key: "compBoard", path: "/board", icon: LayoutGrid },
  { key: "settings", path: "/settings", icon: Settings2 },
];

/**
 * Organizations — full suite including workforce.
 */
export const ORGANIZATION_NAV: RoleNavItem[] = [
  { key: "hq", path: "", icon: Building2, end: true },
  { key: "workplace", path: "/workplace", icon: Briefcase },
  { key: "chat", path: "/chat", icon: MessageSquare },
  { key: "brainNav", path: "/brain", icon: Brain },
  { key: "workforce", path: "/workforce", icon: UsersRound },
  { key: "connectors", path: "/connectors", icon: Cable },
  { key: "activity", path: "/activity", icon: Activity },
  { key: "settings", path: "/settings", icon: Settings2 },
];

export function navForRole(role: PlanAudience): RoleNavItem[] {
  if (role === "organization") return ORGANIZATION_NAV;
  if (role === "family") return FAMILY_NAV;
  return INDIVIDUAL_NAV;
}

export function rolePath(audience: PlanAudience): string {
  return audience === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual;
}

/** True when the plan may use Workforce (org only). */
export function canUseWorkforce(planId: SubscriptionPlanId | null | undefined): boolean {
  return audienceFromPlanId(planId) === "organization";
}
