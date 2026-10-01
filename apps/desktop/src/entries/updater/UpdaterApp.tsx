import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, ArrowRight, Check, Download, Loader2 } from "lucide-react";
import appSymbol from "@/shared/assets/symbol.png";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { MessageKey } from "@/shared/i18n/messages";
import { cn } from "@/shared/lib/utils";

export type UpdaterStatus = {
  phase: "preparing" | "download" | "install" | "restart" | "error" | "";
  percent: number;
  received: number;
  total: number;
  currentVersion: string;
  targetVersion: string;
  message: string;
  fallbackUrl: string;
};

const PHASE_LABEL: Record<Exclude<UpdaterStatus["phase"], "">, MessageKey> = {
  preparing: "updPreparing",
  download: "updDownloading",
  install: "updInstalling",
  restart: "updRestarting",
  error: "updFailed",
};

const STEPS = ["download", "install", "restart"] as const;

function formatBytes(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    maximumFractionDigits: mb >= 100 ? 0 : 1,
  }).format(mb)} MB`;
}

export function UpdaterApp() {
  const { t, locale } = useLanguage();
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const speed = useRef<{ at: number; received: number; bps: number }>({ at: 0, received: 0, bps: 0 });

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void listen<UpdaterStatus>("app-updater:status", (event) => setStatus(event.payload)).then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    void invoke<UpdaterStatus>("app_update_status")
      .then((snapshot) => {
        if (!cancelled) setStatus((current) => current ?? snapshot);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!status || status.phase !== "download") return;
    const now = performance.now();
    const prev = speed.current;
    if (prev.at && now - prev.at > 600) {
      const instant = ((status.received - prev.received) * 1000) / (now - prev.at);
      speed.current = { at: now, received: status.received, bps: prev.bps ? prev.bps * 0.6 + instant * 0.4 : instant };
    } else if (!prev.at) {
      speed.current = { at: now, received: status.received, bps: 0 };
    }
  }, [status]);

  const phase = status?.phase || "preparing";
  const failed = phase === "error";
  const percent = phase === "download" ? status?.percent ?? 0 : phase === "preparing" ? 0 : 100;
  const indeterminate = phase === "preparing" || (phase === "download" && !status?.total);
  const stepIndex = STEPS.indexOf(phase as (typeof STEPS)[number]);
  const bps = speed.current.bps;
  const remaining =
    phase === "download" && status?.total && bps > 0
      ? Math.max(1, Math.round((status.total - status.received) / bps))
      : null;

  return (
    <div className="upd-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className={cn("upd-card", failed && "is-error")} data-tauri-drag-region>
        <header className="upd-head" data-tauri-drag-region>
          <span className={cn("upd-mark", !failed && phase !== "restart" && "is-busy")}>
            <img src={appSymbol} alt="" draggable={false} />
          </span>
          <div className="upd-head-copy" data-tauri-drag-region>
            <h1>{t("updWindowTitle")}</h1>
            <p dir="ltr">
              {status?.currentVersion ? `v${status.currentVersion}` : ""}
              {status?.targetVersion ? (
                <>
                  <ArrowRight size={12} strokeWidth={2} className="upd-arrow" />v{status.targetVersion}
                </>
              ) : null}
            </p>
          </div>
        </header>

        {failed ? (
          <div className="upd-error" role="alert">
            <AlertTriangle size={16} strokeWidth={1.9} />
            <div>
              <p className="upd-error-title">{t("updFailed")}</p>
              <p className="upd-error-body">{status?.message}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="upd-status" role="status" aria-live="polite">
              <span className="upd-phase">
                {phase === "restart" ? (
                  <Check size={14} strokeWidth={2.2} />
                ) : phase === "download" ? (
                  <Download size={14} strokeWidth={2} />
                ) : (
                  <Loader2 size={14} strokeWidth={2} className="upd-spin" />
                )}
                {t(PHASE_LABEL[phase as keyof typeof PHASE_LABEL] ?? "updPreparing")}
              </span>
              {phase === "download" && status?.total ? (
                <span className="upd-percent">{percent}%</span>
              ) : null}
            </div>
            <div
              className={cn("upd-track", indeterminate && "is-indeterminate")}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={indeterminate ? undefined : percent}
            >
              <div className="upd-fill" style={{ width: indeterminate ? undefined : `${Math.max(percent, 2)}%` }} />
            </div>
            <div className="upd-meta">
              <span dir="ltr">
                {phase === "download" && status?.received
                  ? status.total
                    ? `${formatBytes(status.received, locale)} / ${formatBytes(status.total, locale)}`
                    : formatBytes(status.received, locale)
                  : "\u00a0"}
              </span>
              <span>
                {remaining !== null
                  ? t("updTimeLeft").replace(
                      "{time}",
                      remaining >= 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining} s`,
                    )
                  : ""}
              </span>
            </div>
            <ol className="upd-steps">
              {STEPS.map((step, index) => (
                <li
                  key={step}
                  className={cn(
                    "upd-step",
                    stepIndex > index && "is-done",
                    stepIndex === index && "is-current",
                  )}
                >
                  <span className="upd-step-dot">{stepIndex > index ? <Check size={10} strokeWidth={3} /> : null}</span>
                  {t(step === "download" ? "updStepDownload" : step === "install" ? "updStepInstall" : "updStepRelaunch")}
                </li>
              ))}
            </ol>
          </>
        )}

        <footer className="upd-foot">
          {failed ? (
            <>
              <button
                type="button"
                className="upd-btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void invoke("app_update_open_download").finally(() => setBusy(false));
                }}
              >
                <Download size={14} strokeWidth={1.9} />
                {t("updOpenDownload")}
              </button>
              <button
                type="button"
                className="upd-btn is-primary"
                disabled={busy}
                onClick={() => void invoke("app_update_dismiss")}
              >
                {t("updBack")}
              </button>
            </>
          ) : (
            <p className="upd-note">{t("updKeepOpen")}</p>
          )}
        </footer>
      </section>
    </div>
  );
}
