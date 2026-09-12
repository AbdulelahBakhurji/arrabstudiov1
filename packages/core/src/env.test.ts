import { describe, expect, it } from "vitest";
import { parsePort, ValidationError } from "./index.js";

describe("parsePort", () => {
  it("accepts a valid port", () => {
    expect(parsePort("8787", "ARRAB_API_PORT")).toBe(8787);
  });

  it("rejects an invalid port", () => {
    expect(() => parsePort("0", "ARRAB_API_PORT")).toThrow(ValidationError);
  });
});
