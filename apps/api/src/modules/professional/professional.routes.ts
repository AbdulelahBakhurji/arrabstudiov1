import type {
  AppendActivityRequest,
  RecordProfessionalActionRequest,
  SetCompanionStatusRequest,
  SetSkillGrantRequest,
  TakeControlRequest,
  UpsertBoundaryRequest,
  UpsertMcpPluginRequest,
  UpsertReachabilityRequest,
  UpsertResponsibilityRequest,
} from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerProfessionalRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.get("/v1/professional", async () => deps.professional.get());

  app.post<{ Body: UpsertBoundaryRequest }>("/v1/professional/boundaries", async (request) =>
    deps.professional.upsertBoundary(request.body ?? { label: "" }),
  );

  app.post<{ Params: { id: string } }>("/v1/professional/boundaries/:id/remove", async (request) =>
    deps.professional.removeBoundary(request.params.id),
  );

  app.post<{ Body: RecordProfessionalActionRequest }>("/v1/professional/actions", async (request) =>
    deps.professional.recordAction(
      request.body ?? { tool: "computer", action: "" },
    ),
  );

  app.post<{ Body: AppendActivityRequest }>("/v1/professional/activity", async (request) =>
    deps.professional.appendActivity(
      request.body ?? { companionId: "", kind: "command", title: "" },
    ),
  );

  app.post<{ Body: TakeControlRequest }>("/v1/professional/control", async (request) =>
    deps.professional.takeControl(request.body ?? { companionId: "", taken: false }),
  );

  app.post<{ Body: UpsertResponsibilityRequest }>(
    "/v1/professional/responsibilities",
    async (request) => deps.professional.upsertResponsibility(request.body ?? { title: "" }),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/professional/responsibilities/:id/remove",
    async (request) => deps.professional.removeResponsibility(request.params.id),
  );

  app.post<{ Body: SetSkillGrantRequest }>("/v1/professional/skill-grants", async (request) =>
    deps.professional.setSkillGrant(
      request.body ?? { skillId: "", companionId: "", enabled: false },
    ),
  );

  app.post<{ Body: UpsertReachabilityRequest }>(
    "/v1/professional/reachability",
    async (request) =>
      deps.professional.upsertReachability(
        request.body ?? { channel: "slack", target: "" },
      ),
  );

  app.post<{ Params: { id: string } }>(
    "/v1/professional/reachability/:id/remove",
    async (request) => deps.professional.removeReachability(request.params.id),
  );

  app.post<{ Body: UpsertMcpPluginRequest }>("/v1/professional/plugins", async (request) =>
    deps.professional.upsertPlugin(request.body ?? { key: "", name: "" }),
  );

  app.post<{ Body: SetCompanionStatusRequest }>("/v1/professional/status", async (request) =>
    deps.professional.setCompanionStatus(request.body ?? { companionId: "" }),
  );

  app.post<{ Body: import("@arrab/shared").UpsertMuseIdeaRequest }>(
    "/v1/professional/ideas",
    async (request) => deps.professional.upsertIdea(request.body ?? { title: "" }),
  );

  app.post<{ Body: import("@arrab/shared").UpsertMuseWatchRequest }>(
    "/v1/professional/watches",
    async (request) => deps.professional.upsertWatch(request.body ?? { url: "" }),
  );

  app.post<{ Body: import("@arrab/shared").ObserveMuseWatchRequest }>(
    "/v1/professional/watches/observe",
    async (request) =>
      deps.professional.observeWatch(request.body ?? { id: "", observation: "" }),
  );

  app.post<{ Body: import("@arrab/shared").ImportMuseFinanceRequest }>(
    "/v1/professional/finance/import",
    async (request) => deps.professional.importFinance(request.body ?? { csv: "" }),
  );

  app.post<{ Body: import("@arrab/shared").UpsertMuseGoalRequest }>(
    "/v1/professional/goals",
    async (request) => deps.professional.upsertGoal(request.body ?? { title: "" }),
  );

  app.post<{ Body: import("@arrab/shared").SetProfessionalStayRequest }>(
    "/v1/professional/stay",
    async (request) => deps.professional.setStay(request.body ?? { enabled: true }),
  );
}
