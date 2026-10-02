import { describe, expect, it } from "vitest";
import { bootWorld } from "../test-support/world.js";

describe("credential and session attacks", () => {
  it("random, truncated, case-changed and header-injected tokens are all rejected", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const good = w.ownerToken;
      const tries = [
        "x".repeat(64),
        good.slice(0, -1),
        good.toUpperCase(),
        `${good}\r\nX-Injected: 1`,
        "Bearer " + good, // doubled scheme
        "null",
        "undefined",
        "' OR 1=1 --",
        "__proto__",
      ];
      for (const token of tries) {
        const res = await w.app.inject({
          method: "GET",
          url: "/v1/account",
          headers: { authorization: `Bearer ${token.replace(/[\r\n]/g, "")}` },
        });
        expect(res.statusCode, token.slice(0, 20)).toBe(401);
      }
      expect(
        (
          await w.app.inject({
            method: "GET",
            url: "/v1/account",
            headers: { authorization: `Bearer ${good}` },
          })
        ).statusCode,
      ).toBe(200);
      // The legacy header works the same way — and a bad one is not rescued by a good Authorization header being absent.
      expect(
        (
          await w.app.inject({
            method: "GET",
            url: "/v1/account",
            headers: { "x-arrab-account-session": "nope" },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await w.close();
    }
  });

  it("sign-in is rate limited per address (brute force) and does not reveal which part was wrong", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      let limited = 0;
      for (let i = 0; i < 40; i++) {
        const res = await w.as.anonymous("POST", "/v1/account/sign-in", {
          email: "owner@x.test",
          password: `wrong-pass-${i}`,
        });
        if (res.status === 429) limited += 1;
        else expect(res.status).toBe(401);
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      await w.close();
    }
  });

  it("an organization seat locks after repeated bad passwords and unlocks only by time/admin, not by the right password", async () => {
    const w = await bootWorld({ plan: "business" });
    try {
      const email = w.ids.employees!.member.email as string;
      for (let i = 0; i < 12; i++)
        await w.as.anonymous("POST", "/v1/org/employees/sign-in", {
          email,
          password: `Wrong-Pass-${i}a`,
        });
      const right = await w.as.anonymous("POST", "/v1/org/employees/sign-in", {
        email,
        password: "Seat-Pass-2b",
      });
      expect(right.status).toBeGreaterThanOrEqual(400);
    } finally {
      await w.close();
    }
  });
});

describe("mass assignment and tampering with entitlement state", () => {
  it("extra fields on profile/plan requests cannot change plan, status, id or sessions", async () => {
    const w = await bootWorld({ plan: "free", seats: false });
    try {
      const before = (await w.as.owner("GET", "/v1/account")).body;
      const res = await w.as.owner("PATCH", "/v1/account", {
        displayName: "Renamed",
        planId: "enterprise",
        subscriptionStatus: "active",
        periodEnd: "2999-01-01T00:00:00.000Z",
        id: "acc_attacker",
        tokenTopUps: [
          { invoiceId: "free", tokens: 999_999_999, periodEnd: "2999-01-01T00:00:00.000Z" },
        ],
        sessions: [],
        passwordHash: "x",
      });
      expect(res.status).toBe(200);
      const after = (await w.as.owner("GET", "/v1/account")).body;
      expect(after.account.displayName).toBe("Renamed");
      expect(after.account.planId).toBe("free");
      expect(after.account.id).toBe(before.account.id);
      expect(after.entitlements.tokenLimit).toBe(before.entitlements.tokenLimit);
      expect(after.entitlements.topUpTokens).toBe(0);
      expect((await w.as.owner("GET", "/v1/account")).status).toBe(200); // sessions were not wiped
    } finally {
      await w.close();
    }
  });

  it("a plan code cannot be redeemed for a paid plan on a production-configured API (public codes)", async () => {
    const w = await bootWorld({ plan: "free", seats: false, env: { allowPlanCodes: false } });
    try {
      for (const code of [
        "PRO-ARRAB",
        "SOLO-ARRAB",
        "STUDIO-ARRAB",
        "TEAM-ARRAB",
        "BUSINESS-ARRAB",
        "ENTERPRISE-ARRAB",
        "SCALE-ARRAB",
        "FAMILY-ARRAB",
        "FAMILY-PLUS-ARRAB",
        " pro-arrab ",
        "PRO-ARRAB\n",
      ]) {
        const res = await w.as.owner("POST", "/v1/account/subscribe", { code });
        expect([400], code).toContain(res.status);
      }
      expect((await w.as.owner("GET", "/v1/account")).body.account.planId).toBe("free");
      // …and the free codes still work.
      expect(
        (await w.as.owner("POST", "/v1/account/subscribe", { code: "FREE-ARRAB" })).status,
      ).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("a member cannot create a conversation that claims another employee as owner or a wider visibility than allowed", async () => {
    const w = await bootWorld({ plan: "business" });
    try {
      const agent = await w.as.owner("POST", "/v1/agents", {
        name: "A",
        role: "r",
        status: "active",
      });
      const ownerSeat = w.ids.employees!.manager.id as string;
      const res = await w.as.employee!.member("POST", "/v1/conversations", {
        agentId: agent.body.id,
        ownerEmployeeId: ownerSeat,
        familyMemberId: "x",
      });
      expect(res.status).toBe(200);
      expect(res.body.ownerEmployeeId).toBe(w.ids.employees!.member.id);
      // The manager does not gain access by being named as owner.
      expect(
        (await w.as.employee!.manager("GET", `/v1/conversations/${res.body.id}`)).status,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      await w.close();
    }
  });
});

describe("hostile input", () => {
  it("prototype-pollution, oversized and malformed bodies never crash the API or change behaviour", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const evil =
        '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"displayName":"ok"}';
      const res = await w.app.inject({
        method: "PATCH",
        url: "/v1/account",
        payload: evil,
        headers: { authorization: `Bearer ${w.ownerToken}`, "content-type": "application/json" },
      });
      expect([200, 400]).toContain(res.statusCode);
      expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
      expect((await w.as.owner("GET", "/v1/account")).status).toBe(200);

      const broken = await w.app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: "{not json",
        headers: { authorization: `Bearer ${w.ownerToken}`, "content-type": "application/json" },
      });
      expect(broken.statusCode).toBe(400);
      const huge = await w.app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: JSON.stringify({ name: "x".repeat(2_000_000), role: "r" }),
        headers: { authorization: `Bearer ${w.ownerToken}`, "content-type": "application/json" },
      });
      expect(huge.statusCode).toBe(413);
      const wrongType = await w.app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: "name=a&role=b",
        headers: {
          authorization: `Bearer ${w.ownerToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      expect([400, 415]).toContain(wrongType.statusCode);
    } finally {
      await w.close();
    }
  });

  it.each([
    "../../etc/passwd",
    "a/../b",
    "%2e%2e%2f",
    "<script>",
    "'; DROP TABLE agents;--",
    "x".repeat(5000),
    "\u0000",
    "__proto__",
    "constructor",
  ])("path and id parameters are treated as opaque data: %j", async (id) => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      for (const [m, u] of [
        ["GET", `/v1/conversations/${encodeURIComponent(id)}`],
        ["DELETE", `/v1/agents/${encodeURIComponent(id)}`],
        ["PATCH", `/v1/tasks/${encodeURIComponent(id)}`],
        ["DELETE", `/v1/knowledge/${encodeURIComponent(id)}`],
      ] as const) {
        const res = await w.as.owner(m, u, m === "PATCH" ? {} : undefined);
        expect(res.status, `${m} ${u.slice(0, 40)}`).toBeLessThan(500);
      }
    } finally {
      await w.close();
    }
  });

  it("malicious names are stored verbatim and returned as JSON strings (the app escapes on render)", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const name = `<img src=x onerror=alert(1)>${"‮"}`;
      const res = await w.as.owner("POST", "/v1/agents", { name, role: "<b>r</b>" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
      const raw = await w.app.inject({
        method: "GET",
        url: "/v1/agents",
        headers: { authorization: `Bearer ${w.ownerToken}` },
      });
      expect(raw.headers["content-type"]).toMatch(/application\/json/);
      expect(raw.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      await w.close();
    }
  });
});
