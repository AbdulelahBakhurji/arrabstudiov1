import type { Activity, CollectionResponse, CreateGoalRequest, CreateProjectRequest, CreateTaskRequest, DashboardResponse, Goal, HealthResponse, OperatorProfile, Project, ReportSummaryResponse, RunTaskResponse, Task, TaskRun, UpdateGoalRequest, UpdateOperatorRequest, UpdateProjectRequest, UpdateTaskRequest } from "@arrab/shared";
import { ApiRequestError, request } from "@/core/api/http";


export const workspaceApi = {
  health: async () => {
    try {
      return await request<HealthResponse>("/health");
    } catch (err) {
      // Coolify may expose `/v1/*` under the prefix while omitting `/health`.
      if (err instanceof ApiRequestError && err.status === 404) {
        await request<{ name?: string }>("/v1/meta");
        return {
          status: "ok" as const,
          service: "arrab-api" as const,
          time: new Date().toISOString(),
        };
      }
      throw err;
    }
  },
  meta: () => request<import("@arrab/shared").ApiMetaResponse>("/v1/meta"),
  dashboard: () => request<DashboardResponse>("/v1/dashboard"),
  projects: () => request<CollectionResponse<Project>>("/v1/projects"),
  createProject: (body: CreateProjectRequest) =>
    request<Project>("/v1/projects", { method: "POST", body }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<Project>(`/v1/projects/${id}`, { method: "PATCH", body }),
  activity: (opts?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.limit) qs.set("limit", String(opts.limit));
    if (opts?.before) qs.set("before", opts.before);
    const query = qs.toString();
    return request<CollectionResponse<Activity> & { nextCursor?: string | null }>(
      `/v1/activity${query ? `?${query}` : ""}`,
    );
  },
  goals: (status?: string) =>
    request<CollectionResponse<Goal>>(
      status ? `/v1/goals?status=${encodeURIComponent(status)}` : "/v1/goals",
    ),
  agentGoals: (agentId: string) => request<CollectionResponse<Goal>>(`/v1/agents/${agentId}/goals`),
  createGoal: (body: CreateGoalRequest) => request<Goal>("/v1/goals", { method: "POST", body }),
  updateGoal: (id: string, body: UpdateGoalRequest) =>
    request<Goal>(`/v1/goals/${id}`, { method: "PATCH", body }),
  operator: () => request<OperatorProfile>("/v1/operator"),
  updateOperator: (body: UpdateOperatorRequest) =>
    request<OperatorProfile>("/v1/operator", { method: "PUT", body }),
  tasks: () => request<CollectionResponse<Task>>("/v1/tasks"),
  createTask: (body: CreateTaskRequest) => request<Task>("/v1/tasks", { method: "POST", body }),
  updateTask: (id: string, body: UpdateTaskRequest) =>
    request<Task>(`/v1/tasks/${id}`, { method: "PATCH", body }),
  deleteTask: (id: string) => request<{ ok: true }>(`/v1/tasks/${id}`, { method: "DELETE" }),
  runTask: (id: string, options?: { requireApproval?: boolean }) =>
    request<RunTaskResponse>(`/v1/tasks/${id}/run`, {
      method: "POST",
      body: options?.requireApproval ? { requireApproval: true } : {},
      timeoutMs: 60_000,
    }),
  taskRuns: (taskId?: string) =>
    request<CollectionResponse<TaskRun>>(taskId ? `/v1/tasks/${taskId}/runs` : "/v1/task-runs"),
  reportSummary: () => request<ReportSummaryResponse>("/v1/reports/summary"),
};
