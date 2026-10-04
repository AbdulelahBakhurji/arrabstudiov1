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
  resolvePlanAudience,
  type PlanAudience,
  type SubscriptionPlanId,
} from "@arrab/shared";
import type { MessageKey } from "@/shared/i18n/messages";
import { navFeaturesFor } from "@/features/registry";

export const ROLE_PATH = {
  individual: "/individuals",
  family: "/individuals",
  organization: "/organizations",
} as const;

/** Audience locked by the account plan (Individuals / Family / Org). */
export function audienceFromPlanId(
  planId: SubscriptionPlanId | string | null | undefined,
): PlanAudience {
  return resolvePlanAudience({ planId });
}

/**
 * Prefer control-plane planCategory (teams → organization), then plan id / name.
 * Business / Enterprise / Team / Platform Admin all resolve to organization.
 */
export function audienceFromAccountSignals(input: {
  planId?: string | null;
  planCategory?: string | null;
  planName?: string | null;
}): PlanAudience {
  return resolvePlanAudience(input);
}

/**
 * Studio shell from the account plan.
 * Individual + Family share the individuals routes; Org uses organizations.
 * Free trial uses the same mapping via planId.
 */
export function studioModeFromPlanId(
  planId: SubscriptionPlanId | string | null | undefined,
): "individual" | "organization" {
  return audienceFromPlanId(planId) === "organization" ? "organization" : "individual";
}

export function studioModeFromAudience(
  audience: PlanAudience,
): "individual" | "organization" {
  return audience === "organization" ? "organization" : "individual";
}

export function homePathForPlanId(
  planId: SubscriptionPlanId | string | null | undefined,
): string {
  return studioModeFromPlanId(planId) === "organization"
    ? ROLE_PATH.organization
    : ROLE_PATH.individual;
}

export function homePathForAudience(audience: PlanAudience): string {
  return studioModeFromAudience(audience) === "organization"
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
 * Family — full individual suite plus connectors.
 * Chat stays first so kids and parents land on conversation.
 */
export const FAMILY_NAV: RoleNavItem[] = [
  { key: "chat", path: "", icon: MessageSquare, end: true },
  { key: "studio", path: "/studio", icon: Sparkles },
  { key: "compBoard", path: "/board", icon: LayoutGrid },
  { key: "brainNav", path: "/brain", icon: Brain },
  { key: "compWork", path: "/work", icon: ListTodo },
  { key: "compMe", path: "/me", icon: UserRound },
  { key: "connectors", path: "/connectors", icon: Cable },
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

/** Organization destinations a seat role may open (the billing owner sees all). */
const ORG_NAV_BY_SEAT_ROLE: Record<"admin" | "manager" | "member", ReadonlySet<string> | null> = {
  admin: null,
  manager: new Set([
    "hq",
    "workplace",
    "chat",
    "brainNav",
    "connectors",
    "activity",
    "settings",
    "professionalDeskTitle",
  ]),
  member: new Set(["hq", "workplace", "chat", "brainNav", "connectors", "settings"]),
};

/** True when a seat of this role may open the organization page behind `key`. */
export function orgSeatCanOpen(
  seatRole: "admin" | "manager" | "member" | null | undefined,
  key: string,
): boolean {
  if (!seatRole) return true;
  const allowed = ORG_NAV_BY_SEAT_ROLE[seatRole];
  return allowed === null || allowed.has(key);
}

export function navForRole(
  role: PlanAudience,
  opts?: { isFamilyChild?: boolean; orgSeatRole?: "admin" | "manager" | "member" | null },
): RoleNavItem[] {
  const base =
    role === "organization"
      ? ORGANIZATION_NAV.filter((item) => orgSeatCanOpen(opts?.orgSeatRole, item.key))
      : role === "family"
        ? FAMILY_NAV
        : INDIVIDUAL_NAV;
  const extras = navFeaturesFor(role, opts).map((feature) => ({
    key: feature.titleKey,
    path: `/${feature.path}`,
    icon: feature.icon,
  }));
  if (extras.length === 0) return base;
  const settingsAt = base.findIndex((item) => item.key === "settings");
  if (settingsAt < 0) return [...base, ...extras];
  return [...base.slice(0, settingsAt), ...extras, ...base.slice(settingsAt)];
}

export function rolePath(audience: PlanAudience): string {
  return audience === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual;
}

/** True when the plan may use Workforce (org only). */
export function canUseWorkforce(
  planId: SubscriptionPlanId | string | null | undefined,
  extras?: { planCategory?: string | null; planName?: string | null },
): boolean {
  return (
    audienceFromAccountSignals({
      planId,
      planCategory: extras?.planCategory,
      planName: extras?.planName,
    }) === "organization"
  );
}
