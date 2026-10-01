import { UnauthorizedError } from "@arrab/core";
import type { AddTeamMemberRequest, CreateAgentRequest, CreateTeamRequest, AddCrewPassRequest, AddCrewWatchRequest, SetCrewFocusRequest, SetCrewRuleRequest, UpdateCrewMemberRequest, UpdateAgentRequest, UpdateTeamRequest, CreateOrgDepartmentRequest, CreateOrgEmployeeRequest, UpdateOrgDepartmentRequest, UpdateOrgEmployeeRequest, OrgEmployeeSignInRequest, OrgEmployeeChangePasswordRequest, WorkforceBlueprintRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { RouteHelpers, V1Deps } from "../../http/deps.js";

export function registerOrganizationRoutes(app: FastifyInstance, deps: V1Deps, { assertCap, clientIp }: RouteHelpers): void {
  app.get("/v1/crew", async () => deps.crew.get());

  app.post<{ Body: SetCrewRuleRequest }>("/v1/crew/rules", async (request) =>
    deps.crew.setRule(request.body ?? { action: "research", level: "allow" }),
  );

  app.post<{ Params: { id: string }; Body: UpdateCrewMemberRequest }>(
    "/v1/crew/members/:id",
    async (request) => deps.crew.updateMember(request.params.id, request.body ?? {}),
  );

  app.post<{ Body: AddCrewWatchRequest }>("/v1/crew/watches", async (request) =>
    deps.crew.addWatch(request.body ?? { memberId: "", title: "", hour: -1 }),
  );

  app.post<{ Params: { id: string }; Body: { paused?: boolean } }>(
    "/v1/crew/watches/:id/pause",
    async (request) => deps.crew.pauseWatch(request.params.id, request.body?.paused !== false),
  );

  app.post<{ Params: { id: string } }>("/v1/crew/watches/:id/remove", async (request) =>
    deps.crew.removeWatch(request.params.id),
  );

  app.post<{ Params: { id: string } }>("/v1/crew/watches/:id/write", async (request) =>
    deps.crew.writeWatch(request.params.id),
  );

  app.post<{ Body: AddCrewPassRequest }>("/v1/crew/passes", async (request) =>
    deps.crew.pass(request.body ?? { fromId: "", toId: "", title: "" }),
  );

  app.post<{ Params: { id: string } }>("/v1/crew/passes/:id/close", async (request) =>
    deps.crew.closePass(request.params.id),
  );

  app.post("/v1/crew/briefing", async () => deps.crew.briefing());

  app.post<{ Body: SetCrewFocusRequest }>("/v1/crew/focus", async (request) =>
    deps.crew.setFocus(request.body ?? { title: "" }),
  );

  app.post<{ Params: { id: string } }>("/v1/crew/packs/:id", async (request) =>
    deps.crew.installPack(request.params.id),
  );

  app.post("/v1/crew/refit", async () => deps.crew.refit());


  app.post<{ Body: OrgEmployeeSignInRequest }>("/v1/org/employees/sign-in", async (request) =>
    deps.orgWorkforce.signIn(request.body ?? { email: "", password: "" }, clientIp(request)),
  );

  app.post("/v1/org/employees/sign-out", async (request) => {
    if (!request.orgEmployee) return { ok: true as const };
    await deps.connectors.signOutCurrentUser();
    return deps.orgWorkforce.signOut(request.orgEmployee);
  });

  app.post<{ Body: OrgEmployeeChangePasswordRequest }>(
    "/v1/org/employees/change-password",
    async (request) => {
      if (!request.orgEmployee) {
        throw new UnauthorizedError("Employee session required");
      }
      return deps.orgWorkforce.changePassword(
        request.orgEmployee,
        request.body ?? { currentPassword: "", newPassword: "" },
      );
    },
  );

  app.get("/v1/org/departments", async () => ({
    items: await deps.orgWorkforce.listDepartments(),
  }));

  app.post<{ Body: CreateOrgDepartmentRequest }>("/v1/org/departments", async (request) =>
    deps.orgWorkforce.createDepartment(request.body ?? { name: "" }, request.orgEmployee),
  );

  app.patch<{ Params: { id: string }; Body: UpdateOrgDepartmentRequest }>(
    "/v1/org/departments/:id",
    async (request) =>
      deps.orgWorkforce.updateDepartment(
        request.params.id,
        request.body ?? {},
        request.orgEmployee,
      ),
  );

  app.delete<{ Params: { id: string } }>("/v1/org/departments/:id", async (request) =>
    deps.orgWorkforce.deleteDepartment(request.params.id, request.orgEmployee),
  );

  app.get("/v1/org/employees", async (request) => ({
    items: await deps.orgWorkforce.listEmployees(request.orgEmployee),
  }));

  app.post<{ Body: CreateOrgEmployeeRequest }>("/v1/org/employees", async (request) =>
    deps.orgWorkforce.createEmployee(
      request.body ?? { email: "", password: "", displayName: "" },
      request.orgEmployee,
    ),
  );

  app.patch<{ Params: { id: string }; Body: UpdateOrgEmployeeRequest }>(
    "/v1/org/employees/:id",
    async (request) =>
      deps.orgWorkforce.updateEmployee(
        request.params.id,
        request.body ?? {},
        request.orgEmployee,
      ),
  );

  app.delete<{ Params: { id: string } }>("/v1/org/employees/:id", async (request) =>
    deps.orgWorkforce.deleteEmployee(request.params.id, request.orgEmployee),
  );


  app.get("/v1/agents", async (request) => ({
    items: await deps.orgWorkforce.filterAgents(
      await deps.queries.listAgents(),
      request.orgEmployee,
    ),
  }));

  app.post<{ Body: CreateAgentRequest }>("/v1/agents", async (request) => {
    await assertCap(request, "canHireAgents", "Only admins can hire AI employees");
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.commands.createAgent(request.body ?? { name: "", role: "" });
  });

  app.patch<{ Params: { id: string }; Body: UpdateAgentRequest }>(
    "/v1/agents/:id",
    async (request) => {
      await assertCap(request, "canHireAgents", "Only admins can update AI employees");
      return deps.commands.updateAgent(request.params.id, request.body ?? {});
    },
  );

  app.delete<{ Params: { id: string } }>("/v1/agents/:id", async (request) => {
    await assertCap(request, "canHireAgents", "Only admins can delete AI employees");
    return deps.commands.deleteAgent(request.params.id);
  });

  // POST fallbacks — some clients/CORS policies only allow GET/HEAD/POST.
  app.post<{ Params: { id: string } }>("/v1/agents/:id/archive", async (request) => {
    await assertCap(request, "canHireAgents", "Only admins can archive AI employees");
    return deps.commands.updateAgent(request.params.id, { status: "archived" });
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/remove", async (request) => {
    await assertCap(request, "canHireAgents", "Only admins can delete AI employees");
    return deps.commands.deleteAgent(request.params.id);
  });

  app.get<{ Params: { agentId: string } }>(
    "/v1/agents/:agentId/conversations",
    async (request) => {
      const items = await deps.conversations.listByAgent(request.params.agentId);
      return {
        items: await deps.orgWorkforce.filterConversations(items, request.orgEmployee),
      };
    },
  );

  app.get<{ Params: { agentId: string } }>("/v1/agents/:agentId/goals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.goals.listActiveByAgent(request.params.agentId) };
  });


  app.get("/v1/teams", async () => ({ items: await deps.queries.listTeams() }));

  app.post<{ Body: CreateTeamRequest }>("/v1/teams", async (request) => {
    await assertCap(request, "canManageTeams", "Only admins can create teams");
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.commands.createTeam(request.body ?? { name: "" });
  });

  app.patch<{ Params: { id: string }; Body: UpdateTeamRequest }>(
    "/v1/teams/:id",
    async (request) => {
      await assertCap(request, "canManageTeams", "Only admins can update teams");
      return deps.commands.updateTeam(request.params.id, request.body ?? {});
    },
  );

  app.get<{ Params: { id: string } }>("/v1/teams/:id/members", async (request) => ({
    items: await deps.queries.listMembershipsByTeam(request.params.id),
  }));

  app.post<{ Params: { id: string }; Body: AddTeamMemberRequest }>(
    "/v1/teams/:id/members",
    async (request) => {
      await assertCap(request, "canManageTeams", "Only admins can change team membership");
      return deps.commands.addTeamMember(request.params.id, request.body ?? { agentId: "" });
    },
  );

  app.delete<{ Params: { id: string; agentId: string } }>(
    "/v1/teams/:id/members/:agentId",
    async (request) => {
      await assertCap(request, "canManageTeams", "Only admins can change team membership");
      return deps.commands.removeTeamMember(request.params.id, request.params.agentId);
    },
  );

  app.post<{ Body: WorkforceBlueprintRequest }>("/v1/workforce/blueprint", async (request) => {
    await assertCap(request, "canManageTeams", "Only admins can set up the organization");
    return deps.workforceBlueprint.draft(request.body ?? { industry: "" });
  });

  app.get("/v1/memberships", async () => ({ items: await deps.queries.listMemberships() }));
}
