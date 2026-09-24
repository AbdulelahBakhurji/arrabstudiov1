import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BillingService } from "./billing-service.js";
import { createApiContext } from "../app.js";
import type { ApiEnv } from "../config/env.js";
import type { MoyasarClient, MoyasarInvoice } from "./moyasar.js";
import { listStudioReleases } from "./releases.js";

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
  moyasarSecretKey: undefined,
  moyasarPublishableKey: undefined,
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

class FakeMoyasar implements MoyasarClient {
  invoice: MoyasarInvoice = {
    id: "inv_test",
    status: "initiated",
    amount: 4900,
    currency: "SAR",
    description: "Arrab Studio Pro (pro)",
    url: "https://checkout.moyasar.com/invoices/inv_test",
    metadata: { planId: "pro" },
  };

  async createInvoice(input: {
    metadata?: Record<string, string>;
  }): Promise<MoyasarInvoice> {
    if (input.metadata) {
      this.invoice = {
        ...this.invoice,
        metadata: { ...this.invoice.metadata, ...input.metadata },
      };
    }
    return this.invoice;
  }

  async getInvoice(): Promise<MoyasarInvoice> {
    return { ...this.invoice, status: "paid" };
  }
}

describe("billing + releases", () => {
  it("creates a Moyasar checkout and applies the plan once paid", async () => {
    const context = await createApiContext(testEnv);
    await context.accounts.connect({
      email: "pay@arrab.studio",
      password: "securepass",
      displayName: "Payer",
    });
    const billing = new BillingService(context.accounts, new FakeMoyasar(), testEnv.siteUrl);
    const checkout = await billing.checkout("pro");
    expect(checkout.checkoutUrl).toContain("checkout.moyasar.com");
    expect(checkout.amountHalalas).toBe(4900);

    const confirmed = await billing.confirmInvoice("inv_test");
    expect(confirmed.account?.planId).toBe("pro");
    expect(confirmed.entitlements.tokenLimit).toBe(2_000_000);
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
    const { AccountService } = await import("./account-service.js");
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

    const billing = new BillingService(accounts, new FakeMoyasar(), testEnv.siteUrl);
    const renew = await billing.checkout("pro");
    expect(renew.checkoutUrl).toContain("checkout.moyasar.com");

    const confirmed = await billing.confirmInvoice("inv_test");
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
    const { AccountService } = await import("./account-service.js");
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

    const billing = new BillingService(accounts, new FakeMoyasar(), testEnv.siteUrl);
    await expect(billing.checkout("free")).rejects.toThrow(/free month ended/i);

    const upgrade = await billing.checkout("pro");
    expect(upgrade.checkoutUrl).toContain("checkout.moyasar.com");
    const confirmed = await billing.confirmInvoice("inv_test");
    expect(confirmed.account?.planId).toBe("pro");
    expect(confirmed.entitlements.pauseMode).toBeNull();
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
