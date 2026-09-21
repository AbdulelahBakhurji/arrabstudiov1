import { useEffect, useRef, useState } from "react";
import { ExternalLink, Languages, Moon, Sun } from "lucide-react";
import logoTall from "@/assets/logotall.png";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { readPendingWebAuth } from "@/lib/account-session";
import { cancelAllWebAuthPolls, pollWebAuthUntilDone, resumePendingWebAuth } from "@/lib/web-auth";
import { openExternalUrl } from "@/lib/desktop";
import { pushToast } from "@/lib/notify";
import { ToastHost } from "@/components/ToastHost";

export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, toggleLocale, dir } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const [webWaiting, setWebWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollSignalRef = useRef<{ cancelled: boolean; timer?: number }>({ cancelled: false });
  const signedInRef = useRef(false);

  useEffect(() => {
    // Resume if the user already started browser auth before a remount/focus.
    if (readPendingWebAuth()) {
      setWebWaiting(true);
      void resumePendingWebAuth({ onPending: () => setWebWaiting(true) }).then((result) => {
        if (!result || signedInRef.current) return;
        if (result.kind === "completed") {
          signedInRef.current = true;
          setWebWaiting(false);
          pushToast({
            title: t("accountSignedIn"),
            body: result.response.account
              ? `${result.response.account.displayName} · ${result.response.account.email}`
              : undefined,
            tone: "success",
          });
          onSignedIn();
          return;
        }
        if (result.kind === "expired") {
          setWebWaiting(false);
          setError(result.message || t("webAuthExpired"));
        }
      });
    }
  }, [onSignedIn, t]);

  function cancelWebAuth() {
    pollSignalRef.current.cancelled = true;
    cancelAllWebAuthPolls();
    pollSignalRef.current = { cancelled: false };
    setWebWaiting(false);
  }

  async function startBrowserSignIn() {
    setError(null);
    setBusy(true);
    pollSignalRef.current.cancelled = false;
    try {
      const started = await arrabApi.startWebAuth();
      const pollSecret = started.pollSecret?.trim() ?? "";
      if (!started.state?.trim() || !pollSecret) {
        throw new ApiRequestError(t("webAuthMissingCredentials"), 400);
      }
      await openExternalUrl(started.authorizationUrl);
      setWebWaiting(true);
      pushToast({ title: t("webAuthOpened"), body: t("webAuthOpenedBody"), tone: "info" });

      const result = await pollWebAuthUntilDone({
        state: started.state,
        pollSecret,
        pollIntervalMs: started.pollIntervalMs,
        signal: pollSignalRef.current,
        onPending: () => setWebWaiting(true),
      });

      if (result.kind === "completed") {
        signedInRef.current = true;
        setWebWaiting(false);
        pushToast({
          title: t("accountSignedIn"),
          body: result.response.account
            ? `${result.response.account.displayName} · ${result.response.account.email}`
            : undefined,
          tone: "success",
        });
        onSignedIn();
        return;
      }
      if (result.kind === "expired") {
        setWebWaiting(false);
        setError(result.message || t("webAuthExpired"));
        return;
      }
      if (result.kind === "error") {
        setWebWaiting(false);
        setError(result.message);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      setWebWaiting(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir={dir} className="relative flex h-full w-full overflow-hidden bg-[var(--color-background)] text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,255,255,0.08), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 90%, rgba(16,185,129,0.06), transparent 50%), linear-gradient(180deg, var(--color-surface) 0%, var(--color-background) 100%)",
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

      <div
        dir="ltr"
        className={
          dir === "rtl"
            ? "no-drag absolute left-20 top-4 z-20 flex items-center gap-2"
            : "no-drag absolute right-4 top-4 z-20 flex items-center gap-2"
        }
      >
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
            ) : null}

            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
