/**
 * Org seat capabilities — single source for Live Map, assign, billing, Workplace.
 * Billing owner (no employee seat) = full admin. Employee seats use role.
 */
import { useSyncExternalStore } from "react";
import {
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
  type OrgEmployeeSession,
} from "@/lib/org-employee-session";

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
  const canAdminister = role === "admin";
  const canAssignWork = role === "admin" || role === "manager";
  return {
    employee,
    role,
    canAdminister,
    canAssignWork,
    canOpenLiveMap: canAdminister,
    canViewOrgBilling: canAdminister,
    canViewOwnUsageOnly: !canAdminister,
    canHireAgents: canAdminister,
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
