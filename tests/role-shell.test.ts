import { describe, expect, it } from "vitest";
import { resolvePlanAudience } from "../packages/shared/src/account.ts";
import {
  audienceFromAccountSignals,
  audienceFromPlanId,
  homePathForAudience,
  navForRole,
  studioModeFromAudience,
} from "../apps/desktop/src/domains/account/roles/catalog.ts";

describe("plan → studio shell", () => {
  it("maps Team, Business, and Enterprise to the organization shell", () => {
    expect(audienceFromPlanId("team")).toBe("organization");
    expect(audienceFromPlanId("business")).toBe("organization");
    expect(audienceFromPlanId("enterprise")).toBe("organization");
    expect(audienceFromPlanId("unlimited")).toBe("organization");
    expect(homePathForAudience("organization")).toBe("/organizations");
  });

  it("lets known catalog plan ids win over a stale planCategory", () => {
    // Studio / Solo must stay individual even if control-plane category says teams.
    expect(
      audienceFromAccountSignals({
        planId: "studio",
        planCategory: "teams",
        planName: "Studio",
      }),
    ).toBe("individual");
    expect(
      audienceFromAccountSignals({
        planId: "free",
        planCategory: "teams",
        planName: "Platform Admin",
      }),
    ).toBe("individual");
    expect(
      resolvePlanAudience({
        planId: "business",
        planCategory: "individuals",
        planName: "Business",
      }),
    ).toBe("organization");
  });

  it("uses planCategory only when planId is unknown", () => {
    expect(
      resolvePlanAudience({
        planId: "custom-control-plane",
        planCategory: "teams",
        planName: "Platform Admin",
      }),
    ).toBe("organization");
  });

  it("keeps Free/Pro/Solo/Studio on the individuals shell", () => {
    expect(audienceFromPlanId("free")).toBe("individual");
    expect(audienceFromPlanId("pro")).toBe("individual");
    expect(audienceFromPlanId("solo")).toBe("individual");
    expect(audienceFromPlanId("studio")).toBe("individual");
    expect(studioModeFromAudience("individual")).toBe("individual");
  });

  it("maps live API 0.14 plan aliases (starter/max) to the individuals shell", () => {
    expect(audienceFromPlanId("starter")).toBe("individual");
    expect(audienceFromPlanId("max")).toBe("individual");
    expect(resolvePlanAudience({ planId: "family-plus" })).toBe("family");
  });

  it("exposes Workforce on organization nav and not on individual", () => {
    expect(navForRole("organization").some((item) => item.key === "workforce")).toBe(true);
    expect(navForRole("individual").some((item) => item.key === "workforce")).toBe(false);
  });
});
