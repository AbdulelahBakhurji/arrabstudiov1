import type { PlanAudience } from "./account.js";
import type { DeskRepeat } from "./desk.js";

/** A standing lane. The roster depends on the studio audience. */
export type CrewLane =
  | "chief"
  | "research"
  | "maker"
  | "household"
  | "study"
  | "care"
  | "inbox"
  | "people"
  | "delivery";

/** What a rule governs. Notes may run. Outbound work cannot. */
export type CrewAction = "research" | "draft" | "message" | "spend" | "computer" | "publish";

export type CrewRuleLevel = "allow" | "ask" | "block" | "handoff";

export type CrewPresence = "idle" | "working" | "needs_you" | "paused";

export type CrewEventKind = "rule" | "pass" | "note" | "brief" | "focus" | "routine";

export const CREW_ACTIONS: readonly CrewAction[] = [
  "research",
  "draft",
  "message",
  "spend",
  "computer",
  "publish",
];

export const CREW_RULE_LEVELS: readonly CrewRuleLevel[] = ["allow", "ask", "block", "handoff"];

export const CREW_WRITES_PER_DAY = 20;

export interface CrewMember {
  id: string;
  lane: CrewLane;
  name: string;
  nameAr: string;
  duty: string;
  dutyAr: string;
  /** Person-written preference. Empty means the stock duty is still in force. */
  customDuty: string;
  paused: boolean;
}

export interface CrewRule {
  action: CrewAction;
  level: CrewRuleLevel;
}

export interface CrewWatch {
  id: string;
  memberId: string;
  title: string;
  titleAr: string;
  /** Steps the person showed once. The watch only writes a note from them. */
  steps: string;
  stepsAr: string;
  hour: number;
  repeat: DeskRepeat;
  paused: boolean;
  /** YYYY-MM-DD in Asia/Riyadh. Empty until a note is written. */
  lastRunDay: string;
  due: boolean;
  lastNote: string;
}

export interface CrewPass {
  id: string;
  fromId: string;
  /** Member id, or "person" when the work comes back to the owner. */
  toId: string;
  title: string;
  note: string;
  action: CrewAction;
  status: "open" | "done";
  createdAt: string;
}

export interface CrewBriefing {
  day: string;
  text: string;
  createdAt: string;
}

export interface CrewFocus {
  title: string;
  note: string;
  updatedAt: string;
}

export interface CrewEvent {
  id: string;
  kind: CrewEventKind;
  memberId: string | null;
  text: string;
  textAr: string;
  createdAt: string;
}

export interface CrewNext {
  id: string;
  memberId: string;
  title: string;
  titleAr: string;
  hour: number;
  when: "today" | "tomorrow";
}

export interface CrewPackWatch {
  memberId: string;
  title: string;
  titleAr: string;
  steps: string;
  stepsAr: string;
  hour: number;
  repeat: DeskRepeat;
}

export interface CrewPack {
  id: string;
  title: string;
  titleAr: string;
  detail: string;
  detailAr: string;
  watches: CrewPackWatch[];
}

export interface CrewState {
  audience: PlanAudience;
  members: CrewMember[];
  rules: CrewRule[];
  watches: CrewWatch[];
  passes: CrewPass[];
  briefing: CrewBriefing | null;
  /** Standing aim for this studio. Empty until the person sets one. */
  focus: CrewFocus | null;
  events: CrewEvent[];
  writesToday: number;
  writesDay: string;
  /** Member whose note is being written. Null when the crew is idle. */
  workingId: string | null;
}

export interface CrewView extends CrewState {
  presence: Record<string, CrewPresence>;
  /** False when the saved roster belongs to a different studio audience. */
  fitted: boolean;
  writesAllowance: number;
  next: CrewNext | null;
}

export interface SetCrewRuleRequest {
  action: CrewAction;
  level: CrewRuleLevel;
}

export interface UpdateCrewMemberRequest {
  paused?: boolean;
  customDuty?: string;
}

export interface AddCrewWatchRequest {
  memberId: string;
  title: string;
  steps?: string;
  hour: number;
  repeat?: DeskRepeat;
}

export interface AddCrewPassRequest {
  fromId: string;
  toId: string;
  title: string;
  note?: string;
}

export interface SetCrewFocusRequest {
  title: string;
  note?: string;
}

const LANES: readonly CrewLane[] = [
  "chief",
  "research",
  "maker",
  "household",
  "study",
  "care",
  "inbox",
  "people",
  "delivery",
];

const SPEND =
  /\b(pay|payment|invoice|transfer|wire|purchase|checkout)\b|ادفع|فاتورة|حوّل|حول|اشتري/i;
const PUBLISH = /\b(publish|post publicly)\b|انشر/i;
const MESSAGE =
  /\b(send|email|e-mail|whatsapp|sms|dm|message them|text them)\b|أرسل|ارسِل|راسل|واتساب/i;
const COMPUTER = /\b(sudo|rm\s+-rf|shell|terminal|run this command)\b|شغّل الأمر|سطر الأوامر/i;
const SENSITIVE =
  /\b(password|passwd|secret)\b|كلمة السر|كلمة المرور/i;

export function defaultCrewRules(): CrewRule[] {
  return [
    { action: "research", level: "allow" },
    { action: "draft", level: "ask" },
    { action: "message", level: "handoff" },
    { action: "spend", level: "handoff" },
    { action: "computer", level: "ask" },
    { action: "publish", level: "handoff" },
  ];
}

/** Money, messages, and publishing cannot run unattended. The computer always asks. */
export function clampCrewLevel(action: CrewAction, level: CrewRuleLevel): CrewRuleLevel {
  if (action === "message" || action === "spend" || action === "publish") {
    return level === "allow" ? "handoff" : level;
  }
  if (action === "computer") return level === "allow" ? "ask" : level;
  return level;
}

export function crewPacks(audience: PlanAudience): CrewPack[] {
  if (audience === "family") {
    return [
      {
        id: "school",
        title: "School week",
        titleAr: "أسبوع المدرسة",
        detail: "Homework, the bag, and a calm close. Nothing is sent.",
        detailAr: "الواجب والحقيبة وخاتمة هادئة. لا يُرسَل شيء.",
        watches: [
          {
            memberId: "crew_study",
            title: "Homework left",
            titleAr: "ما تبقى من الواجب",
            steps: "Name one school task still open. Do not message a teacher.",
            stepsAr: "سمِّ واجباً مدرسياً ما زال مفتوحاً. لا تراسل معلماً.",
            hour: 16,
            repeat: "weekdays",
          },
          {
            memberId: "crew_household",
            title: "Tomorrow's bag",
            titleAr: "حقيبة الغد",
            steps: "List what must be in the bag. Do not pay for it.",
            stepsAr: "اذكر ما يجب أن يكون في الحقيبة. لا تدفع ثمنه.",
            hour: 19,
            repeat: "weekdays",
          },
          {
            memberId: "crew_care",
            title: "Wind-down",
            titleAr: "نهاية اليوم",
            steps: "Name the quiet hour. Do not report a private chat.",
            stepsAr: "سمِّ ساعة الهدوء. لا تنقل دردشة خاصة.",
            hour: 20,
            repeat: "daily",
          },
        ],
      },
    ];
  }
  if (audience === "organization") {
    return [
      {
        id: "operating",
        title: "Operating day",
        titleAr: "يوم التشغيل",
        detail: "Who is blocked, which drafts are open, and what can ship.",
        detailAr: "من متوقف، وأي مسودات مفتوحة، وما يمكن تسليمه.",
        watches: [
          {
            memberId: "crew_people",
            title: "Who is blocked",
            titleAr: "من متوقف",
            steps: "Name one person waiting on a decision. Do not message them.",
            stepsAr: "سمِّ شخصاً ينتظر قراراً. لا تراسله.",
            hour: 9,
            repeat: "weekdays",
          },
          {
            memberId: "crew_inbox",
            title: "Drafts still open",
            titleAr: "مسودات ما زالت مفتوحة",
            steps: "List replies that are drafted and unsent.",
            stepsAr: "اذكر الردود المكتوبة ولم تُرسل.",
            hour: 13,
            repeat: "weekdays",
          },
          {
            memberId: "crew_delivery",
            title: "Ready to ship",
            titleAr: "جاهز للتسليم",
            steps: "Name what could ship today. Do not publish it.",
            stepsAr: "سمِّ ما يمكن تسليمه اليوم. لا تنشره.",
            hour: 17,
            repeat: "weekdays",
          },
        ],
      },
    ];
  }
  return [
    {
      id: "founder",
      title: "Founder day",
      titleAr: "يوم المؤسس",
      detail: "One source to read, and the draft that is still unpublished.",
      detailAr: "مصدر واحد للقراءة، والمسودة التي لم تُنشر.",
      watches: [
        {
          memberId: "crew_research",
          title: "One source",
          titleAr: "مصدر واحد",
          steps: "Name one source worth reading. Do not invent a price or a quote.",
          stepsAr: "سمِّ مصدراً واحداً يستحق القراءة. لا تخترع سعراً أو اقتباساً.",
          hour: 11,
          repeat: "weekdays",
        },
        {
          memberId: "crew_maker",
          title: "Unpublished draft",
          titleAr: "مسودة لم تُنشر",
          steps: "Name the draft still on the desk. Do not publish it.",
          stepsAr: "سمِّ المسودة التي ما زالت على المكتب. لا تنشرها.",
          hour: 16,
          repeat: "weekdays",
        },
      ],
    },
  ];
}

export function crewActionOf(text: string): CrewAction {
  if (SPEND.test(text)) return "spend";
  if (PUBLISH.test(text)) return "publish";
  if (MESSAGE.test(text) || SENSITIVE.test(text)) return "message";
  if (COMPUTER.test(text)) return "computer";
  return "draft";
}

export function emptyCrewState(): CrewState {
  return {
    audience: "individual",
    members: [],
    rules: defaultCrewRules(),
    watches: [],
    passes: [],
    briefing: null,
    focus: null,
    events: [],
    writesToday: 0,
    writesDay: "",
    workingId: null,
  };
}

type SeedMember = Omit<CrewMember, "customDuty" | "paused">;

const INDIVIDUAL: SeedMember[] = [
  {
    id: "crew_chief",
    lane: "chief",
    name: "Amal",
    nameAr: "أمل",
    duty: "Keeps the day together and brings back only what needs a decision.",
    dutyAr: "تجمع اليوم وتعيد فقط ما يحتاج قراراً.",
  },
  {
    id: "crew_research",
    lane: "research",
    name: "Noor",
    nameAr: "نور",
    duty: "Writes notes from what you already gave. Does not message anyone.",
    dutyAr: "تكتب ملاحظات مما أعطيته. لا تراسل أحداً.",
  },
  {
    id: "crew_maker",
    lane: "maker",
    name: "Fares",
    nameAr: "فارس",
    duty: "Drafts the work. Does not publish it.",
    dutyAr: "يكتب المسودة. لا ينشرها.",
  },
];

const FAMILY: SeedMember[] = [
  {
    id: "crew_household",
    lane: "household",
    name: "Haya",
    nameAr: "هيا",
    duty: "Keeps the household list: school, errands, and bills. Never pays or sends.",
    dutyAr: "تبقي قائمة البيت: المدرسة والمشاوير والفواتير. لا تدفع ولا ترسل.",
  },
  {
    id: "crew_study",
    lane: "study",
    name: "Layan",
    nameAr: "ليان",
    duty: "Helps with study. Does not message adults or spend.",
    dutyAr: "تساعد في الدراسة. لا تراسل الكبار ولا تنفق.",
  },
  {
    id: "crew_care",
    lane: "care",
    name: "Salem",
    nameAr: "سالم",
    duty: "Names the family rhythm. Does not report a child's private chat.",
    dutyAr: "يسمي إيقاع العائلة. لا ينقل دردشة الطفل الخاصة.",
  },
];

const ORGANIZATION: SeedMember[] = [
  {
    id: "crew_chief",
    lane: "chief",
    name: "Amal",
    nameAr: "أمل",
    duty: "Collects what the lanes finished and brings a person only the judgment calls.",
    dutyAr: "تجمع ما أنهته المسارات وتعيد للشخص قرارات الحكم فقط.",
  },
  {
    id: "crew_inbox",
    lane: "inbox",
    name: "Huda",
    nameAr: "هدى",
    duty: "Drafts what needs a reply. Does not send it.",
    dutyAr: "تكتب مسودة ما يحتاج رداً. لا ترسلها.",
  },
  {
    id: "crew_people",
    lane: "people",
    name: "Rami",
    nameAr: "رامي",
    duty: "Tracks who is waiting. Does not message them.",
    dutyAr: "يتابع من ينتظر. لا يراسلهم.",
  },
  {
    id: "crew_delivery",
    lane: "delivery",
    name: "Fares",
    nameAr: "فارس",
    duty: "Prepares the next delivery. Does not publish or run a command until a person says yes.",
    dutyAr: "يجهّز التسليم التالي. لا ينشر ولا يشغّل أمراً إلا بعد موافقة شخص.",
  },
];

function asMember(seed: SeedMember): CrewMember {
  return { ...seed, customDuty: "", paused: false };
}

function watch(
  id: string,
  memberId: string,
  title: string,
  titleAr: string,
  steps: string,
  stepsAr: string,
  hour: number,
  repeat: DeskRepeat,
): CrewWatch {
  return {
    id,
    memberId,
    title,
    titleAr,
    steps,
    stepsAr,
    hour,
    repeat,
    paused: false,
    lastRunDay: "",
    due: false,
    lastNote: "",
  };
}

export function seedCrew(audience: PlanAudience): CrewState {
  if (audience === "family") {
    return {
      ...emptyCrewState(),
      audience,
      members: FAMILY.map(asMember),
      watches: [
        watch(
          "watch_seed_morning",
          "crew_household",
          "Household morning",
          "صباح البيت",
          "List school, errands, and bills that need a person today. Do not pay or send.",
          "اذكر المدرسة والمشاوير والفواتير التي تحتاج شخصاً اليوم. لا تدفع ولا ترسل.",
          7,
          "daily",
        ),
        watch(
          "watch_seed_study",
          "crew_study",
          "Study check",
          "مراجعة الدراسة",
          "Name one thing to practice. Do not message a parent or a teacher.",
          "سمِّ شيئاً واحداً للتدريب. لا تراسل والداً أو معلماً.",
          16,
          "weekdays",
        ),
      ],
    };
  }
  if (audience === "organization") {
    return {
      ...emptyCrewState(),
      audience,
      members: ORGANIZATION.map(asMember),
      watches: [
        watch(
          "watch_seed_morning",
          "crew_chief",
          "Studio morning",
          "صباح الاستوديو",
          "List what is waiting on each lane. Do not send or publish.",
          "اذكر ما ينتظر في كل مسار. لا ترسل ولا تنشر.",
          8,
          "weekdays",
        ),
        watch(
          "watch_seed_inbox",
          "crew_inbox",
          "Who needs a reply",
          "من يحتاج رداً",
          "Draft who is waiting. Do not send the reply.",
          "اكتب مسودة لمن ينتظر. لا ترسل الرد.",
          8,
          "weekdays",
        ),
      ],
    };
  }
  return {
    ...emptyCrewState(),
    audience: "individual",
    members: INDIVIDUAL.map(asMember),
    watches: [
      watch(
        "watch_seed_morning",
        "crew_chief",
        "Morning note",
        "ملاحظة الصباح",
        "List what is due today. Do not send anything.",
        "اذكر ما يستحق اليوم. لا ترسل شيئاً.",
        8,
        "weekdays",
      ),
    ],
  };
}

export function normalizeCrewState(raw: Partial<CrewState> | null | undefined): CrewState {
  const audience = audienceOf(raw?.audience);
  return {
    audience,
    members: storedMembers(raw?.members),
    rules: storedRules(raw?.rules),
    watches: storedWatches(raw?.watches),
    passes: storedPasses(raw?.passes),
    briefing: storedBriefing(raw?.briefing),
    focus: storedFocus(raw?.focus),
    events: storedEvents(raw?.events),
    writesToday: clampCount(raw?.writesToday),
    writesDay: dayOf(raw?.writesDay),
    workingId: idOf(raw?.workingId, 80),
  };
}

function audienceOf(value: unknown): PlanAudience {
  if (value === "family" || value === "organization" || value === "individual") return value;
  return "individual";
}

function storedMembers(value: unknown): CrewMember[] {
  if (!Array.isArray(value)) return [];
  const members: CrewMember[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CrewMember>;
    if (!LANES.includes(raw.lane as CrewLane)) continue;
    const id = idOf(raw.id, 80);
    const name = clip(raw.name, 80);
    if (!id || name.length < 1 || seen.has(id)) continue;
    seen.add(id);
    members.push({
      id,
      lane: raw.lane as CrewLane,
      name,
      nameAr: clip(raw.nameAr, 80) || name,
      duty: clip(raw.duty, 400),
      dutyAr: clip(raw.dutyAr, 400),
      customDuty: clip(raw.customDuty, 400),
      paused: raw.paused === true,
    });
    if (members.length >= 8) break;
  }
  return members;
}

function storedRules(value: unknown): CrewRule[] {
  const defaults = defaultCrewRules();
  const found = new Map<CrewAction, CrewRuleLevel>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Partial<CrewRule>;
      if (!CREW_ACTIONS.includes(raw.action as CrewAction)) continue;
      if (!CREW_RULE_LEVELS.includes(raw.level as CrewRuleLevel)) continue;
      found.set(raw.action as CrewAction, raw.level as CrewRuleLevel);
    }
  }
  return defaults.map((rule) => ({
    action: rule.action,
    level: clampCrewLevel(rule.action, found.get(rule.action) ?? rule.level),
  }));
}

function storedWatches(value: unknown): CrewWatch[] {
  if (!Array.isArray(value)) return [];
  const watches: CrewWatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CrewWatch>;
    const title = clip(raw.title, 160);
    const hour = typeof raw.hour === "number" ? raw.hour : Number(raw.hour);
    const id = idOf(raw.id, 80);
    const memberId = idOf(raw.memberId, 80);
    if (!id || !memberId || title.length < 2 || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const arabic = seedWatchArabic(title);
    const repeat: DeskRepeat =
      raw.repeat === "weekdays" || raw.repeat === "friday" || raw.repeat === "once" || raw.repeat === "daily"
        ? raw.repeat
        : "daily";
    watches.push({
      id,
      memberId,
      title,
      titleAr: clip(raw.titleAr, 160) || arabic.titleAr,
      steps: clip(raw.steps, 800),
      stepsAr: clip(raw.stepsAr, 800) || arabic.stepsAr,
      hour,
      repeat,
      paused: raw.paused === true,
      lastRunDay: dayOf(raw.lastRunDay),
      due: raw.due === true,
      lastNote: clip(raw.lastNote, 4000),
    });
    if (watches.length >= 12) break;
  }
  return watches;
}

function storedPasses(value: unknown): CrewPass[] {
  if (!Array.isArray(value)) return [];
  const passes: CrewPass[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CrewPass>;
    const id = idOf(raw.id, 80);
    const title = clip(raw.title, 160);
    const fromId = idOf(raw.fromId, 80);
    const toId = raw.toId === "person" ? "person" : idOf(raw.toId, 80);
    if (!id || !fromId || !toId || title.length < 2) continue;
    const action = CREW_ACTIONS.includes(raw.action as CrewAction)
      ? (raw.action as CrewAction)
      : crewActionOf(`${title}\n${clip(raw.note, 800)}`);
    passes.push({
      id,
      fromId,
      toId,
      title,
      note: clip(raw.note, 800),
      action,
      status: raw.status === "done" ? "done" : "open",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt.slice(0, 40) : "",
    });
    if (passes.length >= 40) break;
  }
  return passes;
}

const EVENT_KINDS: readonly CrewEventKind[] = ["rule", "pass", "note", "brief", "focus", "routine"];

function storedFocus(value: unknown): CrewFocus | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CrewFocus>;
  const title = clip(raw.title, 160);
  if (title.length < 2) return null;
  return {
    title,
    note: clip(raw.note, 800),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt.slice(0, 40) : "",
  };
}

function storedEvents(value: unknown): CrewEvent[] {
  if (!Array.isArray(value)) return [];
  const events: CrewEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CrewEvent>;
    const id = idOf(raw.id, 80);
    const text = clip(raw.text, 240);
    if (!id || text.length < 2) continue;
    const kind = EVENT_KINDS.includes(raw.kind as CrewEventKind) ? (raw.kind as CrewEventKind) : "routine";
    events.push({
      id,
      kind,
      memberId: idOf(raw.memberId, 80),
      text,
      textAr: clip(raw.textAr, 240) || text,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt.slice(0, 40) : "",
    });
    if (events.length >= 40) break;
  }
  return events;
}

function storedBriefing(value: unknown): CrewBriefing | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CrewBriefing>;
  const text = clip(raw.text, 4000);
  const day = dayOf(raw.day);
  if (text.length < 2 || !day) return null;
  return {
    day,
    text,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt.slice(0, 40) : "",
  };
}

function seedWatchArabic(title: string): { titleAr: string; stepsAr: string } {
  const known: Record<string, { titleAr: string; stepsAr: string }> = {
    "Morning note": {
      titleAr: "ملاحظة الصباح",
      stepsAr: "اذكر ما يستحق اليوم. لا ترسل شيئاً.",
    },
    "Household morning": {
      titleAr: "صباح البيت",
      stepsAr: "اذكر المدرسة والمشاوير والفواتير التي تحتاج شخصاً اليوم. لا تدفع ولا ترسل.",
    },
    "Study check": {
      titleAr: "مراجعة الدراسة",
      stepsAr: "سمِّ شيئاً واحداً للتدريب. لا تراسل والداً أو معلماً.",
    },
    "Studio morning": {
      titleAr: "صباح الاستوديو",
      stepsAr: "اذكر ما ينتظر في كل مسار. لا ترسل ولا تنشر.",
    },
    "Who needs a reply": {
      titleAr: "من يحتاج رداً",
      stepsAr: "اكتب مسودة لمن ينتظر. لا ترسل الرد.",
    },
  };
  return known[title] ?? { titleAr: "", stepsAr: "" };
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function idOf(value: unknown, max: number): string | null {
  const text = clip(value, max);
  return text.length > 0 ? text : null;
}

function dayOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function clampCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(CREW_WRITES_PER_DAY, Math.round(n));
}
