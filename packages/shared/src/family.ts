import type { FamilyMemberId, WorkspaceId } from "./ids.js";
import type { AccountEntitlements } from "./account.js";
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
  /** 4–8 digit PIN for profile switching. Required for child; optional for adults. */
  pin?: string | null;
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
  tokenAllowance?: number;
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
