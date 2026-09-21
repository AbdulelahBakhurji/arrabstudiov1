import { readPrefs } from "./prefs";
import { showAgentPresence, updateAgentPresence, hideAgentPresence } from "./agent-presence";
import { humanizeApprovalCopy, sanitizePresenceText } from "./approval-copy";
import { isTauriRuntime } from "./terminal";

export type StudioToastTone = "info" | "success" | "warn" | "approval";

export type StudioToast = {
  id: string;
  title: string;
  body?: string;
  tone?: StudioToastTone;
  href?: string;
  /** Keep until user dismisses (approvals). */
  sticky?: boolean;
  /** ms before auto-dismiss; ignored when sticky. */
  durationMs?: number;
  kind?: "approvals" | "teamLaunch" | "connector" | "cowork" | "agent" | "system";
  createdAt: number;
};

export type NotificationInboxItem = StudioToast & {
  read: boolean;
};

const TOAST_EVENT = "arrab:toast";
const INBOX_EVENT = "arrab:notification-inbox";
const APPROVALS_CHANGED = "arrab:approvals-changed";
const INBOX_KEY = "arrab.notificationInbox.v1";
const INBOX_MAX = 40;

const TOAST_EVENT_NAME = TOAST_EVENT;

function loadInbox(): NotificationInboxItem[] {
  try {
    const raw = localStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NotificationInboxItem[];
    return Array.isArray(parsed) ? parsed.slice(0, INBOX_MAX) : [];
  } catch {
    return [];
  }
}

function saveInbox(items: NotificationInboxItem[]): void {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(items.slice(0, INBOX_MAX)));
  } catch {
    /* ignore */
  }
}

let inboxCache = loadInbox();

function broadcastInbox(): void {
  window.dispatchEvent(new CustomEvent(INBOX_EVENT, { detail: inboxCache }));
}

function rememberNotification(toast: StudioToast): void {
  inboxCache = [
    { ...toast, read: false },
    ...inboxCache.filter((item) => item.id !== toast.id),
  ].slice(0, INBOX_MAX);
  saveInbox(inboxCache);
  broadcastInbox();
}

export function getNotificationInbox(): NotificationInboxItem[] {
  return inboxCache;
}

export function subscribeNotificationInbox(
  listener: (items: NotificationInboxItem[]) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<NotificationInboxItem[]>).detail);
  };
  listener(inboxCache);
  window.addEventListener(INBOX_EVENT, handler);
  return () => window.removeEventListener(INBOX_EVENT, handler);
}

export function markNotificationRead(id: string): void {
  inboxCache = inboxCache.map((item) => (item.id === id ? { ...item, read: true } : item));
  saveInbox(inboxCache);
  broadcastInbox();
}

export function markAllNotificationsRead(): void {
  inboxCache = inboxCache.map((item) => ({ ...item, read: true }));
  saveInbox(inboxCache);
  broadcastInbox();
}

export function clearNotificationInbox(): void {
  inboxCache = [];
  saveInbox(inboxCache);
  broadcastInbox();
}

export function unreadNotificationCount(): number {
  return inboxCache.filter((item) => !item.read).length;
}

export function pushToast(toast: Omit<StudioToast, "id" | "createdAt"> & { id?: string }): void {
  const payload: StudioToast = {
    id: toast.id ?? crypto.randomUUID(),
    title: toast.title,
    body: toast.body,
    tone: toast.tone ?? "info",
    href: toast.href,
    sticky: toast.sticky,
    durationMs: toast.durationMs,
    kind: toast.kind ?? "system",
    createdAt: Date.now(),
  };
  rememberNotification(payload);
  window.dispatchEvent(new CustomEvent(TOAST_EVENT_NAME, { detail: payload }));
}

export function subscribeToasts(listener: (toast: StudioToast) => void): () => void {
  const onToast = (event: Event) => {
    listener((event as CustomEvent<StudioToast>).detail);
  };
  window.addEventListener(TOAST_EVENT_NAME, onToast);
  return () => window.removeEventListener(TOAST_EVENT_NAME, onToast);
}

async function pingCompanionPanel(): Promise<void> {
  window.dispatchEvent(new CustomEvent("companion-panel:refresh"));
  window.dispatchEvent(new CustomEvent("arrab:approvals-changed"));
  if (!isTauriRuntime()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("companion-panel:refresh");
    await emit("arrab:approvals-changed");
  } catch {
    /* ignore */
  }
}

/** Native OS notification that stays in macOS Notification Center / Windows Action Center. */
async function sendOsNotification(input: {
  title: string;
  body?: string;
  tag?: string;
  sticky?: boolean;
}): Promise<void> {
  const cleanTitle = sanitizePresenceText(input.title, "Arrab Studio");
  const cleanBody = sanitizePresenceText(input.body, "") || undefined;
  const tag = input.tag || `arrab-${cleanTitle.slice(0, 40)}`;

  if (isTauriRuntime()) {
    try {
      const {
        isPermissionGranted,
        requestPermission,
        sendNotification,
      } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      if (granted) {
        sendNotification({
          title: cleanTitle,
          body: cleanBody,
        });
        return;
      }
    } catch {
      // Fall through to Web Notification API.
    }
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(cleanTitle, {
        body: cleanBody,
        tag,
        requireInteraction: Boolean(input.sticky),
      });
    } catch {
      // browser/OS may block silently
    }
  }
}

export async function notifyStudio(input: {
  kind: "approvals" | "teamLaunch" | "connector" | "cowork" | "agent";
  title: string;
  body?: string;
  href?: string;
  agentName?: string;
  agentPhoto?: string | null;
  hue?: number;
  faceSeed?: number;
  progress?: number;
  presenceState?: "working" | "thinking" | "needs_you" | "done" | "error";
  approvalId?: string | null;
}): Promise<void> {
  const prefs = readPrefs();
  const allowed =
    (input.kind === "approvals" && prefs.notifyApprovals) ||
    (input.kind === "teamLaunch" && prefs.notifyTeamLaunch) ||
    (input.kind === "connector" && prefs.notifyConnector) ||
    (input.kind === "cowork" && prefs.notifyCowork) ||
    (input.kind === "agent" && prefs.notifyAgentPresence);

  if (!allowed) {
    return;
  }

  const copy =
    input.kind === "approvals"
      ? humanizeApprovalCopy({ title: input.title, detail: input.body })
      : {
          title: sanitizePresenceText(input.title, "Arrab"),
          body: sanitizePresenceText(input.body, ""),
          preview: undefined as string | undefined,
        };

  const isApproval = input.kind === "approvals";
  pushToast({
    id: input.approvalId ? `approval-${input.approvalId}` : undefined,
    title: copy.title,
    body: copy.body || undefined,
    href: input.href,
    tone: isApproval ? "approval" : "info",
    sticky: isApproval,
    durationMs: isApproval ? 12_000 : 5200,
    kind: input.kind,
  });

  const wantPresence =
    prefs.notifyAgentPresence &&
    (input.kind === "agent" ||
      input.kind === "approvals" ||
      input.kind === "teamLaunch" ||
      Boolean(input.agentName));

  if (wantPresence) {
    const state =
      input.presenceState ??
      (input.kind === "approvals" ? "needs_you" : input.kind === "teamLaunch" ? "working" : "thinking");
    void showAgentPresence({
      agentName: input.agentName ?? "Arrab",
      agentPhoto: input.agentPhoto ?? null,
      hue: input.hue ?? (input.kind === "approvals" ? 42 : 210),
      faceSeed: input.faceSeed ?? 17,
      title: copy.title,
      body: copy.body || undefined,
      preview: copy.preview,
      progress: input.progress ?? (state === "needs_you" ? 0.72 : state === "done" ? 1 : 0.28),
      state,
      href: input.href,
      approvalId: input.approvalId ?? null,
    });
    if (state === "done") {
      void hideAgentPresence(2600);
    } else if (state === "needs_you") {
      // Stay until dismissed / next update.
    } else {
      void updateAgentPresence({ progress: Math.min(0.9, (input.progress ?? 0.28) + 0.2) });
      void hideAgentPresence(4200);
    }
  }

  void sendOsNotification({
    title: copy.title,
    body: copy.body || undefined,
    tag: input.approvalId ? `approval-${input.approvalId}` : `arrab-${input.kind}-${copy.title.slice(0, 24)}`,
    sticky: isApproval,
  });

  if (isApproval) {
    void pingCompanionPanel();
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (isTauriRuntime()) {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );
      if (await isPermissionGranted()) return "granted";
      const permission = await requestPermission();
      if (permission === "granted") return "granted";
      if (permission === "denied") return "denied";
      return "default";
    } catch {
      // fall through
    }
  }
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}
