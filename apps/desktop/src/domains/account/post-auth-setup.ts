/** After browser signup / plan purchase, land on Plan & billing once. */
const POST_AUTH_SETUP_KEY = "arrab.postAuth.setup";
const POST_AUTH_HANDOFF_KEY = "arrab.postAuth.handoff";

export type PlanHandoff = {
  planId?: string;
  planName?: string;
  tokenLimit?: number;
  deepseekCredit?: number;
  otherCredit?: number;
  /** Prefer opening Usage when returning from a paid checkout. */
  section?: "plan" | "usage";
};

export function markPostAuthPlanSetup(handoff?: PlanHandoff): void {
  try {
    localStorage.setItem(POST_AUTH_SETUP_KEY, "plan");
    if (handoff && Object.keys(handoff).length > 0) {
      localStorage.setItem(POST_AUTH_HANDOFF_KEY, JSON.stringify(handoff));
    }
  } catch {
    // ignore
  }
}

export function readPostAuthPlanHandoff(): PlanHandoff | null {
  try {
    const raw = localStorage.getItem(POST_AUTH_HANDOFF_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlanHandoff;
  } catch {
    return null;
  }
}

export function consumePostAuthPlanSetup(): boolean {
  try {
    const value = localStorage.getItem(POST_AUTH_SETUP_KEY);
    if (value !== "plan") return false;
    localStorage.removeItem(POST_AUTH_SETUP_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearPostAuthPlanHandoff(): void {
  try {
    localStorage.removeItem(POST_AUTH_HANDOFF_KEY);
  } catch {
    // ignore
  }
}

export function peekPostAuthPlanSetup(): boolean {
  try {
    return localStorage.getItem(POST_AUTH_SETUP_KEY) === "plan";
  } catch {
    return false;
  }
}
