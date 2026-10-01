import { timingSafeEqual } from "node:crypto";
import { ForbiddenError, UnauthorizedError } from "@arrab/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountService } from "../services/account-service.js";
import { ErpCompanionService } from "../services/erp-companion-service.js";
import { ControlNotificationService, ControlDeskService } from "../services/control-notification-service.js";
import type { ControlNotificationComposer } from "../services/control-notification-composer.js";

function bearer(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function limitFromQuery(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : 500;
  if (!Number.isFinite(raw)) return 500;
  return Math.min(500, Math.max(1, Math.floor(raw)));
}

export function registerErpRoutes(
  app: FastifyInstance,
  deps: {
    companions: ErpCompanionService;
    notifications: ControlNotificationService;
    composer: ControlNotificationComposer;
    desk: ControlDeskService;
    accounts: AccountService;
    erpToken: string | undefined;
    erpTokenScopes: string[];
  },
): void {
  const scopes = new Set(deps.erpTokenScopes);
  const erpAuth = (
    request: FastifyRequest,
  ): { read: boolean; write: boolean; notify: boolean; connectors: boolean } | null => {
    const expected = deps.erpToken?.trim();
    const presented = bearer(request);
    if (!expected || !presented || !sameToken(presented, expected)) return null;
    return {
      read: scopes.has("companions:read"),
      write: scopes.has("companions:write"),
      notify: scopes.has("notifications:write"),
      connectors: scopes.has("connectors:write"),
    };
  };

  app.get("/erp/companions", async (request) => {
    const auth = erpAuth(request);
    if (auth && !auth.read) {
      throw new ForbiddenError("ERP token is missing companions:read");
    }
    if (!auth) {
      if (!request.account && (await deps.accounts.hasAccount())) {
        throw new UnauthorizedError("Sign in required to read companions");
      }
    }
    const query = request.query as { limit?: string };
    const items = await deps.companions.list({
      limit: limitFromQuery(query.limit),
      publishedOnly: !auth,
    });
    return { items };
  });

  app.post("/erp/companions", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.write) throw new ForbiddenError("ERP token is missing companions:write");
    return deps.companions.create(request.body);
  });

  app.patch("/erp/companions/:id", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.write) throw new ForbiddenError("ERP token is missing companions:write");
    const { id } = request.params as { id: string };
    return deps.companions.replace(id, request.body);
  });

  app.delete("/erp/companions/:id", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.write) throw new ForbiddenError("ERP token is missing companions:write");
    const { id } = request.params as { id: string };
    return deps.companions.remove(id);
  });

  app.post("/erp/notifications", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.notify) throw new ForbiddenError("ERP token is missing notifications:write");
    return deps.notifications.create(request.body);
  });

  /**
   * AI drafts a bilingual notification from a short brief. Returns the draft for
   * review; with `send: true` it is published straight away.
   */
  app.post("/erp/notifications/compose", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.notify) throw new ForbiddenError("ERP token is missing notifications:write");
    const { draft, audience } = await deps.composer.compose(request.body);
    const send = (request.body as { send?: unknown } | null)?.send === true;
    if (!send) return { draft, audience, notification: null };
    const { rationale: _rationale, ...fields } = draft;
    const notification = await deps.notifications.create({ ...fields, ...audience, source: "ai" });
    return { draft, audience, notification };
  });

  app.delete("/erp/notifications/:id", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.notify) throw new ForbiddenError("ERP token is missing notifications:write");
    const { id } = request.params as { id: string };
    return deps.notifications.retract(id);
  });

  app.get("/erp/notifications", async (request) => {
    const auth = erpAuth(request);
    if (!auth) {
      if (!request.account && (await deps.accounts.hasAccount())) {
        throw new UnauthorizedError("Sign in required to read notifications");
      }
    }
    const query = request.query as { limit?: string };
    if (auth) await deps.notifications.flushAcks();
    const items = await deps.notifications.listRecent(limitFromQuery(query.limit), {
      includeInactive: Boolean(auth),
    });
    return { items, ai: auth ? deps.composer.available : undefined };
  });

  app.get("/erp/maintenance", async (request) => {
    const auth = erpAuth(request);
    if (!auth) {
      if (!request.account && (await deps.accounts.hasAccount())) {
        throw new UnauthorizedError("Sign in required");
      }
    }
    return deps.desk.getPolicy();
  });

  app.post("/erp/maintenance", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.notify) throw new ForbiddenError("ERP token is missing notifications:write");
    return deps.desk.setPolicy(request.body);
  });

  app.post("/erp/maintenance/clients", async (request) => {
    const auth = erpAuth(request);
    if (!auth) {
      if (!request.account && (await deps.accounts.hasAccount())) {
        throw new UnauthorizedError("Sign in required");
      }
    }
    return deps.desk.checkIn(request.body);
  });

  app.get("/erp/maintenance/clients", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.notify && !auth.read) {
      throw new ForbiddenError("ERP token cannot list clients");
    }
    return deps.desk.listClients();
  });

  app.get("/erp/connectors", async (request) => {
    const auth = erpAuth(request);
    if (!auth) {
      if (!request.account && (await deps.accounts.hasAccount())) {
        throw new UnauthorizedError("Sign in required");
      }
    }
    return deps.desk.listConnectors();
  });

  app.put("/erp/connectors/:provider", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.connectors) throw new ForbiddenError("ERP token is missing connectors:write");
    const { provider } = request.params as { provider: string };
    return deps.desk.setConnector(provider, request.body);
  });

  app.delete("/erp/connectors/:provider", async (request) => {
    const auth = erpAuth(request);
    if (!auth) throw new UnauthorizedError("ERP token required");
    if (!auth.connectors) throw new ForbiddenError("ERP token is missing connectors:write");
    const { provider } = request.params as { provider: string };
    return deps.desk.resetConnector(provider);
  });
}
