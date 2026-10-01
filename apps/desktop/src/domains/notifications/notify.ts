import { readPrefs } from "../../shared/lib/prefs";
import { showAgentPresence, updateAgentPresence, hideAgentPresence } from "./agent-presence";
import { humanizeApprovalCopy, sanitizePresenceText } from "./approval-copy";
import { isTauriRuntime } from "../../core/platform/terminal";
import {
  createOsThrottle,
  createPendingLink,
  deliveryFor,
  isQuietNow,
} from "./notification-policy";

export type StudioToastTone = "info" | "success" | "warn" | "approval";

/**
 * Alerts are device notifications only (macOS Notification Center / Windows Action Center).
 * There is deliberately no in-app toast stack or bell inbox.
 */
export type StudioToast = {
  id?: string;
  title: string;
  body?: string;
  tone?: StudioToastTone;
  /** Where focusing the app right after the notification should take the user. */
  href?: string;
  /** Approvals: do not auto-dismiss where the OS supports it. */
  sticky?: boolean;
  /** Retained for caller compatibility; the OS controls banner duration. */
  durationMs?: number;
  kind?: "approvals" | "teamLaunch" | "connector" | "cowork" | "agent" | "system";
};

/**
 * Send a device notification for something the user just did or that needs their attention.
 * Honors Do Not Disturb / quiet hours, except warnings and approvals.
 */
export function pushToast(toast: StudioToast): void {
  const urgent = toast.tone === "warn" || toast.tone === "approval" || Boolean(toast.sticky);
  if (!urgent && isQuietNow(readPrefs())) return;
  void sendOsNotification({
    title: toast.title,
    body: toast.body,
    tag: toast.id ?? `arrab-${toast.kind ?? "system"}-${toast.title.slice(0, 40)}`,
    sticky: Boolean(toast.sticky),
    href: toast.href,
  });
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

const osThrottle = createOsThrottle();
const pendingLink = createPendingLink();

/**
 * Desktop notification plugins can't report clicks on every OS, so remember where the last
 * one pointed: if the user focuses the app right after, take them there.
 */
export function takePendingOsLink(): string | null {
  return pendingLink.take();
}

/** Native OS notification that stays in macOS Notification Center / Windows Action Center. */
async function sendOsNotification(input: {
  title: string;
  body?: string;
  tag?: string;
  sticky?: boolean;
  href?: string;
}): Promise<void> {
  const cleanTitle = sanitizePresenceText(input.title, "Arrab Studio");
  const cleanBody = sanitizePresenceText(input.body, "") || undefined;
  const tag = input.tag || `arrab-${cleanTitle.slice(0, 40)}`;
  if (!osThrottle.allow(tag)) return;
  pendingLink.set(input.href);

  if (isTauriRuntime()) {
    try {
      // Permission is requested once after sign-in (or from Settings), never from a send.
      const { isPermissionGranted, sendNotification } = await import(
        "@tauri-apps/plugin-notification"
      );
      if (await isPermissionGranted()) {
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
  const delivery = deliveryFor(input.kind, prefs);
  const enabled = deliveryFor(input.kind, { ...prefs, quietHoursEnabled: false, dndUntil: 0 });
  // A kind the user switched off is dropped entirely; quiet time holds it (nothing is queued).
  if (!enabled.toast && !enabled.os && !enabled.presence) {
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

  const wantPresence =
    delivery.presence &&
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

  if (delivery.os) {
    void sendOsNotification({
      title: copy.title,
      body: copy.body || undefined,
      tag: input.approvalId ? `approval-${input.approvalId}` : `arrab-${input.kind}-${copy.title.slice(0, 24)}`,
      sticky: isApproval,
      href: input.href,
    });
  }

  if (isApproval) {
    void pingCompanionPanel();
  }
}

/** OS notification for Arrab Control notices; never prompts for permission. */
export async function postNativeNotification(input: {
  title: string;
  body?: string;
  tag: string;
}): Promise<void> {
  await sendOsNotification(input);
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
