/**
 * Org seat capabilities — single source for Live Map, assign, billing, Workplace.
 * Billing owner (no employee seat) = full admin. Seats never administer; role sets assign access.
 */
import { useSyncExternalStore } from "react";
import {
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
  type OrgEmployeeSession,
} from "@/domains/organization/org-employee-session";

export type OrgSeatRole = "admin" | "manager" | "member";

export type OrgSeatCapabilities = {
  employee: OrgEmployeeSession["employee"] | null;
  role: OrgSeatRole;
  canAdminister: boolean;
  canAssignWork: boolean;
  canOpenLiveMap: boolean;
  canViewOrgBilling: boolean;
  canViewOwnUsageOnly: boolean;
  /** Hire / compose workforce agents — admins only. */
  canHireAgents: boolean;
};

export function resolveOrgSeatCapabilities(
  employee: OrgEmployeeSession["employee"] | null = readOrgEmployeeSession()?.employee ?? null,
): OrgSeatCapabilities {
  if (!employee) {
    return {
      employee: null,
      role: "admin",
      canAdminister: true,
      canAssignWork: true,
      canOpenLiveMap: true,
      canViewOrgBilling: true,
      canViewOwnUsageOnly: false,
      canHireAgents: true,
    };
  }
  const role = employee.role;
  // Administration stays with the account owner — seat sessions never see it.
  const canAssignWork = role === "admin" || role === "manager";
  return {
    employee,
    role,
    canAdminister: false,
    canAssignWork,
    canOpenLiveMap: role === "admin",
    canViewOrgBilling: false,
    canViewOwnUsageOnly: true,
    canHireAgents: false,
  };
}

export function useOrgSeatCapabilities(): OrgSeatCapabilities {
  const session = useSyncExternalStore(
    subscribeOrgEmployeeSession,
    readOrgEmployeeSession,
    () => null,
  );
  return resolveOrgSeatCapabilities(session?.employee ?? null);
}
