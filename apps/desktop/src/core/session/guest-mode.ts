import { clearAccountSession, readAccountSessionToken } from "@/core/session/account-session";
import { deviceStoreRemove } from "@/core/storage/device-store";
import { readPrefs, updatePrefs } from "@/shared/lib/prefs";

/** Guest may use the studio with local (Ollama) models only — no cloud AI. */
export const GUEST_LOCAL_KEY = "arrab.guest.localOnly";
export const GUEST_EVENT = "arrab:guest";
/** Local-only guests keep a small companion roster. */
export const GUEST_COMPANION_LIMIT = 4;

export function isGuestLocalMode(): boolean {
  try {
    return localStorage.getItem(GUEST_LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}

/** True cloud account — not guest local-only, and a session token is present. */
export function isCloudSignedIn(): boolean {
  return Boolean(readAccountSessionToken()?.trim()) && !isGuestLocalMode();
}

export function enableGuestLocalMode(): void {
  try {
    localStorage.setItem(GUEST_LOCAL_KEY, "1");
    // Never keep an org shell after choosing local-only.
    localStorage.setItem("arrab.studioRole", "individual");
    localStorage.removeItem("arrab.account.status.cache");
    localStorage.removeItem("arrab.account.id");
  } catch {
    // ignore
  }
  // Drop any leftover cloud session — guest must not look signed in.
  clearAccountSession();
  const prefs = readPrefs();
  if (!prefs.aiLocalEnabled) {
    updatePrefs({ aiLocalEnabled: true });
  }
  // Leave any stale #/organizations route immediately.
  try {
    if (typeof window !== "undefined" && window.location.hash.includes("/organizations")) {
      window.location.hash = "#/individuals";
    }
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(GUEST_EVENT));
}

export function clearGuestLocalMode(): void {
  try {
    localStorage.removeItem(GUEST_LOCAL_KEY);
  } catch {
    // ignore
  }
  void deviceStoreRemove("cache", GUEST_LOCAL_KEY);
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
  return isCloudSignedIn();
}
