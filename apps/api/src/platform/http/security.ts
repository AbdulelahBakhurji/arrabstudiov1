import { runWithRequestActor } from "../context/request-actor.js";
import { UnauthorizedError, AppError, TokenExpiredError, type AuthPrincipal } from "@arrab/core";
import type { OrgEmployeeRecord, StudioAccountRecord } from "@arrab/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountService } from "../../modules/accounts/account-service.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthPrincipal;
    orgEmployee: OrgEmployeeRecord | null;
    /** Resolved studio account from Authorization / X-Arrab-Account-Session. */
    account: StudioAccountRecord | null;
    /** The device session the request's token belongs to. */
    sessionId: string | null;
    /** Family seat this session is bound to (null = owner session). */
    seatMemberId: string | null;
  }
}

type RateBucket = { count: number; resetAt: number };

const AUTH_RATE_LIMIT = 30;
const AUTH_RATE_WINDOW_MS = 60_000;
/** Per-IP ceiling across the whole API (health excluded) — blunts scraping and request floods. */
const GLOBAL_RATE_LIMIT = 1200;
const MAX_BUCKETS = 20_000;

function pruneBuckets(buckets: Map<string, RateBucket>, now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
  // Still full of live entries (distributed flood): drop the oldest rather than grow without bound.
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/** Paths that must stay public (browser redirects, sign-in, health). */
const PUBLIC_PREFIXES = [
  "/health",
  // Operational endpoints authenticate themselves (readiness is harmless; metrics needs ARRAB_METRICS_TOKEN).
  "/ready",
  "/metrics",
  "/v1/account/connect",
  "/v1/account/sign-in",
  "/v1/account/auth/",
  "/v1/account/session",
  "/v1/account/refresh",
  "/v1/billing/plans",
  "/v1/billing/moyasar/callback",
  "/v1/billing/confirm",
  "/v1/releases",
  "/v1/connectors/catalog",
  "/v1/connectors/gmail/oauth/callback",
  "/v1/connectors/outlook/oauth/callback",
  "/v1/connectors/github/oauth/callback",
  "/v1/connectors/gitlab/oauth/callback",
  "/v1/connectors/bitbucket/oauth/callback",
  "/v1/connectors/linear/oauth/callback",
  "/v1/connectors/slack/oauth/callback",
  "/v1/connectors/notion/oauth/callback",
  "/v1/connectors/whoop/oauth/callback",
  "/v1/connectors/fitbit/oauth/callback",
  "/v1/connectors/google_drive/oauth/callback",
  "/v1/connectors/google_calendar/oauth/callback",
  "/v1/connectors/figma/oauth/callback",
  "/v1/connectors/whatsapp/webhook",
  // Finnhub pushes with a shared-secret header (verified in the handler), never a session.
  "/v1/connectors/finnhub/webhook",
  // OpenWA gateway callback — authenticated by its HMAC signature, not a studio session.
  "/v1/connectors/openwa/webhook",
  "/v1/org/employees/sign-in",
  "/v1/family/members/sign-in",
  // Managed-client sync must reach maintenance/update policy before sign-in; it gates notices itself.
  "/v1/client/",
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

function isPublicPath(url: string, routePrefix = ""): boolean {
  const path = stripRoutePrefix(url.split("?")[0] ?? url, routePrefix);
  // Segment-bounded: "/v1/account/session" must not also make "/v1/account/sessions" public.
  return PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

function stripRoutePrefix(path: string, routePrefix: string): string {
  if (!routePrefix) return path;
  if (path === routePrefix) return "/";
  if (path.startsWith(`${routePrefix}/`)) {
    return path.slice(routePrefix.length) || "/";
  }
  return path;
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
  // A real session whose short-lived access token ran out is "refresh", not "signed out":
  // the client must be able to tell the two apart.
  if ((await accounts.accessTokenState(extractAccountToken(request))) === "expired") throw new TokenExpiredError();
  throw new UnauthorizedError("Sign in required to use Arrab Studio");
}

export async function registerSecurity(
  app: FastifyInstance,
  accounts: AccountService,
  resolveOrgEmployee?: (token: string | null) => Promise<OrgEmployeeRecord | null>,
  routePrefix = "",
): Promise<void> {
  const buckets = new Map<string, RateBucket>();
  const prefix = routePrefix.replace(/\/$/, "");

  app.addHook("onRequest", async (request) => {
    request.principal = { type: "anonymous" };
    request.orgEmployee = null;
    request.account = null;
    request.sessionId = null;
    request.seatMemberId = null;

    const fullPath = request.url.split("?")[0] ?? request.url;
    const path = stripRoutePrefix(fullPath, prefix);
    if (path !== "/health") {
      const now = Date.now();
      pruneBuckets(buckets, now);
      const key = `global:${clientKey(request)}`;
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt < now) {
        buckets.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
      } else if (++bucket.count > GLOBAL_RATE_LIMIT) {
        throw new AppError("RATE_LIMITED", "Too many requests — slow down and retry shortly", 429, true);
      }
    }
    if (
      path.startsWith("/v1/account/auth/") ||
      path.startsWith("/v1/account/sign-in") ||
      path.startsWith("/v1/account/connect") ||
      path.startsWith("/v1/account/refresh") ||
      path.startsWith("/v1/org/employees/sign-in") ||
      path.startsWith("/v1/family/members/sign-in") ||
      path.includes("/oauth/start")
    ) {
      const key = `${clientKey(request)}:${path}`;
      const now = Date.now();
      pruneBuckets(buckets, now);
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
    const resolved = await accounts.resolveSession(token);
    const account = resolved?.account ?? null;
    if (resolved && account) {
      request.account = account;
      request.sessionId = resolved.sessionId;
      request.seatMemberId = resolved.seatMemberId;
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

    // Default-deny: once a studio account exists, every non-public /v1 route needs a session.
    // /erp/* authenticates itself (ERP token or published-catalog read) so unknown
    // paths still fall through to Fastify's "Route … not found".
    const bare = stripRoutePrefix(request.url.split("?")[0] ?? request.url, prefix);
    if (!isPublicPath(request.url, prefix) && !bare.startsWith("/erp/") && bare !== "/erp") {
      await requireStudioSession(request, accounts);
    }
  });

  // Callback-style so AsyncLocalStorage covers the route handler (async hooks can't guarantee it).
  app.addHook("preHandler", (request, _reply, done) => {
    runWithRequestActor(
      { employeeId: request.orgEmployee?.id ?? null, seatMemberId: request.seatMemberId },
      done,
    );
  });

  // Never echo secrets in structured logs.
  app.addHook("onSend", async (request, _reply, payload) => {
    if (typeof payload === "string" && /("accessToken"|"refreshToken"|"secret"|"password")\s*:/.test(payload)) {
      request.log.warn("Blocked response payload that looked like it contained secrets");
    }
    return payload;
  });
}
