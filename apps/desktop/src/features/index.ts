/**
 * Feature module helpers — keep new work discoverable and small.
 *
 * @see docs/FEATURE.md
 */
export { isFeatureEnabled, setFeatureFlag, listFeatureFlags, type FeatureFlagId } from "./flags";
export {
  STUDIO_FEATURES,
  pageFeaturesFor,
  navFeaturesFor,
  isFeatureVisible,
} from "./registry";
export type { StudioFeature, FeatureKind } from "./types";
export { RESERVED_FEATURE_PATHS } from "./types";
export {
  SETTINGS_TAB_DEFS,
  SETTINGS_TAB_IDS,
  settingsTabsFor,
  isSettingsTabId,
  type SettingsTabId,
  type SettingsTabDef,
} from "./settings-tabs";
