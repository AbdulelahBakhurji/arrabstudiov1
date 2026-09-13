/**
 * Companions — the individual half of the studio.
 *
 * Organizations run a workforce. Individuals keep a few people who remember
 * things: a room per companion, one voice answering at a time, and everything
 * they know about you sitting in the open where you can delete it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Clock, PanelRight, Plus, Trash2, Users, X } from "lucide-react";
import { Surface } from "@/components/StudioFrame";
import { CompanionDot, CompanionFace } from "@/components/companions/CompanionFace";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi } from "@/lib/api";
import {
  CALL_OUT_TOPICS,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  TONE_PRESETS,
  WEEKLY_NUDGE_CEILING,
  addCompanion,
  addFact,
  answerNudge,
  birthSuggestion,
  captureWork,
  companionInstructions,
  deleteFact,
  dismissBirth,
  exportEverything,
  findCompanion,
  forgetEverything,
  formatSlot,
  ignoreNudge,
  isSensitiveNow,
  liveCompanions,
  liveNudges,
  markSensitive,
  needsTaskOrThought,
  nudgeBudgetLeft,
  postponeWork,
  recordExchange,
  relativeTime,
  removeCompanion,
  resetCompanionTone,
  setCompanionTone,
  setFactShared,
  setPermission,
  setThreadArchived,
  setWorkState,
  suggestedWork,
  toggleCallOut,
  touchThread,
  updateCompanion,
  useCompanionState,
  visibleFacts,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionToneName,
  type PermissionKey,
  detectSensitive,
  noteTopics,
  getCompanionState,
  acceptedWork,
} from "@/lib/companions";
import { cn } from "@/lib/utils";

type ChatLine = {
  id: string;
  who: "me" | "companion";
  companionId: string | null;
  text: string;
  at: string;
  /** Second voice in a two-voice round — faint ring, never the main answer. */
  contributor?: boolean;
  /** The one question worth answering, pulled out of the closing line. */
  realQuestion?: string;
};

type ReplyMode = "open" | "vent" | "take";
type SidePanel = "knows" | "tone" | "work" | "threads";

/** Phrases that look like something to do, not something to say. */
const TASK_HINTS = ["remind me", "i need to", "i have to", "don't forget", "لازم", "ذكرني"];

/**
 * Pull the doable part out of a sentence, so "I need to renew my passport
 * before the trip, and I keep overspending" captures the passport, not the rant.
 */
function taskFromLine(text: string): string | null {
  const lower = text.toLowerCase();
  const hint = TASK_HINTS.find((phrase) => lower.includes(phrase));
  if (!hint) return null;
  const rest = text.slice(lower.indexOf(hint) + hint.length).trim();
  const clause = rest.split(/,| and | but |[.؟?!]|\bو\b/)[0]?.trim() ?? "";
  return clause.length > 2 ? clause : null;
}

function lastQuestion(text: string): string | null {
  const sentences = text.split(/(?<=[?.!؟])\s+/).filter(Boolean);
  const question = [...sentences].reverse().find((line) => /[?؟]\s*$/.test(line.trim()));
  return question?.trim() ?? null;
}

export function CompanionsPage() {
  const { t, locale, dir } = useLanguage();
  const state = useCompanionState();
  const [space, setSpace] = useState<CompanionSpace>("personal");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<SidePanel>("knows");
  const [contextOpen, setContextOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1280,
  );
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ReplyMode>("open");
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newTone, setNewTone] = useState<CompanionToneName>("measured");
  const [factDraft, setFactDraft] = useState("");
  const [providerReady, setProviderReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef<string | null>(null);

  const people = useMemo(() => liveCompanions(state, space), [state, space]);
  const active = useMemo(
    () => findCompanion(state, activeId) ?? people[0] ?? null,
    [state, activeId, people],
  );
  const facts = useMemo(() => visibleFacts(state, active), [state, active]);
  const birth = useMemo(() => birthSuggestion(state), [state]);
  const nudge = useMemo(
    () => liveNudges(state, space).find((item) => item.companionId === active?.id) ?? null,
    [state, space, active],
  );
  const budgetLeft = nudgeBudgetLeft(state);
  const sensitive = isSensitiveNow(state);

  useEffect(() => {
    void arrabApi
      .aiStatus()
      .then((status) => setProviderReady(status.configured))
      .catch(() => setProviderReady(true));
  }, []);

  // The board hands us a companion when you open a card.
  useEffect(() => {
    const focus = sessionStorage.getItem(COMPANION_FOCUS_KEY);
    if (focus) {
      sessionStorage.removeItem(COMPANION_FOCUS_KEY);
      const person = findCompanion(getCompanionState(), focus);
      if (person) {
        setSpace(person.space);
        setActiveId(person.id);
      }
    }
    const carried = sessionStorage.getItem(COMPANION_DRAFT_KEY);
    if (carried) {
      sessionStorage.removeItem(COMPANION_DRAFT_KEY);
      setDraft(carried);
    }
  }, []);

  const loadRoom = useCallback(async (person: CompanionProfile) => {
    if (!person.conversationId) {
      setLines([]);
      return;
    }
    try {
      const detail = await arrabApi.conversation(person.conversationId);
      setLines(
        detail.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            id: message.id,
            who: message.role === "user" ? ("me" as const) : ("companion" as const),
            companionId: message.role === "user" ? null : person.id,
            text: message.content,
            at: message.createdAt,
          })),
      );
    } catch {
      setLines([]);
    }
  }, []);

  // Reload only when the room itself changes, not on every state tick.
  useEffect(() => {
    if (!active) {
      setLines([]);
      loadedRef.current = null;
      return;
    }
    if (loadedRef.current === active.id) return;
    loadedRef.current = active.id;
    void loadRoom(active);
  }, [active, loadRoom]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, busy]);

  /** Keep the backing agent's standing instructions honest after any change. */
  const syncAgent = useCallback((companionId: string) => {
    const fresh = getCompanionState();
    const person = findCompanion(fresh, companionId);
    if (!person?.agentId) return;
    void arrabApi
      .updateAgent(person.agentId, {
        instructions: companionInstructions(person, visibleFacts(fresh, person)),
      })
      .catch(() => undefined);
  }, []);

  /** A companion only gets a real agent and thread once you actually speak. */
  const ensureBacking = useCallback(
    async (person: CompanionProfile): Promise<CompanionProfile> => {
      let agentId = person.agentId;
      if (!agentId) {
        const agent = await arrabApi.createAgent({
          name: person.name,
          role: person.domain,
          specialty: person.domain,
          instructions: companionInstructions(person, visibleFacts(getCompanionState(), person)),
          status: "active",
        });
        agentId = agent.id;
        updateCompanion(person.id, { agentId });
      }
      let conversationId = person.conversationId;
      if (!conversationId) {
        const conversation = await arrabApi.createConversation({
          agentId,
          title: person.name,
        });
        conversationId = conversation.id;
        updateCompanion(person.id, { conversationId });
      }
      return { ...person, agentId, conversationId };
    },
    [],
  );

  const askCompanion = useCallback(
    async (person: CompanionProfile, content: string): Promise<string> => {
      const ready = await ensureBacking(person);
      if (!ready.conversationId) return "";
      let reply = "";
      await arrabApi.sendMessageStream(
        ready.conversationId,
        { content },
        {
          onToken: (text) => {
            reply += text;
          },
        },
      );
      return reply.trim();
    },
    [ensureBacking],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !active || busy) return;
    setError(null);
    setDraft("");
    setBusy(true);

    const localId = crypto.randomUUID();
    setLines((current) => [
      ...current,
      { id: localId, who: "me", companionId: null, text, at: new Date().toISOString() },
    ]);

    noteTopics(text);
    if (detectSensitive(text)) {
      markSensitive();
    }
    const task = taskFromLine(text);
    if (task) {
      captureWork({
        companionId: active.id,
        text: task,
        capturedFrom: active.name,
        space: active.space,
      });
    }

    const framing =
      mode === "vent"
        ? "[They just want to vent. Listen and reflect it back. No advice, no tasks, no fixing.]\n\n"
        : mode === "take"
          ? "[They want your take. Be concrete and say what you would do.]\n\n"
          : "";

    try {
      const reply = await askCompanion(active, `${framing}${text}`);
      if (reply) {
        setLines((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            who: "companion",
            companionId: active.id,
            text: reply,
            at: new Date().toISOString(),
          },
        ]);
        recordExchange({
          companionId: active.id,
          line: reply,
          resume: text,
        });
        touchThread({
          companionId: active.id,
          title: text.slice(0, 48),
          summary: reply.slice(0, 160),
          open: lastQuestion(reply),
          space: active.space,
        });
      }

      // Two voices, one round each — only when a decision is on the table.
      const second = people.find((person) => person.id !== active.id) ?? null;
      if (mode === "take" && second && reply) {
        const secondReply = await askCompanion(
          second,
          `${text}\n\n${active.name} said: ${reply}\n\nGive your own take in two lines. Disagree if you genuinely disagree about what matters most here — not about facts. End with the single real question they should answer.`,
        );
        if (secondReply) {
          setLines((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              who: "companion",
              companionId: second.id,
              text: secondReply,
              at: new Date().toISOString(),
              contributor: true,
              realQuestion: lastQuestion(secondReply) ?? undefined,
            },
          ]);
          recordExchange({ companionId: second.id, line: secondReply });
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
      setMode("open");
    }
  }, [active, askCompanion, busy, draft, mode, people, t]);

  function createCompanion(domain: string, tone: CompanionToneName, name?: string) {
    const person = addCompanion({
      name: (name || "").trim() || domain.charAt(0).toUpperCase() + domain.slice(1),
      domain,
      space,
      toneName: tone,
    });
    // Born from something real, so it never starts empty.
    addFact({
      companionId: person.id,
      text: `Watches ${domain}`,
      source: t("compBornBody"),
      kind: "inferred",
      space,
    });
    setActiveId(person.id);
    setAdding(false);
    setNewName("");
    setNewDomain("");
    return person;
  }

  const openThreads = state.threads.filter(
    (thread) => thread.space === space && !thread.archived,
  );
  const archivedThreads = state.threads.filter(
    (thread) => thread.space === space && thread.archived,
  );

  return (
    <Surface className="companion-shell">
      <div className="companion-atmosphere absolute inset-0 -z-10 rounded-[28px]" />
      <div className="relative flex h-full min-h-0 gap-3 p-1">
        {/* ---------------------------------------------------------------- */}
        {/* Circles — the full list, with the last line and when it landed.   */}
        {/* ---------------------------------------------------------------- */}
        <aside className="companion-panel companion-rise hidden w-[264px] shrink-0 flex-col overflow-hidden lg:flex">
          <div className="border-b border-white/8 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
              {space === "personal" ? t("compSpacePersonal") : t("compSpaceWork")}
            </p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-neutral-600">
              {space === "personal" ? t("compSpaceHintPersonal") : t("compSpaceHintWork")}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {people.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-neutral-600">
                {t("compNoCompanions")}
              </p>
            ) : null}
            <ul className="space-y-1">
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(person.id)}
                    className={cn(
                      "companion-row flex w-full items-center gap-3 px-2.5 py-2.5 text-start",
                      active?.id === person.id && "is-on",
                    )}
                  >
                    <CompanionFace
                      name={person.name}
                      hue={person.hue}
                      seed={person.faceSeed}
                      size="md"
                      state={active?.id === person.id ? "lit" : "quiet"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13.5px] text-white">{person.name}</span>
                        <CompanionDot hue={person.hue} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-neutral-500">
                        {person.lastLine ?? person.domain}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10.5px] text-neutral-600">
                      {relativeTime(person.lastAt, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

          </div>

          <div className="border-t border-white/8 p-2">
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 py-2.5 text-[12.5px] text-neutral-400 hover:border-white/20 hover:text-white"
              >
                <Plus className="size-3.5" strokeWidth={1.8} />
                {t("compAddCompanion")}
              </button>
            ) : (
              <div className="space-y-2 p-1">
                <input
                  value={newDomain}
                  onChange={(event) => setNewDomain(event.target.value)}
                  placeholder={t("compWatches")}
                  className="field !h-9 !rounded-xl !text-[12.5px]"
                />
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={t("compNameOptional")}
                  className="field !h-9 !rounded-xl !text-[12.5px]"
                />
                <div className="flex gap-1.5">
                  {(["direct", "measured"] as const).map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => setNewTone(tone)}
                      className={cn("companion-chip flex-1 justify-center", newTone === tone && "is-on")}
                    >
                      {tone === "direct" ? t("compBornDirect") : t("compBornMeasured")}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!newDomain.trim()}
                    onClick={() => createCompanion(newDomain.trim(), newTone, newName)}
                    className="home-btn-primary h-8 flex-1 text-[12px] disabled:opacity-40"
                  >
                    {t("compAdd")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="home-btn-secondary h-8 flex-1 text-[12px]"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* The room                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section className="companion-panel companion-rise companion-rise-1 flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-white/8 px-5 py-3.5">
            <div className="flex items-end justify-between gap-4">
              <div className="companion-facerow flex items-end gap-4 overflow-x-auto pb-1">
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => setActiveId(person.id)}
                    className="group flex w-[62px] shrink-0 flex-col items-center gap-1.5"
                  >
                    <CompanionFace
                      name={person.name}
                      hue={person.hue}
                      seed={person.faceSeed}
                      size="lg"
                      state={active?.id === person.id ? "speaking" : "quiet"}
                    />
                    <span className="w-full truncate text-center text-[11px] text-neutral-300">
                      {person.name}
                    </span>
                    {person.lastMemory ? (
                      <span className="w-full truncate text-center text-[10px] text-neutral-600">
                        {person.lastMemory}
                      </span>
                    ) : null}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex size-[56px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/15 text-neutral-500 hover:border-white/30 hover:text-white"
                  aria-label={t("compAddCompanion")}
                >
                  <Plus className="size-4" strokeWidth={1.8} />
                </button>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 rounded-2xl bg-white/[0.04] p-1">
                    {(["personal", "work"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSpace(key);
                          setActiveId(null);
                        }}
                        className={cn(
                          "rounded-xl px-3 py-1 text-[11.5px] transition-colors",
                          space === key
                            ? "bg-white text-black"
                            : "text-neutral-400 hover:text-neutral-200",
                        )}
                      >
                        {key === "personal" ? t("compSpacePersonal") : t("compSpaceWork")}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setContextOpen((open) => !open)}
                    aria-label={t("compKnows")}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-xl border border-white/10 text-neutral-400 hover:text-white",
                      contextOpen && "bg-white/10 text-white",
                    )}
                  >
                    <PanelRight className="size-4" strokeWidth={1.7} />
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  {budgetLeft > 0
                    ? t("compNudgeBudget")
                        .replace("{left}", String(budgetLeft))
                        .replace("{total}", String(WEEKLY_NUDGE_CEILING))
                    : t("compNudgeNone")}
                </p>
                {sensitive ? (
                  <p className="text-[11px] companion-warn">{t("compNudgeSilenced")}</p>
                ) : (
                  <p className="text-[10.5px] text-neutral-600">{t("compTapToChange")}</p>
                )}
              </div>
            </div>
          </header>

          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <h2 className="text-[20px] font-medium text-white">{t("compDayOneTitle")}</h2>
              <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-neutral-500">
                {t("compDayOneBody")}
              </p>
              <button
                type="button"
                onClick={() => createCompanion(t("compGeneral").toLowerCase(), "measured", t("compGeneral"))}
                className="home-btn-primary mt-6 h-10 px-5 text-[13px]"
              >
                {t("compAddCompanion")}
              </button>
            </div>
          ) : (
            <>
              {active.resume ? (
                <div className="border-b border-white/6 px-5 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">
                    {t("compResume")}
                  </p>
                  <p className="mt-1 truncate text-[13px] text-neutral-300">{active.resume}</p>
                </div>
              ) : null}

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {lines.length === 0 && !busy ? (
                  <div className="flex flex-col items-start gap-2 pt-6">
                    <p className="text-[13px] text-neutral-500">{t("compDayOneBody")}</p>
                    {[t("compExampleSummarise"), t("compExampleLongDay")].map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setDraft(example)}
                        className="companion-chip"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                ) : null}

                {lines.map((line) => {
                  const speaker = findCompanion(state, line.companionId);
                  if (line.who === "me") {
                    return (
                      <div key={line.id} className="flex justify-end">
                        <div className="companion-bubble companion-bubble-me max-w-[70%] whitespace-pre-wrap">
                          {line.text}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={line.id} className="flex items-start gap-3">
                      {speaker ? (
                        <CompanionFace
                          name={speaker.name}
                          hue={speaker.hue}
                          seed={speaker.faceSeed}
                          size="md"
                          state={line.contributor ? "contributing" : "speaking"}
                        />
                      ) : null}
                      <div className="min-w-0 max-w-[76%]">
                        <p className="mb-1 flex items-center gap-2 text-[11px] text-neutral-500">
                          {speaker?.name}
                          {line.contributor ? (
                            <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-600">
                              {t("compTwoVoices")}
                            </span>
                          ) : null}
                        </p>
                        <div className="companion-bubble whitespace-pre-wrap">{line.text}</div>
                        {line.realQuestion ? (
                          <div className="companion-card-gold mt-2 rounded-[18px] px-4 py-3">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70">
                              {t("compRealQuestion")}
                            </p>
                            <p className="mt-1 text-[13.5px] text-amber-50">{line.realQuestion}</p>
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              addFact({
                                companionId: speaker?.id ?? null,
                                text: line.text.slice(0, 120),
                                source: `${t("compFactExplicit")} · ${speaker?.name ?? ""}`,
                                kind: "explicit",
                                space,
                              });
                              if (speaker) syncAgent(speaker.id);
                            }}
                            className="text-[11px] text-neutral-500 hover:text-white"
                          >
                            {t("compRemember")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              captureWork({
                                companionId: speaker?.id ?? null,
                                text: line.text.slice(0, 80),
                                capturedFrom: speaker?.name ?? "",
                                space,
                              })
                            }
                            className="text-[11px] text-neutral-500 hover:text-white"
                          >
                            {t("compCapture")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {busy ? (
                  <div className="flex items-center gap-3">
                    <CompanionFace
                      name={active.name}
                      hue={active.hue}
                      seed={active.faceSeed}
                      size="md"
                      state="speaking"
                    />
                    <span className="cowork-thinking flex gap-1">
                      <i className="block size-1.5 rounded-full bg-white/50" />
                      <i className="block size-1.5 rounded-full bg-white/50" />
                      <i className="block size-1.5 rounded-full bg-white/50" />
                    </span>
                  </div>
                ) : null}
              </div>

              {/* A companion is born — offered where the repetition happened. */}
              {birth ? (
                <div className="companion-rise mx-5 mb-2 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[13.5px] leading-relaxed text-neutral-100">
                    {t("compBornTitle").replace("{topic}", birth.domain)}
                  </p>
                  <p className="mt-1 text-[12px] text-neutral-500">{t("compBornBody")}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(["direct", "measured"] as const).map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => setNewTone(tone)}
                        className={cn(
                          "rounded-2xl border px-3 py-2.5 text-start transition-colors",
                          newTone === tone
                            ? "border-white/25 bg-white/[0.06]"
                            : "border-white/10 hover:bg-white/[0.03]",
                        )}
                      >
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                          {tone === "direct" ? t("compBornDirect") : t("compBornMeasured")}
                        </span>
                        {/* Tone is shown by example, never described. */}
                        <span className="mt-1 block text-[12px] leading-snug text-neutral-300">
                          {tone === "direct"
                            ? t("compBornDirectExample")
                            : t("compBornMeasuredExample")}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => createCompanion(birth.domain, newTone)}
                      className="home-btn-primary h-8 px-4 text-[12px]"
                    >
                      {t("compBornAdd")}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissBirth(birth.domain)}
                      className="home-btn-secondary h-8 px-4 text-[12px]"
                    >
                      {t("compBornNo")}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Reaching out — three levels, never more than the week allows. */}
              {nudge ? (
                <div className="px-5 pb-2">
                  {nudge.level === "whisper" ? (
                    <p className="flex items-center gap-2 text-[12px] text-neutral-600">
                      {nudge.text}
                      <span className="text-[10.5px]">
                        {t("compNudgeFrom").replace("{source}", nudge.source)}
                      </span>
                      <button
                        type="button"
                        onClick={() => ignoreNudge(nudge.id)}
                        className="ms-auto text-neutral-700 hover:text-neutral-400"
                        aria-label={t("compDismiss")}
                      >
                        <X className="size-3" strokeWidth={1.8} />
                      </button>
                    </p>
                  ) : (
                    <div
                      className={cn(
                        "rounded-[20px] px-4 py-3",
                        nudge.level === "critical"
                          ? "companion-card-gold"
                          : "border border-white/10 bg-white/[0.03]",
                      )}
                    >
                      <p className="text-[13px] text-neutral-100">{nudge.text}</p>
                      <p className="mt-1 text-[10.5px] text-neutral-500">
                        {t("compNudgeFrom").replace("{source}", nudge.source)}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {(nudge.answers ?? ["OK", t("compPostpone")]).map((answer) => (
                          <button
                            key={answer}
                            type="button"
                            onClick={() => {
                              answerNudge(nudge.id);
                              setDraft(answer);
                            }}
                            className="companion-chip"
                          >
                            {answer}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => ignoreNudge(nudge.id)}
                          className="companion-chip"
                        >
                          {t("compDismiss")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="border-t border-white/8 p-4">
                {!providerReady ? (
                  <p className="mb-2 text-[11.5px] companion-warn">{t("compProviderMissing")}</p>
                ) : null}
                {error ? <p className="mb-2 text-[11.5px] text-red-300/90">{error}</p> : null}

                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMode(mode === "vent" ? "open" : "vent")}
                    className={cn("companion-chip", mode === "vent" && "is-on")}
                  >
                    {t("compVent")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(mode === "take" ? "open" : "take")}
                    className={cn("companion-chip", mode === "take" && "is-on")}
                  >
                    {t("compTake")}
                  </button>
                  {mode === "vent" ? (
                    <span className="text-[11px] text-neutral-600">{t("compVentReply")}</span>
                  ) : null}
                  {mode === "take" && people.length > 1 ? (
                    <span className="text-[11px] text-neutral-600">{t("compTwoVoicesHint")}</span>
                  ) : null}
                </div>

                <div className="companion-composer flex items-end gap-2 p-2">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setRouting((open) => !open)}
                      className="rounded-full"
                      aria-label={t("compTapToChange")}
                    >
                      <CompanionFace
                        name={active.name}
                        hue={active.hue}
                        seed={active.faceSeed}
                        size="md"
                        state="lit"
                      />
                    </button>
                    {routing ? (
                      <div
                        dir={dir}
                        className="absolute bottom-[calc(100%+10px)] start-0 z-20 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] p-1.5 shadow-2xl"
                      >
                        {people.map((person) => (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => {
                              setActiveId(person.id);
                              setRouting(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-start hover:bg-white/5"
                          >
                            <CompanionFace
                              name={person.name}
                              hue={person.hue}
                              seed={person.faceSeed}
                              size="sm"
                              state={active.id === person.id ? "lit" : "quiet"}
                            />
                            <span className="truncate text-[12.5px] text-neutral-200">
                              {person.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    placeholder={t("compWhoAnswers").replace("{name}", active.name)}
                    className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-white outline-none placeholder:text-neutral-600"
                  />

                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!draft.trim() || busy}
                    className="home-btn-primary inline-flex size-9 shrink-0 items-center justify-center !rounded-full disabled:opacity-35"
                    aria-label={t("compSend")}
                  >
                    <ArrowUp className="size-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* What it knows, tone, work, threads                                */}
        {/* ---------------------------------------------------------------- */}
        <aside
          className={cn(
            "companion-panel companion-rise companion-rise-2 w-[320px] shrink-0 flex-col overflow-hidden",
            // Inline on a wide window, a drawer over the room on a narrow one.
            contextOpen
              ? "absolute inset-y-1 end-1 z-30 flex bg-[#0a0a0a] shadow-2xl xl:static xl:bg-transparent xl:shadow-none"
              : "hidden",
          )}
        >
          <div className="flex gap-1 border-b border-white/8 p-2">
            {(
              [
                ["knows", t("compKnows")],
                ["tone", t("compTone")],
                ["work", t("compWork")],
                ["threads", t("compThreads")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPanel(key)}
                className={cn(
                  "flex-1 rounded-xl px-1.5 py-1.5 text-[11.5px] transition-colors",
                  panel === key ? "bg-white text-black" : "text-neutral-400 hover:text-neutral-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            {panel === "knows" ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={factDraft}
                    onChange={(event) => setFactDraft(event.target.value)}
                    placeholder={t("compKnows")}
                    className="field !h-9 !rounded-xl !text-[12.5px]"
                  />
                  <button
                    type="button"
                    disabled={!factDraft.trim()}
                    onClick={() => {
                      addFact({
                        companionId: active?.id ?? null,
                        text: factDraft.trim(),
                        source: t("compFactExplicit"),
                        kind: "explicit",
                        space,
                      });
                      setFactDraft("");
                      if (active) syncAgent(active.id);
                    }}
                    className="home-btn-primary h-9 shrink-0 px-3 text-[12px] disabled:opacity-40"
                  >
                    {t("compAdd")}
                  </button>
                </div>

                {facts.length === 0 ? (
                  <p className="py-4 text-[12.5px] leading-relaxed text-neutral-600">
                    {t("compKnowsEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {facts.map((fact) => (
                      <li
                        key={fact.id}
                        className="rounded-[18px] border border-white/8 bg-white/[0.02] px-3 py-2.5"
                      >
                        <p className="text-[12.5px] leading-relaxed text-neutral-200">{fact.text}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-neutral-600">
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5",
                              fact.kind === "explicit"
                                ? "bg-white/8 text-neutral-400"
                                : "bg-amber-400/10 companion-warn",
                            )}
                          >
                            {fact.kind === "explicit" ? t("compFactExplicit") : t("compFactInferred")}
                          </span>
                          {fact.source}
                        </p>
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setFactShared(fact.id, !fact.shared);
                              if (active) syncAgent(active.id);
                            }}
                            className="text-[11px] text-neutral-500 hover:text-white"
                          >
                            {fact.shared ? t("compDontShare") : t("compShared")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteFact(fact.id);
                              if (active) syncAgent(active.id);
                            }}
                            className="ms-auto inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-red-300"
                          >
                            <Trash2 className="size-3" strokeWidth={1.8} />
                            {t("delete")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-[10.5px] leading-relaxed text-neutral-600">
                  {t("compDeleteHint")}
                </p>

                <div className="border-t border-white/8 pt-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("compPermissions")}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {(
                      [
                        ["health", t("compPermHealth")],
                        ["calendar", t("compPermCalendar")],
                        ["contacts", t("compPermContacts")],
                      ] as const
                    ).map(([key, label]) => (
                      <li key={key} className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-neutral-300">{label}</span>
                        <button
                          type="button"
                          onClick={() => setPermission(key as PermissionKey, !state.permissions[key])}
                          className={cn(
                            "companion-chip",
                            state.permissions[key] && "is-on",
                          )}
                        >
                          {state.permissions[key] ? t("connected") : t("compNotConnected")}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([exportEverything(state)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "arrab-companions.json";
                        anchor.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="companion-chip"
                    >
                      {t("compExport")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t("compForgetConfirm"))) {
                          forgetEverything();
                          setActiveId(null);
                          setLines([]);
                        }
                      }}
                      className="companion-chip"
                    >
                      {t("compForget")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {panel === "tone" && active ? (
              <div className="space-y-5">
                {(
                  [
                    ["bluntness", t("compBluntness")],
                    ["humour", t("compHumour")],
                    ["replyLength", t("compReplyLength")],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="flex items-center justify-between text-[12px] text-neutral-400">
                      {label}
                      <span className="text-neutral-600">{active.tone[key]}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={active.tone[key]}
                      onChange={(event) => setCompanionTone(active.id, { [key]: Number(event.target.value) })}
                      onMouseUp={() => syncAgent(active.id)}
                      onTouchEnd={() => syncAgent(active.id)}
                      className="companion-slider mt-2.5"
                    />
                  </label>
                ))}

                <div>
                  <p className="text-[12px] text-neutral-400">{t("compCallOut")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CALL_OUT_TOPICS.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => {
                          toggleCallOut(active.id, topic);
                          syncAgent(active.id);
                        }}
                        className={cn(
                          "companion-chip",
                          active.callOut.includes(topic) && "is-on",
                        )}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-white/8 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      resetCompanionTone(active.id);
                      syncAgent(active.id);
                    }}
                    className="companion-chip"
                  >
                    {t("compResetTone")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateCompanion(active.id, {
                        space: active.space === "personal" ? "work" : "personal",
                      });
                      setActiveId(null);
                    }}
                    className="companion-chip"
                  >
                    {active.space === "personal" ? t("compSpaceWork") : t("compSpacePersonal")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeCompanion(active.id);
                      setActiveId(null);
                    }}
                    className="companion-chip"
                  >
                    {t("compRemove")}
                  </button>
                </div>

                <p className="text-[10.5px] leading-relaxed text-neutral-600">
                  {TONE_PRESETS[active.toneName].bluntness > 60
                    ? t("compBornDirectExample")
                    : t("compBornMeasuredExample")}
                </p>
              </div>
            ) : null}

            {panel === "work" ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("compWorkSuggested")}
                  </p>
                  {suggestedWork(state, space).length === 0 ? (
                    <p className="mt-2 text-[12.5px] text-neutral-600">{t("compWorkEmpty")}</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {suggestedWork(state, space).map((item) => (
                        <li
                          key={item.id}
                          className="rounded-[18px] border border-white/8 bg-white/[0.02] px-3 py-2.5"
                        >
                          <p className="text-[12.5px] text-neutral-200">{item.text}</p>
                          <p className="mt-1 text-[10.5px] text-neutral-600">
                            {t("compSuggestedTime")} · {formatSlot(item.suggestedTime, locale)}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setWorkState(item.id, "accepted")}
                              className="companion-chip"
                            >
                              {t("compAddIt")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setWorkState(item.id, "declined")}
                              className="companion-chip"
                            >
                              {t("compNotTask")}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t border-white/8 pt-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                    {t("compWorkAccepted")}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {acceptedWork(state, space).map((item) => (
                      <li
                        key={item.id}
                        className="rounded-[18px] border border-white/8 bg-white/[0.02] px-3 py-2.5"
                      >
                        <p className="text-[12.5px] text-neutral-200">{item.text}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-neutral-600">
                          <Clock className="size-3" strokeWidth={1.8} />
                          {formatSlot(item.suggestedTime, locale)}
                        </p>
                        {needsTaskOrThought(item) ? (
                          <div className="mt-2">
                            <p className="text-[11.5px] companion-warn">
                              {t("compTaskOrThought")}
                            </p>
                            <div className="mt-1.5 flex gap-2">
                              <button
                                type="button"
                                onClick={() => postponeWork(item.id)}
                                className="companion-chip"
                              >
                                {t("compStillTask")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setWorkState(item.id, "declined")}
                                className="companion-chip"
                              >
                                {t("compJustThought")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => setWorkState(item.id, "done")}
                              className="companion-chip"
                            >
                              <Check className="size-3" strokeWidth={2} />
                              {t("compDone")}
                            </button>
                            <button
                              type="button"
                              onClick={() => postponeWork(item.id)}
                              className="companion-chip"
                            >
                              {t("compPostpone")}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {panel === "threads" ? (
              <div className="space-y-3">
                {openThreads.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-600">{t("compThreadsEmpty")}</p>
                ) : (
                  <ul className="space-y-2">
                    {openThreads.map((thread) => (
                      <li
                        key={thread.id}
                        className="rounded-[18px] border border-white/8 bg-white/[0.02] px-3 py-2.5"
                      >
                        <p className="text-[12.5px] text-white">{thread.title}</p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
                          {thread.summary}
                        </p>
                        {thread.open ? (
                          <p className="mt-1.5 text-[11.5px] companion-warn">
                            {t("compOpenLoop")}: {thread.open}
                          </p>
                        ) : null}
                        <div className="mt-2 flex items-center gap-3">
                          <span className="text-[10.5px] text-neutral-600">
                            {relativeTime(thread.touchedAt, locale)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setThreadArchived(thread.id, true)}
                            className="ms-auto text-[11px] text-neutral-500 hover:text-white"
                          >
                            {t("compArchive")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {archivedThreads.length > 0 ? (
                  <div className="border-t border-white/8 pt-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                      {t("compArchived")}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {archivedThreads.map((thread) => (
                        <li key={thread.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">
                            {thread.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => setThreadArchived(thread.id, false)}
                            className="text-[11px] text-neutral-600 hover:text-white"
                          >
                            {t("compUnarchive")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {panel === "tone" && !active ? (
              <p className="flex items-center gap-2 text-[12.5px] text-neutral-600">
                <Users className="size-3.5" strokeWidth={1.8} />
                {t("compNoCompanions")}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </Surface>
  );
}
