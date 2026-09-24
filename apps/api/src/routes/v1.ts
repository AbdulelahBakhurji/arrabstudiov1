import type { AiGateway } from "@arrab/ai";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@arrab/core";
import type {
  ActivateSubscriptionRequest,
  AddTeamMemberRequest,
  BindProjectRepoRequest,
  ConnectAccountRequest,
  ConnectConnectorRequest,
  CreateAgentRequest,
  CreateConversationRequest,
  CreateGoalRequest,
  CreateKnowledgeRequest,
  CreateMemoryRequest,
  CreateSkillRequest,
  CreateApprovalRequest,
  ResolveApprovalRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  CreateTeamRequest,
  GithubCommitRequest,
  GithubCreatePullRequest,
  PersistenceMode,
  SendEmailRequest,
  SendMessageRequest,
  IngestConversationMessagesRequest,
  SendWhatsAppRequest,
  SignInAccountRequest,
  StartWebAuthRequest,
  CompleteWebAuthRequest,
  VerifyAccountSessionRequest,
  BillingCheckoutRequest,
  ArrangeEmailRequest,
  UpdateAccountProfileRequest,
  UpdateAgentRequest,
  UpdateGoalRequest,
  UpdateKnowledgeRequest,
  UpdateOperatorRequest,
  UpsertCompanionStateRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UpdateTeamRequest,
  CreateOrgDepartmentRequest,
  CreateOrgEmployeeRequest,
  UpdateOrgDepartmentRequest,
  UpdateOrgEmployeeRequest,
  OrgEmployeeSignInRequest,
  OrgEmployeeRecord,
  OrgEmployeeChangePasswordRequest,
  CreateFamilyMemberRequest,
  UpdateFamilyMemberRequest,
  FamilyMemberSignInRequest,
  SwitchFamilyProfileRequest,
  GrantFamilyTokensRequest,
  PurchaseFamilySeatsRequest,
  CreateFamilyGuidanceRequest,
} from "@arrab/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConnectorService } from "../services/connector-service.js";
import type { FamilyHouseholdService } from "../services/family-household-service.js";
import type { ConversationService } from "../services/conversation-service.js";
import type { AccountService } from "../services/account-service.js";
import type { BillingService } from "../services/billing-service.js";
import { listStudioReleases } from "../services/releases.js";
import type { GoalService } from "../services/goal-service.js";
import type { TaskExecutionService } from "../services/task-execution-service.js";
import type { OrgWorkforceService } from "../services/org-workforce-service.js";
import type { WorkspaceCommandService } from "../services/workspace-commands.js";
import type { WorkspaceQueryService } from "../services/workspace-query.js";

/** After OAuth, hand the session back to Arrab Studio then open the site. */
function oauthDesktopBridgeHtml(input: {
  provider:
    | "gmail"
    | "outlook"
    | "github"
    | "gitlab"
    | "bitbucket"
    | "linear"
    | "slack"
    | "notion"
    | "whoop"
    | "fitbit"
    | "google_drive"
    | "google_calendar"
    | "figma";
  nextUrl: string;
  ok: boolean;
}): string {
  const deepLink = input.ok
    ? `arrab://connectors/connected?provider=${encodeURIComponent(input.provider)}`
    : `arrab://connectors/error?provider=${encodeURIComponent(input.provider)}`;
  const next = input.nextUrl.replace(/"/g, "&quot;");
  const title = input.ok ? "Connected" : "Connection failed";
  const body = input.ok
    ? `Opening Arrab Studio… ${input.provider} is ready.`
    : `Could not finish ${input.provider}. Returning to Arrab…`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arrab Studio · ${title}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #050505; color: #f5f5f5; }
    .card { width: min(420px, calc(100vw - 2rem)); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #0a0a0a; padding: 28px; text-align: center; }
    h1 { margin: 0; font-size: 1.25rem; font-weight: 560; letter-spacing: -0.03em; }
    p { color: #a3a3a3; font-size: .9rem; line-height: 1.5; }
    a { color: #bbf7d0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p id="msg">${body}</p>
    <p><a id="open" href="${deepLink}">Open Arrab Studio</a></p>
  </div>
  <script>
    (function () {
      var deep = ${JSON.stringify(deepLink)};
      var next = ${JSON.stringify(input.nextUrl)};
      try { window.location.href = deep; } catch (e) {}
      window.setTimeout(function () {
        window.location.replace(next);
      }, 700);
    })();
  </script>
</body>
</html>`;
}

export function registerV1Routes(
  app: FastifyInstance,
  deps: {
    queries: WorkspaceQueryService;
    commands: WorkspaceCommandService;
    conversations: ConversationService;
    connectors: ConnectorService;
    accounts: AccountService;
    billing: BillingService;
    goals: GoalService;
    taskExecution: TaskExecutionService;
    orgWorkforce: OrgWorkforceService;
    familyHousehold: FamilyHouseholdService;
    gateway: AiGateway;
    persistence: PersistenceMode;
    workspaceId: string;
    defaultModel: string | null;
    bedrockModels?: string[];
    openRouterModels?: string[];
    primaryProviderId?: string;
    bedrockRegion?: string;
    releasesDir: string;
    publicBaseUrl: string;
  },
): void {
  app.addHook("onRequest", async (request) => {
    const header = request.headers["x-arrab-employee-session"];
    const token = Array.isArray(header) ? header[0] : header;
    request.orgEmployee = await deps.orgWorkforce.resolveSession(token ?? null);

    const familyHeader = request.headers["x-arrab-family-member"];
    const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
    // Only authenticated studio sessions may select a seat via header (blocks anonymous spoof).
    if (request.account && familyMemberId?.trim()) {
      await deps.familyHousehold.setActiveMember(familyMemberId.trim());
    }
  });

  const assertCap = async (
    request: FastifyRequest,
    capability: Parameters<OrgWorkforceService["assertCapability"]>[1],
    detail: string,
  ) => {
    const openWorkspace = !(await deps.accounts.hasAccount());
    deps.orgWorkforce.assertCapability(
      request.orgEmployee ?? null,
      capability,
      detail,
      request.account,
      openWorkspace,
    );
  };

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
    return deps.queries.usageSummary(deps.accounts);
  });
  app.get("/v1/reports/summary", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Reports are only available to parents");
    }
    await assertCap(request, "canAdminister", "Only admins can view organization reports");
    return deps.queries.reportSummary();
  });

  app.get("/v1/account", async (request) => {
    const status = await deps.accounts.status();
    const employee = request.orgEmployee ?? null;
    if (employee && !deps.orgWorkforce.permissionsFor(employee).canAdminister) {
      return {
        ...status,
        plans: [],
        entitlements: status.entitlements
          ? {
              ...status.entitlements,
              tokensUsed: 0,
              tokensRemaining: status.entitlements.tokenLimit,
              overLimit: false,
              planName: "Seat",
              planId: status.entitlements.planId,
            }
          : status.entitlements,
      };
    }
    return status;
  });
  app.post<{ Body: ConnectAccountRequest }>("/v1/account/connect", async (request) => {
    const result = await deps.accounts.connect(request.body ?? { email: "", password: "" });
    await deps.familyHousehold.clearSeatLock();
    return result;
  });
  app.post<{ Body: SignInAccountRequest }>("/v1/account/sign-in", async (request) => {
    const result = await deps.accounts.signIn(request.body ?? { email: "", password: "" });
    await deps.familyHousehold.clearSeatLock();
    return result;
  });
  app.post<{ Body: VerifyAccountSessionRequest }>("/v1/account/session", async (request) =>
    deps.accounts.verifySession(request.body?.sessionToken ?? ""),
  );
  app.post("/v1/account/disconnect", async () => {
    await deps.familyHousehold.clearSeatLock();
    return deps.accounts.disconnect();
  });
  app.post("/v1/account/logout", async () => {
    await deps.familyHousehold.clearSeatLock();
    return deps.accounts.logout();
  });
  app.post<{ Body: ActivateSubscriptionRequest }>("/v1/account/subscribe", async (request) => {
    await assertCap(request, "canAdminister", "Only admins can change organization plans");
    return deps.accounts.activateSubscription(request.body ?? { code: "" });
  });
  app.patch<{ Body: UpdateAccountProfileRequest }>("/v1/account", async (request) =>
    deps.accounts.updateProfile(request.body ?? {}),
  );

  app.post<{ Body: StartWebAuthRequest }>("/v1/account/auth/web/start", async () =>
    deps.accounts.startWebAuth(),
  );
  app.get<{ Querystring: { state?: string; pollSecret?: string } }>(
    "/v1/account/auth/web/poll",
    async (request) =>
      deps.accounts.pollWebAuth(request.query.state ?? "", request.query.pollSecret ?? ""),
  );
  app.post<{ Body: CompleteWebAuthRequest }>("/v1/account/auth/web/complete", async (request) => {
    const result = await deps.accounts.completeWebAuth(
      request.body ?? { state: "", email: "", password: "" },
    );
    await deps.familyHousehold.clearSeatLock();
    return result;
  });

  app.get("/v1/billing/plans", async () => deps.billing.catalog());
  app.post<{ Body: BillingCheckoutRequest }>("/v1/billing/checkout", async (request) => {
    await assertCap(request, "canAdminister", "Only admins can change organization plans");
    return deps.billing.checkout(request.body?.planId ?? "");
  });
  app.get<{ Querystring: { id?: string; invoice?: string } }>(
    "/v1/billing/confirm",
    async (request) =>
      deps.billing.confirmInvoice(request.query.id ?? request.query.invoice ?? ""),
  );
  app.post("/v1/billing/moyasar/callback", async (request) =>
    deps.billing.handleCallback(request.body),
  );
  app.get("/v1/releases", async () =>
    listStudioReleases(deps.releasesDir, deps.publicBaseUrl.replace(/\/v1\/?$/, "")),
  );

  app.get<{ Querystring: { state?: string } }>("/v1/account/auth/web", async (request, reply) => {
    const state = request.query.state ?? "";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arrab Studio · Sign in</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #050505; color: #f5f5f5; }
    .card { width: min(420px, calc(100vw - 2rem)); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; background: #0a0a0a; padding: 28px; }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 560; letter-spacing: -0.03em; }
    p { color: #a3a3a3; font-size: .9rem; line-height: 1.5; }
    label { display: grid; gap: 6px; margin-top: 14px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #737373; }
    input { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: #000; color: #fff; padding: 12px 14px; font-size: 14px; }
    button { margin-top: 18px; width: 100%; border: 0; border-radius: 999px; background: #fff; color: #000; font-weight: 600; padding: 12px 16px; cursor: pointer; }
    a.open { display: inline-block; margin-top: 12px; color: #bbf7d0; }
    .ok { color: #bbf7d0; } .err { color: #fecaca; }
  </style>
</head>
<body>
  <form class="card" id="form">
    <h1>Sign in to Arrab Studio</h1>
    <p>Complete sign-in here. When it succeeds, Arrab Studio opens automatically.</p>
    <input type="hidden" name="state" value="${state.replace(/"/g, "&quot;")}" />
    <label>Display name<input name="displayName" placeholder="Your name" /></label>
    <label>Email<input name="email" type="email" required placeholder="you@company.com" /></label>
    <label>Password<input name="password" type="password" required minlength="8" placeholder="At least 8 characters" /></label>
    <label>Plan code (optional)<input name="planCode" placeholder="PRO-ARRAB" /></label>
    <button type="submit">Sign in</button>
    <p id="msg"></p>
    <a class="open" id="openApp" href="arrab://auth/complete" hidden>Open Arrab Studio</a>
  </form>
  <script>
    const form = document.getElementById('form');
    const msg = document.getElementById('msg');
    const openApp = document.getElementById('openApp');
    function openStudio(sessionToken) {
      const state = (form.querySelector('input[name="state"]') || {}).value || '';
      const params = new URLSearchParams();
      if (sessionToken) params.set('session', sessionToken);
      if (state) params.set('state', state);
      const href = params.toString()
        ? ('arrab://auth/complete?' + params.toString())
        : 'arrab://auth/complete';
      openApp.href = href;
      openApp.hidden = false;
      window.location.href = href;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      msg.textContent = 'Signing in…';
      msg.className = '';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await fetch('/v1/account/auth/web/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message || 'Sign-in failed');
        msg.className = 'ok';
        msg.textContent = 'Signed in as ' + payload.account.email + '. Opening Arrab Studio…';
        form.querySelector('button').disabled = true;
        openStudio(payload.sessionToken || '');
      } catch (error) {
        msg.className = 'err';
        msg.textContent = error instanceof Error ? error.message : 'Sign-in failed';
      }
    });
  </script>
</body>
</html>`;
    return reply.type("text/html").send(html);
  });

  app.get("/v1/operator", async () => deps.queries.getOperator());
  app.put<{ Body: UpdateOperatorRequest }>("/v1/operator", async (request) =>
    deps.commands.updateOperator(request.body ?? {}),
  );

  app.get("/v1/companions/state", async () => deps.queries.getCompanionState());
  app.put<{ Body: UpsertCompanionStateRequest }>("/v1/companions/state", async (request) =>
    deps.commands.upsertCompanionState(request.body ?? { updatedAt: "", state: null }),
  );

  function clientIp(request: { ip?: string; headers: Record<string, unknown> }): string | null {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0]?.trim() || null;
    }
    return request.ip ?? null;
  }

  app.get("/v1/org/workforce", async (request) =>
    deps.orgWorkforce.snapshot(request.orgEmployee),
  );

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

  app.post<{ Body: OrgEmployeeSignInRequest }>("/v1/org/employees/sign-in", async (request) =>
    deps.orgWorkforce.signIn(request.body ?? { email: "", password: "" }, clientIp(request)),
  );
  app.post("/v1/org/employees/sign-out", async (request) => {
    if (!request.orgEmployee) return { ok: true as const };
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
  app.get("/v1/task-runs", async () => ({ items: await deps.queries.listTaskRuns() }));
  app.get<{ Params: { id: string } }>("/v1/tasks/:id/runs", async (request) => ({
    items: await deps.queries.listTaskRuns(request.params.id),
  }));

  app.get("/v1/knowledge", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listKnowledge() };
  });
  app.post<{ Body: CreateKnowledgeRequest }>("/v1/knowledge", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household knowledge");
    }
    return deps.commands.createKnowledge(request.body ?? { title: "", content: "" });
  });
  app.patch<{ Params: { id: string }; Body: UpdateKnowledgeRequest }>(
    "/v1/knowledge/:id",
    async (request) => {
      if (await deps.familyHousehold.isActiveChildSeat()) {
        throw new ForbiddenError("Children cannot manage household knowledge");
      }
      return deps.commands.updateKnowledge(request.params.id, request.body ?? {});
    },
  );
  app.delete<{ Params: { id: string } }>("/v1/knowledge/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household knowledge");
    }
    return deps.commands.deleteKnowledge(request.params.id);
  });

  app.get("/v1/memories", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listMemories() };
  });
  app.post<{ Body: CreateMemoryRequest }>("/v1/memories", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household memories");
    }
    return deps.commands.createMemory(request.body ?? { content: "" });
  });
  app.delete<{ Params: { id: string } }>("/v1/memories/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household memories");
    }
    return deps.commands.deleteMemory(request.params.id);
  });

  app.get<{ Querystring: { agentId?: string } }>("/v1/skills", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listSkills(request.query.agentId) };
  });
  app.post<{ Body: CreateSkillRequest }>("/v1/skills", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household skills");
    }
    return deps.commands.createSkill(
      request.body ?? { agentId: "", title: "", instructions: "" },
    );
  });
  app.delete<{ Params: { id: string } }>("/v1/skills/:id", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage household skills");
    }
    return deps.commands.deleteSkill(request.params.id);
  });

  app.get("/v1/approvals", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listApprovals() };
  });
  app.get("/v1/approvals/pending", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return {
      items: await deps.queries.listPendingApprovals(),
    };
  });
  app.post<{ Body: CreateApprovalRequest }>("/v1/approvals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) {
      throw new ForbiddenError("Children cannot manage approvals");
    }
    return deps.commands.createApproval(
      request.body ?? { kind: "activate_agent", title: "" },
    );
  });
  app.post<{ Params: { id: string }; Body: ResolveApprovalRequest }>(
    "/v1/approvals/:id/resolve",
    async (request) => {
      if (await deps.familyHousehold.isActiveChildSeat()) {
        throw new ForbiddenError("Children cannot resolve approvals");
      }
      const resolved = await deps.commands.resolveApproval(
        request.params.id,
        request.body ?? { status: "approved" },
      );
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "run_task" &&
        resolved.approval.taskId
      ) {
        const run = await deps.taskExecution.runTask(resolved.approval.taskId);
        return { ...resolved, run };
      }
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "git_push"
      ) {
        const git = await deps.connectors.resumeApprovalAction(resolved.approval);
        return { ...resolved, ...git };
      }
      if (
        resolved.approval.status === "approved" &&
        resolved.approval.kind === "call_tool"
      ) {
        const continued = await deps.conversations.resumeAfterToolApproval(
          resolved.approval,
          {
            toolResult: request.body?.toolResult,
            toolResultAttestation: request.body?.toolResultAttestation,
          },
        );
        return { ...resolved, continued };
      }
      return resolved;
    },
  );

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
  app.get("/v1/memberships", async () => ({ items: await deps.queries.listMemberships() }));
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

  app.get("/v1/conversations", async (request) => {
    const items = await deps.orgWorkforce.filterConversations(
      await deps.conversations.listConversations(),
      request.orgEmployee,
    );
    return { items: await deps.familyHousehold.filterConversations(items) };
  });
  app.post<{ Body: CreateConversationRequest }>("/v1/conversations", async (request) => {
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.conversations.createConversation(
      request.body ?? { agentId: "" },
      request.orgEmployee?.id ?? null,
    );
  });
  app.get<{ Params: { id: string } }>("/v1/conversations/:id", async (request) => {
    const detail = await deps.conversations.getConversation(request.params.id);
    await deps.orgWorkforce.assertCanOpenConversation(
      detail.conversation,
      request.orgEmployee,
    );
    await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
    return detail;
  });
  app.delete<{ Params: { id: string } }>("/v1/conversations/:id", async (request) => {
    const detail = await deps.conversations.getConversation(request.params.id);
    await deps.orgWorkforce.assertCanOpenConversation(
      detail.conversation,
      request.orgEmployee,
    );
    await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
    deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
    return deps.conversations.deleteConversation(request.params.id);
  });
  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages",
    async (request) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      return deps.conversations.sendMessage(request.params.id, request.body ?? { content: "" });
    },
  );
  app.post<{ Params: { id: string }; Body: IngestConversationMessagesRequest }>(
    "/v1/conversations/:id/messages/ingest",
    async (request) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      return deps.conversations.ingestMessages(
        request.params.id,
        request.body ?? { messages: [] },
      );
    },
  );
  app.post<{ Params: { id: string }; Body: SendMessageRequest }>(
    "/v1/conversations/:id/messages/stream",
    async (request, reply) => {
      const detail = await deps.conversations.getConversation(request.params.id);
      await deps.orgWorkforce.assertCanOpenConversation(
        detail.conversation,
        request.orgEmployee,
      );
      await deps.familyHousehold.assertCanOpenConversation(detail.conversation);
      deps.orgWorkforce.assertNotLockedOutOfActions(request.orgEmployee);
      const familyHeader = request.headers["x-arrab-family-member"];
      const familyMemberId = Array.isArray(familyHeader) ? familyHeader[0] : familyHeader;
      await deps.familyHousehold.assertCanChat(familyMemberId ?? null);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const write = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const flushable = reply.raw as { flush?: () => void };
        flushable.flush?.();
      };
      // Flush immediately so proxies don't wait for the first model token.
      write("ready", { ok: true });
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: ping\n\n`);
        } catch {
          // closed
        }
      }, 15_000);
      try {
        const response = await deps.conversations.sendMessage(
          request.params.id,
          request.body ?? { content: "" },
          {
            onToken: (text) => write("token", { text }),
            onToolStart: (name, detail) => write("tool_start", { name, detail }),
            onTool: (name, result) => write("tool", { name, result }),
            onApproval: (approval) => write("approval", { approval }),
          },
        );
        write("done", response);
      } catch (error) {
        write("error", {
          message: error instanceof Error ? error.message : "Stream failed",
        });
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    },
  );

  app.get<{ Querystring: { status?: string } }>("/v1/goals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.goals.list(request.query.status) };
  });
  app.get<{ Params: { agentId: string } }>("/v1/agents/:agentId/goals", async (request) => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.goals.listActiveByAgent(request.params.agentId) };
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

  app.get("/v1/activity", async () => {
    if (await deps.familyHousehold.isActiveChildSeat()) return { items: [] };
    return { items: await deps.queries.listActivity() };
  });

  app.get("/v1/ai/status", async () => {
    const primary = deps.primaryProviderId ?? "bedrock";
    const catalog =
      primary === "openrouter"
        ? (deps.openRouterModels ?? [])
        : primary === "openai"
          ? ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]
          : primary === "anthropic"
            ? ["claude-3-5-haiku-latest", "claude-sonnet-4-20250514", "claude-opus-4-20250514"]
            : primary === "xai"
              ? ["grok-3-mini", "grok-3"]
              : (deps.bedrockModels ?? []);
    const defaultModel = deps.defaultModel ?? null;
    const models = [
      ...new Set(
        [defaultModel, ...catalog]
          .map((item) => item?.trim())
          .filter((item): item is string => Boolean(item)),
      ),
    ];
    return {
      configured: deps.gateway.listProviders().length > 0,
      providers: deps.gateway.listProviders().map((provider) => provider.id),
      defaultModel,
      models,
      region: deps.bedrockRegion ?? null,
      primaryProvider: primary,
      replyPath:
        primary === "openrouter"
          ? ("openrouter-chat" as const)
          : primary === "openai"
            ? ("openai-chat" as const)
            : primary === "anthropic"
              ? ("anthropic-messages" as const)
              : primary === "xai"
                ? ("xai-chat" as const)
                : ("bedrock-converse" as const),
    };
  });

  app.get("/v1/connectors/catalog", async () => ({ items: deps.connectors.catalog() }));
  app.get("/v1/connectors", async () => ({ items: await deps.connectors.list() }));
  app.post<{ Body: ConnectConnectorRequest }>("/v1/connectors", async (request) =>
    deps.connectors.connect(request.body ?? { provider: "github", token: "" }),
  );
  app.post("/v1/connectors/gmail/oauth/start", async () => deps.connectors.startGmailOAuth());
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/v1/connectors/gmail/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeGmailOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "gmail",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });
  app.post("/v1/connectors/github/oauth/start", async () => deps.connectors.startGithubOAuth());
  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
      installation_id?: string;
      setup_action?: string;
    };
  }>("/v1/connectors/github/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeGithubOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
      errorDescription: request.query.error_description,
      installationId: request.query.installation_id,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "github",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });
  app.post("/v1/connectors/outlook/oauth/start", async () => deps.connectors.startOutlookOAuth());
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/v1/connectors/outlook/oauth/callback", async (request, reply) => {
    const result = await deps.connectors.completeOutlookOAuth({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error_description || request.query.error,
    });
    return reply.type("text/html").send(
      oauthDesktopBridgeHtml({
        provider: "outlook",
        nextUrl: result.redirectUrl,
        ok: !result.redirectUrl.includes("error"),
      }),
    );
  });
  for (const provider of [
    "gitlab",
    "bitbucket",
    "linear",
    "slack",
    "notion",
    "whoop",
    "fitbit",
    "google_drive",
    "google_calendar",
    "figma",
  ] as const) {
    app.post(`/v1/connectors/${provider}/oauth/start`, async () =>
      deps.connectors.startGenericOAuth(provider),
    );
    app.get<{
      Querystring: { code?: string; state?: string; error?: string; error_description?: string };
    }>(`/v1/connectors/${provider}/oauth/callback`, async (request, reply) => {
      const result = await deps.connectors.completeGenericOAuth(provider, {
        code: request.query.code,
        state: request.query.state,
        error: request.query.error,
        errorDescription: request.query.error_description,
      });
      return reply.type("text/html").send(
        oauthDesktopBridgeHtml({
          provider,
          nextUrl: result.redirectUrl,
          ok: !result.redirectUrl.includes("error"),
        }),
      );
    });
  }
  app.post<{ Params: { id: string } }>("/v1/connectors/:id/verify", async (request) =>
    deps.connectors.verify(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    "/v1/connectors/:id/resources",
    async (request) => ({
      items: await deps.connectors.resources(request.params.id, request.query.q),
    }),
  );
  app.post<{ Params: { id: string }; Body: { command?: string } }>(
    "/v1/connectors/:id/ssh/exec",
    async (request) =>
      deps.connectors.execSsh(request.params.id, { command: request.body?.command ?? "" }),
  );
  app.delete<{ Params: { id: string } }>("/v1/connectors/:id", async (request) =>
    deps.connectors.disconnect(request.params.id),
  );

  app.get<{
    Params: { id: string };
    Querystring: { mailbox?: string; limit?: string };
  }>("/v1/connectors/:id/email/messages", async (request) => {
    const limit = Number(request.query.limit || "30");
    return deps.connectors.listEmailMessages(
      request.params.id,
      request.query.mailbox || "INBOX",
      Number.isFinite(limit) ? limit : 30,
    );
  });
  app.get<{
    Params: { id: string; uid: string };
    Querystring: { mailbox?: string };
  }>("/v1/connectors/:id/email/messages/:uid", async (request) =>
    deps.connectors.readEmail(request.params.id, request.params.uid, request.query.mailbox || "INBOX"),
  );
  app.post<{ Params: { id: string }; Body: SendEmailRequest }>(
    "/v1/connectors/:id/email/send",
    async (request) =>
      deps.connectors.sendEmail(request.params.id, request.body ?? { to: "", subject: "", text: "" }),
  );
  app.post<{ Params: { id: string }; Body: ArrangeEmailRequest }>(
    "/v1/connectors/:id/email/arrange",
    async (request) =>
      deps.connectors.arrangeEmail(request.params.id, request.body ?? { action: "archive", messageIds: [] }),
  );

  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/v1/connectors/whatsapp/webhook", async (request, reply) => {
    const challenge = deps.connectors.verifyWhatsAppWebhookChallenge(request.query);
    return reply.type("text/plain").send(challenge);
  });

  app.post("/v1/connectors/whatsapp/webhook", async (request) => {
    const rawBody =
      typeof (request as unknown as { rawBody?: string }).rawBody === "string"
        ? (request as unknown as { rawBody: string }).rawBody
        : JSON.stringify(request.body ?? {});
    const signature =
      typeof request.headers["x-hub-signature-256"] === "string"
        ? request.headers["x-hub-signature-256"]
        : undefined;
    return deps.connectors.handleWhatsAppWebhook({
      rawBody,
      signatureHeader: signature,
      payload: request.body,
    });
  });

  app.post("/v1/connectors/finnhub/webhook", async (request) => {
    const secret =
      typeof request.headers["x-finnhub-secret"] === "string"
        ? request.headers["x-finnhub-secret"]
        : undefined;
    return deps.connectors.handleFinnhubWebhook({
      secretHeader: secret,
      payload: request.body,
    });
  });

  app.post<{ Params: { id: string }; Body: SendWhatsAppRequest }>(
    "/v1/connectors/:id/whatsapp/send",
    async (request) =>
      deps.connectors.sendWhatsApp(request.params.id, request.body ?? { to: "", text: "" }),
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/v1/connectors/:id/whatsapp/messages", async (request) => {
    const limit = Number(request.query.limit || "40");
    return deps.connectors.listWhatsAppMessages(
      request.params.id,
      Number.isFinite(limit) ? limit : 40,
    );
  });

  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string };
  }>("/v1/github/repos/:owner/:repo", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubRepoMeta(
      connectorId,
      request.params.owner,
      request.params.repo,
    );
  });
  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { connectorId: string; ref?: string };
  }>("/v1/github/repos/:owner/:repo/tree", async (request) => {
    const connectorId = request.query.connectorId;
    if (!connectorId) {
      throw new ValidationError("connectorId is required");
    }
    return deps.connectors.githubTree(
      connectorId,
      request.params.owner,
      request.params.repo,
      request.query.ref,
    );
  });
  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCommitRequest;
  }>("/v1/github/repos/:owner/:repo/commits", async (request) =>
    deps.connectors.githubCommit(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", message: "", files: [] },
    ),
  );
  app.post<{
    Params: { owner: string; repo: string };
    Body: GithubCreatePullRequest;
  }>("/v1/github/repos/:owner/:repo/pulls", async (request) =>
    deps.connectors.githubPullRequest(
      request.params.owner,
      request.params.repo,
      request.body ?? { connectorId: "", title: "", head: "" },
    ),
  );
}
