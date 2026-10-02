/**
 * Device sign-in for account owners, family seats, and org employee seats.
 *
 * Tries account → family seat → org employee so a seat can use their own device
 * without holding the billing owner's bearer token.
 */
import { arrabApi, ApiRequestError } from "@/core/api/api";
import { clearAccountSession, writeAccountSession } from "@/core/session/account-session";
import { clearGuestLocalMode } from "@/core/session/guest-mode";
import { writeActiveFamilyMemberId } from "@/domains/family/family-session";
import {
  clearOrgEmployeeSession,
  writeOrgEmployeeSession,
} from "@/domains/organization/org-employee-session";

export type SeatSignInKind = "account" | "family" | "organization";

export type SeatSignInResult = {
  kind: SeatSignInKind;
  displayName: string;
  email: string;
};

function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.status === 401 || err.status === 403);
}

function isNotFoundOrUnavailable(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.status === 404 || err.status >= 500);
}

/**
 * Sign in with email + password. Order:
 * 1. Account owner (or classic account session)
 * 2. Family seat (returns a seat-bound account session)
 * 3. Organization employee (employee session only — no owner bearer)
 */
export async function signInWithCredentials(input: {
  email: string;
  password: string;
}): Promise<SeatSignInResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) {
    throw new ApiRequestError("Enter email and password", 400);
  }

  // Owner / returning account
  try {
    const res = await arrabApi.signInAccount({ email, password });
    clearOrgEmployeeSession();
    clearGuestLocalMode();
    writeAccountSession(res.sessionToken, res.account.id);
    return {
      kind: "account",
      displayName: res.account.displayName,
      email: res.account.email,
    };
  } catch (err) {
    if (!isUnauthorized(err) && !isNotFoundOrUnavailable(err)) throw err;
  }

  // Family seat — seat-bound account session (never keep a prior owner token)
  try {
    const res = await arrabApi.familyMemberSignIn({ email, password });
    clearOrgEmployeeSession();
    clearGuestLocalMode();
    writeAccountSession(res.sessionToken, res.account.id);
    writeActiveFamilyMemberId(res.member.id);
    return {
      kind: "family",
      displayName: res.member.displayName,
      email: res.member.email ?? res.account.email,
    };
  } catch (err) {
    if (!isUnauthorized(err) && !isNotFoundOrUnavailable(err)) throw err;
  }

  // Org employee — employee header only; drop any account bearer so this device is seat-scoped
  try {
    const res = await arrabApi.orgEmployeeSignIn({ email, password });
    clearAccountSession();
    clearGuestLocalMode();
    writeOrgEmployeeSession({
      sessionToken: res.sessionToken,
      expiresAt: res.expiresAt,
      employee: {
        id: res.employee.id,
        email: res.employee.email,
        displayName: res.employee.displayName,
        title: res.employee.title,
        role: res.employee.role,
        departmentId: res.employee.departmentId,
        mustChangePassword: res.employee.mustChangePassword,
      },
    });
    try {
      localStorage.setItem("arrab.studioRole", "organization");
    } catch {
      // ignore
    }
    return {
      kind: "organization",
      displayName: res.employee.displayName,
      email: res.employee.email,
    };
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    throw new ApiRequestError("Invalid email or password", 401);
  }
}
