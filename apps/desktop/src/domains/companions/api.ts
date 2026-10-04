import type {
  CompanionDeskView,
  DeskJob,
  DeskPace,
  UpdateDeskPaceRequest,
  ErpCompanion,
  ProfessionalWorkspaceView,
  UpsertBoundaryRequest,
  RecordProfessionalActionRequest,
  RecordProfessionalActionResponse,
  AppendActivityRequest,
  TakeControlRequest,
  UpsertResponsibilityRequest,
  SetSkillGrantRequest,
  UpsertReachabilityRequest,
  UpsertMcpPluginRequest,
  SetCompanionStatusRequest,
} from "@arrab/shared";
import { request } from "@/core/api/http";

export const companionsApi = {
  companionDesk: () => request<CompanionDeskView>("/v1/desk"),
  setDeskPace: (pace: DeskPace) =>
    request<CompanionDeskView>("/v1/desk", { method: "PATCH", body: { pace } }),
  updateDesk: (body: UpdateDeskPaceRequest) =>
    request<CompanionDeskView>("/v1/desk", { method: "PATCH", body }),
  killDesk: () => request<CompanionDeskView>("/v1/desk/kill", { method: "POST" }),
  addDeskSchedule: (body: {
    title: string;
    brief?: string;
    hour: number;
    repeat?: "daily" | "weekdays" | "friday" | "once";
    companionId?: string;
    companionName?: string;
    tomorrow?: boolean;
  }) => request<CompanionDeskView>("/v1/desk/schedules", { method: "POST", body }),
  followUpDeskJob: (id: string) =>
    request<CompanionDeskView>(`/v1/desk/jobs/${encodeURIComponent(id)}/follow-up`, { method: "POST" }),
  pauseDeskSchedule: (id: string, paused = true) =>
    request<CompanionDeskView>(`/v1/desk/schedules/${encodeURIComponent(id)}/pause`, {
      method: "POST",
      body: { paused },
    }),
  removeDeskSchedule: (id: string) =>
    request<CompanionDeskView>(`/v1/desk/schedules/${encodeURIComponent(id)}/remove`, { method: "POST" }),
  startDeskJob: (body: {
    title: string;
    brief?: string;
    companionId?: string;
    companionName?: string;
    channel?: "whatsapp" | "computer" | "sandbox" | "bill" | null;
    recipient?: string;
    amountSar?: number;
  }) => request<DeskJob>("/v1/desk/jobs", { method: "POST", body, timeoutMs: 90_000 }),
  approveDeskJob: (id: string, body?: { draftHash?: string; amountSar?: number }) =>
    request<DeskJob>(`/v1/desk/jobs/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: body ?? {},
      timeoutMs: 90_000,
    }),
  stopDeskJob: (id: string) =>
    request<DeskJob>(`/v1/desk/jobs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  reviseDeskJob: (id: string, note: string) =>
    request<DeskJob>(`/v1/desk/jobs/${encodeURIComponent(id)}/revise`, { method: "POST", body: { note } }),
  erpCompanions: () => request<{ items: ErpCompanion[] }>("/erp/companions?limit=500"),
  companionState: () =>
    request<{ updatedAt: string | null; state: unknown | null }>("/v1/companions/state"),
  putCompanionState: (body: { updatedAt: string; state: unknown }) =>
    request<{ updatedAt: string; state: unknown }>("/v1/companions/state", {
      method: "PUT",
      body,
    }),

  professionalWorkspace: () => request<ProfessionalWorkspaceView>("/v1/professional"),
  upsertProfessionalBoundary: (body: UpsertBoundaryRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/boundaries", { method: "POST", body }),
  removeProfessionalBoundary: (id: string) =>
    request<ProfessionalWorkspaceView>(
      `/v1/professional/boundaries/${encodeURIComponent(id)}/remove`,
      { method: "POST" },
    ),
  recordProfessionalAction: (body: RecordProfessionalActionRequest) =>
    request<RecordProfessionalActionResponse>("/v1/professional/actions", { method: "POST", body }),
  appendProfessionalActivity: (body: AppendActivityRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/activity", { method: "POST", body }),
  takeProfessionalControl: (body: TakeControlRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/control", { method: "POST", body }),
  upsertProfessionalResponsibility: (body: UpsertResponsibilityRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/responsibilities", { method: "POST", body }),
  removeProfessionalResponsibility: (id: string) =>
    request<ProfessionalWorkspaceView>(
      `/v1/professional/responsibilities/${encodeURIComponent(id)}/remove`,
      { method: "POST" },
    ),
  setProfessionalSkillGrant: (body: SetSkillGrantRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/skill-grants", { method: "POST", body }),
  upsertProfessionalReachability: (body: UpsertReachabilityRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/reachability", { method: "POST", body }),
  removeProfessionalReachability: (id: string) =>
    request<ProfessionalWorkspaceView>(
      `/v1/professional/reachability/${encodeURIComponent(id)}/remove`,
      { method: "POST" },
    ),
  upsertProfessionalPlugin: (body: UpsertMcpPluginRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/plugins", { method: "POST", body }),
  setProfessionalCompanionStatus: (body: SetCompanionStatusRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/status", { method: "POST", body }),
  upsertMuseIdea: (body: import("@arrab/shared").UpsertMuseIdeaRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/ideas", { method: "POST", body }),
  upsertMuseWatch: (body: import("@arrab/shared").UpsertMuseWatchRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/watches", { method: "POST", body }),
  observeMuseWatch: (body: import("@arrab/shared").ObserveMuseWatchRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/watches/observe", {
      method: "POST",
      body,
    }),
  importMuseFinance: (body: import("@arrab/shared").ImportMuseFinanceRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/finance/import", {
      method: "POST",
      body,
    }),
  upsertMuseGoal: (body: import("@arrab/shared").UpsertMuseGoalRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/goals", { method: "POST", body }),
  setProfessionalStay: (body: import("@arrab/shared").SetProfessionalStayRequest) =>
    request<ProfessionalWorkspaceView>("/v1/professional/stay", { method: "POST", body }),
};
