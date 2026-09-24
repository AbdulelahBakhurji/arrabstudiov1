import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CircleUserRound,
  Copy,
  ExternalLink,
  LogOut,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import appSymbol from "@/assets/symbol.png";
import "@/styles/settings.css";
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
  readAccountSessionToken,
  subscribeAccountSession,
} from "@/lib/account-session";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { isGuestLocalMode, subscribeGuestMode } from "@/lib/guest-mode";
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
  writeApiRoutePrefixOverride,
  writePrefs,
  type StudioPrefs,
} from "@/lib/prefs";
import { pickFolder, isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import type { AccountStatusResponse, AiGatewayStatusResponse } from "@arrab/shared";
import { LocalModelsSettingsPanel } from "@/components/LocalModelsSettingsPanel";
import { SkillsSettingsPanel } from "@/components/SkillsSettingsPanel";
import { AppUpdatesPanel } from "@/components/AppUpdatesPanel";
import {
  isSettingsTabId,
  SETTINGS_GROUPS,
  settingsTabsFor,
  type SettingsTabId,
} from "@/features/settings-tabs";

type SettingsTab = SettingsTabId;

const FOLDER_KEY = "arrab.cowork.folder";

function readSettingsTab(value: string | null): SettingsTab {
  return isSettingsTabId(value) ? value : "general";
}

export function SettingsPage() {
  const { t, locale, setLocale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { role: studioRole, href } = useRole();
  const { isChild: isFamilyChild } = useFamilyProfile();
  const { account: signedInAccount, status: signedInStatus } = useSignedInAccount();
  const accountId = signedInAccount?.id ?? null;
  const [guestLocal, setGuestLocal] = useState(() => isGuestLocalMode());
  useEffect(() => subscribeGuestMode(() => setGuestLocal(isGuestLocalMode())), []);
  /** Cloud session only — guest / local-only must not see account-bound settings. */
  const isSignedIn =
    Boolean(signedInAccount) && signedInStatus?.connected !== false && !guestLocal;
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
        // Workspace may still store a profile after logout — only show it with a live session.
        const sessionOk =
          Boolean(readAccountSessionToken()) && !isGuestLocalMode() && Boolean(signedInAccount);
        if (!sessionOk) {
          setAccountStatus({
            ...status,
            connected: false,
            account: null,
          });
          setEntitlements(status.entitlements);
          setAccountName("");
          setAccountError(null);
          return;
        }
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
  }, [t, signedInAccount]);

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
    if (!isSignedIn) return;
    loadOperator();
  }, [isSignedIn, loadOperator]);

  // Drop previous account's token cards immediately when the signed-in user changes.
  useEffect(() => {
    setTokenUsage({ inputTokens: 0, outputTokens: 0, events: 0 });
    setEntitlements(null);
    loadUsage();
    loadAccount();
  }, [accountId, loadUsage, loadAccount]);

  // Guest / signed-out — wipe any leftover workspace profile from the Account panel.
  useEffect(() => {
    if (isSignedIn) return;
    setAccountStatus((prev) => (prev ? { ...prev, connected: false, account: null } : null));
    setAccountName("");
    loadAccount();
  }, [isSignedIn, loadAccount]);

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
        // Signed-out: never surface family/org-only settings from a stale role.
        audience: isSignedIn ? studioRole : "individual",
        isFamilyChild,
        theme,
        signedIn: isSignedIn,
      }).map((tab) => [tab.id, t(tab.labelKey), tab.icon, tab.group] as const),
    [t, theme, studioRole, isFamilyChild, isSignedIn],
  );
  const [navQuery, setNavQuery] = useState("");
  const navGroups = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: tabs.filter(
        ([, label, , groupId]) => groupId === group.id && (!q || label.toLowerCase().includes(q)),
      ),
    })).filter((group) => group.items.length > 0);
  }, [tabs, navQuery]);

  useEffect(() => {
    if (studioRole !== "individual") return;
    if (tab === "cowork" || tab === "family") {
      setTab("general");
      setSearchParams({}, { replace: true });
    }
  }, [studioRole, tab, setSearchParams]);

  useEffect(() => {
    if (studioRole !== "organization") return;
    if (tab === "family") {
      setTab("general");
      setSearchParams({}, { replace: true });
    }
  }, [studioRole, tab, setSearchParams]);

  useEffect(() => {
    // Signed-out (or non-family) — never keep the Family settings panel open.
    if (tab === "family" && (!isSignedIn || studioRole !== "family")) {
      setTab("general");
      setSearchParams({}, { replace: true });
    }
    if (!isSignedIn && (tab === "cowork" || tab === "family")) {
      setTab("general");
      setSearchParams({}, { replace: true });
    }
  }, [isSignedIn, studioRole, tab, setSearchParams]);

  useEffect(() => {
    if (!isFamilyChild) return;
    const allowed = new Set(tabs.map(([id]) => id));
    if (!allowed.has(tab)) {
      setTab("general");
      setSearchParams({ tab: "general" }, { replace: true });
    }
  }, [isFamilyChild, tab, tabs, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("tab") === "plans") {
      setTab("account");
      setSearchParams({ tab: "account" }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const agentPercent = useMemo(() => {
    if (!isSignedIn) return null;
    if (!entitlements || entitlements.tokenLimit === null || entitlements.tokenLimit <= 0) {
      return null;
    }
    return Math.min(100, Math.round((entitlements.tokensUsed / entitlements.tokenLimit) * 100));
  }, [entitlements, isSignedIn]);
  const planLabel = isSignedIn
    ? (entitlements?.planName ?? t("accountNotConnected"))
    : t("accountNotConnected");
  const tokensUsedValue = isSignedIn
    ? (entitlements?.tokensUsed ?? tokenUsage.inputTokens + tokenUsage.outputTokens)
    : 0;
  const cloudOverLimit = Boolean(isSignedIn && entitlements?.overLimit);
  const periodLabel = useMemo(() => {
    if (!isSignedIn || !entitlements?.periodEnd) return null;
    const localeTag = locale === "ar" ? "ar-SA" : "en-US";
    return new Date(entitlements.periodEnd).toLocaleDateString(localeTag, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [entitlements?.periodEnd, locale, isSignedIn]);
  const billingRangeLabel = useMemo(() => {
    if (!isSignedIn || !entitlements?.periodStart || !entitlements?.periodEnd) return null;
    const localeTag = locale === "ar" ? "ar-SA" : "en-US";
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    return `${new Date(entitlements.periodStart).toLocaleDateString(localeTag, opts)} → ${new Date(entitlements.periodEnd).toLocaleDateString(localeTag, opts)}`;
  }, [entitlements?.periodStart, entitlements?.periodEnd, locale, isSignedIn]);
  const daysLeftInPeriod = useMemo(() => {
    if (!isSignedIn || !entitlements?.periodEnd) return null;
    const ms = new Date(entitlements.periodEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }, [entitlements?.periodEnd, isSignedIn]);
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
      await arrabApi.logoutAccount().catch(() => undefined);
      clearAccountSession();
      // Logout keeps the workspace profile on the API — never show it without a session.
      setAccountStatus((prev) =>
        prev ? { ...prev, connected: false, account: null } : null,
      );
      setEntitlements(null);
      setAccountName("");
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
    setSearchParams({ tab: next }, { replace: true });
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
      // Prefixed Coolify hosts may 404 on /health — meta is enough to prove reachability.
      await arrabApi.health().catch(() => null);
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
    writeApiRoutePrefixOverride(null);
    setPrefs(defaultPrefs());
    setCoworkFolder(null);
    setCrashLog([]);
    pushToast({ title: t("clearLocalDone"), tone: "success" });
  }

  return (
    <Surface className="settings-shell st">
      <div className="st-layout">
        <aside className="st-rail">
          <div className="st-rail-head">
            <h1>{t("settingsTitle")}</h1>
            <p>{t("settingsBody")}</p>
          </div>
          <label className="st-search">
            <Search className="size-[15px] shrink-0" strokeWidth={1.8} aria-hidden />
            <input
              value={navQuery}
              onChange={(event) => setNavQuery(event.target.value)}
              placeholder={t("settingsSearch")}
              aria-label={t("settingsSearch")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && navGroups[0]?.items[0]) {
                  selectTab(navGroups[0].items[0][0]);
                }
                if (event.key === "Escape") setNavQuery("");
              }}
            />
            {navQuery ? (
              <button
                type="button"
                className="st-search-clear"
                onClick={() => setNavQuery("")}
                aria-label={t("settingsSearch")}
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            ) : null}
          </label>
          <nav className="st-nav" aria-label={t("settingsTitle")}>
            {navGroups.map((group) => (
              <div key={group.id} className="st-nav-group">
                <p className="st-nav-label">{t(group.labelKey)}</p>
                {group.items.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectTab(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={cn("st-nav-item", tab === id && "is-active")}
                  >
                    <Icon className="size-[16px] shrink-0" strokeWidth={1.8} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ))}
            {navGroups.length === 0 ? <p className="st-nav-empty">{t("settingsNoMatch")}</p> : null}
          </nav>
        </aside>

        <div key={tab} className="st-content">
          {tab === "usage" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsUsage")} body={t("settingsUsageBody")} />

              {!isSignedIn ? (
                <SettingsCard>
                  <SettingRow title={t("amLocalModels")} description={t("amLocalUsageHint")}>
                    <span className="st-badge">0 {t("usageTokensUsed").toLowerCase()}</span>
                  </SettingRow>
                  <SettingRow title={t("accountNotConnected")} description={t("webAuthHint")}>
                    <button
                      type="button"
                      className="st-btn is-primary"
                      onClick={() => selectTab("account")}
                    >
                      {t("signInWithBrowser")}
                    </button>
                  </SettingRow>
                </SettingsCard>
              ) : (
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
                      {cloudOverLimit ? (
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
                        cloudOverLimit && "is-over",
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
              )}

              {isSignedIn && studioRole === "family" ? (
                <div className="grid gap-3">
                  <p className="st-note">{t("familyUsageHint")}</p>
                  <FamilyHouseholdPanel variant="compact" />
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === "family" && isSignedIn && studioRole === "family" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsFamily")} body={t("settingsFamilyBody")} />
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
                {isSignedIn ? (
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

              {isSignedIn && accountStatus?.account ? (
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
                              cloudOverLimit && "is-over",
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
                        {cloudOverLimit ? (
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
                    ) : null}
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
            <section className="settings-rise st-page">
              <PageHead
                title={t("settingsGeneral")}
                body={t("generalBody")}
                aside={<StatusPill online={online} label={online ? t("healthOnline") : t("healthOffline")} />}
              />

              {isSignedIn ? (
                <article className="st-card st-profile">
                  <div className="st-profile-top">
                    <div className="st-avatar" aria-hidden>
                      {initialsFromName(displayName, accountStatus?.account?.email ?? "")}
                    </div>
                    <div className="st-profile-copy">
                      <p className="st-eyebrow">{t("generalStudioProfile")}</p>
                      <h3>{displayName || t("generalStudioProfile")}</h3>
                      <p>{accountStatus?.account?.email ?? t("profileSaveHint")}</p>
                    </div>
                  </div>
                  <div className="st-profile-form">
                    <Field label={t("profileName")}>
                      <input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && displayName.trim()) void saveProfile();
                        }}
                        className="st-input"
                        autoComplete="name"
                      />
                    </Field>
                    <div className="st-actions">
                      <button type="button" onClick={loadOperator} className="st-btn">
                        {t("reloadProfile")}
                      </button>
                      <button
                        type="button"
                        disabled={profileBusy || !displayName.trim()}
                        onClick={() => void saveProfile()}
                        className="st-btn is-primary"
                      >
                        {savedFlash ? t("prefsSaved") : t("saveProfile")}
                      </button>
                    </div>
                  </div>
                  <p className="st-note">{t("profileSaveHint")}</p>
                  {profileError ? <p className="st-error">{profileError}</p> : null}
                </article>
              ) : (
                <article className="st-card st-profile is-guest">
                  <div className="st-profile-top">
                    <div className="st-avatar is-empty" aria-hidden>
                      <CircleUserRound className="size-6" strokeWidth={1.5} />
                    </div>
                    <div className="st-profile-copy">
                      <p className="st-eyebrow">{t("accountNotConnected")}</p>
                      <h3>{t("generalGuestTitle")}</h3>
                      <p>{t("generalGuestBody")}</p>
                    </div>
                    <button
                      type="button"
                      className="st-btn is-primary st-profile-cta"
                      onClick={() => selectTab("account")}
                    >
                      {t("signInWithBrowser")}
                    </button>
                  </div>
                </article>
              )}

              <SettingsCard title={t("settingsAppearance")}>
                <SettingRow title={t("settingsTheme")} description={t("settingsThemeBody")}>
                  <Segmented
                    label={t("settingsTheme")}
                    value={theme}
                    onChange={setTheme}
                    options={[
                      { value: "dark", label: t("themeDark"), icon: <Moon className="size-3.5" /> },
                      { value: "light", label: t("themeLight"), icon: <Sun className="size-3.5" /> },
                    ]}
                  />
                </SettingRow>
                <SettingRow title={t("settingsLanguage")} description={t("settingsLanguageBody")}>
                  <Segmented
                    label={t("settingsLanguage")}
                    value={locale}
                    onChange={setLocale}
                    options={[
                      { value: "en", label: "English" },
                      { value: "ar", label: "العربية" },
                    ]}
                  />
                </SettingRow>
              </SettingsCard>

              <SettingsCard title={t("generalBehavior")} description={t("generalBehaviorBody")}>
                <Toggle
                  label={t("coworkEnterSend")}
                  description={t("coworkEnterSendBody")}
                  checked={prefs.coworkEnterSend}
                  onChange={(value) => updatePref("coworkEnterSend", value)}
                />
                <Toggle
                  label={t("coworkAutoResume")}
                  description={t("coworkAutoResumeBody")}
                  checked={prefs.coworkAutoResume}
                  onChange={(value) => updatePref("coworkAutoResume", value)}
                />
                <Toggle
                  label={t("coworkTerminalDock")}
                  description={t("coworkTerminalDockBody")}
                  checked={prefs.coworkTerminalDock}
                  onChange={(value) => updatePref("coworkTerminalDock", value)}
                />
              </SettingsCard>
            </section>
          ) : null}

          {tab === "appearance" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsAppearance")} body={t("generalAppearanceBody")} />

              <SettingsCard title={t("settingsTheme")} description={t("settingsThemeBody")}>
                <div className="st-theme-tiles" role="radiogroup" aria-label={t("settingsTheme")}>
                  {(["dark", "light"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={theme === value}
                      onClick={() => setTheme(value)}
                      className={cn("st-theme-tile", theme === value && "is-active")}
                    >
                      <span className={cn("st-theme-preview", `is-${value}`)} aria-hidden>
                        <span className="st-tp-rail" />
                        <span className="st-tp-body">
                          <span className="st-tp-line is-wide" />
                          <span className="st-tp-line" />
                          <span className="st-tp-bubble" />
                        </span>
                      </span>
                      <span className="st-theme-label">
                        {value === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                        {value === "dark" ? t("themeDark") : t("themeLight")}
                      </span>
                    </button>
                  ))}
                </div>
              </SettingsCard>

              <SettingsCard>
                <SettingRow title={t("settingsLanguage")} description={t("settingsLanguageBody")}>
                  <Segmented
                    label={t("settingsLanguage")}
                    value={locale}
                    onChange={setLocale}
                    options={[
                      { value: "en", label: "English" },
                      { value: "ar", label: "العربية" },
                    ]}
                  />
                </SettingRow>
              </SettingsCard>
            </section>
          ) : null}

          {tab === "models" ? <LocalModelsSettingsPanel /> : null}

          {tab === "skills" ? <SkillsSettingsPanel /> : null}

          {tab === "notifications" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsNotifications")} body={t("notificationsBody")} />

              <SettingsCard title={t("settingsAlerts")}>
                <Toggle
                  label={t("notifyApprovals")}
                  description={t("notifyApprovalsBody")}
                  checked={prefs.notifyApprovals}
                  onChange={(value) => updatePref("notifyApprovals", value)}
                />
                <Toggle
                  label={t("notifyTeamLaunch")}
                  description={t("notifyTeamLaunchBody")}
                  checked={prefs.notifyTeamLaunch}
                  onChange={(value) => updatePref("notifyTeamLaunch", value)}
                />
                <Toggle
                  label={t("notifyConnector")}
                  description={t("notifyConnectorBody")}
                  checked={prefs.notifyConnector}
                  onChange={(value) => updatePref("notifyConnector", value)}
                />
                <Toggle
                  label={t("notifyCowork")}
                  description={t("notifyCoworkBody")}
                  checked={prefs.notifyCowork}
                  onChange={(value) => updatePref("notifyCowork", value)}
                />
              </SettingsCard>

              <SettingsCard title={t("settingsSystem")}>
                <Toggle
                  label={t("notifyAgentPresence")}
                  description={t("notifyAgentPresenceBody")}
                  checked={prefs.notifyAgentPresence}
                  onChange={(value) => updatePref("notifyAgentPresence", value)}
                />
                <Toggle
                  label={t("notifyAppUpdates")}
                  description={t("notifyAppUpdatesBody")}
                  checked={prefs.notifyAppUpdates}
                  onChange={(value) => updatePref("notifyAppUpdates", value)}
                />
                <Toggle
                  label={t("autoCheckUpdates")}
                  description={t("autoCheckUpdatesBody")}
                  checked={prefs.autoCheckUpdates}
                  onChange={(value) => updatePref("autoCheckUpdates", value)}
                />
                <SettingRow title={t("osNotifyStatus")} description={t("osNotifyBody")}>
                  <div className="st-actions">
                    {notifyPermission === "granted" ? (
                      <span className="st-badge is-ok">{t("osNotifyGranted")}</span>
                    ) : notifyPermission === "denied" ? (
                      <span className="st-badge is-warn">{t("osNotifyDenied")}</span>
                    ) : notifyPermission === "unsupported" ? (
                      <span className="st-badge">{t("osNotifyUnsupported")}</span>
                    ) : (
                      <button type="button" onClick={() => void requestOsNotify()} className="st-btn">
                        {t("enableOsNotify")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void sendTestNotify()}
                      className="st-btn is-primary"
                    >
                      {savedFlash ? t("prefsSaved") : t("testNotify")}
                    </button>
                  </div>
                </SettingRow>
              </SettingsCard>
            </section>
          ) : null}

          {tab === "privacy" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsPrivacy")} body={t("generalDefaultsBody")} />

              <SettingsCard>
                <Toggle
                  label={t("privacyLocalNotes")}
                  description={t("privacyLocalNotesBody")}
                  checked={prefs.privacyLocalNotes}
                  onChange={(value) => updatePref("privacyLocalNotes", value)}
                />
                <Toggle
                  label={t("privacyAnalytics")}
                  description={t("privacyAnalyticsBody")}
                  checked={prefs.privacyAnalytics}
                  onChange={(value) => updatePref("privacyAnalytics", value)}
                />
                <Toggle
                  label={t("privacyCrash")}
                  description={t("privacyCrashBody")}
                  checked={prefs.privacyCrash}
                  onChange={(value) => updatePref("privacyCrash", value)}
                />
              </SettingsCard>

              <SettingsCard
                title={t("crashLog")}
                action={
                  <button
                    type="button"
                    disabled={crashLog.length === 0}
                    onClick={() => {
                      clearCrashLog();
                      setCrashLog([]);
                    }}
                    className="st-btn is-sm"
                  >
                    {t("clearCrashLog")}
                  </button>
                }
              >
                {crashLog.length === 0 ? (
                  <p className="st-empty">{t("crashLogEmpty")}</p>
                ) : (
                  crashLog.slice(0, 5).map((entry) => (
                    <div key={`${entry.at}-${entry.message}`} className="st-log">
                      <p>{entry.message}</p>
                      <span>
                        {entry.source ?? "app"} · {new Date(entry.at).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </SettingsCard>
            </section>
          ) : null}

          {tab === "cowork" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsCowork")} body={t("coworkPrefsBody")} />

              <SettingsCard>
                <Toggle
                  label={t("coworkAutoResume")}
                  description={t("coworkAutoResumeBody")}
                  checked={prefs.coworkAutoResume}
                  onChange={(value) => updatePref("coworkAutoResume", value)}
                />
                <Toggle
                  label={t("coworkEnterSend")}
                  description={t("coworkEnterSendBody")}
                  checked={prefs.coworkEnterSend}
                  onChange={(value) => updatePref("coworkEnterSend", value)}
                />
                <Toggle
                  label={t("coworkTerminalDock")}
                  description={t("coworkTerminalDockBody")}
                  checked={prefs.coworkTerminalDock}
                  onChange={(value) => updatePref("coworkTerminalDock", value)}
                />
              </SettingsCard>
              <p className="st-note">{t("prefsApplyLive")}</p>
            </section>
          ) : null}

          {tab === "desktop" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsDesktop")} body={t("desktopBody")} />

              <SettingsCard title={t("settingsWindow")}>
                <Toggle
                  label={t("desktopAlwaysOnTop")}
                  description={
                    isTauriRuntime() ? t("desktopAlwaysOnTopBody") : t("desktopAppRequired")
                  }
                  checked={prefs.desktopAlwaysOnTop}
                  disabled={!isTauriRuntime()}
                  onChange={(value) => updatePref("desktopAlwaysOnTop", value)}
                />
              </SettingsCard>

              <SettingsCard title={t("settingsStorage")}>
                <SettingRow
                  title={t("defaultCoworkFolder")}
                  description={
                    coworkFolder ? (
                      <span className="st-path">{coworkFolder}</span>
                    ) : (
                      t("defaultCoworkFolderBody")
                    )
                  }
                >
                  <div className="st-actions">
                    {coworkFolder ? (
                      <button type="button" onClick={clearDefaultFolder} className="st-btn">
                        {t("clearFolder")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void chooseDefaultFolder()}
                      className="st-btn is-primary"
                    >
                      {t("chooseFolder")}
                    </button>
                  </div>
                </SettingRow>
              </SettingsCard>

              <SettingsCard title={t("generalDangerZone")} tone="danger">
                <SettingRow title={t("resetPrefs")} description={t("resetPrefsBody")}>
                  <button type="button" onClick={resetPrefs} className="st-btn">
                    {t("resetPrefs")}
                  </button>
                </SettingRow>
                <SettingRow title={t("clearLocalData")} description={t("localDataBody")}>
                  <button type="button" onClick={wipeLocalData} className="st-btn is-danger">
                    {t("clearLocalData")}
                  </button>
                </SettingRow>
              </SettingsCard>
            </section>
          ) : null}

          {tab === "shortcuts" ? (
            <section className="settings-rise st-page">
              <PageHead title={t("settingsShortcuts")} body={t("shortcutsBody")} />

              <SettingsCard>
                {(
                  [
                    ["shortcutPalette", [MOD_KEY, "K"]],
                    ["shortcutSettings", [MOD_KEY, ","]],
                    ["shortcutChat", [MOD_KEY, "2"]],
                    ["shortcutCowork", [MOD_KEY, "3"]],
                    ["shortcutWorkforce", [MOD_KEY, "4"]],
                    ["shortcutTheme", [MOD_KEY, "⇧", "T"]],
                    ["shortcutLocale", [MOD_KEY, "⇧", "L"]],
                  ] as const
                )
                  .filter(([key]) => key !== "shortcutWorkforce" || studioRole === "organization")
                  .map(([key, combo]) => (
                  <SettingRow key={key} title={t(key)}>
                    <span className="st-keys">
                      {combo.map((part) => (
                        <kbd key={part}>{part}</kbd>
                      ))}
                    </span>
                  </SettingRow>
                ))}
              </SettingsCard>
            </section>
          ) : null}

          {tab === "about" ? (
            <section className="settings-rise st-page">
              <article className="st-card st-about">
                <img src={appSymbol} alt="" className="st-about-logo" />
                <div className="st-about-copy">
                  <h2>{t("aboutVersion")}</h2>
                  <p>
                    {studioRole === "individual"
                      ? t("aboutTaglineIndividual")
                      : t("aboutTaglineOrganization")}
                  </p>
                </div>
                <span className="st-badge">v{pkg.version}</span>
              </article>

              <SettingsCard>
                <SettingRow
                  title={t("studioHealth")}
                  description={connectionMsg ?? (meta?.version ? `${t("serviceVersion")} ${meta.version}` : undefined)}
                >
                  <div className="st-actions">
                    <StatusPill
                      online={online}
                      label={online ? t("healthOnline") : t("healthOffline")}
                    />
                    <button
                      type="button"
                      disabled={connectionChecking}
                      onClick={() => void testConnection()}
                      className="st-btn"
                    >
                      {connectionChecking ? t("checkingConnection") : t("checkConnection")}
                    </button>
                  </div>
                </SettingRow>
                <SettingRow title={t("managePlansOnWebsite")}>
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() => void openPlansPage()}
                    aria-label={t("managePlansOnWebsite")}
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.9} />
                  </button>
                </SettingRow>
              </SettingsCard>

              <AppUpdatesPanel />

              <p className="st-note">
                {studioRole === "individual" ? t("aboutLead") : t("aboutLeadOrg")} {t("aboutSecure")}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

const MOD_KEY =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl";

function PageHead({ title, body, aside }: { title: string; body?: string; aside?: ReactNode }) {
  return (
    <header className="st-head">
      <div>
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
      </div>
      {aside ? <div className="st-head-aside">{aside}</div> : null}
    </header>
  );
}

function StatusPill({ online, label }: { online: boolean | null; label: string }) {
  return (
    <span className={cn("st-status", online ? "is-on" : online === false && "is-off")} aria-live="polite">
      <span className="st-status-dot" aria-hidden />
      {label}
    </span>
  );
}

function SettingsCard({
  title,
  description,
  action,
  tone,
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <article className={cn("st-card", tone === "danger" && "is-danger")}>
      {title ? (
        <header className="st-card-head">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="st-rows">{children}</div>
    </article>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="st-row">
      <div className="st-row-copy">
        <span className="st-row-title">{title}</span>
        {description ? <span className="st-row-desc">{description}</span> : null}
      </div>
      {children ? <div className="st-row-control">{children}</div> : null}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
}) {
  return (
    <div className="st-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(value === option.value && "is-active")}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="st-field">
      <span>{label}</span>
      {children}
    </label>
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
      className="st-row st-row-toggle"
    >
      <span className="st-row-copy">
        <span className="st-row-title">{label}</span>
        {description ? <span className="st-row-desc">{description}</span> : null}
      </span>
      <span className={cn("st-switch", checked && "is-on")} aria-hidden>
        <span className="st-switch-knob" />
      </span>
    </button>
  );
}
