import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";

/** Public plans page opened from in-app “Manage plans”. */
export const ARRAB_PLANS_URL = "https://studio.arrabai.com/plans";

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  await invoke("set_always_on_top", { enabled });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openPlansPage(): Promise<void> {
  await openExternalUrl(ARRAB_PLANS_URL);
}

/** Bring Arrab Studio to the front after browser sign-in completes. */
export async function focusMainWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("focus_main_window");
  } catch {
    // Best-effort; poll success still signs the user in.
  }
}

export type PhonePreviewSession = {
  port: number;
  lanUrl: string;
  localUrl: string;
  lanIp: string;
};

/** Serve current Studio HTML on the LAN so a phone on the same Wi‑Fi can open it. */
export async function startPhonePreview(html: string): Promise<PhonePreviewSession> {
  if (!isTauriRuntime()) {
    throw new Error("Phone connect requires the desktop app");
  }
  return invoke<PhonePreviewSession>("start_phone_preview", { html });
}
