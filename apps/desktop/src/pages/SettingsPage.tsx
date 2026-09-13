import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bell,
  ChartColumn,
  CircleUserRound,
  CreditCard,
  Cable,
  ExternalLink,
  Keyboard,
  KeyRound,
  Layers3,
  LogOut,
  Monitor,
  Moon,
  Shield,
  Sparkles,
  Sun,
  Workflow,
} from "lucide-react";
import { PlansCatalog } from "@/components/PlansCatalog";
import { Surface } from "@/components/StudioFrame";
import { ROLE_PATH } from "@/roles/catalog";
import { useRole } from "@/roles/RoleProvider";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { arrabApi, getApiBaseUrl, ApiRequestError } from "@/lib/api";
import {
  clearAccountSession,
  initialsFromName,
  writeAccountSession,
  ACCOUNT_EVENT,
} from "@/lib/account-session";
import { openExternalUrl, setAlwaysOnTop } from "@/lib/desktop";
import {
  ensureNotificationPermission,
  notifyStudio,
  pushToast,
} from "@/lib/notify";
import {
  clearCrashLog,
  clearLocalStudioData,
  defaultPrefs,
  readApiBaseOverride,
  readCrashLog,
  readPrefs,
  recordCrash,
  writeApiBaseOverride,
  writePrefs,
  type StudioPrefs,
} from "@/lib/prefs";
import { pickFolder, isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/messages";
import type { AccountStatusResponse, PlanAudience, SubscriptionPlanId } from "@arrab/shared";

type SettingsTab =
  | "usage"
  | "account"
  | "plans"
  | "general"
  | "appearance"
  | "connection"
  | "notifications"
  | "privacy"
  | "cowork"
  | "desktop"
  | "shortcuts"
  | "about";

const FOLDER_KEY = "arrab.cowork.folder";
const SETTINGS_TABS: SettingsTab[] = [
  "usage",
  "account",
  "plans",
  "general",
  "appearance",
  "connection",
  "notifications",
  "privacy",
  "cowork",
  "desktop",
  "shortcuts",
  "about",
];

function readSettingsTab(value: string | null): SettingsTab {
  return value && SETTINGS_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : "usage";
}

export function SettingsPage() {
  const { t, locale, setLocale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { role: studioRole, href } = useRole();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>(() => readSettingsTab(searchParams.get("tab")));

  useEffect(() => {
    setTab(readSettingsTab(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    if (tab === "account") {
      navigate(href("/account"), { replace: true });
    }
  }, [tab, href, navigate]);

  const [prefs, setPrefs] = useState<StudioPrefs>(() => readPrefs());
  const [savedFlash, setSavedFlash] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [usage, setUsage] = useState({
    projects: 0,
    employees: 0,
    teams: 0,
    chats: 0,
    connectors: 0,
  });
  const [tokenUsage, setTokenUsage] = useState({
    inputTokens: 0,
    outputTokens: 0,
    events: 0,
  });
  const [entitlements, setEntitlements] = useState<AccountStatusResponse["entitlements"] | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatusResponse | null>(null);
  const [accountMode, setAccountMode] = useState<"connect" | "signIn">("connect");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [subscribeCode, setSubscribeCode] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [webAuthWaiting, setWebAuthWaiting] = useState(false);
  const [showLocalAuth, setShowLocalAuth] = useState(false);
  const [showAdvancedAccount, setShowAdvancedAccount] = useState(false);
  const [planAudience, setPlanAudience] = useState<PlanAudience>(studioRole);
  const webAuthAbortRef = useRef<{ cancelled: boolean; timer?: number }>({ cancelled: false });
  const [displayName, setDisplayName] = useState("Studio operator");
  const [role, setRole] = useState("Founder");
  const [seats, setSeats] = useState<string[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [apiUrlDraft, setApiUrlDraft] = useState(() => readApiBaseOverride() ?? getApiBaseUrl());
  const [meta, setMeta] = useState<{
    version: string;
    persistence: string;
    workspaceId: string;
    aiProviders: string[];
  } | null>(null);
  const [connectionMsg, setConnectionMsg] = useState<string | null>(null);
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
      arrabApi.dashboard(),
      arrabApi.connectors(),
      arrabApi.aiStatus(),
      arrabApi.usage(),
      arrabApi.meta().catch(() => null),
      arrabApi.health().catch(() => null),
    ])
      .then(([dashboard, connectors, ai, tokens, apiMeta]) => {
        setOnline(true);
        setAiReady(ai.configured);
        setUsage({
          projects: dashboard.projects.length,
          employees: dashboard.agents.length,
          teams: dashboard.teams.length,
          chats: dashboard.conversations.length,
          connectors: connectors.items.length,
        });
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
          setAccountEmail(status.account.email);
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
    loadUsage();
    loadOperator();
    loadAccount();
  }, [loadAccount, loadOperator, loadUsage]);

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
      [
        ["usage", t("settingsUsage"), ChartColumn],
        ["account", t("settingsAccount"), KeyRound],
        ["plans", t("settingsPlans"), CreditCard],
        ["general", t("settingsGeneral"), CircleUserRound],
        ["appearance", t("settingsAppearance"), theme === "dark" ? Moon : Sun],
        ["connection", t("settingsConnection"), Cable],
        ["notifications", t("settingsNotifications"), Bell],
        ["privacy", t("settingsPrivacy"), Shield],
        ["cowork", t("settingsCowork"), Workflow],
        ["desktop", t("settingsDesktop"), Monitor],
        ["shortcuts", t("settingsShortcuts"), Keyboard],
        ["about", t("settingsAbout"), Sparkles],
      ] as const,
    [t, theme],
  );

  const STUDIO_OPS_SOFT_CAP = 50;
  const studioUsed = Math.min(
    STUDIO_OPS_SOFT_CAP,
    usage.projects + usage.employees + usage.teams + usage.chats + usage.connectors,
  );
  const agentPercent = useMemo(() => {
    if (!entitlements || entitlements.tokenLimit === null || entitlements.tokenLimit <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((entitlements.tokensUsed / entitlements.tokenLimit) * 100));
  }, [entitlements]);
  const studioPercent = Math.min(100, Math.round((studioUsed / STUDIO_OPS_SOFT_CAP) * 100));
  const planId = accountStatus?.account?.planId ?? entitlements?.planId ?? null;
  const planLabel = entitlements?.planName ?? t("accountNotConnected");

  useEffect(() => {
    setPlanAudience(studioRole);
  }, [studioRole]);
  const showUpgradeCard = !planId || planId === "free" || planId === "pro";
  const upgradeTitle =
    !planId || planId === "free" ? t("upgradeToPro") : t("upgradeToTeam");

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

  async function submitAccount() {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const result =
        accountMode === "connect"
          ? await arrabApi.connectAccount({
              email: accountEmail,
              password: accountPassword,
              displayName: accountName.trim() || undefined,
            })
          : await arrabApi.signInAccount({
              email: accountEmail,
              password: accountPassword,
            });
      writeAccountSession(result.sessionToken);
      setAccountStatus({
        connected: true,
        account: result.account,
        entitlements: result.entitlements,
        plans: accountStatus?.plans ?? [],
      });
      setEntitlements(result.entitlements);
      setAccountPassword("");
      setDisplayName(result.account.displayName);
      setShowLocalAuth(false);
      pushToast({
        title: t("accountSignedIn"),
        body: `${result.account.planName} · ${result.entitlements.tokenLimit?.toLocaleString() ?? t("unlimitedTokens")}`,
        tone: "success",
      });
      loadAccount();
      loadUsage();
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setAccountError(message);
      recordCrash(message, "settings.account");
    } finally {
      setAccountBusy(false);
    }
  }

  function cancelWebAuth() {
    webAuthAbortRef.current.cancelled = true;
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
      await openExternalUrl(started.authorizationUrl);
      setWebAuthWaiting(true);
      pushToast({
        title: t("webAuthOpened"),
        body: t("webAuthOpenedBody"),
        tone: "info",
      });

      const pollOnce = async (): Promise<void> => {
        if (webAuthAbortRef.current.cancelled) {
          return;
        }
        const polled = await arrabApi.pollWebAuth(started.state);
        if (webAuthAbortRef.current.cancelled) {
          return;
        }
        if (polled.status === "completed" && polled.account && polled.sessionToken && polled.entitlements) {
          writeAccountSession(polled.sessionToken);
          setAccountStatus({
            connected: true,
            account: polled.account,
            entitlements: polled.entitlements,
            plans: accountStatus?.plans ?? [],
          });
          setEntitlements(polled.entitlements);
          setAccountName(polled.account.displayName);
          setAccountEmail(polled.account.email);
          setDisplayName(polled.account.displayName);
          setWebAuthWaiting(false);
          setAccountBusy(false);
          pushToast({
            title: t("accountSignedIn"),
            body: `${polled.account.displayName} · ${polled.account.email}`,
            tone: "success",
          });
          loadAccount();
          loadUsage();
          return;
        }
        if (polled.status === "expired") {
          setWebAuthWaiting(false);
          setAccountBusy(false);
          setAccountError(polled.message ?? t("webAuthExpired"));
          return;
        }
        webAuthAbortRef.current.timer = window.setTimeout(() => {
          void pollOnce().catch((err: unknown) => {
            if (webAuthAbortRef.current.cancelled) {
              return;
            }
            const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
            setAccountError(message);
            setWebAuthWaiting(false);
            setAccountBusy(false);
          });
        }, started.pollIntervalMs);
      };

      await pollOnce();
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
      setAccountPassword("");
      setShowAdvancedAccount(false);
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
    if (next === "plans") {
      setSearchParams({ tab: "plans" }, { replace: true });
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
    try {
      const [health, apiMeta] = await Promise.all([arrabApi.health(), arrabApi.meta()]);
      setOnline(true);
      setMeta({
        version: apiMeta.version,
        persistence: apiMeta.persistence,
        workspaceId: apiMeta.workspaceId,
        aiProviders: apiMeta.aiProviders,
      });
      setConnectionMsg(
        `${t("connectionOk")} · ${health.status} · v${apiMeta.version} · ${apiMeta.persistence}`,
      );
      pushToast({ title: t("connectionOk"), tone: "success" });
    } catch (err: unknown) {
      setOnline(false);
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setConnectionMsg(message);
      recordCrash(message, "settings.connection");
    }
  }

  function applyApiUrl() {
    const next = apiUrlDraft.trim().replace(/\/$/, "");
    if (!next) {
      setConnectionMsg(t("apiUrlRequired"));
      return;
    }
    try {
      // Validate URL shape
      // eslint-disable-next-line no-new
      new URL(next);
    } catch {
      setConnectionMsg(t("apiUrlInvalid"));
      return;
    }
    writeApiBaseOverride(next);
    setConnectionMsg(t("apiUrlApplied"));
    pushToast({ title: t("apiUrlApplied"), body: next, tone: "success" });
    void testConnection();
  }

  function resetApiUrl() {
    writeApiBaseOverride(null);
    setApiUrlDraft(getApiBaseUrl());
    setConnectionMsg(t("apiUrlReset"));
    void testConnection();
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
    await notifyStudio({
      kind: "approvals",
      title: t("testNotifyTitle"),
      body: t("testNotifyBody"),
      href: href("/settings"),
    });
    // Force show even if approvals disabled — user asked for test
    if (!prefs.notifyApprovals) {
      pushToast({ title: t("testNotifyTitle"), body: t("testNotifyBody") });
    }
  }

  function wipeLocalData() {
    if (!window.confirm(t("clearLocalConfirm"))) {
      return;
    }
    clearLocalStudioData();
    setPrefs(defaultPrefs());
    setCoworkFolder(null);
    setCrashLog([]);
    setApiUrlDraft(getApiBaseUrl());
    pushToast({ title: t("clearLocalDone"), tone: "success" });
  }

  return (
    <Surface className="settings-shell">
      <div className="settings-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-8 lg:flex-row lg:px-10">
        <aside className="w-full shrink-0 lg:w-56">
          <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{t("settings")}</p>
          <h1 className="mt-1 text-2xl font-medium tracking-[-0.03em] text-white">{t("settingsTitle")}</h1>
          <p className="mt-2 text-sm text-neutral-500">{t("settingsBody")}</p>
          <nav className="mt-6 max-h-[70vh] space-y-1 overflow-auto pe-1">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm transition-colors",
                  tab === id ? "bg-white text-black" : "text-neutral-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {tab === "usage" ? (
            <section className="settings-rise space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("settingsUsage")}
                  </p>
                  <h2 className="mt-1 text-lg text-white">{t("usageOverview")}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={loadUsage}
                    className="h-8 rounded-full border border-white/15 px-3 text-xs text-neutral-300 hover:bg-white/5"
                  >
                    {t("refreshUsage")}
                  </button>
                  <HealthChip online={online} aiReady={aiReady} t={t} />
                </div>
              </div>

              {showUpgradeCard ? (
                <div className="overflow-hidden rounded-[22px] border border-[#2a3a55] bg-gradient-to-br from-[#121a28] via-[#0d1420] to-[#0a0e14]">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">
                        {t("upgradeAvailable")}
                      </p>
                      <p className="mt-1 text-2xl font-medium tracking-[-0.03em] text-white">
                        {upgradeTitle}
                      </p>
                      <p className="mt-1 text-sm text-neutral-400">{t("upgradeUsageBody")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectTab("plans")}
                      className="h-10 rounded-full bg-[#7eb6ff] px-5 text-sm font-medium text-[#0a1220] hover:bg-[#9bc5ff]"
                    >
                      {t("upgrade")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[22px] border border-white/10 bg-[#080808] p-5 lg:p-6">
                <p className="text-sm text-neutral-300">
                  {t("includedInPlan").replace("{plan}", planLabel)}
                </p>

                <div className="mt-6 space-y-7">
                  <UsagePercentRow
                    label={t("usageAgentPool")}
                    percent={agentPercent}
                    usedSuffix={t("percentUsed")}
                    usedLabel={
                      entitlements?.tokenLimit === null
                        ? `${(entitlements?.tokensUsed ?? tokenUsage.inputTokens + tokenUsage.outputTokens).toLocaleString()} · ${t("unlimitedTokens")}`
                        : `${(entitlements?.tokensUsed ?? 0).toLocaleString()} / ${(entitlements?.tokenLimit ?? 0).toLocaleString()}`
                    }
                    hint={t("usageAgentPoolHint")}
                    over={Boolean(entitlements?.overLimit)}
                  />
                  <UsagePercentRow
                    label={t("usageStudioPool")}
                    percent={studioPercent}
                    usedSuffix={t("percentUsed")}
                    usedLabel={`${studioUsed} / ${STUDIO_OPS_SOFT_CAP}`}
                    hint={t("usageStudioPoolHint")}
                  />
                </div>

                {entitlements?.overLimit ? (
                  <p className="mt-5 text-xs text-amber-200/90">{t("quotaExceededHint")}</p>
                ) : null}
              </div>

              <div className="rounded-[22px] border border-white/10 bg-[#080808] p-5 lg:p-6">
                <p className="text-sm text-white">{t("onDemandUsage")}</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5">
                  <div>
                    <p className="text-sm text-neutral-200">
                      {prefs.onDemandEnabled
                        ? t("onDemandEnabledStatus")
                        : t("onDemandDisabledStatus")}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">{t("onDemandBody")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePref("onDemandEnabled", !prefs.onDemandEnabled)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium",
                      prefs.onDemandEnabled
                        ? "bg-white text-black"
                        : "border border-white/15 text-neutral-400",
                    )}
                  >
                    {prefs.onDemandEnabled ? t("enabled") : t("disabled")}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <UsageMetric label={t("usageInputTokens")} value={tokenUsage.inputTokens} />
                <UsageMetric label={t("usageOutputTokens")} value={tokenUsage.outputTokens} />
                <UsageMetric label={t("usageCompletions")} value={tokenUsage.events} />
              </div>
            </section>
          ) : null}

          {tab === "plans" ? (
            <section className="settings-rise space-y-4">
              <div className="flex flex-wrap gap-2 px-1">
                <button
                  type="button"
                  onClick={() => navigate(ROLE_PATH.individual)}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("plansIndividuals")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(ROLE_PATH.organization)}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("plansOrganizations")}
                </button>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <PlansCatalog
                audience={planAudience}
                onAudienceChange={(next: PlanAudience) => {
                  navigate(
                    `${next === "organization" ? ROLE_PATH.organization : ROLE_PATH.individual}/settings?tab=plans`,
                  );
                }}
                currentPlanId={(planId as SubscriptionPlanId | null) ?? null}
                signedIn={Boolean(accountStatus?.connected && accountStatus.account)}
                onAccountChanged={(status) => {
                  setAccountStatus(status);
                  setEntitlements(status.entitlements);
                }}
                onNeedSignIn={() => selectTab("account")}
                variant="settings"
              />
              </div>
            </section>
          ) : null}

          {tab === "account" ? (
            <section className="settings-rise space-y-5 rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <div>
                <h2 className="text-lg text-white">{t("settingsAccount")}</h2>
                <p className="mt-1 text-sm text-neutral-500">{t("accountBody")}</p>
              </div>

              {entitlements ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <MetaRow
                    label={t("accountStatus")}
                    value={
                      entitlements.connected
                        ? t("accountSignedInStatus")
                        : t("accountNotConnected")
                    }
                  />
                  <MetaRow label={t("currentPlan")} value={entitlements.planName} />
                  <MetaRow
                    label={t("periodTokens")}
                    value={`${entitlements.tokensUsed.toLocaleString()} / ${
                      entitlements.tokenLimit === null
                        ? t("unlimitedTokens")
                        : entitlements.tokenLimit.toLocaleString()
                    }`}
                  />
                  <MetaRow
                    label={t("billingPeriod")}
                    value={`${new Date(entitlements.periodStart).toLocaleDateString()} → ${new Date(entitlements.periodEnd).toLocaleDateString()}`}
                  />
                </div>
              ) : null}

              {accountStatus?.connected && accountStatus.account ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-semibold tracking-wide text-white">
                      {initialsFromName(
                        accountStatus.account.displayName,
                        accountStatus.account.email,
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base text-white">
                        {accountStatus.account.displayName}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-neutral-400">
                        {accountStatus.account.email}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-neutral-300">
                          {accountStatus.account.planName}
                        </span>
                        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100">
                          {t("accountSignedInStatus")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={accountBusy}
                      onClick={() => setShowAdvancedAccount((open) => !open)}
                      className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5 disabled:opacity-50"
                    >
                      {showAdvancedAccount ? t("hideUserSettings") : t("userAccountSettings")}
                    </button>
                    <button
                      type="button"
                      disabled={accountBusy}
                      onClick={() => void logoutAccount()}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                    >
                      <LogOut className="size-3.5" strokeWidth={1.8} />
                      {t("logOut")}
                    </button>
                  </div>

                  {showAdvancedAccount ? (
                    <div className="space-y-4 rounded-2xl border border-white/10 p-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          {t("userAccountSettings")}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">{t("userAccountSettingsBody")}</p>
                      </div>

                      <Field label={t("profileName")}>
                        <input
                          value={accountName}
                          onChange={(event) => setAccountName(event.target.value)}
                          className="field"
                        />
                      </Field>
                      <p className="text-sm text-neutral-400">{accountStatus.account.email}</p>
                      <button
                        type="button"
                        disabled={accountBusy || !accountName.trim()}
                        onClick={() => void saveAccountProfile()}
                        className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                      >
                        {t("saveProfile")}
                      </button>

                      <div className="rounded-2xl border border-white/10 p-4">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          {t("activateSubscription")}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">{t("subscriptionCodesHint")}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <input
                            value={subscribeCode}
                            onChange={(event) => setSubscribeCode(event.target.value)}
                            placeholder="PRO-ARRAB"
                            className="field max-w-xs font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={accountBusy || !subscribeCode.trim()}
                            onClick={() => void activateSubscription()}
                            className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                          >
                            {t("applySubscription")}
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => selectTab("plans")}
                        className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                      >
                        {t("settingsPlans")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <p className="text-sm text-neutral-300">{t("webAuthHint")}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={accountBusy || webAuthWaiting}
                        onClick={() => void startBrowserSignIn()}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
                      >
                        <ExternalLink className="size-3.5" strokeWidth={1.8} />
                        {webAuthWaiting ? t("webAuthWaiting") : t("signInWithBrowser")}
                      </button>
                      {webAuthWaiting ? (
                        <button
                          type="button"
                          onClick={cancelWebAuth}
                          className="h-10 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                        >
                          {t("cancelWebAuth")}
                        </button>
                      ) : null}
                    </div>
                    {webAuthWaiting ? (
                      <p className="mt-3 text-xs text-neutral-500">{t("webAuthWaitingBody")}</p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowLocalAuth((open) => !open)}
                    className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
                  >
                    {showLocalAuth ? t("hideLocalAuth") : t("showLocalAuth")}
                  </button>

                  {showLocalAuth ? (
                    <div className="space-y-4 rounded-2xl border border-dashed border-white/10 p-4">
                      <p className="text-xs text-neutral-500">{t("accountLocalHint")}</p>
                      <div className="flex gap-2">
                        <Choice
                          active={accountMode === "connect"}
                          onClick={() => setAccountMode("connect")}
                          label={t("createAccount")}
                        />
                        <Choice
                          active={accountMode === "signIn"}
                          onClick={() => setAccountMode("signIn")}
                          label={t("signInAccount")}
                        />
                      </div>
                      {accountMode === "connect" ? (
                        <Field label={t("profileName")}>
                          <input
                            value={accountName}
                            onChange={(event) => setAccountName(event.target.value)}
                            className="field"
                          />
                        </Field>
                      ) : null}
                      <Field label={t("accountEmail")}>
                        <input
                          type="email"
                          value={accountEmail}
                          onChange={(event) => setAccountEmail(event.target.value)}
                          className="field"
                          autoComplete="email"
                        />
                      </Field>
                      <Field label={t("accountPassword")}>
                        <input
                          type="password"
                          value={accountPassword}
                          onChange={(event) => setAccountPassword(event.target.value)}
                          className="field"
                          autoComplete={accountMode === "connect" ? "new-password" : "current-password"}
                        />
                      </Field>
                      <button
                        type="button"
                        disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 8}
                        onClick={() => void submitAccount()}
                        className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                      >
                        {accountMode === "connect" ? t("connectAccount") : t("signInAccount")}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {accountError ? <p className="text-sm text-red-300">{accountError}</p> : null}
            </section>
          ) : null}

          {tab === "general" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsGeneral")}</h2>
              <p className="mt-1 text-sm text-neutral-500">{t("profileApiHint")}</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label={t("profileName")}>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="field"
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
              {profileError ? <p className="mt-3 text-sm text-red-300">{profileError}</p> : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={profileBusy}
                  onClick={() => void saveProfile()}
                  className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                >
                  {savedFlash ? t("prefsSaved") : t("saveProfile")}
                </button>
                <button
                  type="button"
                  onClick={loadOperator}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("reloadProfile")}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "appearance" ? (
            <section className="settings-rise space-y-5 rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsAppearance")}</h2>
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{t("settingsTheme")}</p>
                <div className="mt-2 flex gap-2">
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
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{t("settingsLanguage")}</p>
                <div className="mt-2 flex gap-2">
                  <Choice active={locale === "en"} onClick={() => setLocale("en")} label="English" />
                  <Choice active={locale === "ar"} onClick={() => setLocale("ar")} label="العربية" />
                </div>
              </div>
            </section>
          ) : null}

          {tab === "connection" ? (
            <section className="settings-rise space-y-5 rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <div>
                <h2 className="text-lg text-white">{t("settingsConnection")}</h2>
                <p className="mt-1 text-sm text-neutral-500">{t("connectionBody")}</p>
              </div>
              <Field label={t("apiBaseUrl")}>
                <input
                  value={apiUrlDraft}
                  onChange={(event) => setApiUrlDraft(event.target.value)}
                  className="field font-mono text-xs"
                  placeholder="http://127.0.0.1:8787"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyApiUrl}
                  className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black"
                >
                  {t("applyApiUrl")}
                </button>
                <button
                  type="button"
                  onClick={() => void testConnection()}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("checkConnection")}
                </button>
                <button
                  type="button"
                  onClick={resetApiUrl}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-neutral-400 hover:bg-white/5"
                >
                  {t("resetApiUrl")}
                </button>
              </div>
              {connectionMsg ? <p className="text-sm text-neutral-300">{connectionMsg}</p> : null}
              <HealthChip online={online} aiReady={aiReady} t={t} />
              {meta ? (
                <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
                  <MetaRow label={t("apiVersion")} value={meta.version} />
                  <MetaRow
                    label={t("persistence")}
                    value={
                      meta.persistence === "file"
                        ? t("persistenceFile")
                        : meta.persistence === "postgres"
                          ? t("persistencePostgres")
                          : t("persistenceMemory")
                    }
                  />
                  <MetaRow label={t("workspaceId")} value={meta.workspaceId} />
                  <MetaRow
                    label={t("aiGateway")}
                    value={meta.aiProviders.length ? meta.aiProviders.join(", ") : t("healthAiWaiting")}
                  />
                  <MetaRow label={t("activeApiUrl")} value={getApiBaseUrl()} mono />
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "notifications" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsNotifications")}</h2>
              <p className="mt-1 text-sm text-neutral-500">{t("notificationsBody")}</p>
              <div className="mt-5 space-y-3">
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
              </div>
              <p className="mt-4 text-xs text-neutral-500">
                {t("osNotifyStatus")}: {notifyPermission}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void requestOsNotify()}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("enableOsNotify")}
                </button>
                <button
                  type="button"
                  onClick={() => void sendTestNotify()}
                  className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black"
                >
                  {savedFlash ? t("prefsSaved") : t("testNotify")}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "privacy" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsPrivacy")}</h2>
              <div className="mt-5 space-y-3">
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
              <div className="mt-6 space-y-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{t("crashLog")}</p>
                {crashLog.length === 0 ? (
                  <p className="text-sm text-neutral-500">{t("crashLogEmpty")}</p>
                ) : (
                  crashLog.slice(0, 5).map((entry) => (
                    <div key={`${entry.at}-${entry.message}`} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-neutral-400">
                      <p className="text-neutral-200">{entry.message}</p>
                      <p className="mt-1 text-neutral-600">
                        {entry.source ?? "app"} · {new Date(entry.at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => {
                    clearCrashLog();
                    setCrashLog([]);
                  }}
                  className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                >
                  {t("clearCrashLog")}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "cowork" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsCowork")}</h2>
              <p className="mt-1 text-sm text-neutral-500">{t("coworkPrefsBody")}</p>
              <div className="mt-5 space-y-3">
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
              <p className="mt-4 text-xs text-neutral-500">{t("prefsApplyLive")}</p>
            </section>
          ) : null}

          {tab === "desktop" ? (
            <section className="settings-rise space-y-5 rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <div>
                <h2 className="text-lg text-white">{t("settingsDesktop")}</h2>
                <p className="mt-1 text-sm text-neutral-500">{t("desktopBody")}</p>
              </div>
              <Toggle
                label={t("desktopAlwaysOnTop")}
                checked={prefs.desktopAlwaysOnTop}
                onChange={(value) => updatePref("desktopAlwaysOnTop", value)}
              />
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{t("defaultCoworkFolder")}</p>
                <p className="mt-2 break-all text-sm text-neutral-300">
                  {coworkFolder ?? t("noDefaultFolder")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void chooseDefaultFolder()}
                    className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black"
                  >
                    {t("chooseFolder")}
                  </button>
                  <button
                    type="button"
                    onClick={clearDefaultFolder}
                    className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                  >
                    {t("clearFolder")}
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{t("localData")}</p>
                <p className="mt-2 text-sm text-neutral-500">{t("localDataBody")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={wipeLocalData}
                    className="h-9 rounded-full border border-red-400/30 px-4 text-sm text-red-200 hover:bg-red-500/10"
                  >
                    {t("clearLocalData")}
                  </button>
                  <button
                    type="button"
                    onClick={resetPrefs}
                    className="h-9 rounded-full border border-white/15 px-4 text-sm text-white hover:bg-white/5"
                  >
                    {t("resetPrefs")}
                  </button>
                </div>
              </div>
              {!isTauriRuntime() ? (
                <p className="text-sm text-amber-200/80">{t("desktopAppRequired")}</p>
              ) : null}
            </section>
          ) : null}

          {tab === "shortcuts" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <h2 className="text-lg text-white">{t("settingsShortcuts")}</h2>
              <p className="mt-1 text-sm text-neutral-500">{t("shortcutsBody")}</p>
              <div className="mt-5 space-y-2">
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
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-3"
                  >
                    <span className="text-sm text-neutral-300">{t(key)}</span>
                    <kbd className="rounded-md border border-white/15 bg-black/40 px-2 py-1 font-mono text-[11px] text-neutral-400">
                      {combo}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "about" ? (
            <section className="settings-rise rounded-[28px] border border-white/10 bg-[#080808] p-5 lg:p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-white/5">
                  <Layers3 className="size-5 text-white" strokeWidth={1.6} />
                </div>
                <div>
                  <h2 className="text-lg text-white">{t("aboutVersion")}</h2>
                  <p className="text-sm text-neutral-500">
                    {meta ? `API ${meta.version} · ${meta.persistence}` : t("aboutPhase")}
                  </p>
                </div>
              </div>
              <p className="mt-5 text-sm text-neutral-400">{t("aboutSecure")}</p>
              <div className="mt-5">
                <HealthChip online={online} aiReady={aiReady} t={t} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span className={cn("text-neutral-200", mono && "break-all font-mono text-xs")}>{value}</span>
    </div>
  );
}

function HealthChip({
  online,
  aiReady,
  t,
}: {
  online: boolean | null;
  aiReady: boolean;
  t: (key: MessageKey) => string;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-neutral-400">
      <span className={cn("size-1.5 rounded-full", online ? "bg-white" : "border border-white/40")} />
      {t("studioHealth")} · {online ? t("healthOnline") : t("healthOffline")}
      <span className="text-neutral-600">·</span>
      {aiReady ? t("healthAiReady") : t("healthAiWaiting")}
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-medium tabular-nums text-white">{value}</p>
    </div>
  );
}

function UsagePercentRow({
  label,
  percent,
  usedLabel,
  hint,
  over,
  usedSuffix,
}: {
  label: string;
  percent: number;
  usedLabel: string;
  hint: string;
  over?: boolean;
  usedSuffix: string;
}) {
  const width = Math.max(percent > 0 ? 4 : 0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm text-white">{label}</p>
        <p className="text-sm tabular-nums text-neutral-400">
          {percent}% {usedSuffix}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            over ? "bg-amber-300" : "bg-[#7eb6ff]",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        {usedLabel} · {hint}
      </p>
    </div>
  );
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
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-3 text-start"
    >
      <span className="text-sm text-neutral-300">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full border transition-colors",
          checked ? "border-white bg-white" : "border-white/20 bg-black",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 rounded-full transition-all",
            checked ? "start-4 bg-black" : "start-0.5 bg-white/70",
          )}
        />
      </span>
    </button>
  );
}
