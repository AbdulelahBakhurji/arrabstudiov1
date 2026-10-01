import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cable, Check, LoaderCircle, LogIn, Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { ConnectorProvider, ConnectorPublic } from "@arrab/shared";
import { ConnectorMark } from "@/domains/connectors/ui/ConnectorMark";
import { Surface } from "@/shared/ui/Surface";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/core/api/api";
import { openExternalUrl } from "@/core/platform/desktop";
import { notifyStudio } from "@/domains/notifications/notify";
import { isTauriRuntime } from "@/core/platform/terminal";
import {
  execSshConfig,
  listSshConfigHosts,
  readSshIdentity,
  rememberLocalSsh,
  type SshConfigHost,
} from "@/domains/connectors/ssh-config";
import { useFamilyProfile } from "@/domains/family/use-family-profile";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { clearGuestLocalMode } from "@/core/session/guest-mode";
import { applyControlCatalog, useControlConnectors } from "@/domains/connectors/control-connectors";
import { cn } from "@/shared/lib/utils";
import { WhatsAppConnectSheet } from "@/domains/connectors/ui/WhatsAppConnectSheet";

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
    name: "WhatsApp Business (Cloud API)",
    blurb: "Official Meta Cloud API — for a verified Business number",
    available: true,
  },
  {
    provider: "openwa",
    name: "WhatsApp",
    blurb: "Link your own WhatsApp with a QR code — your companions read and reply for you",
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
  openwa:
    "WhatsApp runs on the Arrab API server. Use Connect WhatsApp (QR) — no API keys on this device.",
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
  const { t, locale } = useLanguage();
  const controlCatalog = useControlConnectors();
  const { signedIn } = useSignedInAccount();
  const { active: familyActive, isChild } = useFamilyProfile();
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
  const [sshHosts, setSshHosts] = useState<SshConfigHost[]>([]);
  const [sshAlias, setSshAlias] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "comms" | "dev" | "workspace" | "health" | "markets">("all");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState("");
  const [whatsappWabaId, setWhatsappWabaId] = useState("");
  const [openwaBaseUrl, setOpenwaBaseUrl] = useState("http://127.0.0.1:2785");
  const [openwaSessionId, setOpenwaSessionId] = useState("arrab");
  const [openWaQuickOpen, setOpenWaQuickOpen] = useState(false);
  const [openWaServerManaged, setOpenWaServerManaged] = useState(false);
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    if (!signedIn) {
      setItems([]);
      return;
    }
    setError(null);
    void arrabApi
      .connectors()
      .then((response) => {
        // Seat isolation on the client too — never show another profile's links
        // (or legacy unowned rows) on this family seat.
        const seatId = familyActive?.id ?? null;
        const nextItems = seatId
          ? response.items.filter((item) => item.familyMemberId === seatId)
          : response.items;
        setItems(nextItems);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t, familyActive?.id, signedIn]);

  useEffect(() => {
    load();
    if (!signedIn) {
      setOpenWaServerManaged(false);
      return;
    }
    void arrabApi
      .meta()
      .then((meta) => setOpenWaServerManaged(meta.connectors?.openWaServerManaged === true))
      .catch(() => setOpenWaServerManaged(false));
    return () => {
      if (oauthPollRef.current) {
        clearInterval(oauthPollRef.current);
        oauthPollRef.current = null;
      }
    };
  }, [load, familyActive?.id, signedIn]);

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

  useEffect(() => {
    if (selected !== "ssh" || !panelOpen) return;
    let cancelled = false;
    void listSshConfigHosts().then((hosts) => {
      if (!cancelled) setSshHosts(hosts);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, panelOpen]);

  async function chooseSshHost(host: SshConfigHost) {
    setSshAlias(host.alias);
    setSshHost(host.hostName || host.alias);
    setSshPort(host.port || "22");
    setSshUsername(host.user);
    setLabel(host.alias);
    setError(null);
    if (host.identityFile) {
      const key = await readSshIdentity(host.identityFile);
      if (key) {
        setSshAuthMode("key");
        setSshPrivateKey(key);
        return;
      }
    }
    setSshAuthMode("key");
  }

  const canSubmit = useMemo(() => {
    if (busy || !selected || isOAuthBrowserProvider(selected)) return false;
    if (selected === "email") {
      return emailAddress.includes("@") && token.trim().length >= 4;
    }
    if (selected === "bitbucket") {
      return bitbucketUser.trim().length > 0 && token.trim().length >= 8;
    }
    if (selected === "ssh") {
      if (sshAlias) return true;
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
    if (selected === "openwa") {
      if (openWaServerManaged) return false;
      return token.trim().length >= 8 && openwaBaseUrl.trim().length > 8 && openwaSessionId.trim().length >= 3;
    }
    return token.trim().length >= 8;
  }, [
    bitbucketUser,
    busy,
    emailAddress,
    selected,
    sshAlias,
    sshAuthMode,
    sshHost,
    sshPrivateKey,
    sshUsername,
    token,
    whatsappPhoneNumberId,
    whatsappWabaId,
    openwaBaseUrl,
    openwaSessionId,
    openWaServerManaged,
  ]);

  function openProvider(provider: ConnectorProvider) {
    setSelected(provider);
    setError(null);
    if (provider === "openwa" && openWaServerManaged && signedIn && !isChild) {
      setPanelOpen(false);
      setOpenWaQuickOpen(true);
      return;
    }
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
          const seatId = familyActive?.id ?? null;
          const next = seatId
            ? response.items.filter((item) => item.familyMemberId === seatId)
            : response.items;
          setItems(next);
          const match = next.find((item) => {
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
      } else if (selected === "ssh" && sshAlias) {
        const host = sshHosts.find((item) => item.alias === sshAlias);
        if (!host) throw new Error(t("sshConfigFailed"));
        const probe = await execSshConfig(sshAlias, "echo arrab-ok");
        if (probe.code !== 0 || !probe.stdout.includes("arrab-ok")) {
          throw new Error(probe.stderr.trim() || t("sshConfigFailed"));
        }
        rememberLocalSsh(host);
        if (sshPrivateKey.trim().length >= 32 && sshUsername.trim() && sshHost.trim()) {
          try {
            await arrabApi.connectConnector({
              provider: "ssh",
              token: sshPrivateKey.trim(),
              label: label.trim() || host.alias,
              config: {
                host: sshHost.trim(),
                port: sshPort.trim() || "22",
                username: sshUsername.trim(),
                authMode: "key",
                privateKey: sshPrivateKey.trim(),
                ...(sshPassphrase.trim() ? { passphrase: sshPassphrase.trim() } : {}),
              },
            });
          } catch {
            // The Mac already connected with ~/.ssh/config. Cloud copy is optional.
          }
        }
        setToken("");
        setLabel("");
        setSshAlias(null);
        setSshPrivateKey("");
        setSshPassphrase("");
        setPanelOpen(false);
        load();
        void notifyStudio({
          kind: "connector",
          title: t("connectorConnectedNotify"),
          body: host.alias,
          href: "/connectors",
        });
        return;
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
      } else if (selected === "openwa") {
        config.base_url = openwaBaseUrl.trim();
        config.session_id = openwaSessionId.trim();
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
              : selected === "openwa"
                ? `WhatsApp ${openwaSessionId.trim()}`
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
      const message =
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : t("apiUnavailable");
      setError(message);
      void notifyStudio({
        kind: "connector",
        title: t("connectorFailedNotify"),
        body: message,
        href: "/connectors",
      });
    } finally {
      setBusy(false);
    }
  }

  const catalog = useMemo(
    () =>
      applyControlCatalog(CATALOG, controlCatalog, {
        arabic: locale === "ar",
        keep: new Set(
          items.filter((entry) => entry.status === "connected").map((entry) => entry.provider),
        ),
      }),
    [controlCatalog, items, locale],
  );
  const selectedMeta = catalog.find((item) => item.provider === selected);
  const categoryOf: Partial<Record<ConnectorProvider, "comms" | "dev" | "workspace" | "health" | "markets">> = {
    gmail: "comms",
    outlook: "comms",
    email: "comms",
    slack: "comms",
    whatsapp: "comms",
    openwa: "comms",
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
  const visibleCatalog = catalog.filter((item) => {
    if (category !== "all" && categoryOf[item.provider] !== category) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${item.name} ${item.blurb} ${item.provider}`.toLowerCase().includes(needle);
  });
  const linkedCount = items.filter((entry) => entry.status === "connected").length;
  const filters = [
    ["all", "flsFilterAll"],
    ["comms", "flsFilterComms"],
    ["dev", "flsFilterDev"],
    ["workspace", "flsFilterWorkspace"],
    ["health", "flsFilterHealth"],
    ["markets", "flsFilterMarkets"],
  ] as const;

  if (!signedIn) {
    return (
      <Surface className="connector-shell">
        <div className="relative mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{t("connectors")}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t("connectorsNeedSignIn")}</h1>
          <p className="text-sm leading-relaxed text-neutral-400">{t("amSignInBody")}</p>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black"
            onClick={() => clearGuestLocalMode()}
          >
            <LogIn className="size-4" strokeWidth={1.8} />
            {t("signInAccount")}
          </button>
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="connector-shell">
      <div className="connector-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1100px] px-6 py-8 lg:px-10">
        <div className="fls-stage-head">
          <div>
            <p className="fls-eyebrow">
              <Cable size={12} strokeWidth={1.9} />
              {t("flsConnectorKicker")}
            </p>
            <h1 className="fls-title is-compact">{t("connectorsTitle")}</h1>
            <p className="fls-lead">
              {familyActive
                ? t("connectorsBodySeat").replace("{name}", familyActive.displayName)
                : t("connectorsBody")}
            </p>
            {isChild ? <p className="fls-lead">{t("connectorsBodyKidHint")}</p> : null}
          </div>
          {linkedCount > 0 ? (
            <span className="fls-count-pill">
              <Check size={13} strokeWidth={2.4} />
              {t("flsLinkedCount").replace("{count}", String(linkedCount))}
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
            {filters.map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={category === key}
                className={cn("fls-filter", category === key && "is-on")}
                onClick={() => setCategory(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="fls-error">{error}</p> : null}

        {panelOpen && selected && !isOAuthBrowserProvider(selected) ? (
          <section ref={panelRef} className="fls-connect-panel">
            <div className="fls-connect-panel-head">
              <span className="fls-card-mark is-small">
                <ConnectorMark provider={selected} logoUrl={selectedMeta?.logoUrl} size={18} />
              </span>
              <div className="fls-connect-panel-title">
                <strong>{selectedMeta?.name ?? selected}</strong>
                <span>{TOKEN_HINTS[selected]}</span>
              </div>
              <button
                type="button"
                className="fls-icon-btn"
                aria-label={t("cancel")}
                onClick={() => setPanelOpen(false)}
              >
                <X size={15} strokeWidth={1.8} />
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
                  <div className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("sshConfigTitle")}
                    </span>
                    <p className="text-xs text-neutral-500">{t("sshConfigHint")}</p>
                    {sshHosts.length === 0 ? (
                      <p className="text-xs text-neutral-500">{t("sshConfigEmpty")}</p>
                    ) : (
                      <div className="grid max-h-48 gap-1.5 overflow-y-auto">
                        {sshHosts.map((host) => {
                          const active = sshAlias === host.alias;
                          const detail = [host.user, host.hostName].filter(Boolean).join("@");
                          return (
                            <button
                              key={host.alias}
                              type="button"
                              onClick={() => void chooseSshHost(host)}
                              className={cn(
                                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left",
                                active
                                  ? "border-white/30 bg-white/[0.06] text-white"
                                  : "border-white/10 text-neutral-300 hover:bg-white/[0.04]",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm">{host.alias}</span>
                                <span className="block truncate text-[11px] text-neutral-500">
                                  {detail}
                                  {host.port && host.port !== "22" ? `:${host.port}` : ""}
                                </span>
                              </span>
                              {active ? <Check className="size-3.5 shrink-0" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        Host
                      </span>
                      <input
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
              ) : selected === "openwa" ? (
                <>
                  {signedIn && !isChild ? (
                    <button
                      type="button"
                      className="btn-primary w-full justify-center"
                      onClick={() => setOpenWaQuickOpen(true)}
                    >
                      {t("whatsappConnectQuick")}
                    </button>
                  ) : null}
                  <p className="text-[11px] text-neutral-500">
                    {openWaServerManaged ? t("whatsappConnectServerManaged") : t("whatsappConnectBody")}
                  </p>
                  {openWaServerManaged ? null : (
                    <>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          Gateway URL
                        </span>
                        <input
                          required
                          value={openwaBaseUrl}
                          onChange={(event) => setOpenwaBaseUrl(event.target.value)}
                          className="field font-mono text-[12px]"
                          placeholder="http://127.0.0.1:2785"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          Session name
                        </span>
                        <input
                          required
                          value={openwaSessionId}
                          onChange={(event) => setOpenwaSessionId(event.target.value)}
                          className="field font-mono text-[12px]"
                          placeholder="arrab"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          API key
                        </span>
                        <input
                          required
                          type="password"
                          autoComplete="off"
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                          className="field font-mono text-[12px]"
                          placeholder="Gateway API key"
                        />
                      </label>
                      <p className="text-[11px] text-neutral-500">
                        Local dev only — production uses the Arrab API server gateway.
                      </p>
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
                className="fls-cta is-compact"
              >
                {busy ? <LoaderCircle className="fls-spin" size={14} /> : t("flsConnect")}
              </button>
            </form>
          </section>
        ) : null}

        {visibleCatalog.length > 0 ? (
          <div className="fls-connect-grid">
            {visibleCatalog.map((item, index) => {
              const linked = items.find(
                (entry) => entry.provider === item.provider && entry.status === "connected",
              );
              const busyThis = busy && selected === item.provider;
              const active = selected === item.provider && panelOpen;
              const oauth = isOAuthBrowserProvider(item.provider);
              return (
                <button
                  key={item.provider}
                  type="button"
                  className={cn(
                    "fls-card",
                    linked && "is-done",
                    active && "is-active",
                    item.featured && "is-featured",
                  )}
                  style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                  disabled={busyThis}
                  onClick={() => openProvider(item.provider)}
                >
                  <span className="fls-card-mark">
                    <ConnectorMark provider={item.provider} logoUrl={item.logoUrl} size={20} />
                  </span>
                  <span className="fls-card-copy">
                    <strong>
                      {item.name}
                      {item.featured ? (
                        <em className="fls-featured">{t("flsFeatured")}</em>
                      ) : null}
                    </strong>
                    <span>
                      {linked
                        ? t("connectorConnectedAs").replace(
                            "{account}",
                            linked.accountLabel || linked.provider,
                          )
                        : item.blurb}
                    </span>
                  </span>
                  <span className="fls-card-side">
                    {busyThis ? (
                      <LoaderCircle className="fls-spin" size={15} />
                    ) : linked ? (
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

      </div>
      {openWaQuickOpen ? (
        <WhatsAppConnectSheet
          onClose={() => setOpenWaQuickOpen(false)}
          onConnected={() => {
            setOpenWaQuickOpen(false);
            load();
          }}
        />
      ) : null}
    </Surface>
  );
}
