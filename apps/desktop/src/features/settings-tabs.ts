import type { PlanAudience } from "@arrab/shared";
import type { MessageKey } from "@/i18n/messages";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChartColumn,
  CircleUserRound,
  Cable,
  HardDrive,
  Keyboard,
  KeyRound,
  Monitor,
  Moon,
  Shield,
  Sparkles,
  Sun,
  UsersRound,
  Workflow,
} from "lucide-react";

/** Settings tab ids — add a new tab here, then render its panel in SettingsPage. */
export type SettingsTabId =
  | "usage"
  | "family"
  | "account"
  | "general"
  | "appearance"
  | "models"
  | "notifications"
  | "privacy"
  | "cowork"
  | "desktop"
  | "connection"
  | "shortcuts"
  | "about";

export type SettingsTabDef = {
  id: SettingsTabId;
  labelKey: MessageKey;
  /** Which studio audiences may see this tab. */
  audiences: PlanAudience[];
  /** Hide from family child profiles. */
  hideForFamilyChild?: boolean;
  icon: LucideIcon;
  /** Appearance uses theme-dependent icon. */
  darkIcon?: LucideIcon;
};

/**
 * Single source of truth for Settings rail tabs.
 * Adding a settings surface = one entry here + one panel branch in SettingsPage.
 */
export const SETTINGS_TAB_DEFS: SettingsTabDef[] = [
  {
    id: "usage",
    labelKey: "settingsUsage",
    audiences: ["individual", "family", "organization"],
    icon: ChartColumn,
  },
  {
    id: "family",
    labelKey: "settingsFamily",
    audiences: ["family"],
    hideForFamilyChild: true,
    icon: UsersRound,
  },
  {
    id: "account",
    labelKey: "settingsAccount",
    audiences: ["individual", "family", "organization"],
    icon: KeyRound,
  },
  {
    id: "general",
    labelKey: "settingsGeneral",
    audiences: ["individual", "family", "organization"],
    icon: CircleUserRound,
  },
  {
    id: "appearance",
    labelKey: "settingsAppearance",
    audiences: ["individual", "family", "organization"],
    icon: Sun,
    darkIcon: Moon,
  },
  {
    id: "models",
    labelKey: "settingsLocalModels",
    audiences: ["individual", "family", "organization"],
    icon: HardDrive,
  },
  {
    id: "notifications",
    labelKey: "settingsNotifications",
    audiences: ["individual", "family", "organization"],
    icon: Bell,
  },
  {
    id: "privacy",
    labelKey: "settingsPrivacy",
    audiences: ["individual", "family", "organization"],
    icon: Shield,
  },
  {
    id: "cowork",
    labelKey: "settingsCowork",
    audiences: ["family", "organization"],
    icon: Workflow,
  },
  {
    id: "desktop",
    labelKey: "settingsDesktop",
    audiences: ["individual", "family", "organization"],
    icon: Monitor,
  },
  {
    id: "connection",
    labelKey: "amApiEndpoint",
    audiences: ["individual", "family", "organization"],
    icon: Cable,
  },
  {
    id: "shortcuts",
    labelKey: "settingsShortcuts",
    audiences: ["individual", "family", "organization"],
    icon: Keyboard,
  },
  {
    id: "about",
    labelKey: "settingsAbout",
    audiences: ["individual", "family", "organization"],
    icon: Sparkles,
  },
];

export const SETTINGS_TAB_IDS: SettingsTabId[] = SETTINGS_TAB_DEFS.map((t) => t.id);

export function settingsTabsFor(opts: {
  audience: PlanAudience;
  isFamilyChild?: boolean;
  theme?: "light" | "dark";
}): Array<{ id: SettingsTabId; labelKey: MessageKey; icon: LucideIcon }> {
  return SETTINGS_TAB_DEFS.filter((tab) => {
    if (!tab.audiences.includes(opts.audience)) return false;
    if (opts.isFamilyChild && tab.hideForFamilyChild) return false;
    return true;
  }).map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    icon:
      tab.id === "appearance" && opts.theme === "dark" && tab.darkIcon
        ? tab.darkIcon
        : tab.icon,
  }));
}

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return Boolean(value && SETTINGS_TAB_IDS.includes(value as SettingsTabId));
}
