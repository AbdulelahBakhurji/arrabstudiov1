import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  checkForAppUpdate,
  openAppUpdate,
  type AppUpdateInfo,
} from "@/lib/app-updates";
import { pushToast } from "@/lib/notify";
import { cn } from "@/lib/utils";

export function AppUpdatesPanel({ className }: { className?: string }) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async (silent = false) => {
    setChecking(true);
    setError(null);
    try {
      const next = await checkForAppUpdate();
      setInfo(next);
      if (!silent) {
        if (next.available) {
          pushToast({
            title: t("updateAvailable"),
            body: t("updateAvailableBody")
              .replace("{latest}", next.latestVersion)
              .replace("{current}", next.currentVersion),
            tone: "info",
          });
        } else {
          pushToast({
            title: t("updateUpToDate"),
            body: `v${next.currentVersion}`,
            tone: "success",
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("updateCheckFailed");
      setError(message);
      if (!silent) {
        pushToast({ title: t("updateCheckFailed"), body: message, tone: "warn" });
      }
    } finally {
      setChecking(false);
    }
  }, [t]);

  useEffect(() => {
    void runCheck(true);
  }, [runCheck]);

  const onUpdate = async () => {
    if (!info?.available) return;
    setUpdating(true);
    try {
      await openAppUpdate(info);
      pushToast({
        title: t("updateDownloadStarted"),
        body: info.assetName ?? info.latestVersion,
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: t("updateInstallFailed"),
        body: err instanceof Error ? err.message : undefined,
        tone: "warn",
      });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <article className={cn("sg-panel", className)}>
      <div className="sg-panel-head">
        <Sparkles className="size-4" strokeWidth={1.8} />
        <p className="sg-kicker">{t("settingsUpdates")}</p>
      </div>
      <p className="sg-body">{t("settingsUpdatesBody")}</p>
      <div className="sg-facts">
        <div className="sg-fact">
          <span>{t("updateCurrentVersion")}</span>
          <strong className="tabular-nums">v{info?.currentVersion ?? "—"}</strong>
        </div>
        <div className="sg-fact">
          <span>{t("updateLatestVersion")}</span>
          <strong className="tabular-nums">
            {info ? `v${info.latestVersion}` : checking ? "…" : "—"}
          </strong>
        </div>
        <div className="sg-fact">
          <span>{t("updateStatus")}</span>
          <strong>
            {checking
              ? t("updateChecking")
              : info?.available
                ? t("updateAvailable")
                : info
                  ? t("updateUpToDate")
                  : "—"}
          </strong>
        </div>
      </div>
      {info?.available && info.notes ? (
        <pre className="sg-update-notes" dir={ar ? "rtl" : "ltr"}>
          {info.notes.slice(0, 1200)}
        </pre>
      ) : null}
      {error ? <p className="sg-body">{error}</p> : null}
      <div className="sg-actions">
        <button
          type="button"
          className="sg-ghost"
          disabled={checking}
          onClick={() => void runCheck(false)}
        >
          <RefreshCw className={cn("size-3.5", checking && "animate-spin")} strokeWidth={1.9} />
          {checking ? t("updateChecking") : t("updateCheckNow")}
        </button>
        {info?.available ? (
          <button
            type="button"
            className="sg-cta"
            disabled={updating}
            onClick={() => void onUpdate()}
          >
            <Download className="size-3.5" strokeWidth={1.9} />
            {updating ? t("updateInstalling") : t("updateInstall")}
          </button>
        ) : null}
      </div>
    </article>
  );
}
