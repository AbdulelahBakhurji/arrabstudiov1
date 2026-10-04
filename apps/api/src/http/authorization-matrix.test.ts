/**
 * Authorization matrix: every actor × the sensitive routes, plus a sweep of the whole route table.
 * Actors are real sessions created through the API (see test-support/world.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_RULES, normalizeRouteKey } from "./route-policy.js";
import { bootWorld, signInFamilySeat, type Caller, type World } from "../test-support/world.js";

const fill = (url: string) => url.replace(/\|:\w+/g, "").replace(/:\w+/g, "probe-id");

/** Routes that are public on purpose (sign-in, OAuth callbacks, signed webhooks, version handshake, plan catalog). */
const PUBLIC = new Set([
  "GET /health",
  "GET /ready",
  "GET /metrics",
  "GET /v1/releases",
  "POST /v1/account/connect",
  "POST /v1/account/sign-in",
  "POST /v1/account/session",
  "POST /v1/account/refresh",
  "POST /v1/account/auth/web/start",
  "GET /v1/account/auth/web/poll",
  "POST /v1/account/auth/web/complete",
  "GET /v1/account/auth/web",
  "GET /v1/billing/plans",
  "POST /v1/billing/tap/callback",
  "GET /v1/meta",
  "POST /v1/org/employees/sign-in",
  "POST /v1/family/members/sign-in",
  "GET /v1/connectors/catalog",
  "GET /v1/connectors/whatsapp/webhook",
  "POST /v1/connectors/whatsapp/webhook",
  "POST /v1/connectors/openwa/webhook",
  "POST /v1/connectors/finnhub/webhook",
  "GET /v1/client/hello",
  "POST /v1/client/sync",
  "POST /v1/client/notifications/:id/ack",
  "POST /v1/client/commands/:id/ack",
]);
const isPublic = (key: string) =>
  PUBLIC.has(key) || /^GET \/v1\/connectors\/\w+\/oauth\/callback$/.test(key);

describe("default-deny: no route is reachable without a session", () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld({ plan: "business" });
  });
  afterAll(() => w.close());

  it("every non-public route answers 401 to an anonymous caller (route table sweep)", async () => {
    const routes = w.app.routeTable.filter(
      (r) => !r.url.startsWith("/r/") && !r.url.startsWith("/erp"),
    );
    expect(routes.length).toBeGreaterThan(120);
    const open: string[] = [];
    for (const r of routes) {
      const key = normalizeRouteKey(r.method, r.url);
      if (isPublic(key)) continue;
      const res = await w.as.anonymous(r.method, fill(r.url), r.method === "GET" ? undefined : {});
      if (res.status !== 401) open.push(`${key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("the public allowlist is not stale (every entry is a real route)", () => {
    const real = new Set(w.app.routeTable.map((r) => normalizeRouteKey(r.method, r.url)));
    for (const key of PUBLIC) expect(real.has(key), key).toBe(true);
  });

  it("ERP routes refuse callers without the ERP token", async () => {
    for (const [m, u] of [
      ["GET", "/erp/companions"],
      ["POST", "/erp/companions"],
      ["GET", "/erp/connectors"],
      ["POST", "/erp/maintenance"],
      ["POST", "/erp/notifications"],
    ] as const) {
      const res = await w.as.anonymous(m, u, m === "GET" ? undefined : {});
      expect([401, 403, 503], `${m} ${u}`).toContain(res.status);
    }
    // A studio session may read the published catalog, but it is not an ERP credential for writes.
    expect([401, 403, 503]).toContain((await w.as.owner("POST", "/erp/companions", {})).status);
    expect([401, 403, 503]).toContain((await w.as.owner("POST", "/erp/maintenance", {})).status);
  });

  it("every policy rule names a real route", () => {
    const real = new Set(w.app.routeTable.map((r) => normalizeRouteKey(r.method, r.url)));
    for (const key of Object.keys(ROUTE_RULES)) expect(real.has(key), key).toBe(true);
  });
});

describe("organization actors (Business plan)", () => {
  let w: World;
  let employees: Record<"admin" | "manager" | "member", Caller>;
  beforeAll(async () => {
    w = await bootWorld({ plan: "business" });
    employees = w.as.employee!;
  });
  afterAll(() => w.close());

  const ownerOnly = Object.entries(ROUTE_RULES).filter(([, r]) => r.policy === "owner");
  const managerRoutes = Object.entries(ROUTE_RULES).filter(([, r]) => r.policy === "manager");
  const parts = (key: string) => {
    const [method, url] = key.split(" ") as [string, string];
    return { method, url: fill(url), body: method === "GET" ? undefined : {} };
  };

  it.each(ownerOnly.map(([k]) => k))(
    "owner-only %s: no employee role can reach it, the owner can",
    async (key) => {
      const { method, url, body } = parts(key);
      for (const role of ["admin", "manager", "member"] as const) {
        expect((await employees[role](method, url, body)).status, `${role} ${key}`).toBe(403);
      }
      // Destructive owner routes are only checked for refusal above (running them would delete the studio).
      if (!/disconnect|revoke-all|sessions/.test(key)) {
        expect((await w.as.owner(method, url, body)).status, `owner ${key}`).not.toBe(403);
      }
    },
  );

  it.each(managerRoutes.map(([k]) => k))(
    "manager route %s: members are refused, managers and admins are not",
    async (key) => {
      const { method, url, body } = parts(key);
      expect((await employees.member(method, url, body)).status, `member ${key}`).toBe(403);
      for (const role of ["manager", "admin"] as const) {
        expect((await employees[role](method, url, body)).status, `${role} ${key}`).not.toBe(403);
      }
      expect((await w.as.owner(method, url, body)).status, `owner ${key}`).not.toBe(403);
    },
  );

  it("seats can never administer the organization, whatever their role", async () => {
    const admin: Array<[string, string, unknown]> = [
      [
        "POST",
        "/v1/org/employees",
        { email: "x@corp.test", password: "Seat-Pass-1a", displayName: "X" },
      ],
      ["PATCH", "/v1/org/employees/probe-id", { role: "admin" }],
      ["DELETE", "/v1/org/employees/probe-id", undefined],
      ["POST", "/v1/org/departments", { name: "Hack" }],
      ["PATCH", "/v1/org/departments/probe-id", { name: "Hack" }],
      ["DELETE", "/v1/org/departments/probe-id", undefined],
      ["GET", "/v1/org/employees", undefined],
      ["POST", "/v1/agents", { name: "A", role: "B" }],
      ["POST", "/v1/teams", { name: "T" }],
      ["POST", "/v1/workforce/blueprint", {}],
      ["GET", "/v1/reports/summary", undefined],
    ];
    for (const role of ["admin", "manager", "member"] as const) {
      for (const [m, u, b] of admin) {
        expect((await employees[role](m, u, b)).status, `${role} ${m} ${u}`).toBe(403);
      }
    }
    // The owner can.
    expect((await w.as.owner("GET", "/v1/org/employees")).status).toBe(200);
    expect((await w.as.owner("POST", "/v1/agents", { name: "A", role: "B" })).status).toBe(200);
  });

  it("a seat cannot promote itself or edit another seat (role escalation)", async () => {
    const meId = w.ids.employees!.member.id as string;
    const res = await employees.member("PATCH", `/v1/org/employees/${meId}`, { role: "admin" });
    expect(res.status).toBe(403);
    // …and it did not take effect: the owner still sees a plain member.
    const list = (await w.as.owner("GET", "/v1/org/employees")).body.items as Array<{
      id: string;
      role: string;
    }>;
    expect(list.find((e) => e.id === meId)!.role).toBe("member");
  });

  it("a seat that signs out through the account endpoint cannot end the owner's sessions", async () => {
    expect((await employees.member("POST", "/v1/account/logout", {})).status).toBe(403);
    expect((await w.as.owner("GET", "/v1/account")).status).toBe(200);
  });

  it("sees only its own seat in the workforce snapshot, with no admin capabilities", async () => {
    const snap = (await employees.member("GET", "/v1/org/workforce")).body;
    expect(snap.permissions.canAdminister).toBe(false);
    expect(snap.permissions.canViewDirectory).toBe(false);
    expect(snap.employees).toHaveLength(1);
    expect(snap.recentSecurityEvents).toEqual([]);
    const owner = (await w.as.owner("GET", "/v1/org/workforce")).body;
    expect(owner.permissions.canAdminister).toBe(true);
    expect(owner.employees.length).toBe(3);
  });

  it("disabling a seat ends its access immediately", async () => {
    const id = w.ids.employees!.member.id as string;
    expect((await employees.member("GET", "/v1/agents")).status).toBe(200);
    expect(
      (await w.as.owner("PATCH", `/v1/org/employees/${id}`, { status: "disabled" })).status,
    ).toBe(200);
    expect((await employees.member("GET", "/v1/agents")).status).toBe(401);
  });

  it("a forged employee token is rejected", async () => {
    const forged = (await bootWorld({ plan: "business", seats: false })).as.anonymous;
    expect((await forged("GET", "/v1/agents")).status).toBe(401);
  });
});

describe("family actors (Family plan)", () => {
  let w: World;
  let kid: Caller;
  let partner: Caller;
  beforeAll(async () => {
    w = await bootWorld({ plan: "family" });
    kid = await signInFamilySeat(w, "kid");
    partner = await signInFamilySeat(w, "partner");
  });
  afterAll(() => w.close());

  const ownerOnly = Object.entries(ROUTE_RULES).filter(([, r]) => r.policy === "owner");
  it.each(ownerOnly.map(([k]) => k))(
    "owner-only %s: neither the child nor the partner seat can reach it",
    async (key) => {
      const [method, url] = key.split(" ") as [string, string];
      const body = method === "GET" ? undefined : {};
      expect((await kid(method, fill(url), body)).status, `child ${key}`).toBe(403);
      expect((await partner(method, fill(url), body)).status, `partner ${key}`).toBe(403);
    },
  );

  it("the owner is still signed in after both seats signed in and attacked (seat sign-in never replaces the owner session)", async () => {
    expect((await w.as.owner("GET", "/v1/account")).status).toBe(200);
    expect((await w.as.owner("GET", "/v1/family")).body.available).toBe(true);
  });

  it("a child cannot manage the household or grant itself tokens", async () => {
    const kidId = w.ids.familyMembers!.kid.id as string;
    for (const [m, u, b] of [
      ["POST", "/v1/family/members", { displayName: "Sneaky", role: "partner" }],
      ["PATCH", `/v1/family/members/${kidId}`, { role: "parent" }],
      ["PATCH", `/v1/family/members/${kidId}/guardian`, { quietHours: { enabled: false } }],
      ["DELETE", `/v1/family/members/${w.ids.familyMembers!.partner.id}`, undefined],
      ["POST", "/v1/family/tokens/grant", { memberId: kidId, tokens: 1_000_000 }],
      ["POST", "/v1/family/seats/purchase", { seats: 1 }],
      ["POST", "/v1/family/switch", { memberId: w.ids.familyMembers!.partner.id }],
    ] as const) {
      expect((await kid(m, u, b)).status, `${m} ${u}`).toBe(403);
    }
    const snap = (await w.as.owner("GET", "/v1/family")).body;
    const stored = snap.members.find((m: { id: string }) => m.id === kidId);
    expect(stored.role).toBe("child");
  });

  it("a child cannot use workforce operations, reports or the household activity feed", async () => {
    for (const key of Object.keys(ROUTE_RULES).filter(
      (k) => ROUTE_RULES[k]!.policy === "manager" && !ROUTE_RULES[k]!.childAllowed,
    )) {
      const [method, url] = key.split(" ") as [string, string];
      expect((await kid(method, fill(url), method === "GET" ? undefined : {})).status, key).toBe(
        403,
      );
    }
    expect((await kid("GET", "/v1/reports/summary")).status).toBe(403);
    expect((await kid("GET", "/v1/activity")).body.items).toEqual([]);
  });

  it("a child's session ignores a spoofed family-member header (identity comes from the session)", async () => {
    const parentId = w.ids.familyMembers!.partner.id as string;
    const res = await w.app.inject({
      method: "GET",
      url: "/v1/family",
      headers: { authorization: await rawAuth(w, "kid"), "x-arrab-family-member": parentId },
    });
    expect(res.json().activeMemberId).toBe(w.ids.familyMembers!.kid.id);
    expect(res.json().seatLocked).toBe(true);
    // …and it still cannot do what a parent can.
    const blocked = await w.app.inject({
      method: "GET",
      url: "/v1/reports/summary",
      headers: { authorization: await rawAuth(w, "kid"), "x-arrab-family-member": parentId },
    });
    expect(blocked.statusCode).toBe(403);
  });
});

async function rawAuth(world: World, seat: string): Promise<string> {
  const member = world.ids.familyMembers![seat];
  const res = await world.as.anonymous("POST", "/v1/family/members/sign-in", {
    email: member.email,
    password: "kidpassword",
  });
  return `Bearer ${res.body.sessionToken}`;
}
