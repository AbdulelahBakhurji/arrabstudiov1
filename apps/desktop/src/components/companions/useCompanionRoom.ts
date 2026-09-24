import { useEffect, useRef, useState } from "react";
import type { Approval, AiGatewayStatusResponse, WorkspaceHint } from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { assertCloudAiAllowed, resolveCompanionModel, hasLocalModelSelected } from "@/lib/ai-prefs";
import {
  assertTokensAvailable,
  enforceTokenGuard,
  subscribeTokenGuard,
} from "@/lib/token-guard";
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
import { ensureSkillCatalogWarm } from "@/lib/user-skills";
import { buildResolveApprovalBody } from "@/lib/resolve-approval";
import {
  applySpokenToneAdjustments,
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
  claimParentCoachConversation,
  type CompanionProfile,
  type CompanionRoomProfile,
} from "@/lib/companions";
import { purposeRegistryById, resolvePurposeIdFromDomain } from "@/lib/purpose-registry";
import { ingestBrainTurn } from "@/lib/second-brain";
import {
  applyGuardianToTurn,
  evaluateGuardianPreflight,
  guardianFramingForSend,
  shouldRunGuardian,
  type GuardianDecision,
} from "@/lib/guardian";
import {
  readSessionMode,
  sessionModePromptPrefix,
  stripSuggestModeMarker,
  type SessionMode,
} from "@/lib/session-mode";
import { friendlyToolTitle, type AgentStep } from "@/components/AgentSteps";


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
  onAgentSteps?: (updater: (current: AgentStep[]) => AgentStep[]) => void;
};
const TASK_HINTS = ["remind me", "i need to", "i have to", "don't forget", "لازم", "ذكرني"];

/** Short topic snippet for “Thinking about …” — Claude-style activity copy. */
export function companionActivityTopic(text: string, locale: "en" | "ar" = "en"): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return locale === "ar" ? "رسالتك" : "your message";
  const clipped = cleaned.length > 42 ? `${cleaned.slice(0, 42).trim()}…` : cleaned;
  return clipped;
}

function markThinkingDone(steps: AgentStep[]): AgentStep[] {
  return steps.map((step) =>
    (step.id === "thinking" ||
      step.id === "reading" ||
      step.id === "considering") &&
    step.status === "running"
      ? { ...step, status: "done" as const }
      : step,
  );
}

function finishRunningSteps(steps: AgentStep[]): AgentStep[] {
  return steps.map((step) =>
    step.status === "running" ? { ...step, status: "done" as const } : step,
  );
}

/** Model meta-refusal about its own instructions — not a real answer. */
function isInstructionRefusal(text: string): boolean {
  return /can(?:'|’)t follow requests to override or reveal (?:my |the )?safety instructions/i.test(
    text,
  );
}

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
  person: CompanionRoomProfile,
  signal: AbortSignal,
): Promise<CompanionRoomProfile> {
  signal.throwIfAborted();
  const parentCoach = Boolean(person.parentCoachLane);
  const key = `${person.id}:${person.space}:${parentCoach ? "parent" : "chat"}`;
  let inFlight = ensureLocks.get(key);
  if (!inFlight) {
    inFlight = (async () => {
      let ready: CompanionRoomProfile =
        findCompanion(getCompanionState(), person.id) ?? person;
      if (parentCoach) {
        ready = { ...claimParentCoachConversation(ready), parentCoachLane: true };
      }
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
      const laneId = parentCoach ? ready.parentConversationId : ready.conversationId;
      if (!laneId) {
        const conversation = await arrabApi.createConversation({
          agentId: ready.agentId!,
          title: parentCoach ? `${ready.name} · Parent` : ready.name,
          spend: companionSpendSettings(ready),
        });
        if (parentCoach) {
          updateCompanion(ready.id, { parentConversationId: conversation.id });
          ready = {
            ...ready,
            parentConversationId: conversation.id,
            conversationId: conversation.id,
            parentCoachLane: true,
          };
        } else {
          updateCompanion(ready.id, { conversationId: conversation.id });
          ready = { ...ready, conversationId: conversation.id, parentCoachLane: false };
        }
      } else {
        // Room always reads via conversationId; map the active lane onto it.
        ready = {
          ...ready,
          conversationId: laneId,
          parentCoachLane: parentCoach,
        };
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

/** Ensure agent + conversation exist so chat is stored on the signed-in account. */
export async function ensureCompanionCloudRoom(
  person: CompanionRoomProfile,
  signal?: AbortSignal,
): Promise<CompanionRoomProfile> {
  const controller = signal ? null : new AbortController();
  return ensureCompanionAgent(person, signal ?? controller!.signal);
}

async function persistLocalTurn(
  person: CompanionProfile,
  userText: string,
  assistantText: string,
  signal: AbortSignal,
): Promise<CompanionProfile> {
  try {
    const ready = await ensureCompanionAgent(person, signal);
    if (!ready.conversationId || !assistantText.trim()) return ready;
    await arrabApi.ingestConversationMessages(
      ready.conversationId,
      {
        messages: [
          { role: "user", content: userText },
          { role: "assistant", content: assistantText },
        ],
      },
      signal,
    );
    return ready;
  } catch {
    return person;
  }
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

const ensureLocks = new Map<string, Promise<CompanionRoomProfile>>();

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
  const result = await arrabApi.resolveApproval(
    approval.id,
    await buildResolveApprovalBody({
      status: "approved",
      approvalDetail: approval.detail,
      toolResult: toolResult ?? null,
    }),
  );
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
  const reportSteps = extras?.onAgentSteps;
  const prefs = readPrefs();
  if (hasLocalModelSelected(prefs)) {
    let ready = person;
    try {
      ready = await ensureCompanionAgent(person, signal);
    } catch {
      /* Guest / offline — still answer locally; sync when account is available. */
    }
    const facts = visibleFacts(getCompanionState(), ready);
    const notes = companionTurnNotes(ready, facts);
    const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
    const system = [
      companionInstructions(ready, facts, uiLocale),
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
    let sawToken = false;
    const reply = await streamOllamaChat(
      prefs.aiLocalModel.trim(),
      [
        { role: "system", content: system },
        { role: "user", content },
      ],
      (token) => {
        if (!sawToken) {
          sawToken = true;
          reportSteps?.((steps) => markThinkingDone(steps));
        }
        onToken(token);
      },
      signal,
      prefs.aiLocalBaseUrl,
    );
    if (reply?.trim()) {
      void persistLocalTurn(ready, content, reply, signal);
    }
    reportSteps?.((steps) => finishRunningSteps(steps));
    return reply;
  }

  assertCloudAiAllowed();
  assertTokensAvailable();

  let ready = await ensureCompanionAgent(person, signal);
  const facts = visibleFacts(getCompanionState(), ready);
  const notes = companionTurnNotes(ready, facts);
  const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
  const hint = extras?.workspaceHint ?? {};
  const isAssistant = person.domain === "arrab-assistant";
  const deskFolder = isAssistant
    ? await resolveDeskFolder(hint.folderPath ?? null)
    : hint.folderPath?.trim() || null;
  const hasDesk = Boolean(deskFolder);
  const body = {
    content,
    model: person.chatModel?.trim() || model,
    temperature: person.temperature ?? undefined,
    maxOutputTokens: person.maxTokens ?? undefined,
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
          ? "You are Arrab Assistant. Do the work with tools when a folder or connector is available."
          : "Stay in character. Prefer a short, direct reply.",
        "Match the language of the latest message.",
        uiLocale === "ar" ? "UI locale is Arabic." : "UI locale is English.",
        hasDesk ? "Local desk tools are enabled for the attached folder." : null,
        hint.operatorDirectives,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };

  const streamOnce = async (conversationId: string) => {
    let reply = "";
    let streamError: string | null = null;
    let pendingApproval: Approval | null = null;
    let sawToken = false;
    await arrabApi.sendMessageStream(
      conversationId,
      body,
      {
        onToken: (token) => {
          if (signal.aborted) return;
          if (!sawToken) {
            sawToken = true;
            reportSteps?.((steps) => markThinkingDone(steps));
          }
          reply += token;
          onToken(token);
        },
        onToolStart: (name, detail) => {
          if (signal.aborted) return;
          reportSteps?.((current) => [
            ...markThinkingDone(current),
            {
              id: `tool-run-${name}-${crypto.randomUUID()}`,
              title: friendlyToolTitle(name, detail),
              detail,
              status: "running",
            },
          ]);
        },
        onTool: (name, result) => {
          if (signal.aborted) return;
          const detail = result.slice(0, 2000);
          reportSteps?.((current) => {
            const runningIdx = [...current]
              .map((step, index) => ({ step, index }))
              .reverse()
              .find(
                ({ step }) =>
                  step.status === "running" &&
                  step.title === friendlyToolTitle(name, step.detail),
              )?.index;
            const done: AgentStep = {
              id: `tool-${crypto.randomUUID()}`,
              title: friendlyToolTitle(name, detail),
              detail,
              status: detail.toLowerCase().includes("fail") ? "failed" : "done",
            };
            if (runningIdx == null) {
              return [...markThinkingDone(current), done];
            }
            const copy = [...current];
            copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
            return copy;
          });
        },
        onDone: (response) => {
          if (signal.aborted) return;
          if (!reply && response.assistantMessage?.content) {
            reply = response.assistantMessage.content;
            onToken(reply);
          }
          if (response.toolsUsed?.length) {
            reportSteps?.((current) => {
              const titles = new Set(current.map((step) => step.title.toLowerCase()));
              const extrasTools = response.toolsUsed!.filter((name) => {
                const friendly = friendlyToolTitle(name).toLowerCase();
                return !titles.has(friendly) && !titles.has(name.replace(/_/g, " "));
              });
              const base = finishRunningSteps(markThinkingDone(current));
              if (extrasTools.length === 0) return base;
              return [
                ...base,
                ...extrasTools.map((name) => ({
                  id: `tool-${crypto.randomUUID()}`,
                  title: friendlyToolTitle(name),
                  status: "done" as const,
                })),
              ];
            });
          } else {
            reportSteps?.((steps) => finishRunningSteps(markThinkingDone(steps)));
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
          const toolName =
            parseToolNameFromApproval(approval.detail, approval.title) ?? "tool";
          reportSteps?.((current) => [
            ...finishRunningSteps(markThinkingDone(current)),
            {
              id: `tool-run-${toolName}-${crypto.randomUUID()}`,
              title: friendlyToolTitle(toolName, approval.detail ?? undefined),
              detail: approval.detail ?? undefined,
              status: "running",
            },
          ]);
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
          reportSteps?.((steps) =>
            steps.map((step) =>
              step.status === "running" ? { ...step, status: "failed" as const } : step,
            ),
          );
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
      const approval = pendingApproval;
      const toolName =
        parseToolNameFromApproval(approval.detail, approval.title) ?? "tool";
      reportSteps?.((current) => {
        const hasRunning = current.some(
          (step) =>
            step.status === "running" &&
            step.title === friendlyToolTitle(toolName, approval.detail ?? undefined),
        );
        if (hasRunning) return current;
        return [
          ...finishRunningSteps(markThinkingDone(current)),
          {
            id: `tool-run-${toolName}-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, approval.detail ?? undefined),
            detail: approval.detail ?? undefined,
            status: "running",
          },
        ];
      });
      const continued = await runCompanionApproval(
        approval,
        deskFolder,
        extras?.onArtifact,
      );
      reportSteps?.((current) => {
        const runningIdx = [...current]
          .map((step, index) => ({ step, index }))
          .reverse()
          .find(
            ({ step }) =>
              step.status === "running" &&
              step.title === friendlyToolTitle(toolName, approval.detail ?? undefined),
          )?.index;
        if (runningIdx == null) return finishRunningSteps(current);
        const copy = [...current];
        copy[runningIdx] = {
          ...copy[runningIdx]!,
          status: "done",
          title: friendlyToolTitle(toolName, approval.detail ?? undefined),
        };
        return copy;
      });
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

    reportSteps?.((steps) => finishRunningSteps(steps));
    return reply.trim();
  };

  try {
    return await streamOnce(ready.conversationId!);
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    if (isMissingConversationError(error)) {
      if (ready.parentCoachLane) {
        updateCompanion(ready.id, { parentConversationId: null });
        ready = await ensureCompanionAgent(
          { ...ready, conversationId: null, parentConversationId: null },
          signal,
        );
      } else {
        updateCompanion(ready.id, { conversationId: null });
        ready = await ensureCompanionAgent({ ...ready, conversationId: null }, signal);
      }
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

export function useCompanionRoom(active: CompanionRoomProfile, sessionKey?: string) {
  const { t, locale } = useLanguage();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [drafts] = useState(createCompanionDraftStore);
  const [, refreshDraft] = useState(0);
  const [mode, setMode] = useState<ReplyMode>("open");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [thinkingLabel, setThinkingLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [providerReady, setProviderReady] = useState(true);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatusResponse | null>(null);
  const [suggestedSessionMode, setSuggestedSessionMode] = useState<SessionMode | null>(null);
  const [lastGuardianDecision, setLastGuardianDecision] = useState<GuardianDecision | null>(null);
  const requestRef = useRef<{ controller: AbortController; roomKey: string } | null>(null);
  const roomKey = sessionKey
    ? `${companionRoomKey(active)}:${sessionKey}:${active.parentCoachLane ? "parent" : "chat"}`
    : `${companionRoomKey(active)}:${active.parentCoachLane ? "parent" : "chat"}`;
  const currentRoomRef = useRef(roomKey);
  currentRoomRef.current = roomKey;

  useEffect(() => {
    void ensureSkillCatalogWarm().catch(() => []);
  }, []);

  useEffect(() => {
    return subscribeTokenGuard((detail) => {
      const request = requestRef.current;
      if (request) {
        requestRef.current = null;
        request.controller.abort();
      }
      setBusy(false);
      setMode("open");
      setAgentSteps((steps) =>
        steps.map((step) =>
          step.status === "running" ? { ...step, status: "failed" as const } : step,
        ),
      );
      setError(detail.message);
      setNotice(
        detail.kind === "quota"
          ? locale === "ar"
            ? "انتهت حصة الرموز — توقّف العمل مؤقتاً."
            : "Token limit finished — work stopped and paused."
          : locale === "ar"
            ? "انتهت ميزانية الجلسة — توقّف الرد."
            : "Session budget finished — reply stopped.",
      );
    });
  }, [locale]);

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
    active.parentCoachLane,
    active.parentConversationId,
    active.tone.bluntness,
    active.tone.humour,
    active.tone.replyLength,
    active.tone.warmth,
    active.tone.formality,
    active.tone.criticism,
    active.tone.pace,
    active.toneNote,
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
    setAgentSteps([]);
    setThinkingLabel("");
    setMode("open");
    const cleanup = () => {
      cancelled = true;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
    setLastGuardianDecision(null);
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
    const localeKey = locale === "ar" ? "ar" : "en";
    const topic = companionActivityTopic(text, localeKey);
    setThinkingLabel(
      localeKey === "ar" ? `يفكر في ${topic}…` : `Thinking about ${topic}…`,
    );
    setAgentSteps([
      { id: "reading", title: localeKey === "ar" ? "يقرأ رسالتك" : "Reading your message", status: "running" },
    ]);
    let person = active.domain === "general" ? ensureGeneralCompanion(active.space) : active;
    if (applySpokenToneAdjustments(person.id, text)) {
      person = findCompanion(getCompanionState(), person.id) ?? person;
      setNotice(
        localeKey === "ar"
          ? "تم ضبط النبرة من رسالتك — الرد التالي يستخدم الأسلوب الجديد."
          : "Tone updated from your message — the next reply uses the new voice.",
      );
    }
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), who: "me", companionId: null, text, at: new Date().toISOString() },
    ]);
    noteTopics(text);
    if (detectSensitive(text)) markSensitive();
    const framing =
      mode === "vent"
        ? "They want to vent. Listen and reflect it back. No advice, no tasks, no fixing."
        : mode === "take"
          ? "They want your take. Be concrete and say what you would do."
          : "";
    const sessionFraming = sessionModePromptPrefix(readSessionMode());
    const sensitive = isSensitiveNow(getCompanionState())
      ? "This is sensitive. No humour, no unsolicited advice, and no switching speakers."
      : "";
    const guardianFraming = guardianFramingForSend(person, localeKey);
    const turnNotes = [guardianFraming, sessionFraming, framing, sensitive].filter(Boolean).join("\n");
    const replyId = crypto.randomUUID();
    const progressTimers: number[] = [];
    progressTimers.push(
      window.setTimeout(() => {
        if (!isCurrent()) return;
        setAgentSteps((current) => {
          if (current.some((step) => step.id !== "reading" && step.status === "running")) {
            return current;
          }
          if (current.some((step) => step.id === "thinking")) return current;
          return [
            ...current.map((step) =>
              step.id === "reading" ? { ...step, status: "done" as const } : step,
            ),
            { id: "thinking", title: "thinking", status: "running" },
          ];
        });
      }, 450),
    );
    progressTimers.push(
      window.setTimeout(() => {
        if (!isCurrent()) return;
        setAgentSteps((current) => {
          const onlyThinking =
            current.some((step) => step.id === "thinking" && step.status === "running") &&
            !current.some((step) => step.status === "running" && step.id !== "thinking");
          if (!onlyThinking) return current;
          return [
            ...current.map((step) =>
              step.id === "thinking" && step.status === "running"
                ? { ...step, status: "done" as const }
                : step,
            ),
            {
              id: "considering",
              title:
                localeKey === "ar" ? "يراجع التفاصيل" : "Considering the details",
              status: "running",
            },
          ];
        });
      }, 2200),
    );
    try {
      // Phase 3: hard safety + quiet hours cut before any LLM tokens.
      let preflight: GuardianDecision | null = null;
      if (shouldRunGuardian(person)) {
        preflight = evaluateGuardianPreflight({
          kidMessage: text,
          companion: person,
          locale: localeKey,
        });
        if (
          preflight &&
          preflight.verdict !== "allow" &&
          (preflight.hard ||
            preflight.verdict === "pause_with_care" ||
            preflight.ruleIds.includes("downtime"))
        ) {
          const guarded = applyGuardianToTurn({
            companion: person,
            kidMessage: text,
            companionDraft: preflight.modifiedReply || "",
            locale: localeKey,
            preflight,
          });
          const reply = guarded.reply || preflight.modifiedReply || "";
          setLastGuardianDecision(guarded.decision);
          if (reply) {
            setLines((current) => [
              ...current,
              {
                id: replyId,
                who: "companion",
                companionId: person.id,
                text: reply,
                at: new Date().toISOString(),
              },
            ]);
            recordExchange({ companionId: person.id, line: reply, resume: text });
            void persistLocalTurn(person, text, reply, signal);
            ingestBrainTurn({
              scope: "individual",
              space: person.space,
              companionId: person.id,
              companionName: person.name,
              conversationId: person.conversationId,
              userText: text,
              assistantText: reply,
            });
          }
          setFailedDraft("");
          return reply || null;
        }
      }

      const rawReply = await ask(
        person,
        text,
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
          workspaceHint: {
            ...extras?.workspaceHint,
            operatorDirectives: [turnNotes, extras?.workspaceHint?.operatorDirectives]
              .filter(Boolean)
              .join("\n"),
          },
          onAgentSteps: (updater) => {
            if (!isCurrent()) return;
            setAgentSteps(updater);
            extras?.onAgentSteps?.(updater);
          },
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
      const cleanedReply = isInstructionRefusal(rawReply)
        ? localeKey === "ar"
          ? "ما وصلت إجابة مفيدة. أعد الطلب بجملة عادية وسأساعدك."
          : "I didn't get a usable answer. Say it again in a normal sentence and I'll help."
        : rawReply;
      const { text: stripped, suggested } = stripSuggestModeMarker(cleanedReply);
      if (suggested && suggested !== readSessionMode()) {
        setSuggestedSessionMode(suggested);
      }
      let reply = stripped;
      if (shouldRunGuardian(person)) {
        const guarded = applyGuardianToTurn({
          companion: person,
          kidMessage: text,
          companionDraft: stripped,
          locale: localeKey,
          preflight,
        });
        reply = guarded.reply;
        setLastGuardianDecision(guarded.decision);
      } else {
        setLastGuardianDecision(null);
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
      const guarded = enforceTokenGuard(err);
      if (guarded) {
        request.controller.abort();
        setBusy(false);
        setMode("open");
        setError(guarded);
        setFailedDraft(text);
        setNotice(
          locale === "ar"
            ? "انتهت الرموز — توقّف العمل مؤقتاً."
            : "Tokens finished — work stopped and paused.",
        );
        return null;
      }
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
      setFailedDraft(text);
      return null;
    } finally {
      for (const timer of progressTimers) window.clearTimeout(timer);
      // A stopped/old request must not clear the busy state of a later send.
      if (isCurrent()) {
        requestRef.current = null;
        setBusy(false);
        setMode("open");
        setAgentSteps((steps) => finishRunningSteps(steps));
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
    setAgentSteps((steps) =>
      steps.map((step) =>
        step.status === "running" ? { ...step, status: "failed" as const } : step,
      ),
    );
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
    agentSteps,
    thinkingLabel,
    error,
    setError,
    failedDraft,
    notice,
    setNotice,
    providerReady,
    suggestedSessionMode,
    clearSuggestedSessionMode: () => setSuggestedSessionMode(null),
    lastGuardianDecision,
    clearGuardianDecision: () => setLastGuardianDecision(null),
    send,
    stop,
  };
}
