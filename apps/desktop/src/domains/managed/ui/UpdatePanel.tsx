import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { checkForAppUpdate, startDesktopUpdate, type AppUpdateInfo } from "@/domains/managed/app-updates";
import { APP_VERSION } from "@/domains/managed/client/client";
import { getDeviceIdentity } from "@/domains/managed/client/device";
import { getManagedState } from "@/domains/managed/client/store";
import {
  prepareUpdate,
  type PreparedUpdate,
  type UpdateProgress,
} from "@/domains/managed/client/update-runner";

const OPEN_EVENT = "arrab:open-update-panel";

type OpenRequest = { latestVersion?: string | null; downloadUrl?: string | null; blocking?: boolean };

/** Open the update panel from anywhere (banner, overlay, deep link, command). */
export function openUpdatePanel(request: OpenRequest = {}): void {
  window.dispatchEvent(new CustomEvent<OpenRequest>(OPEN_EVENT, { detail: request }));
}

/** Settings → About "Update and restart" hands over the GitHub release it found. */
export function requestInAppUpdate(info: AppUpdateInfo): void {
  openUpdatePanel({ latestVersion: info.latestVersion, downloadUrl: info.downloadUrl });
}

async function resolveDownloadUrl(explicit: string | null | undefined): Promise<{
  url: string | null;
  latest: string | null;
}> {
  const maintenance = getManagedState().maintenance;
  const url = explicit ?? maintenance?.downloadUrl ?? null;
  if (url) return { url, latest: maintenance?.latestVersion ?? null };
  try {
    const info = await checkForAppUpdate();
    return { url: info.available ? info.downloadUrl : null, latest: info.latestVersion };
  } catch {
    return { url: null, latest: maintenance?.latestVersion ?? null };
  }
}

export function UpdatePanel() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ phase: "checking", percent: 0 });
  const [prepared, setPrepared] = useState<PreparedUpdate | null>(null);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);

  const start = useCallback(async (request: OpenRequest) => {
    if (running.current) return;
    running.current = true;
    setOpen(true);
    setFailed(false);
    setPrepared(null);
    setProgress({ phase: "checking", percent: 0 });
    try {
      const identity = await getDeviceIdentity();
      const { url, latest: found } = await resolveDownloadUrl(request.downloadUrl);
      setLatest(request.latestVersion ?? found);
      if (url && (await startDesktopUpdate({ downloadUrl: url, latestVersion: request.latestVersion ?? found ?? "" }))) {
        setOpen(false);
        return;
      }
      const result = await prepareUpdate({
        platform: identity.platform,
        vendor: identity.vendor,
        downloadUrl: url,
        onProgress: setProgress,
      });
      setPrepared(result);
      if (result.kind === "none") setFailed(true);
      if (result.kind === "external") setOpen(false);
    } catch {
      setFailed(true);
      setProgress((prev) => ({ ...prev, phase: "error" }));
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => void start((event as CustomEvent<OpenRequest>).detail ?? {});
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [start]);

  if (!open) return null;

  const label = failed
    ? t("mcUpdateUnavailable")
    : progress.phase === "checking"
      ? t("mcChecking")
      : progress.phase === "ready"
        ? t("mcUpdateReady")
        : progress.phase === "install"
          ? t("updateInstallingNow")
          : progress.phase === "restart"
            ? t("updateRestarting")
            : progress.phase === "store"
              ? t("mcOpenedStore")
              : t("updateDownloading");

  const busy = !failed && progress.phase !== "ready";

  return (
    <div className="update-progress-backdrop mc-layer-top" role="dialog" aria-modal="true" aria-label={t("updateProgressTitle")}>
      <section className="sg-panel update-progress-card">
        <p className="sg-kicker">{t("updateProgressTitle")}</p>
        <h2 className="update-progress-title" dir="ltr">
          v{APP_VERSION}
          {latest ? ` → v${latest.replace(/^v/i, "")}` : ""}
        </h2>
        <div
          className="update-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <div
            className="update-progress-fill"
            style={{ width: `${failed ? 0 : Math.min(100, progress.percent)}%` }}
          />
        </div>
        <p className="sg-body" role="status">
          {label}
          {progress.phase === "download" && !failed ? ` · ${progress.percent}%` : ""}
        </p>
        <div className="mc-actions">
          {prepared?.kind === "signed" && progress.phase === "ready" ? (
            <button
              type="button"
              className="mc-btn is-primary"
              onClick={() => {
                void prepared.installAndRestart().catch(() => {
                  setFailed(true);
                  setProgress((prev) => ({ ...prev, phase: "error" }));
                });
              }}
            >
              {t("mcInstallRestart")}
            </button>
          ) : null}
          {!busy || failed ? (
            <button type="button" className="mc-btn" onClick={() => setOpen(false)}>
              {t("updateClose")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
