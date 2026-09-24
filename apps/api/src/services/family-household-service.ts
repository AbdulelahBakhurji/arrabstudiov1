import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
  SUBSCRIPTION_PLANS,
  isFamilyPlanId,
  brandId,
  type CreateFamilyGuidanceRequest,
  type CreateFamilyMemberRequest,
  type FamilyAgeTier,
  type FamilyGuidancePublic,
  type FamilyGuidanceRecord,
  type FamilyHouseholdSnapshot,
  type FamilyMemberId,
  type FamilyMemberPublic,
  type FamilyMemberRecord,
  type FamilyMemberRole,
  type FamilyMemberSignInRequest,
  type FamilyMemberSignInResponse,
  type FamilySeatPack,
  type GrantFamilyTokensRequest,
  type PurchaseFamilySeatsRequest,
  type SwitchFamilyProfileRequest,
  type SwitchFamilyProfileResponse,
  type UpdateFamilyMemberRequest,
  type WorkspaceId,
} from "@arrab/shared";
import type { AccountService } from "./account-service.js";
import { createHash } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MEMBER_COLORS = ["#7C6A4E", "#4A6FA5", "#6B8F71", "#C17B5C", "#8B6B9E", "#5A8A8A"];

const SEAT_PACKS: FamilySeatPack[] = [
  { seats: 1, label: "+1 seat", priceHalalas: 1_900 },
  { seats: 2, label: "+2 seats", priceHalalas: 3_400 },
  { seats: 5, label: "+5 seats", priceHalalas: 7_900 },
];

const SEAT_CODES: Record<string, 1 | 2 | 5> = {
  "FAMILY-SEAT": 1,
  "FAMILY-SEAT-2": 2,
  "FAMILY-SEAT-5": 5,
};

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertPinFormat(pin: string | null | undefined, required: boolean): string | null {
  if (pin == null || pin === "") {
    if (required) throw new ValidationError("A 4–8 digit PIN is required");
    return null;
  }
  if (!/^\d{4,8}$/.test(pin)) {
    throw new ValidationError("PIN must be 4–8 digits");
  }
  return pin;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase() ?? "";
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new ValidationError("Enter a valid email address");
  }
  return value;
}

function assertPassword(password: string | null | undefined, required: boolean): string | null {
  if (password == null || password === "") {
    if (required) throw new ValidationError("Password is required for children (min 8 characters)");
    return null;
  }
  if (password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters");
  }
  return password;
}

function isManagerRole(role: FamilyMemberRole): boolean {
  return role === "parent" || role === "partner";
}

function toPublic(member: FamilyMemberRecord): FamilyMemberPublic {
  const remaining = Math.max(0, member.tokenAllowance - member.tokensUsed);
  const usagePercent =
    member.tokenAllowance > 0
      ? Math.min(100, Math.round((member.tokensUsed / member.tokenAllowance) * 100))
      : 0;
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    displayName: member.displayName,
    role: member.role,
    ageTier: member.ageTier,
    color: member.color,
    hasPin: Boolean(member.pinHash),
    email: member.email ?? null,
    hasPassword: Boolean(member.passwordHash),
    isOwner: member.isOwner,
    isPaused: member.isPaused,
    isManager: isManagerRole(member.role),
    tokenAllowance: member.tokenAllowance,
    tokensUsed: member.tokensUsed,
    tokensRemaining: remaining,
    usagePercent,
    lastActiveAt: member.lastActiveAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function toGuidancePublic(note: FamilyGuidanceRecord): FamilyGuidancePublic {
  return {
    id: note.id,
    companionId: note.companionId,
    childMemberId: note.childMemberId,
    authorMemberId: note.authorMemberId,
    authorName: note.authorName,
    content: note.content,
    createdAt: note.createdAt,
  };
}

export class FamilyHouseholdService {
  private activeMemberByWorkspace = new Map<string, string>();

  constructor(
    private readonly persistence: Persistence,
    private readonly accounts: AccountService,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async requireFamilyAccount(): Promise<
    Awaited<ReturnType<Persistence["accounts"]["get"]>> & {
      planId: "family_free" | "family" | "family_plus";
    }
  > {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) {
      throw new ForbiddenError("Family household requires an active Family plan");
    }
    return account as typeof account & { planId: "family_free" | "family" | "family_plus" };
  }

  /** Parent/partner seat required for household mutations. */
  private async requireManagerSeat(): Promise<FamilyMemberRecord> {
    const account = await this.requireFamilyAccount();
    const entitlements = await this.accounts.buildEntitlements(account);
    const members = await this.ensureOwnerSeat(entitlements.tokenLimit ?? 0);
    const owner = members.find((m) => m.isOwner) ?? null;
    if (!owner) {
      throw new ForbiddenError("Only a parent or partner can manage the household");
    }

    const lockedId = await this.persistence.familyHouseholdMeta.getLockedMemberId();
    if (lockedId) {
      const locked = await this.persistence.familyMembers.getById(lockedId);
      if (!locked || !isManagerRole(locked.role)) {
        throw new ForbiddenError("Only a parent or partner can manage the household");
      }
      return locked;
    }

    // Unlocked parent-device session: even if a child profile is selected for chat,
    // household mutations stay with the owner/manager seat.
    const seatId = await this.getActiveMemberId();
    const seat = seatId ? await this.persistence.familyMembers.getById(seatId) : null;
    if (seat && isManagerRole(seat.role)) return seat;
    return owner;
  }

  private async ensureOwnerSeat(poolTokens: number): Promise<FamilyMemberRecord[]> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) {
      return [];
    }
    const members = await this.persistence.familyMembers.list();
    const owner = members.find((m) => m.isOwner);
    if (owner) {
      let next = owner;
      if (owner.displayName !== account.displayName) {
        next = { ...next, displayName: account.displayName, updatedAt: this.clock.isoNow() };
      }
      if (members.length === 1 && next.tokenAllowance === 0 && poolTokens > 0) {
        next = { ...next, tokenAllowance: poolTokens, updatedAt: this.clock.isoNow() };
      }
      if (next !== owner) {
        await this.persistence.familyMembers.update(next);
        return this.persistence.familyMembers.list();
      }
      return members;
    }
    const now = this.clock.isoNow();
    const created: FamilyMemberRecord = {
      id: brandId<FamilyMemberId>(this.ids.next("fam")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      displayName: account.displayName || "Parent",
      role: "parent",
      ageTier: null,
      color: MEMBER_COLORS[0]!,
      pinHash: null,
      email: null,
      passwordHash: null,
      isOwner: true,
      isPaused: false,
      tokenAllowance: poolTokens,
      tokensUsed: 0,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.familyMembers.create(created);
    this.activeMemberByWorkspace.set(this.persistence.workspaceId, created.id);
    return this.persistence.familyMembers.list();
  }

  private async baseSeatLimit(planId: "family_free" | "family" | "family_plus"): Promise<number> {
    const extra = await this.persistence.familyHouseholdMeta.getExtraSeats();
    return (SUBSCRIPTION_PLANS[planId].seatLimit ?? 6) + extra;
  }

  /** Kids use email/password only — wipe any legacy PIN hashes. */
  private async stripChildPins(members: FamilyMemberRecord[]): Promise<FamilyMemberRecord[]> {
    const now = this.clock.isoNow();
    let changed = false;
    for (const member of members) {
      if (member.role === "child" && member.pinHash) {
        await this.persistence.familyMembers.update({
          ...member,
          pinHash: null,
          updatedAt: now,
        });
        changed = true;
      }
    }
    return changed ? this.persistence.familyMembers.list() : members;
  }

  async snapshot(): Promise<FamilyHouseholdSnapshot> {
    const account = await this.persistence.accounts.get();
    const entitlements = await this.accounts.buildEntitlements(account);
    if (!account || !isFamilyPlanId(account.planId)) {
      return {
        available: false,
        planId: null,
        planName: null,
        seatsUsed: 0,
        seatLimit: 0,
        extraSeats: 0,
        members: [],
        activeMemberId: null,
        seatLocked: false,
        usage: null,
        seatPacks: SEAT_PACKS,
        recentGuidance: [],
        entitlements,
      };
    }

    const planId = account.planId;
    const pool = entitlements.tokenLimit ?? 0;
    const membersRaw = await this.ensureOwnerSeat(pool);
    const members = await this.stripChildPins(membersRaw);
    const extraSeats = await this.persistence.familyHouseholdMeta.getExtraSeats();
    const seatLimit = await this.baseSeatLimit(planId);
    const allocated = members.reduce((sum, m) => sum + m.tokenAllowance, 0);
    const memberUsed = members.reduce((sum, m) => sum + m.tokensUsed, 0);
    const unallocatedTokens = Math.max(0, pool - allocated);
    const activeId =
      this.activeMemberByWorkspace.get(this.persistence.workspaceId) ??
      (await this.persistence.familyHouseholdMeta.getActiveMemberId());
    const activeMemberId =
      activeId && members.some((m) => m.id === activeId)
        ? brandId<FamilyMemberId>(activeId)
        : (members.find((m) => m.isOwner)?.id ?? null);
    const recentGuidance = (await this.persistence.familyGuidance.listRecent(20)).map(
      toGuidancePublic,
    );
    const lockedMemberId = await this.persistence.familyHouseholdMeta.getLockedMemberId();
    const activeSeat =
      activeMemberId != null
        ? members.find((m) => m.id === activeMemberId) ?? null
        : null;
    const guidanceForClient =
      activeSeat && isManagerRole(activeSeat.role) ? recentGuidance : [];

    return {
      available: true,
      planId,
      planName: SUBSCRIPTION_PLANS[planId].name,
      seatsUsed: members.length,
      seatLimit,
      extraSeats,
      members: members.map(toPublic),
      activeMemberId,
      seatLocked: Boolean(lockedMemberId),
      usage: {
        tokensUsed: Math.max(entitlements.tokensUsed, memberUsed),
        tokenLimit: entitlements.tokenLimit,
        tokensRemaining: entitlements.tokensRemaining,
        unallocatedTokens,
        overLimit: entitlements.overLimit,
        periodStart: entitlements.periodStart,
        periodEnd: entitlements.periodEnd,
      },
      seatPacks: SEAT_PACKS,
      recentGuidance: guidanceForClient,
      entitlements,
    };
  }

  async createMember(body: CreateFamilyMemberRequest): Promise<FamilyMemberPublic> {
    await this.requireManagerSeat();
    const account = await this.requireFamilyAccount();
    const entitlements = await this.accounts.buildEntitlements(account);
    const members = await this.ensureOwnerSeat(entitlements.tokenLimit ?? 0);
    const limit = await this.baseSeatLimit(account.planId);
    if (members.length >= limit) {
      throw new ValidationError(`Family seat limit reached (${limit}). Purchase more seats.`);
    }

    const displayName = body.displayName?.trim() ?? "";
    if (displayName.length < 1) {
      throw new ValidationError("Display name is required");
    }
    const role: FamilyMemberRole = body.role;
    if (role !== "parent" && role !== "partner" && role !== "child") {
      throw new ValidationError("Invalid family role");
    }
    let ageTier: FamilyAgeTier | null = body.ageTier ?? null;
    if (role === "child") {
      if (!ageTier || !["tier_6_9", "tier_10_13", "tier_14_17"].includes(ageTier)) {
        throw new ValidationError("Children need an age tier (6–9, 10–13, or 14–17)");
      }
    } else {
      ageTier = null;
    }

    const email = normalizeEmail(body.email);
    const password = assertPassword(body.password, role === "child");
    if (role === "child" && !email) {
      throw new ValidationError("Children need a login email so they can sign in");
    }
    if (email) {
      const taken = (await this.persistence.familyMembers.list()).some(
        (m) => m.email?.toLowerCase() === email,
      );
      if (taken) {
        throw new ValidationError("That email is already used by another family seat");
      }
    }
    const pool = entitlements.tokenLimit ?? 0;
    const allocated = members.reduce((sum, m) => sum + m.tokenAllowance, 0);
    const unallocated = Math.max(0, pool - allocated);
    const requested = Math.max(0, Math.floor(body.tokenAllowance ?? 0));
    const defaultShare = role === "child" ? Math.floor(pool * 0.15) : Math.floor(pool * 0.2);
    const tokenAllowance = Math.min(unallocated, requested > 0 ? requested : defaultShare);

    const now = this.clock.isoNow();
    const color =
      body.color?.trim() || MEMBER_COLORS[members.length % MEMBER_COLORS.length]!;

    const created: FamilyMemberRecord = {
      id: brandId<FamilyMemberId>(this.ids.next("fam")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      displayName,
      role,
      ageTier,
      color,
      pinHash: null,
      email,
      passwordHash: password ? hashPassword(password) : null,
      isOwner: false,
      isPaused: false,
      tokenAllowance,
      tokensUsed: 0,
      lastActiveAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.familyMembers.create(created);

    // Reduce owner allowance when carving out a share for a new member.
    const owner = members.find((m) => m.isOwner);
    if (owner && tokenAllowance > 0 && owner.tokenAllowance >= tokenAllowance) {
      await this.persistence.familyMembers.update({
        ...owner,
        tokenAllowance: owner.tokenAllowance - tokenAllowance,
        updatedAt: now,
      });
    }

    return toPublic(created);
  }

  async updateMember(id: string, body: UpdateFamilyMemberRequest): Promise<FamilyMemberPublic> {
    await this.requireManagerSeat();
    const existing = await this.persistence.familyMembers.getById(id);
    if (!existing) throw new NotFoundError("Family member not found");

    let role = body.role ?? existing.role;
    let ageTier = body.ageTier !== undefined ? body.ageTier : existing.ageTier;
    if (existing.isOwner) {
      role = "parent";
      if (body.role && body.role !== "parent") {
        throw new ValidationError("The household owner must remain a parent");
      }
    }
    if (role === "child") {
      if (!ageTier || !["tier_6_9", "tier_10_13", "tier_14_17"].includes(ageTier)) {
        throw new ValidationError("Children need an age tier");
      }
    } else {
      ageTier = null;
    }

    let pinHash = existing.pinHash;
    if (role === "child") {
      // Kids sign in with email/password — drop any legacy PIN.
      pinHash = null;
    } else if (body.pin !== undefined) {
      if (body.pin === "" || body.pin == null) {
        pinHash = null;
      } else {
        const pin = assertPinFormat(body.pin, false);
        pinHash = pin ? hashPin(pin) : null;
      }
    }

    let email = existing.email ?? null;
    if (body.email !== undefined) {
      email = normalizeEmail(body.email);
      if (role === "child" && !email) {
        throw new ValidationError("Children need a login email");
      }
      if (email) {
        const taken = (await this.persistence.familyMembers.list()).some(
          (m) => m.id !== existing.id && m.email?.toLowerCase() === email,
        );
        if (taken) {
          throw new ValidationError("That email is already used by another family seat");
        }
      }
    }

    let passwordHash = existing.passwordHash ?? null;
    if (body.password !== undefined) {
      if (body.password === "" || body.password == null) {
        if (role === "child") {
          throw new ValidationError("Children must keep a login password");
        }
        passwordHash = null;
      } else {
        const password = assertPassword(body.password, role === "child");
        passwordHash = password ? hashPassword(password) : null;
      }
    }
    if (role === "child" && !passwordHash) {
      throw new ValidationError("Children need a login password");
    }

    const updated: FamilyMemberRecord = {
      ...existing,
      displayName: body.displayName?.trim() || existing.displayName,
      role,
      ageTier,
      color: body.color?.trim() || existing.color,
      isPaused: body.isPaused ?? existing.isPaused,
      pinHash,
      email,
      passwordHash,
      tokenAllowance:
        body.tokenAllowance !== undefined
          ? Math.max(0, Math.floor(body.tokenAllowance))
          : existing.tokenAllowance,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.familyMembers.update(updated);
    return toPublic(updated);
  }

  /** Kid / partner seat login — issues the household account session and activates this seat. */
  async signInMember(body: FamilyMemberSignInRequest): Promise<FamilyMemberSignInResponse> {
    const email = normalizeEmail(body.email);
    if (!email) throw new ValidationError("Email is required");
    const password = body.password ?? "";
    if (!password) throw new UnauthorizedError("Invalid email or password");

    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) {
      throw new ForbiddenError("Family seat login requires an active Family plan on this studio");
    }

    const members = await this.persistence.familyMembers.list();
    const member = members.find((item) => item.email?.toLowerCase() === email) ?? null;
    if (!member || !verifyPassword(password, member.passwordHash)) {
      throw new UnauthorizedError("Invalid email or password");
    }
    if (member.isPaused) {
      throw new ForbiddenError("This family seat is paused by a parent");
    }

    const now = this.clock.isoNow();
    const sessionToken = randomBytes(32).toString("hex");
    await this.persistence.accounts.upsert({
      ...account,
      sessionTokenHash: hashSessionToken(sessionToken),
      connectedAt: now,
      updatedAt: now,
    });
    await this.persistence.familyMembers.update({
      ...member,
      lastActiveAt: now,
      updatedAt: now,
    });
    this.activeMemberByWorkspace.set(this.persistence.workspaceId, member.id);
    await this.persistence.familyHouseholdMeta.setActiveMemberId(member.id);
    // Member email/password login locks the session to this seat.
    await this.persistence.familyHouseholdMeta.setLockedMemberId(member.id);

    const entitlements = await this.accounts.buildEntitlements(
      await this.persistence.accounts.get(),
    );
    const publicAccount = {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      planId: account.planId,
      planName: SUBSCRIPTION_PLANS[account.planId].name,
      subscriptionStatus: account.subscriptionStatus,
      periodStart: account.periodStart,
      periodEnd: account.periodEnd,
      connectedAt: now,
    };

    return {
      sessionToken,
      member: toPublic({ ...member, lastActiveAt: now, updatedAt: now }),
      account: publicAccount,
      entitlements,
    };
  }

  async deleteMember(id: string): Promise<{ ok: true }> {
    await this.requireManagerSeat();
    const existing = await this.persistence.familyMembers.getById(id);
    if (!existing) throw new NotFoundError("Family member not found");
    if (existing.isOwner) {
      throw new ValidationError("Cannot remove the household owner");
    }
    const owner = (await this.persistence.familyMembers.list()).find((m) => m.isOwner);
    if (owner && existing.tokenAllowance > 0) {
      await this.persistence.familyMembers.update({
        ...owner,
        tokenAllowance: owner.tokenAllowance + existing.tokenAllowance,
        updatedAt: this.clock.isoNow(),
      });
    }
    await this.persistence.familyMembers.delete(id);
    if (this.activeMemberByWorkspace.get(this.persistence.workspaceId) === id) {
      const members = await this.persistence.familyMembers.list();
      const nextOwner = members.find((m) => m.isOwner);
      if (nextOwner) this.activeMemberByWorkspace.set(this.persistence.workspaceId, nextOwner.id);
      else this.activeMemberByWorkspace.delete(this.persistence.workspaceId);
    }
    return { ok: true };
  }

  async switchProfile(body: SwitchFamilyProfileRequest): Promise<SwitchFamilyProfileResponse> {
    await this.requireFamilyAccount();
    const member = await this.persistence.familyMembers.getById(body.memberId);
    if (!member) throw new NotFoundError("Family member not found");
    if (member.isPaused) {
      throw new ForbiddenError("This profile is paused by a parent");
    }

    const lockedId = await this.persistence.familyHouseholdMeta.getLockedMemberId();
    if (lockedId && lockedId !== member.id) {
      throw new ForbiddenError(
        "This seat is signed in with its own login and cannot switch to another profile",
      );
    }

    const now = this.clock.isoNow();
    const updated = {
      ...member,
      lastActiveAt: now,
      updatedAt: now,
    };
    await this.persistence.familyMembers.update(updated);
    this.activeMemberByWorkspace.set(this.persistence.workspaceId, member.id);
    await this.persistence.familyHouseholdMeta.setActiveMemberId(member.id);
    return { member: toPublic(updated), switchedAt: now };
  }

  async grantTokens(body: GrantFamilyTokensRequest): Promise<FamilyHouseholdSnapshot> {
    await this.requireManagerSeat();
    const amount = Math.floor(body.tokens);
    if (!Number.isFinite(amount) || amount === 0) {
      throw new ValidationError("Token amount must be a non-zero integer");
    }
    const target = await this.persistence.familyMembers.getById(body.memberId);
    if (!target) throw new NotFoundError("Family member not found");

    const now = this.clock.isoNow();
    if (body.fromMemberId) {
      const source = await this.persistence.familyMembers.getById(body.fromMemberId);
      if (!source) throw new NotFoundError("Source member not found");
      const move = Math.abs(amount);
      if (source.tokenAllowance - source.tokensUsed < move) {
        throw new ValidationError("Source member does not have enough unspent tokens");
      }
      await this.persistence.familyMembers.update({
        ...source,
        tokenAllowance: source.tokenAllowance - move,
        updatedAt: now,
      });
      await this.persistence.familyMembers.update({
        ...target,
        tokenAllowance: target.tokenAllowance + move,
        updatedAt: now,
      });
    } else {
      const snap = await this.snapshot();
      const unallocated = snap.usage?.unallocatedTokens ?? 0;
      if (amount > 0 && amount > unallocated) {
        throw new ValidationError("Not enough unallocated household tokens");
      }
      if (amount < 0 && target.tokenAllowance + amount < target.tokensUsed) {
        throw new ValidationError("Cannot reduce allowance below tokens already used");
      }
      await this.persistence.familyMembers.update({
        ...target,
        tokenAllowance: Math.max(0, target.tokenAllowance + amount),
        updatedAt: now,
      });
    }
    return this.snapshot();
  }

  async purchaseSeats(body: PurchaseFamilySeatsRequest): Promise<FamilyHouseholdSnapshot> {
    await this.requireManagerSeat();
    let seats: 1 | 2 | 5 = body.seats;
    const code = body.code?.trim().toUpperCase() ?? "";
    if (code) {
      const fromCode = SEAT_CODES[code];
      if (!fromCode) throw new ValidationError("Invalid seat pack code");
      seats = fromCode;
    } else if (![1, 2, 5].includes(seats)) {
      throw new ValidationError("Choose a seat pack of 1, 2, or 5");
    }
    const current = await this.persistence.familyHouseholdMeta.getExtraSeats();
    await this.persistence.familyHouseholdMeta.setExtraSeats(current + seats);
    return this.snapshot();
  }

  async addGuidance(body: CreateFamilyGuidanceRequest): Promise<FamilyGuidancePublic> {
    const author = await this.requireManagerSeat();
    const content = body.content?.trim() ?? "";
    if (content.length < 3) {
      throw new ValidationError("Guidance must be at least a few words");
    }
    if (!body.companionId?.trim()) {
      throw new ValidationError("Companion is required");
    }
    const child = await this.persistence.familyMembers.getById(body.childMemberId);
    if (!child || child.role !== "child") {
      throw new ValidationError("Guidance targets a child profile");
    }

    const note: FamilyGuidanceRecord = {
      id: this.ids.next("fg"),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      companionId: body.companionId.trim(),
      childMemberId: child.id,
      authorMemberId: author.id,
      authorName: author.displayName,
      content: content.slice(0, 4000),
      createdAt: this.clock.isoNow(),
    };
    await this.persistence.familyGuidance.create(note);
    return toGuidancePublic(note);
  }

  async guidanceForCompanion(companionId: string): Promise<FamilyGuidancePublic[]> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) return [];
    const seatId = await this.getActiveMemberId();
    if (seatId) {
      const seat = await this.persistence.familyMembers.getById(seatId);
      if (seat && !isManagerRole(seat.role)) {
        // Children never receive parent coaching notes via API.
        return [];
      }
    }
    return (await this.persistence.familyGuidance.listByCompanion(companionId)).map(
      toGuidancePublic,
    );
  }

  /** Attribute token spend to the active family member (best-effort). */
  async recordUsage(tokens: number, _memberIdHint?: string | null): Promise<void> {
    if (tokens <= 0) return;
    // Ignore client seat hints — only the locked/active server seat is billed.
    const activeId =
      this.activeMemberByWorkspace.get(this.persistence.workspaceId) ||
      (await this.persistence.familyHouseholdMeta.getActiveMemberId()) ||
      (await this.persistence.familyHouseholdMeta.getLockedMemberId());
    if (!activeId) return;
    const member = await this.persistence.familyMembers.getById(activeId);
    if (!member) return;
    await this.persistence.familyMembers.update({
      ...member,
      tokensUsed: member.tokensUsed + tokens,
      lastActiveAt: this.clock.isoNow(),
      updatedAt: this.clock.isoNow(),
    });
  }

  async setActiveMember(memberId: string | null): Promise<void> {
    const lockedId = await this.persistence.familyHouseholdMeta.getLockedMemberId();
    if (lockedId) {
      // Locked seat sessions ignore spoofed family-member headers.
      this.activeMemberByWorkspace.set(this.persistence.workspaceId, lockedId);
      await this.persistence.familyHouseholdMeta.setActiveMemberId(lockedId);
      return;
    }
    if (!memberId) {
      this.activeMemberByWorkspace.delete(this.persistence.workspaceId);
      await this.persistence.familyHouseholdMeta.setActiveMemberId(null);
      return;
    }
    const member = await this.persistence.familyMembers.getById(memberId);
    if (!member) return;
    this.activeMemberByWorkspace.set(this.persistence.workspaceId, member.id);
    await this.persistence.familyHouseholdMeta.setActiveMemberId(member.id);
  }

  /** Clear seat lock after parent/account credentials sign-in or sign-out. */
  async clearSeatLock(): Promise<void> {
    await this.persistence.familyHouseholdMeta.setLockedMemberId(null);
  }

  /** Active family seat for the current workspace request (null outside family / unset). */
  async getActiveMemberId(): Promise<string | null> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) return null;
    const lockedId = await this.persistence.familyHouseholdMeta.getLockedMemberId();
    if (lockedId) return lockedId;
    return (
      this.activeMemberByWorkspace.get(this.persistence.workspaceId) ||
      (await this.persistence.familyHouseholdMeta.getActiveMemberId())
    );
  }

  /**
   * Family seat conversation visibility: active seat only.
   * Legacy unstamped chats stay visible to managers; children never see them.
   */
  async filterConversations<T extends { familyMemberId?: string | null }>(
    conversations: T[],
  ): Promise<T[]> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) return conversations;
    const seatId = await this.getActiveMemberId();
    if (!seatId) return conversations;
    const member = await this.persistence.familyMembers.getById(seatId);
    const isManager = Boolean(member && (member.isOwner || member.role !== "child"));
    return conversations.filter((item) => {
      const owner = item.familyMemberId ?? null;
      if (owner === seatId) return true;
      if (!owner) return isManager;
      return false;
    });
  }

  async assertCanOpenConversation(conversation: {
    familyMemberId?: string | null;
  }): Promise<void> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) return;
    const seatId = await this.getActiveMemberId();
    if (!seatId) return;
    const owner = conversation.familyMemberId ?? null;
    if (owner === seatId) return;
    const member = await this.persistence.familyMembers.getById(seatId);
    const isManager = Boolean(member && (member.isOwner || member.role !== "child"));
    if (!owner && isManager) return;
    throw new ForbiddenError("This conversation belongs to another family seat");
  }

  async isFamilyPlanActive(): Promise<boolean> {
    const account = await this.persistence.accounts.get();
    return Boolean(account && isFamilyPlanId(account.planId));
  }

  /** Block paused profiles and over-allowance kids from chatting. */
  async assertCanChat(_memberIdHint?: string | null): Promise<void> {
    const account = await this.persistence.accounts.get();
    if (!account || !isFamilyPlanId(account.planId)) return;
    const activeId = await this.getActiveMemberId();
    if (!activeId) return;
    const member = await this.persistence.familyMembers.getById(activeId);
    if (!member) return;
    if (member.isPaused) {
      throw new ForbiddenError("This family profile is paused by a parent");
    }
    // Family Free trial: seats and chat stay open; token budgets are soft until finalized.
    if (account.planId === "family_free") return;
    if (member.tokenAllowance > 0 && member.tokensUsed >= member.tokenAllowance) {
      throw new ForbiddenError(
        "This profile’s token allowance is used up. Ask a parent to assign more.",
      );
    }
  }

  /** True when the active seat is a child (least-privilege). */
  async isActiveChildSeat(): Promise<boolean> {
    const seatId = await this.getActiveMemberId();
    if (!seatId) return false;
    const member = await this.persistence.familyMembers.getById(seatId);
    return Boolean(member && member.role === "child");
  }
}
