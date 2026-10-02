/**
 * Whether this device has a cloud studio session (account or org seat).
 * Family seats use a seat-bound account session; org seats use employee session only.
 */
import { readAccountSessionToken } from "@/core/session/account-session";
import { isGuestLocalMode } from "@/core/session/guest-mode";
import { readOrgEmployeeSession } from "@/domains/organization/org-employee-session";

export function hasOrgEmployeeSession(): boolean {
  return Boolean(readOrgEmployeeSession()?.sessionToken);
}

export function hasAccountCloudSession(): boolean {
  return Boolean(readAccountSessionToken()?.trim()) && !isGuestLocalMode();
}

/** True when the shell should open past AuthGate for a cloud identity. */
export function hasStudioCloudSession(): boolean {
  if (isGuestLocalMode()) return false;
  return hasAccountCloudSession() || hasOrgEmployeeSession();
}
