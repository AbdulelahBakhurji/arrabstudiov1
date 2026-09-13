import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, Languages, Moon, Sun, User, UserRound } from "lucide-react";
import { ToastHost } from "@/components/ToastHost";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi } from "@/lib/api";
import { initialsFromName, subscribeAccountSession } from "@/lib/account-session";
import { setAlwaysOnTop } from "@/lib/desktop";
import { notifyStudio } from "@/lib/notify";
import { ROLE_PATH, navForRole } from "@/roles/catalog";
import { useRole } from "@/roles/RoleProvider";
import { readPrefs } from "@/lib/prefs";
import { isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@arrab/shared";

export function StudioFrame() {
  const { t, toggleLocale, locale, dir } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { role, href, isIndividual, isOrganization } = useRole();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [accountUser, setAccountUser] = useState<AccountPublic | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const lastPendingRef = useRef<number | null>(null);

  const modes = useMemo(
    () =>
      navForRole(role).map((item) => ({
        to: href(item.path || "/"),
        key: item.key,
        icon: item.icon,
        end: Boolean(item.end),
      })),
    [href, role],
  );

  const paletteItems = useMemo(
    () => [
      ...modes,
      { to: href("/account"), key: "amTitle" as const, icon: User, end: false },
      { to: ROLE_PATH.individual, key: "plansIndividuals" as const, icon: UserRound, end: false },
      {
        to: ROLE_PATH.organization,
        key: "plansOrganizations" as const, icon: Building2, end: false,
      },
    ],
    [modes, href],
  );

  const refreshAccount = () => {
    void arrabApi
      .account()
      .then((status) => {
        setAccountUser(status.account);
      })
      .catch(() => {
        setAccountUser(null);
      });
  };

  useEffect(() => {
    refreshAccount();
    return subscribeAccountSession(() => refreshAccount());
  }, []);

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
          void notifyStudio({
            kind: "approvals",
            title: t("pendingApprovals"),
            body: t("approvalNotifyBody").replace("{count}", String(count)),
            href: href("/workforce"),
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
    <div className="app-shell flex h-full max-h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-background text-foreground" dir={dir}>
      <header
        data-tauri-drag-region
        dir="ltr"
        className="app-toolbar relative z-40 flex h-11 shrink-0 items-center border-b border-white/[0.08] bg-[#0a0a0a] px-3"
      >
        <div className="w-[76px] shrink-0" aria-hidden="true" />
        <div className="no-drag ml-auto flex items-center gap-2">
          <div className="me-1 hidden items-center rounded-full border border-white/10 p-0.5 sm:inline-flex">
            <button
              type="button"
              onClick={() => navigate(ROLE_PATH.individual)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]",
                isIndividual ? "bg-white text-black" : "text-neutral-400 hover:text-white",
              )}
            >
              <UserRound className="size-3" strokeWidth={1.8} />
              {t("plansIndividuals")}
            </button>
            <button
              type="button"
              onClick={() => navigate(ROLE_PATH.organization)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]",
                isOrganization ? "bg-white text-black" : "text-neutral-400 hover:text-white",
              )}
            >
              <Building2 className="size-3" strokeWidth={1.8} />
              {t("plansOrganizations")}
            </button>
          </div>

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
                  "inline-flex size-8 items-center justify-center rounded-md border border-white/10 text-white hover:bg-white/5",
                  accountUser && "border-emerald-400/30",
                )}
              >
                {accountUser ? (
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
          className="no-drag absolute top-1/2 z-30 flex -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/60 p-2 shadow-2xl backdrop-blur-md"
          style={{ insetInlineStart: "20px" }}
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
                        "mx-auto flex size-10 items-center justify-center rounded-xl transition-colors",
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
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side={dir === "rtl" ? "left" : "right"} sideOffset={12}>
                  {t(mode.key)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <main className="h-full min-h-0 min-w-0 overflow-hidden ps-[96px] pe-3 pb-3">
          <Outlet />
        </main>
      </div>

      {paletteOpen ? (
        <div
          className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl"
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
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
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
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto", className)}>
      {children}
    </div>
  );
}
