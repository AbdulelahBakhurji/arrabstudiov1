import { describe, expect, it } from "vitest";
import { navForRole } from "../apps/desktop/src/domains/account/roles/catalog.ts";
import { RESERVED_FEATURE_PATHS } from "../apps/desktop/src/features/types.ts";
import { STUDIO_FEATURES, pageFeaturesFor } from "../apps/desktop/src/features/registry.ts";

describe("feature registry", () => {
  it("starts with no plug-in pages so core nav stays stable", () => {
    expect(STUDIO_FEATURES).toEqual([]);
    expect(pageFeaturesFor("individual")).toEqual([]);
    expect(navForRole("individual").map((item) => item.path)).toEqual([
      "",
      "/studio",
      "/board",
      "/brain",
      "/work",
      "/me",
      "/settings",
    ]);
  });

  it("reserves core destinations so new features cannot collide", () => {
    expect(RESERVED_FEATURE_PATHS.has("chat")).toBe(true);
    expect(RESERVED_FEATURE_PATHS.has("settings")).toBe(true);
    expect(RESERVED_FEATURE_PATHS.has("workforce")).toBe(true);
  });
});
