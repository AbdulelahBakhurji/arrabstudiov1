import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CreditCard, ExternalLink, Gauge, Loader2, Plus, Sparkles, Zap } from "lucide-react";
import type { AccountEntitlements, TokenTopUpPackId } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import {
  TOP_UP_PACKS,
  formatPackPrice,
  formatTokens,
  openRenewal,
  openUpgrade,
  openUsagePack,
  watchForPayment,
  type CheckoutOpened,
} from "@/lib/billing-actions";
import { pushToast } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Busy = "renew" | "upgrade" | TokenTopUpPackId | null;

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
  const [busy, setBusy] = useState<Busy>(null);
  const [waiting, setWaiting] = useState<CheckoutOpened | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const latest = useRef(entitlements);
  latest.current = entitlements;
  const ar = locale === "ar";
  const numberLocale = ar ? "ar-SA" : "en-US";

  useEffect(() => () => stopWatch.current?.(), []);

  const used = entitlements.tokensUsed.toLocaleString(numberLocale);
  const limit =
    entitlements.tokenLimit === null ? t("unlimitedTokens") : entitlements.tokenLimit.toLocaleString(numberLocale);
  const renews = new Date(entitlements.periodEnd).toLocaleDateString(numberLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const paymentDue = entitlements.pauseMode === "payment_required";
  const waitAllowed = entitlements.pauseMode === "upgrade_or_wait";
  const freeTier = entitlements.planId === "free" || entitlements.planId === "family_free";
  const canTopUp = entitlements.canTopUp ?? !paymentDue;
  const topUpTokens = entitlements.topUpTokens ?? 0;
  const percent =
    entitlements.tokenLimit && entitlements.tokenLimit > 0
      ? Math.min(100, Math.round((entitlements.tokensUsed / entitlements.tokenLimit) * 100))
      : 100;

  async function run(kind: Busy, action: () => Promise<CheckoutOpened>) {
    setBusy(kind);
    try {
      const opened = await action();
      setWaiting(opened);
      pushToast({
        title: t("quotaCheckoutOpened"),
        body: t("quotaCheckoutOpenedBody"),
        tone: "info",
      });
      stopWatch.current?.();
      stopWatch.current = watchForPayment(
        opened.invoiceId,
        () => !latest.current.overLimit && latest.current.pauseMode === null,
        () => {
          setWaiting(null);
          pushToast({ title: t("quotaPaymentReceived"), body: t("quotaPaymentReceivedBody"), tone: "success" });
        },
      );
    } catch (err: unknown) {
      pushToast({
        title: t("quotaCheckoutFailed"),
        body: err instanceof Error ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(null);
    }
  }

  const body = paymentDue
    ? freeTier
      ? t("quotaFreeEndedBody")
      : t("paymentPausedBody").replace("{plan}", entitlements.planName).replace("{date}", renews)
    : waitAllowed
      ? t("quotaPausedPaidBody")
          .replace("{plan}", entitlements.planName)
          .replace("{used}", used)
          .replace("{limit}", limit)
          .replace("{date}", renews)
      : t("quotaPausedFreeBody")
          .replace("{plan}", entitlements.planName)
          .replace("{used}", used)
          .replace("{limit}", limit);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-[var(--color-background)] px-6 py-8">
      <div className="quota-pause-rise w-full max-w-xl rounded-[28px] border border-amber-300/25 bg-gradient-to-br from-[#1a1610] via-[#12100c] to-[#0a0e14] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-100">
          <Gauge className="size-3.5" strokeWidth={1.8} />
          {paymentDue ? t("paymentPausedEyebrow") : t("quotaPausedEyebrow")}
        </div>
        <h1 className="mt-4 text-2xl font-medium tracking-[-0.03em] text-white">
          {paymentDue ? (freeTier ? t("quotaFreeEndedTitle") : t("paymentPausedTitle")) : t("quotaPausedTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">{body}</p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-neutral-300">
          <div className="flex items-baseline justify-between gap-3">
            <span>{t("quotaPausedUsage")}</span>
            <span className="tabular-nums text-white" dir="ltr">
              {used} / {limit}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-amber-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {paymentDue
              ? `${t("paymentPausedDue")} ${renews}`
              : waitAllowed
                ? `${t("quotaPausedResets")} ${renews}`
                : t("quotaPausedFreeHint")}
            {topUpTokens > 0
              ? ` · ${t("quotaIncludesPacks").replace("{tokens}", formatTokens(topUpTokens, locale))}`
              : ""}
          </p>
        </div>

        {waiting ? (
          <div
            className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50"
            role="status"
          >
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("quotaWaitingPayment")}</p>
              <p className="mt-0.5 text-xs text-emerald-100/70">{t("quotaWaitingPaymentBody")}</p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 rounded-full border border-emerald-200/30 px-3 py-1 text-xs hover:bg-emerald-300/10"
            >
              {t("quotaCheckNow")}
            </button>
          </div>
        ) : null}

        {paymentDue ? (
          <section className="mt-6">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(freeTier ? "upgrade" : "renew", () => openRenewal(entitlements))}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-amber-200 px-5 text-sm font-medium text-[#1a1408] hover:bg-amber-100 disabled:opacity-60"
            >
              {busy === "renew" || busy === "upgrade" ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
              ) : freeTier ? (
                <Sparkles className="size-4" strokeWidth={1.8} />
              ) : (
                <CreditCard className="size-4" strokeWidth={1.8} />
              )}
              {freeTier ? t("quotaPausedUpgrade") : t("quotaRenewSubscription")}
              <ExternalLink className="size-3.5 opacity-70" strokeWidth={1.8} />
            </button>
            <p className="mt-2 text-center text-xs text-neutral-500">{t("quotaRenewHint")}</p>
          </section>
        ) : (
          <>
            {canTopUp ? (
              <section className="mt-6">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Zap className="size-4 text-amber-200" strokeWidth={1.8} />
                  {t("quotaAddUsage")}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("quotaAddUsageBody").replace("{date}", renews)}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {TOP_UP_PACKS.map((pack) => (
                    <button
                      key={pack.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(pack.id, () => openUsagePack(pack.id))}
                      className={cn(
                        "group relative flex flex-col items-start rounded-2xl border px-4 py-3 text-start transition disabled:opacity-60",
                        pack.badge
                          ? "border-amber-200/40 bg-amber-300/10 hover:bg-amber-300/15"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                      )}
                    >
                      {pack.badge ? (
                        <span className="absolute -top-2 end-3 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-[#1a1408]">
                          {t("quotaPackPopular")}
                        </span>
                      ) : null}
                      <span className="text-lg font-semibold tabular-nums text-white">
                        +{formatTokens(pack.tokens, locale)}
                      </span>
                      <span className="text-[11px] text-neutral-400">{ar ? pack.nameAr : pack.name}</span>
                      <span className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-100">
                        {busy === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                        ) : (
                          <Plus className="size-3.5" strokeWidth={2} />
                        )}
                        {formatPackPrice(pack, locale)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("upgrade", openUpgrade)}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-60"
              >
                <Sparkles className="size-3.5" strokeWidth={1.8} />
                {t("quotaPausedUpgrade")}
                <ExternalLink className="size-3 opacity-60" strokeWidth={1.8} />
              </button>
              {waitAllowed ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  <Check className="size-3.5" strokeWidth={1.8} />
                  {t("quotaOrWait").replace("{date}", renews)}
                </span>
              ) : null}
            </section>
          </>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate(href("/account"))}
            className="h-9 rounded-full border border-white/15 px-4 text-xs text-neutral-200 hover:bg-white/5"
          >
            {t("quotaPausedAccount")}
          </button>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="h-9 rounded-full border border-white/10 px-4 text-xs text-neutral-400 hover:text-white"
            >
              {t("quotaPausedRefresh")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
