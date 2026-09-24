export type MonthlySpendLimit = "disabled" | "unlimited" | "25" | "50" | "100" | "200" | "500";

export type StudioPrefs = {
  notifyApprovals: boolean;
  notifyTeamLaunch: boolean;
  notifyConnector: boolean;
  notifyCowork: boolean;
  /** Floating macOS-style agent presence HUD with photo + progress. */
  notifyAgentPresence: boolean;
  /** Toast / OS banner when a new desktop build is published. */
  notifyAppUpdates: boolean;
  /** Check GitHub releases for a newer Arrab Studio on launch. */
  autoCheckUpdates: boolean;
  privacyLocalNotes: boolean;
  privacyAnalytics: boolean;
  privacyCrash: boolean;
  coworkAutoResume: boolean;
  coworkEnterSend: boolean;
  coworkTerminalDock: boolean;
  desktopAlwaysOnTop: boolean;
  onDemandEnabled: boolean;
  /** Soft monthly on-demand spend ceiling in USD, or disabled/unlimited. */
  monthlySpendLimit: MonthlySpendLimit;
  /** Preferred assistant family in Settings → AI. */
  aiPreferredFamily: "auto" | "chatgpt" | "claude";
  /** Exact model id when set (OpenRouter slash id or provider-native). */
  aiPreferredModel: string;
  /** Prefer on-device Ollama models (works offline after download). */
  aiLocalEnabled: boolean;
  /** Ollama model tag, e.g. llama3.2:3b */
  aiLocalModel: string;
  /** Ollama base URL */
  aiLocalBaseUrl: string;
};

export const PREFS_KEY = "arrab.settings.prefs";
export const API_BASE_KEY = "arrab.apiBaseUrl";
/** Optional path prefix in front of `/health` and `/v1/*` (Coolify/Traefik public URL). */
export const API_ROUTE_PREFIX_KEY = "arrab.apiRoutePrefix";
export const LAST_COWORK_AGENT_KEY = "arrab.cowork.lastAgent";
export const LAST_CHAT_AGENT_KEY = "arrab.chat.lastAgent";
export const CRASH_LOG_KEY = "arrab.crashLog";
export const PREFS_EVENT = "arrab:prefs";

export const defaultPrefs = (): StudioPrefs => ({
  notifyApprovals: true,
  notifyTeamLaunch: true,
  notifyConnector: true,
  notifyCowork: false,
  notifyAgentPresence: true,
  notifyAppUpdates: true,
  autoCheckUpdates: true,
  privacyLocalNotes: true,
  privacyAnalytics: false,
  privacyCrash: true,
  coworkAutoResume: true,
  coworkEnterSend: true,
  coworkTerminalDock: true,
  desktopAlwaysOnTop: false,
  onDemandEnabled: false,
  monthlySpendLimit: "disabled",
  aiPreferredFamily: "auto",
  aiPreferredModel: "",
  aiLocalEnabled: false,
  aiLocalModel: "llama3.2:3b",
  aiLocalBaseUrl: "http://127.0.0.1:11434",
});

export function readPrefs(): StudioPrefs {
  try {
    return {
      ...defaultPrefs(),
      ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<StudioPrefs>),
    };
  } catch {
    return defaultPrefs();
  }
}

export function writePrefs(prefs: StudioPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: prefs }));
}

export function updatePrefs(patch: Partial<StudioPrefs>): StudioPrefs {
  const next = { ...readPrefs(), ...patch };
  writePrefs(next);
  return next;
}

export function subscribePrefs(listener: (prefs: StudioPrefs) => void): () => void {
  const onPrefs = (event: Event) => {
    const detail = (event as CustomEvent<StudioPrefs>).detail;
    listener(detail ?? readPrefs());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFS_KEY) {
      listener(readPrefs());
    }
  };
  window.addEventListener(PREFS_EVENT, onPrefs);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREFS_EVENT, onPrefs);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Split a pasted API URL into origin + optional Coolify path.
 * Never keep `/r/...` (or any path) inside the base URL field.
 */
export function splitApiBaseAndPrefix(raw: string): { base: string; prefix: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return { base: "", prefix: "" };
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "") || "";
    const base = `${url.protocol}//${url.host}`;
    if (!path || path === "/") return { base, prefix: "" };
    return { base, prefix: path.startsWith("/") ? path : `/${path}` };
  } catch {
    return { base: trimmed, prefix: "" };
  }
}

export function readApiBaseOverride(): string | null {
  try {
    const value = localStorage.getItem(API_BASE_KEY)?.trim();
    return value ? value.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export function writeApiBaseOverride(url: string | null): void {
  const trimmed = url?.trim().replace(/\/$/, "") ?? "";
  if (!trimmed) {
    localStorage.removeItem(API_BASE_KEY);
    return;
  }
  // Origin only — peel any accidental Coolify path into the prefix key.
  const { base, prefix } = splitApiBaseAndPrefix(trimmed);
  localStorage.setItem(API_BASE_KEY, base);
  if (prefix) {
    const existing = localStorage.getItem(API_ROUTE_PREFIX_KEY);
    if (existing === null || !existing.trim()) {
      localStorage.setItem(API_ROUTE_PREFIX_KEY, prefix);
    }
  }
}

/** Normalize `/r/foo` or `r/foo/` → `/r/foo`. Empty string clears. */
export function normalizeApiRoutePrefix(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // If someone pasted a full URL into the prefix field, keep only the path.
  if (/^https?:\/\//i.test(trimmed)) {
    return splitApiBaseAndPrefix(trimmed).prefix;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function readApiRoutePrefixOverride(): string | null {
  try {
    const raw = localStorage.getItem(API_ROUTE_PREFIX_KEY);
    if (raw === null) return null;
    return normalizeApiRoutePrefix(raw);
  } catch {
    return null;
  }
}

export function writeApiRoutePrefixOverride(prefix: string | null): void {
  if (prefix === null) {
    localStorage.removeItem(API_ROUTE_PREFIX_KEY);
    return;
  }
  const normalized = normalizeApiRoutePrefix(prefix);
  if (!normalized) {
    localStorage.setItem(API_ROUTE_PREFIX_KEY, "");
  } else {
    localStorage.setItem(API_ROUTE_PREFIX_KEY, normalized);
  }
}

export type CrashEntry = {
  at: string;
  message: string;
  source?: string;
};

export function readCrashLog(): CrashEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CRASH_LOG_KEY) ?? "[]") as CrashEntry[];
    return Array.isArray(raw) ? raw.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function recordCrash(message: string, source?: string): void {
  if (!readPrefs().privacyCrash) {
    return;
  }
  const next: CrashEntry[] = [
    { at: new Date().toISOString(), message: message.slice(0, 500), source },
    ...readCrashLog(),
  ].slice(0, 40);
  localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(next));
}

export function clearCrashLog(): void {
  localStorage.removeItem(CRASH_LOG_KEY);
}

/** Local studio keys that Settings can wipe without touching API secrets. */
export const CLEARABLE_LOCAL_KEYS = [
  PREFS_KEY,
  API_BASE_KEY,
  API_ROUTE_PREFIX_KEY,
  CRASH_LOG_KEY,
  LAST_COWORK_AGENT_KEY,
  LAST_CHAT_AGENT_KEY,
  "arrab.account.session",
  "arrab.cowork.folder",
  "arrab.chat.workspace",
  "arrab.workforce.ops",
  "arrab.workforce.directives",
  "arrab.workforce.teamMeta",
  "arrab.incognito.apiIds",
  "arrab.profile.photo",
  "arrab.firstLaunchSetup",
] as const;

export function clearLocalStudioData(options?: { keepAppearance?: boolean }): void {
  for (const key of CLEARABLE_LOCAL_KEYS) {
    localStorage.removeItem(key);
  }
  const notePrefixes = ["arrab.coworkNotes.", "arrab.chatNotes."];
  const remove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && notePrefixes.some((prefix) => key.startsWith(prefix))) {
      remove.push(key);
    }
  }
  for (const key of remove) {
    localStorage.removeItem(key);
  }
  if (!options?.keepAppearance) {
    // appearance stays unless full wipe requested
  }
  writePrefs(defaultPrefs());
  void import("./device-cache").then(({ clearDeviceCache }) => clearDeviceCache());
  void import("./chat-history").then(({ clearChatHistory }) => clearChatHistory());
  void import("./incognito-vault").then(({ wipeIncognitoVault }) => wipeIncognitoVault());
  void import("./second-brain").then(({ clearAllBrainPartitions }) => clearAllBrainPartitions());
}
