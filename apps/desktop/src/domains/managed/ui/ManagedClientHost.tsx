import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { COMPANION_FOCUS_KEY, getCompanionState } from "@/domains/companions/companions";
import type { DeepLinkRoute } from "@/domains/managed/client/allowlist";
import { APP_VERSION, startManagedClient } from "@/domains/managed/client/client";
import {
  setForcedUpdate,
  setManagedMessage,
  setManagedPresence,
  useManagedState,
} from "@/domains/managed/client/store";
import { localized, type ActiveScreen } from "@/domains/managed/client/types";
import { maintenanceView } from "@/domains/managed/client/updates";
import { useRole } from "@/domains/account/roles/RoleProvider";
import { cn } from "@/shared/lib/utils";
import { BlockingUpdateOverlay } from "./BlockingUpdateOverlay";
import { openUpdatePanel, UpdatePanel } from "./UpdatePanel";

export const FOCUS_COMPANION_EVENT = "arrab:focus-companion";

/** Presence only reports which screen is open — never its content. */
export function screenForPath(pathname: string): ActiveScreen {
  const path = pathname.replace(/^\/(individuals|organizations)/, "") || "/";
  if (path === "/" || path.startsWith("/chat") || path.startsWith("/desk")) return "chat";
  if (path.startsWith("/board") || path.startsWith("/workplace")) return "home";
  if (path.startsWith("/studio") || path.startsWith("/workforce") || path.startsWith("/companions")) {
    return "companions";
  }
  if (path.startsWith("/work") || path.startsWith("/cowork") || path.startsWith("/activity")) return "work";
  if (path.startsWith("/settings") || path.startsWith("/account") || path.startsWith("/me")) return "settings";
  if (path.startsWith("/family")) return "family";
  return "other";
}

function findLocalCompanion(idOrAgent: string) {
  return getCompanionState().companions.find(
    (person) => !person.archivedAt && (person.id === idOrAgent || person.agentId === idOrAgent),
  );
}

type Consent = { resolve: (agreed: boolean) => void };

export function ManagedClientHost() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { href } = useRole();
  const state = useManagedState();
  const [consent, setConsent] = useState<Consent | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const navRef = useRef<(route: DeepLinkRoute) => void>(() => undefined);

  navRef.current = (route: DeepLinkRoute) => {
    if (route.kind === "usage") {
      navigate(href("/settings?tab=usage"));
      return;
    }
    if (route.kind === "update") {
      openUpdatePanel();
      return;
    }
    const person =
      route.kind === "companion"
        ? findLocalCompanion(route.id)
        : getCompanionState().companions.find(
            (item) => item.conversationId === route.conversationId,
          );
    if (person) {
      try {
        sessionStorage.setItem(COMPANION_FOCUS_KEY, person.id);
      } catch {
        // ignore
      }
      window.dispatchEvent(new CustomEvent(FOCUS_COMPANION_EVENT, { detail: person.id }));
    }
    navigate(href("/"));
  };

  useEffect(
    () =>
      startManagedClient({
        locale: () => localeRef.current,
        navigate: (route) => navRef.current(route),
        companionExists: (id) => Boolean(findLocalCompanion(id)),
        confirmLogUpload: () => new Promise<boolean>((resolve) => setConsent({ resolve })),
      }),
    [],
  );

  useEffect(() => {
    setManagedPresence({ activeScreen: screenForPath(location.pathname) });
  }, [location.pathname]);

  useEffect(() => {
    if (!state.forcedUpdate) return;
    openUpdatePanel({
      blocking: state.forcedUpdate.blocking,
      latestVersion: state.maintenance?.latestVersion,
      downloadUrl: state.maintenance?.downloadUrl,
    });
    if (!state.forcedUpdate.blocking) setForcedUpdate(null);
  }, [state.forcedUpdate, state.maintenance]);

  const view = maintenanceView(APP_VERSION, state.maintenance, Boolean(state.forcedUpdate?.blocking));
  const message = state.message;

  return (
    <>
      {view.updateMode === "blocking" ? <BlockingUpdateOverlay /> : null}
      <UpdatePanel />
      {message ? (
        <div className="mc-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="mc-message-title">
          <section className={cn("mc-dialog", `is-${message.severity}`)}>
            {message.title ? <h2 id="mc-message-title">{localized(message.title, locale)}</h2> : null}
            {message.body ? <p>{localized(message.body, locale)}</p> : null}
            <div className="mc-actions">
              <button type="button" className="mc-btn is-primary" onClick={() => setManagedMessage(null)}>
                {t("mcMessageOk")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {consent ? (
        <div className="mc-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="mc-logs-title">
          <section className="mc-dialog">
            <h2 id="mc-logs-title">{t("mcLogsTitle")}</h2>
            <p>{t("mcLogsBody")}</p>
            <div className="mc-actions">
              <button
                type="button"
                className="mc-btn"
                onClick={() => {
                  consent.resolve(false);
                  setConsent(null);
                }}
              >
                {t("mcLogsDecline")}
              </button>
              <button
                type="button"
                className="mc-btn is-primary"
                onClick={() => {
                  consent.resolve(true);
                  setConsent(null);
                }}
              >
                {t("mcLogsShare")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
