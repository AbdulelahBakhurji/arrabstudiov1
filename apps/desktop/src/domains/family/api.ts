import type { FamilyHouseholdSnapshot, FamilyMemberPublic, FamilyGuidancePublic, CreateFamilyMemberRequest, UpdateFamilyMemberRequest, FamilyMemberSignInRequest, FamilyMemberSignInResponse, SwitchFamilyProfileRequest, SwitchFamilyProfileResponse, GrantFamilyTokensRequest, PurchaseFamilySeatsRequest, CreateFamilyGuidanceRequest, UpdateFamilyGuardianRequest, AcknowledgeFamilySafetyRequest } from "@arrab/shared";
import { request } from "@/core/api/http";


export const familyApi = {

  familyHousehold: () => request<FamilyHouseholdSnapshot>("/v1/family"),
  createFamilyMember: (body: CreateFamilyMemberRequest) =>
    request<FamilyMemberPublic>("/v1/family/members", { method: "POST", body }),
  updateFamilyMember: (id: string, body: UpdateFamilyMemberRequest) =>
    request<FamilyMemberPublic>(`/v1/family/members/${id}`, { method: "PATCH", body }),
  deleteFamilyMember: (id: string) =>
    request<{ ok: true }>(`/v1/family/members/${id}`, { method: "DELETE" }),
  familyMemberSignIn: (body: FamilyMemberSignInRequest) =>
    request<FamilyMemberSignInResponse>("/v1/family/members/sign-in", {
      method: "POST",
      body,
    }),
  updateFamilyGuardian: (id: string, body: UpdateFamilyGuardianRequest) =>
    request<FamilyMemberPublic>(`/v1/family/members/${id}/guardian`, { method: "PATCH", body }),
  acknowledgeFamilySafety: (body: AcknowledgeFamilySafetyRequest = {}) =>
    request<FamilyHouseholdSnapshot>("/v1/family/safety/acknowledge", { method: "POST", body }),
  switchFamilyProfile: (body: SwitchFamilyProfileRequest) =>
    request<SwitchFamilyProfileResponse>("/v1/family/switch", { method: "POST", body }),
  grantFamilyTokens: (body: GrantFamilyTokensRequest) =>
    request<FamilyHouseholdSnapshot>("/v1/family/tokens/grant", { method: "POST", body }),
  purchaseFamilySeats: (body: PurchaseFamilySeatsRequest) =>
    request<FamilyHouseholdSnapshot>("/v1/family/seats/purchase", { method: "POST", body }),
  addFamilyGuidance: (body: CreateFamilyGuidanceRequest) =>
    request<FamilyGuidancePublic>("/v1/family/guidance", { method: "POST", body }),
  familyGuidanceForCompanion: (companionId: string) =>
    request<{ items: FamilyGuidancePublic[] }>(
      `/v1/family/guidance?companionId=${encodeURIComponent(companionId)}`,
    ),
};
