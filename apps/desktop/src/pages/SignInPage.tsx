import { useEffect, useRef, useState } from "react";
import { ExternalLink, Languages, Moon, Sun } from "lucide-react";
import logoTall from "@/assets/logotall.png";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { writeAccountSession } from "@/lib/account-session";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { ToastHost } from "@/components/ToastHost";
import { cn } from "@/lib/utils";

export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, toggleLocale, dir } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<"signIn" | "connect">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [webWaiting, setWebWaiting] = useState(false);
  const [showLocal, setShowLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<{ cancelled: boolean; timer?: number }>({ cancelled: false });

  useEffect(() => {
    return () => {
      abortRef.current.cancelled = true;
      if (abortRef.current.timer) {
        window.clearTimeout(abortRef.current.timer);
      }
    };
  }, []);

  function cancelWebAuth() {
    abortRef.current.cancelled = true;
    if (abortRef.current.timer) {
      window.clearTimeout(abortRef.current.timer);
      abortRef.current.timer = undefined;
    }
    setWebWaiting(false);
  }

  async function startBrowserSignIn() {
    setError(null);
    setBusy(true);
    abortRef.current.cancelled = false;
    try {
      const started = await arrabApi.startWebAuth();
      await openExternalUrl(started.authorizationUrl);
      setWebWaiting(true);
      pushToast({ title: t("webAuthOpened"), body: t("webAuthOpenedBody"), tone: "info" });

      const poll = async () => {
        if (abortRef.current.cancelled) {
          return;
        }
        const polled = await arrabApi.pollWebAuth(started.state);
        if (abortRef.current.cancelled) {
          return;
        }
        if (polled.status === "completed" && polled.sessionToken) {
          writeAccountSession(polled.sessionToken);
          setWebWaiting(false);
          pushToast({
            title: t("accountSignedIn"),
            body: polled.account ? `${polled.account.displayName} · ${polled.account.email}` : undefined,
            tone: "success",
          });
          onSignedIn();
          return;
        }
        if (polled.status === "expired") {
          setWebWaiting(false);
          setError(polled.message ?? t("webAuthExpired"));
          return;
        }
        abortRef.current.timer = window.setTimeout(() => {
          void poll().catch((err: unknown) => {
            if (!abortRef.current.cancelled) {
              setWebWaiting(false);
              setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
            }
          });
        }, 1600);
      };

      await poll();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      setWebWaiting(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitLocal() {
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === "connect"
          ? await arrabApi.connectAccount({
              email,
              password,
              displayName: displayName.trim() || undefined,
            })
          : await arrabApi.signInAccount({ email, password });
      writeAccountSession(result.sessionToken);
      pushToast({
        title: t("accountSignedIn"),
        body: `${result.account.planName} · ${result.account.email}`,
        tone: "success",
      });
      onSignedIn();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir={dir} className="relative flex h-full w-full overflow-hidden bg-[#040404] text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,255,255,0.08), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 90%, rgba(16,185,129,0.06), transparent 50%), linear-gradient(180deg, #070707 0%, #040404 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="no-drag absolute end-4 top-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t("languageHint")}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5 hover:text-white"
        >
          <Languages className="size-4" strokeWidth={1.7} />
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t("themeToLight") : t("themeToDark")}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5 hover:text-white"
        >
          {theme === "dark" ? (
            <Sun className="size-4" strokeWidth={1.7} />
          ) : (
            <Moon className="size-4" strokeWidth={1.7} />
          )}
        </button>
      </div>

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6">
        <div className="arrab-rise w-full max-w-[420px]">
          <div className="mb-10 flex flex-col items-center text-center">
            <img
              src={logoTall}
              alt={t("brand")}
              className="brand-mark mb-6 h-12 w-auto opacity-95"
            />
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-white">
              {t("authGateTitle")}
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-400">
              {t("authGateBody")}
            </p>
          </div>

          <div className="arrab-rise-delay-1 space-y-4 rounded-[28px] border border-white/10 bg-[#0a0a0a]/95 p-6 shadow-2xl backdrop-blur-md">
            <button
              type="button"
              disabled={busy || webWaiting}
              onClick={() => void startBrowserSignIn()}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black transition hover:bg-neutral-100 disabled:opacity-50"
            >
              <ExternalLink className="size-4" strokeWidth={1.8} />
              {webWaiting ? t("webAuthWaiting") : t("signInWithBrowser")}
            </button>

            {webWaiting ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3">
                <p className="text-xs leading-relaxed text-emerald-100/90">{t("webAuthWaitingBody")}</p>
                <button
                  type="button"
                  onClick={cancelWebAuth}
                  className="mt-2 text-xs text-neutral-400 underline-offset-2 hover:text-white hover:underline"
                >
                  {t("cancelWebAuth")}
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-neutral-500">{t("webAuthHint")}</p>
            )}

            <button
              type="button"
              onClick={() => setShowLocal((open) => !open)}
              className="w-full text-center text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
            >
              {showLocal ? t("hideLocalAuth") : t("showLocalAuth")}
            </button>

            {showLocal ? (
              <div className="arrab-rise space-y-3 border-t border-white/8 pt-4">
                <div className="flex gap-2 rounded-full border border-white/10 p-1">
                  <button
                    type="button"
                    onClick={() => setMode("signIn")}
                    className={cn(
                      "h-9 flex-1 rounded-full text-xs font-medium transition",
                      mode === "signIn" ? "bg-white text-black" : "text-neutral-400 hover:text-white",
                    )}
                  >
                    {t("signInAccount")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("connect")}
                    className={cn(
                      "h-9 flex-1 rounded-full text-xs font-medium transition",
                      mode === "connect" ? "bg-white text-black" : "text-neutral-400 hover:text-white",
                    )}
                  >
                    {t("createAccount")}
                  </button>
                </div>

                {mode === "connect" ? (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("profileName")}
                    </span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="field"
                      autoComplete="name"
                    />
                  </label>
                ) : null}

                <label className="block space-y-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("accountEmail")}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="field"
                    autoComplete="email"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("accountPassword")}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="field"
                    autoComplete={mode === "connect" ? "new-password" : "current-password"}
                  />
                </label>

                <p className="text-[11px] text-neutral-500">{t("accountLocalHint")}</p>

                <button
                  type="button"
                  disabled={busy || !email.trim() || password.length < 8}
                  onClick={() => void submitLocal()}
                  className="h-11 w-full rounded-full border border-white/15 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                >
                  {mode === "connect" ? t("connectAccount") : t("signInAccount")}
                </button>
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>

          <p className="arrab-rise-delay-2 mt-8 text-center text-[11px] text-neutral-600">
            {t("authGateFooter")}
          </p>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
