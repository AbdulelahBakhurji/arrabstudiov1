import type { OrgDepartmentId, OrgEmployeeId, TeamId, WorkspaceId } from "./ids.js";
import type { Timestamps } from "./entities.js";

export type OrgEmployeeRole = "admin" | "manager" | "member";
export type OrgEmployeeStatus = "active" | "disabled";
export type ConversationVisibility = "private" | "department" | "workspace";
export type OrgSecurityEventKind =
  | "employee.created"
  | "employee.updated"
  | "employee.disabled"
  | "employee.deleted"
  | "employee.sign_in"
  | "employee.sign_in_failed"
  | "employee.sign_out"
  | "employee.password_changed"
  | "employee.locked"
  | "employee.session_revoked"
  | "department.created"
  | "department.updated"
  | "department.deleted"
  | "permission.denied";

export interface OrgDepartment extends Timestamps {
  id: OrgDepartmentId;
  workspaceId: WorkspaceId;
  name: string;
  description: string | null;
  /** Linked AI team — employees in this department see these agents. */
  teamId: TeamId | null;
}

export interface OrgEmployeeRecord extends Timestamps {
  id: OrgEmployeeId;
  workspaceId: WorkspaceId;
  departmentId: OrgDepartmentId | null;
  email: string;
  displayName: string;
  title: string | null;
  role: OrgEmployeeRole;
  status: OrgEmployeeStatus;
  /** scrypt hash — never returned to clients */
  passwordHash: string;
  sessionTokenHash: string | null;
  sessionExpiresAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  passwordChangedAt: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface OrgEmployeePublic {
  id: OrgEmployeeId;
  workspaceId: WorkspaceId;
  departmentId: OrgDepartmentId | null;
  email: string;
  displayName: string;
  title: string | null;
  role: OrgEmployeeRole;
  status: OrgEmployeeStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  sessionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgSecurityEvent {
  id: string;
  workspaceId: WorkspaceId;
  kind: OrgSecurityEventKind;
  actorEmployeeId: string | null;
  targetEmployeeId: string | null;
  detail: string;
  ipHash: string | null;
  createdAt: string;
}

export interface CreateOrgDepartmentRequest {
  name: string;
  description?: string | null;
  teamId?: string | null;
}

export interface UpdateOrgDepartmentRequest {
  name?: string;
  description?: string | null;
  teamId?: string | null;
}

export interface CreateOrgEmployeeRequest {
  email: string;
  password: string;
  displayName: string;
  title?: string | null;
  role?: OrgEmployeeRole;
  departmentId?: string | null;
}

export interface UpdateOrgEmployeeRequest {
  displayName?: string;
  title?: string | null;
  role?: OrgEmployeeRole;
  departmentId?: string | null;
  status?: OrgEmployeeStatus;
  password?: string;
}

export interface OrgEmployeeSignInRequest {
  email: string;
  password: string;
}

export interface OrgEmployeeChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface OrgEmployeeSessionResponse {
  sessionToken: string;
  expiresAt: string;
  employee: OrgEmployeePublic;
}

export interface OrgWorkforceSnapshot {
  departments: OrgDepartment[];
  employees: OrgEmployeePublic[];
  me: OrgEmployeePublic | null;
  recentSecurityEvents: OrgSecurityEvent[];
  /** Active seats currently provisioned. */
  seatsUsed: number;
  /** Plan seat budget (defaults to 8, grows with seat packs / departments). */
  seatLimit: number;
  permissions: {
    canAdminister: boolean;
    canAssignWork: boolean;
    canHireAgents: boolean;
    canManageTeams: boolean;
    canViewDirectory: boolean;
    canViewAllChats: boolean;
    canViewAllTasks: boolean;
    canViewAllAgents: boolean;
    canViewAudit: boolean;
  };
  security: {
    passwordMinLength: number;
    sessionTtlHours: number;
    lockoutThreshold: number;
    lockoutMinutes: number;
  };
}
