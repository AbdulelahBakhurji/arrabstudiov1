import { ForbiddenError, UnauthorizedError } from "@arrab/core";
import { ruleFor } from "./route-policy.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OrgWorkforceService } from "../modules/organization/org-workforce-service.js";
import { registerWorkspaceRoutes } from "../modules/workspace/workspace.routes.js";
import { registerAccountsRoutes } from "../modules/accounts/accounts.routes.js";
import { registerBillingRoutes } from "../modules/billing/billing.routes.js";
import { registerDeskRoutes } from "../modules/desk/desk.routes.js";
import { registerOrganizationRoutes } from "../modules/organization/organization.routes.js";
import { registerFamilyRoutes } from "../modules/family/family.routes.js";
import { registerConversationsRoutes } from "../modules/conversations/conversations.routes.js";
import { registerConnectorsRoutes } from "../modules/connectors/connectors.routes.js";
import { registerSyncRoutes } from "../modules/sync/sync.routes.js";
import { registerEncryptionRoutes } from "../modules/encryption/encryption.routes.js";
import type { RouteHelpers, V1Deps } from "./deps.js";

export function registerV1Routes(app: FastifyInstance, deps: V1Deps): void {
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

    // Connectors live on the signed-in account. Catalog / OAuth callbacks stay public.
    const path = request.url.split("?")[0] ?? "";
    const connectorRoute = path === "/v1/connectors" || path.startsWith("/v1/connectors/");
    const publicConnector =
      path === "/v1/connectors/catalog" ||
      path.includes("/oauth/callback") ||
      path.includes("/webhook");
    if (
      connectorRoute &&
      !publicConnector &&
      !request.account &&
      !request.orgEmployee &&
      !(request.method === "GET" && path === "/v1/connectors")
    ) {
      throw new UnauthorizedError("Sign in to connect a tool");
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

  // `request.ip` already honours the configured `trustProxy` hop count. Reading X-Forwarded-For
  // directly would let any client write its own address into audit / security logs.
  function clientIp(request: { ip?: string; headers: Record<string, unknown> }): string | null {
    return request.ip ?? null;
  }

  app.get("/v1/org/workforce", async (request) =>
    deps.orgWorkforce.snapshot(request.orgEmployee),
  );

  /**
   * Account-level actions (plan, billing, deleting the account, other devices' sessions) belong to the
   * account owner's own session. A family seat (child/partner login) or an organization employee holds
   * a *scoped* session and must never reach them, whatever their in-app role.
   */
  const assertOwnerSession = (request: FastifyRequest, detail: string) => {
    if (request.orgEmployee || request.seatMemberId) throw new ForbiddenError(detail);
  };

  // Central policy table (see route-policy.ts): who may call which account/workforce route.
  app.addHook("preHandler", async (request) => {
    const rule = ruleFor(request.method, request.routeOptions.url ?? "");
    if (!rule) return;
    if (rule.policy === "owner") {
      assertOwnerSession(request, rule.detail);
      return;
    }
    if (request.orgEmployee) {
      if (!deps.orgWorkforce.permissionsFor(request.orgEmployee).canAssignWork) throw new ForbiddenError(rule.detail);
      return;
    }
    if (!rule.childAllowed && request.seatMemberId && (await deps.familyHousehold.isActiveChildSeat())) {
      throw new ForbiddenError(rule.detail);
    }
  });

  const helpers: RouteHelpers = { assertCap, assertOwnerSession, clientIp };
  registerWorkspaceRoutes(app, deps, helpers);
  registerAccountsRoutes(app, deps, helpers);
  registerBillingRoutes(app, deps, helpers);
  registerDeskRoutes(app, deps);
  registerOrganizationRoutes(app, deps, helpers);
  registerFamilyRoutes(app, deps);
  registerConversationsRoutes(app, deps);
  registerConnectorsRoutes(app, deps);
  registerEncryptionRoutes(app, deps);
  registerSyncRoutes(app, deps);
}
