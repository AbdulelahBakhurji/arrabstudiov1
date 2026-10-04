import { describe, expect, it } from "vitest";
import { computeTapHashstring, halalasToMajor, majorToHalalas } from "./tap.js";

describe("tap helpers", () => {
  it("converts SAR halalas to major units and back", () => {
    expect(halalasToMajor(4900, "SAR")).toBe(49);
    expect(majorToHalalas(49, "SAR")).toBe(4900);
    expect(majorToHalalas(49.5, "SAR")).toBe(4950);
  });

  it("builds a stable webhook hashstring", () => {
    const hash = computeTapHashstring("sk_test_secret", {
      id: "chg_1",
      amount: 49,
      currency: "SAR",
      status: "CAPTURED",
      reference: { gateway: "gw", payment: "pay" },
      transactionCreated: "1700000000000",
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      computeTapHashstring("sk_test_secret", {
        id: "chg_1",
        amount: 49,
        currency: "SAR",
        status: "CAPTURED",
        reference: { gateway: "gw", payment: "pay" },
        transactionCreated: "1700000000000",
      }),
    ).toBe(hash);
  });
});
