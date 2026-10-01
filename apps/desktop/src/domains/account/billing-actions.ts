import {
  TOKEN_TOP_UP_PACKS,
  type AccountEntitlements,
  type SubscriptionPlanId,
  type TokenTopUpPack,
  type TokenTopUpPackId,
} from "@arrab/shared";
import { arrabApi } from "@/core/api/api";
import { ARRAB_PLANS_URL, openExternalUrl } from "@/core/platform/desktop";
import { refreshAccountStatus } from "@/domains/account/use-signed-in-account";

export const TOP_UP_PACKS: readonly TokenTopUpPack[] = Object.values(TOKEN_TOP_UP_PACKS);

export type CheckoutOpened = {
  /** Present when the API created a Moyasar invoice we can confirm directly. */
  invoiceId: string | null;
  /** True when we fell back to the Arrab website instead of a direct checkout. */
  viaWebsite: boolean;
};

function websiteUrl(params: Record<string, string>): string {
  const url = new URL(ARRAB_PLANS_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("source", "desktop");
  return url.toString();
}

export function formatPackPrice(pack: TokenTopUpPack, locale: string): string {
  const sar = pack.priceHalalas / 100;
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-SA", {
    style: "currency",
    currency: pack.currency,
    maximumFractionDigits: sar % 1 === 0 ? 0 : 2,
  }).format(sar);
}

export function formatTokens(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(tokens);
}

/**
 * Renew (or upgrade from an ended Free month) on the website. Paid plans get a
 * direct Moyasar checkout for this month's renewal when billing is configured;
 * otherwise the Arrab website plans page takes over.
 */
export async function openRenewal(entitlements: AccountEntitlements): Promise<CheckoutOpened> {
  const planId = entitlements.planId as SubscriptionPlanId | null;
  const freeTier = !planId || planId === "free" || planId === "family_free";
  if (!freeTier) {
    try {
      const checkout = await arrabApi.billingCheckout({ planId });
      if (checkout.checkoutUrl) {
        await openExternalUrl(checkout.checkoutUrl);
        return { invoiceId: checkout.invoiceId || null, viaWebsite: false };
      }
    } catch {
      // Billing not configured on this API — the website handles renewal.
    }
  }
  await openExternalUrl(
    websiteUrl(freeTier ? { intent: "upgrade" } : { intent: "renew", plan: planId }),
  );
  return { invoiceId: null, viaWebsite: true };
}

export async function openUpgrade(): Promise<CheckoutOpened> {
  await openExternalUrl(websiteUrl({ intent: "upgrade" }));
  return { invoiceId: null, viaWebsite: true };
}

export async function openUsagePack(packId: TokenTopUpPackId): Promise<CheckoutOpened> {
  try {
    const checkout = await arrabApi.billingTopUp({ packId });
    if (checkout.checkoutUrl) {
      await openExternalUrl(checkout.checkoutUrl);
      return { invoiceId: checkout.invoiceId || null, viaWebsite: false };
    }
  } catch (error) {
    // "Renew first" is a real answer, not a missing billing setup.
    if (error instanceof Error && /renew/i.test(error.message)) throw error;
  }
  await openExternalUrl(websiteUrl({ intent: "usage", pack: packId }));
  return { invoiceId: null, viaWebsite: true };
}

const WATCH_INTERVAL_MS = 5_000;
const WATCH_LIMIT_MS = 15 * 60_000;

/**
 * After checkout opens in the browser, keep checking until the pause lifts.
 * Confirms the invoice directly when we have one (covers APIs the payment
 * provider cannot call back), and always refreshes account status.
 */
export function watchForPayment(
  invoiceId: string | null,
  isResolved: () => boolean,
  onResolved: () => void,
): () => void {
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    if (invoiceId) {
      await arrabApi.billingConfirm(invoiceId).catch(() => undefined);
    }
    await refreshAccountStatus({ silent: true }).catch(() => undefined);
    if (stopped) return;
    if (isResolved()) {
      stopped = true;
      onResolved();
      return;
    }
    if (Date.now() - startedAt < WATCH_LIMIT_MS) {
      timer = setTimeout(() => void tick(), WATCH_INTERVAL_MS);
    }
  };
  const onFocus = () => {
    if (timer) clearTimeout(timer);
    void tick();
  };

  timer = setTimeout(() => void tick(), WATCH_INTERVAL_MS);
  window.addEventListener("focus", onFocus);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
  };
}
