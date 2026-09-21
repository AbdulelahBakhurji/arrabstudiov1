/**
 * Feature module helpers — keep new work discoverable and small.
 *
 * @see docs/FEATURE.md
 */
export { isFeatureEnabled, setFeatureFlag, listFeatureFlags, type FeatureFlagId } from "./flags";
export {
  SETTINGS_TAB_DEFS,
  SETTINGS_TAB_IDS,
  settingsTabsFor,
  isSettingsTabId,
  type SettingsTabId,
  type SettingsTabDef,
} from "./settings-tabs";
