import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Gauge, Sparkles } from "lucide-react";
import type { AccountEntitlements, SubscriptionPlanId } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import { openExternalUrl, openPlansPage } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";

export function QuotaPauseScreen({
  entitlements,
  onRefresh,
}: {
  entitlements: AccountEntitlements;
  onRefresh?: () => void;
}) {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);
  const ar = locale === "ar";

  const used = entitlements.tokensUsed.toLocaleString(ar ? "ar-SA" : "en-US");
  const limit =
    entitlements.tokenLimit === null
      ? t("unlimitedTokens")
      : entitlements.tokenLimit.toLocaleString(ar ? "ar-SA" : "en-US");
  const renews = new Date(entitlements.periodEnd).toLocaleDateString(ar ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const paymentDue = entitlements.pauseMode === "payment_required";
  const waitAllowed = entitlements.pauseMode === "upgrade_or_wait";
  const freeMonthEnded =
    paymentDue &&
    (entitlements.planId === "free" || entitlements.planId === "family_free");
  const primaryLabel = freeMonthEnded
    ? t("quotaPausedUpgrade")
    : paying
      ? t("paymentPausedPaying")
      : t("paymentPausedPay");
  const PrimaryIcon = freeMonthEnded ? Sparkles : CreditCard;

  async function payNow() {
    const planId = entitlements.planId as SubscriptionPlanId | null;
    if (!planId) {
      void openPlansPage();
      return;
    }
    // Free / Family Free month ended — unlock only by paying for a paid plan.
    const freeEnded = planId === "free" || planId === "family_free";
    if (freeEnded) {
      void openPlansPage();
      pushToast({
        title: ar ? "انتهى الشهر المجاني" : "Free month ended",
        body: ar
          ? "اختر خطة مدفوعة لإعادة فتح المحادثة."
          : "Choose a paid plan to unlock chat again.",
        tone: "warn",
      });
      return;
    }
    setPaying(true);
    try {
      const checkout = await arrabApi.billingCheckout({ planId });
      if (checkout.checkoutUrl) {
        await openExternalUrl(checkout.checkoutUrl);
        pushToast({
          title: ar ? "أكمل الدفع" : "Complete payment",
          body: ar
            ? "بعد الدفع ستُعاد المحادثة تلقائياً."
            : "Chat unlocks after this month’s payment clears.",
          tone: "success",
        });
      } else {
        onRefresh?.();
      }
    } catch (err: unknown) {
      pushToast({
        title: ar ? "تعذّر بدء الدفع" : "Could not start payment",
        body: err instanceof Error ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
      void openPlansPage();
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--color-background)] px-6">
      <div className="quota-pause-rise w-full max-w-lg rounded-[28px] border border-amber-300/25 bg-gradient-to-br from-[#1a1610] via-[#12100c] to-[#0a0e14] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-100">
          <Gauge className="size-3.5" strokeWidth={1.8} />
          {paymentDue ? t("paymentPausedEyebrow") : t("quotaPausedEyebrow")}
        </div>
        <h1 className="mt-4 text-2xl font-medium tracking-[-0.03em] text-white">
          {paymentDue ? t("paymentPausedTitle") : t("quotaPausedTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          {paymentDue
            ? t("paymentPausedBody")
                .replace("{plan}", entitlements.planName)
                .replace("{date}", renews)
            : waitAllowed
              ? t("quotaPausedPaidBody")
                  .replace("{plan}", entitlements.planName)
                  .replace("{used}", used)
                  .replace("{limit}", limit)
                  .replace("{date}", renews)
              : t("quotaPausedFreeBody")
                  .replace("{plan}", entitlements.planName)
                  .replace("{used}", used)
                  .replace("{limit}", limit)}
        </p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-neutral-300">
          {paymentDue ? (
            <>
              <p>
                {t("paymentPausedDue")}{" "}
                <span className="tabular-nums text-white">{renews}</span>
              </p>
              <p className="mt-1 text-xs text-neutral-500">{t("paymentPausedHint")}</p>
            </>
          ) : (
            <>
              <p>
                {t("quotaPausedUsage")}{" "}
                <span className="tabular-nums text-white">
                  {used} / {limit}
                </span>
              </p>
              {waitAllowed ? (
                <p className="mt-1 text-xs text-neutral-500">
                  {t("quotaPausedResets")} {renews}
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">{t("quotaPausedFreeHint")}</p>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {paymentDue ? (
            <button
              type="button"
              disabled={paying && !freeMonthEnded}
              onClick={() => void payNow()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-amber-200 px-5 text-sm font-medium text-[#1a1408] hover:bg-amber-100 disabled:opacity-50"
            >
              <PrimaryIcon className="size-3.5" strokeWidth={1.8} />
              {primaryLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void openPlansPage()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-amber-200 px-5 text-sm font-medium text-[#1a1408] hover:bg-amber-100"
            >
              <Sparkles className="size-3.5" strokeWidth={1.8} />
              {t("quotaPausedUpgrade")}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(href("/account"))}
            className="h-11 rounded-full border border-white/15 px-5 text-sm text-neutral-200 hover:bg-white/5"
          >
            {t("quotaPausedAccount")}
          </button>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="h-11 rounded-full border border-white/10 px-4 text-sm text-neutral-400 hover:text-white"
            >
              {t("quotaPausedRefresh")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
