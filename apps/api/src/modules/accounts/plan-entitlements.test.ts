import { describe, expect, it } from "vitest";
import { ALL_PLAN_IDS, entitlementsForPlan } from "@arrab/shared";
import { bootWorld, PLAN_CODE, type World } from "../../test-support/world.js";

const agent = (n: number) => ({ name: `Agent ${n}`, role: "Analyst" });
const emp = (n: number, role = "member") => ({
  email: `seat${n}@corp.test`,
  password: "Seat-Pass-1a",
  displayName: `Seat ${n}`,
  role,
});

async function withWorld<T>(
  plan: string,
  seats: boolean,
  run: (w: World) => Promise<T>,
): Promise<T> {
  const world = await bootWorld({ plan, seats });
  try {
    return await run(world);
  } finally {
    await world.close();
  }
}

describe("every plan resolves to the entitlements the catalog promises", () => {
  it.each(ALL_PLAN_IDS)("%s", async (plan) => {
    await withWorld(plan, false, async (w) => {
      const status = (await w.as.owner("GET", "/v1/account")).body;
      expect(status.account.planId).toBe(plan);
      const e = entitlementsForPlan(plan);
      expect(status.entitlements.tokenLimit).toBe(e.monthlyTokens);
      expect(status.entitlements.tokensRemaining).toBe(e.monthlyTokens);
      expect(status.entitlements.overLimit).toBe(false);
      expect(status.entitlements.pauseMode).toBeNull();
    });
  });
});

describe("AI employee cap mechanism (off by default, see entitlements.ts)", () => {
  it("plans do not cap agents today: Free can still create several companions' backing agents", async () => {
    await withWorld("free", false, async (w) => {
      for (let i = 1; i <= 5; i++)
        expect((await w.as.owner("POST", "/v1/agents", agent(i))).status).toBe(200);
    });
  });

  it("when a cap is configured it is exact, and archive/restore cannot sidestep it", async () => {
    await withWorld("free", false, async (w) => {
      w.context.commands.setAgentLimit(async () => 1);
      const first = await w.as.owner("POST", "/v1/agents", agent(1));
      expect(first.status).toBe(200);
      const second = await w.as.owner("POST", "/v1/agents", agent(2));
      expect(second.status).toBe(403);
      expect(second.body.error.code).toBe("PLAN_LIMIT");
      await w.as.owner("POST", `/v1/agents/${first.body.id}/archive`, {});
      expect((await w.as.owner("POST", "/v1/agents", agent(3))).status).toBe(200);
      const restore = await w.as.owner("PATCH", `/v1/agents/${first.body.id}`, { status: "draft" });
      expect(restore.status).toBe(403);
      expect(restore.body.error.code).toBe("PLAN_LIMIT");
      // Idempotent re-creation of an existing client key is not a new employee.
      w.context.commands.setAgentLimit(async () => 2);
      const keyed = await w.as.owner("POST", "/v1/agents", {
        ...agent(9),
        clientKey: "companion:c1:work",
      });
      const again = await w.as.owner("POST", "/v1/agents", {
        ...agent(9),
        clientKey: "companion:c1:work",
      });
      expect(keyed.status).toBe(200);
      expect(again.body.id).toBe(keyed.body.id);
    });
  });
});

describe("organization seats are an organization-plan feature", () => {
  it.each(ALL_PLAN_IDS.filter((p) => entitlementsForPlan(p).audience !== "organization"))(
    "%s: cannot provision employee seats or departments",
    async (plan) => {
      await withWorld(plan, false, async (w) => {
        const seat = await w.as.owner("POST", "/v1/org/employees", emp(1));
        expect(seat.status, `${plan} seat`).toBe(403);
        const dept = await w.as.owner("POST", "/v1/org/departments", { name: "Sales" });
        expect(dept.status, `${plan} department`).toBe(403);
      });
    },
  );

  it.each(["team", "business", "enterprise", "unlimited"])(
    "%s: seat limit is exact (limit ok, limit+1 refused)",
    async (plan) => {
      await withWorld(plan, false, async (w) => {
        const limit = entitlementsForPlan(plan as never).seats;
        // Filling a 250-seat plan is slow (scrypt); verify the boundary on the small plans and the limit value on the rest.
        expect((await w.as.owner("GET", "/v1/org/workforce")).body.seatLimit).toBe(limit);
        if (limit > 25) return;
        for (let i = 1; i <= limit; i++) {
          const res = await w.as.owner("POST", "/v1/org/employees", emp(i));
          expect(res.status, `${plan} seat ${i}/${limit}: ${JSON.stringify(res.body)}`).toBe(200);
          // Seat 1 of each 8 departmentless... no department → no per-office cap applies.
        }
        const over = await w.as.owner("POST", "/v1/org/employees", emp(limit + 1));
        expect(over.status).toBe(400);
        expect(over.body.error.message).toMatch(/seats/i);
      });
    },
  );

  it("downgrade Business → Pro: seat sessions stop working at once and no new seat can be added", async () => {
    await withWorld("business", true, async (w) => {
      const before = await w.as.employee!.member("GET", "/v1/agents");
      expect(before.status).toBe(200);
      await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE.pro });
      expect((await w.as.employee!.member("GET", "/v1/agents")).status).toBe(401);
      expect((await w.as.owner("POST", "/v1/org/employees", emp(99))).status).toBe(403);
      // The owner's own view is unaffected.
      expect((await w.as.owner("GET", "/v1/agents")).status).toBe(200);
    });
  });
});

describe("household seats are a family-plan feature", () => {
  it.each(ALL_PLAN_IDS.filter((p) => entitlementsForPlan(p).audience !== "family"))(
    "%s: no household",
    async (plan) => {
      await withWorld(plan, false, async (w) => {
        const snap = (await w.as.owner("GET", "/v1/family")).body;
        expect(snap.available).toBe(false);
        expect(
          (await w.as.owner("POST", "/v1/family/members", { displayName: "X", role: "partner" }))
            .status,
        ).toBe(403);
      });
    },
  );

  it.each(["family_free", "family", "family_plus"])(
    "%s: household size limit is exact",
    async (plan) => {
      await withWorld(plan, false, async (w) => {
        const limit = entitlementsForPlan(plan as never).seats;
        expect((await w.as.owner("GET", "/v1/family")).body.seatLimit).toBe(limit);
        // The owner already holds one seat.
        for (let i = 1; i < limit; i++) {
          const res = await w.as.owner("POST", "/v1/family/members", {
            displayName: `P${i}`,
            role: "partner",
          });
          expect(res.status, `${plan} member ${i}: ${JSON.stringify(res.body)}`).toBe(200);
        }
        const over = await w.as.owner("POST", "/v1/family/members", {
          displayName: "Extra",
          role: "partner",
        });
        expect(over.status).toBeGreaterThanOrEqual(400);
        expect((await w.as.owner("GET", "/v1/family")).body.members).toHaveLength(limit);
      });
    },
  );
});
