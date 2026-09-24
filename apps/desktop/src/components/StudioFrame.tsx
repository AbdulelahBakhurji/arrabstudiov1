import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Languages, Moon, Sun, User } from "lucide-react";
import { ToastHost } from "@/components/ToastHost";
import { AppUpdateWatcher } from "@/components/AppUpdateWatcher";
import { AgentPresenceHost } from "@/components/AgentPresenceHost";
import { PresenceApprovalBridge } from "@/components/PresenceApprovalBridge";
import { GettingStartedRailHelp } from "@/components/GettingStartedDock";
import { QuotaPauseScreen } from "@/components/QuotaPauseScreen";
import { TOKEN_GUARD_EVENT } from "@/lib/token-guard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import logoTall from "@/assets/logotall.png";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi } from "@/lib/api";
import { initialsFromName, subscribeAccountSession } from "@/lib/account-session";
import { syncCompanionsFromCloud } from "@/lib/companions";
import { useProfilePhoto } from "@/lib/profile-photo";
import { setAlwaysOnTop, openExternalUrl } from "@/lib/desktop";
import { notifyStudio } from "@/lib/notify";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { audienceFromPlanId, homePathForPlanId, navForRole, studioModeFromPlanId } from "@/roles/catalog";
import { useRole } from "@/roles/RoleProvider";
import { readPrefs } from "@/lib/prefs";
import {
  clearGuestLocalMode,
  isGuestLocalMode,
  subscribeGuestMode,
} from "@/lib/guest-mode";
import { isTauriRuntime } from "@/lib/terminal";
import { GuardianCoachingHost } from "@/components/GuardianCoachingHost";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@arrab/shared";

function isQuotaEscapePath(pathname: string): boolean {
  return /\/(settings|account)(\/|$)/.test(pathname);
}

function pathForMenuAction(
  id: string,
  opts: {
    href: (path: string) => string;
    isOrganization: boolean;
  },
): string | null {
  const { href, isOrganization } = opts;
  switch (id) {
    case "nav-hq":
      return href("/");
    case "nav-workplace":
      return isOrganization ? href("/workplace") : href("/studio");
    case "nav-chat":
      return isOrganization ? href("/chat") : href("/");
    case "nav-workforce":
      return isOrganization ? href("/workforce") : href("/work");
    case "nav-connectors":
      return href("/connectors");
    case "nav-activity":
      return isOrganization ? href("/activity") : href("/board");
    case "nav-settings":
      return href("/settings");
    case "file-new-chat":
      return isOrganization ? href("/chat") : href("/");
    case "file-connect-folder":
      return isOrganization ? href("/workplace") : href("/studio");
    case "help-getting-started":
      return href("/settings");
    default:
      return null;
  }
}

export function StudioFrame() {
  const { t, toggleLocale, locale, dir } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { role, href, isOrganization, isFamily, setRole } = useRole();
  const { isPaused: familyPaused } = useFamilyProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const { account, status, refresh: refreshSignedIn, signedIn } = useSignedInAccount();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [accountUser, setAccountUser] = useState<AccountPublic | null>(null);
  const profilePhoto = useProfilePhoto();
  const [pendingCount, setPendingCount] = useState(0);
  const lastPendingRef = useRef<number | null>(null);
  const [guestLocal, setGuestLocal] = useState(() => isGuestLocalMode());
  const entitlements = status?.entitlements;
  const paused =
    signedIn &&
    Boolean(entitlements?.overLimit) &&
    !isQuotaEscapePath(location.pathname);

  const modes = useMemo(
    () =>
      navForRole(role)
        // Connectors require a verified cloud account — not a stale device token.
        .filter((item) => (account ? true : item.key !== "connectors"))
        .map((item) => ({
          to: href(item.path || "/"),
          key: item.key,
          icon: item.icon,
          end: Boolean(item.end),
        })),
    [href, role, account],
  );

  const paletteItems = useMemo(
    () => [...modes, { to: href("/account"), key: "amTitle" as const, icon: User, end: false }],
    [modes, href],
  );

  // Mode follows subscription / free-trial plan — locked to that audience only.
  useEffect(() => {
    if (!signedIn || !account) {
      if (role === "family") setRole("individual");
      return;
    }
    const planId = account.planId ?? status?.entitlements?.planId ?? null;
    if (!planId) return;
    const expectedAudience = audienceFromPlanId(planId);
    if (expectedAudience !== role) {
      setRole(expectedAudience);
    }
    const expectedShell = studioModeFromPlanId(planId);
    const expectedHome = homePathForPlanId(planId);
    const onWrongShell =
      (expectedShell === "organization" && location.pathname.includes("/individuals")) ||
      (expectedShell === "individual" && location.pathname.includes("/organizations"));
    if (onWrongShell) {
      navigate(expectedHome, { replace: true });
    }
  }, [
    signedIn,
    account,
    account?.planId,
    location.pathname,
    navigate,
    role,
    setRole,
    status?.entitlements?.planId,
  ]);

  const refreshAccount = () => {
    void arrabApi
      .account()
      .then((status) => {
        if (!account || isGuestLocalMode()) {
          setAccountUser(null);
          return;
        }
        setAccountUser(status.account);
      })
      .catch(() => {
        setAccountUser(null);
      });
  };

  useEffect(() => {
    refreshAccount();
    void syncCompanionsFromCloud();
    return subscribeAccountSession(() => {
      refreshAccount();
      void syncCompanionsFromCloud();
    });
  }, []);

  useEffect(() => {
    const onGuard = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind === "quota") {
        refreshSignedIn();
      }
    };
    window.addEventListener(TOKEN_GUARD_EVENT, onGuard);
    return () => window.removeEventListener(TOKEN_GUARD_EVENT, onGuard);
  }, [refreshSignedIn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        navigate(href("/settings"));
        setPaletteOpen(false);
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleTheme();
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        toggleLocale();
      }
      if (meta && !event.shiftKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        navigate(href("/account"));
        setPaletteOpen(false);
      }
      if (meta && !event.shiftKey && event.key >= "1" && event.key <= "7") {
        event.preventDefault();
        const target = modes[Number(event.key) - 1];
        if (target) {
          navigate(target.to);
          setPaletteOpen(false);
        }
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, modes, navigate, toggleLocale, toggleTheme]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    void setAlwaysOnTop(readPrefs().desktopAlwaysOnTop).catch(() => undefined);
  }, []);

  useEffect(() => subscribeGuestMode(() => setGuestLocal(isGuestLocalMode())), []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      return listen<string>("arrab:menu", (event) => {
        const id = event.payload;
        if (id === "view-reload") {
          window.location.reload();
          return;
        }
        if (id === "help-website") {
          void openExternalUrl("https://arrabai.com");
          return;
        }
        if (id === "file-connect-folder") {
          window.dispatchEvent(new CustomEvent("arrab:connect-folder"));
        }
        const path = pathForMenuAction(id, { href, isOrganization });
        if (path) {
          navigate(path);
          setPaletteOpen(false);
        }
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [href, isOrganization, navigate]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const pending = await arrabApi.pendingApprovals();
        if (cancelled) {
          return;
        }
        const count = pending.items.length;
        setPendingCount(count);
        if (lastPendingRef.current !== null && count > lastPendingRef.current) {
          const first = pending.items[0];
          void notifyStudio({
            kind: "approvals",
            title: first?.title ?? t("pendingApprovals"),
            body: first?.detail ?? t("approvalNotifyBody").replace("{count}", String(count)),
            href: href("/workforce"),
            agentName: "Arrab",
            presenceState: "needs_you",
            progress: 0.8,
            approvalId: first?.id ?? null,
          });
        }
        lastPendingRef.current = count;
      } catch {
        // offline — ignore
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [href, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return paletteItems;
    }
    return paletteItems.filter(
      (mode) => t(mode.key).toLowerCase().includes(q) || mode.to.includes(q),
    );
  }, [paletteItems, query, t]);

  return (
    <div className={cn("app-shell companion-app flex h-full max-h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-background text-foreground")} dir={dir}>
      <header
        data-tauri-drag-region
        dir="ltr"
        className="app-toolbar relative z-40 flex h-11 shrink-0 items-center border-b border-white/[0.08] bg-[var(--color-surface)] px-3"
      >
        <div className="w-[76px] shrink-0" aria-hidden="true" />
        <img
          src={logoTall}
          alt={t("brand")}
          className="brand-mark h-[26px] w-auto max-w-[150px] object-contain object-left"
        />
        <div className="no-drag ml-auto flex items-center gap-2">
          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleLocale}
                aria-label={t("languageHint")}
                className="inline-flex size-8 items-center justify-center rounded-md border border-white/10 text-white hover:bg-white/5"
              >
                <Languages className="size-4" strokeWidth={1.7} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {t("languageHint")}
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? t("themeToLight") : t("themeToDark")}
                className="inline-flex size-8 items-center justify-center rounded-md border border-white/10 text-white hover:bg-white/5"
              >
                {theme === "dark" ? (
                  <Sun className="size-4" strokeWidth={1.7} />
                ) : (
                  <Moon className="size-4" strokeWidth={1.7} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {theme === "dark" ? t("themeToLight") : t("themeToDark")}
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setPaletteOpen(false);
                  navigate(href("/account"));
                }}
                aria-label={t("amTitle")}
                className={cn(
                  "inline-flex size-8 items-center justify-center overflow-hidden rounded-md border border-white/10 text-white hover:bg-white/5",
                  accountUser && "border-emerald-400/30",
                )}
              >
                {profilePhoto ? (
                  <img src={profilePhoto} alt="" className="size-full object-cover" />
                ) : accountUser ? (
                  <span className="text-[10px] font-semibold tracking-wide">
                    {initialsFromName(accountUser.displayName, accountUser.email)}
                  </span>
                ) : (
                  <User className="size-4" strokeWidth={1.7} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {t("amTitle")}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <nav
          aria-label={t("brand")}
          className="studio-rail no-drag absolute top-1/2 z-30 flex -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/60 p-2 shadow-2xl backdrop-blur-md"
          // Aligned so the rail's icon column sits directly under the header's
          // account avatar (measured empirically — the two containers use
          // different padding models, so equal insets don't equal centers).
          style={{ insetInlineStart: "8px" }}
        >
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Tooltip key={mode.to} delayDuration={120}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={mode.to}
                    end={mode.end}
                    aria-label={t(mode.key)}
                    className={({ isActive }) =>
                      cn(
                        "mx-auto flex flex-col items-center justify-center rounded-xl transition-colors",
                        "h-10 w-10 shrink-0",
                        isActive
                          ? "bg-white text-black"
                          : "text-neutral-500 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    <span className="relative">
                      <Icon className="size-[18px]" strokeWidth={1.7} />
                      {mode.key === "workforce" && pendingCount > 0 ? (
                        <span className="absolute -end-1 -top-1 size-2 rounded-full bg-amber-300" />
                      ) : null}
                    </span>
                    <span className="cp-nav-label">{t(mode.key)}</span>
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side={dir === "rtl" ? "left" : "right"} sideOffset={12}>
                  {t(mode.key)}
                </TooltipContent>
              </Tooltip>
            );
          })}
          <div className="gs-rail-help-wrap">
            <GettingStartedRailHelp tooltipSide={dir === "rtl" ? "left" : "right"} />
          </div>
        </nav>

        <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden ps-[96px] pe-3 pb-3">
          {guestLocal && !account ? (
            <div className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
              <span>{t("guestLocalBanner")}</span>
              <button
                type="button"
                className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black"
                onClick={() => {
                  clearGuestLocalMode();
                  navigate(href("/settings?tab=account"));
                }}
              >
                {t("signInWithBrowser")}
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
          {signedIn && isFamily && familyPaused ? (
            <div className="grid h-full place-items-center rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-white">
              <div className="max-w-md space-y-2">
                <h2 className="text-xl font-semibold">{t("familyProfilePaused")}</h2>
                <p className="text-sm text-white/70">{t("familyPausedBody")}</p>
              </div>
            </div>
          ) : paused && entitlements ? (
            <QuotaPauseScreen entitlements={entitlements} onRefresh={refreshSignedIn} />
          ) : (
            <Outlet />
          )}
          </div>
        </main>
      </div>

      {paletteOpen ? (
        <div
          className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-white/8 px-4 py-3">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-neutral-600"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {filtered.map((mode) => {
                const Icon = mode.icon;
                return (
                  <li key={`${mode.to}-${mode.key}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
                      onClick={() => {
                        navigate(mode.to);
                        setPaletteOpen(false);
                        setQuery("");
                      }}
                    >
                      <Icon className="size-4" strokeWidth={1.6} />
                      {t(mode.key)}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-white/8 px-4 py-2 text-[11px] text-neutral-600">
              {locale === "ar" ? "Esc للإغلاق" : "Esc to close"} · {dir.toUpperCase()}
            </div>
          </div>
        </div>
      ) : null}
      <ToastHost />
          {signedIn && isFamily ? <GuardianCoachingHost /> : null}
      <AppUpdateWatcher />
      <PresenceApprovalBridge />
      <AgentPresenceHost />
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  const hideYScroll = Boolean(className?.includes("overflow-hidden"));
  return (
    <div
      className={cn(
        "h-full min-h-0 min-w-0 overflow-x-hidden",
        hideYScroll ? "overflow-y-hidden" : "overflow-y-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
