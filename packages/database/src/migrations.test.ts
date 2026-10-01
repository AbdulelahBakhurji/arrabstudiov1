import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations.js";

describe("migrations registry", () => {
  it("has unique ids in ascending order", () => {
    const ids = MIGRATIONS.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
