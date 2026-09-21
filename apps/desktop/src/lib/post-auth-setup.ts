/** After browser signup, land on plan setup once. */
const POST_AUTH_SETUP_KEY = "arrab.postAuth.setup";

export function markPostAuthPlanSetup(): void {
  try {
    localStorage.setItem(POST_AUTH_SETUP_KEY, "plan");
  } catch {
    // ignore
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

export function peekPostAuthPlanSetup(): boolean {
  try {
    return localStorage.getItem(POST_AUTH_SETUP_KEY) === "plan";
  } catch {
    return false;
  }
}
