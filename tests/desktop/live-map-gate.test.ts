import { describe, expect, it } from "vitest";
import { ALL_PLAN_IDS, entitlementsForPlan } from "@arrab/shared";
import { LIVE_MAP_PRODUCTION_READY, canShowLiveMap } from "@/domains/organization/live-map-gate";

describe("Live Map availability", () => {
  it("a shipped build never offers a tab that cannot work", () => {
    expect(LIVE_MAP_PRODUCTION_READY).toBe(false);
    for (const planId of ALL_PLAN_IDS) {
      expect(canShowLiveMap({ seatAllows: true, planId, development: false }), planId).toBe(false);
    }
  });

  it("in development only Business and Enterprise get it", () => {
    for (const planId of ALL_PLAN_IDS) {
      expect(canShowLiveMap({ seatAllows: true, planId, development: true }), planId).toBe(
        entitlementsForPlan(planId).liveMap,
      );
    }
  });

  it("a seat role that may not open it never does, whatever the plan", () => {
    for (const planId of ["business", "enterprise"]) {
      expect(canShowLiveMap({ seatAllows: false, planId, development: true })).toBe(false);
    }
  });

  it("an unknown or tampered plan id gets nothing", () => {
    for (const planId of ["ultra", "ENTERPRISE", "__proto__", "", "business ", null, undefined]) {
      expect(
        canShowLiveMap({ seatAllows: true, planId: planId as never, development: false }),
        String(planId),
      ).toBe(false);
    }
  });
});
