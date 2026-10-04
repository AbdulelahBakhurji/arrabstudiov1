import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BillingService } from "./billing-service.js";
import { createApiContext } from "../../app.js";
import type { ApiEnv } from "../../platform/config/env.js";
import type { CreateTapChargeInput, TapCharge, TapClient } from "./tap.js";
import { listStudioReleases } from "../workspace/releases.js";

const testEnv: ApiEnv = {
  host: "127.0.0.1",
  port: 8787,
  logLevel: "error",
  corsOrigins: ["http://localhost:1420"],
  databaseUrl: undefined,
  dataDir: undefined,
  bedrockApiKey: "test-bedrock-key",
  bedrockRegion: "eu-north-1",
  bedrockModels: ["amazon.nova-lite-v1:0"],
  openRouterApiKey: undefined,
  openRouterModels: ["openai/gpt-4o-mini"],
  openAiApiKey: undefined,
  anthropicApiKey: undefined,
  xaiApiKey: undefined,
  defaultModel: "amazon.nova-lite-v1:0",
  primaryProviderId: "bedrock",
  publicBaseUrl: "http://127.0.0.1:8787",
  authWebUrl: undefined,
  siteUrl: "https://testingworkspace.arrabai.com",
  tapSecretKey: undefined,
  tapPublicKey: undefined,
  dataEncryptionKey: undefined,
  releasesDir: "/tmp/arrab-releases-test",
  googleClientId: undefined,
  googleClientSecret: undefined,
  googleOAuthRedirectUri: undefined,
  microsoftClientId: undefined,
  microsoftClientSecret: undefined,
  microsoftOAuthRedirectUri: undefined,
  githubAppClientId: undefined,
  githubAppClientSecret: undefined,
  githubAppSlug: undefined,
  githubOAuthRedirectUri: undefined,
  gitlabClientId: undefined,
  gitlabClientSecret: undefined,
  gitlabOAuthRedirectUri: undefined,
  bitbucketClientId: undefined,
  bitbucketClientSecret: undefined,
  bitbucketOAuthRedirectUri: undefined,
  linearClientId: undefined,
  linearClientSecret: undefined,
  linearOAuthRedirectUri: undefined,
  slackClientId: undefined,
  slackClientSecret: undefined,
  slackOAuthRedirectUri: undefined,
  notionClientId: undefined,
  notionClientSecret: undefined,
  notionOAuthRedirectUri: undefined,
  whatsappWebhookVerifyToken: undefined,
  whatsappAppSecret: undefined,
  finnhubApiKey: undefined,
  finnhubWebhookSecret: undefined,
};

class FakeTap implements TapClient {
  charge: TapCharge = {
    id: "chg_test",
    status: "INITIATED",
    amount: 49,
    amountHalalas: 4900,
    currency: "SAR",
    description: "Arrab Studio Pro (pro)",
    url: "https://checkout.payments.tap.company/?token=test",
    metadata: { planId: "pro" },
  };

  async createCharge(input: CreateTapChargeInput): Promise<TapCharge> {
    this.charge = {
      ...this.charge,
      id: this.charge.id,
      amount: input.amountHalalas / 100,
      amountHalalas: input.amountHalalas,
      currency: input.currency,
      description: input.description,
      metadata: { ...input.metadata },
      url: "https://checkout.payments.tap.company/?token=test",
      status: "INITIATED",
    };
    return this.charge;
  }

  async getCharge(): Promise<TapCharge> {
    return { ...this.charge, status: "CAPTURED" };
  }

  verifyWebhookHash(): boolean {
    return true;
  }
}

describe("billing + releases", () => {
  it("creates a Tap checkout and applies the plan once paid", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "pay@arrab.studio",
      password: "securepass",
      displayName: "Payer",
    });
    const billing = new BillingService(context.accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    const checkout = await billing.checkout("pro");
    expect(checkout.checkoutUrl).toContain("checkout.payments.tap.company");
    expect(checkout.amountHalalas).toBe(4900);

    const confirmed = await billing.confirmInvoice("chg_test");
    expect(confirmed.account?.planId).toBe("pro");
    expect(confirmed.entitlements.tokenLimit).toBe(2_000_000);
  });

  it("treats a paid invoice as single-use so it cannot renew the plan again", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "replay@arrab.studio",
      password: "securepass",
      displayName: "Replayer",
    });
    const billing = new BillingService(context.accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    await billing.checkout("pro");
    expect((await billing.confirmInvoice("chg_test")).account?.planId).toBe("pro");

    // Same invoice again (callback retry): harmless.
    expect((await billing.confirmInvoice("chg_test")).account?.planId).toBe("pro");

    // The customer drops to Free; replaying the old paid invoice must not bring Pro back.
    await context.accounts.applyPlan("free");
    const replayed = await billing.confirmInvoice("chg_test");
    expect(replayed.account?.planId).toBe("free");
  });

  it("pauses chat on billing day until the same plan is paid again", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "renew@arrab.studio",
      password: "securepass",
      displayName: "Renewer",
    });
    await context.accounts.applyPlan("pro");

    const account = await context.persistence.accounts.get();
    expect(account).toBeTruthy();
    const expired = {
      ...account!,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-02-01T00:00:00.000Z",
      subscriptionStatus: "active" as const,
      updatedAt: "2026-02-02T00:00:00.000Z",
    };
    await context.persistence.accounts.upsert(expired);

    // Simulate “today” after the billing day.
    const frozen = {
      isoNow: () => "2026-02-10T12:00:00.000Z",
    };
    const { AccountService } = await import("../accounts/account-service.js");
    const { randomIdGenerator } = await import("@arrab/core");
    const accounts = new AccountService(
      context.persistence,
      testEnv.publicBaseUrl,
      testEnv.authWebUrl,
      randomIdGenerator,
      frozen,
    );

    const entitlements = await accounts.buildEntitlements(
      await context.persistence.accounts.get(),
    );
    expect(entitlements.pauseMode).toBe("payment_required");
    expect(entitlements.overLimit).toBe(true);
    expect(entitlements.subscriptionStatus).toBe("past_due");

    await expect(accounts.assertWithinQuota()).rejects.toThrow(/billing was due/i);

    const billing = new BillingService(accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    const renew = await billing.checkout("pro");
    expect(renew.checkoutUrl).toContain("checkout.payments.tap.company");

    const confirmed = await billing.confirmInvoice("chg_test");
    expect(confirmed.entitlements.pauseMode).toBeNull();
    expect(confirmed.entitlements.subscriptionStatus).toBe("active");
    expect(confirmed.account?.periodEnd > "2026-02-10T12:00:00.000Z").toBe(true);
  });

  it("pauses Free plan chat at month end until a paid plan is purchased", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "free@arrab.studio",
      password: "securepass",
      displayName: "Free User",
    });

    const account = await context.persistence.accounts.get();
    expect(account?.planId).toBe("free");
    await context.persistence.accounts.upsert({
      ...account!,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-02-01T00:00:00.000Z",
      subscriptionStatus: "trialing",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });

    const frozen = { isoNow: () => "2026-02-10T12:00:00.000Z" };
    const { AccountService } = await import("../accounts/account-service.js");
    const { randomIdGenerator } = await import("@arrab/core");
    const accounts = new AccountService(
      context.persistence,
      testEnv.publicBaseUrl,
      testEnv.authWebUrl,
      randomIdGenerator,
      frozen,
    );

    const entitlements = await accounts.buildEntitlements(
      await context.persistence.accounts.get(),
    );
    expect(entitlements.pauseMode).toBe("payment_required");
    expect(entitlements.planId).toBe("free");
    await expect(accounts.assertWithinQuota()).rejects.toThrow(/billing was due/i);

    const billing = new BillingService(accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    await expect(billing.checkout("free")).rejects.toThrow(/free month ended/i);

    const upgrade = await billing.checkout("pro");
    expect(upgrade.checkoutUrl).toContain("checkout.payments.tap.company");
    const confirmed = await billing.confirmInvoice("chg_test");
    expect(confirmed.account?.planId).toBe("pro");
    expect(confirmed.entitlements.pauseMode).toBeNull();
  });

  it("pauses any plan when tokens run out and unpauses after a paid usage pack", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "boost@arrab.studio",
      password: "securepass",
      displayName: "Booster",
    });
    const account = (await context.persistence.accounts.get())!;
    const workspace = await context.persistence.getWorkspace();
    const spend = (id: string, tokens: number) =>
      context.persistence.usage.append({
        id,
        workspaceId: workspace.workspace.id,
        conversationId: null,
        agentId: null,
        providerId: "bedrock",
        model: "nova",
        inputTokens: tokens,
        outputTokens: 0,
        createdAt: new Date(new Date(account.periodStart).getTime() + 60_000).toISOString(),
      });

    await spend("u1", 85_000);
    let entitlements = await context.accounts.buildEntitlements(account);
    expect(entitlements.usageLevel).toBe("low");
    expect(entitlements.overLimit).toBe(false);

    await spend("u2", 15_000);
    entitlements = await context.accounts.buildEntitlements(account);
    expect(entitlements).toMatchObject({ overLimit: true, pauseMode: "upgrade_required", usageLevel: "exhausted", canTopUp: true });
    await expect(context.accounts.assertWithinQuota()).rejects.toThrow(/token limit reached.*Add usage/);

    const tap = new FakeTap();
    tap.charge = { ...tap.charge, id: "inv_boost", amount: 45, amountHalalas: 4_500, description: "pack", metadata: {} };
    const billing = new BillingService(context.accounts, tap, testEnv.publicBaseUrl, testEnv.siteUrl);
    await expect(billing.checkoutTopUp("boost_999")).rejects.toThrow(/Unknown usage pack/);
    const checkout = await billing.checkoutTopUp("boost_2m");
    expect(checkout).toMatchObject({ packId: "boost_2m", tokens: 2_000_000, amountHalalas: 4_500 });

    const paid = await billing.confirmInvoice("inv_boost");
    expect(paid.entitlements).toMatchObject({
      overLimit: false,
      pauseMode: null,
      planTokenLimit: 100_000,
      topUpTokens: 2_000_000,
      tokenLimit: 2_100_000,
    });
    await expect(context.accounts.assertWithinQuota()).resolves.toBeTruthy();

    const again = await billing.confirmInvoice("inv_boost");
    expect(again.entitlements.topUpTokens).toBe(2_000_000);

    tap.charge = { ...tap.charge, id: "inv_cheap", amount: 1, amountHalalas: 100 };
    await expect(billing.confirmInvoice("inv_cheap")).rejects.toThrow(/does not match the usage pack/);
  });

  it("refuses usage packs while a renewal payment is due", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({ email: "due@arrab.studio", password: "securepass", displayName: "Due" });
    await context.accounts.applyPlan("pro");
    const account = (await context.persistence.accounts.get())!;
    await context.persistence.accounts.upsert({ ...account, subscriptionStatus: "past_due" });
    const billing = new BillingService(context.accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    await expect(billing.checkoutTopUp("boost_500k")).rejects.toThrow(/Renew first/);
    const entitlements = await context.accounts.buildEntitlements(await context.persistence.accounts.get());
    expect(entitlements).toMatchObject({ pauseMode: "payment_required", canTopUp: false });
  });

  it("splits a custom credit amount into 10% DeepSeek, 60% other models, and 30% profit", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "credit@arrab.studio",
      password: "securepass",
      displayName: "Credit",
    });
    const billing = new BillingService(context.accounts, new FakeTap(), testEnv.publicBaseUrl, testEnv.siteUrl);
    const checkout = await billing.checkoutCustomCredit(100);
    expect(checkout).toMatchObject({
      amountHalalas: 10_000,
      deepseekHalalas: 1_000,
      otherHalalas: 6_000,
      profitHalalas: 3_000,
      vatIncluded: false,
    });
    expect(checkout.amountHalalas).toBe(
      checkout.deepseekHalalas + checkout.otherHalalas + checkout.profitHalalas,
    );

    const paid = await billing.confirmInvoice(checkout.invoiceId);
    expect(paid.entitlements).toMatchObject({
      deepseekCreditHalalas: 1_000,
      otherCreditHalalas: 6_000,
    });
    const again = await billing.confirmInvoice(checkout.invoiceId);
    expect(again.entitlements.deepseekCreditHalalas).toBe(1_000);
    expect(again.entitlements.otherCreditHalalas).toBe(6_000);
  });

  it("lists a published dmg from the releases directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrab-rel-"));
    await writeFile(path.join(dir, "ArrabStudio-0.2.0.dmg"), "fake-dmg");
    const listed = await listStudioReleases(dir, "https://testingworkspace.arrabai.com");
    expect(listed.latestMacDmg?.filename).toBe("ArrabStudio-0.2.0.dmg");
    expect(listed.latestMacDmg?.url).toContain("/releases/ArrabStudio-0.2.0.dmg");
    expect(listed.items[0]?.platform).toBe("macos");
  });
});
