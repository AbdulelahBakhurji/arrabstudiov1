import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_REDEEM_CODES, orgSeatLimitForPlan } from "./account.js";
import { ALL_PLAN_IDS, entitlementsForPlan, isDowngrade, isKnownPlanId } from "./entitlements.js";

describe("plan catalog integrity", () => {
  it("every plan has entitlements and consistent audience features", () => {
    expect(ALL_PLAN_IDS.length).toBe(11);
    for (const id of ALL_PLAN_IDS) {
      const e = entitlementsForPlan(id);
      expect(e.audience, id).toBe(SUBSCRIPTION_PLANS[id].audience);
      expect(e.orgWorkforce, id).toBe(e.audience === "organization");
      expect(e.familyHousehold, id).toBe(e.audience === "family");
      expect(e.monthlyTokens, id).toBeGreaterThan(0);
    }
  });

  it("only organization plans include org seats, only family plans household seats", () => {
    for (const id of ALL_PLAN_IDS) {
      const e = entitlementsForPlan(id);
      if (e.audience === "individual") expect(e.seats, id).toBe(0);
      else expect(e.seats, id).toBeGreaterThan(0);
    }
  });

  it("no plan caps agents yet (documented product decision — see entitlements.ts)", () => {
    for (const id of ALL_PLAN_IDS) expect(entitlementsForPlan(id).maxAgents, id).toBeNull();
  });

  it("the live map is a Business/Enterprise feature only", () => {
    expect(ALL_PLAN_IDS.filter((id) => entitlementsForPlan(id).liveMap).sort()).toEqual([
      "business",
      "enterprise",
    ]);
  });

  it("paid tiers never give a smaller pool than the tier below them in the same audience", () => {
    const order: Record<string, string[]> = {
      individual: ["free", "pro", "solo", "studio"],
      family: ["family_free", "family", "family_plus"],
      organization: ["team", "business", "enterprise"],
    };
    for (const [audience, ids] of Object.entries(order)) {
      const sorted = [...ids].sort(
        (a, b) =>
          SUBSCRIPTION_PLANS[a as never].monthlyPriceHalalas -
          SUBSCRIPTION_PLANS[b as never].monthlyPriceHalalas,
      );
      for (let i = 1; i < sorted.length; i++) {
        const lower = SUBSCRIPTION_PLANS[sorted[i - 1] as never];
        const higher = SUBSCRIPTION_PLANS[sorted[i] as never];
        expect(
          higher.monthlyTokenLimit,
          `${audience}: ${higher.id} vs ${lower.id}`,
        ).toBeGreaterThanOrEqual(lower.monthlyTokenLimit);
      }
    }
  });

  it("every redeem code maps to a real plan", () => {
    for (const [code, id] of Object.entries(SUBSCRIPTION_REDEEM_CODES))
      expect(isKnownPlanId(id), code).toBe(true);
  });

  it("org seat limit is the plan's seat count for organization plans only", () => {
    expect(orgSeatLimitForPlan("team")).toBe(10);
    expect(orgSeatLimitForPlan("business")).toBe(25);
    expect(orgSeatLimitForPlan("enterprise")).toBe(100);
  });

  it("detects downgrades by price", () => {
    expect(isDowngrade("studio", "solo")).toBe(true);
    expect(isDowngrade("family_plus", "family")).toBe(true);
    expect(isDowngrade("enterprise", "business")).toBe(true);
    expect(isDowngrade("solo", "studio")).toBe(false);
    expect(isDowngrade("pro", "pro")).toBe(false);
  });

  it("rejects unknown ids", () => {
    for (const bad of ["", "ultra", "FREE", "__proto__", "constructor", null, undefined])
      expect(isKnownPlanId(bad as never), String(bad)).toBe(false);
  });
});
