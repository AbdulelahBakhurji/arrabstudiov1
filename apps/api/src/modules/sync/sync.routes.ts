import type { FastifyInstance } from "fastify";
import type { V1Deps } from "../../http/deps.js";

export function registerSyncRoutes(app: FastifyInstance, deps: V1Deps): void {
  app.post<{ Body: { ops?: unknown } }>(
    "/v1/sync/push",
    { bodyLimit: 4 * 1024 * 1024 },
    async (request) => deps.sync.push(request.body?.ops, request.sessionId ?? "unknown"),
  );

  app.get<{ Querystring: { cursor?: string; limit?: string; kinds?: string } }>(
    "/v1/sync/pull",
    async (request) =>
      deps.sync.pull(
        request.query.cursor,
        request.query.limit ? Number(request.query.limit) : undefined,
        request.query.kinds ? request.query.kinds.split(",") : undefined,
      ),
  );
}
