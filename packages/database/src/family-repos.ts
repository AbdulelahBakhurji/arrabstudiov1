import type { FamilyGuidanceRecord, FamilyMemberRecord } from "@arrab/shared";

export interface FamilyMemberRepository {
  list(): Promise<FamilyMemberRecord[]>;
  getById(id: string): Promise<FamilyMemberRecord | null>;
  create(entity: FamilyMemberRecord): Promise<FamilyMemberRecord>;
  update(entity: FamilyMemberRecord): Promise<FamilyMemberRecord>;
  delete(id: string): Promise<void>;
}

export interface FamilyGuidanceRepository {
  listRecent(limit?: number): Promise<FamilyGuidanceRecord[]>;
  listByCompanion(companionId: string): Promise<FamilyGuidanceRecord[]>;
  create(entity: FamilyGuidanceRecord): Promise<FamilyGuidanceRecord>;
  delete(id: string): Promise<void>;
}

export interface FamilyHouseholdMetaRepository {
  getExtraSeats(): Promise<number>;
  setExtraSeats(seats: number): Promise<number>;
  getActiveMemberId(): Promise<string | null>;
  setActiveMemberId(id: string | null): Promise<void>;
}
