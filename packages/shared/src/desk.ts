export type DeskPace = "allow" | "ask" | "never";

export type DeskRepeat = "daily" | "weekdays" | "friday" | "once";

export type DeskJobStatus = "needs_you" | "running" | "done" | "stopped";

export type DeskChannel = "whatsapp" | "computer" | "sandbox" | "bill";

export interface DeskJob {
  id: string;
  companionId: string;
  companionName: string;
  title: string;
  brief: string;
  status: DeskJobStatus;
  /** Finished work waiting for the person. Null until the companion has written it. */
  result: string | null;
  /** Hash of result. A yes is valid only for this exact draft. */
  resultHash: string | null;
  /** Set when the person approved this exact draft. */
  approvedHash: string | null;
  /** True when the brief asks to pay, send, or publish. Those always wait. */
  sensitive: boolean;
  /** WhatsApp sends a message. Computer runs one command on the owner's Mac. Sandbox runs one command in a sealed folder. */
  channel: DeskChannel | null;
  /** Owner-typed digits with country code. The model does not choose this. */
  recipient: string | null;
  sentMessageId: string | null;
  /** Set when a WhatsApp message arrived. The desk does not answer it by itself. */
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionDeskState {
  pace: DeskPace;
  /** Corrections the person made. The next job reads these. */
  lessons: string[];
  jobs: DeskJob[];
  /** SAR the companion may release today. Payments over this stay blocked. */
  spendCapSar: number;
  spentSarToday: number;
  /** YYYY-MM-DD in Asia/Riyadh. */
  spentDay: string;
  /** Inclusive start hour in Asia/Riyadh. Null means no quiet window. */
  quietStartHour: number | null;
  /** Exclusive end hour in Asia/Riyadh. */
  quietEndHour: number | null;
  runsToday: number;
  runsDay: string;
  /** Owner-written hours, such as "4 to midnight". Not a calculated prayer time. */
  shopHours: string;
  /** Digits with country code. Empty means WhatsApp is not limited to a list yet. */
  messageList: string[];
  /** Wording the companion must not put in a draft. */
  neverSay: string;
  /** Duties that appear on the desk at a Riyadh hour. They do not run by themselves. */
  schedules: DeskSchedule[];
}

export interface DeskSchedule {
  id: string;
  companionId: string;
  companionName: string;
  title: string;
  brief: string;
  /** Hour in Asia/Riyadh, 0–23. */
  hour: number;
  repeat: DeskRepeat;
  paused: boolean;
  /** YYYY-MM-DD in Asia/Riyadh. Empty until the duty has appeared. */
  lastRunDay: string;
}

export interface CompanionDeskView extends CompanionDeskState {
  hijriToday: string;
  /** How many drafts the desk may write today. */
  runsAllowance: number;
}

export interface UpdateDeskPaceRequest {
  pace?: DeskPace;
  spendCapSar?: number;
  quietStartHour?: number | null;
  quietEndHour?: number | null;
  shopHours?: string;
  messageList?: string[];
  neverSay?: string;
}

export interface StartDeskJobRequest {
  companionId?: string;
  companionName?: string;
  title: string;
  brief?: string;
  channel?: DeskChannel | null;
  recipient?: string;
  /** SAR the owner read on a bill. Arrab does not pay it. */
  amountSar?: number;
}

export interface ApproveDeskJobRequest {
  draftHash?: string;
  amountSar?: number;
}

export interface ReviseDeskJobRequest {
  note: string;
}

export interface AddDeskScheduleRequest {
  companionId?: string;
  companionName?: string;
  title: string;
  brief?: string;
  hour: number;
  repeat?: DeskRepeat;
  /** When true, the duty waits until the next Riyadh day. */
  tomorrow?: boolean;
}

export function emptyCompanionDesk(): CompanionDeskState {
  return {
    pace: "ask",
    lessons: [],
    jobs: [],
    spendCapSar: 500,
    spentSarToday: 0,
    spentDay: "",
    quietStartHour: null,
    quietEndHour: null,
    runsToday: 0,
    runsDay: "",
    shopHours: "",
    messageList: [],
    neverSay: "",
    schedules: [],
  };
}

export function normalizeCompanionDesk(raw: Partial<CompanionDeskState> | null | undefined): CompanionDeskState {
  const base = emptyCompanionDesk();
  const pace = raw?.pace === "allow" || raw?.pace === "never" || raw?.pace === "ask" ? raw.pace : base.pace;
  const hour = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 23) return null;
    return n;
  };
  return {
    pace,
    lessons: Array.isArray(raw?.lessons)
      ? raw.lessons.filter((item: unknown): item is string => typeof item === "string").slice(-8)
      : [],
    jobs: Array.isArray(raw?.jobs) ? raw.jobs.map(normalizeDeskJob) : [],
    spendCapSar: clampSar(raw?.spendCapSar, base.spendCapSar),
    spentSarToday: clampSar(raw?.spentSarToday, 0),
    spentDay: typeof raw?.spentDay === "string" ? raw.spentDay : "",
    quietStartHour: hour(raw?.quietStartHour),
    quietEndHour: hour(raw?.quietEndHour),
    runsToday: clampSar(raw?.runsToday, 0),
    runsDay: typeof raw?.runsDay === "string" ? raw.runsDay : "",
    shopHours: clipText(raw?.shopHours, 160),
    messageList: storedMessageList(raw?.messageList),
    neverSay: clipText(raw?.neverSay, 400),
    schedules: storedSchedules(raw?.schedules),
  };
}

function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function storedSchedules(value: unknown): DeskSchedule[] {
  if (!Array.isArray(value)) return [];
  const schedules: DeskSchedule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<DeskSchedule>;
    const title = clipText(raw.title, 160);
    const hour = typeof raw.hour === "number" ? raw.hour : Number(raw.hour);
    if (title.length < 2 || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const repeat: DeskRepeat =
      raw.repeat === "weekdays" || raw.repeat === "friday" || raw.repeat === "once" ? raw.repeat : "daily";
    schedules.push({
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 80) : "",
      companionId: clipText(raw.companionId, 80) || "general",
      companionName: clipText(raw.companionName, 80) || "Arrab",
      title,
      brief: clipText(raw.brief, 400),
      hour,
      repeat,
      paused: raw.paused === true,
      lastRunDay: typeof raw.lastRunDay === "string" ? raw.lastRunDay.slice(0, 10) : "",
    });
    if (schedules.length >= 8) break;
  }
  return schedules.filter((item) => item.id);
}

function storedMessageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const digits = item.replace(/[^\d]/g, "");
    if (digits.length >= 8 && digits.length <= 15) seen.add(digits);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

function storedRecipient(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function clampSar(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(1_000_000, Math.round(n));
}

function normalizeDeskJob(raw: Partial<DeskJob> | null | undefined): DeskJob {
  const status: DeskJobStatus =
    raw?.status === "running" || raw?.status === "done" || raw?.status === "stopped" || raw?.status === "needs_you"
      ? raw.status
      : "needs_you";
  return {
    id: typeof raw?.id === "string" ? raw.id : "",
    companionId: typeof raw?.companionId === "string" ? raw.companionId : "general",
    companionName: typeof raw?.companionName === "string" ? raw.companionName : "Arrab",
    title: typeof raw?.title === "string" ? raw.title : "",
    brief: typeof raw?.brief === "string" ? raw.brief : "",
    status,
    result: typeof raw?.result === "string" ? raw.result : null,
    resultHash: typeof raw?.resultHash === "string" ? raw.resultHash : null,
    approvedHash: typeof raw?.approvedHash === "string" ? raw.approvedHash : null,
    sensitive: raw?.sensitive === true,
    channel:
      raw?.channel === "whatsapp" || raw?.channel === "computer" || raw?.channel === "sandbox" || raw?.channel === "bill"
        ? raw.channel
        : null,
    recipient: storedRecipient(raw?.recipient),
    sentMessageId: typeof raw?.sentMessageId === "string" ? raw.sentMessageId : null,
    sourceId: typeof raw?.sourceId === "string" && raw.sourceId.trim() ? raw.sourceId.trim().slice(0, 120) : null,
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : "",
  };
}
