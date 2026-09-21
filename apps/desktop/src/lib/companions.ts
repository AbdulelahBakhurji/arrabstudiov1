/**
 * Companion engine for the Individuals studio.
 *
 * Individuals do not run a workforce — they keep a small set of companions that
 * remember things and stay quiet most of the time. Profiles and chat pointers
 * sync to the Arrab API database so the same companions and conversations open
 * on any signed-in device. Message bodies live in /v1/conversations.
 *
 * Two rules from the product spec are enforced here, not in the UI:
 *  - at most two meaningful nudges land in any one week, shared across everyone;
 *  - a nudge dies after two ignores, and a board card removes itself after three.
 */
import { useSyncExternalStore } from "react";
import { arrabApi } from "@/lib/api";
import { looksEncryptedLocal, openLocalJson, sealLocalJson } from "./local-secure";
import {
  playbookText,
  purposeRegistryById,
  resolvePurposeIdFromDomain,
  tasksForPurpose,
} from "./purpose-registry";
import { brainContextSnippet } from "./second-brain";
import {
  allocateUniquePortrait,
  portraitFileFromUrl,
  presetPortraitFile,
  resolveCompanionPortraitSrc,
} from "./companion-portrait";

export type CompanionSpace = "personal" | "work";
export type CompanionToneName = "direct" | "measured";
export type PermissionKey = "health" | "calendar" | "contacts";
export type NudgeLevel = "whisper" | "line" | "critical";
export type FactKind = "explicit" | "inferred" | "parent_guidance";

export interface CompanionTone {
  /** 0 = gentle, 100 = blunt. */
  bluntness: number;
  humour: number;
  /** 0 = one line, 100 = full paragraphs. */
  replyLength: number;
  /** 0 = cool/reserved, 100 = warm. */
  warmth: number;
  /** 0 = casual, 100 = formal. */
  formality: number;
}

export interface CompanionProfile {
  id: string;
  /** Backing Arrab agent — created lazily on the first real message. */
  agentId: string | null;
  conversationId: string | null;
  name: string;
  /** What they watch: general, sleep, money, work, study… */
  domain: string;
  /** Registry purpose id — every companion depends on a purpose. */
  purposeId: string;
  /** Standing brief — what this companion is responsible for doing. */
  brief: string | null;
  /** Free-text style notes layered on top of the sliders. */
  toneNote: string | null;
  /** Preferred connector providers for this companion (e.g. gmail, github). */
  connectors: string[];
  /** Fixed for life — this person is always this colour. */
  hue: number;
  faceSeed: number;
  /** A photo the person chose or took, in place of the generated face. Data
   *  URL, on-device only — null means "use the generated face". */
  avatarPhoto: string | null;
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
  /** Family household member who owns this companion (Family plans). */
  familyMemberId: string | null;
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
  /** Purpose that owns this task (when seeded from a template). */
  purposeId: string | null;
  /** Template id within the purpose — used to avoid duplicate seeds. */
  templateId: string | null;
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
  /**
   * Admin-managed Studio companion catalog. Synced with companion state so
   * every signed-in device sees the same list, names, briefs, and photos.
   */
  studioCatalog: StudioCatalogEntry[];
  /**
   * Extra Studio purposes published after ship — merged with built-in purposes
   * so new design kinds can be added without an app update.
   */
  studioPurposes: StudioPurposeDef[];
  /** Account id allowed to edit/remove Studio companions for everyone. */
  studioAdminAccountId: string | null;
}

/** Purpose playbook key — maps to standing instruction blocks. */
export type PurposePlaybookKey =
  | "arrab-assistant"
  | "ui-designer"
  | "inbox"
  | "coder"
  | "brand"
  | "copy"
  | "product-flow"
  | "personal"
  | "trader"
  | "general"
  | "custom";

/** Seed task attached to a purpose (becomes a suggested WorkItem). */
export type PurposeTaskTemplate = {
  id: string;
  title: string;
  titleAr: string;
  hint?: string;
  hintAr?: string;
};

/** Purpose kind used when adding a Studio companion (web, phone, …). */
export interface StudioPurposeDef {
  id: string;
  name: string;
  nameAr: string;
  blurb: string;
  blurbAr: string;
  /** Default workspace for companions created under this purpose. */
  workspace: "ui-designer" | "arrab-assistant" | "default";
  /** Seed brief — user can still customize name/photo. */
  brief: string;
  briefAr: string;
  toneName: CompanionToneName;
  hue: number;
  archivedAt: string | null;
  /** Standing playbook for agent instructions. */
  playbookKey: PurposePlaybookKey;
  /** Suggested tasks seeded when a companion takes this purpose. */
  taskTemplates: PurposeTaskTemplate[];
  /** When false, Chat-only — hidden from Studio add picker. */
  studioSelectable?: boolean;
}

/** Shared Studio companion definition (Individuals → Studio dock). */
export interface StudioCatalogEntry {
  id: string;
  domain: string;
  name: string;
  nameAr: string;
  blurb: string;
  blurbAr: string;
  brief: string;
  briefAr: string;
  toneName: CompanionToneName;
  workspace: "ui-designer" | "arrab-assistant" | "default";
  /** Links to a StudioPurposeDef id — extensible after publish. */
  purposeId: string;
  hue: number;
  faceSeed: number;
  avatarPhoto: string | null;
  archivedAt: string | null;
  /** Account id that created this entry — owners can always open; admins edit. */
  createdBy: string | null;
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
const SYNCED_AT_KEY = "arrab.companions.syncedAt";
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
const CLOUD_PUSH_MS = 900;

/** Distinct, fixed hues handed out in creation order. */
const HUES = [28, 268, 158, 208, 336, 48, 188, 300];

const DEFAULT_TONE: CompanionTone = {
  bluntness: 45,
  humour: 40,
  replyLength: 35,
  warmth: 55,
  formality: 35,
};

export const TONE_PRESETS: Record<CompanionToneName, CompanionTone> = {
  direct: { bluntness: 78, humour: 30, replyLength: 20, warmth: 40, formality: 45 },
  measured: { bluntness: 32, humour: 45, replyLength: 55, warmth: 60, formality: 40 },
};

export const TONE_STYLE_CHIPS: {
  id: string;
  toneName: CompanionToneName;
  tone: CompanionTone;
  labelEn: string;
  labelAr: string;
  hintEn: string;
  hintAr: string;
}[] = [
  {
    id: "direct",
    toneName: "direct",
    tone: TONE_PRESETS.direct,
    labelEn: "Direct",
    labelAr: "مباشر",
    hintEn: "Short, clear, no soft padding",
    hintAr: "قصير وواضح بلا لف",
  },
  {
    id: "measured",
    toneName: "measured",
    tone: TONE_PRESETS.measured,
    labelEn: "Measured",
    labelAr: "متوازن",
    hintEn: "Honest, paced, room to breathe",
    hintAr: "صادق بهدوء ومساحة للتنفس",
  },
  {
    id: "coach",
    toneName: "direct",
    tone: { bluntness: 72, humour: 28, replyLength: 48, warmth: 62, formality: 40 },
    labelEn: "Coach",
    labelAr: "مدرب",
    hintEn: "Pushes you, keeps advice practical",
    hintAr: "يدفعك ونصائحه عملية",
  },
  {
    id: "friend",
    toneName: "measured",
    tone: { bluntness: 38, humour: 72, replyLength: 50, warmth: 82, formality: 18 },
    labelEn: "Friend",
    labelAr: "صديق",
    hintEn: "Warm, light, easy to talk to",
    hintAr: "دافئ وخفيف وسهل الحديث",
  },
  {
    id: "pro",
    toneName: "direct",
    tone: { bluntness: 58, humour: 12, replyLength: 62, warmth: 35, formality: 78 },
    labelEn: "Professional",
    labelAr: "مهني",
    hintEn: "Crisp, formal, work-ready",
    hintAr: "صارم ومهني وجاهز للعمل",
  },
  {
    id: "quiet",
    toneName: "measured",
    tone: { bluntness: 22, humour: 12, replyLength: 18, warmth: 48, formality: 30 },
    labelEn: "Quiet",
    labelAr: "هادئ",
    hintEn: "Few words, soft edge",
    hintAr: "كلمات قليلة وحدود ناعمة",
  },
];

export const CALL_OUT_TOPICS = [
  "spending",
  "goals",
  "habits",
  "sleep",
  "focus",
  "health",
  "time",
  "relationships",
] as const;

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
    studioCatalog: [],
    studioPurposes: [],
    studioAdminAccountId: null,
  };
}

let cache: CompanionState | null = null;
let localReady = false;
let localReadyPromise: Promise<void> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let suppressCloudPush = false;
/** Mutations queued while the encrypted on-device vault is still opening. */
let pendingMutations: Array<(draft: CompanionState) => CompanionState | void> = [];
/** Stable empty snapshot while encrypted vault decrypts (useSyncExternalStore-safe). */
let pendingVaultSnapshot: CompanionState | null = null;

function readSyncedAt(): string | null {
  try {
    return localStorage.getItem(SYNCED_AT_KEY);
  } catch {
    return null;
  }
}

function writeSyncedAt(value: string): void {
  try {
    localStorage.setItem(SYNCED_AT_KEY, value);
  } catch {
    // ignore quota
  }
}

async function writeLocalState(state: CompanionState): Promise<void> {
  try {
    const sealed = await sealLocalJson(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed));
  } catch {
    // over quota / unavailable — keep the in-memory copy
  }
}

async function readLocalState(): Promise<CompanionState | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (looksEncryptedLocal(parsed)) {
      return normalizeState(await openLocalJson(parsed));
    }
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

/** Decrypt on-device companion vault before UI/cloud sync reads it. */
export async function ensureCompanionsReady(): Promise<CompanionState> {
  if (localReady && cache) {
    migratePurposeTasksOnce(cache);
    return cache;
  }
  if (!localReadyPromise) {
    localReadyPromise = (async () => {
      const loaded = await readLocalState();
      if (loaded) {
        cache = loaded;
        pendingVaultSnapshot = null;
        // Re-seal legacy plaintext so disk stays encrypted going forward.
        void writeLocalState(loaded);
      } else if (!cache) {
        cache = emptyState();
        pendingVaultSnapshot = null;
      }
      localReady = true;
    })();
  }
  await localReadyPromise;
  const hadPending = pendingMutations.length > 0;
  flushPendingMutations();
  if (!hadPending) {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  const state = cache ?? emptyState();
  migratePurposeTasksOnce(state);
  return cache ?? emptyState();
}

let purposeMigrateDone = false;

/** Idempotent: ensure every live companion has purpose-seeded tasks. */
function migratePurposeTasksOnce(state: CompanionState): void {
  if (purposeMigrateDone) return;
  purposeMigrateDone = true;
  for (const person of state.companions) {
    if (person.archivedAt) continue;
    const purposeId = person.purposeId || resolvePurposeIdFromDomain(person.domain);
    if (person.purposeId !== purposeId) {
      updateCompanion(person.id, { purposeId });
    }
    seedPurposeTasks(person.id, purposeId, person.space);
  }
}

function normalizeState(raw: unknown): CompanionState {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<CompanionState>;
  const next: CompanionState = { ...emptyState(), ...parsed, version: 2 };
  next.companions = (next.companions ?? []).map((person) => {
    const purposeId =
      typeof (person as CompanionProfile).purposeId === "string" &&
      (person as CompanionProfile).purposeId
        ? (person as CompanionProfile).purposeId
        : resolvePurposeIdFromDomain(person.domain ?? "custom");
    return {
      ...person,
      purposeId,
      brief: person.brief ?? null,
      toneNote: typeof person.toneNote === "string" ? person.toneNote : null,
      connectors: Array.isArray(person.connectors) ? person.connectors : [],
      familyMemberId:
        typeof (person as CompanionProfile).familyMemberId === "string"
          ? (person as CompanionProfile).familyMemberId
          : null,
      tone: {
        bluntness: Number(person.tone?.bluntness ?? DEFAULT_TONE.bluntness),
        humour: Number(person.tone?.humour ?? DEFAULT_TONE.humour),
        replyLength: Number(person.tone?.replyLength ?? DEFAULT_TONE.replyLength),
        warmth: Number(person.tone?.warmth ?? DEFAULT_TONE.warmth),
        formality: Number(person.tone?.formality ?? DEFAULT_TONE.formality),
      },
    };
  });
  next.facts = (Array.isArray(next.facts) ? next.facts : [])
    .filter((fact) => fact && typeof fact.text === "string" && fact.text.trim())
    .map((fact) => ({
      id: typeof fact.id === "string" && fact.id ? fact.id : newId("fact"),
      companionId:
        typeof fact.companionId === "string" && fact.companionId ? fact.companionId : null,
      text: String(fact.text).trim(),
      source: typeof fact.source === "string" ? fact.source : "",
      kind: fact.kind === "inferred" ? ("inferred" as const) : ("explicit" as const),
      derivedFrom:
        fact.derivedFrom === "health" ||
        fact.derivedFrom === "calendar" ||
        fact.derivedFrom === "contacts"
          ? fact.derivedFrom
          : null,
      space: fact.space === "work" ? ("work" as const) : ("personal" as const),
      shared: fact.shared !== false,
      createdAt: typeof fact.createdAt === "string" && fact.createdAt ? fact.createdAt : nowIso(),
    }));
  next.nudges = Array.isArray(next.nudges) ? next.nudges : [];
  next.work = Array.isArray(next.work)
    ? next.work.map((item) => ({
        ...item,
        purposeId: item.purposeId ?? null,
        templateId: item.templateId ?? null,
      }))
    : [];
  next.threads = Array.isArray(next.threads) ? next.threads : [];
  next.topics = next.topics && typeof next.topics === "object" ? next.topics : {};
  next.permissions = {
    health: Boolean(next.permissions?.health),
    calendar: Boolean(next.permissions?.calendar),
    contacts: Boolean(next.permissions?.contacts),
  };
  next.dismissals =
    next.dismissals && typeof next.dismissals === "object" ? next.dismissals : {};
  next.studioCatalog = Array.isArray(next.studioCatalog)
    ? next.studioCatalog.map((entry) => ({
        ...entry,
        avatarPhoto: entry.avatarPhoto ?? null,
        archivedAt: entry.archivedAt ?? null,
        hue: typeof entry.hue === "number" ? entry.hue : 268,
        faceSeed: typeof entry.faceSeed === "number" ? entry.faceSeed : 41,
        workspace:
          entry.workspace === "ui-designer"
            ? "ui-designer"
            : entry.workspace === "arrab-assistant"
              ? "arrab-assistant"
              : "default",
        toneName: entry.toneName === "direct" ? "direct" : "measured",
        purposeId: typeof entry.purposeId === "string" && entry.purposeId ? entry.purposeId : "web-design",
        createdBy: entry.createdBy ?? null,
      }))
    : [];
  next.studioPurposes = Array.isArray(next.studioPurposes)
    ? next.studioPurposes.map((purpose) => {
        const base = purposeRegistryById(purpose.id);
        return {
          ...purpose,
          archivedAt: purpose.archivedAt ?? null,
          workspace:
            purpose.workspace === "ui-designer"
              ? "ui-designer"
              : purpose.workspace === "arrab-assistant"
                ? "arrab-assistant"
                : "default",
          toneName: purpose.toneName === "direct" ? "direct" : "measured",
          hue: typeof purpose.hue === "number" ? purpose.hue : 268,
          playbookKey: purpose.playbookKey ?? base?.playbookKey ?? "custom",
          taskTemplates: Array.isArray(purpose.taskTemplates)
            ? purpose.taskTemplates
            : base?.taskTemplates ?? [],
          studioSelectable: purpose.studioSelectable ?? base?.studioSelectable ?? true,
        };
      })
    : [];
  next.studioAdminAccountId =
    typeof next.studioAdminAccountId === "string" ? next.studioAdminAccountId : null;
  return next;
}

function hydrate(): CompanionState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = emptyState();
      localReady = true;
      pendingVaultSnapshot = null;
      return cache;
    }
    const parsed = JSON.parse(raw) as unknown;
    // Encrypted vault needs ensureCompanionsReady(); never poison cache with empty.
    if (looksEncryptedLocal(parsed)) {
      void ensureCompanionsReady();
      pendingVaultSnapshot ??= emptyState();
      return pendingVaultSnapshot;
    }
    cache = normalizeState(parsed);
    localReady = true;
    pendingVaultSnapshot = null;
    void writeLocalState(cache);
    return cache;
  } catch {
    // corrupt or unavailable storage — start clean rather than crash the studio
  }
  cache = emptyState();
  localReady = true;
  pendingVaultSnapshot = null;
  return cache;
}

export function getCompanionState(): CompanionState {
  return hydrate();
}

export function companionsVaultReady(): boolean {
  return localReady && cache !== null;
}

function scheduleCloudPush(): void {
  if (suppressCloudPush) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushCompanionsToCloud();
  }, CLOUD_PUSH_MS);
}

async function pushCompanionsToCloud(): Promise<void> {
  if (pushInFlight || suppressCloudPush) return;
  pushInFlight = true;
  try {
    await ensureCompanionsReady();
    const state = hydrate();
    const updatedAt = nowIso();
    await arrabApi.putCompanionState({ updatedAt, state });
    writeSyncedAt(updatedAt);
  } catch {
    // offline / API down — local copy remains; next change retries
  } finally {
    pushInFlight = false;
  }
}

/**
 * Pull companions + chat pointers from the API database.
 * Remote wins only when clearly newer; never wipe local memories on first sync.
 */
export async function syncCompanionsFromCloud(): Promise<void> {
  try {
    await ensureCompanionsReady();
    const doc = await arrabApi.companionState();
    const local = hydrate();
    const localSyncedAt = readSyncedAt();

    if (doc.state && typeof doc.state === "object") {
      const remote = normalizeState(doc.state);
      const remoteAt = doc.updatedAt ?? "";
      const localHasData = local.companions.length > 0 || local.facts.length > 0;
      const remoteHasData = remote.companions.length > 0 || remote.facts.length > 0;
      const shouldTakeRemote =
        Boolean(remoteAt) &&
        ((!localSyncedAt && !localHasData && remoteHasData) ||
          (localSyncedAt != null && remoteAt > localSyncedAt) ||
          (!localHasData && remoteHasData));

      if (shouldTakeRemote) {
        suppressCloudPush = true;
        // Keep any local-only facts the remote does not know yet.
        const merged = mergeFactsPreferLocal(remote, local);
        cache = merged;
        await writeLocalState(merged);
        if (remoteAt) writeSyncedAt(remoteAt);
        window.dispatchEvent(new Event(CHANGE_EVENT));
        suppressCloudPush = false;
        return;
      }
    }

    if (local.companions.length > 0 || local.facts.length > 0) {
      await pushCompanionsToCloud();
    }
  } catch {
    // stay on local cache when the cloud is unreachable
  }
}

function mergeFactsPreferLocal(remote: CompanionState, local: CompanionState): CompanionState {
  const byId = new Map<string, CompanionFact>();
  for (const fact of remote.facts) byId.set(fact.id, fact);
  for (const fact of local.facts) byId.set(fact.id, fact);
  return {
    ...remote,
    facts: [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}

function flushPendingMutations(): void {
  if (!pendingMutations.length || !cache) return;
  const queued = pendingMutations.splice(0, pendingMutations.length);
  const draft = structuredClone(cache);
  for (const mutate of queued) {
    mutate(draft);
  }
  commit(draft);
}

function commit(next: CompanionState): void {
  cache = next;
  localReady = true;
  pendingVaultSnapshot = null;
  void writeLocalState(next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  scheduleCloudPush();
}

function update(mutate: (draft: CompanionState) => CompanionState | void): CompanionState {
  if (!localReady || !cache) {
    pendingMutations.push(mutate);
    void ensureCompanionsReady();
    return cache ?? emptyState();
  }
  const draft: CompanionState = structuredClone(cache);
  const result = mutate(draft) ?? draft;
  commit(result);
  return result;
}

function subscribe(listener: () => void): () => void {
  /** Another studio window wrote to disk — drop our copy and read it again. */
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    cache = null;
    localReady = false;
    localReadyPromise = null;
    void ensureCompanionsReady().then(() => listener());
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

/** General is always available. Opening the room does not create a companion. */
export function generalCompanion(state: CompanionState, space: CompanionSpace): CompanionProfile {
  return (
    liveCompanions(state, space).find((person) => person.domain === "general") ?? {
      id: `general-${space}`,
      name: "General",
      domain: "general",
      purposeId: "general",
      brief: null,
      toneNote: null,
      connectors: [],
      space,
      agentId: null,
      conversationId: null,
      hue: 255,
      faceSeed: 0,
      avatarPhoto: null,
      tone: { ...DEFAULT_TONE },
      toneName: "measured",
      callOut: [],
      lastMemory: null,
      lastLine: null,
      lastAt: null,
      resume: null,
      familyMemberId: null,
      createdAt: "",
      archivedAt: null,
    }
  );
}

/** Persist the General room only when a message actually needs a backing agent. */
export function ensureGeneralCompanion(space: CompanionSpace): CompanionProfile {
  const person = generalCompanion(getCompanionState(), space);
  if (person.createdAt) return person;
  return addCompanion({ name: "General", domain: "general", purposeId: "general", space });
}

export function addCompanion(input: {
  name: string;
  domain: string;
  purposeId?: string;
  brief?: string | null;
  connectors?: string[];
  space?: CompanionSpace;
  toneName?: CompanionToneName;
  callOut?: string[];
  /** When false, skip seeding purpose task templates. */
  seedTasks?: boolean;
  /** Stable face seed — presets pass this so the catalog portrait matches. */
  faceSeed?: number;
  hue?: number;
}): CompanionProfile {
  const purposeId = resolvePurposeIdFromDomain(input.domain, input.purposeId);
  const purpose = purposeRegistryById(purposeId);
  const state = getCompanionState();
  const taken = [
    ...state.companions
      .filter((person) => !person.archivedAt && person.domain !== "general")
      .map((person) => resolveCompanionPortraitSrc(person)),
    ...state.studioCatalog
      .filter((entry) => !entry.archivedAt)
      .map((entry) => entry.avatarPhoto)
      .filter((url): url is string => Boolean(url?.trim())),
  ];
  const portrait = allocateUniquePortrait({
    domain: input.domain,
    name: input.name.trim(),
    faceSeed: input.faceSeed,
    purposeId,
    taken,
  });
  const created: CompanionProfile = {
    id: newId("comp"),
    agentId: null,
    conversationId: null,
    name: input.name.trim(),
    domain: input.domain,
    purposeId,
    brief: input.brief?.trim() || purpose?.brief || null,
    toneNote: null,
    connectors: [...(input.connectors ?? [])],
    hue: input.hue ?? 0,
    faceSeed: portrait.faceSeed,
    // Lock a unique vector face at birth so new companions never share one.
    avatarPhoto: portrait.avatarPhoto,
    space: input.space ?? "personal",
    tone: input.toneName ? { ...TONE_PRESETS[input.toneName] } : { ...DEFAULT_TONE },
    toneName: input.toneName ?? purpose?.toneName ?? "measured",
    callOut: input.callOut ?? [],
    lastMemory: null,
    lastLine: null,
    lastAt: null,
    resume: null,
    familyMemberId: (() => {
      try {
        return localStorage.getItem("arrab.family.activeMemberId");
      } catch {
        return null;
      }
    })(),
    createdAt: nowIso(),
    archivedAt: null,
  };
  let stored = created;
  update((draft) => {
    stored = {
      ...created,
      hue: input.hue ?? HUES[draft.companions.length % HUES.length]!,
    };
    draft.companions.push(stored);
    // A companion is never born empty — it starts with what made it exist.
    draft.topics[created.domain] = { count: 0, lastAt: nowIso() };
  });
  if (input.seedTasks !== false) {
    seedPurposeTasks(stored.id, purposeId, stored.space);
  }
  return stored;
}

export function updateCompanion(id: string, patch: Partial<CompanionProfile>): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) Object.assign(person, patch);
  });
}

/** Set or clear a companion's photo. Passing null goes back to the generated face. */
export function setCompanionAvatar(id: string, avatarPhoto: string | null): void {
  updateCompanion(id, { avatarPhoto });
}

/** Live admin-managed Studio catalog (may be empty — defaults live in studio-catalog). */
export function getStudioCatalogEntries(state = getCompanionState()): StudioCatalogEntry[] {
  return state.studioCatalog.filter((entry) => !entry.archivedAt);
}

/** Replace the shared Studio catalog — pushes to the cloud with companion state. */
export function saveStudioCatalog(entries: StudioCatalogEntry[]): void {
  update((draft) => {
    draft.studioCatalog = entries.map((entry) => ({ ...entry }));
  });
}

export function upsertStudioCatalogEntry(entry: StudioCatalogEntry): void {
  update((draft) => {
    const index = draft.studioCatalog.findIndex((item) => item.id === entry.id);
    if (index >= 0) draft.studioCatalog[index] = { ...entry };
    else draft.studioCatalog.push({ ...entry });
  });
}

export function archiveStudioCatalogEntry(id: string): void {
  update((draft) => {
    const entry = draft.studioCatalog.find((item) => item.id === id);
    if (entry) entry.archivedAt = nowIso();
  });
}

/** Publish extra purposes (after app ship) so everyone can pick them when adding. */
export function saveStudioPurposes(purposes: StudioPurposeDef[]): void {
  update((draft) => {
    draft.studioPurposes = purposes.map((item) => ({ ...item }));
  });
}

export function getStudioPurposeEntries(state = getCompanionState()): StudioPurposeDef[] {
  return state.studioPurposes.filter((item) => !item.archivedAt);
}

/** Claim or read the shared Studio admin (synced). First claim wins. */
export function getStudioAdminAccountId(state = getCompanionState()): string | null {
  return state.studioAdminAccountId;
}

export function claimStudioAdminAccount(accountId: string): void {
  update((draft) => {
    if (!draft.studioAdminAccountId) draft.studioAdminAccountId = accountId;
  });
}

export function setCompanionTone(id: string, tone: Partial<CompanionTone>): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) person.tone = { ...person.tone, ...tone };
  });
}

export function applyCompanionToneStyle(
  id: string,
  tone: CompanionTone,
  toneName: CompanionToneName,
): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (!person) return;
    person.tone = { ...tone };
    person.toneName = toneName;
  });
}

export function resetCompanionTone(id: string): void {
  update((draft) => {
    const person = draft.companions.find((item) => item.id === id);
    if (person) person.tone = { ...TONE_PRESETS[person.toneName] };
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

/** Turn tone + watches + purpose + connectors + memory into standing agent instructions. */
export function companionInstructions(
  person: CompanionProfile,
  facts: CompanionFact[],
  locale: "en" | "ar" = "en",
): string {
  const bluntness =
    person.tone.bluntness > 66
      ? "Be direct."
      : person.tone.bluntness > 33
        ? "Be honest but gentle."
        : "Be careful; ask before judging.";
  const humour = person.tone.humour > 60 ? "Light dry humour ok." : "Minimal humour.";
  const length =
    person.tone.replyLength > 66
      ? "Full answers when needed."
      : person.tone.replyLength > 33
        ? "2–3 sentences."
        : "1–2 lines max.";
  const warmth =
    person.tone.warmth > 66
      ? "Warm and encouraging."
      : person.tone.warmth > 33
        ? "Steady warmth."
        : "Reserved; keep emotional distance.";
  const formality =
    person.tone.formality > 66
      ? "Professional register."
      : person.tone.formality > 33
        ? "Natural spoken register."
        : "Casual, like a close friend.";
  const callOut = person.callOut.length
    ? `Call out: ${person.callOut.join(", ")}.`
    : "Do not moralise unprompted.";
  const toneNote = person.toneNote?.trim()
    ? `Style notes from the operator: ${person.toneNote.trim().slice(0, 400)}`
    : null;
  const known = facts
    .filter((fact) => fact.shared || fact.companionId === person.id)
    .slice(0, 8)
    .map((fact) => `- ${fact.text.slice(0, 160)}`)
    .join("\n");
  const brainBits = brainContextSnippet("individual", person.id, locale, 6);
  const purposeId = person.purposeId || resolvePurposeIdFromDomain(person.domain);
  const purpose = purposeRegistryById(purposeId);
  const brief = (person.brief?.trim() || purpose?.brief || "").slice(0, 600);
  const connectors = person.connectors?.filter(Boolean) ?? [];
  const watches = person.domain.trim();
  const isGeneral = purposeId === "general" || watches === "general";
  const playbook =
    playbookText(purpose?.playbookKey ?? "custom") ||
    (connectors.some((item) => ["gmail", "outlook", "email"].includes(item))
      ? playbookText("inbox")
      : null);
  const openTasks = openPurposeTaskLines(person.id, purposeId, locale);
  const displayName = person.name;
  const purposeLabel =
    purpose && locale === "ar" ? purpose.nameAr : purpose?.name ?? purposeId;

  return [
    `You are ${displayName}, a companion — not a generic chatbot.`,
    `PURPOSE ID: ${purposeId} (${purposeLabel}).`,
    isGeneral
      ? "Open room for anything without a specialist companion."
      : `WATCHES only: ${watches}. Stay in remit.`,
    brief
      ? `PURPOSE:\n${brief}`
      : isGeneral
        ? "Help them start, clarify, or hand off."
        : `Specialist in ${watches}; concrete next steps.`,
    connectors.length ? `Connectors: ${connectors.join(", ")}.` : null,
    playbook,
    openTasks.length
      ? `OPEN PURPOSE TASKS (help advance these):\n${openTasks.map((line) => `- ${line}`).join("\n")}`
      : null,
    "LANGUAGE: Match the operator's latest message. English → reply in English. Arabic → reply in Arabic.",
    locale === "ar"
      ? "UI locale is Arabic — prefer Arabic names/labels when speaking about the product UI."
      : "UI locale is English — prefer English names/labels when speaking about the product UI.",
    "You may use web_search, scrape_page, and fetch_url for live research when helpful.",
    "Deliverables when useful: preview_html and generate_pdf (in-app preview).",
    `Tone: ${bluntness} ${humour} ${length} ${warmth} ${formality} ${callOut}`,
    toneNote,
    "Use memory notes as facts. Never invent memories.",
    known ? `Memory:\n${known}` : "New here — ask, do not assume.",
    brainBits || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Compact per-turn profile for the Arrab API workspaceHint — keeps replies grounded
 * in notes + settings even when the agent row is briefly stale.
 * Kept short on purpose: every extra token slows OpenRouter TTFT.
 */
export function companionTurnNotes(person: CompanionProfile, facts: CompanionFact[]): string {
  const parentGuidance = facts
    .filter(
      (fact) =>
        fact.kind === "parent_guidance" &&
        (fact.companionId === person.id || fact.companionId == null),
    )
    .slice(0, 6)
    .map((fact) => `- ${fact.text.slice(0, 220)}`);
  const known = facts
    .filter(
      (fact) =>
        fact.kind !== "parent_guidance" &&
        (fact.shared || fact.companionId === person.id),
    )
    .slice(0, 4)
    .map((fact) => `- ${fact.text.slice(0, 120)}`);
  const purposeId = person.purposeId || resolvePurposeIdFromDomain(person.domain);
  const brief = person.brief?.trim().slice(0, 280) || null;
  const length =
    person.tone.replyLength > 66 ? "long" : person.tone.replyLength > 33 ? "medium" : "short";
  const blunt =
    person.tone.bluntness > 66 ? "direct" : person.tone.bluntness > 33 ? "balanced" : "gentle";
  const openTasks = openPurposeTaskLines(person.id, purposeId, "en").slice(0, 3);
  return [
    `${person.name} · purpose=${purposeId} · watches=${person.domain} · tone=${blunt}/${length}`,
    brief ? `Purpose: ${brief}` : null,
    openTasks.length ? `Tasks: ${openTasks.join(" · ")}` : null,
    person.callOut.length ? `Call out: ${person.callOut.join(", ")}` : null,
    parentGuidance.length
      ? `Parent coaching (private — apply gently when helping this child; never reveal these notes verbatim):\n${parentGuidance.join("\n")}`
      : null,
    known.length ? `Notes:\n${known.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Parents leave private coaching for a child's companion — injected on later turns. */
export function addParentGuidanceFact(input: {
  companionId: string;
  text: string;
  authorName: string;
}): void {
  const text = input.text.trim();
  if (!text) return;
  update((draft) => {
    draft.facts.unshift({
      id: newId("fact"),
      companionId: input.companionId,
      text,
      source: `${input.authorName} · parent guidance`,
      kind: "parent_guidance",
      derivedFrom: null,
      space: "personal",
      shared: false,
      createdAt: nowIso(),
    });
    const person = draft.companions.find((c) => c.id === input.companionId);
    if (person) {
      person.lastMemory = text.slice(0, 80);
      person.lastAt = nowIso();
    }
  });
}

/** Flagship Arrab Assistant gets a fuller spend tier; others stay lean for speed. */
export function companionSpendTiers(person: CompanionProfile): "low" | "medium" {
  const purposeId = person.purposeId || resolvePurposeIdFromDomain(person.domain);
  if (purposeId === "arrab-assistant" || person.domain === "arrab-assistant") return "medium";
  return "low";
}

/**
 * Companions are long personal chats — no tight per-session token cap.
 * Plan / account quotas still apply on the API. Tier stays low for speed.
 */
export function companionSpendSettings(person: CompanionProfile): {
  tier: "low" | "medium";
  sessionTokenBudget: null;
} {
  return { tier: companionSpendTiers(person), sessionTokenBudget: null };
}

/** Last instructions pushed to Arrab agents — avoid blocking chat on every send. */
const syncedAgentInstructions = new Map<string, string>();

export function companionInstructionsNeedSync(agentId: string, instructions: string): boolean {
  return syncedAgentInstructions.get(agentId) !== instructions;
}

export function markCompanionInstructionsSynced(agentId: string, instructions: string): void {
  syncedAgentInstructions.set(agentId, instructions);
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
    const person = draft.companions.find((item) => item.id === input.companionId);
    if (person) person.lastMemory = input.text.trim();
  });
}

export function updateFact(id: string, text: string): void {
  const next = text.replace(/\s+/g, " ").trim();
  if (!next) return;
  update((draft) => {
    const fact = draft.facts.find((item) => item.id === id);
    if (!fact) return;
    fact.text = next;
    const person = draft.companions.find((item) => item.id === fact.companionId);
    if (person?.lastMemory) person.lastMemory = next;
  });
}

/** Real deletion: the fact goes, and anything standing on it goes too. */
export function deleteFact(id: string): void {
  update((draft) => {
    const fact = draft.facts.find((item) => item.id === id);
    draft.facts = draft.facts.filter((item) => item.id !== id);
    if (!fact) return;
    const person = draft.companions.find((item) => item.id === fact.companionId);
    if (person)
      person.lastMemory = draft.facts.find((item) => item.companionId === person.id)?.text ?? null;
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
export function visibleFacts(
  state: CompanionState,
  person: CompanionProfile | null,
): CompanionFact[] {
  return state.facts.filter((fact) => {
    if (fact.derivedFrom && !state.permissions[fact.derivedFrom]) return false;
    if (!person) return true;
    if (!fact.shared && fact.companionId !== person.id) return false;
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

interface WorkCaptureInput {
  companionId: string | null;
  text: string;
  capturedFrom: string;
  space?: CompanionSpace;
  suggestedTime?: string | null;
  purposeId?: string | null;
  templateId?: string | null;
}

function saveWork(input: WorkCaptureInput, intent: "suggested" | "accepted"): WorkItem | null {
  const text = input.text.trim();
  if (!text) return null;
  const space = input.space ?? "personal";
  let saved: WorkItem | null = null;
  update((draft) => {
    if (input.templateId && input.companionId) {
      const dup = draft.work.find(
        (item) =>
          item.companionId === input.companionId &&
          item.templateId === input.templateId &&
          item.state !== "declined",
      );
      if (dup) {
        saved = dup;
        return;
      }
    }
    const existing = draft.work.find(
      (item) =>
        item.space === space &&
        item.text.toLowerCase() === text.toLowerCase() &&
        (intent === "suggested" || item.state === "suggested" || item.state === "accepted"),
    );
    if (existing) {
      // An explicit add is also consent for an existing suggestion in this space.
      if (intent === "accepted" && existing.state === "suggested") {
        existing.state = "accepted";
        existing.touchedAt = nowIso();
      }
      saved = existing;
      return;
    }
    saved = {
      id: newId("work"),
      companionId: input.companionId,
      text,
      state: intent,
      suggestedTime: input.suggestedTime ?? (intent === "suggested" ? nextFreeSlot() : null),
      postponeCount: 0,
      capturedFrom: input.capturedFrom,
      space,
      createdAt: nowIso(),
      touchedAt: nowIso(),
      purposeId: input.purposeId ?? null,
      templateId: input.templateId ?? null,
    };
    draft.work.unshift(saved);
  });
  return saved;
}

/** Seed suggested WorkItems from purpose task templates (idempotent by templateId). */
export function seedPurposeTasks(
  companionId: string,
  purposeId: string,
  space: CompanionSpace = "personal",
  locale: "en" | "ar" = "en",
): WorkItem[] {
  const templates = tasksForPurpose(purposeId);
  const created: WorkItem[] = [];
  for (const template of templates) {
    const title = locale === "ar" ? template.titleAr : template.title;
    const item = captureWork({
      companionId,
      text: title,
      capturedFrom: `purpose:${purposeId}`,
      space,
      purposeId,
      templateId: template.id,
    });
    if (item) created.push(item);
  }
  return created;
}

/** Open (suggested/accepted) purpose-owned task titles for a companion. */
export function openPurposeTaskLines(
  companionId: string,
  purposeId: string,
  locale: "en" | "ar" = "en",
): string[] {
  const state = getCompanionState();
  const fromWork = state.work
    .filter(
      (item) =>
        item.companionId === companionId &&
        (item.state === "suggested" || item.state === "accepted") &&
        (item.purposeId === purposeId || item.templateId),
    )
    .map((item) => item.text);
  if (fromWork.length) return fromWork.slice(0, 8);
  // Fallback to templates when not yet seeded (virtual general, etc.).
  return tasksForPurpose(purposeId)
    .slice(0, 5)
    .map((item) => (locale === "ar" ? item.titleAr : item.title));
}

/** Bind or rebind a companion to a purpose and seed missing template tasks. */
export function syncCompanionPurpose(
  companionId: string,
  purposeId: string,
  options?: { reseedsuggested?: boolean },
): void {
  const purpose = purposeRegistryById(purposeId);
  if (!purpose) return;
  let space: CompanionSpace = "personal";
  update((draft) => {
    const person = draft.companions.find((item) => item.id === companionId);
    if (!person) return;
    space = person.space;
    person.purposeId = purposeId;
    if (!person.brief?.trim()) person.brief = purpose.brief;
  });
  seedPurposeTasks(companionId, purposeId, space);
  if (options?.reseedsuggested) {
    // reserved for future: clear declined template slots
  }
}

/** Purpose tasks for a companion (suggested + accepted + done — stay visible when checked). */
export function purposeWorkForCompanion(
  state: CompanionState,
  companionId: string,
): WorkItem[] {
  return state.work.filter(
    (item) =>
      item.companionId === companionId &&
      (item.templateId || item.purposeId) &&
      item.state !== "declined",
  );
}

/** Automatic captures and saved ideas remain suggestions until accepted. */
export function captureWork(input: WorkCaptureInput): WorkItem | null {
  return saveWork(input, "suggested");
}

/** Choosing “Add task” is consent; no second acceptance step is needed. */
export function addWorkTask(input: WorkCaptureInput): WorkItem | null {
  return saveWork(input, "accepted");
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
      (thread) =>
        thread.space === (input.space ?? "personal") &&
        thread.title.toLowerCase() === input.title.trim().toLowerCase(),
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

function dismissKey(card: {
  nudgeId: string | null;
  workId: string | null;
  threadId: string | null;
}): string {
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
    .filter(
      (card, index, sorted) =>
        sorted.findIndex((other) => other.companionId === card.companionId) === index,
    )
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
