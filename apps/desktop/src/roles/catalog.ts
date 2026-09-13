import {
  Activity,
  Boxes,
  Cable,
  MessageSquare,
  Settings2,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PlanAudience } from "@arrab/shared";
import type { MessageKey } from "@/i18n/messages";

export const ROLE_PATH = {
  individual: "/individuals",
  organization: "/organizations",
} as const;

export type RoleNavItem = {
  key: MessageKey;
  path: string;
  icon: LucideIcon;
  end?: boolean;
};

/**
 * Side-rail destinations when using the studio as an individual.
 * Individuals get companions, not a workforce — Workforce is organizations only.
 */
export const INDIVIDUAL_NAV: RoleNavItem[] = [
  { key: "studio", path: "", icon: Sparkles, end: true },
  { key: "companions", path: "/companions", icon: UsersRound },
  { key: "connectors", path: "/connectors", icon: Cable },
  { key: "settings", path: "/settings", icon: Settings2 },
];

/** Side-rail destinations when using the studio as an organization. */
export const ORGANIZATION_NAV: RoleNavItem[] = [
  { key: "studio", path: "", icon: Sparkles, end: true },
  { key: "chat", path: "/chat", icon: MessageSquare },
  { key: "cowork", path: "/cowork", icon: Boxes },
  { key: "workforce", path: "/workforce", icon: UsersRound },
  { key: "connectors", path: "/connectors", icon: Cable },
  { key: "activity", path: "/activity", icon: Activity },
  { key: "settings", path: "/settings", icon: Settings2 },
];

export function navForRole(role: PlanAudience): RoleNavItem[] {
  return role === "organization" ? ORGANIZATION_NAV : INDIVIDUAL_NAV;
}

export function rolePath(audience: PlanAudience): string {
  return audience === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual;
}
