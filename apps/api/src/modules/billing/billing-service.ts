import {
  ServiceUnavailableError,
  ValidationError,
} from "@arrab/core";
import {
  SUBSCRIPTION_PLANS,
  TOKEN_TOP_UP_PACKS,
  normalizePlanId,
  quoteCredit,
  type AccountStatusResponse,
  type BillingCheckoutResponse,
  type BillingCustomCreditResponse,
  type BillingTopUpResponse,
  type SubscriptionPlanId,
  type TokenTopUpPackId,
} from "@arrab/shared";
import type { AccountService } from "../accounts/account-service.js";
import {
  isTapChargePaid,
  requireTapClient,
  type TapCharge,
  type TapClient,
} from "./tap.js";

function isTopUpPackId(value: string): value is TokenTopUpPackId {
  return Object.prototype.hasOwnProperty.call(TOKEN_TOP_UP_PACKS, value);
}

function planFromCharge(charge: TapCharge): SubscriptionPlanId | null {
  const fromMeta = normalizePlanId(charge.metadata?.planId);
  if (fromMeta) return fromMeta;
  const fromDescription = charge.description?.match(/\(([a-z_]+)\)\s*$/i);
  return normalizePlanId(fromDescription?.[1] ?? null);
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

function extractChargeId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id.trim();
  }
  if (typeof record.charge_id === "string" && record.charge_id.trim()) {
    return record.charge_id.trim();
  }
  const data = record.data;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (typeof nested.id === "string" && nested.id.trim()) {
      return nested.id.trim();
    }
  }
  return null;
}

export class BillingService {
  constructor(
    private readonly accounts: AccountService,
    private readonly tap: TapClient | null,
    /** Public API origin used for Tap webhook `post.url`. */
    private readonly publicBaseUrl: string,
    /** Website origin for browser redirects after payment. */
    private readonly siteUrl: string = publicBaseUrl,
  ) {}

  catalog() {
    return {
      currency: "SAR" as const,
      provider: "tap" as const,
      configured: Boolean(this.tap),
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
    const client = requireTapClient(this.tap);
    const apiOrigin = this.publicBaseUrl.replace(/\/$/, "");
    const siteOrigin = this.siteUrl.replace(/\/$/, "");
    const charge = await client.createCharge({
      amountHalalas: pack.priceHalalas,
      currency: pack.currency,
      description: `Arrab Studio usage pack ${pack.tokens.toLocaleString("en-US")} tokens (${pack.id})`,
      postUrl: `${apiOrigin}/v1/billing/tap/callback`,
      redirectUrl: `${siteOrigin}/app?paid=1#usage`,
      customer: { email: account.email, firstName: account.displayName },
      metadata: {
        kind: "top_up",
        packId: pack.id,
        accountId: account.id,
        email: account.email,
        periodEnd: account.periodEnd,
      },
    });
    if (!charge.url) {
      throw new ServiceUnavailableError("Tap did not return a checkout URL");
    }
    return {
      packId: pack.id,
      tokens: pack.tokens,
      invoiceId: charge.id,
      checkoutUrl: charge.url,
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
    const client = requireTapClient(this.tap);
    const apiOrigin = this.publicBaseUrl.replace(/\/$/, "");
    const siteOrigin = this.siteUrl.replace(/\/$/, "");
    const charge = await client.createCharge({
      amountHalalas: quote.amountHalalas,
      currency: "SAR",
      description: `Arrab Studio credit ${quote.amountSar} SAR (VAT not included)`,
      postUrl: `${apiOrigin}/v1/billing/tap/callback`,
      redirectUrl: `${siteOrigin}/app?paid=1#usage`,
      customer: { email: account.email, firstName: account.displayName },
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
    if (!charge.url) {
      throw new ServiceUnavailableError("Tap did not return a checkout URL");
    }
    return {
      ...quote,
      invoiceId: charge.id,
      checkoutUrl: charge.url,
      amountLabel: amountLabel(quote.amountHalalas, "SAR"),
    };
  }

  async checkout(rawPlanId: string): Promise<BillingCheckoutResponse> {
    const planId = normalizePlanId(rawPlanId);
    if (!planId) {
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

    const client = requireTapClient(this.tap);
    const apiOrigin = this.publicBaseUrl.replace(/\/$/, "");
    const siteOrigin = this.siteUrl.replace(/\/$/, "");
    const charge = await client.createCharge({
      amountHalalas: plan.monthlyPriceHalalas,
      currency: plan.currency,
      description: renewingPastDue
        ? `Arrab Studio ${plan.name} renewal (${plan.id})`
        : `Arrab Studio ${plan.name} (${plan.id})`,
      postUrl: `${apiOrigin}/v1/billing/tap/callback`,
      redirectUrl: `${siteOrigin}/app?paid=1#plans`,
      customer: { email: account.email, firstName: account.displayName },
      metadata: {
        planId: plan.id,
        accountId: account.id,
        email: account.email,
        renew: renewingPastDue ? "1" : "0",
      },
    });
    if (!charge.url) {
      throw new ServiceUnavailableError("Tap did not return a checkout URL");
    }
    return {
      planId: plan.id,
      invoiceId: charge.id,
      checkoutUrl: charge.url,
      amountHalalas: plan.monthlyPriceHalalas,
      currency: plan.currency,
      amountLabel: amountLabel(plan.monthlyPriceHalalas, plan.currency),
    };
  }

  /**
   * Confirm a paid Tap charge. Always re-fetches from Tap (never trusts the client body alone).
   * When `expectedAccountId` is set (owner confirm route), metadata must match that account.
   */
  async confirmInvoice(
    invoiceId: string,
    expectedAccountId?: string | null,
  ): Promise<AccountStatusResponse> {
    const client = requireTapClient(this.tap);
    const charge = await client.getCharge(invoiceId);
    return this.applyPaidCharge(charge, expectedAccountId);
  }

  async handleCallback(
    payload: unknown,
    hashstring?: string,
  ): Promise<{ ok: true; planId?: SubscriptionPlanId }> {
    const chargeId = extractChargeId(payload);
    if (!chargeId) {
      throw new ValidationError("Tap callback is missing a charge id");
    }
    const client = requireTapClient(this.tap);
    // Authenticity: require Tap's hashstring HMAC, then re-fetch the charge with the secret key.
    const posted =
      payload && typeof payload === "object"
        ? ({
            id: chargeId,
            amount:
              typeof (payload as { amount?: unknown }).amount === "number"
                ? (payload as { amount: number }).amount
                : 0,
            currency:
              typeof (payload as { currency?: unknown }).currency === "string"
                ? (payload as { currency: string }).currency
                : "SAR",
            status:
              typeof (payload as { status?: unknown }).status === "string"
                ? (payload as { status: string }).status
                : "",
            reference: (payload as { reference?: TapCharge["reference"] }).reference,
            transactionCreated:
              (payload as { transaction?: { created?: string | number } }).transaction?.created !=
              null
                ? String(
                    (payload as { transaction: { created: string | number } }).transaction.created,
                  )
                : null,
          } satisfies import("./tap.js").TapWebhookHashInput)
        : null;
    if (!posted || !client.verifyWebhookHash(posted, hashstring)) {
      throw new ValidationError("Tap callback signature is invalid");
    }
    const status = await this.confirmInvoice(chargeId);
    return { ok: true, planId: status.account?.planId as SubscriptionPlanId | undefined };
  }

  private async applyPaidCharge(
    charge: TapCharge,
    expectedAccountId?: string | null,
  ): Promise<AccountStatusResponse> {
    if (!isTapChargePaid(charge.status)) {
      throw new ValidationError(
        charge.status.toUpperCase() === "INITIATED"
          ? "Payment is still in progress"
          : `Charge is ${charge.status}, not captured`,
      );
    }
    const metaAccountId = charge.metadata?.accountId?.trim();
    if (!metaAccountId) {
      throw new ValidationError("Paid charge is missing account binding");
    }
    if (expectedAccountId && expectedAccountId !== metaAccountId) {
      throw new ValidationError("Paid charge does not belong to this account");
    }
    const account = await this.accounts.requireAccountById(metaAccountId);

    if (charge.metadata?.kind === "custom_credit") {
      const amountHalalas = Number(charge.metadata.amountHalalas);
      const deepseekHalalas = Number(charge.metadata.deepseekHalalas);
      const otherHalalas = Number(charge.metadata.otherHalalas);
      if (
        !Number.isInteger(amountHalalas) ||
        charge.amountHalalas !== amountHalalas ||
        charge.currency !== "SAR" ||
        !Number.isInteger(deepseekHalalas) ||
        !Number.isInteger(otherHalalas)
      ) {
        throw new ValidationError("Paid amount does not match the credit quote");
      }
      return this.accounts.addModelCredit(
        { deepseekHalalas, otherHalalas, amountHalalas },
        charge.id,
        account.id,
      );
    }
    if (charge.metadata?.kind === "top_up") {
      const packId = charge.metadata.packId?.trim() ?? "";
      if (!isTopUpPackId(packId)) {
        throw new ValidationError("Paid charge is missing a usage pack");
      }
      const pack = TOKEN_TOP_UP_PACKS[packId];
      if (charge.amountHalalas !== pack.priceHalalas || charge.currency !== pack.currency) {
        throw new ValidationError("Paid amount does not match the usage pack");
      }
      return this.accounts.addTopUp(pack, charge.id, account.id);
    }
    const planId = planFromCharge(charge);
    if (!planId) {
      throw new ValidationError("Paid charge is missing a plan");
    }
    const plan = SUBSCRIPTION_PLANS[planId];
    if (charge.amountHalalas !== plan.monthlyPriceHalalas || charge.currency !== plan.currency) {
      throw new ValidationError("Paid amount does not match the selected plan");
    }
    return this.accounts.applyPaidPlan(planId, charge.id, account.id);
  }
}
