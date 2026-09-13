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
import { arrabApi, ApiRequestError } from "@/lib/api";
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
    // Desktop talks only to the managed public API — never keep a local URL override.
    writeApiBaseOverride(null);
    loadUsage();
    loadOperator();
    loadAccount();
  }, [loadAccount, loadOperator, loadUsage]);

  useEffect(() => {
    if (tab !== "usage") return;

    const refresh = () => loadUsage();
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
  }, [tab, loadUsage]);

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
    setConnectionChecking(true);
    try {
      const [apiMeta, ai] = await Promise.all([
        arrabApi.meta(),
        arrabApi.aiStatus().catch(() => null),
      ]);
      await arrabApi.health();
      setOnline(true);
      if (ai) setAiReady(ai.configured);
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
    writeApiBaseOverride(null);
    setPrefs(defaultPrefs());
    setCoworkFolder(null);
    setCrashLog([]);
    pushToast({ title: t("clearLocalDone"), tone: "success" });
  }

  return (
    <Surface className="settings-shell">
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
          <nav className="mt-5 max-h-[70vh] space-y-0.5 overflow-auto pe-1">
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
            <section className="settings-rise space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
                    {t("settingsUsage")}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-500">{t("usageOverview")}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <HealthChip online={online} aiReady={aiReady} t={t} />
                  <p className="text-[11px] text-neutral-600">{t("usageAutoRefresh")}</p>
                </div>
              </div>

              {showUpgradeCard ? (
                <div
                  className="overflow-hidden rounded-[18px] border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(126,182,255,0.14), rgba(255,255,255,0.03) 42%, rgba(0,0,0,0.2))",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9bc5ff]">
                        {t("upgradeAvailable")}
                      </p>
                      <p className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-white">
                        {upgradeTitle}
                      </p>
                      <p className="mt-0.5 text-[13px] text-neutral-400">{t("upgradeUsageBody")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectTab("plans")}
                      className="h-9 shrink-0 rounded-full bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90"
                    >
                      {t("upgrade")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("includedInPlan").replace("{plan}", planLabel)}
                </p>
                <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <UsageQuotaRow
                    label={t("usageAgentPool")}
                    percent={agentPercent}
                    usedLabel={
                      entitlements?.tokenLimit === null
                        ? `${(entitlements?.tokensUsed ?? tokenUsage.inputTokens + tokenUsage.outputTokens).toLocaleString()} · ${t("unlimitedTokens")}`
                        : `${(entitlements?.tokensUsed ?? 0).toLocaleString()} / ${(entitlements?.tokenLimit ?? 0).toLocaleString()}`
                    }
                    hint={
                      entitlements?.overLimit ? t("quotaExceededHint") : t("usageAgentPoolHint")
                    }
                    over={Boolean(entitlements?.overLimit)}
                    usedSuffix={t("percentUsed")}
                  />
                  <div className="mx-4 border-t border-white/[0.06]" />
                  <UsageQuotaRow
                    label={t("usageStudioPool")}
                    percent={studioPercent}
                    usedLabel={`${studioUsed} / ${STUDIO_OPS_SOFT_CAP}`}
                    hint={t("usageStudioPoolHint")}
                    usedSuffix={t("percentUsed")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("onDemandUsage")}
                </p>
                <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <Toggle
                    label={
                      prefs.onDemandEnabled ? t("onDemandEnabledStatus") : t("onDemandDisabledStatus")
                    }
                    description={t("onDemandBody")}
                    checked={prefs.onDemandEnabled}
                    onChange={(value) => updatePref("onDemandEnabled", value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("usageBreakdown")}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <UsageMetric label={t("usageInputTokens")} value={tokenUsage.inputTokens} />
                  <UsageMetric label={t("usageOutputTokens")} value={tokenUsage.outputTokens} />
                  <UsageMetric label={t("usageCompletions")} value={tokenUsage.events} />
                </div>
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
            <section className="settings-rise space-y-6">
              <div>
                <h2 className="text-2xl font-medium tracking-tight text-white">{t("settingsConnection")}</h2>
                <p className="mt-1.5 text-sm text-neutral-500">{t("connectionBody")}</p>
              </div>

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("connectionStatusSection")}
                </p>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212]">
                  <SettingRow
                    title={t("studioHealth")}
                    description={t("connectionManagedBody")}
                    trailing={
                      <StatusPill
                        on={online === true}
                        onLabel={t("healthOnline")}
                        offLabel={online === null ? "…" : t("healthOffline")}
                      />
                    }
                  />
                  <div className="mx-4 border-t border-white/8" />
                  <SettingRow
                    title={t("aiGateway")}
                    description={t("aiManagedBody")}
                    trailing={
                      <StatusPill
                        on={aiReady}
                        onLabel={t("healthAiReady")}
                        offLabel={t("healthAiWaiting")}
                      />
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("connectionDetailsSection")}
                </p>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212]">
                  <SettingRow
                    title={t("apiVersion")}
                    description={t("apiVersionBody")}
                    trailing={
                      <span className="text-sm tabular-nums text-neutral-300">
                        {meta?.version ?? "—"}
                      </span>
                    }
                  />
                  <div className="mx-4 border-t border-white/8" />
                  <SettingRow
                    title={t("persistence")}
                    description={t("persistenceBody")}
                    trailing={
                      <span className="text-sm text-neutral-300">
                        {meta
                          ? meta.persistence === "file"
                            ? t("persistenceFile")
                            : meta.persistence === "postgres"
                              ? t("persistencePostgres")
                              : t("persistenceMemory")
                          : "—"}
                      </span>
                    }
                  />
                  <div className="mx-4 border-t border-white/8" />
                  <SettingRow
                    title={t("workspaceId")}
                    description={t("workspaceIdBody")}
                    trailing={
                      <span className="max-w-[10rem] truncate text-sm text-neutral-400" title={meta?.workspaceId}>
                        {meta?.workspaceId ? shortId(meta.workspaceId) : "—"}
                      </span>
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={connectionChecking}
                  onClick={() => void testConnection()}
                  className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-50"
                >
                  {connectionChecking ? t("checkingConnection") : t("checkConnection")}
                </button>
                {connectionMsg ? (
                  <p className="text-sm text-neutral-400">{connectionMsg}</p>
                ) : null}
              </div>

              <p className="text-xs leading-relaxed text-neutral-600">{t("aboutSecure")}</p>
            </section>
          ) : null}

          {tab === "notifications" ? (
            <section className="settings-rise space-y-6">
              <div>
                <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
                  {t("settingsNotifications")}
                </h2>
                <p className="mt-1.5 text-sm text-neutral-500">{t("notificationsBody")}</p>
              </div>
              <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Toggle
                  label={t("notifyApprovals")}
                  checked={prefs.notifyApprovals}
                  onChange={(value) => updatePref("notifyApprovals", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("notifyTeamLaunch")}
                  checked={prefs.notifyTeamLaunch}
                  onChange={(value) => updatePref("notifyTeamLaunch", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("notifyConnector")}
                  checked={prefs.notifyConnector}
                  onChange={(value) => updatePref("notifyConnector", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("notifyCowork")}
                  checked={prefs.notifyCowork}
                  onChange={(value) => updatePref("notifyCowork", value)}
                />
              </div>
              <p className="px-1 text-xs text-neutral-500">
                {t("osNotifyStatus")}: {notifyPermission}
              </p>
              <div className="flex flex-wrap gap-2 px-1">
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
            <section className="settings-rise space-y-6">
              <div>
                <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
                  {t("settingsPrivacy")}
                </h2>
              </div>
              <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Toggle
                  label={t("privacyLocalNotes")}
                  checked={prefs.privacyLocalNotes}
                  onChange={(value) => updatePref("privacyLocalNotes", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("privacyAnalytics")}
                  checked={prefs.privacyAnalytics}
                  onChange={(value) => updatePref("privacyAnalytics", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("privacyCrash")}
                  checked={prefs.privacyCrash}
                  onChange={(value) => updatePref("privacyCrash", value)}
                />
              </div>
              <div className="space-y-2">
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("crashLog")}
                </p>
                {crashLog.length === 0 ? (
                  <p className="px-1 text-sm text-neutral-500">{t("crashLogEmpty")}</p>
                ) : (
                  crashLog.slice(0, 5).map((entry) => (
                    <div
                      key={`${entry.at}-${entry.message}`}
                      className="rounded-[14px] border border-white/[0.08] bg-[#141414] px-3 py-2 text-xs text-neutral-400"
                    >
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
            <section className="settings-rise space-y-6">
              <div>
                <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
                  {t("settingsCowork")}
                </h2>
                <p className="mt-1.5 text-sm text-neutral-500">{t("coworkPrefsBody")}</p>
              </div>
              <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Toggle
                  label={t("coworkAutoResume")}
                  checked={prefs.coworkAutoResume}
                  onChange={(value) => updatePref("coworkAutoResume", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("coworkEnterSend")}
                  checked={prefs.coworkEnterSend}
                  onChange={(value) => updatePref("coworkEnterSend", value)}
                />
                <div className="mx-4 border-t border-white/[0.06]" />
                <Toggle
                  label={t("coworkTerminalDock")}
                  checked={prefs.coworkTerminalDock}
                  onChange={(value) => updatePref("coworkTerminalDock", value)}
                />
              </div>
              <p className="px-1 text-xs text-neutral-500">{t("prefsApplyLive")}</p>
            </section>
          ) : null}

          {tab === "desktop" ? (
            <section className="settings-rise space-y-6">
              <div>
                <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-white">
                  {t("settingsDesktop")}
                </h2>
                <p className="mt-1.5 text-sm text-neutral-500">{t("desktopBody")}</p>
              </div>
              <div className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#141414] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <Toggle
                  label={t("desktopAlwaysOnTop")}
                  checked={prefs.desktopAlwaysOnTop}
                  onChange={(value) => updatePref("desktopAlwaysOnTop", value)}
                />
              </div>
              <div className="rounded-[18px] border border-white/[0.08] bg-[#141414] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500">
                  {t("defaultCoworkFolder")}
                </p>
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

function shortId(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function SettingRow({
  title,
  description,
  trailing,
}: {
  title: string;
  description: string;
  trailing: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-neutral-500">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{trailing}</div>
    </div>
  );
}

function StatusPill({
  on,
  onLabel,
  offLabel,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        on
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : "border-white/10 bg-white/[0.03] text-neutral-400",
      )}
    >
      <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-300" : "bg-neutral-500")} />
      {on ? onLabel : offLabel}
    </span>
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
    <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-neutral-400">
      <span className={cn("size-1.5 rounded-full", online ? "bg-[#34c759]" : "bg-neutral-500")} />
      {online ? t("healthOnline") : t("healthOffline")}
      <span className="text-neutral-700">·</span>
      <span className={cn("size-1.5 rounded-full", aiReady ? "bg-[#34c759]" : "bg-neutral-500")} />
      {aiReady ? t("healthAiReady") : t("healthAiWaiting")}
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[16px] border border-white/[0.08] bg-[#141414] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-[11px] font-medium text-neutral-500">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em] tabular-nums text-white">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function UsageQuotaRow({
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
  const clamped = Math.max(0, Math.min(100, percent));
  const size = 44;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const ringColor = over ? "#f5c451" : "#7eb6ff";

  return (
    <div className="flex items-start gap-3.5 px-4 py-3.5">
      <div className="relative mt-0.5 shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-neutral-300">
          {clamped}%
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-medium text-white">{label}</p>
          <p className="shrink-0 text-[13px] tabular-nums text-neutral-400">
            {clamped}% {usedSuffix}
          </p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-700 ease-out",
              over ? "bg-[#f5c451]" : "bg-[#7eb6ff]",
            )}
            style={{ width: `${Math.max(clamped > 0 ? 3 : 0, clamped)}%` }}
          />
        </div>
        <p className={cn("mt-2 text-[12px] leading-snug", over ? "text-amber-200/90" : "text-neutral-500")}>
          {usedLabel}
          <span className="text-neutral-600"> · </span>
          {hint}
        </p>
      </div>
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
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 px-4 py-3.5 text-start"
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
          checked ? "bg-[#34c759]" : "bg-white/15",
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
