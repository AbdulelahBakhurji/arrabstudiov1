import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import {
  checkForAppUpdate,
  startDesktopUpdate,
  type AppUpdateInfo,
} from "@/domains/managed/app-updates";
import { requestInAppUpdate } from "@/domains/managed/ui/UpdatePanel";
import { readPrefs, subscribePrefs } from "@/shared/lib/prefs";
import { pushToast } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";

const DISMISS_KEY = "arrab.updates.bannerDismissed";
const CHECK_EVENT = "arrab:update-check-result";

export function publishUpdateCheckResult(info: AppUpdateInfo | null): void {
  window.dispatchEvent(new CustomEvent(CHECK_EVENT, { detail: info }));
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {
    // ignore
  }
}

/**
 * Persistent strip when a newer desktop build is available.
 * Complements the toast/OS notification from AppUpdateWatcher.
 */
export function UpdateAvailableBanner() {
  const { t } = useLanguage();
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(() => readPrefs().autoCheckUpdates);

  useEffect(() => subscribePrefs((prefs) => setEnabled(prefs.autoCheckUpdates)), []);

  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AppUpdateInfo | null>).detail;
      setInfo(detail && detail.available ? detail : null);
    };
    window.addEventListener(CHECK_EVENT, onResult);
    return () => window.removeEventListener(CHECK_EVENT, onResult);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkForAppUpdate()
        .then((next) => {
          if (!cancelled && next.available) setInfo(next);
        })
        .catch(() => undefined);
    }, 6_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  if (!info?.available) return null;
  if (readDismissed() === info.latestVersion) return null;

  const install = async () => {
    setBusy(true);
    try {
      if (!(await startDesktopUpdate(info))) requestInAppUpdate(info);
    } catch (err) {
      pushToast({
        title: t("updateInstallFailed"),
        body: err instanceof Error ? err.message : undefined,
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "mb-2 flex shrink-0 items-center gap-3 rounded-xl border border-emerald-400/25",
        "bg-emerald-500/10 px-3 py-2 text-xs text-emerald-50",
      )}
      role="status"
    >
      <Download className="size-3.5 shrink-0" strokeWidth={1.8} />
      <p className="min-w-0 flex-1">
        {t("updateAvailableBody")
          .replace("{latest}", info.latestVersion)
          .replace("{current}", info.currentVersion)}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void install()}
        className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black disabled:opacity-50"
      >
        {busy ? t("updateInstallingNow") : t("updateInstall")}
      </button>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-emerald-100/70 hover:bg-white/10 hover:text-white"
        aria-label={t("close")}
        onClick={() => {
          writeDismissed(info.latestVersion);
          setInfo(null);
        }}
      >
        <X className="size-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
