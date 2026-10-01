import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Zap } from "lucide-react";
import type { AccountEntitlements, TokenTopUpPackId } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { TOP_UP_PACKS, formatPackPrice, formatTokens, openUsagePack, watchForPayment } from "@/domains/account/billing-actions";
import { pushToast } from "@/shared/lib/notify";

/** "Add usage" before anyone is paused — Settings → Account. */
export function UsagePacksPanel({ entitlements }: { entitlements: AccountEntitlements }) {
  const { t, locale } = useLanguage();
  const [busy, setBusy] = useState<TokenTopUpPackId | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const latest = useRef(entitlements);
  latest.current = entitlements;

  useEffect(() => () => stopWatch.current?.(), []);

  if (!entitlements.connected || entitlements.canTopUp === false) return null;

  const renews = new Date(entitlements.periodEnd).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
  });
  const topUpTokens = entitlements.topUpTokens ?? 0;

  async function buy(packId: TokenTopUpPackId) {
    setBusy(packId);
    const before = latest.current.topUpTokens ?? 0;
    try {
      const opened = await openUsagePack(packId);
      pushToast({ title: t("quotaCheckoutOpened"), body: t("quotaCheckoutOpenedBody"), tone: "info" });
      stopWatch.current?.();
      stopWatch.current = watchForPayment(
        opened.invoiceId,
        () => (latest.current.topUpTokens ?? 0) > before,
        () => pushToast({ title: t("quotaPaymentReceived"), body: t("quotaPaymentReceivedBody"), tone: "success" }),
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

  return (
    <article className="sa-panel">
      <p className="sa-kicker inline-flex items-center gap-1.5">
        <Zap className="size-3.5" strokeWidth={1.8} />
        {t("quotaAddUsage")}
      </p>
      <p className="sa-panel-body">
        {t("quotaAddUsageBody").replace("{date}", renews)}
        {topUpTokens > 0 ? ` ${t("quotaIncludesPacks").replace("{tokens}", formatTokens(topUpTokens, locale))}.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {TOP_UP_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className="sa-ghost inline-flex items-center gap-1.5"
            disabled={busy !== null}
            onClick={() => void buy(pack.id)}
          >
            {busy === pack.id ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Plus className="size-3.5" strokeWidth={2} />
            )}
            <span className="tabular-nums">{formatTokens(pack.tokens, locale)}</span>
            <span className="opacity-60">· {formatPackPrice(pack, locale)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
