import { describe, expect, it } from "vitest";
import { navForRole, orgSeatCanOpen } from "@/domains/account/roles/catalog";

const keys = (seatRole: "admin" | "manager" | "member" | null) =>
  navForRole("organization", { orgSeatRole: seatRole }).map((item) => item.key);

describe("organization nav by seat role", () => {
  it("gives the billing owner (no seat) every destination", () => {
    expect(keys(null)).toContain("workforce");
    expect(keys(null)).toContain("activity");
  });

  it("hides workforce from managers and members, activity from members", () => {
    expect(keys("manager")).not.toContain("workforce");
    expect(keys("manager")).toContain("activity");
    expect(keys("member")).not.toContain("workforce");
    expect(keys("member")).not.toContain("activity");
  });

  it("keeps chat and per-user connectors for every role", () => {
    for (const role of ["admin", "manager", "member"] as const) {
      expect(keys(role)).toContain("chat");
      expect(keys(role)).toContain("connectors");
    }
    expect(orgSeatCanOpen("member", "workforce")).toBe(false);
    expect(orgSeatCanOpen(null, "workforce")).toBe(true);
  });
});
