import { useNavigate } from "react-router-dom";
import { Gauge, Sparkles } from "lucide-react";
import type { AccountEntitlements } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { openPlansPage } from "@/lib/desktop";

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

  const used = entitlements.tokensUsed.toLocaleString(locale === "ar" ? "ar-SA" : "en-US");
  const limit =
    entitlements.tokenLimit === null
      ? t("unlimitedTokens")
      : entitlements.tokenLimit.toLocaleString(locale === "ar" ? "ar-SA" : "en-US");
  const renews = new Date(entitlements.periodEnd).toLocaleDateString(
    locale === "ar" ? "ar-SA" : "en-US",
    { month: "short", day: "numeric", year: "numeric" },
  );
  const waitAllowed = entitlements.pauseMode === "upgrade_or_wait";

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--color-background)] px-6">
      <div className="quota-pause-rise w-full max-w-lg rounded-[28px] border border-amber-300/25 bg-gradient-to-br from-[#1a1610] via-[#12100c] to-[#0a0e14] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-100">
          <Gauge className="size-3.5" strokeWidth={1.8} />
          {t("quotaPausedEyebrow")}
        </div>
        <h1 className="mt-4 text-2xl font-medium tracking-[-0.03em] text-white">
          {t("quotaPausedTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          {waitAllowed
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
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void openPlansPage()}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-amber-200 px-5 text-sm font-medium text-[#1a1408] hover:bg-amber-100"
          >
            <Sparkles className="size-3.5" strokeWidth={1.8} />
            {t("quotaPausedUpgrade")}
          </button>
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
