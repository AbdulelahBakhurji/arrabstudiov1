import type { CompanionDeskView, DeskJob, DeskPace, UpdateDeskPaceRequest, ErpCompanion } from "@arrab/shared";
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
    request<CompanionDeskView>(`/v1/desk/schedules/${encodeURIComponent(id)}/pause`, { method: "POST", body: { paused } }),
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
  }) =>
    request<DeskJob>("/v1/desk/jobs", { method: "POST", body, timeoutMs: 90_000 }),
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
  erpCompanions: () =>
    request<{ items: ErpCompanion[] }>("/erp/companions?limit=500"),
  companionState: () =>
    request<{ updatedAt: string | null; state: unknown | null }>("/v1/companions/state"),
  putCompanionState: (body: { updatedAt: string; state: unknown }) =>
    request<{ updatedAt: string; state: unknown }>("/v1/companions/state", {
      method: "PUT",
      body,
    }),
};
