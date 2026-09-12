import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Agent, Conversation, Message } from "@arrab/shared";
import { ApiErrorState, PageHeader } from "@/components/EmptyState";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ConversationsPage() {
  const { conversationId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const agentFilter = searchParams.get("agentId");

  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(conversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTitle, setActiveTitle] = useState("Conversation");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadLists = useCallback(async () => {
    setError(null);
    try {
      const [agentList, conversationList, aiStatus] = await Promise.all([
        arrabApi.agents(),
        agentFilter ? arrabApi.agentConversations(agentFilter) : arrabApi.conversations(),
        arrabApi.aiStatus(),
      ]);
      setAgents(agentList.items);
      setConversations(conversationList.items);
      setProviderConfigured(aiStatus.configured);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : "Cannot reach the Arrab API");
    }
  }, [agentFilter]);

  const loadConversation = useCallback(async (id: string) => {
    const detail = await arrabApi.conversation(id);
    setActiveId(id);
    setActiveTitle(detail.conversation.title ?? "Conversation");
    setMessages(detail.messages);
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (conversationId) {
      void loadConversation(conversationId).catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : "Cannot load conversation");
      });
    }
  }, [conversationId, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    if (!agentFilter || conversationId || bootstrapping || conversations.length > 0) {
      return;
    }
    setBootstrapping(true);
    void arrabApi
      .createConversation({ agentId: agentFilter })
      .then(async (created) => {
        await loadLists();
        navigate(`/conversations/${created.id}?agentId=${agentFilter}`, { replace: true });
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : "Could not start conversation");
      })
      .finally(() => setBootstrapping(false));
  }, [agentFilter, bootstrapping, conversationId, conversations.length, loadLists, navigate]);

  async function startWithAgent(agentId: string) {
    setError(null);
    try {
      const created = await arrabApi.createConversation({ agentId });
      await loadLists();
      navigate(`/conversations/${created.id}?agentId=${agentId}`);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : "Could not start conversation");
    }
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || draft.trim() === "") {
      return;
    }
    setSendError(null);
    setSending(true);
    try {
      const result = await arrabApi.sendMessage(activeId, { content: draft.trim() });
      setDraft("");
      setMessages((current) => [
        ...current,
        result.userMessage,
        ...(result.assistantMessage ? [result.assistantMessage] : []),
      ]);
      setProviderConfigured(result.providerConfigured);
      await loadLists();
      if (!result.providerConfigured) {
        setSendError(
          "Message saved. Configure OPENAI_API_KEY on the Arrab API to receive employee replies.",
        );
      }
    } catch (err: unknown) {
      setSendError(err instanceof ApiRequestError ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  const activeAgent = agents.find(
    (agent) => agent.id === conversations.find((item) => item.id === activeId)?.agentId,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/8 px-8 py-5">
        <PageHeader
          title="Conversations"
          description="Talk with AI employees through the Arrab API. Provider keys never leave the server."
        />
      </div>

      {error ? (
        <div className="px-8 py-4">
          <ApiErrorState message={error} onRetry={() => void loadLists()} />
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-white/8 bg-[#070707] px-3 py-4">
          <p className="px-2 text-[10px] uppercase tracking-[0.18em] text-neutral-600">Employees</p>
          <div className="mt-2 space-y-1">
            {agents
              .filter((agent) => agent.status !== "archived")
              .map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => void startWithAgent(agent.id)}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm text-neutral-300 hover:bg-white/5 hover:text-white"
                >
                  <span className="truncate">{agent.name}</span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                    New
                  </span>
                </button>
              ))}
          </div>

          <p className="mt-6 px-2 text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            Threads
          </p>
          <div className="mt-2 space-y-1">
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-neutral-500">No conversations yet.</p>
            ) : null}
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                to={`/conversations/${conversation.id}${
                  conversation.agentId ? `?agentId=${conversation.agentId}` : ""
                }`}
                className={cn(
                  "block rounded-md px-2.5 py-2 text-sm transition-colors",
                  activeId === conversation.id
                    ? "bg-white text-black"
                    : "text-neutral-300 hover:bg-white/5 hover:text-white",
                )}
              >
                <span className="line-clamp-1">{conversation.title ?? "Untitled"}</span>
              </Link>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-[#050505]">
          {activeId ? (
            <>
              <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-white">{activeTitle}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {activeAgent
                      ? `${activeAgent.name} · ${activeAgent.role}`
                      : "AI employee conversation"}
                    {providerConfigured === false
                      ? " · provider not configured"
                      : providerConfigured
                        ? " · provider ready"
                        : ""}
                  </p>
                </div>
                <Link
                  to="/employees"
                  className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs text-white hover:bg-white/5"
                >
                  Employees
                </Link>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6">
                {messages.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Send the first message to start working with this employee.
                  </p>
                ) : null}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      message.role === "user"
                        ? "ml-auto bg-white text-black"
                        : "border border-white/10 bg-white/[0.03] text-neutral-200",
                    )}
                  >
                    <p className="mb-1 text-[10px] uppercase tracking-[0.16em] opacity-60">
                      {message.role}
                    </p>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                ))}
                {sending ? (
                  <p className="text-xs uppercase tracking-[0.16em] text-neutral-600">Thinking…</p>
                ) : null}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={onSend} className="border-t border-white/8 px-6 py-4">
                {sendError ? <p className="mb-3 text-xs text-neutral-400">{sendError}</p> : null}
                <div className="flex gap-3">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                    placeholder="Message this employee…"
                    className="min-h-[44px] flex-1 resize-none rounded-xl border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/35"
                  />
                  <button
                    type="submit"
                    disabled={sending || draft.trim() === ""}
                    className="h-11 self-end rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-8">
              <div className="max-w-md text-center">
                <p className="text-sm font-medium text-white">Select or start a conversation</p>
                <p className="mt-2 text-sm text-neutral-500">
                  Choose an employee on the left to open a real thread stored by the Arrab API.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
