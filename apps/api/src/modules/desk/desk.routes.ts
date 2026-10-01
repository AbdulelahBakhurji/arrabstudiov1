import type { AddDeskScheduleRequest, ApproveDeskJobRequest, UpdateDeskPaceRequest, StartDeskJobRequest, ReviseDeskJobRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerDeskRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.get("/v1/desk", async () => deps.desk.get());

  app.patch<{ Body: UpdateDeskPaceRequest }>("/v1/desk", async (request) =>
    deps.desk.update(request.body ?? {}),
  );

  app.post<{ Body: AddDeskScheduleRequest }>("/v1/desk/schedules", async (request) =>
    deps.desk.addSchedule(request.body ?? { title: "", hour: -1 }),
  );

  app.post<{ Params: { id: string }; Body: { paused?: boolean } }>("/v1/desk/schedules/:id/pause", async (request) =>
    deps.desk.pauseSchedule(request.params.id, request.body?.paused !== false),
  );

  app.post<{ Params: { id: string } }>("/v1/desk/schedules/:id/remove", async (request) =>
    deps.desk.removeSchedule(request.params.id),
  );

  app.post("/v1/desk/kill", async () => deps.desk.kill());

  app.post<{ Body: StartDeskJobRequest }>("/v1/desk/jobs", async (request) =>
    deps.desk.start(request.body ?? { title: "" }),
  );

  app.post<{ Params: { id: string }; Body: ApproveDeskJobRequest }>("/v1/desk/jobs/:id/approve", async (request) =>
    deps.desk.approve(request.params.id, request.body ?? {}),
  );

  app.post<{ Params: { id: string } }>("/v1/desk/jobs/:id/follow-up", async (request) =>
    deps.desk.followUp(request.params.id),
  );

  app.post<{ Params: { id: string } }>("/v1/desk/jobs/:id/stop", async (request) =>
    deps.desk.stop(request.params.id),
  );

  app.post<{ Params: { id: string }; Body: ReviseDeskJobRequest }>(
    "/v1/desk/jobs/:id/revise",
    async (request) => deps.desk.revise(request.params.id, request.body?.note ?? ""),
  );
}
