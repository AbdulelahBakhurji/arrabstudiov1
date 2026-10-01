import { useLanguage } from "@/i18n/LanguageProvider";
import { ARRAB_PLANS_URL, openExternalUrl } from "@/lib/desktop";
import type { LimitStatus } from "@/lib/managed-client/limits";
import { useManagedState } from "@/lib/managed-client/store";
import { limitStatus } from "@/lib/managed-client/limits";
import { cn } from "@/lib/utils";

function formatReset(iso: string | null, locale: string): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

function UpgradeLink() {
  const { t } = useLanguage();
  return (
    <button type="button" className="mc-link" onClick={() => void openExternalUrl(ARRAB_PLANS_URL)}>
      {t("mcUpgrade")}
    </button>
  );
}

/** Subtle composer meter: warns at 80% / 95%, explains the block at 100%. */
export function UsageMeter({ status }: { status: LimitStatus }) {
  const { t, locale } = useLanguage();
  const { serverLimitMessage } = useManagedState();

  if (serverLimitMessage) {
    return (
      <div className="mc-meter is-blocked" role="status">
        <span className="mc-meter-text">{serverLimitMessage}</span>
        <UpgradeLink />
      </div>
    );
  }
  if (!status.worst) return null;
  const pct = Math.min(100, Math.round(status.worst.ratio * 100));
  const text =
    status.level === "blocked"
      ? t("mcUsageBlocked").replace("{time}", formatReset(status.resetsAt, locale) || "—")
      : status.level === "warn95"
        ? t("mcUsageWarn95").replace("{pct}", String(pct))
        : status.level === "warn80"
          ? t("mcUsageWarn80").replace("{pct}", String(pct))
          : null;

  return (
    <div
      className={cn(
        "mc-meter",
        status.level === "warn80" && "is-warn",
        status.level === "warn95" && "is-high",
        status.level === "blocked" && "is-blocked",
      )}
      role={text ? "status" : undefined}
    >
      <span className="mc-meter-track" aria-hidden>
        <span className="mc-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      {text ? <span className="mc-meter-text">{text}</span> : null}
      {status.level === "blocked" || status.level === "warn95" ? <UpgradeLink /> : null}
    </div>
  );
}

function numberText(value: number | null, locale: string, unlimited: string): string {
  if (value === null) return unlimited;
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US").format(value);
}

/** Settings → Usage card with the plan limits Arrab Control sent. */
export function PlanLimitsCard() {
  const { t, locale } = useLanguage();
  const { config } = useManagedState();
  const limits = config?.limits;
  if (!limits) return null;
  const status = limitStatus(limits);
  const unlimited = t("mcUsageUnlimited");
  const rows: Array<{ label: string; used: number | null; limit: number | null; suffix?: string }> = [
    { label: t("mcUsageMessagesToday"), used: limits.messagesUsedToday, limit: limits.messagesPerDay },
    { label: t("mcUsageTokensMonth"), used: limits.tokensUsedThisMonth, limit: limits.tokensPerMonth },
  ];
  return (
    <section className="mc-limits">
      <header className="mc-limits-head">
        <strong>{t("mcUsagePlanLimits")}</strong>
        {limits.plan ? <span className="mc-badge">{limits.plan}</span> : null}
        {limits.resetsAt ? (
          <span className="mc-muted">{t("mcUsageResets").replace("{time}", formatReset(limits.resetsAt, locale))}</span>
        ) : null}
      </header>
      {rows.map((row) => {
        const ratio = row.limit && row.used !== null ? Math.min(1, row.used / row.limit) : 0;
        return (
          <div key={row.label} className="mc-limits-row">
            <span>{row.label}</span>
            <span className="mc-limits-value" dir="ltr">
              {numberText(row.used, locale, "0")} / {numberText(row.limit, locale, unlimited)}
            </span>
            <span className="mc-meter-track" aria-hidden>
              <span
                className={cn("mc-meter-fill", ratio >= 0.95 ? "is-high" : ratio >= 0.8 ? "is-warn" : null)}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
          </div>
        );
      })}
      <div className="mc-limits-row is-plain">
        <span>{t("mcUsageAttachments")}</span>
        <span className="mc-limits-value" dir="ltr">
          {limits.maxAttachmentsMb === null ? unlimited : `${limits.maxAttachmentsMb} MB`}
        </span>
      </div>
      <div className="mc-limits-row is-plain">
        <span>{t("mcUsageCompanions")}</span>
        <span className="mc-limits-value" dir="ltr">
          {numberText(limits.maxCompanions, locale, unlimited)}
        </span>
      </div>
      {status.level !== "ok" ? (
        <div className="mc-actions">
          <UpgradeLink />
        </div>
      ) : null}
    </section>
  );
}
