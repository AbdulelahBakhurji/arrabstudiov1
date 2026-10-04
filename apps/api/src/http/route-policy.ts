/**
 * Central, auditable authorization policy for routes whose access depends on *who* the session is
 * (account owner, organization seat, family seat) rather than on a plan feature.
 *
 *  - `owner`   — account-level: plan, billing, deleting the account, other devices' sessions.
 *                Only the owner's own session. Org seats and family seats never.
 *  - `manager` — workforce operations: org seats need `canAssignWork` (manager/admin role);
 *                child family seats are refused unless `childAllowed`.
 *
 * Everything not listed here is governed by the service it calls (and the default-deny session guard).
 * `route-policy.test.ts` asserts this table against the real route list so nothing drifts.
 */
export type RoutePolicy = "owner" | "manager";

export interface RouteRule {
  policy: RoutePolicy;
  detail: string;
  /** Child family seats may still use this (e.g. read-only feeds that already return empty for them). */
  childAllowed?: boolean;
}

const OWNER = "This action belongs to the account owner";
const MANAGER = "This action needs a manager or the account owner";

export const ROUTE_RULES: Record<string, RouteRule> = {
  // account level
  "PATCH /v1/account": { policy: "owner", detail: OWNER },
  "POST /v1/account/subscribe": { policy: "owner", detail: OWNER },
  "POST /v1/account/password": { policy: "owner", detail: OWNER },
  "POST /v1/account/disconnect": { policy: "owner", detail: OWNER },
  "GET /v1/account/sessions": { policy: "owner", detail: OWNER },
  "DELETE /v1/account/sessions/:id": { policy: "owner", detail: OWNER },
  "POST /v1/account/sessions/revoke-all": { policy: "owner", detail: OWNER },
  "POST /v1/billing/checkout": { policy: "owner", detail: OWNER },
  "POST /v1/billing/top-up": { policy: "owner", detail: OWNER },
  "GET /v1/billing/confirm": { policy: "owner", detail: OWNER },
  "PUT /v1/operator": { policy: "owner", detail: OWNER },
  // workforce operations
  "PATCH /v1/desk": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/schedules": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/schedules/:id/pause": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/schedules/:id/remove": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/kill": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/jobs": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/jobs/:id/approve": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/jobs/:id/follow-up": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/jobs/:id/stop": { policy: "manager", detail: MANAGER },
  "POST /v1/desk/jobs/:id/revise": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/boundaries": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/boundaries/:id/remove": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/actions": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/activity": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/control": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/responsibilities": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/responsibilities/:id/remove": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/skill-grants": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/reachability": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/reachability/:id/remove": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/plugins": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/status": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/ideas": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/watches": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/watches/observe": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/finance/import": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/goals": { policy: "manager", detail: MANAGER },
  "POST /v1/professional/stay": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/rules": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/members/:id": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/watches": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/watches/:id/pause": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/watches/:id/remove": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/watches/:id/write": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/passes": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/passes/:id/close": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/briefing": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/focus": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/packs/:id": { policy: "manager", detail: MANAGER },
  "POST /v1/crew/refit": { policy: "manager", detail: MANAGER },
  "POST /v1/task-runs/:id/cancel": { policy: "manager", detail: MANAGER },
  "POST /v1/teams/:id/run": { policy: "manager", detail: MANAGER },
  "POST /v1/team-runs/:id/cancel": { policy: "manager", detail: MANAGER },
  // the activity feed is a manager view (the app hides it from members); children already get an empty feed
  "GET /v1/activity": { policy: "manager", detail: MANAGER, childAllowed: true },
};

/** Remove the deployment's route prefix (`/r/<id>`) so a mounted copy matches the same rule. */
export function normalizeRouteKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url.replace(/^\/r\/[^/]+/, "")}`;
}

export function ruleFor(method: string, url: string): RouteRule | null {
  return ROUTE_RULES[normalizeRouteKey(method, url)] ?? null;
}
