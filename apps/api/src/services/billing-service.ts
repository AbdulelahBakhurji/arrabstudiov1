import {
  ServiceUnavailableError,
  ValidationError,
} from "@arrab/core";
import {
  SUBSCRIPTION_PLANS,
  type AccountStatusResponse,
  type BillingCheckoutResponse,
  type SubscriptionPlanId,
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
    };
  }

  async checkout(planId: string): Promise<BillingCheckoutResponse> {
    if (!isPlanId(planId)) {
      throw new ValidationError("Unknown plan");
    }
    const account = await this.accounts.requireConnectedAccount();
    const plan = SUBSCRIPTION_PLANS[planId];
    if (account.planId === planId) {
      throw new ValidationError(`You are already on ${plan.name}`);
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
      description: `Arrab Studio ${plan.name} (${plan.id})`,
      callbackUrl: `${origin}/v1/billing/moyasar/callback`,
      successUrl: `${origin}/app?paid=1#plans`,
      backUrl: `${origin}/app#plans`,
      metadata: {
        planId: plan.id,
        accountId: account.id,
        email: account.email,
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
    return { ok: true, planId: status.account?.planId };
  }

  private async applyPaidInvoice(invoice: MoyasarInvoice): Promise<AccountStatusResponse> {
    if (invoice.status !== "paid") {
      throw new ValidationError(
        invoice.status === "initiated"
          ? "Payment is still in progress"
          : `Invoice is ${invoice.status}, not paid`,
      );
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
