import { readPrefs } from "./prefs";

export type StudioToast = {
  id: string;
  title: string;
  body?: string;
  tone?: "info" | "success" | "warn";
  href?: string;
};

const TOAST_EVENT = "arrab:toast";

export function pushToast(toast: Omit<StudioToast, "id"> & { id?: string }): void {
  const payload: StudioToast = {
    id: toast.id ?? crypto.randomUUID(),
    title: toast.title,
    body: toast.body,
    tone: toast.tone ?? "info",
    href: toast.href,
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: payload }));
}

export function subscribeToasts(listener: (toast: StudioToast) => void): () => void {
  const onToast = (event: Event) => {
    listener((event as CustomEvent<StudioToast>).detail);
  };
  window.addEventListener(TOAST_EVENT, onToast);
  return () => window.removeEventListener(TOAST_EVENT, onToast);
}

export async function notifyStudio(input: {
  kind: "approvals" | "teamLaunch" | "connector" | "cowork";
  title: string;
  body?: string;
  href?: string;
}): Promise<void> {
  const prefs = readPrefs();
  const allowed =
    (input.kind === "approvals" && prefs.notifyApprovals) ||
    (input.kind === "teamLaunch" && prefs.notifyTeamLaunch) ||
    (input.kind === "connector" && prefs.notifyConnector) ||
    (input.kind === "cowork" && prefs.notifyCowork);

  if (!allowed) {
    return;
  }

  pushToast({
    title: input.title,
    body: input.body,
    href: input.href,
    tone: input.kind === "approvals" ? "warn" : "info",
  });

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(input.title, { body: input.body });
    } catch {
      // browser/OS may block silently
    }
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}
