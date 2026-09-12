import { describe, expect, it } from "vitest";
import { healthContractPath } from "@arrab/shared";

describe("monorepo smoke", () => {
  it("exposes the shared health contract path", () => {
    expect(healthContractPath).toBe("/health");
  });
});
