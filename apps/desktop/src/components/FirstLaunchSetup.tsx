import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Cable,
  Check,
  LoaderCircle,
  Sparkles,
  Users,
} from "lucide-react";
import type { ConnectorProvider, ConnectorPublic } from "@arrab/shared";
import logoTall from "@/assets/logotall.png";
import { ConnectorBrandIcon } from "@/components/ConnectorBrandIcon";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import { COMPANION_PRESETS, type CompanionPreset } from "@/lib/companion-catalog";
import {
  addCompanion,
  liveCompanions,
  useCompanionState,
} from "@/lib/companions";
import { openExternalUrl } from "@/lib/desktop";
import {
  completeFirstLaunchSetup,
  readFirstLaunchSetup,
  subscribeFirstLaunchSetup,
  updateFirstLaunchSetup,
  type FirstLaunchStep,
} from "@/lib/first-launch-setup";
import { markGettingStartedStep } from "@/lib/getting-started";
import { pushToast } from "@/lib/notify";
import { cn } from "@/lib/utils";

const OAUTH_PROVIDERS = new Set<ConnectorProvider>([
  "gmail",
  "outlook",
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "slack",
  "notion",
  "whoop",
  "fitbit",
  "google_drive",
  "google_calendar",
  "figma",
]);

type BrowserOAuthProvider =
  | "gmail"
  | "github"
  | "outlook"
  | "gitlab"
  | "bitbucket"
  | "linear"
  | "slack"
  | "notion"
  | "whoop"
  | "fitbit"
  | "google_drive"
  | "google_calendar"
  | "figma";

const SETUP_CONNECTORS: Array<{
  provider: ConnectorProvider;
  name: string;
  nameAr: string;
  blurb: string;
  blurbAr: string;
}> = [
  {
    provider: "gmail",
    name: "Gmail",
    nameAr: "Gmail",
    blurb: "Inbox, drafts, and search",
    blurbAr: "البريد والمسودات والبحث",
  },
  {
    provider: "outlook",
    name: "Outlook",
    nameAr: "Outlook",
    blurb: "Mail and calendar",
    blurbAr: "البريد والتقويم",
  },
  {
    provider: "email",
    name: "Email (IMAP)",
    nameAr: "بريد IMAP",
    blurb: "iCloud, Yahoo, or custom mail",
    blurbAr: "iCloud أو Yahoo أو بريد مخصص",
  },
  {
    provider: "github",
    name: "GitHub",
    nameAr: "GitHub",
    blurb: "Repos, commits, and PRs",
    blurbAr: "المستودعات والإيداعات والطلبات",
  },
  {
    provider: "gitlab",
    name: "GitLab",
    nameAr: "GitLab",
    blurb: "Projects with a personal token",
    blurbAr: "المشاريع عبر رمز شخصي",
  },
  {
    provider: "bitbucket",
    name: "Bitbucket",
    nameAr: "Bitbucket",
    blurb: "Repos with username + app password",
    blurbAr: "المستودعات باسم مستخدم وكلمة مرور تطبيق",
  },
  {
    provider: "linear",
    name: "Linear",
    nameAr: "Linear",
    blurb: "Issues and projects",
    blurbAr: "المهام والمشاريع",
  },
  {
    provider: "slack",
    name: "Slack",
    nameAr: "Slack",
    blurb: "Channels and messages",
    blurbAr: "القنوات والرسائل",
  },
  {
    provider: "notion",
    name: "Notion",
    nameAr: "Notion",
    blurb: "Pages and workspace search",
    blurbAr: "الصفحات والبحث في المساحة",
  },
  {
    provider: "whatsapp",
    name: "WhatsApp Business",
    nameAr: "واتساب للأعمال",
    blurb: "Cloud API inbox and replies",
    blurbAr: "رسائل Cloud API والردود",
  },
  {
    provider: "ssh",
    name: "SSH",
    nameAr: "SSH",
    blurb: "Remote host files and commands",
    blurbAr: "ملفات وأوامر على خادم بعيد",
  },
  {
    provider: "finnhub",
    name: "Finnhub",
    nameAr: "Finnhub",
    blurb: "Quotes and market news",
    blurbAr: "الأسعار وأخبار السوق",
  },
  {
    provider: "whoop",
    name: "WHOOP",
    nameAr: "WHOOP",
    blurb: "Recovery, sleep, and strain",
    blurbAr: "التعافي والنوم والإجهاد",
  },
  {
    provider: "fitbit",
    name: "Fitbit",
    nameAr: "Fitbit",
    blurb: "Activity, heart rate, and sleep",
    blurbAr: "النشاط ومعدل القلب والنوم",
  },
  {
    provider: "google_drive",
    name: "Google Drive",
    nameAr: "Google Drive",
    blurb: "Files and docs",
    blurbAr: "الملفات والمستندات",
  },
  {
    provider: "google_calendar",
    name: "Google Calendar",
    nameAr: "Google Calendar",
    blurb: "Events and scheduling",
    blurbAr: "الأحداث والجدولة",
  },
  {
    provider: "figma",
    name: "Figma",
    nameAr: "Figma",
    blurb: "Designs and comments",
    blurbAr: "التصاميم والتعليقات",
  },
];

const TOKEN_PLACEHOLDERS: Partial<Record<ConnectorProvider, string>> = {
  gitlab: "Personal access token",
  linear: "Linear personal API key",
  slack: "xoxb-… or xoxp-… token",
  notion: "Internal integration secret",
  finnhub: "Finnhub API key",
  bitbucket: "App password",
  email: "App password",
  whatsapp: "Cloud API access token",
  ssh: "Password or paste private key",
};

const STEPS: FirstLaunchStep[] = ["welcome", "connector", "companion", "ready"];

export function FirstLaunchSetup({ onFinished }: { onFinished?: () => void }) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { isOrganization } = useRole();
  const companionState = useCompanionState();
  const [state, setState] = useState(() => readFirstLaunchSetup());
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [busyProvider, setBusyProvider] = useState<ConnectorProvider | null>(null);
  const [selected, setSelected] = useState<ConnectorProvider | null>(null);
  const [token, setToken] = useState("");
  const [extraUser, setExtraUser] = useState("");
  const [extraHost, setExtraHost] = useState("");
  const [extraFieldA, setExtraFieldA] = useState("");
  const [extraFieldB, setExtraFieldB] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFirstLaunchSetup(setState), []);

  const loadConnectors = useCallback(async () => {
    try {
      const res = await arrabApi.connectors();
      setConnectors(res.items ?? []);
    } catch {
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
    const onFocus = () => void loadConnectors();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void loadConnectors(), 4000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [loadConnectors]);

  const connectedProviders = useMemo(
    () =>
      new Set(
        connectors
          .filter((item) => item.status === "connected")
          .map((item) => item.provider),
      ),
    [connectors],
  );

  const hasConnector = connectedProviders.size > 0 || state.connectorDone;
  const specialists = useMemo(
    () => [
      ...liveCompanions(companionState, "personal").filter((p) => p.domain !== "general"),
      ...liveCompanions(companionState, "work").filter((p) => p.domain !== "general"),
    ],
    [companionState],
  );
  const hasCompanion = specialists.length > 0 || state.companionDone;

  const stepIndex = Math.max(0, STEPS.indexOf(state.step));
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const go = (step: FirstLaunchStep) => {
    updateFirstLaunchSetup({ step });
  };

  const finish = () => {
    completeFirstLaunchSetup();
    pushToast({
      title: t("flsReadyTitle"),
      body: t("flsReadyToast"),
      tone: "success",
    });
    onFinished?.();
  };

  const connectOAuth = async (provider: BrowserOAuthProvider) => {
    setBusyProvider(provider);
    setError(null);
    try {
      const start =
        provider === "gmail"
          ? await arrabApi.startGmailOAuth()
          : provider === "github"
            ? await arrabApi.startGithubOAuth()
            : provider === "outlook"
              ? await arrabApi.startOutlookOAuth()
              : await arrabApi.startGenericOAuth(provider);
      await openExternalUrl(start.url);
      pushToast({
        title: t("flsOAuthOpened"),
        body: t("flsOAuthOpenedBody"),
        tone: "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("flsConnectFailed"));
    } finally {
      setBusyProvider(null);
    }
  };

  const resetTokenForm = () => {
    setToken("");
    setExtraUser("");
    setExtraHost("");
    setExtraFieldA("");
    setExtraFieldB("");
  };

  const pickConnector = (provider: ConnectorProvider) => {
    if (connectedProviders.has(provider) || busyProvider) return;
    setError(null);
    if (OAUTH_PROVIDERS.has(provider)) {
      setSelected(null);
      resetTokenForm();
      void connectOAuth(provider as BrowserOAuthProvider);
      return;
    }
    setSelected(provider);
    resetTokenForm();
  };

  const connectSelected = async () => {
    if (!selected || OAUTH_PROVIDERS.has(selected)) return;
    const trimmed = token.trim();
    if (trimmed.length < 4) {
      setError(t("flsTokenRequired"));
      return;
    }
    if (selected === "bitbucket" && !extraUser.trim()) {
      setError(t("flsBitbucketUserRequired"));
      return;
    }
    if (selected === "email" && !extraUser.includes("@")) {
      setError(t("flsEmailAddressRequired"));
      return;
    }
    if (selected === "ssh" && (!extraHost.trim() || !extraUser.trim())) {
      setError(t("flsSshRequired"));
      return;
    }
    if (selected === "whatsapp" && (!extraFieldA.trim() || !extraFieldB.trim())) {
      setError(t("flsWhatsappRequired"));
      return;
    }

    setBusyProvider(selected);
    setError(null);
    try {
      const config: Record<string, string> = {};
      if (selected === "email") {
        config.address = extraUser.trim();
        config.preset = "custom";
      } else if (selected === "bitbucket") {
        config.username = extraUser.trim();
      } else if (selected === "ssh") {
        config.host = extraHost.trim();
        config.port = "22";
        config.username = extraUser.trim();
        config.authMode = trimmed.includes("BEGIN") ? "key" : "password";
        if (config.authMode === "key") config.privateKey = trimmed;
      } else if (selected === "whatsapp") {
        config.phone_number_id = extraFieldA.trim();
        config.waba_id = extraFieldB.trim();
      } else if (selected === "gitlab" && extraHost.trim()) {
        config.baseUrl = extraHost.trim();
      }

      const connected = await arrabApi.connectConnector({
        provider: selected,
        token: trimmed,
        label:
          selected === "email"
            ? extraUser.trim()
            : selected === "ssh"
              ? `${extraUser.trim()}@${extraHost.trim()}`
              : null,
        config: Object.keys(config).length > 0 ? config : null,
      });
      markGettingStartedStep(
        selected === "linear" || selected === "github" ? "linear" : "gmail",
        true,
      );
      await loadConnectors();
      pushToast({
        title: t("flsConnectorConnected"),
        body: connected.provider,
        tone: "success",
      });
      setSelected(null);
      resetTokenForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("flsConnectFailed"));
    } finally {
      setBusyProvider(null);
    }
  };

  const skipConnector = () => {
    updateFirstLaunchSetup({ connectorDone: true, step: "companion" });
  };

  const continueFromConnector = () => {
    if (connectedProviders.size === 0 && !state.connectorDone) {
      setError(t("flsConnectorRequired"));
      return;
    }
    if (connectedProviders.size > 0) {
      markGettingStartedStep("gmail", true);
    }
    updateFirstLaunchSetup({ connectorDone: true, step: "companion" });
  };

  const createCompanion = (preset: CompanionPreset) => {
    const space = isOrganization ? "work" : "personal";
    const existing = specialists.find((p) => p.domain.toLowerCase() === preset.domain);
    if (existing) {
      updateFirstLaunchSetup({ companionDone: true, step: "ready" });
      return;
    }
    const person = addCompanion({
      name: ar ? preset.nameAr : preset.name,
      domain: preset.domain,
      purposeId: preset.purposeId,
      brief: ar ? preset.briefAr : preset.brief,
      connectors: preset.connectors,
      space,
      toneName: preset.toneName,
    });
    markGettingStartedStep("first_person", true);
    pushToast({
      title: t("flsCompanionCreated"),
      body: ar ? preset.nameAr : preset.name,
      tone: "success",
    });
    updateFirstLaunchSetup({ companionDone: true, step: "ready" });
  };

  useEffect(() => {
    if (state.step === "connector" && connectedProviders.size > 0 && !state.connectorDone) {
      // Keep them on the step so they can press Continue, but clear errors.
      setError(null);
    }
  }, [connectedProviders.size, state.connectorDone, state.step]);

  useEffect(() => {
    if (state.step === "companion" && specialists.length > 0 && !state.companionDone) {
      updateFirstLaunchSetup({ companionDone: true });
    }
  }, [specialists.length, state.companionDone, state.step]);

  return (
    <div className="fls" dir={ar ? "rtl" : "ltr"} data-step={state.step}>
      <div className="fls-atmosphere" aria-hidden>
        <span className="fls-orb fls-orb-a" />
        <span className="fls-orb fls-orb-b" />
        <span className="fls-mesh" />
        <span className="fls-vignette" />
      </div>

      <div className="fls-shell">
        <header className="fls-top">
          <div className="fls-brand">
            <img src={logoTall} alt={t("brand")} className="fls-logo" />
          </div>
          <div className="fls-rail">
            <ol className="fls-dots" aria-label={t("flsStepOf")
              .replace("{current}", String(stepIndex + 1))
              .replace("{total}", String(STEPS.length))}>
              {STEPS.map((id, index) => (
                <li key={id} className={cn(index === stepIndex && "is-active", index < stepIndex && "is-done")}>
                  <span />
                </li>
              ))}
            </ol>
            <p className="fls-step-label">
              {t("flsStepOf")
                .replace("{current}", String(stepIndex + 1))
                .replace("{total}", String(STEPS.length))}
            </p>
          </div>
          <div className="fls-progress" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
        </header>

        {state.step === "welcome" ? (
          <section className="fls-stage fls-rise" key="welcome">
            <p className="fls-eyebrow">{t("flsWelcomeKicker")}</p>
            <h1 className="fls-title">
              <span className="fls-title-brand">{t("brand")}</span>
              <span className="fls-title-rest">{t("flsWelcomeTitleLine")}</span>
            </h1>
            <p className="fls-lead">{t("flsWelcomeBody")}</p>

            <ol className="fls-path">
              <li style={{ animationDelay: "80ms" }}>
                <em>01</em>
                <div className="fls-path-icon">
                  <Cable size={18} strokeWidth={1.6} />
                </div>
                <div>
                  <strong>{t("flsWelcomeItemConnectorShort")}</strong>
                  <span>{t("flsWelcomeItemConnector")}</span>
                </div>
              </li>
              <li style={{ animationDelay: "160ms" }}>
                <em>02</em>
                <div className="fls-path-icon">
                  <Users size={18} strokeWidth={1.6} />
                </div>
                <div>
                  <strong>{t("flsWelcomeItemCompanionShort")}</strong>
                  <span>{t("flsWelcomeItemCompanion")}</span>
                </div>
              </li>
              <li style={{ animationDelay: "240ms" }}>
                <em>03</em>
                <div className="fls-path-icon is-check">
                  <Check size={18} strokeWidth={1.8} />
                </div>
                <div>
                  <strong>{t("flsWelcomeItemReadyShort")}</strong>
                  <span>{t("flsWelcomeItemReady")}</span>
                </div>
              </li>
            </ol>

            <div className="fls-actions is-start">
              <button type="button" className="fls-cta" onClick={() => go("connector")}>
                {t("flsGetStarted")}
                <ArrowRight size={16} strokeWidth={2.2} />
              </button>
            </div>
          </section>
        ) : null}

        {state.step === "connector" ? (
          <section className="fls-stage fls-rise" key="connector">
            <p className="fls-eyebrow">
              <Cable size={13} strokeWidth={1.8} />
              {t("flsConnectorKicker")}
            </p>
            <h1 className="fls-title is-compact">{t("flsConnectorTitle")}</h1>
            <p className="fls-lead">{t("flsConnectorBodyAll")}</p>

            <div className="fls-connect-grid">
              {SETUP_CONNECTORS.map((item, index) => {
                const connected = connectedProviders.has(item.provider);
                const busy = busyProvider === item.provider;
                const active = selected === item.provider;
                return (
                  <button
                    key={item.provider}
                    type="button"
                    className={cn(
                      "fls-card",
                      connected && "is-done",
                      active && "is-active",
                    )}
                    style={{ animationDelay: `${40 + index * 35}ms` }}
                    disabled={busy || Boolean(busyProvider && busyProvider !== item.provider)}
                    onClick={() => pickConnector(item.provider)}
                  >
                    <span className="fls-card-mark">
                      <ConnectorBrandIcon provider={item.provider} size={24} />
                    </span>
                    <div className="fls-card-copy">
                      <strong>{ar ? item.nameAr : item.name}</strong>
                      <span>{ar ? item.blurbAr : item.blurb}</span>
                    </div>
                    {busy ? (
                      <LoaderCircle className="fls-spin" size={16} />
                    ) : connected ? (
                      <Check size={16} className="fls-check" />
                    ) : (
                      <ArrowRight size={15} className="fls-card-arrow" strokeWidth={1.8} />
                    )}
                  </button>
                );
              })}
            </div>

            {selected && !OAUTH_PROVIDERS.has(selected) ? (
              <div className="fls-connect-panel">
                <div className="fls-connect-panel-head">
                  <ConnectorBrandIcon provider={selected} size={22} />
                  <strong>
                    {ar
                      ? SETUP_CONNECTORS.find((item) => item.provider === selected)?.nameAr
                      : SETUP_CONNECTORS.find((item) => item.provider === selected)?.name}
                  </strong>
                  <button type="button" className="fls-ghost is-tiny" onClick={() => setSelected(null)}>
                    {ar ? "إغلاق" : "Close"}
                  </button>
                </div>

                {selected === "email" ? (
                  <input
                    type="email"
                    value={extraUser}
                    onChange={(event) => setExtraUser(event.target.value)}
                    placeholder={t("flsEmailAddress")}
                    autoComplete="off"
                  />
                ) : null}
                {selected === "bitbucket" ? (
                  <input
                    type="text"
                    value={extraUser}
                    onChange={(event) => setExtraUser(event.target.value)}
                    placeholder={t("flsBitbucketUser")}
                    autoComplete="off"
                  />
                ) : null}
                {selected === "ssh" ? (
                  <>
                    <input
                      type="text"
                      value={extraHost}
                      onChange={(event) => setExtraHost(event.target.value)}
                      placeholder={t("flsSshHost")}
                      autoComplete="off"
                    />
                    <input
                      type="text"
                      value={extraUser}
                      onChange={(event) => setExtraUser(event.target.value)}
                      placeholder={t("flsSshUser")}
                      autoComplete="off"
                    />
                  </>
                ) : null}
                {selected === "gitlab" ? (
                  <input
                    type="url"
                    value={extraHost}
                    onChange={(event) => setExtraHost(event.target.value)}
                    placeholder={t("flsGitlabBase")}
                    autoComplete="off"
                  />
                ) : null}
                {selected === "whatsapp" ? (
                  <>
                    <input
                      type="text"
                      value={extraFieldA}
                      onChange={(event) => setExtraFieldA(event.target.value)}
                      placeholder={t("flsWhatsappPhoneId")}
                      autoComplete="off"
                    />
                    <input
                      type="text"
                      value={extraFieldB}
                      onChange={(event) => setExtraFieldB(event.target.value)}
                      placeholder={t("flsWhatsappWaba")}
                      autoComplete="off"
                    />
                  </>
                ) : null}

                <div className="fls-linear-row">
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={TOKEN_PLACEHOLDERS[selected] ?? t("flsTokenRequired")}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="fls-cta is-compact"
                    disabled={Boolean(busyProvider)}
                    onClick={() => void connectSelected()}
                  >
                    {busyProvider === selected ? (
                      <LoaderCircle className="fls-spin" size={14} />
                    ) : (
                      t("flsConnect")
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            {error ? <p className="fls-error">{error}</p> : null}

            <div className="fls-actions">
              <button type="button" className="fls-ghost" onClick={skipConnector}>
                {t("flsSkipForNow")}
              </button>
              <button
                type="button"
                className="fls-cta"
                disabled={connectedProviders.size === 0}
                onClick={continueFromConnector}
              >
                {t("flsContinue")}
                <ArrowRight size={16} strokeWidth={2.2} />
              </button>
            </div>
            {connectedProviders.size > 0 ? (
              <p className="fls-hint">
                {t("flsConnectorCountHint").replace("{count}", String(connectedProviders.size))}
              </p>
            ) : (
              <p className="fls-hint">{t("flsConnectorSkipHint")}</p>
            )}
          </section>
        ) : null}

        {state.step === "companion" ? (
          <section className="fls-stage fls-rise" key="companion">
            <p className="fls-eyebrow">
              <Users size={13} strokeWidth={1.8} />
              {t("flsCompanionKicker")}
            </p>
            <h1 className="fls-title is-compact">
              {isOrganization ? t("flsCompanionTitleOrg") : t("flsCompanionTitle")}
            </h1>
            <p className="fls-lead">
              {isOrganization ? t("flsCompanionBodyOrg") : t("flsCompanionBody")}
            </p>

            <div className="fls-presets">
              {COMPANION_PRESETS.slice(0, 8).map((preset, index) => {
                const owned = specialists.some((p) => p.domain.toLowerCase() === preset.domain);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn("fls-preset", owned && "is-done")}
                    style={{ animationDelay: `${60 + index * 40}ms` }}
                    onClick={() => createCompanion(preset)}
                  >
                    <strong>{ar ? preset.nameAr : preset.name}</strong>
                    <span>{ar ? preset.blurbAr : preset.blurb}</span>
                    {owned ? <Check size={14} className="fls-check" /> : null}
                  </button>
                );
              })}
            </div>

            {hasCompanion ? (
              <div className="fls-actions">
                <button type="button" className="fls-cta" onClick={() => go("ready")}>
                  {t("flsContinue")}
                  <ArrowRight size={16} strokeWidth={2.2} />
                </button>
              </div>
            ) : (
              <p className="fls-hint">{t("flsCompanionRequired")}</p>
            )}
          </section>
        ) : null}

        {state.step === "ready" ? (
          <section className="fls-stage fls-rise is-ready" key="ready">
            <p className="fls-eyebrow">
              <Sparkles size={13} strokeWidth={1.8} />
              {t("flsReadyKicker")}
            </p>
            <h1 className="fls-title is-compact">{t("flsReadyTitle")}</h1>
            <p className="fls-lead">{t("flsReadyBody")}</p>
            <ul className="fls-done-list">
              <li>
                <Check size={15} strokeWidth={2} />
                <span>
                  {hasConnector ? t("flsReadyConnectorOn") : t("flsReadyConnectorSkip")}
                </span>
              </li>
              <li>
                <Check size={15} strokeWidth={2} />
                <span>{t("flsReadyCompanionOn")}</span>
              </li>
            </ul>
            <div className="fls-actions is-start">
              <button type="button" className="fls-cta is-pulse" onClick={finish}>
                {t("flsEnterApp")}
                <ArrowRight size={16} strokeWidth={2.2} />
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
