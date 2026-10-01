import { UnauthorizedError } from "@arrab/core";
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

  const helpers: RouteHelpers = { assertCap, clientIp };
  registerWorkspaceRoutes(app, deps, helpers);
  registerAccountsRoutes(app, deps, helpers);
  registerBillingRoutes(app, deps, helpers);
  registerDeskRoutes(app, deps);
  registerOrganizationRoutes(app, deps, helpers);
  registerFamilyRoutes(app, deps);
  registerConversationsRoutes(app, deps);
  registerConnectorsRoutes(app, deps);
  registerEncryptionRoutes(app, deps);
}
