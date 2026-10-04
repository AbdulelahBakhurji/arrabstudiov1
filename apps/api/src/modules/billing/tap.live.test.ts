import { describe, expect, it } from "vitest";
import { HttpTapClient, isTapChargePaid } from "./tap.js";

/**
 * Live Tap sandbox smoke. Skips unless TAP_SECRET_KEY (sk_test_…) is set in the environment.
 * Creates an INITIATED hosted charge and re-fetches it — does not complete card payment.
 */
const secret = process.env.TAP_SECRET_KEY?.trim();

describe.skipIf(!secret || !secret.startsWith("sk_test_"))("Tap sandbox (live)", () => {
  it("creates a hosted charge and can re-fetch it", async () => {
    const client = new HttpTapClient(secret!);
    const charge = await client.createCharge({
      amountHalalas: 100, // 1.00 SAR
      currency: "SAR",
      description: "Arrab Studio Tap live smoke (pro)",
      postUrl: "https://example.com/v1/billing/tap/callback",
      redirectUrl: "https://example.com/app?paid=1",
      customer: { email: "tap-smoke@arrab.studio", firstName: "Arrab" },
      metadata: {
        planId: "pro",
        accountId: "acc_tap_smoke",
        email: "tap-smoke@arrab.studio",
      },
    });

    expect(charge.id).toMatch(/^chg_/);
    expect(charge.status.toUpperCase()).toBe("INITIATED");
    expect(charge.url).toMatch(/tap\.company|payments\.tap/i);
    expect(charge.amountHalalas).toBe(100);
    expect(isTapChargePaid(charge.status)).toBe(false);

    const again = await client.getCharge(charge.id);
    expect(again.id).toBe(charge.id);
    expect(again.metadata?.accountId).toBe("acc_tap_smoke");
  }, 30_000);
});
