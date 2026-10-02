/**
 * Client ↔ server parity: what the app *shows* each role/plan must equal what the API *enforces*.
 * (The UI is a courtesy; these tests make sure the two never drift apart silently.)
 */
import { describe, expect, it } from "vitest";
import {
  ALL_PLAN_IDS,
  SUBSCRIPTION_PLANS,
  entitlementsForPlan,
  type OrgEmployeeRecord,
} from "@arrab/shared";
import { OrgWorkforceService } from "../../apps/api/src/modules/organization/org-workforce-service";
import { resolveOrgSeatCapabilities } from "@/domains/organization/org-seat";
import {
  audienceFromPlanId,
  navForRole,
  orgSeatCanOpen,
  studioModeFromPlanId,
} from "@/domains/account/roles/catalog";

const seat = (role: "admin" | "manager" | "member") =>
  ({
    id: `emp_${role}`,
    role,
    status: "active",
    email: `${role}@x.test`,
  }) as unknown as OrgEmployeeRecord;
const serverPerms = (employee: OrgEmployeeRecord | null) =>
  OrgWorkforceService.prototype.permissionsFor.call(
    {} as OrgWorkforceService,
    employee,
    employee === null,
  );
const clientCaps = (role: "admin" | "manager" | "member" | null) =>
  resolveOrgSeatCapabilities(role ? ({ ...seat(role), id: role } as never) : null);

describe("organization seat capabilities: the app and the API agree", () => {
  for (const role of ["admin", "manager", "member", null] as const) {
    it(`${role ?? "owner"}`, () => {
      const server = serverPerms(role ? seat(role) : null);
      const client = clientCaps(role);
      expect(client.canAdminister, "canAdminister").toBe(server.canAdminister);
      expect(client.canAssignWork, "canAssignWork").toBe(server.canAssignWork);
      expect(client.canHireAgents, "canHireAgents").toBe(server.canHireAgents);
    });
  }

  it("no seat role can ever administer; only the owner can", () => {
    for (const role of ["admin", "manager", "member"] as const) {
      expect(serverPerms(seat(role)).canAdminister, role).toBe(false);
      expect(serverPerms(seat(role)).canViewAudit, role).toBe(false);
    }
    expect(serverPerms(null).canAdminister).toBe(true);
  });

  it("an unauthenticated caller has no capability at all", () => {
    const none = OrgWorkforceService.prototype.permissionsFor.call(
      {} as OrgWorkforceService,
      null,
      false,
    );
    expect(Object.values(none).every((v) => v === false)).toBe(true);
  });
});

describe("plan → audience → shell is consistent for every plan", () => {
  it.each(ALL_PLAN_IDS)("%s", (plan) => {
    const audience = SUBSCRIPTION_PLANS[plan].audience;
    expect(audienceFromPlanId(plan)).toBe(audience);
    expect(studioModeFromPlanId(plan)).toBe(
      audience === "organization" ? "organization" : "individual",
    );
    expect(entitlementsForPlan(plan).orgWorkforce).toBe(audience === "organization");
  });

  it("unknown or tampered plan ids fall back to the individual shell, never to organization or family", () => {
    for (const id of ["ultra", "enterprise-plus", "", null, undefined, "__proto__", "ADMIN"]) {
      expect(audienceFromPlanId(id as never), String(id)).toBe("individual");
    }
  });
});

describe("navigation per audience and seat role", () => {
  const keys = (
    audience: "individual" | "family" | "organization",
    opts?: Parameters<typeof navForRole>[1],
  ) => navForRole(audience, opts).map((n) => n.key);

  it("individual and family never see workforce or activity", () => {
    for (const audience of ["individual", "family"] as const) {
      expect(keys(audience)).not.toContain("workforce");
      expect(keys(audience)).not.toContain("hq");
    }
  });

  it("only the organization shell has workforce; members lose it and activity, managers lose workforce", () => {
    expect(keys("organization")).toContain("workforce");
    expect(keys("organization", { orgSeatRole: "member" })).not.toContain("workforce");
    expect(keys("organization", { orgSeatRole: "member" })).not.toContain("activity");
    expect(keys("organization", { orgSeatRole: "manager" })).not.toContain("workforce");
    expect(keys("organization", { orgSeatRole: "manager" })).toContain("activity");
  });

  it("every nav item a member sees is one the server lets a member use", () => {
    for (const key of ["hq", "workplace", "chat", "brainNav", "connectors", "settings"])
      expect(orgSeatCanOpen("member", key), key).toBe(true);
    for (const key of ["workforce", "activity"])
      expect(orgSeatCanOpen("member", key), key).toBe(false);
  });
});
