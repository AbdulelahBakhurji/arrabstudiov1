/**
 * Lightweight feature flags for agile rollout.
 * Prefer short-lived flags — delete once the feature is default-on.
 *
 * Enable via:
 * - localStorage key `arrab.feature.<id>` = "1"
 * - Vite env `VITE_FEATURE_<ID>=1` (e.g. VITE_FEATURE_EXAMPLE_PANEL=1)
 *
 * New modules may pass any kebab id. Built-in ids stay listed for discoverability.
 */
export type FeatureFlagId =
  | "example_panel"
  | "family_board_v2"
  | "settings_experimental"
  | (string & {});

const STORAGE_PREFIX = "arrab.feature.";

function envKey(id: string): string {
  return `VITE_FEATURE_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function envEnabled(id: string): boolean {
  try {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    const raw = env[envKey(id)];
    return raw === true || raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function storageEnabled(id: string): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${id}`) === "1";
  } catch {
    return false;
  }
}

/** Defaults — keep false so production stays stable. */
const DEFAULTS: Record<string, boolean> = {
  example_panel: false,
  family_board_v2: false,
  settings_experimental: false,
};

export function isFeatureEnabled(id: string): boolean {
  if (storageEnabled(id) || envEnabled(id)) return true;
  return Boolean(DEFAULTS[id]);
}

export function setFeatureFlag(id: string, enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, "1");
    else window.localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  } catch {
    // ignore
  }
}

export function registerFeatureFlag(id: string, enabledByDefault = false): void {
  if (!(id in DEFAULTS)) DEFAULTS[id] = enabledByDefault;
}

export function listFeatureFlags(): Array<{ id: string; enabled: boolean }> {
  return Object.keys(DEFAULTS).map((id) => ({ id, enabled: isFeatureEnabled(id) }));
}
