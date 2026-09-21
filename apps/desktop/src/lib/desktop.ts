import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";
import { getApiRoot } from "./api";

/** Public plans page opened from in-app “Manage plans”. */
export const ARRAB_PLANS_URL = "https://studio.arrabai.com/plans";

/**
 * Server auth/OAuth links sometimes use host `0.0.0.0` / localhost when
 * ARRAB_PUBLIC_BASE_URL is unset. Rewrite onto the API root the app uses
 * (including Coolify route prefix).
 */
export function resolvePublicApiUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^(0\.0\.0\.0|127\.0\.0\.1|localhost)$/i.test(parsed.hostname)) {
      return url;
    }
    const root = new URL(getApiRoot());
    parsed.protocol = root.protocol;
    parsed.host = root.host;
    const rootPath = root.pathname.replace(/\/$/, "");
    if (rootPath && rootPath !== "/") {
      parsed.pathname = `${rootPath}${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  await invoke("set_always_on_top", { enabled });
}

export async function openExternalUrl(url: string): Promise<void> {
  const resolved = resolvePublicApiUrl(url);
  if (isTauriRuntime()) {
    await invoke("open_external_url", { url: resolved });
    return;
  }
  window.open(resolved, "_blank", "noopener,noreferrer");
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
