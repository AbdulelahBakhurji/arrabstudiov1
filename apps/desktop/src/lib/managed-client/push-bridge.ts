import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/terminal";
import { detectPlatform, getPushRegistration, setPushRegistration, type PushRegistration } from "./device";
import type { PushProvider } from "./types";

/** Tauri mobile plugin name registered by apps/android/managed-client (Kotlin `PushBridge`). */
const PLUGIN = "arrab-push";

function parseRegistration(value: unknown): PushRegistration | null {
  if (typeof value !== "object" || value === null) return null;
  const { provider, token } = value as { provider?: unknown; token?: unknown };
  const known: PushProvider[] = ["fcm", "hms", "apns", "none"];
  if (typeof provider !== "string" || !known.includes(provider as PushProvider)) return null;
  return {
    provider: provider as PushProvider,
    token: typeof token === "string" && token.trim() ? token : null,
  };
}

async function store(next: PushRegistration | null, onChange: () => void) {
  if (!next) return;
  const current = await getPushRegistration();
  if (current.provider === next.provider && current.token === next.token) return;
  await setPushRegistration(next);
  onChange();
}

/**
 * Android only: asks the native bridge for an FCM/HMS token (HMS when Huawei
 * Mobile Services is present without Google Play services). Silent when the
 * plugin is missing — the app keeps polling without push.
 */
export async function registerMobilePush(onChange: () => void): Promise<() => void> {
  if (!isTauriRuntime() || detectPlatform(navigator.userAgent, navigator.maxTouchPoints) !== "android") return () => undefined;
  const result = await invoke<unknown>(`plugin:${PLUGIN}|registerPush`).catch(() => null);
  await store(parseRegistration(result), onChange);
  try {
    const listener = await addPluginListener(PLUGIN, "token", (payload: unknown) => {
      void store(parseRegistration(payload), onChange);
    });
    return () => void listener.unregister();
  } catch {
    return () => undefined;
  }
}
