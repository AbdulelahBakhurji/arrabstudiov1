import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { clearAccountSession, subscribeAccountSession, readAccountSessionToken } from "@/domains/account/account-session";
import { clientRequest, getApiRoot, isSecureApiRoot, sessionHeaders } from "@/core/api/api";
import { markManagedUpdateNotice } from "@/domains/managed/app-updates";
import { openExternalUrl } from "@/core/platform/desktop";
import { ensureNotificationPermission, postNativeNotification } from "@/shared/lib/notify";
import { isTauriRuntime } from "@/core/platform/terminal";
import { parseDeepLink, type DeepLinkRoute } from "./allowlist";
import { createCommandRouter, createHandledIds, type CommandEffects } from "./commands";
import { getDeviceId, getDeviceIdentity, resetDeviceId } from "./device";
import { createLiveChannel, EVENTS_PATH, type LiveConnector, type LiveEvent } from "./events";
import {
  createNotificationHandler,
  markNotificationPermissionAsked,
  readChannelPrefs,
  shouldAskNotificationPermission,
} from "./notifications";
import {
  addInboxItem,
  clearCachedConfig,
  getManagedState,
  resetManagedState,
  setConfig,
  setForcedUpdate,
  setMaintenance,
  setManagedMessage,
} from "./store";
import { registerMobilePush } from "./push-bridge";
import { createSyncEngine, type SyncEngine, type SyncLogEntry } from "./sync";
import type {
  ClientCommand,
  ClientNotification,
  ClientState,
  CommandAckStatus,
  NotificationAckAction,
  SyncResponse,
} from "./types";
import { localized } from "./types";
import { buildNumberFor } from "./updates";
import { APP_CHANNEL, APP_VERSION } from "./app-version";

const HANDLED_COMMANDS_KEY = "arrab.managed.handledCommands";
const HANDLED_NOTICES_KEY = "arrab.managed.handledNotifications";
const IDLE_AFTER_MS = 5 * 60_000;
const NATIVE_CLICK_WINDOW_MS = 2 * 60_000;
const LOG_MAX = 200;

export { APP_CHANNEL, APP_VERSION };

/** Diagnostic ring buffer: event kinds, status codes and times only — never content. */
type DiagnosticEntry = { at: number; kind: string; detail: string };
const diagnostics: DiagnosticEntry[] = [];

function logDiagnostic(kind: string, detail: string) {
  diagnostics.push({ at: Date.now(), kind, detail: detail.slice(0, 120) });
  while (diagnostics.length > LOG_MAX) diagnostics.shift();
}

function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistIds(key: string) {
  return (ids: string[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // ignore
    }
  };
}

export type ManagedClientHooks = {
  locale: () => string;
  navigate: (route: DeepLinkRoute) => void;
  /** Local companion lookup, so `open_companion` only opens real, enabled ones. */
  companionExists: (companionId: string) => boolean;
  /** Ask the user before uploading diagnostics. */
  confirmLogUpload: () => Promise<boolean>;
};

let engine: SyncEngine | null = null;
let hooksRef: ManagedClientHooks | null = null;
let lastInputAt = Date.now();
let lastNative: { id: string; deepLink: string | null; at: number } | null = null;

function clientState(): ClientState {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return "background";
  if (Date.now() - lastInputAt > IDLE_AFTER_MS) return "idle";
  return "foreground";
}

function localeTag(appLocale: string): string {
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  const region = /^[a-z]{2,3}-([A-Z]{2})$/i.exec(nav)?.[1];
  return region ? `${appLocale}-${region.toUpperCase()}` : appLocale;
}

function ackCommand(id: string, status: CommandAckStatus, error?: string) {
  engine?.ackCommand(id);
  logDiagnostic("command_ack", status);
  void clientRequest(`/v1/client/commands/${encodeURIComponent(id)}/ack`, {
    method: "POST",
    body: error ? { status, error } : { status },
    timeoutMs: 10_000,
  }).catch(() => undefined);
}

export function ackNotification(id: string, action: NotificationAckAction) {
  engine?.ackNotification(id);
  void clientRequest(`/v1/client/notifications/${encodeURIComponent(id)}/ack`, {
    method: "POST",
    body: { action },
    timeoutMs: 10_000,
  }).catch(() => undefined);
}

async function clearAvatarCache() {
  try {
    if (typeof caches !== "undefined") {
      for (const key of await caches.keys()) await caches.delete(key);
    }
    localStorage.removeItem("arrab.companionPortraits.migrated");
  } catch {
    // ignore
  }
}

async function signOutDevice() {
  clearAccountSession();
  resetManagedState();
}

async function uploadDiagnostics(): Promise<void> {
  const deviceId = await getDeviceId();
  // TODO(contract): diagnostics body shape is not specified; this sends redacted metadata only.
  await clientRequest("/v1/client/diagnostics", {
    method: "POST",
    body: {
      deviceId,
      appVersion: APP_VERSION,
      entries: diagnostics.map((entry) => ({ ...entry, at: new Date(entry.at).toISOString() })),
    },
    timeoutMs: 20_000,
  });
}

function buildEffects(): CommandEffects {
  return {
    refreshConfig: () => void engine?.syncNow("command"),
    showMessage: (message) => setManagedMessage(message),
    forceUpdate: ({ blocking }) => setForcedUpdate({ blocking }),
    openCompanion: (companionId) => {
      const policy = getManagedState().config?.companions.find((item) => item.id === companionId);
      if (policy && !policy.enabled) return false;
      if (!hooksRef?.companionExists(companionId)) return false;
      hooksRef.navigate({ kind: "companion", id: companionId });
      return true;
    },
    openUrl: (url) => openExternalUrl(url),
    clearCache: async () => {
      await clearCachedConfig();
      await clearAvatarCache();
    },
    signOut: signOutDevice,
    resetDevice: async () => {
      await signOutDevice();
      await resetDeviceId();
    },
    requestLogs: async () => {
      const agreed = (await hooksRef?.confirmLogUpload()) ?? false;
      if (!agreed) return "declined";
      await uploadDiagnostics();
      return "uploaded";
    },
  };
}

const handledCommands = createHandledIds(readIds(HANDLED_COMMANDS_KEY), 300, persistIds(HANDLED_COMMANDS_KEY));
const handledNotices = createHandledIds(readIds(HANDLED_NOTICES_KEY), 300, persistIds(HANDLED_NOTICES_KEY));

const routeCommand = createCommandRouter({ effects: buildEffects(), handled: handledCommands });

async function handleCommand(command: ClientCommand) {
  const result = await routeCommand(command);
  if (result) ackCommand(command.id, result.status, result.error);
}

const handleNotification = createNotificationHandler({
  handled: handledNotices,
  channelPrefs: readChannelPrefs,
  deliverInApp: (notification) => addInboxItem(notification),
  deliverNative: async (notification: ClientNotification) => {
    const locale = hooksRef?.locale() ?? "en";
    const unfocused = typeof document !== "undefined" && !document.hasFocus();
    lastNative = unfocused
      ? { id: notification.id, deepLink: notification.deepLink, at: Date.now() }
      : null;
    await postNativeNotification({
      title: localized(notification.title, locale),
      body: localized(notification.body, locale) || undefined,
      tag: notification.id,
    });
    if (notification.kind === "update") markManagedUpdateNotice();
  },
  ack: ackNotification,
});

async function applyResponse(response: SyncResponse) {
  setMaintenance(response.maintenance);
  setConfig(response.config);
  for (const notification of response.notifications) await handleNotification(notification);
  for (const command of response.commands) await handleCommand(command);
}

async function applyLiveEvent(event: LiveEvent) {
  logDiagnostic("live", event.type);
  if (event.type === "maintenance") setMaintenance(event.maintenance);
  else if (event.type === "config") setConfig(event.config);
  else if (event.type === "notification") await handleNotification(event.notification);
  else if (event.type === "command") await handleCommand(event.command);
}

let liveId = 0;

/** Desktop streams through Rust (the WebView cannot read api.arrabai.com cross-origin). */
function tauriConnector(url: string): LiveConnector {
  return ({ onOpen, onChunk, onClose }) => {
    const id = ++liveId;
    let stop: (() => void) | null = null;
    let done = false;
    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      stop?.();
      onClose(status);
    };
    void listen<{ id: number; kind: string; text?: string; status?: number }>(
      "managed-client:sse",
      (event) => {
        if (event.payload.id !== id) return;
        if (event.payload.kind === "open") onOpen();
        else if (event.payload.kind === "chunk" && event.payload.text) onChunk(event.payload.text);
        else if (event.payload.kind === "closed") finish(event.payload.status ?? null);
      },
    )
      .then((unlisten) => {
        stop = unlisten;
        if (done) unlisten();
        return invoke("managed_events_open", { id, url, headers: sessionHeaders() });
      })
      .catch(() => finish(null));
    return {
      close: () => {
        done = true;
        stop?.();
        void invoke("managed_events_close").catch(() => undefined);
      },
    };
  };
}

function fetchConnector(url: string): LiveConnector {
  return ({ onOpen, onChunk, onClose }) => {
    const controller = new AbortController();
    let closedByUs = false;
    void (async () => {
      let status: number | null = null;
      try {
        const response = await fetch(url, {
          headers: { Accept: "text/event-stream", ...sessionHeaders() },
          signal: controller.signal,
          redirect: "error",
        });
        status = response.status;
        if (!response.ok || !response.body) throw new Error("no stream");
        onOpen();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          onChunk(decoder.decode(value, { stream: true }));
        }
      } catch {
        // fall through to close
      }
      if (!closedByUs) onClose(status);
    })();
    return {
      close: () => {
        closedByUs = true;
        controller.abort();
      },
    };
  };
}

let live: ReturnType<typeof createLiveChannel> | null = null;

async function startLive() {
  const root = getApiRoot();
  if (!isSecureApiRoot(root)) return;
  const deviceId = await getDeviceId();
  const url = `${root}${EVENTS_PATH}?deviceId=${encodeURIComponent(deviceId)}`;
  live?.stop();
  live = createLiveChannel({
    connect: isTauriRuntime() ? tauriConnector(url) : fetchConnector(url),
    onEvent: (event) => void applyLiveEvent(event),
  });
  live.start();
}

function handleDeepLinkUrl(url: string) {
  const route = parseDeepLink(url);
  if (route) hooksRef?.navigate(route);
}

/** Opens a notice's deep link and records the "opened" ack. */
export function openManagedNotification(notification: ClientNotification) {
  ackNotification(notification.id, "opened");
  if (notification.deepLink) handleDeepLinkUrl(notification.deepLink);
}

export function dismissManagedNotification(id: string) {
  ackNotification(id, "dismissed");
}

export function syncManagedNow(reason = "manual") {
  void engine?.syncNow(reason);
}

let stopPush: (() => void) | null = null;

export async function maybeAskNotificationPermission() {
  const signedIn = Boolean(readAccountSessionToken());
  if (signedIn && !stopPush) {
    stopPush = () => undefined;
    stopPush = await registerMobilePush(() => void engine?.syncNow("push-token")).catch(
      () => () => undefined,
    );
  }
  if (!shouldAskNotificationPermission(signedIn)) return;
  markNotificationPermissionAsked();
  await ensureNotificationPermission().catch(() => undefined);
}

/** Start once from the main window. Returns a stop function. */
export function startManagedClient(hooks: ManagedClientHooks): () => void {
  hooksRef = hooks;
  if (engine) return () => undefined;

  engine = createSyncEngine({
    transport: (path, body, timeoutMs) => clientRequest(path, { method: "POST", body, timeoutMs }),
    buildRequest: async () => {
      const identity = await getDeviceIdentity();
      const state = getManagedState();
      return {
        ...identity,
        appVersion: APP_VERSION,
        build: buildNumberFor(APP_VERSION),
        channel: APP_CHANNEL,
        locale: localeTag(hooksRef?.locale() ?? "en"),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        state: clientState(),
        activeScreen: state.activeScreen,
        activeCompanionId: state.activeCompanionId,
        configVersion: state.config?.version ?? null,
      };
    },
    onResponse: applyResponse,
    isBackground: () => clientState() === "background",
    log: (entry: SyncLogEntry) => logDiagnostic("sync", `${entry.outcome}:${entry.status ?? "-"}`),
  });
  engine.start();
  void startLive();

  const onInput = () => {
    lastInputAt = Date.now();
  };
  const onFocus = () => {
    lastInputAt = Date.now();
    void engine?.syncNow("focus");
    // Desktop notification clicks only focus the app; open the notice the user just saw.
    if (lastNative && Date.now() - lastNative.at < NATIVE_CLICK_WINDOW_MS) {
      const pending = lastNative;
      lastNative = null;
      ackNotification(pending.id, "opened");
      if (pending.deepLink) handleDeepLinkUrl(pending.deepLink);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void engine?.syncNow("visible");
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("keydown", onInput, { passive: true });
  window.addEventListener("pointerdown", onInput, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  const stopAuth = subscribeAccountSession(() => {
    void engine?.syncNow("auth");
    void startLive();
    void maybeAskNotificationPermission();
  });
  void maybeAskNotificationPermission();

  let stopDeepLink: (() => void) | null = null;
  if (isTauriRuntime()) {
    void listen<string>("arrab:deep-link", (event) => handleDeepLinkUrl(event.payload))
      .then((unlisten) => {
        stopDeepLink = unlisten;
      })
      .catch(() => undefined);
  }

  return () => {
    engine?.stop();
    engine = null;
    live?.stop();
    live = null;
    stopAuth();
    stopDeepLink?.();
    stopPush?.();
    stopPush = null;
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("keydown", onInput);
    window.removeEventListener("pointerdown", onInput);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
