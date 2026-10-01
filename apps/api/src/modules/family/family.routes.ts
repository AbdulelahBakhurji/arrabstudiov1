import type { CreateFamilyMemberRequest, UpdateFamilyMemberRequest, FamilyMemberSignInRequest, SwitchFamilyProfileRequest, GrantFamilyTokensRequest, PurchaseFamilySeatsRequest, CreateFamilyGuidanceRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerFamilyRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.get("/v1/family", async () => deps.familyHousehold.snapshot());

  app.post<{ Body: FamilyMemberSignInRequest }>("/v1/family/members/sign-in", async (request) =>
    deps.familyHousehold.signInMember(
      request.body ?? { email: "", password: "" },
    ),
  );

  app.post<{ Body: CreateFamilyMemberRequest }>("/v1/family/members", async (request) =>
    deps.familyHousehold.createMember(
      request.body ?? { displayName: "", role: "partner" },
    ),
  );

  app.patch<{ Params: { id: string }; Body: UpdateFamilyMemberRequest }>(
    "/v1/family/members/:id",
    async (request) =>
      deps.familyHousehold.updateMember(request.params.id, request.body ?? {}),
  );

  app.delete<{ Params: { id: string } }>("/v1/family/members/:id", async (request) =>
    deps.familyHousehold.deleteMember(request.params.id),
  );

  app.post<{ Body: SwitchFamilyProfileRequest }>("/v1/family/switch", async (request) =>
    deps.familyHousehold.switchProfile(
      request.body ?? { memberId: "" },
    ),
  );

  app.post<{ Body: GrantFamilyTokensRequest }>("/v1/family/tokens/grant", async (request) =>
    deps.familyHousehold.grantTokens(
      request.body ?? { memberId: "", tokens: 0 },
    ),
  );

  app.post<{ Body: PurchaseFamilySeatsRequest }>("/v1/family/seats/purchase", async (request) =>
    deps.familyHousehold.purchaseSeats(
      request.body ?? { seats: 1 },
    ),
  );

  app.post<{ Body: CreateFamilyGuidanceRequest }>("/v1/family/guidance", async (request) =>
    deps.familyHousehold.addGuidance(
      request.body ?? {
        companionId: "",
        childMemberId: "",
        authorMemberId: "",
        content: "",
      },
    ),
  );

  app.get<{ Querystring: { companionId?: string } }>(
    "/v1/family/guidance",
    async (request) => {
      const companionId = request.query.companionId?.trim() ?? "";
      if (!companionId) return { items: [] as const };
      return { items: await deps.familyHousehold.guidanceForCompanion(companionId) };
    },
  );
}
