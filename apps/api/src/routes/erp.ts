import { timingSafeEqual } from "node:crypto";
import { ForbiddenError, UnauthorizedError } from "@arrab/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountService } from "../services/account-service.js";
import { ErpCompanionService } from "../services/erp-companion-service.js";

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
    accounts: AccountService;
    erpToken: string | undefined;
    erpTokenScopes: string[];
  },
): void {
  const scopes = new Set(deps.erpTokenScopes);
  const erpAuth = (request: FastifyRequest): { read: boolean; write: boolean } | null => {
    const expected = deps.erpToken?.trim();
    const presented = bearer(request);
    if (!expected || !presented || !sameToken(presented, expected)) return null;
    return {
      read: scopes.has("companions:read"),
      write: scopes.has("companions:write"),
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
}
