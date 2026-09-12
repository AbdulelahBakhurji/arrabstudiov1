import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity,
  Boxes,
  Cable,
  Languages,
  LogOut,
  MessageSquare,
  Moon,
  Settings2,
  Sparkles,
  Sun,
  User,
  UsersRound,
} from "lucide-react";
import { ToastHost } from "@/components/ToastHost";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi } from "@/lib/api";
import {
  clearAccountSession,
  initialsFromName,
  subscribeAccountSession,
} from "@/lib/account-session";
import { setAlwaysOnTop } from "@/lib/desktop";
import { notifyStudio, pushToast } from "@/lib/notify";
import { readPrefs } from "@/lib/prefs";
import { isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import type { AccountPublic } from "@arrab/shared";

const modes = [
  { to: "/", key: "studio" as const, icon: Sparkles, end: true },
  { to: "/chat", key: "chat" as const, icon: MessageSquare, end: false },
  { to: "/cowork", key: "cowork" as const, icon: Boxes, end: false },
  { to: "/workforce", key: "workforce" as const, icon: UsersRound, end: false },
  { to: "/connectors", key: "connectors" as const, icon: Cable, end: false },
  { to: "/activity", key: "activity" as const, icon: Activity, end: false },
  { to: "/settings", key: "settings" as const, icon: Settings2, end: false },
];

export function StudioFrame() {
  const { t, toggleLocale, locale, dir } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [operatorName, setOperatorName] = useState(t("localUser"));
  const [accountUser, setAccountUser] = useState<AccountPublic | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const lastPendingRef = useRef<number | null>(null);

  const refreshAccount = () => {
    void arrabApi
      .account()
      .then((status) => {
        setAccountUser(status.account);
        if (status.account) {
          setOperatorName(status.account.displayName);
          return;
        }
        return arrabApi.operator().then((op) => {
          setOperatorName(op.displayName || t("localUser"));
        });
      })
      .catch(() => {
        setAccountUser(null);
        setOperatorName(t("localUser"));
      });
  };

  useEffect(() => {
    refreshAccount();
    return subscribeAccountSession(() => refreshAccount());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on mount + session events
  }, [t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        setUserOpen(false);
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        navigate("/settings");
        setPaletteOpen(false);
        setUserOpen(false);
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleTheme();
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        toggleLocale();
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
        setUserOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleLocale, toggleTheme]);

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
            href: "/workforce",
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
  }, [t]);

  useEffect(() => {
    if (!userOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [userOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return modes;
    }
    return modes.filter((mode) => t(mode.key).toLowerCase().includes(q) || mode.to.includes(q));
  }, [query, t]);

  async function logoutFromMenu() {
    setAccountBusy(true);
    try {
      await arrabApi.logoutAccount();
      clearAccountSession();
      setAccountUser(null);
      setOperatorName(t("localUser"));
      pushToast({ title: t("accountLoggedOut"), tone: "info" });
      setUserOpen(false);
    } catch {
      pushToast({ title: t("apiUnavailable"), tone: "warn" });
    } finally {
      setAccountBusy(false);
    }
  }

  const displayLabel = accountUser?.displayName || operatorName;
  const displaySub =
    accountUser?.email ?? (accountUser ? t("accountSignedInStatus") : t("userSettings"));

  return (
    <div className="app-shell flex h-full max-h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-background text-foreground" dir={dir}>
      {/* Chrome stays LTR so traffic lights + controls stay on physical left/right */}
      <header
        data-tauri-drag-region
        dir="ltr"
        className="app-toolbar relative z-40 flex h-11 shrink-0 items-center border-b border-white/[0.08] bg-[#0a0a0a] px-3"
      >
        <div className="w-[76px] shrink-0" aria-hidden="true" />
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

          <div className="relative" ref={userMenuRef}>
            <Tooltip delayDuration={120}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setUserOpen((open) => !open)}
                  aria-label={t("userMenu")}
                  aria-expanded={userOpen}
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-md border border-white/10 text-white hover:bg-white/5",
                    userOpen && "bg-white/10",
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
              {!userOpen ? (
                <TooltipContent side="bottom" sideOffset={8}>
                  {t("userMenu")}
                </TooltipContent>
              ) : null}
            </Tooltip>

            {userOpen ? (
              <div
                dir={dir}
                className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl"
              >
                <div className="border-b border-white/8 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-semibold text-white">
                      {accountUser ? (
                        initialsFromName(accountUser.displayName, accountUser.email)
                      ) : (
                        <User className="size-4 text-white" strokeWidth={1.7} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{displayLabel}</p>
                      <p className="mt-0.5 truncate text-[11px] text-neutral-500">{displaySub}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-neutral-500">
                    {accountUser ? t("signedInUserBody") : t("userSettingsBody")}
                  </p>
                  {accountUser ? (
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-neutral-400">
                      {accountUser.planName} · {t("accountSignedInStatus")}
                    </p>
                  ) : null}
                  {pendingCount > 0 ? (
                    <button
                      type="button"
                      className="mt-3 w-full rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-start text-xs text-amber-100"
                      onClick={() => {
                        setUserOpen(false);
                        navigate("/workforce");
                      }}
                    >
                      {t("pendingApprovals")}: {pendingCount}
                    </button>
                  ) : null}
                </div>
                <div className="space-y-1 p-2">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
                    onClick={() => {
                      setUserOpen(false);
                      navigate("/settings?tab=account");
                    }}
                  >
                    <Settings2 className="size-4" strokeWidth={1.7} />
                    {accountUser ? t("userAccountSettings") : t("signInWithBrowser")}
                  </button>
                  {accountUser ? (
                    <button
                      type="button"
                      disabled={accountBusy}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm text-neutral-300 hover:bg-white/5 hover:text-white disabled:opacity-50"
                      onClick={() => void logoutFromMenu()}
                    >
                      <LogOut className="size-4" strokeWidth={1.7} />
                      {t("logOut")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
                    onClick={() => {
                      setUserOpen(false);
                      navigate("/settings");
                    }}
                  >
                    <Settings2 className="size-4" strokeWidth={1.7} />
                    {t("openSettings")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
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
                  <li key={mode.to}>
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
