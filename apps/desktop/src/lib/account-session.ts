export const ACCOUNT_SESSION_KEY = "arrab.account.session";
export const ACCOUNT_EVENT = "arrab:account";

export function readAccountSessionToken(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeAccountSession(token: string): void {
  localStorage.setItem(ACCOUNT_SESSION_KEY, token);
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
}

export function clearAccountSession(): void {
  localStorage.removeItem(ACCOUNT_SESSION_KEY);
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
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
