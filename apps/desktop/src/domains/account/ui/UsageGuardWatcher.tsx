import { useEffect, useRef } from "react";
import type { TokenUsageLevel } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { useRole } from "@/domains/account/roles/RoleProvider";
import { formatTokens } from "@/domains/account/billing-actions";
import { postNativeNotification, pushToast } from "@/domains/notifications/notify";
import { refreshAccountStatus, useSignedInAccount } from "@/domains/account/use-signed-in-account";

const NOTIFIED_KEY = "arrab.usageGuard.notified";
const RANK: Record<TokenUsageLevel, number> = { ok: 0, low: 1, critical: 2, exhausted: 3 };
const FOCUS_REFRESH_GAP_MS = 60_000;

function readNotified(): { periodEnd: string; level: TokenUsageLevel } | null {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as { periodEnd: string; level: TokenUsageLevel }) : null;
  } catch {
    return null;
  }
}

function writeNotified(periodEnd: string, level: TokenUsageLevel) {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify({ periodEnd, level }));
  } catch {
    // ignore
  }
}

/**
 * Token guard early warnings: tells people at 80% and 95% of their pool (toast +
 * OS notification, once per level per period), when AI pauses, and when it resumes.
 * Keeps usage fresh while the app is open so warnings land before the pause does.
 */
export function UsageGuardWatcher() {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const { status, signedIn } = useSignedInAccount();
  const entitlements = status?.entitlements;
  const wasPaused = useRef<boolean | null>(null);

  const level: TokenUsageLevel | null = entitlements?.connected ? (entitlements.usageLevel ?? null) : null;
  const tight = level === "low" || level === "critical";

  const pausedNow =
    Boolean(entitlements?.overLimit) || entitlements?.pauseMode != null;

  useEffect(() => {
    if (!signedIn) return;
    let lastRefresh = Date.now();
    const refresh = () => {
      lastRefresh = Date.now();
      void refreshAccountStatus({ silent: true });
    };
    // While paused / over limit, poll faster so website checkout applies immediately on return.
    const interval = setInterval(refresh, pausedNow || tight ? 30_000 : 5 * 60_000);
    const onFocus = () => {
      const gap = pausedNow ? 2_000 : FOCUS_REFRESH_GAP_MS;
      if (Date.now() - lastRefresh >= gap) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, tight, pausedNow]);

  useEffect(() => {
    if (!signedIn || !entitlements?.connected || !level) return;
    const paused = Boolean(entitlements.overLimit) || entitlements.pauseMode != null;

    if (wasPaused.current === true && !paused) {
      pushToast({ title: t("quotaPaymentReceived"), body: t("quotaResumedBody"), tone: "success" });
      void postNativeNotification({
        title: t("quotaPaymentReceived"),
        body: t("quotaResumedBody"),
        tag: "arrab-usage-resumed",
      });
    }
    wasPaused.current = paused;

    const notified = readNotified();
    const already = notified?.periodEnd === entitlements.periodEnd ? RANK[notified.level] : 0;
    if (RANK[level] < already) {
      // A usage pack or upgrade lowered usage; warn again if it climbs back.
      writeNotified(entitlements.periodEnd, level);
      return;
    }
    if (RANK[level] === already) return;
    writeNotified(entitlements.periodEnd, level);

    const remaining = formatTokens(entitlements.tokensRemaining ?? 0, locale);
    const planName = entitlements.planName;
    const message =
      level === "exhausted"
        ? {
            title: t("usageExhaustedTitle"),
            body:
              entitlements.pauseMode === "payment_required"
                ? t("usageRenewalDueBody").replace("{plan}", planName)
                : t("usageExhaustedBody").replace("{plan}", planName),
          }
        : level === "critical"
          ? { title: t("usageCriticalTitle"), body: t("usageCriticalBody").replace("{tokens}", remaining) }
          : { title: t("usageLowTitle"), body: t("usageLowBody").replace("{tokens}", remaining) };

    if (level !== "exhausted") {
      pushToast({ ...message, tone: "warn", href: href("/account") });
    }
    void postNativeNotification({ ...message, tag: `arrab-usage-${level}` });
  }, [signedIn, entitlements, level, locale, t, href]);

  return null;
}
