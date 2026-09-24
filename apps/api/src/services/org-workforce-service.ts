import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  brandId,
  type Agent,
  type Conversation,
  type CreateOrgDepartmentRequest,
  type CreateOrgEmployeeRequest,
  type OrgDepartment,
  type OrgDepartmentId,
  type OrgEmployeeChangePasswordRequest,
  type OrgEmployeeId,
  type OrgEmployeePublic,
  type OrgEmployeeRecord,
  type OrgEmployeeRole,
  type OrgEmployeeSessionResponse,
  type OrgEmployeeSignInRequest,
  type OrgSecurityEvent,
  type OrgSecurityEventKind,
  type OrgWorkforceSnapshot,
  type StudioAccountRecord,
  type Task,
  type TeamId,
  type UpdateOrgDepartmentRequest,
  type UpdateOrgEmployeeRequest,
  type WorkspaceId,
} from "@arrab/shared";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PASSWORD_MIN = 12;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password123",
    "password1234",
    "12345678",
    "123456789012",
    "qwerty123456",
    "letmein12345",
    "welcome12345",
    "adminadmin12",
    "changeme1234",
    "arrabstudio1",
  ].map((value) => value.toLowerCase()),
);

type RateBucket = { count: number; resetAt: number };
const signInAttempts = new Map<string, RateBucket>();

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex");
  return `v2:${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith("v2:")) {
    const [, salt, expected] = stored.split(":");
    if (!salt || !expected) return false;
    const derived = scryptSync(password, salt, 64, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
    const expectedBuf = Buffer.from(expected, "hex");
    if (expectedBuf.length !== derived.length) return false;
    return timingSafeEqual(derived, expectedBuf);
  }
  // Legacy v1 format: salt:hash (account-compatible)
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, "hex");
  if (expectedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashIp(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function toPublic(employee: OrgEmployeeRecord): OrgEmployeePublic {
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

function requireEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ValidationError("A valid employee email is required");
  }
  return email;
}

function requireStrongPassword(value: string | undefined, email?: string): string {
  const password = value ?? "";
  if (password.length < PASSWORD_MIN) {
    throw new ValidationError(`Password must be at least ${PASSWORD_MIN} characters`);
  }
  if (password.length > 128) {
    throw new ValidationError("Password must be 128 characters or fewer");
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ValidationError("Password needs upper, lower, and a number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new ValidationError("Password needs at least one symbol");
  }
  if (/\s/.test(password)) {
    throw new ValidationError("Password cannot contain spaces");
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    throw new ValidationError("Choose a less common password");
  }
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lowered.includes(local)) {
    throw new ValidationError("Password cannot contain your email name");
  }
  return password;
}

function requireRole(value: OrgEmployeeRole | undefined): OrgEmployeeRole {
  if (value === "admin" || value === "manager" || value === "member") return value;
  return "member";
}

function assertRateLimit(key: string): void {
  const now = Date.now();
  const bucket = signInAttempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    signInAttempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    throw new ForbiddenError("Too many sign-in attempts. Wait a minute and try again.");
  }
}

function withSecurityDefaults(employee: OrgEmployeeRecord): OrgEmployeeRecord {
  return {
    ...employee,
    sessionExpiresAt: employee.sessionExpiresAt ?? null,
    failedLoginCount: employee.failedLoginCount ?? 0,
    lockedUntil: employee.lockedUntil ?? null,
    passwordChangedAt: employee.passwordChangedAt ?? null,
    mustChangePassword: Boolean(employee.mustChangePassword),
  };
}

export class OrgWorkforceService {
  constructor(
    private readonly persistence: Persistence,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Capability map for an org employee seat.
   * `null` means “no employee header” — treated as full admin only when a verified
   * studio account session is also present (individual / family owner path).
   * Anonymous callers must never reach here with admin rights.
   */
  permissionsFor(employee: OrgEmployeeRecord | null, accountOwner = false) {
    if (!employee && !accountOwner) {
      return {
        canAdminister: false,
        canAssignWork: false,
        canHireAgents: false,
        canManageTeams: false,
        canViewDirectory: false,
        canViewAllChats: false,
        canViewAllTasks: false,
        canViewAllAgents: false,
        canViewAudit: false,
      };
    }
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

  assertCapability(
    employee: OrgEmployeeRecord | null,
    capability: keyof ReturnType<OrgWorkforceService["permissionsFor"]>,
    detail = "Permission denied",
    account: StudioAccountRecord | null = null,
    /** Empty studio (no account yet) — local operator has full admin. */
    allowOpenWorkspace = false,
  ): void {
    const permissions = this.permissionsFor(
      employee,
      Boolean(account) || allowOpenWorkspace,
    );
    if (!permissions[capability]) {
      void this.audit("permission.denied", {
        actor: employee,
        detail: `${capability}: ${detail}`,
      });
      throw new ForbiddenError(detail);
    }
  }

  assertNotLockedOutOfActions(employee: OrgEmployeeRecord | null): void {
    if (!employee) return;
    if (employee.mustChangePassword) {
      throw new ForbiddenError("Change your temporary password before continuing");
    }
  }

  async resolveSession(token: string | undefined | null): Promise<OrgEmployeeRecord | null> {
    const trimmed = token?.trim();
    if (!trimmed) return null;
    const record = await this.persistence.orgEmployees.getBySessionHash(hashSessionToken(trimmed));
    if (!record || record.status !== "active") return null;
    const employee = withSecurityDefaults(record);
    if (employee.lockedUntil && Date.parse(employee.lockedUntil) > Date.now()) {
      return null;
    }
    if (!employee.sessionExpiresAt || Date.parse(employee.sessionExpiresAt) <= Date.now()) {
      await this.persistence.orgEmployees.update({
        ...employee,
        sessionTokenHash: null,
        sessionExpiresAt: null,
        updatedAt: this.clock.isoNow(),
      });
      return null;
    }
    return employee;
  }

  async snapshot(employee: OrgEmployeeRecord | null): Promise<OrgWorkforceSnapshot> {
    const permissions = this.permissionsFor(employee);
    const [departments, employees, events] = await Promise.all([
      this.persistence.orgDepartments.list(),
      permissions.canViewDirectory
        ? this.persistence.orgEmployees.list()
        : Promise.resolve(employee ? [employee] : []),
      permissions.canViewAudit
        ? this.persistence.orgSecurityEvents.listRecent(40)
        : Promise.resolve([]),
    ]);
    const allEmployees = permissions.canViewDirectory
      ? employees
      : await this.persistence.orgEmployees.list();
    const seatsUsed = allEmployees.filter((item) => item.status === "active").length;
    const officeBudget = Math.max(1, departments.length) * 8;
    const seatLimit = Math.max(8, officeBudget, seatsUsed);
    return {
      departments,
      employees: employees.map((item) => toPublic(withSecurityDefaults(item))),
      me: employee ? toPublic(employee) : null,
      recentSecurityEvents: events,
      seatsUsed,
      seatLimit,
      permissions,
      security: {
        passwordMinLength: PASSWORD_MIN,
        sessionTtlHours: SESSION_TTL_MS / (60 * 60 * 1000),
        lockoutThreshold: LOCKOUT_THRESHOLD,
        lockoutMinutes: LOCKOUT_MS / 60_000,
      },
    };
  }

  async listDepartments(): Promise<OrgDepartment[]> {
    return this.persistence.orgDepartments.list();
  }

  async createDepartment(
    input: CreateOrgDepartmentRequest,
    actor: OrgEmployeeRecord | null,
  ): Promise<OrgDepartment> {
    this.assertCapability(actor, "canAdminister", "Only admins can create departments");
    const name = input.name?.trim() ?? "";
    if (!name) throw new ValidationError("Department name is required");
    if (input.teamId) {
      const team = await this.persistence.teams.getById(input.teamId);
      if (!team) throw new ValidationError(`Unknown team '${input.teamId}'`);
    }
    const now = this.clock.isoNow();
    const doc: OrgDepartment = {
      id: brandId<OrgDepartmentId>(this.ids.next("dept")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      name: name.slice(0, 120),
      description: input.description?.trim() || null,
      teamId: input.teamId ? brandId<TeamId>(input.teamId) : null,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.orgDepartments.create(doc);
    await this.audit("department.created", { actor, detail: doc.name });
    return doc;
  }

  async updateDepartment(
    id: string,
    input: UpdateOrgDepartmentRequest,
    actor: OrgEmployeeRecord | null,
  ): Promise<OrgDepartment> {
    this.assertCapability(actor, "canAdminister", "Only admins can update departments");
    const existing = await this.persistence.orgDepartments.getById(id);
    if (!existing) throw new NotFoundError("Department", id);
    if (input.teamId) {
      const team = await this.persistence.teams.getById(input.teamId);
      if (!team) throw new ValidationError(`Unknown team '${input.teamId}'`);
    }
    const updated: OrgDepartment = {
      ...existing,
      name: input.name === undefined ? existing.name : input.name.trim().slice(0, 120),
      description:
        input.description === undefined ? existing.description : input.description?.trim() || null,
      teamId:
        input.teamId === undefined
          ? existing.teamId
          : input.teamId
            ? brandId<TeamId>(input.teamId)
            : null,
      updatedAt: this.clock.isoNow(),
    };
    if (!updated.name) throw new ValidationError("Department name is required");
    await this.persistence.orgDepartments.update(updated);
    await this.audit("department.updated", { actor, detail: updated.name });
    return updated;
  }

  async deleteDepartment(id: string, actor: OrgEmployeeRecord | null): Promise<{ ok: true }> {
    this.assertCapability(actor, "canAdminister", "Only admins can delete departments");
    const existing = await this.persistence.orgDepartments.getById(id);
    if (!existing) throw new NotFoundError("Department", id);
    const employees = await this.persistence.orgEmployees.list();
    for (const employee of employees) {
      if (employee.departmentId === id) {
        await this.persistence.orgEmployees.update({
          ...withSecurityDefaults(employee),
          departmentId: null,
          updatedAt: this.clock.isoNow(),
        });
      }
    }
    await this.persistence.orgDepartments.delete(id);
    await this.audit("department.deleted", { actor, detail: existing.name });
    return { ok: true };
  }

  async listEmployees(actor: OrgEmployeeRecord | null): Promise<OrgEmployeePublic[]> {
    this.assertCapability(actor, "canViewDirectory", "Only admins can view the employee directory");
    return (await this.persistence.orgEmployees.list()).map((item) =>
      toPublic(withSecurityDefaults(item)),
    );
  }

  async createEmployee(
    input: CreateOrgEmployeeRequest,
    actor: OrgEmployeeRecord | null,
  ): Promise<OrgEmployeePublic> {
    this.assertCapability(actor, "canAdminister", "Only admins can provision seats");
    const email = requireEmail(input.email);
    const password = requireStrongPassword(input.password, email);
    const displayName = input.displayName?.trim() ?? "";
    if (!displayName) throw new ValidationError("Display name is required");
    if (await this.persistence.orgEmployees.getByEmail(email)) {
      throw new ValidationError("An employee with this email already exists");
    }
    if (input.departmentId) {
      const dept = await this.persistence.orgDepartments.getById(input.departmentId);
      if (!dept) throw new ValidationError(`Unknown department '${input.departmentId}'`);
      const inDept = (await this.persistence.orgEmployees.list()).filter(
        (e) => e.departmentId === input.departmentId && e.status === "active",
      ).length;
      if (inDept >= 8) {
        throw new ValidationError("This department office is full (8 people max)");
      }
    }
    const role = requireRole(input.role);
    if (actor?.role === "admin" && role === "admin" && actor.id) {
      // org admins may create peer admins; studio owner (null) may too
    }
    const now = this.clock.isoNow();
    const record: OrgEmployeeRecord = {
      id: brandId<OrgEmployeeId>(this.ids.next("emp")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      departmentId: input.departmentId
        ? brandId<OrgDepartmentId>(input.departmentId)
        : null,
      email,
      displayName: displayName.slice(0, 120),
      title: input.title?.trim() || null,
      role,
      status: "active",
      passwordHash: hashPassword(password),
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
    await this.persistence.orgEmployees.create(record);
    await this.audit("employee.created", {
      actor,
      targetId: record.id,
      detail: `${record.email} (${record.role})`,
    });
    return toPublic(record);
  }

  async updateEmployee(
    id: string,
    input: UpdateOrgEmployeeRequest,
    actor: OrgEmployeeRecord | null,
  ): Promise<OrgEmployeePublic> {
    this.assertCapability(actor, "canAdminister", "Only admins can update seats");
    const found = await this.persistence.orgEmployees.getById(id);
    if (!found) throw new NotFoundError("Employee", id);
    const existing = withSecurityDefaults(found);
    if (input.departmentId) {
      const dept = await this.persistence.orgDepartments.getById(input.departmentId);
      if (!dept) throw new ValidationError(`Unknown department '${input.departmentId}'`);
    }
    const nextPassword = input.password
      ? requireStrongPassword(input.password, existing.email)
      : null;
    const updated: OrgEmployeeRecord = {
      ...existing,
      displayName:
        input.displayName === undefined
          ? existing.displayName
          : input.displayName.trim().slice(0, 120),
      title: input.title === undefined ? existing.title : input.title?.trim() || null,
      role: input.role === undefined ? existing.role : requireRole(input.role),
      status: input.status ?? existing.status,
      departmentId:
        input.departmentId === undefined
          ? existing.departmentId
          : input.departmentId
            ? brandId<OrgDepartmentId>(input.departmentId)
            : null,
      passwordHash: nextPassword ? hashPassword(nextPassword) : existing.passwordHash,
      passwordChangedAt: nextPassword ? this.clock.isoNow() : existing.passwordChangedAt,
      mustChangePassword: nextPassword ? true : existing.mustChangePassword,
      sessionTokenHash: nextPassword ? null : existing.sessionTokenHash,
      sessionExpiresAt: nextPassword ? null : existing.sessionExpiresAt,
      updatedAt: this.clock.isoNow(),
    };
    if (!updated.displayName) throw new ValidationError("Display name is required");
    await this.persistence.orgEmployees.update(updated);
    await this.audit(input.status === "disabled" ? "employee.disabled" : "employee.updated", {
      actor,
      targetId: updated.id,
      detail: updated.email,
    });
    if (nextPassword) {
      await this.audit("employee.session_revoked", {
        actor,
        targetId: updated.id,
        detail: "Password reset by admin",
      });
    }
    return toPublic(updated);
  }

  async deleteEmployee(id: string, actor: OrgEmployeeRecord | null): Promise<{ ok: true }> {
    this.assertCapability(actor, "canAdminister", "Only admins can delete seats");
    const existing = await this.persistence.orgEmployees.getById(id);
    if (!existing) throw new NotFoundError("Employee", id);
    if (actor?.id === id) {
      throw new ValidationError("You cannot delete your own seat while signed in");
    }
    await this.persistence.orgEmployees.delete(id);
    await this.audit("employee.deleted", { actor, targetId: id, detail: existing.email });
    return { ok: true };
  }

  async signIn(
    input: OrgEmployeeSignInRequest,
    ip?: string | null,
  ): Promise<OrgEmployeeSessionResponse> {
    const email = requireEmail(input.email);
    const rateKey = `${hashIp(ip) ?? "local"}:${email}`;
    assertRateLimit(rateKey);

    const found = await this.persistence.orgEmployees.getByEmail(email);
    const employee = found ? withSecurityDefaults(found) : null;
    const password = input.password ?? "";

    if (employee?.lockedUntil && Date.parse(employee.lockedUntil) > Date.now()) {
      await this.audit("employee.sign_in_failed", {
        targetId: employee.id,
        detail: "Account locked",
        ip,
      });
      throw new ForbiddenError("This seat is temporarily locked after failed sign-ins");
    }

    const valid =
      employee &&
      employee.status === "active" &&
      verifyPassword(password, employee.passwordHash);

    if (!valid) {
      if (employee) {
        const failedLoginCount = (employee.failedLoginCount ?? 0) + 1;
        const lockedUntil =
          failedLoginCount >= LOCKOUT_THRESHOLD
            ? new Date(Date.now() + LOCKOUT_MS).toISOString()
            : null;
        await this.persistence.orgEmployees.update({
          ...employee,
          failedLoginCount,
          lockedUntil,
          sessionTokenHash: lockedUntil ? null : employee.sessionTokenHash,
          sessionExpiresAt: lockedUntil ? null : employee.sessionExpiresAt,
          updatedAt: this.clock.isoNow(),
        });
        await this.audit(
          lockedUntil ? "employee.locked" : "employee.sign_in_failed",
          {
            targetId: employee.id,
            detail: lockedUntil
              ? `Locked after ${failedLoginCount} failures`
              : `Failed attempt ${failedLoginCount}`,
            ip,
          },
        );
      } else {
        await this.audit("employee.sign_in_failed", {
          detail: `Unknown email ${email}`,
          ip,
        });
      }
      throw new UnauthorizedError("Invalid employee email or password");
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const updated: OrgEmployeeRecord = {
      ...employee!,
      sessionTokenHash: hashSessionToken(sessionToken),
      sessionExpiresAt: expiresAt,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: this.clock.isoNow(),
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.orgEmployees.update(updated);
    await this.audit("employee.sign_in", {
      actor: updated,
      targetId: updated.id,
      detail: updated.email,
      ip,
    });
    return { sessionToken, expiresAt, employee: toPublic(updated) };
  }

  async changePassword(
    employee: OrgEmployeeRecord,
    input: OrgEmployeeChangePasswordRequest,
  ): Promise<OrgEmployeeSessionResponse> {
    if (!verifyPassword(input.currentPassword ?? "", employee.passwordHash)) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    const next = requireStrongPassword(input.newPassword, employee.email);
    if (verifyPassword(next, employee.passwordHash)) {
      throw new ValidationError("New password must be different from the current password");
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const updated: OrgEmployeeRecord = {
      ...withSecurityDefaults(employee),
      passwordHash: hashPassword(next),
      passwordChangedAt: this.clock.isoNow(),
      mustChangePassword: false,
      sessionTokenHash: hashSessionToken(sessionToken),
      sessionExpiresAt: expiresAt,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.orgEmployees.update(updated);
    await this.audit("employee.password_changed", {
      actor: updated,
      targetId: updated.id,
      detail: "Password rotated",
    });
    return { sessionToken, expiresAt, employee: toPublic(updated) };
  }

  async signOut(employee: OrgEmployeeRecord): Promise<{ ok: true }> {
    await this.persistence.orgEmployees.update({
      ...withSecurityDefaults(employee),
      sessionTokenHash: null,
      sessionExpiresAt: null,
      updatedAt: this.clock.isoNow(),
    });
    await this.audit("employee.sign_out", {
      actor: employee,
      targetId: employee.id,
      detail: employee.email,
    });
    return { ok: true };
  }

  async filterConversations(
    conversations: Conversation[],
    employee: OrgEmployeeRecord | null,
  ): Promise<Conversation[]> {
    if (!employee || employee.role === "admin") return conversations;
    const own = conversations.filter((conversation) => conversation.ownerEmployeeId === employee.id);
    const departmentVisible = await this.departmentVisibleConversations(conversations, employee);
    const workspaceVisible = conversations.filter(
      (conversation) => conversation.visibility === "workspace" && !conversation.ownerEmployeeId,
    );
    const merged = [...own, ...departmentVisible, ...workspaceVisible];
    return merged.filter(
      (item, index, all) => all.findIndex((other) => other.id === item.id) === index,
    );
  }

  private async departmentVisibleConversations(
    conversations: Conversation[],
    employee: OrgEmployeeRecord,
  ): Promise<Conversation[]> {
    if (!employee.departmentId) return [];
    const peers = (await this.persistence.orgEmployees.list())
      .filter((peer) => peer.departmentId === employee.departmentId)
      .map((peer) => peer.id);
    const peerSet = new Set(peers);
    return conversations.filter(
      (conversation) =>
        conversation.visibility === "department" &&
        conversation.ownerEmployeeId &&
        peerSet.has(conversation.ownerEmployeeId as OrgEmployeeId),
    );
  }

  async assertCanOpenConversation(
    conversation: Conversation,
    employee: OrgEmployeeRecord | null,
  ): Promise<void> {
    if (!employee || employee.role === "admin") return;
    const visible = await this.filterConversations([conversation], employee);
    if (visible.length === 0) {
      await this.audit("permission.denied", {
        actor: employee,
        detail: `Blocked private chat ${conversation.id}`,
      });
      throw new ForbiddenError("This chat is private to another employee");
    }
  }

  async filterAgents(agents: Agent[], employee: OrgEmployeeRecord | null): Promise<Agent[]> {
    if (!employee || employee.role === "admin") return agents;
    if (!employee.departmentId) return [];
    const department = await this.persistence.orgDepartments.getById(employee.departmentId);
    if (!department?.teamId) return [];
    const members = await this.persistence.memberships.listByTeam(department.teamId);
    const allowed = new Set(members.map((member) => member.agentId));
    return agents.filter((agent) => allowed.has(agent.id));
  }

  async filterTasks(tasks: Task[], employee: OrgEmployeeRecord | null): Promise<Task[]> {
    if (!employee || employee.role === "admin") return tasks;
    const agents = await this.filterAgents(await this.persistence.agents.list(), employee);
    const agentIds = new Set(agents.map((agent) => agent.id));
    let departmentTeamId: string | null = null;
    if (employee.departmentId) {
      const department = await this.persistence.orgDepartments.getById(employee.departmentId);
      departmentTeamId = department?.teamId ?? null;
    }
    return tasks.filter(
      (task) =>
        task.assigneeEmployeeId === employee.id ||
        (task.assigneeAgentId != null && agentIds.has(task.assigneeAgentId)) ||
        (departmentTeamId != null && task.teamId === departmentTeamId),
    );
  }

  private async audit(
    kind: OrgSecurityEventKind,
    input: {
      actor?: OrgEmployeeRecord | null;
      targetId?: string | null;
      detail: string;
      ip?: string | null;
    },
  ): Promise<void> {
    const event: OrgSecurityEvent = {
      id: this.ids.next("sec"),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      kind,
      actorEmployeeId: input.actor?.id ?? null,
      targetEmployeeId: input.targetId ?? null,
      detail: input.detail.slice(0, 500),
      ipHash: hashIp(input.ip),
      createdAt: this.clock.isoNow(),
    };
    await this.persistence.orgSecurityEvents.append(event);
  }
}
