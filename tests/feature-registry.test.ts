import { describe, expect, it } from "vitest";
import { navForRole } from "../apps/desktop/src/domains/account/roles/catalog.ts";
import { RESERVED_FEATURE_PATHS } from "../apps/desktop/src/features/types.ts";
import { STUDIO_FEATURES, pageFeaturesFor } from "../apps/desktop/src/features/registry.ts";

describe("feature registry", () => {
  it("keeps plug-in pages out of the core nav", () => {
    expect(STUDIO_FEATURES.map((f) => f.id)).toEqual(["companion-desk"]);
    expect(pageFeaturesFor("individual").every((f) => f.nav === false)).toBe(true);
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
