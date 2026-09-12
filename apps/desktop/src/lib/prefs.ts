export type StudioPrefs = {
  notifyApprovals: boolean;
  notifyTeamLaunch: boolean;
  notifyConnector: boolean;
  notifyCowork: boolean;
  privacyLocalNotes: boolean;
  privacyAnalytics: boolean;
  privacyCrash: boolean;
  coworkAutoResume: boolean;
  coworkEnterSend: boolean;
  coworkTerminalDock: boolean;
  desktopAlwaysOnTop: boolean;
  onDemandEnabled: boolean;
};

export const PREFS_KEY = "arrab.settings.prefs";
export const API_BASE_KEY = "arrab.apiBaseUrl";
export const LAST_COWORK_AGENT_KEY = "arrab.cowork.lastAgent";
export const LAST_CHAT_AGENT_KEY = "arrab.chat.lastAgent";
export const CRASH_LOG_KEY = "arrab.crashLog";
export const PREFS_EVENT = "arrab:prefs";

export const defaultPrefs = (): StudioPrefs => ({
  notifyApprovals: true,
  notifyTeamLaunch: true,
  notifyConnector: true,
  notifyCowork: false,
  privacyLocalNotes: true,
  privacyAnalytics: false,
  privacyCrash: true,
  coworkAutoResume: true,
  coworkEnterSend: true,
  coworkTerminalDock: true,
  desktopAlwaysOnTop: false,
  onDemandEnabled: false,
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
  } else {
    localStorage.setItem(API_BASE_KEY, trimmed);
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
}
