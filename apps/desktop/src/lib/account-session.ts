/** Pending browser sign-in — survives focus changes until poll completes or expires. */
export const ACCOUNT_SESSION_KEY = "arrab.account.session";
export const ACCOUNT_EVENT = "arrab:account";
export const WEB_AUTH_PENDING_KEY = "arrab.account.webAuthPending";
export const AUTH_DEEP_LINK_EVENT = "arrab:auth-deep-link";

/**
 * Account session token — proves the desktop user signed in.
 * Never store provider API keys or connector secrets here.
 */
export function readAccountSessionToken(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeAccountSession(token: string): void {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 20) {
    throw new Error("Refusing to store an invalid account session token");
  }
  localStorage.setItem(ACCOUNT_SESSION_KEY, trimmed);
  clearPendingWebAuth();
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
}

export function clearAccountSession(): void {
  localStorage.removeItem(ACCOUNT_SESSION_KEY);
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
}

/** Clear only if `token` is still the stored session (avoids wiping a newer login). */
export function clearAccountSessionIfCurrent(token: string): void {
  const current = readAccountSessionToken();
  if (!current || current !== token.trim()) {
    return;
  }
  clearAccountSession();
}

export type PendingWebAuth = {
  state: string;
  pollSecret: string;
  startedAt: number;
};

export function writePendingWebAuth(pending: Omit<PendingWebAuth, "startedAt">): void {
  try {
    const value: PendingWebAuth = {
      state: pending.state.trim(),
      pollSecret: pending.pollSecret.trim(),
      startedAt: Date.now(),
    };
    if (!value.state || !value.pollSecret) return;
    localStorage.setItem(WEB_AUTH_PENDING_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function readPendingWebAuth(): PendingWebAuth | null {
  try {
    const raw = localStorage.getItem(WEB_AUTH_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingWebAuth;
    if (!parsed?.state || !parsed?.pollSecret) return null;
    // Match API pending TTL (10 minutes).
    if (Date.now() - (parsed.startedAt || 0) > 10 * 60_000) {
      clearPendingWebAuth();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingWebAuth(): void {
  try {
    localStorage.removeItem(WEB_AUTH_PENDING_KEY);
  } catch {
    // ignore
  }
}

export function subscribeAccountSession(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(ACCOUNT_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(ACCOUNT_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function initialsFromName(name: string, email?: string): string {
  const source = name.trim() || email?.trim() || "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
