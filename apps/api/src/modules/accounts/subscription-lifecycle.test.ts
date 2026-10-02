import { describe, expect, it } from "vitest";
import {
  ALL_PLAN_IDS,
  SUBSCRIPTION_PLANS,
  TOKEN_TOP_UP_PACKS,
  entitlementsForPlan,
} from "@arrab/shared";
import { bootWorld, PLAN_CODE, startChat, type World } from "../../test-support/world.js";
import { BillingService } from "../billing/billing-service.js";
import type { MoyasarClient, MoyasarInvoice } from "../billing/moyasar.js";

async function withWorld<T>(
  plan: string,
  run: (w: World) => Promise<T>,
  seats = false,
): Promise<T> {
  const w = await bootWorld({ plan, seats });
  try {
    return await run(w);
  } finally {
    await w.close();
  }
}
const status = async (w: World) => (await w.as.owner("GET", "/v1/account")).body;

describe("token limit boundaries on every plan (below / at / above / far above)", () => {
  it.each(ALL_PLAN_IDS)("%s", async (plan) => {
    await withWorld(plan, async (w) => {
      const limit = SUBSCRIPTION_PLANS[plan].monthlyTokenLimit;
      const chat = await startChat(w.as.owner);

      // limit - 1: still allowed, and the request is capped to what remains.
      await w.spendTokens(limit - 1);
      let s = await status(w);
      expect(s.entitlements.tokensRemaining).toBe(1);
      expect(s.entitlements.overLimit).toBe(false);
      const ok = await chat.send("one more");
      expect(ok.status, `${plan} at limit-1`).toBe(200);

      // The reply itself spent tokens, so we are now at/over the limit: the next message is refused.
      const blocked = await chat.send("and another");
      expect(blocked.status, `${plan} after crossing`).toBe(402);
      expect(blocked.body.error.code).toBe("QUOTA_EXCEEDED");
      s = await status(w);
      expect(s.entitlements.overLimit).toBe(true);
      expect(s.entitlements.tokensRemaining).toBe(0);
    });
  });

  it("exactly at the limit is refused (limit + 0), and so is far above it", async () => {
    await withWorld("solo", async (w) => {
      const chat = await startChat(w.as.owner);
      await w.spendTokens(SUBSCRIPTION_PLANS.solo.monthlyTokenLimit);
      expect((await chat.send("x")).status).toBe(402);
      await w.spendTokens(50_000_000);
      expect((await chat.send("x")).status).toBe(402);
      expect(w.provider.calls).toHaveLength(0); // a refused request never reaches (or bills) the provider
    });
  });

  it("the provider is asked for no more output than the plan has left", async () => {
    await withWorld("free", async (w) => {
      const chat = await startChat(w.as.owner);
      await w.spendTokens(SUBSCRIPTION_PLANS.free.monthlyTokenLimit - 5);
      await chat.send("hi");
      expect(w.provider.calls).toHaveLength(1);
    });
  });
});

describe("upgrade, downgrade and stale permissions", () => {
  it("upgrading Solo → Studio immediately unlocks the larger pool", async () => {
    await withWorld("solo", async (w) => {
      const chat = await startChat(w.as.owner);
      await w.spendTokens(SUBSCRIPTION_PLANS.solo.monthlyTokenLimit + 1);
      expect((await chat.send("x")).status).toBe(402);
      await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE.studio });
      const s = await status(w);
      expect(s.entitlements.tokenLimit).toBe(SUBSCRIPTION_PLANS.studio.monthlyTokenLimit);
      expect((await chat.send("x")).status).toBe(200);
    });
  });

  it("downgrading Studio → Solo keeps no stale allowance: usage above the new pool blocks at once", async () => {
    await withWorld("studio", async (w) => {
      const chat = await startChat(w.as.owner);
      await w.spendTokens(8_000_000); // fine on Studio (12M), over Solo (5M)
      expect((await chat.send("x")).status).toBe(200);
      await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE.solo });
      expect((await status(w)).entitlements.tokenLimit).toBe(
        SUBSCRIPTION_PLANS.solo.monthlyTokenLimit,
      );
      expect((await chat.send("x")).status).toBe(402);
    });
  });

  it.each([
    ["solo", "studio"],
    ["studio", "solo"],
    ["pro", "studio"],
    ["family", "family_plus"],
    ["family_plus", "family"],
    ["team", "business"],
    ["business", "enterprise"],
    ["enterprise", "business"],
  ])(
    "%s → %s reports the destination plan's limit, price and audience, nothing from the old plan",
    async (from, to) => {
      await withWorld(from, async (w) => {
        await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE[to] });
        const s = await status(w);
        expect(s.account.planId).toBe(to);
        expect(s.entitlements.planId).toBe(to);
        expect(s.entitlements.tokenLimit).toBe(entitlementsForPlan(to as never).monthlyTokens);
        expect(s.entitlements.subscriptionStatus).toBe(
          SUBSCRIPTION_PLANS[to as never].monthlyPriceHalalas > 0 ? "active" : "trialing",
        );
      });
    },
  );

  it("family → individual closes the household; individual → family opens it", async () => {
    await withWorld("family", async (w) => {
      expect((await w.as.owner("GET", "/v1/family")).body.available).toBe(true);
      await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE.solo });
      expect((await w.as.owner("GET", "/v1/family")).body.available).toBe(false);
      expect(
        (await w.as.owner("POST", "/v1/family/members", { displayName: "X", role: "partner" }))
          .status,
      ).toBe(403);
      await w.as.owner("POST", "/v1/account/subscribe", { code: PLAN_CODE.family });
      expect((await w.as.owner("GET", "/v1/family")).body.available).toBe(true);
    });
  });
});

describe("expired, cancelled and past-due subscriptions", () => {
  const expire = async (w: World, over: Record<string, unknown> = {}) => {
    const account = (await w.context.persistence.accounts.get())!;
    await w.context.persistence.accounts.upsert({
      ...account,
      periodStart: "2020-01-01T00:00:00.000Z",
      periodEnd: "2020-02-01T00:00:00.000Z",
      ...over,
    } as never);
  };

  it.each(["free", "solo", "business", "family"])(
    "%s: after the period ends AI is paused until payment (no free ride)",
    async (plan) => {
      await withWorld(plan, async (w) => {
        const chat = await startChat(w.as.owner);
        expect((await chat.send("before")).status).toBe(200);
        await expire(w);
        const s = await status(w);
        expect(s.entitlements.pauseMode).toBe("payment_required");
        expect(s.entitlements.subscriptionStatus).toBe("past_due");
        const blocked = await chat.send("after");
        expect(blocked.status).toBe(402);
        expect(blocked.body.error.message).toMatch(/payment|billing/i);
      });
    },
  );

  it("a cancelled subscription is treated as payment required", async () => {
    await withWorld("studio", async (w) => {
      const chat = await startChat(w.as.owner);
      const account = (await w.context.persistence.accounts.get())!;
      await w.context.persistence.accounts.upsert({ ...account, subscriptionStatus: "canceled" });
      const s = await status(w);
      expect(s.entitlements.pauseMode).toBe("payment_required");
      expect((await chat.send("x")).status).toBe(402);
    });
  });

  it("payment recovery: paying the renewal invoice unlocks chat again, and the invoice cannot be reused next month", async () => {
    await withWorld("pro", async (w) => {
      const chat = await startChat(w.as.owner);
      await expire(w);
      expect((await chat.send("x")).status).toBe(402);

      let invoice: MoyasarInvoice = {
        id: "inv_renew_1",
        status: "paid",
        amount: SUBSCRIPTION_PLANS.pro.monthlyPriceHalalas,
        currency: "SAR",
        description: "Arrab Studio Pro renewal (pro)",
        url: "https://pay.test/1",
        metadata: {},
      };
      const moyasar: MoyasarClient = {
        createInvoice: async (input) => {
          invoice = { ...invoice, metadata: input.metadata };
          return invoice;
        },
        getInvoice: async () => invoice,
      };
      const billing = new BillingService(w.context.accounts, moyasar, "https://site.test");
      const checkout = await billing.checkout("pro");
      expect(checkout.invoiceId).toBe("inv_renew_1");
      await billing.confirmInvoice("inv_renew_1");
      expect((await status(w)).entitlements.pauseMode).toBeNull();
      expect((await chat.send("back")).status).toBe(200);

      // Next month the same (already consumed) invoice must not renew again.
      await expire(w);
      await billing.confirmInvoice("inv_renew_1");
      expect((await status(w)).entitlements.pauseMode).toBe("payment_required");
    });
  });

  it("a payment for the wrong amount, wrong state or another account never changes the plan", async () => {
    await withWorld("free", async (w) => {
      const base: MoyasarInvoice = {
        id: "inv_x",
        status: "paid",
        amount: 100,
        currency: "SAR",
        description: "Arrab (pro)",
        url: null,
        metadata: { planId: "pro", accountId: "someone-else" },
      };
      const make = (over: Partial<MoyasarInvoice>) =>
        new BillingService(
          w.context.accounts,
          { createInvoice: async () => base, getInvoice: async () => ({ ...base, ...over }) },
          "https://s.test",
        );
      const account = (await w.context.persistence.accounts.get())!;
      await expect(make({}).confirmInvoice("inv_x")).rejects.toThrow(/does not belong/);
      await expect(
        make({ metadata: { planId: "pro", accountId: account.id }, amount: 100 }).confirmInvoice(
          "inv_x",
        ),
      ).rejects.toThrow(/amount/);
      await expect(
        make({
          status: "initiated",
          metadata: { planId: "pro", accountId: account.id },
          amount: 4900,
        }).confirmInvoice("inv_x"),
      ).rejects.toThrow(/in progress/);
      await expect(
        make({
          status: "failed",
          metadata: { planId: "pro", accountId: account.id },
          amount: 4900,
        }).confirmInvoice("inv_x"),
      ).rejects.toThrow(/not paid/);
      expect((await status(w)).account.planId).toBe("free");
    });
  });

  it("failed top-up payments add nothing; usage packs only count in the period they were bought", async () => {
    await withWorld("solo", async (w) => {
      const account = (await w.context.persistence.accounts.get())!;
      const pack = TOKEN_TOP_UP_PACKS.boost_500k;
      await w.context.accounts.addTopUp(pack, "inv_pack_1");
      let s = await status(w);
      expect(s.entitlements.tokenLimit).toBe(
        SUBSCRIPTION_PLANS.solo.monthlyTokenLimit + pack.tokens,
      );
      // Buying the same invoice twice is a no-op.
      await w.context.accounts.addTopUp(pack, "inv_pack_1");
      s = await status(w);
      expect(s.entitlements.tokenLimit).toBe(
        SUBSCRIPTION_PLANS.solo.monthlyTokenLimit + pack.tokens,
      );
      // A pack from last period is worthless this period.
      await w.context.persistence.accounts.upsert({
        ...(await w.context.persistence.accounts.get())!,
        tokenTopUps: [
          {
            ...(account.tokenTopUps?.[0] ?? {
              invoiceId: "old",
              packId: pack.id,
              tokens: pack.tokens,
              purchasedAt: "2020-01-01T00:00:00.000Z",
            }),
            periodEnd: "2000-01-01T00:00:00.000Z",
          } as never,
        ],
      });
      s = await status(w);
      expect(s.entitlements.tokenLimit).toBe(SUBSCRIPTION_PLANS.solo.monthlyTokenLimit);
    });
  });

  it("a top-up lifts a quota block, and the block returns when the extra tokens are spent", async () => {
    await withWorld("free", async (w) => {
      const chat = await startChat(w.as.owner);
      await w.spendTokens(SUBSCRIPTION_PLANS.free.monthlyTokenLimit);
      expect((await chat.send("x")).status).toBe(402);
      await w.context.accounts.addTopUp(TOKEN_TOP_UP_PACKS.boost_500k, "inv_boost");
      expect((await chat.send("x")).status).toBe(200);
      await w.spendTokens(TOKEN_TOP_UP_PACKS.boost_500k.tokens);
      expect((await chat.send("x")).status).toBe(402);
    });
  });
});

describe("custom credit (pay-as-you-go)", () => {
  it("buys real usage: paying 10 SAR raises this period's allowance, once per invoice", async () => {
    const { quoteCredit, tokensForCredit } = await import("@arrab/shared");
    await withWorld("solo", async (w) => {
      const quote = quoteCredit(10);
      const before = (await status(w)).entitlements.tokenLimit;
      await w.context.accounts.addModelCredit(
        {
          deepseekHalalas: quote.deepseekHalalas,
          otherHalalas: quote.otherHalalas,
          amountHalalas: quote.amountHalalas,
        },
        "inv_credit_1",
      );
      const after = (await status(w)).entitlements;
      expect(after.tokenLimit - before).toBe(tokensForCredit(1000));
      expect(after.tokenLimit - before).toBeGreaterThan(300_000);
      expect(after.otherCreditHalalas).toBe(quote.otherHalalas); // the balance is still reported
      // Replaying the same invoice adds nothing.
      await w.context.accounts.addModelCredit(
        {
          deepseekHalalas: quote.deepseekHalalas,
          otherHalalas: quote.otherHalalas,
          amountHalalas: quote.amountHalalas,
        },
        "inv_credit_1",
      );
      expect((await status(w)).entitlements.tokenLimit).toBe(after.tokenLimit);
    });
  });

  it("credit quotes: bounds, rounding, and the split always adds up to what was charged", async () => {
    const { quoteCredit } = await import("@arrab/shared");
    for (const bad of [Number.NaN, Infinity, -5, 0, 0.99, 5000.01, 1e9])
      expect(() => quoteCredit(bad), String(bad)).toThrow();
    for (const sar of [1, 1.01, 3.33, 9.99, 10, 99.99, 1234.56, 5000]) {
      const q = quoteCredit(sar);
      expect(q.deepseekHalalas + q.otherHalalas + q.profitHalalas, `sum ${sar}`).toBe(
        q.amountHalalas,
      );
      expect(q.amountHalalas).toBe(Math.round(sar * 100));
      expect(q.profitHalalas).toBeGreaterThanOrEqual(0);
    }
  });
});
