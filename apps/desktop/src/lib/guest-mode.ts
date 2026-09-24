import { clearAccountSession, readAccountSessionToken } from "@/lib/account-session";
import { readPrefs, updatePrefs } from "@/lib/prefs";

/** Guest may use the studio with local (Ollama) models only — no cloud AI. */
export const GUEST_LOCAL_KEY = "arrab.guest.localOnly";
export const GUEST_EVENT = "arrab:guest";

export function isGuestLocalMode(): boolean {
  try {
    return localStorage.getItem(GUEST_LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function enableGuestLocalMode(): void {
  try {
    localStorage.setItem(GUEST_LOCAL_KEY, "1");
  } catch {
    // ignore
  }
  // Drop any leftover cloud session — guest must not look signed in.
  clearAccountSession();
  const prefs = readPrefs();
  if (!prefs.aiLocalEnabled) {
    updatePrefs({ aiLocalEnabled: true });
  }
  window.dispatchEvent(new CustomEvent(GUEST_EVENT));
}

export function clearGuestLocalMode(): void {
  try {
    localStorage.removeItem(GUEST_LOCAL_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(GUEST_EVENT));
}

export function subscribeGuestMode(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(GUEST_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(GUEST_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Cloud Arrab AI requires a signed-in account session. */
export function canUseCloudAi(): boolean {
  return Boolean(readAccountSessionToken()?.trim()) && !isGuestLocalMode();
}
