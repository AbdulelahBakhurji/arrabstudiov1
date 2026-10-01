import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  Check,
  CloudCheck,
  CornerDownLeft,
  KeyRound,
  Languages,
  LoaderCircle,
  Moon,
  Rocket,
  Search,
  Sparkles,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ConnectorProvider } from "@arrab/shared";
import logoTall from "@/assets/logotall.png";
import symbolMark from "@/assets/symbol.png";
import { ConnectorBrandIcon } from "@/components/ConnectorBrandIcon";
import { ConnectorMark } from "@/components/ConnectorMark";
import { applyControlCatalog, useControlConnectors } from "@/lib/control-connectors";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { MessageKey } from "@/i18n/messages";
import { useTheme } from "@/theme/ThemeProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import { COMPANION_PRESETS, PRESET_HUES, type CompanionPreset } from "@/lib/companion-catalog";
import {
  companionPortraitUrl,
  presetPortraitSeed,
  resolveCompanionPortraitSrc,
} from "@/lib/companion-portrait";
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

type ConnectorCategory = "all" | "comms" | "dev" | "workspace" | "health" | "markets";

const CONNECTOR_CATEGORY: Partial<Record<ConnectorProvider, Exclude<ConnectorCategory, "all">>> = {
  gmail: "comms",
  outlook: "comms",
  email: "comms",
  slack: "comms",
  whatsapp: "comms",
  github: "dev",
  gitlab: "dev",
  bitbucket: "dev",
  ssh: "dev",
  linear: "workspace",
  notion: "workspace",
  google_drive: "workspace",
  google_calendar: "workspace",
  figma: "workspace",
  whoop: "health",
  fitbit: "health",
  finnhub: "markets",
};

const CATEGORY_LABELS: Record<ConnectorCategory, MessageKey> = {
  all: "flsFilterAll",
  comms: "flsFilterComms",
  dev: "flsFilterDev",
  workspace: "flsFilterWorkspace",
  health: "flsFilterHealth",
  markets: "flsFilterMarkets",
};

const ORBIT_INNER: ConnectorProvider[] = ["gmail", "github", "slack", "notion"];
const ORBIT_OUTER: ConnectorProvider[] = ["linear", "figma", "google_calendar", "whoop", "outlook", "google_drive"];

const STEPS: FirstLaunchStep[] = ["welcome", "connector", "companion", "ready"];

const STEP_META: Record<FirstLaunchStep, { icon: LucideIcon; title: MessageKey; body: MessageKey }> = {
  welcome: { icon: Sparkles, title: "flsStepWelcome", body: "flsStepWelcomeBody" },
  connector: { icon: Cable, title: "flsWelcomeItemConnectorShort", body: "flsWelcomeItemConnector" },
  companion: { icon: Users, title: "flsWelcomeItemCompanionShort", body: "flsWelcomeItemCompanion" },
  ready: { icon: Rocket, title: "flsWelcomeItemReadyShort", body: "flsWelcomeItemReady" },
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || target.isContentEditable;
}

export function FirstLaunchSetup({ onFinished }: { onFinished?: () => void }) {
  const { t, locale, toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const ar = locale === "ar";
  const { isOrganization } = useRole();
  const controlCatalog = useControlConnectors();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCategory>("all");
  const companionState = useCompanionState();
  const [state, setState] = useState(() => readFirstLaunchSetup());
  const [busyProvider, setBusyProvider] = useState<ConnectorProvider | null>(null);
  const [selected, setSelected] = useState<ConnectorProvider | null>(null);
  const [token, setToken] = useState("");
  const [extraUser, setExtraUser] = useState("");
  const [extraHost, setExtraHost] = useState("");
  const [extraFieldA, setExtraFieldA] = useState("");
  const [extraFieldB, setExtraFieldB] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFirstLaunchSetup(setState), []);

  // Setup runs before sign-in. Never treat leftover workspace links as connected.
  const connectedProviders = useMemo(() => new Set<ConnectorProvider>(), []);
  const accountProviders = useMemo(() => new Set<ConnectorProvider>(), []);
  const hasConnector = state.connectorDone;
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

  const pickConnector = (_provider: ConnectorProvider) => {
    setSelected(null);
    resetTokenForm();
    setError(t("flsConnectAfterSignIn"));
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

      await arrabApi.connectConnector({
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
      setError(t("flsConnectAfterSignIn"));
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
    updateFirstLaunchSetup({ connectorDone: true, step: "companion" });
  };

  const createCompanion = (preset: CompanionPreset) => {
    const space = isOrganization ? "work" : "personal";
    const existing = specialists.find((p) => p.domain.toLowerCase() === preset.domain);
    if (existing) {
      updateFirstLaunchSetup({ companionDone: true, step: "ready" });
      return;
    }
    addCompanion({
      name: preset.name,
      domain: preset.domain,
      purposeId: preset.purposeId,
      brief: preset.brief,
      connectors: preset.connectors,
      space,
      toneName: preset.toneName,
      faceSeed: presetPortraitSeed(preset.id),
      hue: PRESET_HUES[preset.id],
    });
    markGettingStartedStep("first_person", true);
    pushToast({
      title: t("flsCompanionCreated"),
      body: ar ? preset.nameAr : preset.name,
      tone: "success",
    });
    updateFirstLaunchSetup({ companionDone: true, step: "ready" });
  };

  const skipCompanion = () => {
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

  const stepLabel = t("flsStepOf")
    .replace("{current}", String(stepIndex + 1))
    .replace("{total}", String(STEPS.length));

  const curatedConnectors = useMemo(
    () =>
      applyControlCatalog(
        SETUP_CONNECTORS.map((item) => ({
          provider: item.provider,
          name: ar ? item.nameAr : item.name,
          blurb: ar ? item.blurbAr : item.blurb,
          searchText: [item.name, item.nameAr, item.blurb, item.blurbAr].join(" "),
        })),
        controlCatalog,
        { arabic: ar, keep: connectedProviders },
      ),
    [ar, controlCatalog, connectedProviders],
  );

  const visibleConnectors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return curatedConnectors.filter((item) => {
      if (category !== "all" && CONNECTOR_CATEGORY[item.provider] !== category) return false;
      if (!q) return true;
      return `${item.name} ${item.blurb} ${item.searchText}`.toLowerCase().includes(q);
    });
  }, [category, curatedConnectors, query]);

  const orbitProviders = useMemo(() => {
    const shown = new Set(curatedConnectors.map((item) => item.provider));
    return {
      inner: ORBIT_INNER.filter((provider) => shown.has(provider)),
      outer: ORBIT_OUTER.filter((provider) => shown.has(provider)),
    };
  }, [curatedConnectors]);

  const linkedConnectors = curatedConnectors.filter((item) => connectedProviders.has(item.provider));
  const accountLinked = linkedConnectors.filter((item) => accountProviders?.has(item.provider));
  const selectedMeta = selected ? curatedConnectors.find((item) => item.provider === selected) : null;

  const primary: { label: string; enabled: boolean; run: () => void } =
    state.step === "welcome"
      ? { label: t("flsGetStarted"), enabled: true, run: () => go("connector") }
      : state.step === "connector"
        ? { label: t("flsSkipForNow"), enabled: true, run: continueFromConnector }
        : state.step === "companion"
          ? { label: t("flsSkipForNow"), enabled: true, run: skipCompanion }
          : { label: t("flsEnterApp"), enabled: true, run: finish };

  const previousStep = stepIndex > 0 ? STEPS[stepIndex - 1] : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected) {
        setSelected(null);
        return;
      }
      if (event.key !== "Enter" || event.isComposing || isTypingTarget(event.target)) return;
      if (!primary.enabled) return;
      event.preventDefault();
      primary.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const footerHint =
    state.step === "connector"
      ? connectedProviders.size > 0
        ? t("flsConnectorCountHint").replace("{count}", String(connectedProviders.size))
        : t("flsConnectorSkipHint")
      : state.step === "companion"
        ? t("flsCompanionSkipHint")
        : t("flsPrivacyNote");

  return (
    <div className="fls" dir={ar ? "rtl" : "ltr"} data-step={state.step}>
      <div className="fls-atmosphere" aria-hidden>
        <span className="fls-glow fls-glow-a" />
        <span className="fls-glow fls-glow-b" />
        <span className="fls-mesh" />
        <span className="fls-noise" />
      </div>

      <header className="fls-bar" data-tauri-drag-region dir="ltr">
        <div className="fls-bar-spacer" aria-hidden />
        <img src={logoTall} alt={t("brand")} className="fls-bar-logo brand-mark" />
        <span className="fls-bar-sep" aria-hidden />
        <span className="fls-bar-chip">
          <span className="fls-bar-pulse" aria-hidden />
          {t("flsSetupLabel")}
        </span>
        <div className="fls-bar-end no-drag">
          <span className="fls-bar-step">{stepLabel}</span>
          <button type="button" className="fls-icon-btn" onClick={toggleLocale} aria-label={t("languageHint")}>
            <Languages size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="fls-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t("themeToLight") : t("themeToDark")}
          >
            {theme === "dark" ? <Sun size={15} strokeWidth={1.7} /> : <Moon size={15} strokeWidth={1.7} />}
          </button>
        </div>
      </header>

      <div className="fls-body">
        <aside className="fls-side">
          <p className="fls-side-label">{t("flsSetupLabel")}</p>
          <ol className="fls-steps" style={{ ["--fls-fill" as string]: String(stepIndex / (STEPS.length - 1)) }}>
            {STEPS.map((id, index) => {
              const meta = STEP_META[id];
              const Icon = meta.icon;
              const done = index < stepIndex;
              const current = index === stepIndex;
              return (
                <li key={id} className={cn(done && "is-done", current && "is-current")}>
                  <button
                    type="button"
                    className="fls-step"
                    disabled={!done}
                    onClick={() => go(id)}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className="fls-step-node">
                      {done ? <Check size={14} strokeWidth={2.4} /> : <Icon size={15} strokeWidth={1.8} />}
                    </span>
                    <span className="fls-step-copy">
                      <strong>{t(meta.title)}</strong>
                      <span>{t(meta.body)}</span>
                    </span>
                    <em className="fls-step-status">
                      {done ? t("flsStatusDone") : current ? t("flsStatusCurrent") : t("flsStatusNext")}
                    </em>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="fls-side-stats">
            <div>
              <span>{t("flsConnectorKicker")}</span>
              <strong>{connectedProviders.size}</strong>
            </div>
            <div>
              <span>{t("flsCompanionKicker")}</span>
              <strong>{specialists.length}</strong>
            </div>
          </div>
        </aside>

        <main className="fls-main">
          <div className="fls-main-scroll">
            {state.step === "welcome" ? (
              <section className="fls-stage fls-welcome" key="welcome">
                <div className="fls-welcome-copy">
                  <p className="fls-eyebrow">
                    <span className="fls-eyebrow-dot" />
                    {t("flsWelcomeKicker")}
                  </p>
                  <h1 className="fls-title">
                    <span>{t("brand")}</span>
                    <span className="fls-title-soft">{t("flsWelcomeTitleLine")}</span>
                  </h1>
                  <p className="fls-lead">{t("flsWelcomeBody")}</p>

                  <div className="fls-feature-grid">
                    {(["connector", "companion", "ready"] as const).map((id, index) => {
                      const meta = STEP_META[id];
                      const Icon = meta.icon;
                      return (
                        <div key={id} className="fls-feature" style={{ animationDelay: `${160 + index * 80}ms` }}>
                          <span className="fls-feature-index">0{index + 1}</span>
                          <span className="fls-feature-icon">
                            <Icon size={16} strokeWidth={1.7} />
                          </span>
                          <strong>{t(meta.title)}</strong>
                          <span>{t(meta.body)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="fls-orbit" aria-hidden>
                  <span className="fls-orbit-ring is-outer" />
                  <span className="fls-orbit-ring is-mid" />
                  <span className="fls-orbit-ring is-inner" />
                  <div className="fls-orbit-track is-inner">
                    {orbitProviders.inner.map((provider, index) => (
                      <span
                        key={provider}
                        className="fls-orbit-node"
                        style={{ ["--a" as string]: `${(360 / orbitProviders.inner.length) * index}deg` }}
                      >
                        <span className="fls-orbit-chip">
                          <ConnectorBrandIcon provider={provider} size={18} />
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="fls-orbit-track is-outer">
                    {orbitProviders.outer.map((provider, index) => (
                      <span
                        key={provider}
                        className="fls-orbit-node"
                        style={{ ["--a" as string]: `${(360 / orbitProviders.outer.length) * index + 30}deg` }}
                      >
                        <span className="fls-orbit-chip">
                          <ConnectorBrandIcon provider={provider} size={16} />
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="fls-orbit-core">
                    <img src={symbolMark} alt="" />
                  </div>
                </div>
              </section>
            ) : null}

            {state.step === "connector" ? (
              <section className="fls-stage" key="connector">
                <div className="fls-stage-head">
                  <div>
                    <p className="fls-eyebrow">
                      <Cable size={12} strokeWidth={1.9} />
                      {t("flsConnectorKicker")}
                    </p>
                    <h1 className="fls-title is-compact">{t("flsConnectorTitle")}</h1>
                    <p className="fls-lead">{t("flsConnectorBodyAll")}</p>
                  </div>
                  {connectedProviders.size > 0 ? (
                    <span className="fls-count-pill">
                      <Check size={13} strokeWidth={2.4} />
                      {t("flsLinkedCount").replace("{count}", String(connectedProviders.size))}
                    </span>
                  ) : null}
                </div>

                <div className="fls-toolbar">
                  <label className="fls-search">
                    <Search size={15} strokeWidth={1.8} />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("flsSearchConnectors")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <div className="fls-filters" role="tablist">
                    {(Object.keys(CATEGORY_LABELS) as ConnectorCategory[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={category === key}
                        className={cn("fls-filter", category === key && "is-on")}
                        onClick={() => setCategory(key)}
                      >
                        {t(CATEGORY_LABELS[key])}
                      </button>
                    ))}
                  </div>
                </div>

                {selected && selectedMeta && !OAUTH_PROVIDERS.has(selected) ? (
                  <div className="fls-connect-panel">
                    <div className="fls-connect-panel-head">
                      <span className="fls-card-mark is-small">
                        <ConnectorMark provider={selected} logoUrl={selectedMeta.logoUrl} size={18} />
                      </span>
                      <div className="fls-connect-panel-title">
                        <strong>{selectedMeta.name}</strong>
                        <span>{selectedMeta.blurb}</span>
                      </div>
                      <button
                        type="button"
                        className="fls-icon-btn"
                        onClick={() => setSelected(null)}
                        aria-label={ar ? "إغلاق" : "Close"}
                      >
                        <X size={15} strokeWidth={1.8} />
                      </button>
                    </div>

                    <div className="fls-connect-fields">
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
                    </div>

                    <form
                      className="fls-secret-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connectSelected();
                      }}
                    >
                      <label className="fls-secret">
                        <KeyRound size={14} strokeWidth={1.8} />
                        <input
                          type="password"
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                          placeholder={TOKEN_PLACEHOLDERS[selected] ?? t("flsTokenRequired")}
                          autoComplete="off"
                          autoFocus
                        />
                      </label>
                      <button type="submit" className="fls-cta is-compact" disabled={Boolean(busyProvider)}>
                        {busyProvider === selected ? <LoaderCircle className="fls-spin" size={14} /> : t("flsConnect")}
                      </button>
                    </form>
                  </div>
                ) : null}

                {error ? <p className="fls-error">{error}</p> : null}

                {accountLinked.length > 0 ? (
                  <div className="fls-account-note">
                    <span className="fls-account-note-icon">
                      <CloudCheck size={16} strokeWidth={1.8} />
                    </span>
                    <div>
                      <strong>
                        {t("flsAccountLinkedTitle").replace("{count}", String(accountLinked.length))}
                      </strong>
                      <span>{t("flsAccountLinkedBody")}</span>
                    </div>
                    <span className="fls-summary-stack">
                      {accountLinked.slice(0, 4).map((item) => (
                        <span key={item.provider}>
                          <ConnectorMark provider={item.provider} logoUrl={item.logoUrl} size={13} />
                        </span>
                      ))}
                    </span>
                  </div>
                ) : null}

                {visibleConnectors.length > 0 ? (
                  <div className="fls-connect-grid">
                    {visibleConnectors.map((item, index) => {
                      const connected = connectedProviders.has(item.provider);
                      const busy = busyProvider === item.provider;
                      const active = selected === item.provider;
                      const oauth = OAUTH_PROVIDERS.has(item.provider);
                      return (
                        <button
                          key={item.provider}
                          type="button"
                          className={cn(
                            "fls-card",
                            connected && "is-done",
                            active && "is-active",
                            item.featured && "is-featured",
                          )}
                          style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                          disabled={busy || Boolean(busyProvider && busyProvider !== item.provider)}
                          onClick={() => pickConnector(item.provider)}
                        >
                          <span className="fls-card-mark">
                            <ConnectorMark provider={item.provider} logoUrl={item.logoUrl} size={20} />
                          </span>
                          <span className="fls-card-copy">
                            <strong>
                              {item.name}
                              {item.featured ? (
                                <em className="fls-featured">
                                  <Sparkles size={9} strokeWidth={2.4} />
                                  {t("flsFeatured")}
                                </em>
                              ) : null}
                            </strong>
                            <span>{item.blurb}</span>
                          </span>
                          <span className="fls-card-side">
                            {busy ? (
                              <LoaderCircle className="fls-spin" size={15} />
                            ) : connected && accountProviders?.has(item.provider) ? (
                              <span className="fls-tag is-account">
                                <CloudCheck size={11} strokeWidth={2.2} />
                                {t("flsFromAccount")}
                              </span>
                            ) : connected ? (
                              <span className="fls-tag is-success">
                                <Check size={11} strokeWidth={2.6} />
                                {t("flsConnected")}
                              </span>
                            ) : (
                              <span className="fls-tag">{oauth ? t("flsOAuthBadge") : t("flsTokenBadge")}</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="fls-empty">{t("flsNoMatches")}</p>
                )}
              </section>
            ) : null}

            {state.step === "companion" ? (
              <section className="fls-stage" key="companion">
                <div className="fls-stage-head">
                  <div>
                    <p className="fls-eyebrow">
                      <Users size={12} strokeWidth={1.9} />
                      {t("flsCompanionKicker")}
                    </p>
                    <h1 className="fls-title is-compact">
                      {isOrganization ? t("flsCompanionTitleOrg") : t("flsCompanionTitle")}
                    </h1>
                    <p className="fls-lead">
                      {isOrganization ? t("flsCompanionBodyOrg") : t("flsCompanionBody")}
                    </p>
                  </div>
                </div>

                <div className="fls-presets">
                  {COMPANION_PRESETS.slice(0, 8).map((preset, index) => {
                    const owned = specialists.some((p) => p.domain.toLowerCase() === preset.domain);
                    const name = ar ? preset.nameAr : preset.name;
                    const hue = PRESET_HUES[preset.id] ?? 220;
                    const seed = presetPortraitSeed(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={cn("fls-preset", owned && "is-done")}
                        style={{ animationDelay: `${index * 40}ms`, ["--hue" as string]: String(hue) }}
                        onClick={() => createCompanion(preset)}
                      >
                        <span className="fls-preset-top">
                          <span className="fls-avatar">
                            <PhotoAvatar
                              src={companionPortraitUrl({ seed, name: preset.name, domain: preset.domain, hue, size: 256 })}
                              name={name}
                              size="lg"
                              state={owned ? "contributing" : "quiet"}
                              fallbackHue={hue}
                              fallbackSeed={seed}
                            />
                          </span>
                          {owned ? (
                            <span className="fls-tag is-success">
                              <Check size={11} strokeWidth={2.6} />
                              {t("flsStatusDone")}
                            </span>
                          ) : (
                            <ArrowRight size={15} strokeWidth={1.8} className="fls-preset-arrow" />
                          )}
                        </span>
                        <strong>{name}</strong>
                        <span className="fls-preset-blurb">{ar ? preset.blurbAr : preset.blurb}</span>
                        {preset.connectors.length > 0 ? (
                          <span className="fls-preset-tools">
                            {preset.connectors.slice(0, 3).map((provider) => (
                              <span key={provider}>
                                <ConnectorBrandIcon provider={provider} size={12} />
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {state.step === "ready" ? (
              <section className="fls-stage fls-ready" key="ready">
                <div className="fls-ready-mark" aria-hidden>
                  <svg viewBox="0 0 96 96">
                    <circle className="fls-ready-ring" cx="48" cy="48" r="44" />
                    <path className="fls-ready-tick" d="M31 49.5 43 61l23-26" />
                  </svg>
                </div>
                <p className="fls-eyebrow is-center">
                  <Sparkles size={12} strokeWidth={1.9} />
                  {t("flsReadyKicker")}
                </p>
                <h1 className="fls-title is-compact is-center">{t("flsReadyTitle")}</h1>
                <p className="fls-lead is-center">{t("flsReadyBody")}</p>

                <div className="fls-summary">
                  <div className="fls-summary-card">
                    <span className="fls-summary-icon">
                      <Cable size={16} strokeWidth={1.7} />
                    </span>
                    <div>
                      <strong>{t("flsConnectorKicker")}</strong>
                      <span>{hasConnector && linkedConnectors.length > 0 ? t("flsReadyConnectorOn") : t("flsReadyConnectorSkip")}</span>
                    </div>
                    {linkedConnectors.length > 0 ? (
                      <span className="fls-summary-stack">
                        {linkedConnectors.slice(0, 4).map((item) => (
                          <span key={item.provider}>
                            <ConnectorMark provider={item.provider} logoUrl={item.logoUrl} size={13} />
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className="fls-summary-card">
                    <span className="fls-summary-icon">
                      <Users size={16} strokeWidth={1.7} />
                    </span>
                    <div>
                      <strong>{t("flsCompanionKicker")}</strong>
                      <span>{t("flsReadyCompanionOn")}</span>
                    </div>
                    {specialists.length > 0 ? (
                      <span className="fls-summary-stack">
                        {specialists.slice(0, 4).map((person) => (
                          <span key={person.id} className="is-photo">
                            <img src={resolveCompanionPortraitSrc(person)} alt={person.name} />
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          <footer className="fls-foot">
            <div className="fls-foot-progress" aria-hidden>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="fls-foot-row">
              {previousStep ? (
                <button type="button" className="fls-ghost" onClick={() => go(previousStep)}>
                  {ar ? <ArrowRight size={15} strokeWidth={2} /> : <ArrowLeft size={15} strokeWidth={2} />}
                  {t("flsBack")}
                </button>
              ) : null}
              <p className="fls-foot-hint">{footerHint}</p>
              <div className="fls-foot-actions">
                {state.step === "connector" ? (
                  <button type="button" className="fls-ghost" onClick={skipConnector}>
                    {t("flsSkipForNow")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={cn("fls-cta", state.step === "ready" && "is-glow")}
                  disabled={!primary.enabled}
                  onClick={primary.run}
                >
                  {primary.label}
                  {ar ? <ArrowLeft size={15} strokeWidth={2.2} /> : <ArrowRight size={15} strokeWidth={2.2} />}
                  {primary.enabled ? (
                    <kbd className="fls-kbd" aria-hidden>
                      <CornerDownLeft size={11} strokeWidth={2.2} />
                    </kbd>
                  ) : null}
                </button>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
