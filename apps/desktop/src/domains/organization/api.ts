import type { AddTeamMemberRequest, Agent, CollectionResponse, CreateAgentRequest, CreateTeamRequest, CrewAction, CrewRuleLevel, CrewView, Team, TeamMembership, UpdateAgentRequest, UpdateTeamRequest, WorkforceBlueprint, WorkforceBlueprintRequest } from "@arrab/shared";
import { hydrateWorkforceBlueprint, templateWorkforceBlueprint } from "@arrab/shared";
import { localCrew, crewRemoteMissing, markCrewRemoteMissing } from "@/domains/organization/crew-local";
import { ApiRequestError, request } from "@/core/api/http";

function crewRequest(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<CrewView> {
  if (crewRemoteMissing()) return Promise.resolve(localCrew.get());
  return request<CrewView>(path, init).catch((err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 404) {
      markCrewRemoteMissing();
      return localCrew.get();
    }
    throw err;
  });
}

function crewAct(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } | undefined, local: () => CrewView): Promise<CrewView> {
  if (crewRemoteMissing()) return Promise.resolve(local());
  return request<CrewView>(path, init).catch((err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 404) {
      markCrewRemoteMissing();
      return local();
    }
    throw err;
  });
}

function readOrgEmployeeSessionToken(): string | null {
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionToken?: string };
    return parsed.sessionToken ?? null;
  } catch {
    return null;
  }
}

function readOrgEmployeePublic(): import("@arrab/shared").OrgEmployeePublic | null {
  try {
    const raw = localStorage.getItem("arrab.org.employee.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { employee?: import("@arrab/shared").OrgEmployeePublic };
    return parsed.employee ?? null;
  } catch {
    return null;
  }
}

export const organizationApi = {

  agents: () => request<CollectionResponse<Agent>>("/v1/agents"),
  createAgent: (body: CreateAgentRequest, signal?: AbortSignal) =>
    request<Agent>("/v1/agents", { method: "POST", body, signal }),
  updateAgent: (id: string, body: UpdateAgentRequest, signal?: AbortSignal) =>
    request<Agent>(`/v1/agents/${id}`, { method: "PATCH", body, signal }),
  deleteAgent: (id: string) => request<{ ok: true }>(`/v1/agents/${id}`, { method: "DELETE" }),
  /** POST archive — works when CORS only allows GET/HEAD/POST. */
  archiveAgent: (id: string) =>
    request<Agent>(`/v1/agents/${id}/archive`, { method: "POST", body: {} }),
  /** POST remove — hard delete with chats retained; CORS-safe. */
  removeAgent: (id: string) =>
    request<{ ok: true }>(`/v1/agents/${id}/remove`, { method: "POST", body: {} }),
  teams: () => request<CollectionResponse<Team>>("/v1/teams"),
  createTeam: (body: CreateTeamRequest) => request<Team>("/v1/teams", { method: "POST", body }),
  updateTeam: (id: string, body: UpdateTeamRequest) =>
    request<Team>(`/v1/teams/${id}`, { method: "PATCH", body }),
  crew: () => crewRequest("/v1/crew"),
  setCrewRule: (action: CrewAction, level: CrewRuleLevel) =>
    crewAct("/v1/crew/rules", { method: "POST", body: { action, level } }, () => localCrew.setRule(action, level)),
  updateCrewMember: (id: string, body: { paused?: boolean; customDuty?: string }) =>
    crewAct(`/v1/crew/members/${encodeURIComponent(id)}`, { method: "POST", body }, () => localCrew.updateMember(id, body)),
  addCrewWatch: (body: {
    memberId: string;
    title: string;
    steps?: string;
    hour: number;
    repeat?: "daily" | "weekdays" | "friday" | "once";
  }) => crewAct("/v1/crew/watches", { method: "POST", body }, () => localCrew.addWatch(body)),
  pauseCrewWatch: (id: string, paused = true) =>
    crewAct(
      `/v1/crew/watches/${encodeURIComponent(id)}/pause`,
      { method: "POST", body: { paused } },
      () => localCrew.pauseWatch(id, paused),
    ),
  removeCrewWatch: (id: string) =>
    crewAct(`/v1/crew/watches/${encodeURIComponent(id)}/remove`, { method: "POST" }, () => localCrew.removeWatch(id)),
  writeCrewWatch: (id: string) =>
    crewAct(
      `/v1/crew/watches/${encodeURIComponent(id)}/write`,
      { method: "POST", timeoutMs: 90_000 },
      () => localCrew.writeWatch(id),
    ),
  passCrewWork: (body: { fromId: string; toId: string; title: string; note?: string }) =>
    crewAct("/v1/crew/passes", { method: "POST", body }, () => localCrew.pass(body)),
  closeCrewPass: (id: string) =>
    crewAct(`/v1/crew/passes/${encodeURIComponent(id)}/close`, { method: "POST" }, () => localCrew.closePass(id)),
  crewBriefing: () => crewAct("/v1/crew/briefing", { method: "POST", timeoutMs: 90_000 }, () => localCrew.briefing()),
  setCrewFocus: (body: { title: string; note?: string }) =>
    crewAct("/v1/crew/focus", { method: "POST", body }, () => localCrew.setFocus(body)),
  installCrewPack: (id: string) =>
    crewAct(`/v1/crew/packs/${encodeURIComponent(id)}`, { method: "POST" }, () => localCrew.installPack(id)),
  refitCrew: () => crewAct("/v1/crew/refit", { method: "POST" }, () => localCrew.refit()),
  memberships: () => request<CollectionResponse<TeamMembership>>("/v1/memberships"),
  teamMembers: (teamId: string) =>
    request<CollectionResponse<TeamMembership>>(`/v1/teams/${teamId}/members`),
  addTeamMember: (teamId: string, body: AddTeamMemberRequest) =>
    request<TeamMembership>(`/v1/teams/${teamId}/members`, { method: "POST", body }),
  removeTeamMember: (teamId: string, agentId: string) =>
    request<{ ok: true }>(`/v1/teams/${teamId}/members/${agentId}`, { method: "DELETE" }),
  /** AI-drafted departments + companions. Falls back to the industry library when the API lacks the route. */
  workforceBlueprint: (body: WorkforceBlueprintRequest) =>
    request<WorkforceBlueprint>("/v1/workforce/blueprint", {
      method: "POST",
      body,
      timeoutMs: 90_000,
    })
      .then((blueprint) => hydrateWorkforceBlueprint(blueprint, body))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && [404, 501, 503].includes(err.status)) {
          return templateWorkforceBlueprint(body);
        }
        throw err;
      }),
  orgWorkforce: async () => {
    try {
      return await request<import("@arrab/shared").OrgWorkforceSnapshot>("/v1/org/workforce");
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("../../domains/organization/org-workforce-local");
      return localOrgSnapshot(readOrgEmployeePublic());
    }
  },
  orgDepartments: async () => {
    try {
      return await request<CollectionResponse<import("@arrab/shared").OrgDepartment>>(
        "/v1/org/departments",
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("../../domains/organization/org-workforce-local");
      const snap = await localOrgSnapshot();
      return { items: snap.departments };
    }
  },
  createOrgDepartment: async (body: import("@arrab/shared").CreateOrgDepartmentRequest) => {
    try {
      return await request<import("@arrab/shared").OrgDepartment>("/v1/org/departments", {
        method: "POST",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localCreateDepartment } = await import("../../domains/organization/org-workforce-local");
        return await localCreateDepartment(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not create department",
          400,
        );
      }
    }
  },
  updateOrgDepartment: async (
    id: string,
    body: import("@arrab/shared").UpdateOrgDepartmentRequest,
  ) => {
    try {
      return await request<import("@arrab/shared").OrgDepartment>(`/v1/org/departments/${id}`, {
        method: "PATCH",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localUpdateDepartment } = await import("../../domains/organization/org-workforce-local");
        return await localUpdateDepartment(id, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not update department",
          400,
        );
      }
    }
  },
  deleteOrgDepartment: async (id: string) => {
    try {
      return await request<{ ok: true }>(`/v1/org/departments/${id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localDeleteDepartment } = await import("../../domains/organization/org-workforce-local");
      return localDeleteDepartment(id);
    }
  },
  orgEmployees: async () => {
    try {
      return await request<CollectionResponse<import("@arrab/shared").OrgEmployeePublic>>(
        "/v1/org/employees",
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localOrgSnapshot } = await import("../../domains/organization/org-workforce-local");
      const snap = await localOrgSnapshot(readOrgEmployeePublic());
      return { items: snap.employees };
    }
  },
  createOrgEmployee: async (body: import("@arrab/shared").CreateOrgEmployeeRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeePublic>("/v1/org/employees", {
        method: "POST",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localCreateEmployee } = await import("../../domains/organization/org-workforce-local");
        return await localCreateEmployee(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not create employee",
          400,
        );
      }
    }
  },
  updateOrgEmployee: async (id: string, body: import("@arrab/shared").UpdateOrgEmployeeRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeePublic>(`/v1/org/employees/${id}`, {
        method: "PATCH",
        body,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localUpdateEmployee } = await import("../../domains/organization/org-workforce-local");
        return await localUpdateEmployee(id, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not update employee",
          400,
        );
      }
    }
  },
  deleteOrgEmployee: async (id: string) => {
    try {
      return await request<{ ok: true }>(`/v1/org/employees/${id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localDeleteEmployee } = await import("../../domains/organization/org-workforce-local");
      return localDeleteEmployee(id);
    }
  },
  orgEmployeeSignIn: async (body: import("@arrab/shared").OrgEmployeeSignInRequest) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeeSessionResponse>(
        "/v1/org/employees/sign-in",
        { method: "POST", body },
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      try {
        const { localEmployeeSignIn } = await import("../../domains/organization/org-workforce-local");
        return await localEmployeeSignIn(body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Sign-in failed",
          401,
        );
      }
    }
  },
  orgEmployeeSignOut: async () => {
    try {
      return await request<{ ok: true }>("/v1/org/employees/sign-out", {
        method: "POST",
        body: {},
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const { localEmployeeSignOut } = await import("../../domains/organization/org-workforce-local");
      return localEmployeeSignOut(readOrgEmployeeSessionToken());
    }
  },
  orgEmployeeChangePassword: async (
    body: import("@arrab/shared").OrgEmployeeChangePasswordRequest,
  ) => {
    try {
      return await request<import("@arrab/shared").OrgEmployeeSessionResponse>(
        "/v1/org/employees/change-password",
        { method: "POST", body },
      );
    } catch (err) {
      if (!(err instanceof ApiRequestError) || (err.status !== 404 && err.status < 500)) throw err;
      const token = readOrgEmployeeSessionToken();
      if (!token) throw new ApiRequestError("Employee session required", 401);
      try {
        const { localEmployeeChangePassword } = await import("../../domains/organization/org-workforce-local");
        return await localEmployeeChangePassword(token, body);
      } catch (localErr) {
        throw new ApiRequestError(
          localErr instanceof Error ? localErr.message : "Could not change password",
          400,
        );
      }
    }
  },
};
