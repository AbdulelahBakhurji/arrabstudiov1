/**
 * Companion engine for the Individuals studio.
 *
 * Individuals do not run a workforce — they keep a small set of companions that
 * remember things and stay quiet most of the time. All state lives on device;
 * replies come from the normal Arrab conversation API.
 *
 * Two rules from the product spec are enforced here, not in the UI:
 *  - at most two meaningful nudges land in any one week, shared across everyone;
 *  - a nudge dies after two ignores, and a board card removes itself after three.
 */
import { useSyncExternalStore } from "react";

export type CompanionSpace = "personal" | "work";
export type CompanionToneName = "direct" | "measured";
export type PermissionKey = "health" | "calendar" | "contacts";
export type NudgeLevel = "whisper" | "line" | "critical";
export type FactKind = "explicit" | "inferred";

export interface CompanionTone {
  /** 0 = gentle, 100 = blunt. */
  bluntness: number;
  humour: number;
  /** 0 = one line, 100 = full paragraphs. */
  replyLength: number;
}

export interface CompanionProfile {
  id: string;
  /** Backing Arrab agent — created lazily on the first real message. */
  agentId: string | null;
  conversationId: string | null;
  name: string;
  /** What they watch: general, sleep, money, work, study… */
  domain: string;
  /** Fixed for life — this person is always this colour. */
  hue: number;
  faceSeed: number;
  space: CompanionSpace;
  tone: CompanionTone;
  toneName: CompanionToneName;
  callOut: string[];
  /** Short caption under the face: "5h sleep", "+20% spend". */
  lastMemory: string | null;
  lastLine: string | null;
  lastAt: string | null;
  /** Where we left off, so the room opens mid-sentence. */
  resume: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface CompanionFact {
  id: string;
  companionId: string | null;
  text: string;
  /** Always shown next to the fact: "you told Maya", "from your watch". */
  source: string;
  kind: FactKind;
  /** Inferred facts vanish when their source is switched off. */
  derivedFrom: PermissionKey | null;
  space: CompanionSpace;
  shared: boolean;
  createdAt: string;
}

export interface Nudge {
  id: string;
  companionId: string;
  level: NudgeLevel;
  text: string;
  source: string;
  answers: [string, string] | null;
  space: CompanionSpace;
  createdAt: string;
  ignoredCount: number;
  state: "live" | "answered" | "dead";
}

export interface WorkItem {
  id: string;
  companionId: string | null;
  text: string;
  state: "suggested" | "accepted" | "declined" | "done";
  /** Picked from a real gap, never invented on the spot. */
  suggestedTime: string | null;
  postponeCount: number;
  capturedFrom: string;
  space: CompanionSpace;
  createdAt: string;
  touchedAt: string;
}

export interface CompanionThread {
  id: string;
  companionId: string | null;
  title: string;
  summary: string;
  /** The "Open:" loop — what is still unfinished in this thread. */
  open: string | null;
  space: CompanionSpace;
  createdAt: string;
  touchedAt: string;
  archived: boolean;
}

export interface CompanionState {
  version: 2;
  companions: CompanionProfile[];
  facts: CompanionFact[];
  nudges: Nudge[];
  work: WorkItem[];
  threads: CompanionThread[];
  /** Repetition counter — three mentions is what births a companion. */
  topics: Record<string, { count: number; lastAt: string }>;
  permissions: Record<PermissionKey, boolean>;
  /** Board card id → how many times it was waved away. */
  dismissals: Record<string, number>;
  /** Subject that is currently too raw for nudges or jokes. */
  sensitiveUntil: string | null;
  lastOpenedAt: string | null;
}

export interface BoardCard {
  id: string;
  companionId: string;
  line: string;
  action: string;
  source: string;
  space: CompanionSpace;
  nudgeId: string | null;
  workId: string | null;
  threadId: string | null;
}

const STORAGE_KEY = "arrab.companions.v2";
const CHANGE_EVENT = "arrab:companions";

/** The board hands the room a companion and an unsent line. */
export const COMPANION_FOCUS_KEY = "arrab.companionFocus";
export const COMPANION_DRAFT_KEY = "arrab.companionDraft";

/** Meaningful nudges allowed per week, shared across every companion. */
export const WEEKLY_NUDGE_CEILING = 2;
export const MAX_BOARD_CARDS = 3;
const CARD_DISMISS_LIMIT = 3;
const NUDGE_IGNORE_LIMIT = 2;
const ARCHIVE_AFTER_DAYS = 60;
const BIRTH_AFTER_MENTIONS = 3;

/** Distinct, fixed hues handed out in creation order. */
const HUES = [28, 268, 158, 208, 336, 48, 188, 300];

const DEFAULT_TONE: CompanionTone = { bluntness: 45, humour: 40, replyLength: 35 };

export const TONE_PRESETS: Record<CompanionToneName, CompanionTone> = {
  direct: { bluntness: 78, humour: 30, replyLength: 20 },
  measured: { bluntness: 32, humour: 45, replyLength: 55 },
};

export const CALL_OUT_TOPICS = ["spending", "goals", "habits", "sleep", "focus"] as const;

/** Topics we listen for. Three mentions of one of these offers a companion. */
const TOPIC_RULES: { domain: string; words: string[] }[] = [
  { domain: "sleep", words: ["sleep", "tired", "insomnia", "awake", "نوم", "تعبان"] },
  { domain: "money", words: ["spend", "budget", "salary", "invoice", "money", "مصروف", "راتب"] },
  { domain: "work", words: ["deadline", "meeting", "client", "ship", "launch", "اجتماع", "عميل"] },
  { domain: "study", words: ["exam", "study", "course", "thesis", "اختبار", "دراسة"] },
  { domain: "training", words: ["gym", "run", "training", "workout", "تمرين", "جري"] },
];

/** Subjects where nudges and humour stand down until things settle. */
const SENSITIVE_WORDS = [
  "died",
  "passed away",
  "funeral",
  "divorce",
  "cancer",
  "fired",
  "laid off",
  "depressed",
  "توفي",
  "طلاق",
  "مريض",
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function emptyState(): CompanionState {
  return {
    version: 2,
    companions: [],
    facts: [],
    nudges: [],
    work: [],
    threads: [],
    topics: {},
    permissions: { health: false, calendar: false, contacts: false },
    dismissals: {},
    sensitiveUntil: null,
    lastOpenedAt: null,
  };
}

let cache: CompanionState | null = null;

function hydrate(): CompanionState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CompanionState>;
      cache = { ...emptyState(), ...parsed, version: 2 };
      return cache;
    }
  } catch {
    // corrupt or unavailable storage — start clean rather than crash the studio
  }
  cache = emptyState();
  return cache;
}

export function getCompanionState(): CompanionState {
  return hydrate();
}

function commit(next: CompanionState): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // over quota — keep the in-memory copy so the session still works
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function update(mutate: (draft: CompanionState) => CompanionState | void): CompanionState {
  const draft: CompanionState = structuredClone(hydrate());
  const result = mutate(draft) ?? draft;
  commit(result);
  return result;
}

function subscribe(listener: () => void): () => void {
  /** Another studio window wrote to disk — drop our copy and read it again. */
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live companion state. Re-renders whenever anything on device changes. */
export function useCompanionState(): CompanionState {
  return useSyncExternalStore(subscribe, getCompanionState, getCompanionState);
}

// ---------------------------------------------------------------------------
// Companions
// ---------------------------------------------------------------------------

export function liveCompanions(state: CompanionState, space?: CompanionSpace): CompanionProfile[] {
  return state.companions
    .filter((person) => !person.archivedAt)
    .filter((person) => (space ? person.space === space : true));
}

export function findCompanion(state: CompanionState, id: string | null): CompanionProfile | null {
  if (!id) return null;
  return state.companions.find((person) => person.id === id) ?? null;
}

export function addCompanion(input: {
  name: string;
  domain: string;
  space?: CompanionSpace;
  toneName?: CompanionToneName;
  callOut?: string[];
}): CompanionProfile {
  const created: CompanionProfile = {
    id: newId("comp"),
    agentId: null,
    conversationId: null,
    name: input.name.trim(),
    domain: input.domain,
    hue: 0,
    faceSeed: Math.floor(Math.random() * 4096),
    space: input.space ?? "personal",
    tone: input.toneName ? TONE_PRESETS[input.toneName] : DEFAULT_TONE,
    toneName: input.toneName ?? "measured",
    callOut: input.callOut ?? [],
    lastMemory: null,
    lastLine: null,
    lastAt: null,
    resume: null,
    createdAt: nowIso(),
    archivedAt: null,
  };
  let stored = created;
  update((draft) => {
    stored = { ...created, hue: HUES[draft.companions.length % HUES.length]! };
    draft.companions.push(stored);
    // A companion is never born empty — it starts with what made it exist.
    draft.topics[created.domain] = { count: 0, lastAt: nowIso() };
  });
  return stored;
}

export function updateCompanion(id: string, patch: Partial<CompanionProfile>): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) Object.assign(person, patch);
  });
}

export function setCompanionTone(id: string, tone: Partial<CompanionTone>): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) person.tone = { ...person.tone, ...tone };
  });
}

export function resetCompanionTone(id: string): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) person.tone = TONE_PRESETS[person.toneName];
  });
}

export function toggleCallOut(id: string, topic: string): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (!person) return;
    person.callOut = person.callOut.includes(topic)
      ? person.callOut.filter((item) => item !== topic)
      : [...person.callOut, topic];
  });
}

/** Removing a companion takes their memories and nudges with them. */
export function removeCompanion(id: string): void {
  update((draft) => {
    draft.companions = draft.companions.filter((person) => person.id !== id);
    draft.facts = draft.facts.filter((fact) => fact.companionId !== id);
    draft.nudges = draft.nudges.filter((nudge) => nudge.companionId !== id);
    draft.work = draft.work.filter((item) => item.companionId !== id);
    draft.threads = draft.threads.filter((thread) => thread.companionId !== id);
  });
}

/** Turn tone + domain + what they know into standing instructions for the agent. */
export function companionInstructions(person: CompanionProfile, facts: CompanionFact[]): string {
  const bluntness =
    person.tone.bluntness > 66
      ? "Say the hard part first. No cushioning."
      : person.tone.bluntness > 33
        ? "Be honest but land it gently."
        : "Be careful with them. Ask before you judge.";
  const humour =
    person.tone.humour > 60 ? "Dry humour is welcome." : "Keep humour to a minimum.";
  const length =
    person.tone.replyLength > 66
      ? "Full answers are fine."
      : person.tone.replyLength > 33
        ? "Two or three sentences."
        : "One or two lines. Never a wall of text.";
  const callOut = person.callOut.length
    ? `Call them out on: ${person.callOut.join(", ")}.`
    : "Do not moralise about anything they have not asked about.";
  const known = facts
    .filter((fact) => fact.shared)
    .slice(0, 12)
    .map((fact) => `- ${fact.text} (${fact.source})`)
    .join("\n");

  return [
    `You are ${person.name}, one of a few companions this person keeps. You watch ${person.domain}.`,
    "You are not an assistant and not a chatbot. You are someone who knows them and leaves them alone.",
    bluntness,
    humour,
    length,
    callOut,
    "Never invent a memory. If you are guessing, say you are guessing.",
    known ? `What you already know about them:\n${known}` : "You are new here — ask, do not assume.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Memory — what it knows about you
// ---------------------------------------------------------------------------

export function addFact(input: {
  companionId: string | null;
  text: string;
  source: string;
  kind?: FactKind;
  derivedFrom?: PermissionKey | null;
  space?: CompanionSpace;
}): void {
  update((draft) => {
    draft.facts.unshift({
      id: newId("fact"),
      companionId: input.companionId,
      text: input.text.trim(),
      source: input.source,
      kind: input.kind ?? "explicit",
      derivedFrom: input.derivedFrom ?? null,
      space: input.space ?? "personal",
      shared: true,
      createdAt: nowIso(),
    });
  });
}

/** Real deletion: the fact goes, and anything standing on it goes too. */
export function deleteFact(id: string): void {
  update((draft) => {
    const fact = draft.facts.find((item) => item.id === id);
    draft.facts = draft.facts.filter((item) => item.id !== id);
    if (!fact) return;
    draft.nudges = draft.nudges.filter((nudge) => !nudge.text.includes(fact.text));
    draft.work = draft.work.filter((item) => !item.text.includes(fact.text));
  });
}

export function setFactShared(id: string, shared: boolean): void {
  update((draft) => {
    const fact = draft.facts.find((item) => item.id === id);
    if (fact) fact.shared = shared;
  });
}

export function setPermission(key: PermissionKey, on: boolean): void {
  update((draft) => {
    draft.permissions[key] = on;
  });
}

/**
 * Facts a companion is allowed to see. Inferred facts disappear with their
 * source, and Work may read Personal but never the other way round.
 */
export function visibleFacts(state: CompanionState, person: CompanionProfile | null): CompanionFact[] {
  return state.facts.filter((fact) => {
    if (fact.derivedFrom && !state.permissions[fact.derivedFrom]) return false;
    if (!person) return true;
    if (person.space === "work") return true;
    return fact.space === "personal";
  });
}

export function exportEverything(state: CompanionState): string {
  return JSON.stringify(
    {
      exportedAt: nowIso(),
      companions: state.companions,
      facts: state.facts,
      work: state.work,
      threads: state.threads,
      permissions: state.permissions,
    },
    null,
    2,
  );
}

export function forgetEverything(): void {
  commit(emptyState());
}

// ---------------------------------------------------------------------------
// Reaching out — nudges
// ---------------------------------------------------------------------------

function weekKeyOf(iso: string): string {
  const date = new Date(iso);
  const monday = new Date(date);
  const weekday = (date.getDay() + 6) % 7;
  monday.setDate(date.getDate() - weekday);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

/** Whispers are free. Anything that asks for an answer counts. */
export function nudgesUsedThisWeek(state: CompanionState): number {
  const thisWeek = weekKeyOf(nowIso());
  return state.nudges.filter(
    (nudge) => nudge.level !== "whisper" && weekKeyOf(nudge.createdAt) === thisWeek,
  ).length;
}

export function nudgeBudgetLeft(state: CompanionState): number {
  return Math.max(0, WEEKLY_NUDGE_CEILING - nudgesUsedThisWeek(state));
}

export function isSensitiveNow(state: CompanionState): boolean {
  if (!state.sensitiveUntil) return false;
  return new Date(state.sensitiveUntil).getTime() > Date.now();
}

export function markSensitive(hours = 48): void {
  update((draft) => {
    draft.sensitiveUntil = new Date(Date.now() + hours * 3_600_000).toISOString();
  });
}

export function detectSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_WORDS.some((word) => lower.includes(word));
}

export function liveNudges(state: CompanionState, space?: CompanionSpace): Nudge[] {
  return state.nudges
    .filter((nudge) => nudge.state === "live")
    .filter((nudge) => (space ? nudge.space === space : true));
}

/**
 * Raise a nudge if there is room this week and the subject is not raw.
 * Returns null when it was refused — silence is the default, not a failure.
 */
export function raiseNudge(input: {
  companionId: string;
  level: NudgeLevel;
  text: string;
  source: string;
  answers?: [string, string];
  space?: CompanionSpace;
}): Nudge | null {
  const state = hydrate();
  if (input.level !== "whisper") {
    if (isSensitiveNow(state)) return null;
    if (nudgeBudgetLeft(state) <= 0) return null;
  }
  const duplicate = state.nudges.some(
    (nudge) => nudge.state === "live" && nudge.text === input.text,
  );
  if (duplicate) return null;

  const nudge: Nudge = {
    id: newId("nudge"),
    companionId: input.companionId,
    level: input.level,
    text: input.text,
    source: input.source,
    answers: input.answers ?? null,
    space: input.space ?? "personal",
    createdAt: nowIso(),
    ignoredCount: 0,
    state: "live",
  };
  update((draft) => {
    draft.nudges.unshift(nudge);
  });
  return nudge;
}

export function answerNudge(id: string): void {
  update((draft) => {
    const nudge = draft.nudges.find((item) => item.id === id);
    if (nudge) nudge.state = "answered";
  });
}

/** Ignored twice and it stops asking — for good. */
export function ignoreNudge(id: string): void {
  update((draft) => {
    const nudge = draft.nudges.find((item) => item.id === id);
    if (!nudge) return;
    nudge.ignoredCount += 1;
    if (nudge.ignoredCount >= NUDGE_IGNORE_LIMIT) nudge.state = "dead";
  });
}

// ---------------------------------------------------------------------------
// Work and tasks
// ---------------------------------------------------------------------------

/** Captured items stay suggestions until accepted. Nothing is added silently. */
export function captureWork(input: {
  companionId: string | null;
  text: string;
  capturedFrom: string;
  space?: CompanionSpace;
  suggestedTime?: string | null;
}): void {
  update((draft) => {
    const exists = draft.work.some(
      (item) => item.text.toLowerCase() === input.text.trim().toLowerCase(),
    );
    if (exists) return;
    draft.work.unshift({
      id: newId("work"),
      companionId: input.companionId,
      text: input.text.trim(),
      state: "suggested",
      suggestedTime: input.suggestedTime ?? nextFreeSlot(),
      postponeCount: 0,
      capturedFrom: input.capturedFrom,
      space: input.space ?? "personal",
      createdAt: nowIso(),
      touchedAt: nowIso(),
    });
  });
}

export function setWorkState(id: string, state: WorkItem["state"]): void {
  update((draft) => {
    const item = draft.work.find((entry) => entry.id === id);
    if (!item) return;
    item.state = state;
    item.touchedAt = nowIso();
  });
}

export function postponeWork(id: string): void {
  update((draft) => {
    const item = draft.work.find((entry) => entry.id === id);
    if (!item) return;
    item.postponeCount += 1;
    item.touchedAt = nowIso();
    item.suggestedTime = nextFreeSlot(item.postponeCount);
  });
}

/** Three postponements is a question, not a reminder. */
export function needsTaskOrThought(item: WorkItem): boolean {
  return item.state === "accepted" && item.postponeCount >= 3;
}

/**
 * The next believable gap, and a day further out each time it is moved.
 * Nothing is suggested in the middle of the night.
 */
function nextFreeSlot(offsetDays = 0): string {
  const slot = new Date();
  if (offsetDays > 0) {
    slot.setDate(slot.getDate() + offsetDays);
    slot.setHours(9, 30, 0, 0);
    return slot.toISOString();
  }
  const hour = slot.getHours();
  if (hour < 8) {
    slot.setHours(9, 30, 0, 0);
  } else if (hour < 19) {
    slot.setHours(hour + 2, 0, 0, 0);
  } else {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
  }
  return slot.toISOString();
}

export function acceptedWork(state: CompanionState, space?: CompanionSpace): WorkItem[] {
  return state.work
    .filter((item) => item.state === "accepted")
    .filter((item) => (space ? item.space === space : true));
}

export function suggestedWork(state: CompanionState, space?: CompanionSpace): WorkItem[] {
  return state.work
    .filter((item) => item.state === "suggested")
    .filter((item) => (space ? item.space === space : true));
}

// ---------------------------------------------------------------------------
// Threads, not a log
// ---------------------------------------------------------------------------

export function touchThread(input: {
  companionId: string | null;
  title: string;
  summary: string;
  open?: string | null;
  space?: CompanionSpace;
}): void {
  update((draft) => {
    const existing = draft.threads.find(
      (thread) => thread.title.toLowerCase() === input.title.trim().toLowerCase(),
    );
    if (existing) {
      existing.summary = input.summary;
      existing.open = input.open ?? existing.open;
      existing.touchedAt = nowIso();
      existing.archived = false;
      return;
    }
    draft.threads.unshift({
      id: newId("thread"),
      companionId: input.companionId,
      title: input.title.trim(),
      summary: input.summary,
      open: input.open ?? null,
      space: input.space ?? "personal",
      createdAt: nowIso(),
      touchedAt: nowIso(),
      archived: false,
    });
  });
}

export function setThreadArchived(id: string, archived: boolean): void {
  update((draft) => {
    const thread = draft.threads.find((item) => item.id === id);
    if (thread) thread.archived = archived;
  });
}

/** Untouched for two months folds itself away. */
export function foldStaleThreads(): void {
  const cutoff = Date.now() - ARCHIVE_AFTER_DAYS * 86_400_000;
  update((draft) => {
    for (const thread of draft.threads) {
      if (!thread.archived && new Date(thread.touchedAt).getTime() < cutoff) {
        thread.archived = true;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// A companion is born
// ---------------------------------------------------------------------------

export interface BirthSuggestion {
  domain: string;
  mentions: number;
  because: string;
}

/** Count what they keep coming back to, ignoring domains already covered. */
export function noteTopics(text: string): void {
  const lower = text.toLowerCase();
  const hits = TOPIC_RULES.filter((rule) => rule.words.some((word) => lower.includes(word)));
  if (hits.length === 0) return;
  update((draft) => {
    for (const hit of hits) {
      const current = draft.topics[hit.domain] ?? { count: 0, lastAt: nowIso() };
      draft.topics[hit.domain] = { count: current.count + 1, lastAt: nowIso() };
    }
  });
}

export function birthSuggestion(state: CompanionState): BirthSuggestion | null {
  const covered = new Set(liveCompanions(state).map((person) => person.domain));
  for (const [domain, entry] of Object.entries(state.topics)) {
    if (covered.has(domain)) continue;
    if (entry.count >= BIRTH_AFTER_MENTIONS) {
      return { domain, mentions: entry.count, because: domain };
    }
  }
  return null;
}

export function dismissBirth(domain: string): void {
  update((draft) => {
    draft.topics[domain] = { count: 0, lastAt: nowIso() };
  });
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function dismissKey(card: { nudgeId: string | null; workId: string | null; threadId: string | null }): string {
  return card.nudgeId ?? card.workId ?? card.threadId ?? "unknown";
}

/**
 * At most three cards, one per subject that actually needs them.
 * A card that has been waved away three times never comes back.
 */
export function boardCards(state: CompanionState, space: CompanionSpace): BoardCard[] {
  const cards: BoardCard[] = [];

  for (const nudge of liveNudges(state, space)) {
    cards.push({
      id: `card-${nudge.id}`,
      companionId: nudge.companionId,
      line: nudge.text,
      action: nudge.answers ? nudge.answers[0] : "Open",
      source: nudge.source,
      space,
      nudgeId: nudge.id,
      workId: null,
      threadId: null,
    });
  }

  for (const item of acceptedWork(state, space)) {
    if (!item.suggestedTime) continue;
    if (new Date(item.suggestedTime).getTime() > Date.now() + 86_400_000) continue;
    cards.push({
      id: `card-${item.id}`,
      companionId: item.companionId ?? liveCompanions(state, space)[0]?.id ?? "",
      line: item.text,
      action: needsTaskOrThought(item) ? "Task or thought?" : "Do it now",
      source: item.capturedFrom,
      space,
      nudgeId: null,
      workId: item.id,
      threadId: null,
    });
  }

  for (const thread of state.threads) {
    if (thread.archived || thread.space !== space || !thread.open) continue;
    cards.push({
      id: `card-${thread.id}`,
      companionId: thread.companionId ?? liveCompanions(state, space)[0]?.id ?? "",
      line: thread.open,
      action: "Open",
      source: thread.title,
      space,
      nudgeId: null,
      workId: null,
      threadId: thread.id,
    });
  }

  /** The lit card is whatever is most time-critical, not whatever is newest. */
  const weight = (card: BoardCard): number => {
    const nudge = state.nudges.find((item) => item.id === card.nudgeId);
    if (nudge?.level === "critical") return 0;
    if (card.workId) return 1;
    if (nudge?.level === "line") return 2;
    if (card.threadId) return 3;
    return 4;
  };

  return cards
    .filter((card) => card.companionId)
    .filter((card) => (state.dismissals[dismissKey(card)] ?? 0) < CARD_DISMISS_LIMIT)
    .sort((a, b) => weight(a) - weight(b))
    .slice(0, MAX_BOARD_CARDS);
}

export function dismissCard(card: BoardCard): void {
  const key = dismissKey(card);
  update((draft) => {
    draft.dismissals[key] = (draft.dismissals[key] ?? 0) + 1;
    if (card.nudgeId) {
      const nudge = draft.nudges.find((item) => item.id === card.nudgeId);
      if (nudge) {
        nudge.ignoredCount += 1;
        if (nudge.ignoredCount >= NUDGE_IGNORE_LIMIT) nudge.state = "dead";
      }
    }
  });
}

/** Who has nothing today — the board says this out loud instead of hiding it. */
export function silentCompanions(
  state: CompanionState,
  space: CompanionSpace,
  cards: BoardCard[],
): CompanionProfile[] {
  const speaking = new Set(cards.map((card) => card.companionId));
  return liveCompanions(state, space).filter((person) => !speaking.has(person.id));
}

/** Away for weeks? One card, not a backlog. */
export function returningAfterAbsence(): boolean {
  const { lastOpenedAt } = hydrate();
  if (!lastOpenedAt) return false;
  return Date.now() - new Date(lastOpenedAt).getTime() > 14 * 86_400_000;
}

export function markOpened(): void {
  update((draft) => {
    draft.lastOpenedAt = nowIso();
  });
}

// ---------------------------------------------------------------------------
// Local signals — where nudges actually come from
// ---------------------------------------------------------------------------

/**
 * Look at real device state and raise at most what the week allows.
 * Called once when the studio opens, never on a timer.
 */
export function runSignals(): void {
  foldStaleThreads();
  const state = hydrate();
  const people = liveCompanions(state);
  if (people.length === 0) return;

  for (const item of acceptedWork(state)) {
    if (item.postponeCount >= 3) {
      raiseNudge({
        companionId: item.companionId ?? people[0]!.id,
        level: "line",
        text: `"${item.text}" has moved three times.`,
        source: item.capturedFrom,
        answers: ["Still a task", "Just a thought"],
        space: item.space,
      });
      continue;
    }
    if (item.suggestedTime && new Date(item.suggestedTime).getTime() < Date.now()) {
      raiseNudge({
        companionId: item.companionId ?? people[0]!.id,
        level: "critical",
        text: `${item.text} — the window you picked has passed.`,
        source: item.capturedFrom,
        space: item.space,
      });
    }
  }

  for (const person of people) {
    if (!person.lastAt) continue;
    const quietDays = (Date.now() - new Date(person.lastAt).getTime()) / 86_400_000;
    if (quietDays > 10) {
      raiseNudge({
        companionId: person.id,
        level: "whisper",
        text: `${person.name} has not heard from you in ${Math.round(quietDays)} days.`,
        source: person.domain,
        space: person.space,
      });
    }
  }
}

/** Record that a companion spoke, so faces carry a real last line. */
export function recordExchange(input: {
  companionId: string;
  line: string;
  memory?: string | null;
  resume?: string | null;
}): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === input.companionId);
    if (!person) return;
    person.lastLine = input.line.slice(0, 140);
    person.lastAt = nowIso();
    if (input.memory) person.lastMemory = input.memory;
    if (input.resume) person.resume = input.resume;
  });
}

export function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return locale === "ar" ? "الآن" : "now";
  if (minutes < 60) return locale === "ar" ? `${minutes} د` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === "ar" ? `${hours} س` : `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return locale === "ar" ? `${days} ي` : `${days}d`;
  const weeks = Math.round(days / 7);
  return locale === "ar" ? `${weeks} أ` : `${weeks}w`;
}

export function formatSlot(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale === "ar" ? "ar" : "en", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
