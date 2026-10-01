import { describe, expect, it } from "vitest";
import { resolvePlanAudience } from "../packages/shared/src/account.ts";
import {
  audienceFromAccountSignals,
  audienceFromPlanId,
  homePathForAudience,
  navForRole,
  studioModeFromAudience,
} from "../apps/desktop/src/app/roles/catalog.ts";

describe("plan → studio shell", () => {
  it("maps Team, Business, and Enterprise to the organization shell", () => {
    expect(audienceFromPlanId("team")).toBe("organization");
    expect(audienceFromPlanId("business")).toBe("organization");
    expect(audienceFromPlanId("enterprise")).toBe("organization");
    expect(audienceFromPlanId("unlimited")).toBe("organization");
    expect(homePathForAudience("organization")).toBe("/organizations");
  });

  it("maps planCategory teams to organization even when planId looks free", () => {
    expect(
      audienceFromAccountSignals({
        planId: "free",
        planCategory: "teams",
        planName: "Platform Admin",
      }),
    ).toBe("organization");
    expect(
      resolvePlanAudience({
        planId: "business",
        planCategory: "teams",
        planName: "Business",
      }),
    ).toBe("organization");
  });

  it("keeps Free/Pro/Solo on the individuals shell", () => {
    expect(audienceFromPlanId("free")).toBe("individual");
    expect(audienceFromPlanId("pro")).toBe("individual");
    expect(audienceFromPlanId("solo")).toBe("individual");
    expect(studioModeFromAudience("individual")).toBe("individual");
  });

  it("exposes Workforce on organization nav and not on individual", () => {
    expect(navForRole("organization").some((item) => item.key === "workforce")).toBe(true);
    expect(navForRole("individual").some((item) => item.key === "workforce")).toBe(false);
  });
});
