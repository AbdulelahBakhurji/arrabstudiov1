import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { ConnectorProvider, ConnectorPublic } from "@arrab/shared";
import { ConnectorBrandIcon } from "@/components/ConnectorBrandIcon";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { openExternalUrl } from "@/lib/desktop";
import { notifyStudio } from "@/lib/notify";
import { isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";

function isOAuthBrowserProvider(provider: ConnectorProvider | null | undefined): boolean {
  return (
    provider === "gmail" ||
    provider === "outlook" ||
    provider === "github" ||
    provider === "gitlab" ||
    provider === "bitbucket" ||
    provider === "linear" ||
    provider === "slack" ||
    provider === "notion" ||
    provider === "whoop" ||
    provider === "fitbit" ||
    provider === "google_drive" ||
    provider === "google_calendar" ||
    provider === "figma"
  );
}

type BrowserOAuthProvider =
  | "gmail"
  | "outlook"
  | "github"
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

const CATALOG: Array<{
  provider: ConnectorProvider;
  name: string;
  blurb: string;
  available: boolean;
}> = [
  {
    provider: "gmail",
    name: "Gmail",
    blurb: "Draft replies, summarize threads, & search your inbox",
    available: true,
  },
  {
    provider: "outlook",
    name: "Outlook",
    blurb: "Manage your schedule and mail with Microsoft 365",
    available: true,
  },
  {
    provider: "email",
    name: "Email (IMAP)",
    blurb: "iCloud, Yahoo, or custom IMAP — inbox, read, and send with an app password",
    available: true,
  },
  {
    provider: "whatsapp",
    name: "WhatsApp Business",
    blurb: "Official Cloud API — receive customer messages and reply from agents",
    available: true,
  },
  {
    provider: "github",
    name: "GitHub",
    blurb: "Sign in on GitHub in your browser — browse repos, commit, push, and open PRs",
    available: true,
  },
  {
    provider: "gitlab",
    name: "GitLab",
    blurb: "Sign in on GitLab in your browser — access projects and repositories",
    available: true,
  },
  {
    provider: "bitbucket",
    name: "Bitbucket",
    blurb: "Sign in on Bitbucket in your browser — connect repos and workspaces",
    available: true,
  },
  {
    provider: "linear",
    name: "Linear",
    blurb: "Sign in on Linear in your browser — search issues and track projects",
    available: true,
  },
  {
    provider: "slack",
    name: "Slack",
    blurb: "Sign in on Slack in your browser — channels, messages, and workspace data",
    available: true,
  },
  {
    provider: "notion",
    name: "Notion",
    blurb: "Sign in on Notion in your browser — search, read, and update pages",
    available: true,
  },
  {
    provider: "ssh",
    name: "SSH",
    blurb: "Connect a remote host with password or private key — list files and run commands",
    available: true,
  },
  {
    provider: "finnhub",
    name: "Finnhub",
    blurb: "Live quotes and company news for Trader companions (API key)",
    available: true,
  },
  {
    provider: "whoop",
    name: "WHOOP",
    blurb: "Sign in with WHOOP — recovery, sleep, strain, and workouts",
    available: true,
  },
  {
    provider: "fitbit",
    name: "Fitbit",
    blurb: "Sign in with Fitbit — activity, heart rate, sleep, and weight",
    available: true,
  },
  {
    provider: "google_drive",
    name: "Google Drive",
    blurb: "Sign in with Google — browse and work with Drive files",
    available: true,
  },
  {
    provider: "google_calendar",
    name: "Google Calendar",
    blurb: "Sign in with Google — list and manage calendar events",
    available: true,
  },
  {
    provider: "figma",
    name: "Figma",
    blurb: "Sign in with Figma — read designs, metadata, and comments",
    available: true,
  },
];

const EMAIL_PRESETS = [
  { id: "icloud", label: "iCloud" },
  { id: "yahoo", label: "Yahoo" },
  { id: "custom", label: "Custom" },
] as const;

const TOKEN_HINTS: Record<ConnectorProvider, string> = {
  gmail: "Sign in with Google in your browser. Arrab never sees your Google password.",
  outlook: "Sign in with Microsoft in your browser. Arrab never sees your Outlook password.",
  email: "Use an app password (not your normal login).",
  whatsapp:
    "Permanent Cloud API token from Meta. Also need Phone number ID and WhatsApp Business Account ID.",
  github: "Sign in with GitHub in your browser. Arrab never sees your GitHub password.",
  gitlab: "Sign in with GitLab in your browser. Arrab never sees your GitLab password.",
  bitbucket: "Sign in with Bitbucket in your browser. Arrab never sees your Bitbucket password.",
  linear: "Sign in with Linear in your browser. Arrab never sees your Linear password.",
  slack: "Sign in with Slack in your browser. Arrab never sees your Slack password.",
  notion: "Sign in with Notion in your browser. Arrab never sees your Notion password.",
  ssh: "Password or private key for a remote SSH host. Secrets stay on the Arrab API.",
  finnhub: "Finnhub API key from finnhub.io — quotes and company news for Trader.",
  whoop: "Sign in with WHOOP in your browser. Arrab never sees your WHOOP password.",
  fitbit: "Sign in with Fitbit in your browser. Arrab never sees your Fitbit password.",
  google_drive: "Sign in with Google in your browser. Arrab never sees your Google password.",
  google_calendar: "Sign in with Google in your browser. Arrab never sees your Google password.",
  figma: "Sign in with Figma in your browser. Arrab never sees your Figma password.",
};

export function ConnectorsPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ConnectorPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ConnectorProvider | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailPreset, setEmailPreset] = useState<(typeof EMAIL_PRESETS)[number]["id"]>("icloud");
  const [imapHost, setImapHost] = useState("imap.mail.me.com");
  const [smtpHost, setSmtpHost] = useState("smtp.mail.me.com");
  const [imapPort, setImapPort] = useState("993");
  const [smtpPort, setSmtpPort] = useState("587");
  const [bitbucketUser, setBitbucketUser] = useState("");
  const [gitlabBase, setGitlabBase] = useState("https://gitlab.com");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshAuthMode, setSshAuthMode] = useState<"password" | "key">("password");
  const [sshPrivateKey, setSshPrivateKey] = useState("");
  const [sshPassphrase, setSshPassphrase] = useState("");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState("");
  const [whatsappWabaId, setWhatsappWabaId] = useState("");
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .connectors()
      .then((response) => {
        setItems(response.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t]);

  useEffect(() => {
    load();
    return () => {
      if (oauthPollRef.current) {
        clearInterval(oauthPollRef.current);
        oauthPollRef.current = null;
      }
    };
  }, [load]);

  // When browser OAuth finishes, deep link focuses the app — refresh connectors.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      void listen<string>("arrab:deep-link", (event) => {
        const url = event.payload ?? "";
        if (!url.includes("connectors/")) return;
        setBusy(false);
        if (oauthPollRef.current) {
          clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
        }
        load();
        if (url.includes("connected")) {
          const provider = new URL(url).searchParams.get("provider") ?? "connector";
          void notifyStudio({
            kind: "connector",
            title: t("connectorConnectedNotify"),
            body: provider,
            href: "/connectors",
          });
        }
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    });
    const onFocus = () => {
      if (oauthPollRef.current) load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [load, t]);

  useEffect(() => {
    if (emailPreset === "icloud") {
      setImapHost("imap.mail.me.com");
      setSmtpHost("smtp.mail.me.com");
      setImapPort("993");
      setSmtpPort("587");
    } else if (emailPreset === "yahoo") {
      setImapHost("imap.mail.yahoo.com");
      setSmtpHost("smtp.mail.yahoo.com");
      setImapPort("993");
      setSmtpPort("465");
    }
  }, [emailPreset]);

  const canSubmit = useMemo(() => {
    if (busy || !selected || isOAuthBrowserProvider(selected)) return false;
    if (selected === "email") {
      return emailAddress.includes("@") && token.trim().length >= 4;
    }
    if (selected === "bitbucket") {
      return bitbucketUser.trim().length > 0 && token.trim().length >= 8;
    }
    if (selected === "ssh") {
      if (!sshHost.trim() || !sshUsername.trim()) return false;
      if (sshAuthMode === "password") return token.trim().length >= 1;
      return sshPrivateKey.trim().length >= 32 || token.trim().length >= 32;
    }
    if (selected === "whatsapp") {
      return (
        token.trim().length >= 20 &&
        whatsappPhoneNumberId.trim().length > 0 &&
        whatsappWabaId.trim().length > 0
      );
    }
    return token.trim().length >= 8;
  }, [
    bitbucketUser,
    busy,
    emailAddress,
    selected,
    sshAuthMode,
    sshHost,
    sshPrivateKey,
    sshUsername,
    token,
    whatsappPhoneNumberId,
    whatsappWabaId,
  ]);

  function openProvider(provider: ConnectorProvider) {
    setSelected(provider);
    setError(null);
    if (isOAuthBrowserProvider(provider)) {
      setPanelOpen(false);
      void onConnectBrowserOAuth(provider as BrowserOAuthProvider);
      return;
    }
    setPanelOpen(true);
    window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  useEffect(() => {
    const raw = searchParams.get("provider")?.trim().toLowerCase();
    if (!raw) return;
    openProvider(raw as ConnectorProvider);
    const next = new URLSearchParams(searchParams);
    next.delete("provider");
    setSearchParams(next, { replace: true });
    // Intentionally run once when the deep-link param is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function onConnectBrowserOAuth(provider: BrowserOAuthProvider) {
    setBusy(true);
    setError(null);
    try {
      const before = new Set(
        items.filter((item) => item.provider === provider).map((item) => item.id),
      );
      const started =
        provider === "gmail"
          ? await arrabApi.startGmailOAuth()
          : provider === "github"
            ? await arrabApi.startGithubOAuth()
            : provider === "outlook"
              ? await arrabApi.startOutlookOAuth()
              : await arrabApi.startGenericOAuth(provider);
      await openExternalUrl(started.url);
      pollForOAuthProvider(provider, before);
    } catch (err: unknown) {
      setBusy(false);
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      void notifyStudio({
        kind: "connector",
        title: t("connectorFailedNotify"),
        body: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        href: "/connectors",
      });
    }
  }

  function pollForOAuthProvider(provider: BrowserOAuthProvider, before: Set<string>) {
    if (oauthPollRef.current) {
      clearInterval(oauthPollRef.current);
    }
    const startedAt = Date.now() - 2_000;
    let attempts = 0;
    oauthPollRef.current = setInterval(() => {
      attempts += 1;
      void arrabApi
        .connectors()
        .then((response) => {
          setItems(response.items);
          const match = response.items.find((item) => {
            if (item.provider !== provider || item.status !== "connected") return false;
            if (!before.has(item.id)) return true;
            const stamp = Date.parse(item.lastVerifiedAt || item.connectedAt || "");
            return Number.isFinite(stamp) && stamp >= startedAt;
          });
          if (match) {
            if (oauthPollRef.current) {
              clearInterval(oauthPollRef.current);
              oauthPollRef.current = null;
            }
            setBusy(false);
            setPanelOpen(false);
            void notifyStudio({
              kind: "connector",
              title: t("connectorConnectedNotify"),
              body: match.accountLabel || provider,
              href: "/connectors",
            });
          } else if (attempts >= 90) {
            if (oauthPollRef.current) {
              clearInterval(oauthPollRef.current);
              oauthPollRef.current = null;
            }
            setBusy(false);
            setError(
              provider === "gmail"
                ? t("gmailOAuthWaiting")
                : provider === "outlook"
                  ? t("outlookOAuthWaiting")
                  : t("githubOAuthWaiting"),
            );
          }
        })
        .catch(() => {
          /* keep polling while browser OAuth finishes */
        });
    }, 2000);
  }

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (isOAuthBrowserProvider(selected)) {
      await onConnectBrowserOAuth(selected as BrowserOAuthProvider);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const config: Record<string, string> = {};
      if (selected === "email") {
        config.address = emailAddress.trim();
        config.preset = emailPreset;
        config.imapHost = imapHost.trim();
        config.smtpHost = smtpHost.trim();
        config.imapPort = imapPort.trim();
        config.smtpPort = smtpPort.trim();
      } else if (selected === "bitbucket") {
        config.username = bitbucketUser.trim();
      } else if (selected === "gitlab" && gitlabBase.trim()) {
        config.baseUrl = gitlabBase.trim();
      } else if (selected === "ssh") {
        config.host = sshHost.trim();
        config.port = sshPort.trim() || "22";
        config.username = sshUsername.trim();
        config.authMode = sshAuthMode;
        if (sshAuthMode === "key") {
          config.privateKey = sshPrivateKey.trim() || token.trim();
          if (sshPassphrase.trim()) config.passphrase = sshPassphrase.trim();
        }
      } else if (selected === "whatsapp") {
        config.phone_number_id = whatsappPhoneNumberId.trim();
        config.waba_id = whatsappWabaId.trim();
      }
      const connectToken =
        selected === "ssh" && sshAuthMode === "key" ? sshPrivateKey.trim() || token : token;
      const connected = await arrabApi.connectConnector({
        provider: selected,
        token: connectToken,
        label:
          label.trim() ||
          (selected === "email"
            ? emailAddress.trim()
            : selected === "ssh"
              ? `${sshUsername.trim()}@${sshHost.trim()}`
              : selected === "whatsapp"
                ? `WhatsApp ${whatsappPhoneNumberId.trim()}`
                : null),
        config: Object.keys(config).length > 0 ? config : null,
      });
      setToken("");
      setLabel("");
      setSshPrivateKey("");
      setSshPassphrase("");
      setWhatsappPhoneNumberId("");
      setWhatsappWabaId("");
      setPanelOpen(false);
      load();
      void notifyStudio({
        kind: "connector",
        title: t("connectorConnectedNotify"),
        body: connected.provider,
        href: "/connectors",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      void notifyStudio({
        kind: "connector",
        title: t("connectorFailedNotify"),
        body: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        href: "/connectors",
      });
    } finally {
      setBusy(false);
    }
  }

  const selectedMeta = CATALOG.find((item) => item.provider === selected);

  return (
    <Surface className="connector-shell">
      <div className="connector-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1100px] px-6 py-8 lg:px-10">
        <header className="connector-header mb-8">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{t("connectors")}</p>
            <h1 className="mt-1 text-[clamp(1.85rem,3vw,2.35rem)] font-medium tracking-[-0.035em] text-[var(--color-foreground)]">
              {t("connectorsTitle")}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--color-muted)]">
              {t("connectorsBody")}
            </p>
          </div>
        </header>

        {error ? <p className="mb-4 text-sm text-red-300/90">{error}</p> : null}

        <div className="connector-grid">
          {CATALOG.map((item) => {
            const linked = items.find(
              (entry) => entry.provider === item.provider && entry.status === "connected",
            );
            const busyThis = busy && selected === item.provider;
            return (
              <article
                key={item.provider}
                className={cn(
                  "connector-row",
                  selected === item.provider && panelOpen && "is-active",
                  linked && "is-connected",
                )}
              >
                <button
                  type="button"
                  className="connector-row-main"
                  onClick={() => openProvider(item.provider)}
                >
                  <span className={cn("connector-brand", `brand-${item.provider}`)}>
                    <ConnectorBrandIcon provider={item.provider} size={20} />
                  </span>
                  <span className="connector-copy min-w-0">
                    <span className="connector-title">
                      <span>{item.name}</span>
                      {linked ? (
                        <span className="connector-verified" title={t("verifiedConnector")}>
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span className="connector-blurb">
                      {linked
                        ? t("connectorConnectedAs").replace(
                            "{account}",
                            linked.accountLabel || linked.provider,
                          )
                        : item.blurb}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="connector-add"
                  disabled={busyThis}
                  aria-label={
                    linked
                      ? `${t("reconnect")} ${item.name}`
                      : `${t("connect")} ${item.name}`
                  }
                  onClick={() => openProvider(item.provider)}
                >
                  {busyThis ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : linked ? (
                    <RefreshCw className="size-4" strokeWidth={2.2} />
                  ) : (
                    <Plus className="size-4" strokeWidth={2.2} />
                  )}
                </button>
              </article>
            );
          })}
        </div>

        {panelOpen && selected && !isOAuthBrowserProvider(selected) ? (
          <section ref={panelRef} className="connector-panel mt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-[var(--color-foreground)]">
                  {t("connect")} {selectedMeta?.name ?? selected}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{TOKEN_HINTS[selected]}</p>
              </div>
              <button
                type="button"
                className="connector-add"
                aria-label={t("cancel")}
                onClick={() => setPanelOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={(event) => void onConnect(event)} className="mt-5 space-y-3.5">
              <label className="grid gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                  {t("connectionLabel")}
                </span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="field"
                  placeholder={selected === "email" ? "work-inbox" : `${selected}-studio`}
                />
              </label>

              {selected === "email" ? (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("emailAddress")}
                    </span>
                    <input
                      required
                      type="email"
                      value={emailAddress}
                      onChange={(event) => setEmailAddress(event.target.value)}
                      className="field"
                      placeholder="you@company.com"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("emailPreset")}
                    </span>
                    <select
                      value={emailPreset}
                      onChange={(event) =>
                        setEmailPreset(event.target.value as (typeof EMAIL_PRESETS)[number]["id"])
                      }
                      className="field"
                    >
                      {EMAIL_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {emailPreset === "custom" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          IMAP host
                        </span>
                        <input
                          value={imapHost}
                          onChange={(e) => setImapHost(e.target.value)}
                          className="field"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          SMTP host
                        </span>
                        <input
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          className="field"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          IMAP port
                        </span>
                        <input
                          value={imapPort}
                          onChange={(e) => setImapPort(e.target.value)}
                          className="field"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          SMTP port
                        </span>
                        <input
                          value={smtpPort}
                          onChange={(e) => setSmtpPort(e.target.value)}
                          className="field"
                        />
                      </label>
                    </div>
                  ) : null}
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("emailAppPassword")}
                    </span>
                    <input
                      required
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      className="field"
                      placeholder="xxxx xxxx xxxx xxxx"
                    />
                  </label>
                </>
              ) : selected === "ssh" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        Host
                      </span>
                      <input
                        required
                        value={sshHost}
                        onChange={(event) => setSshHost(event.target.value)}
                        className="field"
                        placeholder="host.example.com"
                        autoComplete="off"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        Port
                      </span>
                      <input
                        value={sshPort}
                        onChange={(event) => setSshPort(event.target.value)}
                        className="field"
                        placeholder="22"
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      Username
                    </span>
                    <input
                      required
                      value={sshUsername}
                      onChange={(event) => setSshUsername(event.target.value)}
                      className="field"
                      placeholder="ubuntu"
                      autoComplete="off"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      Auth
                    </span>
                    <select
                      value={sshAuthMode}
                      onChange={(event) =>
                        setSshAuthMode(event.target.value === "key" ? "key" : "password")
                      }
                      className="field"
                    >
                      <option value="password">Password</option>
                      <option value="key">Private key</option>
                    </select>
                  </label>
                  {sshAuthMode === "password" ? (
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        Password
                      </span>
                      <input
                        required
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        className="field"
                        placeholder="SSH password"
                      />
                    </label>
                  ) : (
                    <>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          Private key
                        </span>
                        <textarea
                          required
                          value={sshPrivateKey}
                          onChange={(event) => setSshPrivateKey(event.target.value)}
                          className="field min-h-[120px] font-mono text-[12px]"
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                          spellCheck={false}
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          Passphrase (optional)
                        </span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={sshPassphrase}
                          onChange={(event) => setSshPassphrase(event.target.value)}
                          className="field"
                          placeholder="Key passphrase"
                        />
                      </label>
                    </>
                  )}
                </>
              ) : selected === "whatsapp" ? (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      Phone number ID
                    </span>
                    <input
                      required
                      value={whatsappPhoneNumberId}
                      onChange={(event) => setWhatsappPhoneNumberId(event.target.value)}
                      className="field font-mono text-[12px]"
                      placeholder="From Meta → WhatsApp → API Setup"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      WhatsApp Business Account ID
                    </span>
                    <input
                      required
                      value={whatsappWabaId}
                      onChange={(event) => setWhatsappWabaId(event.target.value)}
                      className="field font-mono text-[12px]"
                      placeholder="WABA ID"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      Permanent access token
                    </span>
                    <input
                      required
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      className="field"
                      placeholder="Meta system user / permanent token"
                    />
                  </label>
                  <p className="text-[11px] text-neutral-500">
                    Webhook URL on your API:{" "}
                    <code className="text-neutral-300">
                      /v1/connectors/whatsapp/webhook
                    </code>
                  </p>
                </>
              ) : (
                <>
                  {selected === "bitbucket" ? (
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        {t("bitbucketUsername")}
                      </span>
                      <input
                        required
                        value={bitbucketUser}
                        onChange={(event) => setBitbucketUser(event.target.value)}
                        className="field"
                        placeholder="your-bitbucket-username"
                      />
                    </label>
                  ) : null}
                  {selected === "gitlab" ? (
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        {t("gitlabBaseUrl")}
                      </span>
                      <input
                        value={gitlabBase}
                        onChange={(event) => setGitlabBase(event.target.value)}
                        className="field"
                        placeholder="https://gitlab.com"
                      />
                    </label>
                  ) : null}
                  <label className="grid gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {selected === "github" ? t("githubToken") : t("accessToken")}
                    </span>
                    <input
                      required
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      className="field"
                      placeholder={
                        selected === "github"
                          ? "ghp_…"
                          : selected === "slack"
                            ? "xoxb-…"
                            : "token…"
                      }
                    />
                  </label>
                </>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="home-btn-primary mt-2 inline-flex h-10 items-center gap-2 px-5 text-sm font-medium disabled:opacity-40"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {t("connect")}
              </button>
            </form>
          </section>
        ) : null}

      </div>
    </Surface>
  );
}
