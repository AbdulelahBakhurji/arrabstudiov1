import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PLANS } from "@arrab/shared";
import { bootWorld, startChat } from "../../test-support/world.js";

describe("limit + N under concurrency", () => {
  it("parallel requests cannot overshoot the allowance by racing the quota check", async () => {
    const w = await bootWorld({ plan: "free", seats: false });
    try {
      const chat = await startChat(w.as.owner);
      const limit = SUBSCRIPTION_PLANS.free.monthlyTokenLimit;
      // Room for only a couple of ordinary replies.
      await w.spendTokens(limit - 6_000);
      w.provider.behavior = {
        kind: "reply",
        usage: { inputTokens: 500, outputTokens: 1_500 },
        delayMs: 60,
      }; // a real provider takes time: that is the race window
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => chat.send(`parallel ${i}`)),
      );
      const admitted = results.filter((r) => r.status === 200).length;
      const refused = results.filter((r) => r.status === 402 || r.status === 429).length;
      expect(admitted + refused).toBe(12);
      expect(admitted).toBeGreaterThanOrEqual(1);
      expect(admitted).toBeLessThanOrEqual(3); // 6,000 left, 2,000 per reply
      const used = (await w.as.owner("GET", "/v1/account")).body.entitlements.tokensUsed as number;
      expect(used).toBeLessThanOrEqual(limit + 2_000); // at most one reply of slack, never 12
      expect(w.provider.calls.length).toBe(admitted);
    } finally {
      await w.close();
    }
  });

  it("a rejected request releases nothing it did not take, and reservations are returned after replies", async () => {
    const w = await bootWorld({ plan: "free", seats: false });
    try {
      const chat = await startChat(w.as.owner);
      w.provider.behavior = { kind: "reply", usage: { inputTokens: 5, outputTokens: 5 } };
      for (let i = 0; i < 30; i++) expect((await chat.send(`seq ${i}`)).status).toBe(200); // sequential traffic is never throttled
      w.provider.behavior = { kind: "error", status: 503 };
      for (let i = 0; i < 30; i++) await chat.send(`fail ${i}`);
      w.provider.behavior = { kind: "reply" };
      expect((await chat.send("still works")).status).toBe(200); // failures did not leak reservations
    } finally {
      await w.close();
    }
  });
});
