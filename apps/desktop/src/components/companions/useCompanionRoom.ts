import { useEffect, useRef, useState } from "react";
import type { Approval, AiGatewayStatusResponse, WorkspaceHint } from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { resolveCompanionModel, hasLocalModelSelected } from "@/lib/ai-prefs";
import {
  executeLocalAgentTool,
  isClientExecTool,
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
  type LocalToolArtifact,
} from "@/lib/agent-local-tools";
import { companionRoomKey, createCompanionDraftStore } from "@/lib/companion-drafts";
import { useLanguage } from "@/i18n/LanguageProvider";
import { ensureAssistantDesk } from "@/lib/fs";
import { streamOllamaChat } from "@/lib/local-models";
import { readPrefs } from "@/lib/prefs";
import { isTauriRuntime } from "@/lib/terminal";
import {
  captureWork,
  companionInstructions,
  companionInstructionsNeedSync,
  companionSpendSettings,
  companionTurnNotes,
  detectSensitive,
  ensureGeneralCompanion,
  findCompanion,
  getCompanionState,
  isSensitiveNow,
  liveCompanions,
  markCompanionInstructionsSynced,
  markSensitive,
  noteTopics,
  recordExchange,
  touchThread,
  updateCompanion,
  visibleFacts,
  addParentGuidanceFact,
  type CompanionProfile,
} from "@/lib/companions";
import { purposeRegistryById, resolvePurposeIdFromDomain } from "@/lib/purpose-registry";
import { ingestBrainTurn } from "@/lib/second-brain";
import {
  readSessionMode,
  sessionModePromptPrefix,
  stripSuggestModeMarker,
  type SessionMode,
} from "@/lib/session-mode";


export type ChatLine = {
  id: string;
  who: "me" | "companion";
  companionId: string | null;
  text: string;
  at: string;
  contributor?: boolean;
};
export type ReplyMode = "open" | "vent" | "take";
export type CompanionSendExtras = {
  workspaceHint?: Partial<WorkspaceHint>;
  onArtifact?: (artifact: LocalToolArtifact) => void;
  /** Clear a streamed “awaiting tool” placeholder before the real reply lands. */
  onReplyReset?: () => void;
};
const TASK_HINTS = ["remind me", "i need to", "i have to", "don't forget", "لازم", "ذكرني"];

function taskFromLine(text: string) {
  const hint = TASK_HINTS.find((phrase) => text.toLowerCase().includes(phrase));
  if (!hint) return null;
  const clause =
    text
      .slice(text.toLowerCase().indexOf(hint) + hint.length)
      .trim()
      .split(/,| and | but |[.؟?!]/)[0]
      ?.trim() ?? "";
  return clause.length > 2 ? clause : null;
}

async function ensureCompanionAgent(
  person: CompanionProfile,
  signal: AbortSignal,
): Promise<CompanionProfile> {
  signal.throwIfAborted();
  const key = `${person.id}:${person.space}`;
  let inFlight = ensureLocks.get(key);
  if (!inFlight) {
    inFlight = (async () => {
      let ready = findCompanion(getCompanionState(), person.id) ?? person;
      const facts = visibleFacts(getCompanionState(), ready);
      const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
      const instructions = companionInstructions(ready, facts, uiLocale);
      if (!ready.agentId) {
        const purposeId =
          ready.purposeId || resolvePurposeIdFromDomain(ready.domain);
        const purpose = purposeRegistryById(purposeId);
        const agent = await arrabApi.createAgent({
          name: ready.name,
          role: purpose?.name ?? ready.domain,
          specialty: purposeId,
          instructions,
          status: "active",
        });
        updateCompanion(ready.id, { agentId: agent.id, purposeId });
        markCompanionInstructionsSynced(agent.id, instructions);
        ready = { ...ready, agentId: agent.id, purposeId };
      } else if (companionInstructionsNeedSync(ready.agentId, instructions)) {
        // Don't block the chat turn — notes also ride on workspaceHint.
        const agentId = ready.agentId;
        const purposeId =
          ready.purposeId || resolvePurposeIdFromDomain(ready.domain);
        const purpose = purposeRegistryById(purposeId);
        void arrabApi
          .updateAgent(agentId, {
            instructions,
            role: purpose?.name ?? ready.domain,
            specialty: purposeId,
          })
          .then(() => markCompanionInstructionsSynced(agentId, instructions))
          .catch(() => undefined);
      }
      if (!ready.conversationId) {
        const conversation = await arrabApi.createConversation({
          agentId: ready.agentId!,
          title: ready.name,
          spend: companionSpendSettings(ready),
        });
        updateCompanion(ready.id, { conversationId: conversation.id });
        ready = { ...ready, conversationId: conversation.id };
      }
      return ready;
    })().finally(() => {
      ensureLocks.delete(key);
    });
    ensureLocks.set(key, inFlight);
  }
  // Waiters can cancel waiting; the shared ensure keeps running for the next send.
  return await raceAbort(inFlight, signal);
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

const ensureLocks = new Map<string, Promise<CompanionProfile>>();

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /abort/i.test(error.message))
  );
}

function isMissingConversationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unknown conversation|conversation not found|not found|404/i.test(message);
}

function isSessionBudgetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /session budget|budget of .* tokens is used up/i.test(message);
}

async function resolveDeskFolder(hintFolder: string | null | undefined): Promise<string | null> {
  if (hintFolder?.trim()) return hintFolder.trim();
  if (!isTauriRuntime()) return null;
  try {
    return await ensureAssistantDesk();
  } catch {
    return null;
  }
}

async function runCompanionApproval(
  approval: Approval,
  deskFolder: string | null,
  onArtifact?: (artifact: LocalToolArtifact) => void,
): Promise<{ reply: string; nextApproval: Approval | null }> {
  const toolName = parseToolNameFromApproval(approval.detail, approval.title);
  let toolResult: string | undefined;
  if (toolName && isClientExecTool(toolName)) {
    const cwd = deskFolder ?? (await resolveDeskFolder(null));
    if (!cwd || !isTauriRuntime()) {
      toolResult =
        "FAILED: Desktop app with a folder (or Arrab desk) is required for this tool.";
    } else {
      const args = parseToolArgsFromApproval(approval.detail);
      const executed = await executeLocalAgentTool(toolName, args, cwd);
      toolResult = executed.toolResult;
      if (executed.artifact) onArtifact?.(executed.artifact);
    }
  }
  const result = await arrabApi.resolveApproval(approval.id, {
    status: "approved",
    toolResult: toolResult ?? null,
  });
  const reply = result.continued?.assistantMessage?.content?.trim() ?? "";
  return { reply, nextApproval: result.continued?.approval ?? null };
}

async function ask(
  person: CompanionProfile,
  content: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
  model: string,
  extras?: CompanionSendExtras,
) {
  const prefs = readPrefs();
  if (hasLocalModelSelected(prefs)) {
    const facts = visibleFacts(getCompanionState(), person);
    const notes = companionTurnNotes(person, facts);
    const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
    const system = [
      companionInstructions(person, facts, uiLocale),
      notes,
      extras?.workspaceHint?.sessionNotes,
      extras?.workspaceHint?.operatorDirectives,
      extras?.workspaceHint?.treeSummary
        ? `Workspace files:\n${extras.workspaceHint.treeSummary}`
        : null,
      "Prefer short clear answers. Match the operator's language.",
      "Cloud tools (web_search, scrape_page, generate_pdf) need the Arrab cloud model — local Ollama has no tools.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return streamOllamaChat(
      prefs.aiLocalModel.trim(),
      [
        { role: "system", content: system },
        { role: "user", content },
      ],
      onToken,
      signal,
      prefs.aiLocalBaseUrl,
    );
  }

  let ready = await ensureCompanionAgent(person, signal);
  const facts = visibleFacts(getCompanionState(), ready);
  const notes = companionTurnNotes(ready, facts);
  const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
  const hint = extras?.workspaceHint ?? {};
  const isAssistant = person.domain === "arrab-assistant";
  const deskFolder = await resolveDeskFolder(hint.folderPath ?? null);
  const hasDesk = Boolean(deskFolder);
  const body = {
    content,
    model,
    // Lift any leftover 5k session caps from older companion chats.
    spend: companionSpendSettings(ready),
    workspaceHint: {
      kind: (hasDesk ? "folder" : (hint.kind ?? "none")) as WorkspaceHint["kind"],
      folderPath: deskFolder,
      repoFullName: hint.repoFullName ?? null,
      branch: hint.branch ?? null,
      gitStatus: hint.gitStatus ?? null,
      treeSummary: hint.treeSummary ?? null,
      sessionNotes: [notes, hint.sessionNotes].filter(Boolean).join("\n\n") || notes,
      activeGoal: hint.activeGoal ?? null,
      openFilePath: hint.openFilePath ?? null,
      openFileContent: hint.openFileContent ?? null,
      recentTerminal: hint.recentTerminal ?? null,
      workspaceRules: hint.workspaceRules ?? null,
      mentions: hint.mentions ?? null,
      operatorDirectives: [
        isAssistant
          ? "You are Arrab Assistant — do the work with tools. Use PC files when a folder is attached (or the Arrab desk). Use every connected connector when relevant."
          : "Obey companion purpose, notes, and tone. Prefer short replies. Stay in character.",
        "LANGUAGE: Match the operator's latest message. English → English reply. Arabic → Arabic reply.",
        uiLocale === "ar" ? "UI locale is Arabic." : "UI locale is English.",
        "Always available: web_search, scrape_page, fetch_url for live research.",
        "Deliverables always available: preview_html (in-app preview), generate_pdf (reports), export_csv.",
        hasDesk
          ? "Local desk tools are enabled for the attached folder / Arrab desk."
          : "No PC folder yet — web research and PDF/HTML deliverables still work via Arrab desk when on desktop.",
        hint.operatorDirectives,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };

  const streamOnce = async (conversationId: string) => {
    let reply = "";
    let streamError: string | null = null;
    let pendingApproval: Approval | null = null;
    await arrabApi.sendMessageStream(
      conversationId,
      body,
      {
        onToken: (token) => {
          if (signal.aborted) return;
          reply += token;
          onToken(token);
        },
        onDone: (response) => {
          if (signal.aborted) return;
          if (!reply && response.assistantMessage?.content) {
            reply = response.assistantMessage.content;
            onToken(reply);
          }
          if (response.approval) {
            pendingApproval = response.approval;
            // Drop the “awaiting desktop execution” placeholder so the tool resume replaces it.
            if (
              !reply.trim() ||
              /awaiting (?:desktop )?execution|awaiting (?:your )?approval/i.test(reply)
            ) {
              reply = "";
              extras?.onReplyReset?.();
            }
          }
        },
        onApproval: (approval) => {
          pendingApproval = approval;
          if (
            !reply.trim() ||
            /awaiting (?:desktop )?execution|awaiting (?:your )?approval/i.test(reply)
          ) {
            reply = "";
            extras?.onReplyReset?.();
          }
        },
        onError: (message) => {
          streamError = message;
        },
      },
      signal,
    );
    signal.throwIfAborted();
    if (streamError) throw new Error(streamError);

    // Auto-run client tools (files, PDF, HTML preview) and resume until done.
    let guard = 0;
    while (pendingApproval && guard < 12) {
      guard += 1;
      signal.throwIfAborted();
      const continued = await runCompanionApproval(
        pendingApproval,
        deskFolder,
        extras?.onArtifact,
      );
      if (continued.reply) {
        if (reply) {
          reply = `${reply}\n\n${continued.reply}`;
          onToken(`\n\n${continued.reply}`);
        } else {
          reply = continued.reply;
          onToken(continued.reply);
        }
      }
      pendingApproval = continued.nextApproval;
    }

    return reply.trim();
  };

  try {
    return await streamOnce(ready.conversationId!);
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    if (isMissingConversationError(error)) {
      updateCompanion(ready.id, { conversationId: null });
      ready = await ensureCompanionAgent({ ...ready, conversationId: null }, signal);
      return await streamOnce(ready.conversationId!);
    }
    if (isSessionBudgetError(error)) {
      // Same chat — lift the old 5k cap and continue (body already requests null budget).
      return await streamOnce(ready.conversationId!);
    }
    // One network retry on the same conversation (stream → fallback already ran inside).
    if (error instanceof ApiRequestError && error.status === 0) {
      return await streamOnce(ready.conversationId!);
    }
    throw error;
  }
}

export function useCompanionRoom(active: CompanionProfile, sessionKey?: string) {
  const { t, locale } = useLanguage();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [drafts] = useState(createCompanionDraftStore);
  const [, refreshDraft] = useState(0);
  const [mode, setMode] = useState<ReplyMode>("open");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [providerReady, setProviderReady] = useState(true);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatusResponse | null>(null);
  const [suggestedSessionMode, setSuggestedSessionMode] = useState<SessionMode | null>(null);
  const requestRef = useRef<{ controller: AbortController; roomKey: string } | null>(null);
  const roomKey = sessionKey
    ? `${companionRoomKey(active)}:${sessionKey}`
    : companionRoomKey(active);
  const currentRoomRef = useRef(roomKey);
  currentRoomRef.current = roomKey;
  const draft = drafts.read(roomKey);
  // An explicit key lets navigation hand a draft to the destination before it renders.
  function setDraft(text: string | ((current: string) => string), targetRoomKey = roomKey) {
    const next = typeof text === "function" ? text(drafts.read(targetRoomKey)) : text;
    drafts.write(targetRoomKey, next);
    refreshDraft((version) => version + 1);
  }
  useEffect(() => {
    let cancelled = false;
    void arrabApi
      .aiStatus()
      .then((status) => {
        if (!cancelled) {
          setProviderReady(status.configured);
          setAiStatus(status);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  // Prefetch / refresh standing instructions so the first send is not blocked.
  useEffect(() => {
    const controller = new AbortController();
    void ensureCompanionAgent(active, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [
    active.id,
    active.brief,
    active.domain,
    active.tone.bluntness,
    active.tone.humour,
    active.tone.replyLength,
    active.callOut.join("|"),
    active.connectors.join("|"),
  ]);
  // Hydrate private parent guidance from the household API into local facts.
  useEffect(() => {
    let cancelled = false;
    void arrabApi
      .familyGuidanceForCompanion(active.id)
      .then((res) => {
        if (cancelled || !res.items?.length) return;
        const person = findCompanion(getCompanionState(), active.id) ?? active;
        const existing = new Set(
          visibleFacts(getCompanionState(), person)
            .filter((f) => f.kind === "parent_guidance")
            .map((f) => f.text.trim().toLowerCase()),
        );
        for (const note of res.items) {
          const text = note.content?.trim();
          if (!text || existing.has(text.toLowerCase())) continue;
          addParentGuidanceFact({
            companionId: active.id,
            text,
            authorName: note.authorName || "Parent",
          });
          existing.add(text.toLowerCase());
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active.id]);
  useEffect(() => {
    let cancelled = false;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setBusy(false);
    setLines([]);
    setError(null);
    setNotice("");
    setFailedDraft("");
    setMode("open");
    const cleanup = () => {
      cancelled = true;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
    if (!active.conversationId) {
      setLoading(false);
      return cleanup;
    }
    setLoading(true);
    void arrabApi
      .conversation(active.conversationId)
      .then((detail) => {
        if (cancelled) return;
        setLines(
          detail.messages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) => ({
              id: message.id,
              who: message.role === "user" ? "me" : "companion",
              companionId: message.role === "user" ? null : active.id,
              text: message.content.replace(
                /^(?:\[(?:They just want to vent|They want your take|This is sensitive)[\s\S]*?\]\n\n)+/,
                "",
              ),
              at: message.createdAt,
            })),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load conversation");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return cleanup;
    // General gains a backing conversation during send; only a room switch reloads history.
  }, [roomKey]);

  async function send(overrideText?: string, extras?: CompanionSendExtras) {
    const text = (overrideText ?? drafts.read(roomKey)).trim();
    if (!text || requestRef.current || loading) return null;
    const request = { controller: new AbortController(), roomKey };
    requestRef.current = request;
    const { signal } = request.controller;
    const isCurrent = () =>
      requestRef.current === request && currentRoomRef.current === roomKey && !signal.aborted;
    setBusy(true);
    setError(null);
    setNotice("");
    setFailedDraft("");
    setDraft("");
    const person = active.domain === "general" ? ensureGeneralCompanion(active.space) : active;
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), who: "me", companionId: null, text, at: new Date().toISOString() },
    ]);
    noteTopics(text);
    if (detectSensitive(text)) markSensitive();
    const framing =
      mode === "vent"
        ? "[They just want to vent. Listen and reflect it back. No advice, no tasks, no fixing.]\n\n"
        : mode === "take"
          ? "[They want your take. Be concrete and say what you would do.]\n\n"
          : "";
    const sessionFraming = sessionModePromptPrefix(readSessionMode());
    const sensitive = isSensitiveNow(getCompanionState())
      ? "[This is sensitive. No humour, no unsolicited advice, and no switching speakers.]\n\n"
      : "";
    const replyId = crypto.randomUUID();
    try {
      const rawReply = await ask(
        person,
        `${sessionFraming}${framing}${sensitive}${text}`,
        (token) => {
          if (!isCurrent()) return;
          setLines((current) =>
            current.some((line) => line.id === replyId)
              ? current.map((line) =>
                  line.id === replyId ? { ...line, text: line.text + token } : line,
                )
              : [
                  ...current,
                  {
                    id: replyId,
                    who: "companion",
                    companionId: person.id,
                    text: token,
                    at: new Date().toISOString(),
                  },
                ],
          );
        },
        signal,
        resolveCompanionModel(aiStatus, readPrefs()),
        {
          ...extras,
          onReplyReset: () => {
            if (!isCurrent()) return;
            setLines((current) =>
              current.map((line) => (line.id === replyId ? { ...line, text: "" } : line)),
            );
            extras?.onReplyReset?.();
          },
        },
      );
      if (!isCurrent()) return null;
      if (!rawReply)
        throw new Error(
          providerReady
            ? locale === "ar"
              ? "لم يصل رد. يمكنك استرجاع رسالتك والمحاولة مجددًا."
              : "No reply arrived. Restore your message and try again."
            : t("compProviderMissing"),
        );
      const { text: reply, suggested } = stripSuggestModeMarker(rawReply);
      if (suggested && suggested !== readSessionMode()) {
        setSuggestedSessionMode(suggested);
      }
      if (reply !== rawReply) {
        setLines((current) =>
          current.map((line) => (line.id === replyId ? { ...line, text: reply } : line)),
        );
      }
      if (reply) {
        recordExchange({ companionId: person.id, line: reply, resume: text });
        ingestBrainTurn({
          scope: "individual",
          space: person.space,
          companionId: person.id,
          companionName: person.name,
          conversationId: person.conversationId,
          userText: text,
          assistantText: reply,
        });
        const open =
          reply
            .split(/\n|(?<=[.!])\s/)
            .filter((part) => /[?؟]/.test(part))
            .at(-1)
            ?.trim() ?? null;
        touchThread({
          companionId: person.id,
          title: text.slice(0, 48),
          summary: reply.slice(0, 160),
          open,
          space: person.space,
        });
        const task = mode !== "vent" ? taskFromLine(text) : null;
        if (task) {
          captureWork({
            companionId: person.id,
            text: task,
            capturedFrom: person.name,
            space: person.space,
          });
          setNotice(
            locale === "ar"
              ? "وجدت التزامًا محتملًا. راجعه في العمل قبل إضافته."
              : "Found a possible commitment. Review it in Work before adding it.",
          );
        }
        const second = liveCompanions(getCompanionState(), person.space).find(
          (candidate) => candidate.id !== person.id && candidate.domain !== "general",
        );
        // Only decision tradeoffs get a second perspective, with one turn each.
        if (
          mode === "take" &&
          !sensitive &&
          second &&
          /\b(or|between|choose|decide)\b|أو|اختار|أختار|محتار|ولا /.test(text.toLowerCase())
        ) {
          const secondId = crypto.randomUUID();
          const perspective = await ask(
            second,
            `${text}\n\n${person.name}: ${reply}\n\nGive one short second perspective. Disagree only about priorities if useful, never invent a factual disagreement. End with one real question.`,
            (token) => {
              if (!isCurrent()) return;
              setLines((current) =>
                current.some((line) => line.id === secondId)
                  ? current.map((line) =>
                      line.id === secondId ? { ...line, text: line.text + token } : line,
                    )
                  : [
                      ...current,
                      {
                        id: secondId,
                        who: "companion",
                        companionId: second.id,
                        text: token,
                        at: new Date().toISOString(),
                        contributor: true,
                      },
                    ],
              );
            },
            signal,
            resolveCompanionModel(aiStatus, readPrefs()),
          );
          if (!isCurrent()) return null;
          if (perspective) recordExchange({ companionId: second.id, line: perspective });
        }
      }
      setFailedDraft("");
      return reply || null;
    } catch (err: unknown) {
      if (!isCurrent()) return null;
      if (isAbortError(err)) return null;
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
      setFailedDraft(text);
      return null;
    } finally {
      // A stopped/old request must not clear the busy state of a later send.
      if (isCurrent()) {
        requestRef.current = null;
        setBusy(false);
        setMode("open");
      }
    }
  }

  function stop() {
    const request = requestRef.current;
    if (!request || request.roomKey !== roomKey) return;
    requestRef.current = null;
    request.controller.abort();
    setBusy(false);
    setMode("open");
    setNotice(locale === "ar" ? "توقف استقبال الرد." : "Stopped receiving the reply.");
  }
  return {
    lines,
    draft,
    setDraft,
    mode,
    setMode,
    busy,
    loading,
    error,
    setError,
    failedDraft,
    notice,
    setNotice,
    providerReady,
    suggestedSessionMode,
    clearSuggestedSessionMode: () => setSuggestedSessionMode(null),
    send,
    stop,
  };
}
