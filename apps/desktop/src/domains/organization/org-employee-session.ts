/**
 * Organization employee seat session — separate from billing account session.
 * Header: X-Arrab-Employee-Session
 */
const STORAGE_KEY = "arrab.org.employee.session";
export const ORG_EMPLOYEE_EVENT = "arrab:org-employee";

export type OrgEmployeeSession = {
  sessionToken: string;
  expiresAt: string;
  employee: {
    id: string;
    email: string;
    displayName: string;
    title: string | null;
    role: "admin" | "manager" | "member";
    departmentId: string | null;
    mustChangePassword: boolean;
  };
};

/**
 * React's `useSyncExternalStore` requires `getSnapshot` to return the *same value* while nothing
 * changed. Parsing JSON on every call produced a new object each time, so any component using
 * `useOrgSeatCapabilities` re-rendered forever ("Maximum update depth exceeded") and the whole app
 * crashed for every organization seat. The parsed session is cached against the raw stored string.
 */
let cache: { raw: string; session: OrgEmployeeSession | null } | null = null;

export function readOrgEmployeeSession(): OrgEmployeeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = null;
      return null;
    }
    if (cache && cache.raw === raw) {
      if (cache.session && cache.session.expiresAt && Date.parse(cache.session.expiresAt) <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        cache = null;
        return null;
      }
      return cache.session;
    }
    const parsed = JSON.parse(raw) as OrgEmployeeSession;
    const valid = Boolean(parsed?.sessionToken && parsed?.employee?.id);
    if (valid && parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      cache = null;
      return null;
    }
    cache = { raw, session: valid ? parsed : null };
    return cache.session;
  } catch {
    return null;
  }
}

export function writeOrgEmployeeSession(session: OrgEmployeeSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(ORG_EMPLOYEE_EVENT));
}

export function clearOrgEmployeeSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(ORG_EMPLOYEE_EVENT));
}

export function subscribeOrgEmployeeSession(listener: () => void): () => void {
  window.addEventListener(ORG_EMPLOYEE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ORG_EMPLOYEE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
