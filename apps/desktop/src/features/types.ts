import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { PlanAudience } from "@arrab/shared";
import type { MessageKey } from "@/i18n/messages";

export type FeatureKind = "page";

/**
 * Plug-in Studio feature. Drop a module in `features/modules/<id>/`
 * that exports `feature` — routes and nav pick it up automatically.
 */
export type StudioFeature = {
  id: string;
  kind: FeatureKind;
  /** Path segment, no leading slash. Must be unique and not reserved. */
  path: string;
  audiences: PlanAudience[];
  titleKey: MessageKey;
  icon: LucideIcon;
  Page: ComponentType;
  /** Show on the side rail (inserted before Settings). */
  nav?: boolean;
  /** Hidden until `isFeatureEnabled(flag)` is true. */
  flag?: string;
  hideForFamilyChild?: boolean;
};

export const RESERVED_FEATURE_PATHS = new Set([
  "",
  "studio",
  "board",
  "brain",
  "work",
  "me",
  "companions",
  "connectors",
  "account",
  "settings",
  "chat",
  "cowork",
  "workforce",
  "activity",
  "workplace",
  "desk",
  "plans",
]);
