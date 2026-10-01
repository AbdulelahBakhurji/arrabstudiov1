import {
  ServiceUnavailableError,
  ValidationError,
} from "@arrab/core";
import {
  SUBSCRIPTION_PLANS,
  TOKEN_TOP_UP_PACKS,
  quoteCredit,
  type AccountStatusResponse,
  type BillingCheckoutResponse,
  type BillingCustomCreditResponse,
  type BillingTopUpResponse,
  type SubscriptionPlanId,
  type TokenTopUpPackId,
} from "@arrab/shared";
import type { AccountService } from "./account-service.js";
import {
  requireMoyasarClient,
  type MoyasarClient,
  type MoyasarInvoice,
} from "./moyasar.js";

const PLAN_IDS = new Set<SubscriptionPlanId>(
  Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlanId[],
);

function isPlanId(value: string): value is SubscriptionPlanId {
  return PLAN_IDS.has(value as SubscriptionPlanId);
}

function isTopUpPackId(value: string): value is TokenTopUpPackId {
  return Object.prototype.hasOwnProperty.call(TOKEN_TOP_UP_PACKS, value);
}

function planFromInvoice(invoice: MoyasarInvoice): SubscriptionPlanId | null {
  const fromMeta = invoice.metadata?.planId?.trim();
  if (fromMeta && isPlanId(fromMeta)) {
    return fromMeta;
  }
  const fromDescription = invoice.description?.match(/\(([a-z_]+)\)\s*$/i);
  const captured = fromDescription?.[1]?.toLowerCase();
  if (captured && isPlanId(captured)) {
    return captured;
  }
  return null;
}

function amountLabel(halalas: number, currency = "SAR"): string {
  if (halalas <= 0) {
    return "Free";
  }
  const sar = (halalas / 100).toLocaleString("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sar} ${currency}`;
}

export class BillingService {
  constructor(
    private readonly accounts: AccountService,
    private readonly moyasar: MoyasarClient | null,
    private readonly publicBaseUrl: string,
  ) {}

  catalog() {
    return {
      currency: "SAR" as const,
      provider: "moyasar" as const,
      configured: Boolean(this.moyasar),
      plans: Object.values(SUBSCRIPTION_PLANS).map((plan) => ({
        ...plan,
        amountLabel: amountLabel(plan.monthlyPriceHalalas, plan.currency),
      })),
      topUps: Object.values(TOKEN_TOP_UP_PACKS).map((pack) => ({
        ...pack,
        amountLabel: amountLabel(pack.priceHalalas, pack.currency),
      })),
    };
  }

  async checkoutTopUp(packId: string): Promise<BillingTopUpResponse> {
    if (!isTopUpPackId(packId)) {
      throw new ValidationError("Unknown usage pack");
    }
    const account = await this.accounts.requireConnectedAccount();
    const entitlements = await this.accounts.buildEntitlements(account);
    if (entitlements.pauseMode === "payment_required") {
      throw new ValidationError(
        "Your subscription renewal is due. Renew first — usage packs add to an active plan.",
      );
    }
    const pack = TOKEN_TOP_UP_PACKS[packId];
    const client = requireMoyasarClient(this.moyasar);
    const origin = this.publicBaseUrl.replace(/\/$/, "");
    const invoice = await client.createInvoice({
      amount: pack.priceHalalas,
      currency: pack.currency,
      description: `Arrab Studio usage pack ${pack.tokens.toLocaleString("en-US")} tokens (${pack.id})`,
      callbackUrl: `${origin}/v1/billing/moyasar/callback`,
      successUrl: `${origin}/app?paid=1#usage`,
      backUrl: `${origin}/app#usage`,
      metadata: {
        kind: "top_up",
        packId: pack.id,
        accountId: account.id,
        email: account.email,
        periodEnd: account.periodEnd,
      },
    });
    if (!invoice.url) {
      throw new ServiceUnavailableError("Moyasar did not return a checkout URL");
    }
    return {
      packId: pack.id,
      tokens: pack.tokens,
      invoiceId: invoice.id,
      checkoutUrl: invoice.url,
      amountHalalas: pack.priceHalalas,
      currency: pack.currency,
      amountLabel: amountLabel(pack.priceHalalas, pack.currency),
    };
  }

  async checkoutCustomCredit(amountSar: number): Promise<BillingCustomCreditResponse> {
    let quote;
    try {
      quote = quoteCredit(amountSar);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Enter an amount in SAR");
    }
    const account = await this.accounts.requireConnectedAccount();
    const entitlements = await this.accounts.buildEntitlements(account);
    if (entitlements.pauseMode === "payment_required") {
      throw new ValidationError(
        "Your subscription renewal is due. Renew first — credit adds to an active plan.",
      );
    }
    const client = requireMoyasarClient(this.moyasar);
    const origin = this.publicBaseUrl.replace(/\/$/, "");
    const invoice = await client.createInvoice({
      amount: quote.amountHalalas,
      currency: "SAR",
      description: `Arrab Studio credit ${quote.amountSar} SAR (VAT not included)`,
      callbackUrl: `${origin}/v1/billing/moyasar/callback`,
      successUrl: `${origin}/app?paid=1#usage`,
      backUrl: `${origin}/app#usage`,
      metadata: {
        kind: "custom_credit",
        amountHalalas: String(quote.amountHalalas),
        deepseekHalalas: String(quote.deepseekHalalas),
        otherHalalas: String(quote.otherHalalas),
        profitHalalas: String(quote.profitHalalas),
        accountId: account.id,
        email: account.email,
      },
    });
    if (!invoice.url) {
      throw new ServiceUnavailableError("Moyasar did not return a checkout URL");
    }
    return {
      ...quote,
      invoiceId: invoice.id,
      checkoutUrl: invoice.url,
      amountLabel: amountLabel(quote.amountHalalas, "SAR"),
    };
  }

  async checkout(planId: string): Promise<BillingCheckoutResponse> {
    if (!isPlanId(planId)) {
      throw new ValidationError("Unknown plan");
    }
    const account = await this.accounts.requireConnectedAccount();
    const plan = SUBSCRIPTION_PLANS[planId];
    const entitlements = await this.accounts.buildEntitlements(account);
    const renewingPastDue =
      entitlements.pauseMode === "payment_required" && account.planId === planId;
    if (account.planId === planId && !renewingPastDue) {
      throw new ValidationError(`You are already on ${plan.name}`);
    }
    // Month ended on Free / Family Free — unlock only by paying for a paid plan.
    if (
      entitlements.pauseMode === "payment_required" &&
      plan.monthlyPriceHalalas <= 0
    ) {
      throw new ValidationError(
        "Your free month ended. Choose a paid plan and complete payment to unlock chat.",
      );
    }
    if (plan.monthlyPriceHalalas <= 0) {
      await this.accounts.applyPlan(planId);
      return {
        planId: plan.id,
        invoiceId: "",
        checkoutUrl: "",
        amountHalalas: 0,
        currency: plan.currency,
        amountLabel: "Free",
      };
    }

    const client = requireMoyasarClient(this.moyasar);
    const origin = this.publicBaseUrl.replace(/\/$/, "");
    const invoice = await client.createInvoice({
      amount: plan.monthlyPriceHalalas,
      currency: plan.currency,
      description: renewingPastDue
        ? `Arrab Studio ${plan.name} renewal (${plan.id})`
        : `Arrab Studio ${plan.name} (${plan.id})`,
      callbackUrl: `${origin}/v1/billing/moyasar/callback`,
      successUrl: `${origin}/app?paid=1#plans`,
      backUrl: `${origin}/app#plans`,
      metadata: {
        planId: plan.id,
        accountId: account.id,
        email: account.email,
        renew: renewingPastDue ? "1" : "0",
      },
    });
    if (!invoice.url) {
      throw new ServiceUnavailableError("Moyasar did not return a checkout URL");
    }
    return {
      planId: plan.id,
      invoiceId: invoice.id,
      checkoutUrl: invoice.url,
      amountHalalas: plan.monthlyPriceHalalas,
      currency: plan.currency,
      amountLabel: amountLabel(plan.monthlyPriceHalalas, plan.currency),
    };
  }

  async confirmInvoice(invoiceId: string): Promise<AccountStatusResponse> {
    const client = requireMoyasarClient(this.moyasar);
    const invoice = await client.getInvoice(invoiceId);
    return this.applyPaidInvoice(invoice);
  }

  async handleCallback(payload: unknown): Promise<{ ok: true; planId?: SubscriptionPlanId }> {
    const invoiceId = extractInvoiceId(payload);
    if (!invoiceId) {
      throw new ValidationError("Moyasar callback is missing an invoice id");
    }
    const status = await this.confirmInvoice(invoiceId);
    return { ok: true, planId: status.account?.planId as SubscriptionPlanId | undefined };
  }

  private async applyPaidInvoice(invoice: MoyasarInvoice): Promise<AccountStatusResponse> {
    if (invoice.status !== "paid") {
      throw new ValidationError(
        invoice.status === "initiated"
          ? "Payment is still in progress"
          : `Invoice is ${invoice.status}, not paid`,
      );
    }
    const account = await this.accounts.requireConnectedAccount();
    const metaAccountId = invoice.metadata?.accountId?.trim();
    if (!metaAccountId || metaAccountId !== account.id) {
      throw new ValidationError("Paid invoice does not belong to this workspace");
    }
    if (invoice.metadata?.kind === "custom_credit") {
      const amountHalalas = Number(invoice.metadata.amountHalalas);
      const deepseekHalalas = Number(invoice.metadata.deepseekHalalas);
      const otherHalalas = Number(invoice.metadata.otherHalalas);
      if (
        !Number.isInteger(amountHalalas) ||
        invoice.amount !== amountHalalas ||
        invoice.currency !== "SAR" ||
        !Number.isInteger(deepseekHalalas) ||
        !Number.isInteger(otherHalalas)
      ) {
        throw new ValidationError("Paid amount does not match the credit quote");
      }
      return this.accounts.addModelCredit({ deepseekHalalas, otherHalalas }, invoice.id);
    }
    if (invoice.metadata?.kind === "top_up") {
      const packId = invoice.metadata.packId?.trim() ?? "";
      if (!isTopUpPackId(packId)) {
        throw new ValidationError("Paid invoice is missing a usage pack");
      }
      const pack = TOKEN_TOP_UP_PACKS[packId];
      if (invoice.amount !== pack.priceHalalas || invoice.currency !== pack.currency) {
        throw new ValidationError("Paid amount does not match the usage pack");
      }
      return this.accounts.addTopUp(pack, invoice.id);
    }
    const planId = planFromInvoice(invoice);
    if (!planId) {
      throw new ValidationError("Paid invoice is missing a plan");
    }
    const plan = SUBSCRIPTION_PLANS[planId];
    if (invoice.amount !== plan.monthlyPriceHalalas || invoice.currency !== plan.currency) {
      throw new ValidationError("Paid amount does not match the selected plan");
    }
    return this.accounts.applyPlan(planId);
  }
}

function extractInvoiceId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id.trim();
  }
  if (typeof record.invoice_id === "string" && record.invoice_id.trim()) {
    return record.invoice_id.trim();
  }
  const data = record.data;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (typeof nested.id === "string" && nested.id.trim()) {
      return nested.id.trim();
    }
    if (typeof nested.invoice_id === "string" && nested.invoice_id.trim()) {
      return nested.invoice_id.trim();
    }
  }
  return null;
}
