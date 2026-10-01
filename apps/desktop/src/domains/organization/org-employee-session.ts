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

export function readOrgEmployeeSession(): OrgEmployeeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrgEmployeeSession;
    if (!parsed?.sessionToken || !parsed?.employee?.id) return null;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
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
