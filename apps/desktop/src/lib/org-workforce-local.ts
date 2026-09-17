/**
 * Local org workforce when cloud `/v1/org/*` is missing (404) or unhealthy.
 * Departments map to Live Map offices; each holds at most 8 people.
 */
import type {
  CreateOrgDepartmentRequest,
  CreateOrgEmployeeRequest,
  OrgDepartment,
  OrgDepartmentId,
  OrgEmployeeChangePasswordRequest,
  OrgEmployeeId,
  OrgEmployeePublic,
  OrgEmployeeRecord,
  OrgEmployeeRole,
  OrgEmployeeSessionResponse,
  OrgEmployeeSignInRequest,
  OrgSecurityEvent,
  OrgWorkforceSnapshot,
  TeamId,
  UpdateOrgDepartmentRequest,
  UpdateOrgEmployeeRequest,
  WorkspaceId,
} from "@arrab/shared";

const STORE_KEY = "arrab.org.workforce.v1";
export const DEPT_SEAT_CAPACITY = 8;
export const DEFAULT_ORG_SEAT_LIMIT = 8;

type StoredEmployee = OrgEmployeeRecord;

type LocalStore = {
  workspaceId: string;
  departments: OrgDepartment[];
  employees: StoredEmployee[];
  events: OrgSecurityEvent[];
  /** Total human seats available on the org plan (buy more later). */
  seatLimit: number;
};

function isoNow() {
  return new Date().toISOString();
}

function nid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function emptyStore(): LocalStore {
  return {
    workspaceId: "ws_local",
    departments: [],
    employees: [],
    events: [],
    seatLimit: DEFAULT_ORG_SEAT_LIMIT,
  };
}

function readStore(): LocalStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return {
      workspaceId: parsed.workspaceId || "ws_local",
      departments: Array.isArray(parsed.departments) ? parsed.departments : [],
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      seatLimit: Math.max(1, Number(parsed.seatLimit) || DEFAULT_ORG_SEAT_LIMIT),
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: LocalStore) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function toPublic(employee: StoredEmployee): OrgEmployeePublic {
  return {
    id: employee.id,
    workspaceId: employee.workspaceId,
    departmentId: employee.departmentId,
    email: employee.email,
    displayName: employee.displayName,
    title: employee.title,
    role: employee.role,
    status: employee.status,
    mustChangePassword: Boolean(employee.mustChangePassword),
    lastLoginAt: employee.lastLoginAt,
    sessionExpiresAt: employee.sessionExpiresAt,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

function permissionsFor(employee: OrgEmployeePublic | null) {
  const role = employee?.role ?? "admin";
  const isAdmin = !employee || role === "admin";
  const isManager = isAdmin || role === "manager";
  return {
    canAdminister: isAdmin,
    canAssignWork: isManager,
    canHireAgents: isAdmin,
    canManageTeams: isAdmin,
    canViewDirectory: isAdmin,
    canViewAllChats: isAdmin,
    canViewAllTasks: isAdmin,
    canViewAllAgents: isAdmin,
    canViewAudit: isAdmin,
  };
}

function pushEvent(
  store: LocalStore,
  kind: OrgSecurityEvent["kind"],
  detail: string,
  actorId: string | null = null,
  targetId: string | null = null,
) {
  store.events.unshift({
    id: nid("evt"),
    workspaceId: store.workspaceId as WorkspaceId,
    kind,
    actorEmployeeId: actorId,
    targetEmployeeId: targetId,
    detail,
    ipHash: null,
    createdAt: isoNow(),
  });
  store.events = store.events.slice(0, 80);
}

function requireEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Enter a valid work email");
  }
  return value;
}

function requirePassword(password: string) {
  if (password.length < 12) throw new Error("Password must be at least 12 characters");
  return password;
}

function requireRole(role?: OrgEmployeeRole): OrgEmployeeRole {
  if (role === "admin" || role === "manager" || role === "member") return role;
  return "member";
}

export function getLocalSeatBudget() {
  const store = readStore();
  return {
    seatLimit: store.seatLimit,
    used: store.employees.filter((e) => e.status === "active").length,
  };
}

export function bumpLocalSeatLimit(by: number) {
  const store = readStore();
  store.seatLimit = Math.max(store.seatLimit, store.seatLimit + Math.max(1, by));
  writeStore(store);
  return store.seatLimit;
}

export function setLocalSeatLimit(limit: number) {
  const store = readStore();
  store.seatLimit = Math.max(1, Math.floor(limit));
  writeStore(store);
  return store.seatLimit;
}

export async function localOrgSnapshot(
  me: OrgEmployeePublic | null = null,
): Promise<OrgWorkforceSnapshot & { local: true }> {
  const store = readStore();
  const permissions = permissionsFor(me);
  const employees = permissions.canViewDirectory
    ? store.employees
    : me
      ? store.employees.filter((e) => e.id === me.id)
      : [];
  const used = store.employees.filter((e) => e.status === "active").length;
  return {
    departments: store.departments,
    employees: employees.map(toPublic),
    me,
    recentSecurityEvents: permissions.canViewAudit ? store.events.slice(0, 40) : [],
    permissions,
    security: {
      passwordMinLength: 12,
      sessionTtlHours: 12,
      lockoutThreshold: 5,
      lockoutMinutes: 15,
    },
    seatLimit: store.seatLimit,
    seatsUsed: used,
    local: true,
  };
}

export async function localCreateDepartment(
  input: CreateOrgDepartmentRequest,
): Promise<OrgDepartment> {
  const store = readStore();
  const name = input.name?.trim() ?? "";
  if (!name) throw new Error("Department name is required");
  if (store.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A department with this name already exists");
  }
  const now = isoNow();
  const doc: OrgDepartment = {
    id: nid("dept") as OrgDepartmentId,
    workspaceId: store.workspaceId as WorkspaceId,
    name: name.slice(0, 120),
    description: input.description?.trim() || null,
    teamId: (input.teamId as TeamId | null) || null,
    createdAt: now,
    updatedAt: now,
  };
  store.departments.unshift(doc);
  pushEvent(store, "department.created", doc.name);
  writeStore(store);
  return doc;
}

export async function localUpdateDepartment(
  id: string,
  input: UpdateOrgDepartmentRequest,
): Promise<OrgDepartment> {
  const store = readStore();
  const existing = store.departments.find((d) => d.id === id);
  if (!existing) throw new Error("Department not found");
  existing.name = input.name === undefined ? existing.name : input.name.trim().slice(0, 120);
  existing.description =
    input.description === undefined ? existing.description : input.description?.trim() || null;
  existing.teamId =
    input.teamId === undefined ? existing.teamId : ((input.teamId as TeamId | null) || null);
  existing.updatedAt = isoNow();
  pushEvent(store, "department.updated", existing.name);
  writeStore(store);
  return existing;
}

export async function localDeleteDepartment(id: string): Promise<{ ok: true }> {
  const store = readStore();
  const existing = store.departments.find((d) => d.id === id);
  if (!existing) throw new Error("Department not found");
  store.departments = store.departments.filter((d) => d.id !== id);
  for (const emp of store.employees) {
    if (emp.departmentId === id) {
      emp.departmentId = null;
      emp.updatedAt = isoNow();
    }
  }
  pushEvent(store, "department.deleted", existing.name);
  writeStore(store);
  return { ok: true };
}

export async function localCreateEmployee(
  input: CreateOrgEmployeeRequest,
): Promise<OrgEmployeePublic> {
  const store = readStore();
  const email = requireEmail(input.email);
  const password = requirePassword(input.password);
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new Error("Display name is required");
  if (store.employees.some((e) => e.email === email)) {
    throw new Error("An employee with this email already exists");
  }
  const used = store.employees.filter((e) => e.status === "active").length;
  if (used >= store.seatLimit) {
    throw new Error("No employee seats left — upgrade seats on a plan");
  }
  if (input.departmentId) {
    const dept = store.departments.find((d) => d.id === input.departmentId);
    if (!dept) throw new Error("Unknown department");
    const inDept = store.employees.filter(
      (e) => e.departmentId === input.departmentId && e.status === "active",
    ).length;
    if (inDept >= DEPT_SEAT_CAPACITY) {
      throw new Error(`This office is full (${DEPT_SEAT_CAPACITY} people max)`);
    }
  }
  const now = isoNow();
  const record: StoredEmployee = {
    id: nid("emp") as OrgEmployeeId,
    workspaceId: store.workspaceId as WorkspaceId,
    departmentId: (input.departmentId as OrgDepartmentId | null) || null,
    email,
    displayName: displayName.slice(0, 120),
    title: input.title?.trim() || null,
    role: requireRole(input.role),
    status: "active",
    passwordHash: await sha256(`arrab:${email}:${password}`),
    sessionTokenHash: null,
    sessionExpiresAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordChangedAt: now,
    mustChangePassword: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
  store.employees.unshift(record);
  pushEvent(store, "employee.created", `${record.email} (${record.role})`, null, record.id);
  writeStore(store);
  return toPublic(record);
}

export async function localDeleteEmployee(id: string): Promise<{ ok: true }> {
  const store = readStore();
  const existing = store.employees.find((e) => e.id === id);
  if (!existing) throw new Error("Employee not found");
  store.employees = store.employees.filter((e) => e.id !== id);
  pushEvent(store, "employee.deleted", existing.email, null, id);
  writeStore(store);
  return { ok: true };
}

export async function localUpdateEmployee(
  id: string,
  input: UpdateOrgEmployeeRequest,
): Promise<OrgEmployeePublic> {
  const store = readStore();
  const existing = store.employees.find((e) => e.id === id);
  if (!existing) throw new Error("Employee not found");
  if (input.departmentId) {
    const dept = store.departments.find((d) => d.id === input.departmentId);
    if (!dept) throw new Error("Unknown department");
    const inDept = store.employees.filter(
      (e) => e.departmentId === input.departmentId && e.status === "active" && e.id !== id,
    ).length;
    if (inDept >= DEPT_SEAT_CAPACITY) {
      throw new Error(`This office is full (${DEPT_SEAT_CAPACITY} people max)`);
    }
  }
  if (input.displayName !== undefined) existing.displayName = input.displayName.trim().slice(0, 120);
  if (input.title !== undefined) existing.title = input.title?.trim() || null;
  if (input.role !== undefined) existing.role = requireRole(input.role);
  if (input.status !== undefined) existing.status = input.status;
  if (input.departmentId !== undefined) {
    existing.departmentId = (input.departmentId as OrgDepartmentId | null) || null;
  }
  if (input.password) {
    existing.passwordHash = await sha256(`arrab:${existing.email}:${requirePassword(input.password)}`);
    existing.mustChangePassword = false;
    existing.passwordChangedAt = isoNow();
  }
  existing.updatedAt = isoNow();
  pushEvent(store, "employee.updated", existing.email, null, id);
  writeStore(store);
  return toPublic(existing);
}

export async function localEmployeeSignIn(
  input: OrgEmployeeSignInRequest,
): Promise<OrgEmployeeSessionResponse> {
  const store = readStore();
  const email = requireEmail(input.email);
  const employee = store.employees.find((e) => e.email === email && e.status === "active");
  if (!employee) throw new Error("Invalid email or password");
  const hash = await sha256(`arrab:${email}:${input.password}`);
  if (hash !== employee.passwordHash) {
    employee.failedLoginCount += 1;
    pushEvent(store, "employee.sign_in_failed", email, null, employee.id);
    writeStore(store);
    throw new Error("Invalid email or password");
  }
  const token = nid("sess");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  employee.sessionTokenHash = await sha256(token);
  employee.sessionExpiresAt = expiresAt;
  employee.lastLoginAt = isoNow();
  employee.failedLoginCount = 0;
  employee.updatedAt = isoNow();
  pushEvent(store, "employee.sign_in", email, employee.id, employee.id);
  writeStore(store);
  return { sessionToken: token, expiresAt, employee: toPublic(employee) };
}

export async function localEmployeeSignOut(sessionToken: string | null): Promise<{ ok: true }> {
  if (!sessionToken) return { ok: true };
  const store = readStore();
  const hash = await sha256(sessionToken);
  const employee = store.employees.find((e) => e.sessionTokenHash === hash);
  if (employee) {
    employee.sessionTokenHash = null;
    employee.sessionExpiresAt = null;
    employee.updatedAt = isoNow();
    pushEvent(store, "employee.sign_out", employee.email, employee.id, employee.id);
    writeStore(store);
  }
  return { ok: true };
}

export async function localEmployeeChangePassword(
  sessionToken: string,
  input: OrgEmployeeChangePasswordRequest,
): Promise<OrgEmployeeSessionResponse> {
  const store = readStore();
  const hash = await sha256(sessionToken);
  const employee = store.employees.find((e) => e.sessionTokenHash === hash);
  if (!employee) throw new Error("Employee session required");
  const current = await sha256(`arrab:${employee.email}:${input.currentPassword}`);
  if (current !== employee.passwordHash) throw new Error("Current password is incorrect");
  const next = requirePassword(input.newPassword);
  employee.passwordHash = await sha256(`arrab:${employee.email}:${next}`);
  employee.mustChangePassword = false;
  employee.passwordChangedAt = isoNow();
  employee.updatedAt = isoNow();
  const token = nid("sess");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  employee.sessionTokenHash = await sha256(token);
  employee.sessionExpiresAt = expiresAt;
  pushEvent(store, "employee.password_changed", employee.email, employee.id, employee.id);
  writeStore(store);
  return { sessionToken: token, expiresAt, employee: toPublic(employee) };
}

export function countDeptEmployees(departmentId: string): number {
  const store = readStore();
  return store.employees.filter((e) => e.departmentId === departmentId && e.status === "active")
    .length;
}
