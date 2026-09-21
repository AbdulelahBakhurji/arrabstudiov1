import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, EyeOff, Lock, Plus, Settings, Square, Trash2 } from "lucide-react";
import type { AiGatewayStatusResponse } from "@arrab/shared";
import { ComposerPlusMenu } from "@/components/ComposerPlusMenu";
import { arrabApi } from "@/lib/api";
import { resolvePreferredModel } from "@/lib/ai-prefs";
import { filesToDraftParts } from "@/lib/composer-attachments";
import { useLanguage } from "@/i18n/LanguageProvider";
import { readPrefs } from "@/lib/prefs";
import {
  createIncognitoVault,
  deleteIncognitoSession,
  forgetIncognitoApiId,
  incognitoVaultExists,
  isIncognitoUnlocked,
  listIncognitoSessions,
  loadIncognitoSession,
  lockIncognitoVault,
  newIncognitoSessionId,
  rememberIncognitoApiId,
  saveIncognitoSession,
  unlockIncognitoVault,
  wipeIncognitoVault,
  type IncognitoMessage,
  type IncognitoSession,
} from "@/lib/incognito-vault";
import { takeIncognitoImport } from "@/lib/incognito-import";

type ListedSession = Awaited<ReturnType<typeof listIncognitoSessions>>[number];

/**
 * Password-gated private chat for the companions surface.
 * Ciphertext stays on-device; the model round-trip uses a disposable API conversation.
 */
export function IncognitoRoom({ onExit }: { onExit?: () => void }) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [hasVault, setHasVault] = useState(false);
  const [unlocked, setUnlocked] = useState(() => isIncognitoUnlocked());
  const [managing, setManaging] = useState(false);
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IncognitoMessage[]>([]);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [apiConversationId, setApiConversationId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatusResponse | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void arrabApi
      .aiStatus()
      .then((status) => {
        if (!cancelled) setAiStatus(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!isIncognitoUnlocked()) {
      setSessions([]);
      return [];
    }
    const listed = await listIncognitoSessions();
    setSessions(listed);
    return listed;
  }, []);

  const consumePendingImport = useCallback(async () => {
    const pending = takeIncognitoImport();
    if (!pending || !isIncognitoUnlocked()) return null;
    const now = new Date().toISOString();
    const session: IncognitoSession = {
      id: newIncognitoSessionId(),
      title: pending.title,
      agentId: null,
      apiConversationId: null,
      messages: pending.messages,
      createdAt: now,
      updatedAt: now,
    };
    await saveIncognitoSession(session);
    return session;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setHasVault(await incognitoVaultExists());
      if (!isIncognitoUnlocked() || cancelled) return;
      const imported = await consumePendingImport();
      if (cancelled) return;
      const listed = await listIncognitoSessions();
      if (cancelled) return;
      setSessions(listed);
      const targetId = imported?.id ?? listed[0]?.id;
      if (!targetId) return;
      const session = imported ?? (await loadIncognitoSession(targetId));
      if (!session || cancelled) return;
      setSessionId(session.id);
      setMessages(session.messages);
      setAgentId(session.agentId);
      setApiConversationId(session.apiConversationId);
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [consumePendingImport]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function setupVault() {
    setError(null);
    if (password.trim().length < 6) {
      setError(t("chatIncognitoTooShort"));
      return;
    }
    if (password !== password2) {
      setError(t("chatIncognitoMismatch"));
      return;
    }
    setBusy(true);
    try {
      await createIncognitoVault(password);
      setHasVault(true);
      setUnlocked(true);
      setPassword("");
      setPassword2("");
      const imported = await consumePendingImport();
      await refreshSessions();
      if (imported) {
        setSessionId(imported.id);
        setMessages(imported.messages);
        setAgentId(imported.agentId);
        setApiConversationId(imported.apiConversationId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("chatIncognitoWrongPassword"));
    } finally {
      setBusy(false);
    }
  }

  async function unlockVault() {
    setError(null);
    setBusy(true);
    try {
      await unlockIncognitoVault(password);
      setUnlocked(true);
      setPassword("");
      const imported = await consumePendingImport();
      const listed = await refreshSessions();
      if (imported) {
        setSessionId(imported.id);
        setMessages(imported.messages);
        setAgentId(imported.agentId);
        setApiConversationId(imported.apiConversationId);
      } else {
        const latest = listed[0];
        if (latest) {
          await openSession(latest.id);
        }
      }
    } catch {
      setError(t("chatIncognitoWrongPassword"));
    } finally {
      setBusy(false);
    }
  }

  function lockVault() {
    abortRef.current?.abort();
    lockIncognitoVault();
    setUnlocked(false);
    setManaging(false);
    setSessions([]);
    setSessionId(null);
    setMessages([]);
    setAgentId(null);
    setApiConversationId(null);
    setDraft("");
  }

  function leaveVault() {
    lockVault();
    onExit?.();
  }

  async function wipeVault() {
    if (!window.confirm(t("chatIncognitoWipeConfirm"))) return;
    setBusy(true);
    try {
      abortRef.current?.abort();
      for (const item of sessions) {
        const full = await loadIncognitoSession(item.id);
        if (full?.apiConversationId) {
          forgetIncognitoApiId(full.apiConversationId);
          try {
            await arrabApi.deleteConversation(full.apiConversationId);
          } catch {
            // ignore remote cleanup failures
          }
        }
      }
      await wipeIncognitoVault();
      setHasVault(false);
      setUnlocked(false);
      setManaging(false);
      setSessions([]);
      setSessionId(null);
      setMessages([]);
      setAgentId(null);
      setApiConversationId(null);
    } finally {
      setBusy(false);
    }
  }

  async function ensureAgent(): Promise<string> {
    if (agentId) return agentId;
    const listed = await arrabApi.agents();
    const existing = listed.items.find((agent) => agent.name === "Incognito")?.id;
    if (existing) {
      setAgentId(existing);
      return existing;
    }
    const created = await arrabApi.createAgent({
      name: "Incognito",
      role: "Private companion",
      specialty: "private",
      instructions:
        "You are a private companion. Keep answers useful and discreet. Do not mention that this chat is encrypted.",
      status: "active",
    });
    setAgentId(created.id);
    return created.id;
  }

  async function openSession(id: string) {
    setError(null);
    const session = await loadIncognitoSession(id);
    if (!session) return;
    setSessionId(session.id);
    setMessages(session.messages);
    setAgentId(session.agentId);
    setApiConversationId(session.apiConversationId);
    setManaging(false);
  }

  async function newSession() {
    if (!isIncognitoUnlocked()) return;
    setBusy(true);
    setError(null);
    try {
      const soloId = await ensureAgent();
      const created = await arrabApi.createConversation({
        agentId: soloId,
        title: t("chatIncognitoBadge"),
        spend: { tier: "low", sessionTokenBudget: null },
      });
      const id = newIncognitoSessionId();
      const session: IncognitoSession = {
        id,
        title: t("chatIncognitoBadge"),
        agentId: soloId,
        apiConversationId: created.id,
        messages: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      await saveIncognitoSession(session);
      rememberIncognitoApiId(created.id);
      setSessionId(id);
      setMessages([]);
      setAgentId(soloId);
      setApiConversationId(created.id);
      setManaging(false);
      await refreshSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function removeSession(id: string) {
    const session = await loadIncognitoSession(id);
    if (session?.apiConversationId) {
      forgetIncognitoApiId(session.apiConversationId);
      try {
        await arrabApi.deleteConversation(session.apiConversationId);
      } catch {
        // ignore
      }
    }
    await deleteIncognitoSession(id);
    if (sessionId === id) {
      setSessionId(null);
      setMessages([]);
      setApiConversationId(null);
    }
    await refreshSessions();
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending || busy) return;
    setSending(true);
    setError(null);
    setDraft("");

    let activeSessionId = sessionId;
    let conversationId = apiConversationId;
    let soloId = agentId;

    try {
      if (!activeSessionId || !conversationId) {
        soloId = await ensureAgent();
        const created = await arrabApi.createConversation({
          agentId: soloId,
          title: t("chatIncognitoBadge"),
          spend: { tier: "low", sessionTokenBudget: null },
        });
        conversationId = created.id;
        activeSessionId = newIncognitoSessionId();
        const session: IncognitoSession = {
          id: activeSessionId,
          title: text.slice(0, 48) || t("chatIncognitoBadge"),
          agentId: soloId,
          apiConversationId: conversationId,
          messages: [],
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        await saveIncognitoSession(session);
        rememberIncognitoApiId(conversationId);
        setSessionId(activeSessionId);
        setAgentId(soloId);
        setApiConversationId(conversationId);
        await refreshSessions();
      }

      const userMessage: IncognitoMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      const assistantId = crypto.randomUUID();
      let nextMessages = [...messages, userMessage];
      setMessages(nextMessages);

      const existing = await loadIncognitoSession(activeSessionId);
      await saveIncognitoSession({
        id: activeSessionId,
        title: text.slice(0, 48) || existing?.title || t("chatIncognitoBadge"),
        agentId: soloId,
        apiConversationId: conversationId,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let reply = "";

      await arrabApi.sendMessageStream(
        conversationId!,
        {
          content: text,
          model: resolvePreferredModel(aiStatus, readPrefs()),
          spend: { tier: "low", sessionTokenBudget: null },
        },
        {
          onToken: (token) => {
            if (controller.signal.aborted) return;
            reply += token;
            const assistant: IncognitoMessage = {
              id: assistantId,
              role: "assistant",
              content: reply,
              createdAt: new Date().toISOString(),
            };
            nextMessages = [
              ...nextMessages.filter((message) => message.id !== assistantId),
              assistant,
            ];
            setMessages(nextMessages);
          },
          onDone: (response) => {
            if (!reply && response.assistantMessage?.content) {
              reply = response.assistantMessage.content;
              const assistant: IncognitoMessage = {
                id: assistantId,
                role: "assistant",
                content: reply,
                createdAt: new Date().toISOString(),
              };
              nextMessages = [
                ...nextMessages.filter((message) => message.id !== assistantId),
                assistant,
              ];
              setMessages(nextMessages);
            }
          },
          onError: (message) => {
            setError(message);
          },
        },
        controller.signal,
      );

      if (reply) {
        const latest = await loadIncognitoSession(activeSessionId);
        await saveIncognitoSession({
          id: activeSessionId,
          title: text.slice(0, 48) || latest?.title || t("chatIncognitoBadge"),
          agentId: soloId,
          apiConversationId: conversationId,
          messages: nextMessages,
          updatedAt: new Date().toISOString(),
          createdAt: latest?.createdAt ?? new Date().toISOString(),
        });
        await refreshSessions();
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : t("apiUnavailable"));
        setDraft(text);
      }
    } finally {
      setSending(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  }

  if (!hasVault) {
    return (
      <section className="cp-room cp-incognito-room" aria-label={t("chatIncognitoMode")}>
        <header className="cp-room-header">
          <div className="cp-room-person">
            <span className="cp-incognito-face">
              <EyeOff size={18} strokeWidth={1.6} />
            </span>
            <strong>{t("chatIncognitoMode")}</strong>
            <span className="cp-muted">{t("chatIncognitoHint")}</span>
          </div>
        </header>
        <div className="cp-incognito-gate">
          <Lock size={22} strokeWidth={1.5} />
          <h2>{t("chatIncognitoSetup")}</h2>
          <p>{t("chatIncognitoSetupBody")}</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("chatIncognitoPassword")}
            autoComplete="new-password"
          />
          <input
            type="password"
            value={password2}
            onChange={(event) => setPassword2(event.target.value)}
            placeholder={t("chatIncognitoPasswordConfirm")}
            autoComplete="new-password"
          />
          {error ? <p className="cp-incognito-error">{error}</p> : null}
          <button type="button" className="cp-button cp-incognito-cta" disabled={busy} onClick={() => void setupVault()}>
            {t("chatIncognitoSetup")}
          </button>
        </div>
      </section>
    );
  }

  if (!unlocked) {
    return (
      <section className="cp-room cp-incognito-room" aria-label={t("chatIncognitoLockedTitle")}>
        <header className="cp-room-header">
          <div className="cp-room-person">
            <span className="cp-incognito-face">
              <Lock size={18} strokeWidth={1.6} />
            </span>
            <strong>{t("chatIncognitoLockedTitle")}</strong>
            <span className="cp-muted">{t("chatIncognitoUnlockBody")}</span>
          </div>
        </header>
        <div className="cp-incognito-gate">
          <Lock size={22} strokeWidth={1.5} />
          <h2>{t("chatIncognitoUnlock")}</h2>
          <p>{t("chatIncognitoUnlockBody")}</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("chatIncognitoPassword")}
            autoComplete="current-password"
            onKeyDown={(event) => {
              if (event.key === "Enter") void unlockVault();
            }}
          />
          {error ? <p className="cp-incognito-error">{error}</p> : null}
          <button type="button" className="cp-button cp-incognito-cta" disabled={busy} onClick={() => void unlockVault()}>
            {t("chatIncognitoUnlock")}
          </button>
          <button type="button" className="cp-text-button" disabled={busy} onClick={() => void wipeVault()}>
            {t("chatIncognitoWipe")}
          </button>
        </div>
      </section>
    );
  }

  if (managing) {
    return (
      <section className="cp-room cp-incognito-room" aria-label={t("chatIncognitoManage")}>
        <header className="cp-room-header">
          <div className="cp-room-person">
            <button
              type="button"
              className="cp-icon cp-incognito-settings"
              aria-label={t("chatIncognitoManage")}
              onClick={() => setManaging(false)}
            >
              <Settings size={18} strokeWidth={1.6} />
            </button>
            <strong>{t("chatIncognitoManage")}</strong>
            <span className="cp-muted">{t("chatIncognitoBadge")}</span>
          </div>
        </header>

        <div className="cp-incognito-manage">
          <p className="cp-muted">{t("chatIncognitoManageBody")}</p>

          <div className="cp-incognito-manage-actions">
            <button type="button" className="cp-button" disabled={busy} onClick={() => void newSession()}>
              <Plus size={15} />
              {t("chatIncognitoNew")}
            </button>
            <button type="button" className="cp-button" onClick={lockVault}>
              <Lock size={15} />
              {t("chatIncognitoLock")}
            </button>
            <button type="button" className="cp-button" disabled={busy} onClick={() => void wipeVault()}>
              <Trash2 size={15} />
              {t("chatIncognitoWipe")}
            </button>
          </div>

          {sessions.length > 0 ? (
            <div className="cp-incognito-manage-sessions" aria-label={t("chatIncognitoMode")}>
              {sessions.map((item) => (
                <div key={item.id} className={`cp-incognito-session ${item.id === sessionId ? "is-active" : ""}`}>
                  <button type="button" onClick={() => void openSession(item.id)}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.messageCount} · {t("chatIncognitoBadge")}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="cp-icon"
                    title={t("chatIncognitoDelete")}
                    onClick={() => void removeSession(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="cp-incognito-manage-footer">
            <button type="button" className="cp-button cp-incognito-cta" onClick={() => setManaging(false)}>
              {t("chatIncognitoDone")}
            </button>
            <button type="button" className="cp-text-button" onClick={leaveVault}>
              {t("chatIncognitoLeave")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="cp-room cp-incognito-room" aria-label={t("chatIncognitoMode")}>
      <header className="cp-room-header">
        <div className="cp-room-person">
          <button
            type="button"
            className="cp-icon cp-incognito-settings"
            aria-label={t("chatIncognitoManage")}
            onClick={() => setManaging(true)}
          >
            <Settings size={18} strokeWidth={1.6} />
          </button>
          <span className="cp-incognito-face is-open">
            <EyeOff size={18} strokeWidth={1.6} />
          </span>
          <strong>{t("chatIncognitoMode")}</strong>
          <span className="cp-muted">{t("chatIncognitoBadge")}</span>
        </div>
      </header>

      <div className={`cp-incognito-layout ${sessions.length === 0 ? "is-solo" : ""}`}>
        {sessions.length > 0 ? (
          <aside className="cp-incognito-sessions" aria-label={t("chatIncognitoMode")}>
            {sessions.map((item) => (
              <div key={item.id} className={`cp-incognito-session ${item.id === sessionId ? "is-active" : ""}`}>
                <button type="button" onClick={() => void openSession(item.id)}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.messageCount} · {t("chatIncognitoBadge")}
                  </small>
                </button>
                <button
                  type="button"
                  className="cp-icon"
                  title={t("chatIncognitoDelete")}
                  onClick={() => void removeSession(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </aside>
        ) : null}

        <div className="cp-incognito-thread">
          <div ref={scrollRef} className="cp-messages" role="log">
            {!sessionId ? (
              <div className="cp-chat-welcome">
                <span className="cp-welcome-icon">
                  <EyeOff size={28} strokeWidth={1.25} />
                </span>
                <h2>{t("chatIncognitoMode")}</h2>
                <p className="cp-muted">{t("chatIncognitoReadyHint")}</p>
                <button type="button" className="cp-button cp-incognito-cta" disabled={busy} onClick={() => void newSession()}>
                  {t("chatIncognitoNew")}
                </button>
              </div>
            ) : null}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`cp-message ${message.role === "user" ? "cp-message-me" : ""}`}
              >
                <div>
                  <p className="cp-message-author">
                    {message.role === "user" ? (ar ? "أنت" : "You") : t("chatIncognitoBadge")}
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </p>
                  <div className="cp-message-text">{message.content}</div>
                </div>
              </article>
            ))}
            {sending ? (
              <p className="cp-typing" role="status">
                <span />
                <span />
                <span />
                {ar ? "يردّ…" : "Replying…"}
              </p>
            ) : null}
          </div>

          <div className="cp-composer-area">
            {error ? (
              <div className="cp-notice" role="alert">
                {error}
              </div>
            ) : null}
            <div className="cp-composer">
              <ComposerPlusMenu
                open={plusOpen}
                onOpenChange={setPlusOpen}
                onUploadImages={() => imageInputRef.current?.click()}
                onUploadFiles={() => fileInputRef.current?.click()}
                onWebSearch={() =>
                  setDraft((current) =>
                    current.trim().startsWith("/web")
                      ? current
                      : `/web ${current.trim()}`.trim() + " ",
                  )
                }
                features={{ folder: false }}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
                multiple
                hidden
                onChange={(event) => {
                  void filesToDraftParts(event.target.files).then((parts) => {
                    if (!parts.length) return;
                    setDraft((current) =>
                      current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n"),
                    );
                  });
                  event.target.value = "";
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  void filesToDraftParts(event.target.files).then((parts) => {
                    if (!parts.length) return;
                    setDraft((current) =>
                      current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n"),
                    );
                  });
                  event.target.value = "";
                }}
              />
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("chatIncognitoCompose")}
                rows={1}
                disabled={busy && !sending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              {sending ? (
                <button type="button" className="cp-send" onClick={stop} aria-label={ar ? "إيقاف" : "Stop"}>
                  <Square size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="cp-send"
                  disabled={!draft.trim() || busy}
                  onClick={() => void send()}
                  aria-label={t("compSend")}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
