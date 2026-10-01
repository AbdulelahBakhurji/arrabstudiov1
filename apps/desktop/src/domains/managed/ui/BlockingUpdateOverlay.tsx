import { ShieldAlert } from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { clearAccountSession } from "@/core/session/account-session";
import { arrabApi } from "@/core/api/api";
import { localized } from "@/domains/managed/client/types";
import { setBlockingCollapsed, useManagedState } from "@/domains/managed/client/store";
import { openUpdatePanel } from "./UpdatePanel";

/**
 * Below `minVersion` (or a blocking `force_update`): full-screen until the user
 * chooses to read their chats. Sending stays disabled either way.
 */
export function BlockingUpdateOverlay() {
  const { t, locale } = useLanguage();
  const { maintenance, blockingCollapsed } = useManagedState();
  if (blockingCollapsed) return null;
  const message = localized(maintenance?.message, locale);

  return (
    <div className="mc-blocking" role="alertdialog" aria-modal="true" aria-labelledby="mc-blocking-title">
      <section className="mc-blocking-card">
        <span className="mc-blocking-icon" aria-hidden>
          <ShieldAlert size={22} strokeWidth={1.8} />
        </span>
        <h2 id="mc-blocking-title">{t("mcBlockingTitle")}</h2>
        <p>{message || t("mcBlockingBody")}</p>
        {message ? <p className="mc-muted">{t("mcBlockingBody")}</p> : null}
        <div className="mc-actions is-stacked">
          <button
            type="button"
            className="mc-btn is-primary"
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
          <button type="button" className="mc-btn" onClick={() => setBlockingCollapsed(true)}>
            {t("mcReadChats")}
          </button>
          <button
            type="button"
            className="mc-btn is-quiet"
            onClick={() => {
              void arrabApi.logoutAccount().catch(() => undefined);
              clearAccountSession();
            }}
          >
            {t("mcSignOut")}
          </button>
        </div>
      </section>
    </div>
  );
}
