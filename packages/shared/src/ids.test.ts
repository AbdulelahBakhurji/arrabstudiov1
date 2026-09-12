import { describe, expect, it } from "vitest";
import { brandId, type ProjectId } from "./ids.js";

describe("brandId", () => {
  it("accepts a non-empty value", () => {
    const id = brandId<ProjectId>("prj_1");
    expect(id).toBe("prj_1");
  });

  it("rejects an empty value", () => {
    expect(() => brandId<ProjectId>("  ")).toThrow(/non-empty/);
  });
});
