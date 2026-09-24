import type { PlanAudience } from "@arrab/shared";
import type { MessageKey } from "@/i18n/messages";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChartColumn,
  CircleUserRound,
  HardDrive,
  Keyboard,
  KeyRound,
  Monitor,
  Moon,
  Shield,
  Sparkles,
  Sun,
  UsersRound,
  Wand2,
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
  | "skills"
  | "notifications"
  | "privacy"
  | "cowork"
  | "desktop"
  | "shortcuts"
  | "about";

export type SettingsGroupId = "account" | "studio" | "app";

export const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; labelKey: MessageKey }> = [
  { id: "account", labelKey: "settingsGroupAccount" },
  { id: "studio", labelKey: "settingsGroupStudio" },
  { id: "app", labelKey: "settingsGroupApp" },
];

export type SettingsTabDef = {
  id: SettingsTabId;
  labelKey: MessageKey;
  group: SettingsGroupId;
  /** Which studio audiences may see this tab. */
  audiences: PlanAudience[];
  /** Hide from family child profiles. */
  hideForFamilyChild?: boolean;
  icon: LucideIcon;
  /** Appearance uses theme-dependent icon. */
  darkIcon?: LucideIcon;
};

const ALL: PlanAudience[] = ["individual", "family", "organization"];

/**
 * Single source of truth for Settings rail tabs.
 * Adding a settings surface = one entry here + one panel branch in SettingsPage.
 */
export const SETTINGS_TAB_DEFS: SettingsTabDef[] = [
  { id: "account", labelKey: "settingsAccount", group: "account", audiences: ALL, hideForFamilyChild: true, icon: KeyRound },
  { id: "usage", labelKey: "settingsUsage", group: "account", audiences: ALL, hideForFamilyChild: true, icon: ChartColumn },
  { id: "family", labelKey: "settingsFamily", group: "account", audiences: ["family"], hideForFamilyChild: true, icon: UsersRound },
  { id: "general", labelKey: "settingsGeneral", group: "studio", audiences: ALL, icon: CircleUserRound },
  { id: "appearance", labelKey: "settingsAppearance", group: "studio", audiences: ALL, icon: Sun, darkIcon: Moon },
  { id: "models", labelKey: "settingsLocalModels", group: "studio", audiences: ALL, icon: HardDrive },
  { id: "skills", labelKey: "settingsSkills", group: "studio", audiences: ALL, icon: Wand2 },
  { id: "notifications", labelKey: "settingsNotifications", group: "studio", audiences: ALL, icon: Bell },
  { id: "privacy", labelKey: "settingsPrivacy", group: "studio", audiences: ALL, icon: Shield },
  { id: "cowork", labelKey: "settingsCowork", group: "studio", audiences: ["family", "organization"], hideForFamilyChild: true, icon: Workflow },
  { id: "desktop", labelKey: "settingsDesktop", group: "app", audiences: ALL, icon: Monitor },
  { id: "shortcuts", labelKey: "settingsShortcuts", group: "app", audiences: ALL, icon: Keyboard },
  { id: "about", labelKey: "settingsAbout", group: "app", audiences: ALL, icon: Sparkles },
];

export const SETTINGS_TAB_IDS: SettingsTabId[] = SETTINGS_TAB_DEFS.map((t) => t.id);

export function settingsTabsFor(opts: {
  audience: PlanAudience;
  isFamilyChild?: boolean;
  theme?: "light" | "dark";
  /** Family (and other account-bound) tabs only when signed in. */
  signedIn?: boolean;
}): Array<{ id: SettingsTabId; labelKey: MessageKey; icon: LucideIcon; group: SettingsGroupId }> {
  return SETTINGS_TAB_DEFS.filter((tab) => {
    if (!tab.audiences.includes(opts.audience)) return false;
    if (opts.isFamilyChild && tab.hideForFamilyChild) return false;
    // Family household settings: signed-in family plan only.
    if (tab.id === "family" && (!opts.signedIn || opts.audience !== "family")) return false;
    return true;
  }).map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    group: tab.group,
    icon:
      tab.id === "appearance" && opts.theme === "dark" && tab.darkIcon
        ? tab.darkIcon
        : tab.icon,
  }));
}

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return Boolean(value && SETTINGS_TAB_IDS.includes(value as SettingsTabId));
}
