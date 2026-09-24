import type { FamilyMemberId, WorkspaceId } from "./ids.js";
import type { AccountEntitlements, AccountPublic } from "./account.js";
import type { Timestamps } from "./entities.js";

export type FamilyMemberRole = "parent" | "partner" | "child";
export type FamilyAgeTier = "tier_6_9" | "tier_10_13" | "tier_14_17";

export interface FamilyMemberRecord extends Timestamps {
  id: FamilyMemberId;
  workspaceId: WorkspaceId;
  displayName: string;
  role: FamilyMemberRole;
  /** Required when role is child. */
  ageTier: FamilyAgeTier | null;
  /** Calendar / UI accent (hex). */
  color: string;
  /** scrypt hash of 4–8 digit PIN — never returned to clients. */
  pinHash: string | null;
  /** Login email for this seat (kids / partners). Lowercased. */
  email: string | null;
  /** Password hash for seat login — never returned to clients. */
  passwordHash: string | null;
  /** Owner is the connected studio account holder (always a parent). */
  isOwner: boolean;
  /** Instant parental lock — blocks chat for this member. */
  isPaused: boolean;
  /** Tokens reserved for this member from the household pool. */
  tokenAllowance: number;
  /** Tokens consumed by this member in the current billing period. */
  tokensUsed: number;
  lastActiveAt: string | null;
}

export interface FamilyMemberPublic {
  id: FamilyMemberId;
  workspaceId: WorkspaceId;
  displayName: string;
  role: FamilyMemberRole;
  ageTier: FamilyAgeTier | null;
  color: string;
  hasPin: boolean;
  /** Seat login email when credentials are set. */
  email: string | null;
  hasPassword: boolean;
  isOwner: boolean;
  isPaused: boolean;
  /** Parents and partners can manage the household. */
  isManager: boolean;
  tokenAllowance: number;
  tokensUsed: number;
  tokensRemaining: number;
  usagePercent: number;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFamilyMemberRequest {
  displayName: string;
  role: FamilyMemberRole;
  ageTier?: FamilyAgeTier | null;
  color?: string;
  /** 4–8 digit PIN — unused for kids (email/password login). Optional legacy for adults. */
  pin?: string | null;
  /** Seat login email. Required for children so they can sign in. */
  email?: string | null;
  /** Seat login password. Required for children (min 8 chars). */
  password?: string | null;
  /** Optional starting token allowance from the household pool. */
  tokenAllowance?: number;
}

export interface UpdateFamilyMemberRequest {
  displayName?: string;
  role?: FamilyMemberRole;
  ageTier?: FamilyAgeTier | null;
  color?: string;
  isPaused?: boolean;
  /** Set a new PIN; empty string clears it (adults only). */
  pin?: string | null;
  /** Update or set seat login email. */
  email?: string | null;
  /** Set a new seat login password (min 8 chars). */
  password?: string | null;
  tokenAllowance?: number;
}

export interface FamilyMemberSignInRequest {
  email: string;
  password: string;
}

export interface FamilyMemberSignInResponse {
  sessionToken: string;
  member: FamilyMemberPublic;
  account: AccountPublic;
  entitlements: AccountEntitlements;
}

export interface SwitchFamilyProfileRequest {
  memberId: string;
  pin?: string | null;
}

export interface SwitchFamilyProfileResponse {
  member: FamilyMemberPublic;
  switchedAt: string;
}

export interface GrantFamilyTokensRequest {
  memberId: string;
  /** Positive = give from household unallocated pool; may also move from another member. */
  tokens: number;
  fromMemberId?: string | null;
}

export interface PurchaseFamilySeatsRequest {
  /** Seat pack size: 1, 2, or 5. */
  seats: 1 | 2 | 5;
  /** Redeem / promo code stub (e.g. FAMILY-SEAT). */
  code?: string | null;
}

export interface FamilySeatPack {
  seats: 1 | 2 | 5;
  label: string;
  priceHalalas: number;
}

/** Parent → child companion private coaching note. */
export interface FamilyGuidanceRecord {
  id: string;
  workspaceId: WorkspaceId;
  companionId: string;
  childMemberId: FamilyMemberId;
  authorMemberId: FamilyMemberId;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface FamilyGuidancePublic {
  id: string;
  companionId: string;
  childMemberId: FamilyMemberId;
  authorMemberId: FamilyMemberId;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface CreateFamilyGuidanceRequest {
  companionId: string;
  childMemberId: string;
  authorMemberId: string;
  content: string;
}

export interface FamilyHouseholdSnapshot {
  available: boolean;
  planId: "family_free" | "family" | "family_plus" | null;
  planName: string | null;
  seatsUsed: number;
  seatLimit: number;
  extraSeats: number;
  members: FamilyMemberPublic[];
  /** Active profile on this device (server-tracked last switch). */
  activeMemberId: FamilyMemberId | null;
  /**
   * True when a seat signed in with its own email/password (typically a child).
   * Locked sessions cannot switch to another household profile.
   */
  seatLocked: boolean;
  usage: {
    tokensUsed: number;
    tokenLimit: number | null;
    tokensRemaining: number | null;
    unallocatedTokens: number;
    overLimit: boolean;
    periodStart: string;
    periodEnd: string;
  } | null;
  seatPacks: FamilySeatPack[];
  recentGuidance: FamilyGuidancePublic[];
  entitlements: AccountEntitlements | null;
}
