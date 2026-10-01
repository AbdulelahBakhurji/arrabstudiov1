import type { Maintenance } from "./types";

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
};

export function parseSemver(value: string): ParsedSemver | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4]
      ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  };
}

/**
 * Semver precedence: 1 if a > b, -1 if a < b, 0 if equal.
 * `0.12.10 > 0.12.9` and `0.12.1-beta < 0.12.1`. Unparseable versions sort lowest.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  const lp = left.prerelease;
  const rp = right.prerelease;
  if (!lp.length && !rp.length) return 0;
  if (!lp.length) return 1;
  if (!rp.length) return -1;
  for (let i = 0; i < Math.max(lp.length, rp.length); i += 1) {
    const l = lp[i];
    const r = rp[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "number") return l > r ? 1 : -1;
    if (typeof l === "number") return -1;
    if (typeof r === "number") return 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

export type UpdateMode = "blocking" | "soft" | "none";

/**
 * blocking: below `minVersion` (full overlay, sending disabled).
 * soft: `requireUpdate` or a newer `latestVersion` (dismissible banner).
 * A soft `requireUpdate` is only shown when a newer build can actually exist.
 */
export function resolveUpdateMode(appVersion: string, maintenance: Maintenance | null): UpdateMode {
  if (!maintenance) return "none";
  if (maintenance.minVersion && compareSemver(appVersion, maintenance.minVersion) < 0) {
    return "blocking";
  }
  const newer = maintenance.latestVersion
    ? compareSemver(maintenance.latestVersion, appVersion) > 0
    : null;
  if (maintenance.requireUpdate && newer !== false) return "soft";
  if (newer) return "soft";
  return "none";
}

export const SOFT_REMIND_MS = 24 * 60 * 60 * 1000;

export function shouldShowSoftBanner(dismissedAt: number | null, now: number): boolean {
  return dismissedAt === null || now - dismissedAt >= SOFT_REMIND_MS;
}

export const ANDROID_PACKAGE = "com.arrab.studio";

/**
 * Mobile store link. `downloadUrl` wins when the server sends an allowlisted one;
 * otherwise Galaxy Store for Samsung, AppGallery for Huawei, Play for the rest.
 */
export function storeUrlFor(
  platform: string,
  vendor: string,
  downloadUrl: string | null,
  isAllowed: (url: string) => boolean,
): string | null {
  if (downloadUrl && isAllowed(downloadUrl)) return downloadUrl;
  if (platform === "android") {
    if (vendor === "samsung") return `https://galaxystore.samsung.com/detail/${ANDROID_PACKAGE}`;
    // TODO(contract): AppGallery needs the numeric app id (C1xxxxxxx); the server should send downloadUrl.
    if (vendor === "huawei") return "https://appgallery.huawei.com/";
    return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  }
  // TODO(contract): App Store id is not in the contract; iOS relies on downloadUrl.
  return null;
}

/** `0.12.1` → `"1201"` (major·10000 + minor·100 + patch). */
export function buildNumberFor(version: string): string {
  const parsed = parseSemver(version);
  if (!parsed) return "0";
  return String(parsed.major * 10_000 + parsed.minor * 100 + parsed.patch);
}

export type MaintenanceView = {
  updateMode: UpdateMode;
  readOnly: boolean;
  /** Top banner for readOnly / info notices. */
  showMessage: boolean;
  sendBlocked: boolean;
  uploadsBlocked: boolean;
};

export function maintenanceView(
  appVersion: string,
  maintenance: Maintenance | null,
  forcedBlocking = false,
): MaintenanceView {
  const mode = forcedBlocking ? "blocking" : resolveUpdateMode(appVersion, maintenance);
  const readOnly = Boolean(maintenance?.readOnly);
  return {
    updateMode: mode,
    readOnly,
    showMessage: readOnly || Boolean(maintenance?.message && mode === "none"),
    sendBlocked: mode === "blocking" || readOnly,
    uploadsBlocked: readOnly || mode === "blocking",
  };
}

/** "Back at HH:MM" in the user's timezone; null if `until` is missing or past. */
export function formatBackAt(
  until: string | null,
  locale: string,
  now: number,
  timeZone?: string,
): string | null {
  if (!until) return null;
  const at = Date.parse(until);
  if (!Number.isFinite(at) || at <= now) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(at));
  } catch {
    return null;
  }
}
