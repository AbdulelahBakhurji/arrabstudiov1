import { ForbiddenError, ValidationError } from "@arrab/core";
import { fetchLiveCandles, fetchLiveQuotes } from "./market-data-service.js";
import type { BindProjectRepoRequest, CreateGoalRequest, CreateProjectRequest, CreateTaskRequest, UpdateGoalRequest, UpdateOperatorRequest, UpsertCompanionStateRequest, UpdateProjectRequest, UpdateTaskRequest } from "@arrab/shared";
import type { FastifyInstance } from "fastify";
import { listStudioReleases } from "./releases.js";
import type { RouteHelpers, V1Deps } from "../../http/deps.js";

export function registerWorkspaceRoutes(app: FastifyInstance, deps: V1Deps, { assertCap }: RouteHelpers): void {
  app.get("/v1/meta", async () => {
    const status = await deps.accounts.status();
    return {
      name: "arrab-api" as const,
      version: "0.15.1",
      phase: "12",
      persistence: deps.persistence,
      workspaceId: deps.workspaceId,
      aiProviders: deps.gateway.listProviders().map((provider) => provider.id),
      account: {
        connected: status.connected,
        planId: status.entitlements.planId,
        tokenLimit: status.entitlements.tokenLimit,
        tokensUsed: status.entitlements.tokensUsed,
        tokensRemaining: status.entitlements.tokensRemaining,
        overLimit: status.entitlements.overLimit,
        pauseMode: status.entitlements.pauseMode,
      },
      connectors: {
        openWaServerManaged: deps.openWaServerManaged === true,
      },
    };
  });


  app.get("/v1/dashboard", async () => {
    const dash = await deps.queries.dashboard();
    if (await deps.familyHousehold.isActiveChildSeat()) {
      return {
        ...dash,
        projects: [],
        agents: [],
        teams: [],
        activity: [],
        conversations: await deps.familyHousehold.filterConversations(dash.conversations),
      };
    }
    return dash;
  });

  app.get("/v1/usage", async (request) => {
    const employee = request.orgEmployee ?? null;
    const perms = deps.orgWorkforce.permissionsFor(employee);
    // Non-admin seats see only usage for agents in their department — never the org token pool.
    if (employee && !perms.canAdminister) {
      const agents = await deps.orgWorkforce.filterAgents(
        await deps.queries.listAgents(),
        employee,
      );
      return deps.queries.usageSummary(deps.accounts, {
        allowedAgentIds: new Set(agents.map((agent) => agent.id)),
        includeEntitlements: false,
      });
    }
    return deps.queries.usageSummary(deps.accounts, {
      account: request.account ?? null,
    });
  });

  app.get("/v1/reports/summary", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Reports are only available to parents");
    }
    await assertCap(request, "canAdminister", "Only admins can view organization reports");
    return deps.queries.reportSummary();
  });


  app.get("/v1/releases", async () =>
    listStudioReleases(deps.releasesDir, deps.publicBaseUrl.replace(/\/v1\/?$/, "")),
  );


  app.get("/v1/operator", async () => deps.queries.getOperator());

  app.put<{ Body: UpdateOperatorRequest }>("/v1/operator", async (request) =>
    deps.commands.updateOperator(request.body ?? {}),
  );


  app.get("/v1/companions/state", async () => deps.queries.getCompanionState());

  app.put<{ Body: UpsertCompanionStateRequest }>("/v1/companions/state", async (request) =>
    deps.commands.upsertCompanionState(request.body ?? { updatedAt: "", state: null }),
  );


  app.get("/v1/tasks", async (request) => ({
    items: await deps.orgWorkforce.filterTasks(
      await deps.queries.listTasks(),
      request.orgEmployee,
    ),
  }));

  app.post<{ Body: CreateTaskRequest }>("/v1/tasks", async (request) => {
    await assertCap(request, "canAssignWork", "Managers and admins can create tasks");
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.commands.createTask(request.body ?? { title: "" });
  });

  app.patch<{ Params: { id: string }; Body: UpdateTaskRequest }>(
    "/v1/tasks/:id",
    async (request) => {
      await assertCap(request, "canAssignWork", "Managers and admins can update tasks");
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      return deps.commands.updateTask(request.params.id, request.body ?? {});
    },
  );

  app.delete<{ Params: { id: string } }>("/v1/tasks/:id", async (request) => {
    await assertCap(request, "canAssignWork", "Managers and admins can delete tasks");
    return deps.commands.deleteTask(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: { requireApproval?: boolean } }>(
    "/v1/tasks/:id/run",
    async (request) =>
      deps.taskExecution.runTask(request.params.id, {
        requireApproval: Boolean(request.body?.requireApproval),
      }),
  );

  app.get<{ Params: { id: string } }>("/v1/tasks/:id/runs", async (request) => ({
    items: await deps.queries.listTaskRuns(request.params.id),
  }));

  app.get("/v1/task-runs", async () => ({ items: await deps.queries.listTaskRuns() }));


  app.get("/v1/projects", async () => ({ items: await deps.queries.listProjects() }));

  app.post<{ Body: CreateProjectRequest }>("/v1/projects", async (request) =>
    deps.commands.createProject(request.body ?? { name: "" }),
  );

  app.patch<{ Params: { id: string }; Body: UpdateProjectRequest }>(
    "/v1/projects/:id",
    async (request) => deps.commands.updateProject(request.params.id, request.body ?? {}),
  );

  app.get<{ Params: { id: string } }>("/v1/projects/:id/repo", async (request) => ({
    item: await deps.queries.getBinding(request.params.id),
  }));

  app.put<{ Params: { id: string }; Body: BindProjectRepoRequest }>(
    "/v1/projects/:id/repo",
    async (request) =>
      deps.commands.bindProjectRepo(request.params.id, request.body ?? {
        connectorId: "",
        repoFullName: "",
      }),
  );

  app.delete<{ Params: { id: string } }>("/v1/projects/:id/repo", async (request) =>
    deps.commands.unbindProjectRepo(request.params.id),
  );


  app.get("/v1/bindings", async () => ({ items: await deps.queries.listBindings() }));


  app.get<{ Querystring: { status?: string } }>("/v1/goals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.goals.list(request.query.status) };
  });

  app.post<{ Body: CreateGoalRequest }>("/v1/goals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household goals");
    }
    return deps.goals.create(request.body ?? { title: "" });
  });

  app.patch<{ Params: { id: string }; Body: UpdateGoalRequest }>(
    "/v1/goals/:id",
    async (request) => {
      if (await deps.familyHousehold.isActiveChildSeat()) {
        throw new ForbiddenError("Children cannot manage household goals");
      }
      return deps.goals.update(request.params.id, request.body ?? {});
    },
  );


  app.get<{ Querystring: { limit?: string; before?: string } }>("/v1/activity", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [], nextCursor: null };
    const parsed = Number.parseInt(request.query.limit ?? "", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    const all = [...(await deps.queries.listActivity())].sort((a, b) =>
      a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
    );
    const before = request.query.before?.trim();
    const start = before ? all.findIndex((item) => item.id === before) + 1 : 0;
    const page = all.slice(start, start + limit);
    const hasMore = start + limit < all.length;
    return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  });


  /** Live market quotes (Yahoo Finance proxy — no key required). */
  app.get<{ Querystring: { symbols?: string } }>("/v1/markets/quotes", async (request) => {
    const raw = request.query.symbols?.trim() ?? "";
    const symbols = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!symbols.length) {
      throw new ValidationError("symbols query is required (comma-separated)");
    }
    if (symbols.length > 50) {
      throw new ValidationError("At most 50 symbols per request");
    }
    return fetchLiveQuotes(symbols);
  });


  app.get<{
    Querystring: { symbol?: string; range?: string; interval?: string };
  }>("/v1/markets/candles", async (request) => {
    const symbol = request.query.symbol?.trim();
    if (!symbol) {
      throw new ValidationError("symbol query is required");
    }
    return fetchLiveCandles(symbol, {
      range: request.query.range?.trim() || "5d",
      interval: request.query.interval?.trim() || "15m",
    });
  });
}
