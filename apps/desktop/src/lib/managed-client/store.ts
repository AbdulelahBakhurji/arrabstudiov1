import { useSyncExternalStore } from "react";
import { deviceStoreRemove, deviceStoreSetJson } from "@/lib/device-store";
import type { ShowMessagePayload } from "./commands";
import {
  parseConfig,
  parseMaintenance,
  type ActiveScreen,
  type ClientConfig,
  type ClientNotification,
  type Maintenance,
} from "./types";

/** deviceStore mirrors the "secure" namespace here; the menu-bar panel reads it too. */
export const CONFIG_MIRROR_KEY = "arrab.device.secure.managed.config";
const CONFIG_KEY = "managed.config";
const MAINTENANCE_KEY = "arrab.managed.maintenance";
const INBOX_KEY = "arrab.managed.inbox.v1";
const SOFT_DISMISS_KEY = "arrab.managed.softUpdateDismissedAt";
const INBOX_MAX = 50;

export type ManagedInboxItem = ClientNotification & { receivedAt: number; read: boolean };

export type ManagedState = {
  maintenance: Maintenance | null;
  config: ClientConfig | null;
  forcedUpdate: { blocking: boolean } | null;
  message: ShowMessagePayload | null;
  inbox: ManagedInboxItem[];
  softDismissedAt: number | null;
  /** Latest 402/429 text from the server (source of truth for limits). */
  serverLimitMessage: string | null;
  activeScreen: ActiveScreen;
  activeCompanionId: string | null;
  /** The user chose "Read my chats" on the blocking overlay this session. */
  blockingCollapsed: boolean;
};

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

function readInbox(): ManagedInboxItem[] {
  const raw = readJson(INBOX_KEY);
  return Array.isArray(raw) ? (raw as ManagedInboxItem[]).slice(0, INBOX_MAX) : [];
}

function readNumber(key: string): number | null {
  const raw = readJson(key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function initialState(): ManagedState {
  if (typeof localStorage === "undefined") {
    return {
      maintenance: null,
      config: null,
      forcedUpdate: null,
      message: null,
      inbox: [],
      softDismissedAt: null,
      serverLimitMessage: null,
      activeScreen: "other",
      activeCompanionId: null,
      blockingCollapsed: false,
    };
  }
  return {
    maintenance: parseMaintenance(readJson(MAINTENANCE_KEY)),
    config: parseConfig(readJson(CONFIG_MIRROR_KEY)),
    forcedUpdate: null,
    message: null,
    inbox: readInbox(),
    softDismissedAt: readNumber(SOFT_DISMISS_KEY),
    serverLimitMessage: null,
    activeScreen: "other",
    activeCompanionId: null,
    blockingCollapsed: false,
  };
}

let state: ManagedState = initialState();
const listeners = new Set<() => void>();

function set(patch: Partial<ManagedState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** Fresh read of what the main window cached — for other windows (menu-bar panel). */
export function readCachedPolicy(): { config: ClientConfig | null; maintenance: Maintenance | null } {
  return {
    config: parseConfig(readJson(CONFIG_MIRROR_KEY)),
    maintenance: parseMaintenance(readJson(MAINTENANCE_KEY)),
  };
}

export function getManagedState(): ManagedState {
  return state;
}

export function subscribeManaged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useManagedState(): ManagedState {
  return useSyncExternalStore(subscribeManaged, getManagedState, getManagedState);
}

export function setMaintenance(maintenance: Maintenance | null): void {
  writeJson(MAINTENANCE_KEY, maintenance);
  set({ maintenance });
}

/** A response without `config` keeps the cached one. */
export function setConfig(config: ClientConfig | null): void {
  if (!config) return;
  void deviceStoreSetJson("secure", CONFIG_KEY, config);
  set({ config });
}

export async function clearCachedConfig(): Promise<void> {
  await deviceStoreRemove("secure", CONFIG_KEY);
  set({ config: null });
}

export function setForcedUpdate(forcedUpdate: { blocking: boolean } | null): void {
  set({ forcedUpdate });
}

export function setBlockingCollapsed(blockingCollapsed: boolean): void {
  set({ blockingCollapsed });
}

export function setManagedMessage(message: ShowMessagePayload | null): void {
  set({ message });
}

export function setServerLimitMessage(serverLimitMessage: string | null): void {
  if (serverLimitMessage === state.serverLimitMessage) return;
  set({ serverLimitMessage });
}

export function dismissSoftUpdate(now = Date.now()): void {
  writeJson(SOFT_DISMISS_KEY, now);
  set({ softDismissedAt: now });
}

export function setManagedPresence(patch: {
  activeScreen?: ActiveScreen;
  activeCompanionId?: string | null;
}): void {
  const next = {
    activeScreen: patch.activeScreen ?? state.activeScreen,
    activeCompanionId:
      patch.activeCompanionId !== undefined ? patch.activeCompanionId : state.activeCompanionId,
  };
  if (
    next.activeScreen === state.activeScreen &&
    next.activeCompanionId === state.activeCompanionId
  ) {
    return;
  }
  set(next);
}

export function addInboxItem(item: ClientNotification, now = Date.now()): void {
  if (state.inbox.some((existing) => existing.id === item.id)) return;
  const inbox = [{ ...item, receivedAt: now, read: false }, ...state.inbox].slice(0, INBOX_MAX);
  writeJson(INBOX_KEY, inbox);
  set({ inbox });
}

export function markInboxRead(id: string | "all"): void {
  const inbox = state.inbox.map((item) =>
    id === "all" || item.id === id ? { ...item, read: true } : item,
  );
  writeJson(INBOX_KEY, inbox);
  set({ inbox });
}

export function removeInboxItem(id: string): void {
  const inbox = state.inbox.filter((item) => item.id !== id);
  writeJson(INBOX_KEY, inbox);
  set({ inbox });
}

/** Sign-out drops this account's notices; maintenance stays (it is device-wide). */
export function resetManagedState(): void {
  writeJson(INBOX_KEY, null);
  set({ inbox: [], forcedUpdate: null, message: null, serverLimitMessage: null });
}
