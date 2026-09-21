import pkg from "../../package.json";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { readPrefs } from "@/lib/prefs";
import { isTauriRuntime } from "@/lib/terminal";

/** Override with VITE_GITHUB_RELEASES_REPO=owner/name */
const DEFAULT_REPO =
  (import.meta.env.VITE_GITHUB_RELEASES_REPO as string | undefined)?.trim() ||
  "AbdulelahBakhurji/arrabstudiov1";

const NOTIFIED_KEY = "arrab.updates.lastNotifiedVersion";
const CHECKED_KEY = "arrab.updates.lastCheckedAt";

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  notes: string;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
};

type GithubRelease = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    content_type?: string;
  }>;
};

export function currentAppVersion(): string {
  return normalizeVersion(pkg.version);
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

/** Compare dotted semver-ish versions. Returns 1 if a>b, -1 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (typeof left === "number" && typeof right === "number") {
      if (left > right) return 1;
      if (left < right) return -1;
      continue;
    }
    const ls = String(left);
    const rs = String(right);
    if (ls > rs) return 1;
    if (ls < rs) return -1;
  }
  return 0;
}

function detectPlatform(): "mac" | "windows" | "linux" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "other";
}

function pickAsset(
  assets: NonNullable<GithubRelease["assets"]>,
  platform: ReturnType<typeof detectPlatform>,
): { name: string; url: string } | null {
  const list = assets.filter((asset) => asset.name && asset.browser_download_url);
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (platform === "mac") {
      if (n.endsWith(".dmg")) return 100;
      if (n.includes("macos") && n.endsWith(".zip")) return 80;
      if (n.endsWith(".app.tar.gz")) return 70;
      return 0;
    }
    if (platform === "windows") {
      if (n.endsWith(".exe") || n.includes("setup") || n.includes("nsis")) return 100;
      if (n.endsWith(".msi")) return 80;
      return 0;
    }
    if (platform === "linux") {
      if (n.endsWith(".appimage")) return 100;
      if (n.endsWith(".deb")) return 80;
      if (n.endsWith(".rpm")) return 60;
      return 0;
    }
    return 0;
  };
  const scored = list
    .map((asset) => ({
      name: asset.name!,
      url: asset.browser_download_url!,
      score: rank(asset.name!),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0] ? { name: scored[0].name, url: scored[0].url } : null;
}

function releasesApiUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export async function checkForAppUpdate(options?: {
  includePrerelease?: boolean;
  signal?: AbortSignal;
}): Promise<AppUpdateInfo> {
  const current = currentAppVersion();
  const repo = DEFAULT_REPO;
  const response = await fetch(releasesApiUrl(repo), {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: options?.signal,
  });

  if (response.status === 404) {
    return {
      currentVersion: current,
      latestVersion: current,
      available: false,
      notes: "",
      releaseUrl: `https://github.com/${repo}/releases`,
      downloadUrl: null,
      publishedAt: null,
      assetName: null,
    };
  }

  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`);
  }

  const release = (await response.json()) as GithubRelease;
  if (release.draft || (release.prerelease && !options?.includePrerelease)) {
    return {
      currentVersion: current,
      latestVersion: current,
      available: false,
      notes: "",
      releaseUrl: release.html_url ?? `https://github.com/${repo}/releases`,
      downloadUrl: null,
      publishedAt: release.published_at ?? null,
      assetName: null,
    };
  }

  const latest = normalizeVersion(release.tag_name || release.name || "");
  if (!latest) {
    throw new Error("Release has no version tag");
  }

  const asset = pickAsset(release.assets ?? [], detectPlatform());
  const available = compareVersions(latest, current) > 0;

  try {
    localStorage.setItem(CHECKED_KEY, new Date().toISOString());
  } catch {
    // ignore
  }

  return {
    currentVersion: current,
    latestVersion: latest,
    available,
    notes: (release.body ?? "").trim(),
    releaseUrl: release.html_url ?? `https://github.com/${repo}/releases/tag/v${latest}`,
    downloadUrl: asset?.url ?? null,
    publishedAt: release.published_at ?? null,
    assetName: asset?.name ?? null,
  };
}

export async function openAppUpdate(info: AppUpdateInfo): Promise<void> {
  const url = info.downloadUrl || info.releaseUrl;
  await openExternalUrl(url);
}

export function readLastNotifiedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(NOTIFIED_KEY);
  } catch {
    return null;
  }
}

export function markUpdateNotified(version: string): void {
  try {
    localStorage.setItem(NOTIFIED_KEY, normalizeVersion(version));
  } catch {
    // ignore
  }
}

/** Startup / background check — toasts once per available version when prefs allow. */
export async function maybeNotifyAppUpdate(options?: {
  force?: boolean;
  settingsHref?: string;
}): Promise<AppUpdateInfo | null> {
  const prefs = readPrefs();
  if (!prefs.autoCheckUpdates && !options?.force) return null;

  try {
    const info = await checkForAppUpdate();
    if (!info.available) return info;

    const already = readLastNotifiedUpdateVersion();
    const shouldToast =
      options?.force ||
      (prefs.notifyAppUpdates && already !== info.latestVersion);

    if (shouldToast) {
      const ar = typeof document !== "undefined" && document.documentElement.lang === "ar";
      pushToast({
        title: ar ? "تحديث متاح" : "Update available",
        body: ar
          ? `الإصدار ${info.latestVersion} جاهز · الحالي ${info.currentVersion}`
          : `Version ${info.latestVersion} is ready · you have ${info.currentVersion}`,
        tone: "info",
        href: options?.settingsHref ?? "/settings?tab=about",
      });

      if (prefs.notifyAppUpdates && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(ar ? "تحديث Arrab Studio" : "Arrab Studio update", {
            body: ar
              ? `الإصدار ${info.latestVersion} متاح`
              : `Version ${info.latestVersion} is available`,
          });
        } catch {
          // ignore
        }
      }

      markUpdateNotified(info.latestVersion);
    }

    return info;
  } catch {
    return null;
  }
}

export function updatesSupportedInShell(): boolean {
  return isTauriRuntime() || typeof window !== "undefined";
}
