import type { HandledIds } from "./commands";
import { isExpired, type ClientNotification, type NotificationAckAction, type NotificationKind } from "./types";

export type NotificationChannel = "general" | "updates" | "security" | "companions";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "updates",
  "security",
  "companions",
  "general",
];

const CHANNEL_PREFS_KEY = "arrab.managed.notifyChannels";
const PERMISSION_ASKED_KEY = "arrab.managed.notifyPermissionAsked";

export function channelForKind(kind: NotificationKind): NotificationChannel {
  if (kind === "update") return "updates";
  if (kind === "security") return "security";
  if (kind === "companion") return "companions";
  return "general";
}

export type ChannelPrefs = Record<NotificationChannel, boolean>;

const DEFAULT_PREFS: ChannelPrefs = { general: true, updates: true, security: true, companions: true };

export function readChannelPrefs(): ChannelPrefs {
  try {
    const raw = localStorage.getItem(CHANNEL_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ChannelPrefs>) : {};
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeChannelPrefs(prefs: ChannelPrefs): void {
  try {
    localStorage.setItem(CHANNEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function createNotificationHandler(deps: {
  handled: HandledIds;
  channelPrefs: () => ChannelPrefs;
  deliverInApp: (notification: ClientNotification) => void;
  deliverNative: (notification: ClientNotification) => Promise<void> | void;
  ack: (id: string, action: NotificationAckAction) => void;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  /** Returns true when the notice was new and delivered. */
  return async function handle(notification: ClientNotification): Promise<boolean> {
    if (deps.handled.has(notification.id)) return false;
    deps.handled.add(notification.id);
    if (isExpired(notification.expiresAt, now())) return false;
    if (notification.inApp) deps.deliverInApp(notification);
    if (notification.native && deps.channelPrefs()[channelForKind(notification.kind)]) {
      try {
        await deps.deliverNative(notification);
      } catch {
        // OS may refuse silently
      }
    }
    deps.ack(notification.id, "delivered");
    return true;
  };
}

/** Ask once, after the first sign-in — never on first launch. */
export function shouldAskNotificationPermission(signedIn: boolean): boolean {
  if (!signedIn) return false;
  try {
    return localStorage.getItem(PERMISSION_ASKED_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markNotificationPermissionAsked(): void {
  try {
    localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {
    // ignore
  }
}
