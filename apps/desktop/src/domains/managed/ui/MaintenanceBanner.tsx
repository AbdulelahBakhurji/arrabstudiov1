import { useState } from "react";
import { AlertTriangle, Info, Sparkles, Wrench, X } from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { APP_VERSION } from "@/domains/managed/client/client";
import type { CompanionAvailability } from "@/domains/managed/client/companions";
import { dismissSoftUpdate, useManagedState } from "@/domains/managed/client/store";
import { localized } from "@/domains/managed/client/types";
import { formatBackAt, maintenanceView, shouldShowSoftBanner } from "@/domains/managed/client/updates";
import { cn } from "@/shared/lib/utils";
import { openUpdatePanel } from "./UpdatePanel";

/** Top-of-app banner: read-only maintenance, notices, and soft updates. */
export function MaintenanceBanner() {
  const { t, locale } = useLanguage();
  const state = useManagedState();
  const [hiddenMessage, setHiddenMessage] = useState<string | null>(null);
  const { maintenance } = state;
  const view = maintenanceView(APP_VERSION, maintenance, Boolean(state.forcedUpdate?.blocking));
  const now = Date.now();

  if (view.updateMode === "blocking" && state.blockingCollapsed) {
    return (
      <div className="mc-banner is-critical" role="status">
        <AlertTriangle size={15} strokeWidth={1.9} className="shrink-0" />
        <span className="mc-banner-text">{t("mcUpdateRequiredBar")}</span>
        <button
          type="button"
          className="mc-banner-action"
          onClick={() =>
            openUpdatePanel({
              blocking: true,
              latestVersion: maintenance?.latestVersion,
              downloadUrl: maintenance?.downloadUrl,
            })
          }
        >
          {t("mcUpdateNow")}
        </button>
      </div>
    );
  }

  const message = localized(maintenance?.message, locale);
  if (view.readOnly || (view.showMessage && message && hiddenMessage !== message)) {
    const backAt = formatBackAt(maintenance?.until ?? null, locale === "ar" ? "ar-SA" : "en-US", now);
    const severity = maintenance?.severity ?? "info";
    return (
      <div
        className={cn(
          "mc-banner",
          severity === "critical" && "is-critical",
          severity === "warning" && "is-warning",
        )}
        role="status"
      >
        {view.readOnly ? (
          <Wrench size={15} strokeWidth={1.9} className="shrink-0" />
        ) : (
          <Info size={15} strokeWidth={1.9} className="shrink-0" />
        )}
        <span className="mc-banner-text">
          {message || t("mcReadOnlyDefault")}
          {backAt ? (
            <strong className="mc-banner-when">{t("mcBackAt").replace("{time}", backAt)}</strong>
          ) : null}
        </span>
        {!view.readOnly ? (
          <button
            type="button"
            className="mc-banner-close"
            aria-label={t("mcDismiss")}
            onClick={() => setHiddenMessage(message)}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    );
  }

  if (view.updateMode === "soft" && shouldShowSoftBanner(state.softDismissedAt, now)) {
    return (
      <div className="mc-banner is-update" role="status">
        <Sparkles size={15} strokeWidth={1.9} className="shrink-0" />
        <span className="mc-banner-text">
          {message || t("mcSoftTitle")}
          {maintenance?.latestVersion ? (
            <span className="mc-banner-when" dir="ltr">
              v{maintenance.latestVersion.replace(/^v/i, "")}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="mc-banner-action"
          onClick={() =>
            openUpdatePanel({
              latestVersion: maintenance?.latestVersion,
              downloadUrl: maintenance?.downloadUrl,
            })
          }
        >
          {t("mcUpdateNow")}
        </button>
        <button type="button" className="mc-banner-ghost" onClick={() => dismissSoftUpdate()}>
          {t("mcSoftLater")}
        </button>
      </div>
    );
  }

  return null;
}

/** Inline notice above the composer for one companion (disabled or under maintenance). */
export function CompanionNotice({ availability }: { availability: CompanionAvailability }) {
  const { t } = useLanguage();
  if (availability.enabled && !availability.maintenance) return null;
  return (
    <div className={cn("mc-inline", !availability.enabled && "is-off")} role="status">
      <Wrench size={14} strokeWidth={1.9} className="shrink-0" />
      <span>
        {!availability.enabled ? t("mcCompanionUnavailable") : null}
        {!availability.enabled && availability.maintenance ? " · " : null}
        {availability.maintenance}
      </span>
    </div>
  );
}

export function CompanionBadge({ badge }: { badge: "new" | "beta" | null }) {
  const { t } = useLanguage();
  if (!badge) return null;
  return (
    <span className={cn("mc-badge", badge === "beta" && "is-beta")}>
      {badge === "new" ? t("mcBadgeNew") : t("mcBadgeBeta")}
    </span>
  );
}
