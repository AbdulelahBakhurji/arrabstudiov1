/**
 * Lightweight feature flags for agile rollout.
 * Prefer short-lived flags — delete once the feature is default-on.
 *
 * Enable via:
 * - localStorage key `arrab.feature.<id>` = "1"
 * - Vite env `VITE_FEATURE_<ID>=1` (e.g. VITE_FEATURE_EXAMPLE_PANEL=1)
 */
export type FeatureFlagId =
  | "example_panel"
  | "family_board_v2"
  | "settings_experimental";

const STORAGE_PREFIX = "arrab.feature.";

function envEnabled(id: FeatureFlagId): boolean {
  const key = `VITE_FEATURE_${id.toUpperCase()}`;
  try {
    // Vite inlines import.meta.env at build time.
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    const raw = env[key];
    return raw === true || raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function storageEnabled(id: FeatureFlagId): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${id}`) === "1";
  } catch {
    return false;
  }
}

/** Defaults — keep empty / false so production stays stable. */
const DEFAULTS: Partial<Record<FeatureFlagId, boolean>> = {
  example_panel: false,
  family_board_v2: false,
  settings_experimental: false,
};

export function isFeatureEnabled(id: FeatureFlagId): boolean {
  if (storageEnabled(id) || envEnabled(id)) return true;
  return Boolean(DEFAULTS[id]);
}

export function setFeatureFlag(id: FeatureFlagId, enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, "1");
    else window.localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  } catch {
    // ignore
  }
}

export function listFeatureFlags(): Array<{ id: FeatureFlagId; enabled: boolean }> {
  const ids = Object.keys(DEFAULTS) as FeatureFlagId[];
  return ids.map((id) => ({ id, enabled: isFeatureEnabled(id) }));
}
