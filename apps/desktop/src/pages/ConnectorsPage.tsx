import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Cable,
  CheckCircle2,
  ExternalLink,
  Github,
  Link2,
  LoaderCircle,
  Mail,
  Send,
  Unplug,
} from "lucide-react";
import type {
  ConnectorProvider,
  ConnectorPublic,
  ConnectorResource,
  EmailMessageDetail,
  EmailMessageSummary,
} from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { notifyStudio } from "@/lib/notify";
import { cn } from "@/lib/utils";

const CATALOG: Array<{
  provider: ConnectorProvider;
  name: string;
  blurb: string;
  available: boolean;
}> = [
  {
    provider: "email",
    name: "Email",
    blurb: "Gmail, Outlook, iCloud, Yahoo — inbox, read, and send with an app password.",
    available: true,
  },
  {
    provider: "github",
    name: "GitHub",
    blurb: "Repos, commit, push, and pull requests for agent workspace.",
    available: true,
  },
  {
    provider: "gitlab",
    name: "GitLab",
    blurb: "Projects via personal access token (api scope).",
    available: true,
  },
  {
    provider: "bitbucket",
    name: "Bitbucket",
    blurb: "Repos via username + app password.",
    available: true,
  },
  {
    provider: "linear",
    name: "Linear",
    blurb: "Teams and issues via personal API key.",
    available: true,
  },
  {
    provider: "slack",
    name: "Slack",
    blurb: "Channels via bot or user token.",
    available: true,
  },
  {
    provider: "notion",
    name: "Notion",
    blurb: "Pages via internal integration token.",
    available: true,
  },
];

const EMAIL_PRESETS = [
  { id: "gmail", label: "Gmail" },
  { id: "outlook", label: "Outlook" },
  { id: "icloud", label: "iCloud" },
  { id: "yahoo", label: "Yahoo" },
  { id: "custom", label: "Custom" },
] as const;

const TOKEN_HINTS: Record<ConnectorProvider, string> = {
  email: "Use an app password (not your normal login). Gmail: Google Account → Security → App passwords.",
  github: "Classic PAT with repo scope, or fine-grained token with repository access.",
  gitlab: "Personal access token with api scope.",
  bitbucket: "App password with account + repository read. Username is required.",
  linear: "Personal API key from Linear Settings → API.",
  slack: "Bot or user OAuth token (xoxb-… / xoxp-…).",
  notion: "Internal integration secret from Notion developers.",
};

export function ConnectorsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<ConnectorPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ConnectorProvider>("email");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailPreset, setEmailPreset] = useState<(typeof EMAIL_PRESETS)[number]["id"]>("gmail");
  const [imapHost, setImapHost] = useState("imap.gmail.com");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [imapPort, setImapPort] = useState("993");
  const [smtpPort, setSmtpPort] = useState("465");
  const [bitbucketUser, setBitbucketUser] = useState("");
  const [gitlabBase, setGitlabBase] = useState("https://gitlab.com");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resources, setResources] = useState<ConnectorResource[]>([]);
  const [mailbox, setMailbox] = useState("INBOX");
  const [messages, setMessages] = useState<EmailMessageSummary[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessageDetail | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .connectors()
      .then((response) => {
        setItems(response.items);
        setActiveId((current) => current ?? response.items[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (emailPreset === "gmail") {
      setImapHost("imap.gmail.com");
      setSmtpHost("smtp.gmail.com");
      setImapPort("993");
      setSmtpPort("465");
    } else if (emailPreset === "outlook") {
      setImapHost("outlook.office365.com");
      setSmtpHost("smtp.office365.com");
      setImapPort("993");
      setSmtpPort("587");
    } else if (emailPreset === "icloud") {
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

  const active = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [activeId, items],
  );

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (selected === "email") {
      return emailAddress.includes("@") && token.trim().length >= 4;
    }
    if (selected === "bitbucket") {
      return bitbucketUser.trim().length > 0 && token.trim().length >= 8;
    }
    return token.trim().length >= 8;
  }, [bitbucketUser, busy, emailAddress, selected, token]);

  async function onConnect(event: FormEvent) {
    event.preventDefault();
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
      }
      const connected = await arrabApi.connectConnector({
        provider: selected,
        token,
        label: label.trim() || (selected === "email" ? emailAddress.trim() : null),
        config: Object.keys(config).length > 0 ? config : null,
      });
      setToken("");
      setLabel("");
      setActiveId(connected.id);
      setResources([]);
      setMessages([]);
      setSelectedMessage(null);
      load();
      void notifyStudio({
        kind: "connector",
        title: t("connectorConnectedNotify"),
        body: connected.accountLabel || connected.provider,
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

  async function onVerify(id: string) {
    setBusy(true);
    setError(null);
    try {
      await arrabApi.verifyConnector(id);
      load();
      void notifyStudio({
        kind: "connector",
        title: t("connectorVerifiedNotify"),
        href: "/connectors",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect(id: string) {
    setBusy(true);
    setError(null);
    try {
      await arrabApi.disconnectConnector(id);
      if (activeId === id) {
        setActiveId(null);
        setResources([]);
        setMessages([]);
        setSelectedMessage(null);
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function onResources(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await arrabApi.connectorResources(id);
      setResources(response.items);
      setActiveId(id);
      const connector = items.find((item) => item.id === id);
      if (connector?.provider === "email") {
        const inbox = response.items.find((item) => /inbox/i.test(item.name))?.name || "INBOX";
        setMailbox(inbox);
        const mail = await arrabApi.emailMessages(id, inbox, 30);
        setMessages(mail.items);
        setSelectedMessage(null);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function openMailbox(path: string) {
    if (!active || active.provider !== "email") return;
    setBusy(true);
    setError(null);
    try {
      setMailbox(path);
      const mail = await arrabApi.emailMessages(active.id, path, 30);
      setMessages(mail.items);
      setSelectedMessage(null);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function openMessage(uid: string) {
    if (!active || active.provider !== "email") return;
    setBusy(true);
    setError(null);
    try {
      const detail = await arrabApi.emailMessage(active.id, uid, mailbox);
      setSelectedMessage(detail);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function onSendEmail(event: FormEvent) {
    event.preventDefault();
    if (!active || active.provider !== "email") return;
    setBusy(true);
    setError(null);
    try {
      await arrabApi.sendEmail(active.id, {
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        text: composeBody.trim(),
      });
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      void notifyStudio({
        kind: "connector",
        title: t("emailSentNotify"),
        href: "/connectors",
      });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  const selectedMeta = CATALOG.find((item) => item.provider === selected);

  return (
    <Surface className="connector-shell">
      <div className="connector-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1200px] px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{t("connectors")}</p>
            <h1 className="mt-1 text-3xl font-medium tracking-[-0.03em] text-white">
              {t("connectorsTitle")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500">{t("connectorsBody")}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-400">
            <Cable className="size-3.5" strokeWidth={1.7} />
            {items.length} {t("connected")}
          </div>
        </header>

        {error ? <p className="mt-4 text-sm text-red-300/90">{error}</p> : null}

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CATALOG.map((item) => {
            const linked = items.filter((connection) => connection.provider === item.provider);
            const isSelected = selected === item.provider;
            return (
              <button
                key={item.provider}
                type="button"
                onClick={() => setSelected(item.provider)}
                className={cn(
                  "rounded-[24px] border p-4 text-start transition-colors",
                  isSelected
                    ? "border-white/30 bg-white/[0.04]"
                    : "border-white/10 bg-[#080808] hover:border-white/20",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl border border-white/12 bg-black">
                    {item.provider === "github" ? (
                      <Github className="size-5 text-white" strokeWidth={1.6} />
                    ) : item.provider === "email" ? (
                      <Mail className="size-5 text-white" strokeWidth={1.6} />
                    ) : (
                      <Link2 className="size-5 text-white" strokeWidth={1.6} />
                    )}
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                    {linked.length > 0 ? t("connected") : t("available")}
                  </span>
                </div>
                <p className="mt-4 text-sm text-white">{item.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">{item.blurb}</p>
                {linked.length > 0 ? (
                  <p className="mt-3 text-[11px] text-neutral-400">
                    {linked.map((connection) => connection.accountLabel).join(" · ")}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <form
            onSubmit={(event) => void onConnect(event)}
            className="rounded-[28px] border border-white/10 bg-[#080808] p-5"
          >
            <div className="flex items-center gap-2">
              {selected === "email" ? (
                <Mail className="size-4 text-neutral-400" strokeWidth={1.7} />
              ) : selected === "github" ? (
                <Github className="size-4 text-neutral-400" strokeWidth={1.7} />
              ) : (
                <Link2 className="size-4 text-neutral-400" strokeWidth={1.7} />
              )}
              <h2 className="text-sm text-white">
                {t("connect")} {selectedMeta?.name ?? selected}
              </h2>
            </div>
            <p className="mt-2 text-xs text-neutral-500">{TOKEN_HINTS[selected]}</p>

            <label className="mt-5 grid gap-1.5">
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
                <label className="mt-3 grid gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("emailAddress")}
                  </span>
                  <input
                    required
                    type="email"
                    value={emailAddress}
                    onChange={(event) => setEmailAddress(event.target.value)}
                    className="field"
                    placeholder="you@gmail.com"
                  />
                </label>
                <label className="mt-3 grid gap-1.5">
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
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        IMAP host
                      </span>
                      <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} className="field" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        SMTP host
                      </span>
                      <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className="field" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        IMAP port
                      </span>
                      <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} className="field" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                        SMTP port
                      </span>
                      <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="field" />
                    </label>
                  </div>
                ) : null}
                <label className="mt-3 grid gap-1.5">
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
            ) : (
              <>
                {selected === "bitbucket" ? (
                  <label className="mt-3 grid gap-1.5">
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
                  <label className="mt-3 grid gap-1.5">
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
                <label className="mt-3 grid gap-1.5">
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
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Cable className="size-4" />}
              {t("connect")}
            </button>
          </form>

          <section className="rounded-[28px] border border-white/10 bg-[#070707] p-5">
            <h2 className="text-sm text-white">{t("connected")}</h2>
            {items.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">{t("noConnectors")}</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-2xl border px-4 py-3",
                      activeId === item.id ? "border-white/25 bg-white/[0.03]" : "border-white/10",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 text-start"
                        onClick={() => {
                          setActiveId(item.id);
                          setResources([]);
                          setMessages([]);
                          setSelectedMessage(null);
                        }}
                      >
                        <p className="truncate text-sm text-white">
                          {item.accountLabel ?? item.provider}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                          {item.provider} · {item.status}
                        </p>
                      </button>
                      {item.status === "connected" ? (
                        <CheckCircle2 className="size-4 shrink-0 text-white" strokeWidth={1.7} />
                      ) : (
                        <Unplug className="size-4 shrink-0 text-neutral-500" strokeWidth={1.7} />
                      )}
                    </div>
                    {item.error ? (
                      <p className="mt-2 text-xs text-neutral-400">
                        {t("connectorError")}: {item.error}
                      </p>
                    ) : null}
                    {item.scopes.length > 0 ? (
                      <p className="mt-2 text-[11px] text-neutral-600">
                        {t("scopes")}: {item.scopes.join(", ")}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onVerify(item.id)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-neutral-300 hover:text-white disabled:opacity-40"
                      >
                        {t("verify")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onResources(item.id)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-neutral-300 hover:text-white disabled:opacity-40"
                      >
                        {item.provider === "email" ? t("openInbox") : t("refreshRepos")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onDisconnect(item.id)}
                        className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-neutral-300 hover:text-white disabled:opacity-40"
                      >
                        {t("disconnect")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-white/8 pt-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">{t("resources")}</p>
              {!active || resources.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">{t("noResources")}</p>
              ) : (
                <ul className="mt-3 max-h-48 divide-y divide-white/8 overflow-y-auto">
                  {resources.map((resource) => (
                    <li key={resource.id} className="flex items-center justify-between gap-3 py-2.5">
                      <button
                        type="button"
                        className="min-w-0 text-start"
                        onClick={() => {
                          if (active?.provider === "email") void openMailbox(resource.name);
                        }}
                      >
                        <p className="truncate text-sm text-white">{resource.name}</p>
                        <p className="text-[11px] text-neutral-500">{resource.kind}</p>
                      </button>
                      {resource.url ? (
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-500 hover:text-white"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {active?.provider === "email" ? (
          <section className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[28px] border border-white/10 bg-[#080808] p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm text-white">
                  {t("inbox")} · {mailbox}
                </h2>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openMailbox(mailbox)}
                  className="text-[11px] text-neutral-400 hover:text-white disabled:opacity-40"
                >
                  {t("refresh")}
                </button>
              </div>
              {messages.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-500">{t("noEmailMessages")}</p>
              ) : (
                <ul className="mt-4 max-h-[420px] space-y-2 overflow-y-auto">
                  {messages.map((message) => (
                    <li key={message.id}>
                      <button
                        type="button"
                        onClick={() => void openMessage(message.id)}
                        className={cn(
                          "w-full rounded-2xl border px-3 py-2.5 text-start transition",
                          selectedMessage?.id === message.id
                            ? "border-white/25 bg-white/[0.04]"
                            : "border-white/10 hover:border-white/20",
                        )}
                      >
                        <p className="truncate text-[13px] text-white">{message.subject}</p>
                        <p className="mt-1 truncate text-[11px] text-neutral-500">
                          {message.from}
                          {message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}
                        </p>
                        {message.snippet ? (
                          <p className="mt-1 line-clamp-2 text-[11px] text-neutral-600">
                            {message.snippet}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-white/10 bg-[#070707] p-5">
                <h2 className="text-sm text-white">{t("emailRead")}</h2>
                {selectedMessage ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-[15px] text-white">{selectedMessage.subject}</p>
                    <p className="text-[12px] text-neutral-500">
                      {t("from")}: {selectedMessage.from}
                    </p>
                    {selectedMessage.to.length > 0 ? (
                      <p className="text-[12px] text-neutral-500">
                        {t("to")}: {selectedMessage.to.join(", ")}
                      </p>
                    ) : null}
                    <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/40 p-3 text-[12px] leading-relaxed text-neutral-300">
                      {selectedMessage.text || selectedMessage.snippet || ""}
                    </pre>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-neutral-500">{t("selectEmailHint")}</p>
                )}
              </div>

              <form
                onSubmit={(event) => void onSendEmail(event)}
                className="rounded-[28px] border border-white/10 bg-[#080808] p-5"
              >
                <h2 className="text-sm text-white">{t("composeEmail")}</h2>
                <label className="mt-3 grid gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("to")}
                  </span>
                  <input
                    required
                    value={composeTo}
                    onChange={(event) => setComposeTo(event.target.value)}
                    className="field"
                    placeholder="teammate@company.com"
                  />
                </label>
                <label className="mt-3 grid gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("subject")}
                  </span>
                  <input
                    required
                    value={composeSubject}
                    onChange={(event) => setComposeSubject(event.target.value)}
                    className="field"
                  />
                </label>
                <label className="mt-3 grid gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {t("message")}
                  </span>
                  <textarea
                    required
                    value={composeBody}
                    onChange={(event) => setComposeBody(event.target.value)}
                    rows={6}
                    className="field min-h-[120px]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-40"
                >
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {t("sendEmail")}
                </button>
              </form>
            </div>
          </section>
        ) : null}
      </div>
    </Surface>
  );
}
