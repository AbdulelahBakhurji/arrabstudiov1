import { UnauthorizedError, AppError, type AuthPrincipal } from "@arrab/core";
import type { OrgEmployeeRecord, StudioAccountRecord } from "@arrab/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountService } from "../services/account-service.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthPrincipal;
    orgEmployee: OrgEmployeeRecord | null;
    /** Resolved studio account from Authorization / X-Arrab-Account-Session. */
    account: StudioAccountRecord | null;
  }
}

type RateBucket = { count: number; resetAt: number };

const AUTH_RATE_LIMIT = 30;
const AUTH_RATE_WINDOW_MS = 60_000;

/** Paths that must stay public (browser redirects, sign-in, health). */
const PUBLIC_PREFIXES = [
  "/health",
  "/v1/account/connect",
  "/v1/account/sign-in",
  "/v1/account/auth/",
  "/v1/account/session",
  "/v1/billing/plans",
  "/v1/billing/moyasar/callback",
  "/v1/billing/confirm",
  "/v1/releases",
  "/v1/connectors/gmail/oauth/callback",
  "/v1/connectors/outlook/oauth/callback",
  "/v1/connectors/github/oauth/callback",
  "/v1/org/employees/sign-in",
] as const;

/** Sensitive surfaces that expose or mutate secrets / third-party tokens / org admin. */
const PROTECTED_PREFIXES = [
  "/v1/connectors",
  "/v1/github/",
  "/v1/org/",
] as const;

function extractAccountToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = request.headers["x-arrab-account-session"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}

function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function isProtectedPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (path === "/v1/connectors/catalog") return false;
  if (path.endsWith("/oauth/callback")) return false;
  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function clientKey(request: FastifyRequest): string {
  return request.ip || request.headers["x-forwarded-for"]?.toString() || "unknown";
}

/**
 * Require a valid studio session when the workspace has an account.
 * Empty local workspaces (tests / first boot) stay open until someone signs up.
 * Org employee sessions also satisfy the guard.
 */
export async function requireStudioSession(
  request: FastifyRequest,
  accounts: AccountService,
): Promise<void> {
  if (request.account) return;
  if (request.orgEmployee) return;
  if (!(await accounts.hasAccount())) return;
  throw new UnauthorizedError("Sign in required to use Arrab Studio");
}

export async function registerSecurity(
  app: FastifyInstance,
  accounts: AccountService,
  resolveOrgEmployee?: (token: string | null) => Promise<OrgEmployeeRecord | null>,
): Promise<void> {
  const buckets = new Map<string, RateBucket>();

  app.addHook("onRequest", async (request) => {
    request.principal = { type: "anonymous" };
    request.orgEmployee = null;
    request.account = null;

    const path = request.url.split("?")[0] ?? request.url;
    if (
      path.startsWith("/v1/account/auth/") ||
      path.startsWith("/v1/account/sign-in") ||
      path.startsWith("/v1/account/connect") ||
      path.startsWith("/v1/org/employees/sign-in") ||
      path.includes("/oauth/start")
    ) {
      const key = `${clientKey(request)}:${path}`;
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt < now) {
        buckets.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
      } else {
        bucket.count += 1;
        if (bucket.count > AUTH_RATE_LIMIT) {
          throw new AppError(
            "RATE_LIMITED",
            "Too many auth attempts — wait a minute and try again",
            429,
            true,
          );
        }
      }
    }

    const token = extractAccountToken(request);
    const account = await accounts.resolveSessionToken(token);
    if (account) {
      request.account = account;
      request.principal = {
        type: "user",
        userId: account.id,
        organizationId: account.workspaceId,
        workspaceId: account.workspaceId,
      };
    }

    const empHeader = request.headers["x-arrab-employee-session"];
    const empToken = Array.isArray(empHeader) ? empHeader[0] : empHeader;
    if (resolveOrgEmployee) {
      request.orgEmployee = await resolveOrgEmployee(empToken?.trim() || null);
    }

    if (isProtectedPath(request.url) && !isPublicPath(request.url)) {
      await requireStudioSession(request, accounts);
    }
  });

  // Never echo secrets in structured logs.
  app.addHook("onSend", async (request, _reply, payload) => {
    if (typeof payload === "string" && /("accessToken"|"refreshToken"|"secret"|"password")\s*:/.test(payload)) {
      request.log.warn("Blocked response payload that looked like it contained secrets");
    }
    return payload;
  });
}
