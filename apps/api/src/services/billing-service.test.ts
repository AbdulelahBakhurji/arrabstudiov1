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
  defaultModel: "amazon.nova-lite-v1:0",
  primaryProviderId: "bedrock",
  publicBaseUrl: "http://127.0.0.1:8787",
  authWebUrl: undefined,
  siteUrl: "https://testingworkspace.arrabai.com",
  moyasarSecretKey: undefined,
  moyasarPublishableKey: undefined,
  releasesDir: "/tmp/arrab-releases-test",
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

  async createInvoice(): Promise<MoyasarInvoice> {
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

  it("lists a published dmg from the releases directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrab-rel-"));
    await writeFile(path.join(dir, "ArrabStudio-0.2.0.dmg"), "fake-dmg");
    const listed = await listStudioReleases(dir, "https://testingworkspace.arrabai.com");
    expect(listed.latestMacDmg?.filename).toBe("ArrabStudio-0.2.0.dmg");
    expect(listed.latestMacDmg?.url).toContain("/releases/ArrabStudio-0.2.0.dmg");
    expect(listed.items[0]?.platform).toBe("macos");
  });
});
