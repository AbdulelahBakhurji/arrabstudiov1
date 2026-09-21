import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bell,
  CircleUserRound,
  Copy,
  Cable,
  ExternalLink,
  HardDrive,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Shield,
  Sparkles,
  Sun,
  Workflow,
} from "lucide-react";
import logoTall from "@/assets/logotall.png";
import { Surface } from "@/components/StudioFrame";
import { FamilyHouseholdPanel } from "@/components/FamilyHouseholdPanel";
import { useFamilyProfile } from "@/lib/use-family-profile";
import pkg from "../../package.json";
import { useRole } from "@/roles/RoleProvider";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  clearAccountSession,
  initialsFromName,
  ACCOUNT_EVENT,
  subscribeAccountSession,
} from "@/lib/account-session";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { openExternalUrl, openPlansPage, setAlwaysOnTop } from "@/lib/desktop";
import { pollWebAuthUntilDone, cancelAllWebAuthPolls } from "@/lib/web-auth";
import {
  ensureNotificationPermission,
  notifyStudio,
  pushToast,
} from "@/lib/notify";
import { demoAgentPresence } from "@/lib/agent-presence";
import {
  clearCrashLog,
  clearLocalStudioData,
  defaultPrefs,
  readCrashLog,
  readPrefs,
  recordCrash,
  writeApiBaseOverride,
  writePrefs,
  type StudioPrefs,
} from "@/lib/prefs";
import { pickFolder, isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import type { AccountStatusResponse, AiGatewayStatusResponse } from "@arrab/shared";
import { LocalModelsSettingsPanel } from "@/components/LocalModelsSettingsPanel";
import { AppUpdatesPanel } from "@/components/AppUpdatesPanel";
import {
  isSettingsTabId,
  settingsTabsFor,
  type SettingsTabId,
} from "@/features/settings-tabs";

type SettingsTab = SettingsTabId;

const FOLDER_KEY = "arrab.cowork.folder";

function readSettingsTab(value: string | null): SettingsTab {
  return isSettingsTabId(value) ? value : "usage";
}

export function SettingsPage() {
  const { t, locale, setLocale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { role: studioRole, href } = useRole();
  const { isChild: isFamilyChild } = useFamilyProfile();
  const { account: signedInAccount } = useSignedInAccount();
  const accountId = signedInAccount?.id ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>(() => readSettingsTab(searchParams.get("tab")));

  useEffect(() => {
    setTab(readSettingsTab(searchParams.get("tab")));
  }, [searchParams]);

  // Account settings stay inside Settings — do not bounce to /account.

  const [prefs, setPrefs] = useState<StudioPrefs>(() => readPrefs());
  const [savedFlash, setSavedFlash] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatusResponse | null>(null);
  const [tokenUsage, setTokenUsage] = useState({
    inputTokens: 0,
    outputTokens: 0,
    events: 0,
  });
  const [entitlements, setEntitlements] = useState<AccountStatusResponse["entitlements"] | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatusResponse | null>(null);
  const [accountName, setAccountName] = useState("");
  const [subscribeCode, setSubscribeCode] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [webAuthWaiting, setWebAuthWaiting] = useState(false);
  const webAuthAbortRef = useRef<{ cancelled: boolean; timer?: number }>({ cancelled: false });
  const [displayName, setDisplayName] = useState("Studio operator");
  const [role, setRole] = useState("Founder");
  const [seats, setSeats] = useState<string[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    version: string;
    persistence: string;
    workspaceId: string;
    aiProviders: string[];
  } | null>(null);
  const [connectionMsg, setConnectionMsg] = useState<string | null>(null);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [coworkFolder, setCoworkFolder] = useState<string | null>(() => {
    try {
      return localStorage.getItem(FOLDER_KEY);
    } catch {
      return null;
    }
  });
  const [crashLog, setCrashLog] = useState(() => readCrashLog());
  const [notifyPermission, setNotifyPermission] = useState<string>(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const loadUsage = useCallback(() => {
    void Promise.all([
      arrabApi.aiStatus(),
      arrabApi.usage(),
      arrabApi.meta().catch(() => null),
      arrabApi.health().catch(() => null),
    ])
      .then(([ai, tokens, apiMeta]) => {
        setOnline(true);
        setAiReady(ai.configured);
        setAiStatus(ai);
        setTokenUsage({
          inputTokens: tokens.totals.inputTokens,
          outputTokens: tokens.totals.outputTokens,
          events: tokens.totals.events,
        });
        if (tokens.entitlements) {
          setEntitlements(tokens.entitlements);
        }
        if (apiMeta) {
          setMeta({
            version: apiMeta.version,
            persistence: apiMeta.persistence,
            workspaceId: apiMeta.workspaceId,
            aiProviders: apiMeta.aiProviders,
          });
        }
      })
      .catch((err: unknown) => {
        setOnline(false);
        setAiReady(false);
        setAiStatus(null);
        recordCrash(err instanceof Error ? err.message : "Usage load failed", "settings.usage");
      });
  }, []);

  const loadAccount = useCallback(() => {
    void arrabApi
      .account()
      .then((status) => {
        setAccountStatus(status);
        setEntitlements(status.entitlements);
        if (status.account) {
          setAccountName(status.account.displayName);
        }
        setAccountError(null);
      })
      .catch((err: unknown) => {
        setAccountError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t]);

  const loadOperator = useCallback(() => {
    void arrabApi
      .operator()
      .then((op) => {
        setDisplayName(op.displayName);
        setRole(op.title ?? "");
        setSeats(op.seats ?? []);
        setProfileError(null);
      })
      .catch((err: unknown) => {
        setProfileError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t]);

  useEffect(() => {
    // Desktop talks only to the managed public API — never keep a local URL override.
    writeApiBaseOverride(null);
    loadOperator();
  }, [loadOperator]);

  // Drop previous account's token cards immediately when the signed-in user changes.
  useEffect(() => {
    setTokenUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
    setEntitlements(null);
    loadUsage();
    loadAccount();
  }, [accountId, loadUsage, loadAccount]);

  useEffect(() => {
    return subscribeAccountSession(() => {
      setTokenUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
      loadUsage();
      loadAccount();
    });
  }, [loadUsage, loadAccount]);

  useEffect(() => {
    if (tab !== "usage" && tab !== "account") return;

    const refresh = () => {
      loadUsage();
      if (tab === "account") loadAccount();
    };
    refresh();
    const interval = window.setInterval(refresh, 15_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onFocus = () => refresh();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [tab, loadUsage, loadAccount]);

  useEffect(() => {
    return () => {
      webAuthAbortRef.current.cancelled = true;
      if (webAuthAbortRef.current.timer) {
        window.clearTimeout(webAuthAbortRef.current.timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    void setAlwaysOnTop(prefs.desktopAlwaysOnTop).catch(() => {
      // ignore when window API unavailable
    });
  }, [prefs.desktopAlwaysOnTop]);

  const tabs = useMemo(
    () =>
      settingsTabsFor({
        audience: studioRole,
        isFamilyChild,
        theme,
      }).map((tab) => [tab.id, t(tab.labelKey), tab.icon] as const),
    [t, theme, studioRole, isFamilyChild],
  );

  useEffect(() => {
    if (studioRole !== "individual") return;
    if (tab === "cowork" || tab === "family") {
      setTab("usage");
      setSearchParams({}, { replace: true });
    }
  }, [studioRole, tab, setSearchParams]);

  useEffect(() => {
    if (studioRole !== "organization") return;
    if (tab === "family") {
      setTab("usage");
      setSearchParams({}, { replace: true });
    }
  }, [studioRole, tab, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("tab") === "plans") {
      setTab("account");
      setSearchParams({ tab: "account" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const agentPercent = useMemo(() => {
    if (!entitlements || entitlements.tokenLimit === null || entitlements.tokenLimit <= 0) {
      return null;
    }
    return Math.min(100, Math.round((entitlements.tokensUsed / entitlements.tokenLimit) * 100));
  }, [entitlements]);
  const planLabel = entitlements?.planName ?? t("accountNotConnected");
  const tokensUsedValue =
    entitlements?.tokensUsed ?? tokenUsage.inputTokens + tokenUsage.outputTokens;
  const periodLabel = useMemo(() => {
    if (!entitlements?.periodEnd) return null;
    const localeTag = locale === "ar" ? "ar-SA" : "en-US";
    return new Date(entitlements.periodEnd).toLocaleDateString(localeTag, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [entitlements?.periodEnd, locale]);
  const billingRangeLabel = useMemo(() => {
    if (!entitlements?.periodStart || !entitlements?.periodEnd) return null;
    const localeTag = locale === "ar" ? "ar-SA" : "en-US";
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    return `${new Date(entitlements.periodStart).toLocaleDateString(localeTag, opts)} → ${new Date(entitlements.periodEnd).toLocaleDateString(localeTag, opts)}`;
  }, [entitlements?.periodStart, entitlements?.periodEnd, locale]);
  const daysLeftInPeriod = useMemo(() => {
    if (!entitlements?.periodEnd) return null;
    const ms = new Date(entitlements.periodEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }, [entitlements?.periodEnd]);
  const memberSinceLabel = useMemo(() => {
    const connectedAt = accountStatus?.account?.connectedAt;
    if (!connectedAt) return null;
    const localeTag = locale === "ar" ? "ar-SA" : "en-US";
    return new Date(connectedAt).toLocaleDateString(localeTag, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [accountStatus?.account?.connectedAt, locale]);
  const profileDirty = useMemo(() => {
    const current = accountStatus?.account?.displayName?.trim() ?? "";
    return accountName.trim() !== current && accountName.trim().length > 0;
  }, [accountName, accountStatus?.account?.displayName]);

  async function copyAccountEmail() {
    const email = accountStatus?.account?.email;
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      pushToast({ title: t("accountEmailCopied"), tone: "success" });
    } catch {
      pushToast({ title: t("apiUnavailable"), tone: "warn" });
    }
  }

  function persistPrefs(next: StudioPrefs) {
    setPrefs(next);
    writePrefs(next);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  }

  function updatePref<K extends keyof StudioPrefs>(key: K, value: StudioPrefs[K]) {
    const next = { ...prefs, [key]: value };
    persistPrefs(next);
  }

  function resetPrefs() {
    const next = defaultPrefs();
    persistPrefs(next);
    void setAlwaysOnTop(false).catch(() => undefined);
  }

  async function saveProfile() {
    setProfileBusy(true);
    setProfileError(null);
    try {
      const updated = await arrabApi.updateOperator({
        displayName: displayName.trim() || "Studio operator",
        title: role.trim() || null,
        ...(role.trim() && !seats.includes(role.trim()) ? { addSeat: role.trim() } : {}),
      });
      setDisplayName(updated.displayName);
      setRole(updated.title ?? "");
      setSeats(updated.seats ?? []);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
      pushToast({ title: t("profileSaved"), tone: "success" });
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setProfileError(message);
      recordCrash(message, "settings.profile");
    } finally {
      setProfileBusy(false);
    }
  }

  function cancelWebAuth() {
    webAuthAbortRef.current.cancelled = true;
    cancelAllWebAuthPolls();
    if (webAuthAbortRef.current.timer) {
      window.clearTimeout(webAuthAbortRef.current.timer);
      webAuthAbortRef.current.timer = undefined;
    }
    setWebAuthWaiting(false);
    setAccountBusy(false);
  }

  async function startBrowserSignIn() {
    setAccountBusy(true);
    setAccountError(null);
    webAuthAbortRef.current.cancelled = false;
    try {
      const started = await arrabApi.startWebAuth({});
      const pollSecret = started.pollSecret?.trim() ?? "";
      if (!started.state?.trim() || !pollSecret) {
        throw new ApiRequestError(t("webAuthMissingCredentials"), 400);
      }
      await openExternalUrl(started.authorizationUrl);
      setWebAuthWaiting(true);
      pushToast({
        title: t("webAuthOpened"),
        body: t("webAuthOpenedBody"),
        tone: "info",
      });

      const result = await pollWebAuthUntilDone({
        state: started.state,
        pollSecret,
        pollIntervalMs: started.pollIntervalMs,
        signal: webAuthAbortRef.current,
        onPending: () => setWebAuthWaiting(true),
      });

      if (result.kind === "completed" && result.response.account && result.response.entitlements) {
        setAccountStatus({
          connected: true,
          account: result.response.account,
          entitlements: result.response.entitlements,
          plans: accountStatus?.plans ?? [],
        });
        setEntitlements(result.response.entitlements);
        setDisplayName(result.response.account.displayName);
        setWebAuthWaiting(false);
        setAccountBusy(false);
        pushToast({
          title: t("accountSignedIn"),
          body: `${result.response.account.displayName} · ${result.response.account.email}`,
          tone: "success",
        });
        window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
        loadAccount();
        loadUsage();
        return;
      }
      if (result.kind === "expired") {
        setWebAuthWaiting(false);
        setAccountBusy(false);
        setAccountError(result.message || t("webAuthExpired"));
        return;
      }
      if (result.kind === "error") {
        setWebAuthWaiting(false);
        setAccountBusy(false);
        setAccountError(result.message);
      }
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setAccountError(message);
      recordCrash(message, "settings.account.web");
      setWebAuthWaiting(false);
      setAccountBusy(false);
    }
  }

  async function logoutAccount() {
    setAccountBusy(true);
    setAccountError(null);
    cancelWebAuth();
    try {
      const status = await arrabApi.logoutAccount();
      clearAccountSession();
      setAccountStatus(status);
      setEntitlements(status.entitlements);
      setTokenUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
      pushToast({ title: t("accountLoggedOut"), tone: "info" });
      loadUsage();
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setAccountError(message);
    } finally {
      setAccountBusy(false);
    }
  }

  function selectTab(next: SettingsTab) {
    setTab(next);
    if (next === "usage") {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ tab: next }, { replace: true });
  }

  async function activateSubscription() {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const status = await arrabApi.activateSubscription({ code: subscribeCode });
      setAccountStatus(status);
      setEntitlements(status.entitlements);
      setSubscribeCode("");
      window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
      pushToast({
        title: t("subscriptionActivated"),
        body: status.account?.planName,
        tone: "success",
      });
      loadUsage();
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setAccountError(message);
    } finally {
      setAccountBusy(false);
    }
  }

  async function saveAccountProfile() {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const status = await arrabApi.updateAccountProfile({ displayName: accountName });
      setAccountStatus(status);
      if (status.account) {
        setDisplayName(status.account.displayName);
      }
      window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
      pushToast({ title: t("profileSaved"), tone: "success" });
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setAccountError(message);
    } finally {
      setAccountBusy(false);
    }
  }

  async function testConnection() {
    setConnectionMsg(null);
    setConnectionChecking(true);
    try {
      const [apiMeta, ai] = await Promise.all([
        arrabApi.meta(),
        arrabApi.aiStatus().catch(() => null),
      ]);
      await arrabApi.health();
      setOnline(true);
      if (ai) {
        setAiReady(ai.configured);
        setAiStatus(ai);
      }
      setMeta({
        version: apiMeta.version,
        persistence: apiMeta.persistence,
        workspaceId: apiMeta.workspaceId,
        aiProviders: apiMeta.aiProviders,
      });
      setConnectionMsg(t("connectionOk"));
      pushToast({ title: t("connectionOk"), body: `v${apiMeta.version}`, tone: "success" });
    } catch (err: unknown) {
      setOnline(false);
      setAiReady(false);
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setConnectionMsg(message);
      recordCrash(message, "settings.connection");
    } finally {
      setConnectionChecking(false);
    }
  }

  async function chooseDefaultFolder() {
    try {
      const folder = await pickFolder();
      if (!folder) {
        return;
      }
      localStorage.setItem(FOLDER_KEY, folder);
      setCoworkFolder(folder);
      pushToast({ title: t("defaultFolderSet"), body: folder, tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: t("desktopAppRequired"),
        body: err instanceof Error ? err.message : undefined,
        tone: "warn",
      });
    }
  }

  function clearDefaultFolder() {
    localStorage.removeItem(FOLDER_KEY);
    setCoworkFolder(null);
  }

  async function requestOsNotify() {
    const permission = await ensureNotificationPermission();
    setNotifyPermission(permission);
    if (permission === "granted") {
      pushToast({ title: t("osNotifyGranted"), tone: "success" });
    } else if (permission === "denied") {
      pushToast({ title: t("osNotifyDenied"), tone: "warn" });
    } else {
      pushToast({ title: t("osNotifyUnsupported"), tone: "warn" });
    }
  }

  async function sendTestNotify() {
    await ensureNotificationPermission();
    updatePref("notifyAgentPresence", true);
    await demoAgentPresence({
      agentName: "Arrab",
      hue: 210,
      faceSeed: 17,
    });
    pushToast({ title: t("testNotifyTitle"), body: t("testNotifyBody"), tone: "success" });
  }

  function wipeLocalData() {
    if (!window.confirm(t("clearLocalConfirm"))) {
      return;
    }
    clearLocalStudioData();
    writeApiBaseOverride(null);
    setPrefs(defaultPrefs());
    setCoworkFolder(null);
    setCrashLog([]);
    pushToast({ title: t("clearLocalDone"), tone: "success" });
  }

  return (
    <Surface
      className={cn(
        "settings-shell",
        studioRole === "individual" && "settings-shell-individual",
      )}
    >
      <div className="settings-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-8 lg:flex-row lg:px-10">
        <aside className="w-full shrink-0 lg:w-[220px]">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
            {t("settings")}
          </p>
          <h1 className="mt-1 px-1 text-[22px] font-semibold tracking-[-0.03em] text-white">
            {t("settingsTitle")}
          </h1>
          <p className="mt-1.5 px-1 text-[13px] leading-snug text-neutral-500">{t("settingsBody")}</p>
          <nav
            className={cn(
              "mt-5 space-y-0.5 pe-1",
              studioRole === "individual"
                ? "settings-nav-clean"
                : "max-h-[70vh] overflow-auto",
            )}
          >
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-start text-[13px] transition-colors",
                  tab === id
                    ? "bg-white/[0.12] font-medium text-white"
                    : "text-neutral-400 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <Icon className="size-[15px] opacity-80" strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {tab === "usage" ? (
            <section className="settings-rise su">
              <header className="su-head">
                <h2>{t("settingsUsage")}</h2>
              </header>

              <article className="su-hero">
                <div className="su-hero-top">
                  <div className="su-hero-copy">
                    <p className="su-kicker">{t("currentPlan")}</p>
                    <h3>{planLabel}</h3>
                    <div className="su-chips">
                      {entitlements?.subscriptionStatus ? (
                        <span className="su-chip">{entitlements.subscriptionStatus}</span>
                      ) : null}
                      {periodLabel ? (
                        <span className="su-chip is-soft">
                          {t("usageResets")} {periodLabel}
                        </span>
                      ) : null}
                      {entitlements?.overLimit ? (
                        <span className="su-chip is-warn">{t("quotaExceededHint")}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="su-cta"
                    onClick={() => void openPlansPage()}
                  >
                    {t("managePlansOnWebsite")}
                    <ExternalLink className="size-3.5" strokeWidth={1.9} />
                  </button>
                </div>

                <div className="su-meter">
                  <div className="su-meter-labels">
                    <span>
                      {tokensUsedValue.toLocaleString()} {t("usageTokensUsed").toLowerCase()}
                    </span>
                    <strong>
                      {agentPercent === null
                        ? t("unlimitedTokens")
                        : `${agentPercent}%`}
                    </strong>
                  </div>
                  <div className="su-meter-track" aria-hidden>
                    <div
                      className={cn(
                        "su-meter-fill",
                        entitlements?.overLimit && "is-over",
                        agentPercent === null && "is-unlimited",
                      )}
                      style={{
                        width:
                          agentPercent === null
                            ? "100%"
                            : `${Math.max(agentPercent > 0 ? 3 : 0, agentPercent)}%`,
                      }}
                    />
                  </div>
                  <div className="su-meter-foot">
                    <span>
                      {agentPercent === null
                        ? t("unlimitedTokens")
                        : `${agentPercent}% ${t("usageTokensUsed").toLowerCase()}`}
                    </span>
                    {agentPercent != null ? (
                      <span>
                        {Math.max(0, 100 - agentPercent)}% {t("usageRemaining")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>

              {studioRole === "family" ? (
                <div className="pt-2">
                  <p className="mb-3 text-sm text-neutral-500">{t("familyUsageHint")}</p>
                  <FamilyHouseholdPanel variant="compact" />
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "family" && studioRole === "family" ? (
            <section className="settings-rise su">
              <header className="su-head">
                <h2>{t("settingsFamily")}</h2>
                <p className="text-sm text-neutral-500">{t("settingsFamilyBody")}</p>
              </header>
              <FamilyHouseholdPanel variant="full" />
            </section>
          ) : null}

          {tab === "account" ? (
            <section className="settings-rise sa">
              <header className="sa-head">
                <div>
                  <h2>{t("settingsAccount")}</h2>
                  <p>{t("accountBody")}</p>
                </div>
                {accountStatus?.connected && accountStatus.account ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {webAuthWaiting ? (
                      <button type="button" className="sa-ghost" onClick={cancelWebAuth}>
                        {t("cancelWebAuth")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="sa-ghost is-danger"
                      disabled={accountBusy}
                      onClick={() => void logoutAccount()}
                    >
                      <LogOut className="size-3.5" strokeWidth={1.8} />
                      {t("logOut")}
                    </button>
                  </div>
                ) : null}
              </header>

              {accountStatus?.connected && accountStatus.account ? (
                <>
                  <article className="sa-hero">
                    <div className="sa-hero-top">
                      <div className="sa-identity">
                        <div className="sa-avatar" aria-hidden>
                          {initialsFromName(
                            accountStatus.account.displayName,
                            accountStatus.account.email,
                          )}
                        </div>
                        <div className="sa-identity-copy">
                          <h3>{accountStatus.account.displayName}</h3>
                          <button
                            type="button"
                            className="sa-email"
                            onClick={() => void copyAccountEmail()}
                            title={t("accountCopyEmail")}
                          >
                            <span>{accountStatus.account.email}</span>
                            <Copy className="size-3.5" strokeWidth={1.8} />
                          </button>
                          <div className="sa-chips">
                            <span className="sa-chip is-ok">{t("accountSignedInStatus")}</span>
                            <span className="sa-chip">{accountStatus.account.planName}</span>
                            {accountStatus.account.subscriptionStatus ? (
                              <span className="sa-chip is-soft">
                                {accountStatus.account.subscriptionStatus}
                              </span>
                            ) : null}
                            {memberSinceLabel ? (
                              <span className="sa-chip is-soft">
                                {t("amMemberSince")} {memberSinceLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="sa-hero-actions">
                        <button
                          type="button"
                          className="sa-cta"
                          disabled={accountBusy || webAuthWaiting}
                          onClick={() => void startBrowserSignIn()}
                        >
                          <ExternalLink className="size-3.5" strokeWidth={1.8} />
                          {webAuthWaiting ? t("webAuthWaiting") : t("reconnectWithBrowser")}
                        </button>
                        <button
                          type="button"
                          className="sa-ghost"
                          onClick={() => void openPlansPage()}
                        >
                          {t("managePlansOnWebsite")}
                          <ExternalLink className="size-3.5" strokeWidth={1.9} />
                        </button>
                        <button
                          type="button"
                          className="sa-ghost"
                          onClick={() => selectTab("usage")}
                        >
                          {t("accountOpenUsage")}
                        </button>
                      </div>
                    </div>

                    {entitlements ? (
                      <div className="sa-meter">
                        <div className="sa-meter-labels">
                          <span>
                            {entitlements.tokensUsed.toLocaleString()} {t("usageTokensUsed").toLowerCase()}
                          </span>
                          <strong>
                            {agentPercent === null
                              ? t("unlimitedTokens")
                              : `${agentPercent}%`}
                          </strong>
                        </div>
                        <div className="sa-meter-track" aria-hidden>
                          <div
                            className={cn(
                              "sa-meter-fill",
                              entitlements.overLimit && "is-over",
                              agentPercent === null && "is-unlimited",
                            )}
                            style={{
                              width:
                                agentPercent === null
                                  ? "100%"
                                  : `${Math.max(agentPercent > 0 ? 3 : 0, agentPercent)}%`,
                            }}
                          />
                        </div>
                        <div className="sa-meter-foot">
                          <span>
                            {agentPercent === null
                              ? t("unlimitedTokens")
                              : `${agentPercent}% ${t("usageTokensUsed").toLowerCase()}`}
                          </span>
                          {billingRangeLabel ? <span>{billingRangeLabel}</span> : null}
                        </div>
                        {entitlements.overLimit ? (
                          <p className="sa-warn">{t("quotaExceededHint")}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>

                  <div className="sa-stats">
                    <div className="sa-stat">
                      <span>{t("currentPlan")}</span>
                      <strong>{entitlements?.planName ?? accountStatus.account.planName}</strong>
                    </div>
                    <div className="sa-stat">
                      <span>{t("usageRemaining")}</span>
                      <strong className="tabular-nums">
                        {entitlements?.tokenLimit === null
                          ? t("unlimitedTokens")
                          : agentPercent == null
                            ? "—"
                            : `${Math.max(0, 100 - agentPercent)}%`}
                      </strong>
                    </div>
                    <div className="sa-stat">
                      <span>{t("billingPeriod")}</span>
                      <strong className="tabular-nums">
                        {daysLeftInPeriod == null
                          ? "—"
                          : `${daysLeftInPeriod} ${t("amDaysLeft")}`}
                      </strong>
                    </div>
                  </div>

                  <div className="sa-grid">
                    <article className="sa-panel">
                      <p className="sa-kicker">{t("userAccountSettings")}</p>
                      <p className="sa-panel-body">{t("userAccountSettingsBody")}</p>
                      <Field label={t("profileName")}>
                        <input
                          value={accountName}
                          onChange={(event) => setAccountName(event.target.value)}
                          className="field"
                          autoComplete="name"
                        />
                      </Field>
                      <p className="sa-email-static">{accountStatus.account.email}</p>
                      <button
                        type="button"
                        disabled={accountBusy || !profileDirty}
                        onClick={() => void saveAccountProfile()}
                        className="sa-cta is-block"
                      >
                        {t("saveProfile")}
                      </button>
                    </article>

                    <article className="sa-panel">
                      <p className="sa-kicker">{t("activateSubscription")}</p>
                      <p className="sa-panel-body">{t("subscriptionCodesHint")}</p>
                      <Field label={t("applySubscription")}>
                        <input
                          value={subscribeCode}
                          onChange={(event) => setSubscribeCode(event.target.value.toUpperCase())}
                          placeholder="PRO-ARRAB"
                          className="field font-mono text-xs"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </Field>
                      <div className="sa-panel-actions">
                        <button
                          type="button"
                          disabled={accountBusy || !subscribeCode.trim()}
                          onClick={() => void activateSubscription()}
                          className="sa-cta is-block"
                        >
                          {t("applySubscription")}
                        </button>
                        <button
                          type="button"
                          className="sa-ghost is-block"
                          onClick={() => void openPlansPage()}
                        >
                          {t("managePlansOnWebsite")}
                          <ExternalLink className="size-3.5" strokeWidth={1.9} />
                        </button>
                      </div>
                    </article>
                  </div>
                </>
              ) : (
                <article className="sa-hero sa-signed-out">
                  <div className="sa-identity">
                    <div className="sa-avatar is-empty" aria-hidden>
                      <CircleUserRound className="size-7" strokeWidth={1.5} />
                    </div>
                    <div className="sa-identity-copy">
                      <h3>{t("accountNotConnected")}</h3>
                      <p className="sa-panel-body">{t("webAuthHint")}</p>
                    </div>
                  </div>
                  <div className="sa-hero-actions">
                    <button
                      type="button"
                      className="sa-cta"
                      disabled={accountBusy || webAuthWaiting}
                      onClick={() => void startBrowserSignIn()}
                    >
                      <ExternalLink className="size-3.5" strokeWidth={1.8} />
                      {webAuthWaiting ? t("webAuthWaiting") : t("signInWithBrowser")}
                    </button>
                    {webAuthWaiting ? (
                      <button type="button" className="sa-ghost" onClick={cancelWebAuth}>
                        {t("cancelWebAuth")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="sa-ghost"
                        onClick={() => void openPlansPage()}
                      >
                        {t("managePlansOnWebsite")}
                        <ExternalLink className="size-3.5" strokeWidth={1.9} />
                      </button>
                    )}
                  </div>
                  {webAuthWaiting ? (
                    <p className="sa-panel-body">{t("webAuthWaitingBody")}</p>
                  ) : null}
                  {entitlements && !entitlements.connected ? (
                    <div className="sa-stats is-compact">
                      <div className="sa-stat">
                        <span>{t("currentPlan")}</span>
                        <strong>{entitlements.planName}</strong>
                      </div>
                      <div className="sa-stat">
                        <span>{t("amTokenLimit")}</span>
                        <strong>
                          {entitlements.tokenLimit === null
                            ? t("unlimitedTokens")
                            : t("plansUsageTier").replace(
                                "{n}",
                                (() => {
                                  const base = 100_000;
                                  const lim = entitlements.tokenLimit || base;
                                  return `${Math.max(1, Math.round(lim / base))}×`;
                                })(),
                              )}
                        </strong>
                      </div>
                    </div>
                  ) : null}
                </article>
              )}

              {accountError ? <p className="sa-error">{accountError}</p> : null}
            </section>
          ) : null}

          {tab === "general" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsGeneral")}</h2>
                  <p>{t("generalBody")}</p>
                </div>
              </header>

              <article className="sg-hero">
                <div className="sg-hero-top">
                  <div className="sg-identity">
                    <div className="sg-avatar" aria-hidden>
                      {initialsFromName(displayName, accountStatus?.account?.email ?? "")}
                    </div>
                    <div className="sg-identity-copy">
                      <h3>{displayName || t("generalStudioProfile")}</h3>
                      <p>
                        {role?.trim()
                          ? role
                          : accountStatus?.account?.email ?? t("generalStudioProfile")}
                      </p>
                    </div>
                  </div>
                  <div className="sg-hero-actions">
                    <button
                      type="button"
                      disabled={profileBusy}
                      onClick={() => void saveProfile()}
                      className="sg-cta"
                    >
                      {savedFlash ? t("prefsSaved") : t("saveProfile")}
                    </button>
                    <button type="button" onClick={loadOperator} className="sg-ghost">
                      {t("reloadProfile")}
                    </button>
                  </div>
                </div>
                <div className="sg-fields">
                  <Field label={t("profileName")}>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="field"
                      autoComplete="name"
                    />
                  </Field>
                  <Field label={t("profileRole")}>
                    <input
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                      className="field"
                      list="arrab-seats"
                    />
                    <datalist id="arrab-seats">
                      {seats.map((seat) => (
                        <option key={seat} value={seat} />
                      ))}
                    </datalist>
                  </Field>
                </div>
                <p className="sg-body">{t("profileApiHint")}</p>
                {profileError ? <p className="sg-error">{profileError}</p> : null}
              </article>

              <div className="sg-grid">
                <article className="sg-panel">
                  <div className="sg-panel-head">
                    <Moon className="size-4" strokeWidth={1.8} />
                    <p className="sg-kicker">{t("settingsAppearance")}</p>
                  </div>
                  <p className="sg-body">{t("generalAppearanceBody")}</p>
                  <div className="sg-choices">
                    <Choice
                      active={theme === "dark"}
                      onClick={() => setTheme("dark")}
                      icon={<Moon className="size-4" />}
                      label={t("themeDark")}
                    />
                    <Choice
                      active={theme === "light"}
                      onClick={() => setTheme("light")}
                      icon={<Sun className="size-4" />}
                      label={t("themeLight")}
                    />
                  </div>
                  <div className="sg-choices">
                    <Choice active={locale === "en"} onClick={() => setLocale("en")} label="English" />
                    <Choice active={locale === "ar"} onClick={() => setLocale("ar")} label="العربية" />
                  </div>
                </article>

                <article className="sg-panel">
                  <div className="sg-panel-head">
                    <Workflow className="size-4" strokeWidth={1.8} />
                    <p className="sg-kicker">{t("generalBehavior")}</p>
                  </div>
                  <div className="sg-toggles">
                    <Toggle
                      label={t("coworkEnterSend")}
                      checked={prefs.coworkEnterSend}
                      onChange={(value) => updatePref("coworkEnterSend", value)}
                    />
                    <Toggle
                      label={t("coworkAutoResume")}
                      checked={prefs.coworkAutoResume}
                      onChange={(value) => updatePref("coworkAutoResume", value)}
                    />
                    <Toggle
                      label={t("coworkTerminalDock")}
                      checked={prefs.coworkTerminalDock}
                      onChange={(value) => updatePref("coworkTerminalDock", value)}
                    />
                    <Toggle
                      label={t("desktopAlwaysOnTop")}
                      checked={prefs.desktopAlwaysOnTop}
                      onChange={(value) => updatePref("desktopAlwaysOnTop", value)}
                    />
                  </div>
                </article>
              </div>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <HardDrive className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("defaultCoworkFolder")}</p>
                </div>
                <p className="sg-path">{coworkFolder ?? t("noDefaultFolder")}</p>
                <div className="sg-actions">
                  <button
                    type="button"
                    onClick={() => void chooseDefaultFolder()}
                    className="sg-cta"
                  >
                    {t("chooseFolder")}
                  </button>
                  <button type="button" onClick={clearDefaultFolder} className="sg-ghost">
                    {t("clearFolder")}
                  </button>
                </div>
              </article>

              <div className="sg-grid">
                <article className="sg-panel">
                  <div className="sg-panel-head">
                    <Cable className="size-4" strokeWidth={1.8} />
                    <p className="sg-kicker">{t("generalEnvironment")}</p>
                  </div>
                  <div className="sg-facts">
                    <div className="sg-fact">
                      <span>{t("workspaceId")}</span>
                      <button
                        type="button"
                        className="sg-mono"
                        disabled={!meta?.workspaceId}
                        onClick={() => {
                          if (!meta?.workspaceId) return;
                          void navigator.clipboard.writeText(meta.workspaceId).then(
                            () => pushToast({ title: t("generalCopied"), tone: "success" }),
                            () => pushToast({ title: t("apiUnavailable"), tone: "warn" }),
                          );
                        }}
                      >
                        <span>{meta?.workspaceId ? shortId(meta.workspaceId) : "—"}</span>
                        <Copy className="size-3.5 shrink-0" strokeWidth={1.8} />
                      </button>
                    </div>
                    <div className="sg-fact">
                      <span>{t("apiVersion")}</span>
                      <strong className="tabular-nums">{meta?.version ?? "—"}</strong>
                    </div>
                    <div className="sg-fact">
                      <span>{t("persistence")}</span>
                      <strong>
                        {meta
                          ? meta.persistence === "file"
                            ? t("persistenceFile")
                            : meta.persistence === "postgres"
                              ? t("persistencePostgres")
                              : t("persistenceMemory")
                          : "—"}
                      </strong>
                    </div>
                  </div>
                </article>

                <article className="sg-panel">
                  <div className="sg-panel-head">
                    <Shield className="size-4" strokeWidth={1.8} />
                    <p className="sg-kicker">{t("settingsPrivacy")}</p>
                  </div>
                  <div className="sg-toggles">
                    <Toggle
                      label={t("privacyLocalNotes")}
                      checked={prefs.privacyLocalNotes}
                      onChange={(value) => updatePref("privacyLocalNotes", value)}
                    />
                    <Toggle
                      label={t("privacyCrash")}
                      checked={prefs.privacyCrash}
                      onChange={(value) => updatePref("privacyCrash", value)}
                    />
                    <Toggle
                      label={t("privacyAnalytics")}
                      checked={prefs.privacyAnalytics}
                      onChange={(value) => updatePref("privacyAnalytics", value)}
                    />
                  </div>
                </article>
              </div>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Sparkles className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("generalQuickLinks")}</p>
                </div>
                <div className="sg-links">
                  <button type="button" className="sg-ghost" onClick={() => selectTab("account")}>
                    {t("settingsAccount")}
                  </button>
                  <button type="button" className="sg-ghost" onClick={() => selectTab("usage")}>
                    {t("settingsUsage")}
                  </button>
                  <button type="button" className="sg-ghost" onClick={() => selectTab("models")}>
                    {t("settingsLocalModels")}
                  </button>
                  <button
                    type="button"
                    className="sg-ghost"
                    onClick={() => void openPlansPage()}
                  >
                    {t("managePlansOnWebsite")}
                    <ExternalLink className="size-3.5" strokeWidth={1.9} />
                  </button>
                </div>
              </article>

              <article className="sg-panel is-danger">
                <div className="sg-panel-head">
                  <Shield className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("generalDangerZone")}</p>
                </div>
                <p className="sg-body">{t("generalDefaultsBody")}</p>
                <div className="sg-actions">
                  <button type="button" onClick={resetPrefs} className="sg-ghost">
                    {t("resetPrefs")}
                  </button>
                  <button type="button" onClick={wipeLocalData} className="sg-ghost is-danger">
                    {t("clearLocalData")}
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {tab === "appearance" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsAppearance")}</h2>
                  <p>{t("generalAppearanceBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  {theme === "dark" ? (
                    <Moon className="size-4" strokeWidth={1.8} />
                  ) : (
                    <Sun className="size-4" strokeWidth={1.8} />
                  )}
                  <p className="sg-kicker">{t("settingsTheme")}</p>
                </div>
                <div className="sg-choices">
                  <Choice
                    active={theme === "dark"}
                    onClick={() => setTheme("dark")}
                    icon={<Moon className="size-4" />}
                    label={t("themeDark")}
                  />
                  <Choice
                    active={theme === "light"}
                    onClick={() => setTheme("light")}
                    icon={<Sun className="size-4" />}
                    label={t("themeLight")}
                  />
                </div>
              </article>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <CircleUserRound className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsLanguage")}</p>
                </div>
                <div className="sg-choices">
                  <Choice active={locale === "en"} onClick={() => setLocale("en")} label="English" />
                  <Choice active={locale === "ar"} onClick={() => setLocale("ar")} label="العربية" />
                </div>
              </article>
            </section>
          ) : null}

          {tab === "models" ? <LocalModelsSettingsPanel /> : null}

          {tab === "notifications" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsNotifications")}</h2>
                  <p>{t("notificationsBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Bell className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsNotifications")}</p>
                </div>
                <div className="sg-toggles">
                  <Toggle
                    label={t("notifyApprovals")}
                    checked={prefs.notifyApprovals}
                    onChange={(value) => updatePref("notifyApprovals", value)}
                  />
                  <Toggle
                    label={t("notifyTeamLaunch")}
                    checked={prefs.notifyTeamLaunch}
                    onChange={(value) => updatePref("notifyTeamLaunch", value)}
                  />
                  <Toggle
                    label={t("notifyConnector")}
                    checked={prefs.notifyConnector}
                    onChange={(value) => updatePref("notifyConnector", value)}
                  />
                  <Toggle
                    label={t("notifyCowork")}
                    checked={prefs.notifyCowork}
                    onChange={(value) => updatePref("notifyCowork", value)}
                  />
                  <Toggle
                    label={t("notifyAgentPresence")}
                    checked={prefs.notifyAgentPresence}
                    onChange={(value) => updatePref("notifyAgentPresence", value)}
                  />
                  <Toggle
                    label={t("notifyAppUpdates")}
                    checked={prefs.notifyAppUpdates}
                    onChange={(value) => updatePref("notifyAppUpdates", value)}
                  />
                  <Toggle
                    label={t("autoCheckUpdates")}
                    checked={prefs.autoCheckUpdates}
                    onChange={(value) => updatePref("autoCheckUpdates", value)}
                  />
                </div>
                <p className="sg-body mt-3">{t("notifyAgentPresenceBody")}</p>
                <p className="sg-body mt-2">{t("notifyAppUpdatesBody")}</p>
              </article>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Monitor className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("osNotifyStatus")}</p>
                </div>
                <div className="sg-facts">
                  <div className="sg-fact">
                    <span>{t("osNotifyStatus")}</span>
                    <strong className="tabular-nums">{notifyPermission}</strong>
                  </div>
                </div>
                <div className="sg-actions">
                  <button type="button" onClick={() => void requestOsNotify()} className="sg-ghost">
                    {t("enableOsNotify")}
                  </button>
                  <button type="button" onClick={() => void sendTestNotify()} className="sg-cta">
                    {savedFlash ? t("prefsSaved") : t("testNotify")}
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {tab === "privacy" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsPrivacy")}</h2>
                  <p>{t("generalDefaultsBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Shield className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsPrivacy")}</p>
                </div>
                <div className="sg-toggles">
                  <Toggle
                    label={t("privacyLocalNotes")}
                    checked={prefs.privacyLocalNotes}
                    onChange={(value) => updatePref("privacyLocalNotes", value)}
                  />
                  <Toggle
                    label={t("privacyAnalytics")}
                    checked={prefs.privacyAnalytics}
                    onChange={(value) => updatePref("privacyAnalytics", value)}
                  />
                  <Toggle
                    label={t("privacyCrash")}
                    checked={prefs.privacyCrash}
                    onChange={(value) => updatePref("privacyCrash", value)}
                  />
                </div>
              </article>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <HardDrive className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("crashLog")}</p>
                </div>
                {crashLog.length === 0 ? (
                  <p className="sg-body">{t("crashLogEmpty")}</p>
                ) : (
                  <div className="sg-crash-list">
                    {crashLog.slice(0, 5).map((entry) => (
                      <div key={`${entry.at}-${entry.message}`} className="sg-crash">
                        <p>{entry.message}</p>
                        <span>
                          {entry.source ?? "app"} · {new Date(entry.at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="sg-actions">
                  <button
                    type="button"
                    onClick={() => {
                      clearCrashLog();
                      setCrashLog([]);
                    }}
                    className="sg-ghost"
                  >
                    {t("clearCrashLog")}
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {tab === "cowork" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsCowork")}</h2>
                  <p>{t("coworkPrefsBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Workflow className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsCowork")}</p>
                </div>
                <div className="sg-toggles">
                  <Toggle
                    label={t("coworkAutoResume")}
                    checked={prefs.coworkAutoResume}
                    onChange={(value) => updatePref("coworkAutoResume", value)}
                  />
                  <Toggle
                    label={t("coworkEnterSend")}
                    checked={prefs.coworkEnterSend}
                    onChange={(value) => updatePref("coworkEnterSend", value)}
                  />
                  <Toggle
                    label={t("coworkTerminalDock")}
                    checked={prefs.coworkTerminalDock}
                    onChange={(value) => updatePref("coworkTerminalDock", value)}
                  />
                </div>
              </article>
            </section>
          ) : null}

          {tab === "desktop" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsDesktop")}</h2>
                  <p>{t("desktopBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Monitor className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsDesktop")}</p>
                </div>
                <div className="sg-toggles">
                  <Toggle
                    label={t("desktopAlwaysOnTop")}
                    checked={prefs.desktopAlwaysOnTop}
                    onChange={(value) => updatePref("desktopAlwaysOnTop", value)}
                  />
                </div>
                {!isTauriRuntime() ? (
                  <p className="sg-body">{t("desktopAppRequired")}</p>
                ) : null}
              </article>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <HardDrive className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("defaultCoworkFolder")}</p>
                </div>
                <p className="sg-path">{coworkFolder ?? t("noDefaultFolder")}</p>
                <div className="sg-actions">
                  <button
                    type="button"
                    onClick={() => void chooseDefaultFolder()}
                    className="sg-cta"
                  >
                    {t("chooseFolder")}
                  </button>
                  <button type="button" onClick={clearDefaultFolder} className="sg-ghost">
                    {t("clearFolder")}
                  </button>
                </div>
              </article>

              <article className="sg-panel is-danger">
                <div className="sg-panel-head">
                  <Shield className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("localData")}</p>
                </div>
                <p className="sg-body">{t("localDataBody")}</p>
                <div className="sg-actions">
                  <button type="button" onClick={resetPrefs} className="sg-ghost">
                    {t("resetPrefs")}
                  </button>
                  <button type="button" onClick={wipeLocalData} className="sg-ghost is-danger">
                    {t("clearLocalData")}
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {tab === "shortcuts" ? (
            <section className="settings-rise sg">
              <header className="sg-head">
                <div>
                  <h2>{t("settingsShortcuts")}</h2>
                  <p>{t("shortcutsBody")}</p>
                </div>
              </header>

              <article className="sg-panel">
                <div className="sg-panel-head">
                  <Keyboard className="size-4" strokeWidth={1.8} />
                  <p className="sg-kicker">{t("settingsShortcuts")}</p>
                </div>
                <div className="sg-shortcuts">
                  {(
                    [
                      ["shortcutPalette", "⌘/Ctrl + K"],
                      ["shortcutSettings", "⌘/Ctrl + ,"],
                      ["shortcutTheme", "⌘/Ctrl + Shift + T"],
                      ["shortcutLocale", "⌘/Ctrl + Shift + L"],
                      ["shortcutCowork", "⌘/Ctrl + 3"],
                      ["shortcutChat", "⌘/Ctrl + 2"],
                      ["shortcutWorkforce", "⌘/Ctrl + 4"],
                    ] as const
                  ).map(([key, combo]) => (
                    <div key={key} className="sg-shortcut">
                      <span>{t(key)}</span>
                      <kbd>{combo}</kbd>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          ) : null}

          {tab === "about" ? (
            <section className="settings-rise sg">
              <AppUpdatesPanel />
              <article className="sg-about">
                <div className="sg-about-top">
                  <div className="sg-identity">
                    <img src={logoTall} alt="" className="sg-about-logo" />
                    <div className="sg-identity-copy">
                      <p className="sg-kicker">{t("settingsAbout")}</p>
                      <h3>{t("aboutVersion")}</h3>
                      <p>
                        {studioRole === "individual"
                          ? t("aboutTaglineIndividual")
                          : t("aboutTaglineOrganization")}
                      </p>
                    </div>
                  </div>
                  <span className="sg-version">v{pkg.version}</span>
                </div>
                <p className="sg-body">
                  {studioRole === "individual" ? t("aboutLead") : t("aboutLeadOrg")}
                </p>
                <div className="sg-facts">
                  <div className="sg-fact">
                    <span>{t("studioHealth")}</span>
                    <strong>{online ? t("healthOnline") : t("healthOffline")}</strong>
                  </div>
                  <div className="sg-fact">
                    <span>{t("apiVersion")}</span>
                    <strong className="tabular-nums">{meta?.version ?? "—"}</strong>
                  </div>
                  <div className="sg-fact">
                    <span>{t("persistence")}</span>
                    <strong>
                      {meta
                        ? meta.persistence === "file"
                          ? t("persistenceFile")
                          : meta.persistence === "postgres"
                            ? t("persistencePostgres")
                            : t("persistenceMemory")
                        : "—"}
                    </strong>
                  </div>
                  <div className="sg-fact">
                    <span>{t("workspaceId")}</span>
                    <strong className="tabular-nums">
                      {meta?.workspaceId ? shortId(meta.workspaceId) : "—"}
                    </strong>
                  </div>
                </div>
                <div className="sg-actions">
                  <button
                    type="button"
                    disabled={connectionChecking}
                    onClick={() => void testConnection()}
                    className="sg-cta"
                  >
                    {connectionChecking ? t("checkingConnection") : t("checkConnection")}
                  </button>
                  <button
                    type="button"
                    className="sg-ghost"
                    onClick={() => void openPlansPage()}
                  >
                    {t("managePlansOnWebsite")}
                    <ExternalLink className="size-3.5" strokeWidth={1.9} />
                  </button>
                </div>
                {connectionMsg ? <p className="sg-body">{connectionMsg}</p> : null}
                <p className="sg-body">{t("aboutSecure")}</p>
              </article>
            </section>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function shortId(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Choice({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm",
        active ? "border-white bg-white text-black" : "border-white/15 text-neutral-400 hover:text-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cn(
        "flex w-full items-start justify-between gap-4 px-4 py-3.5 text-start",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-white">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">{description}</span>
        ) : null}
      </div>
      <span
        className={cn(
          "relative mt-0.5 h-[26px] w-[44px] shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--color-success)]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] size-[22px] rounded-full bg-white shadow-sm transition-all",
            checked ? "start-[20px]" : "start-[2px]",
          )}
        />
      </span>
    </button>
  );
}
