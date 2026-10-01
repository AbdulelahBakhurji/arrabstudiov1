/**
 * Server-enforced Guardian policy for child seats.
 * The parent edits it on any device; every device and the API enforce the same copy.
 */
import type { FamilyAgeTier } from "./family.js";
import { guardianHardHit } from "./guardian-hard.js";

export type FamilyGuardianRuleKind = "hard" | "soft" | "schedule" | "tone" | "wellbeing";
export type FamilyCompanionAccess = "kid_safe" | "all";
export type FamilyOversightMode = "coach" | "full";

export interface FamilyGuardianRule {
  id: string;
  text: string;
  kind: FamilyGuardianRuleKind;
  enabled: boolean;
  createdAt: string;
}

export interface FamilyQuietHours {
  enabled: boolean;
  /** Local HH:mm in the household's timezone. */
  start: string;
  end: string;
  /** Weekdays the window starts on (0 = Sunday). Empty = every day. */
  days: number[];
  /** Minutes east of UTC for the household (e.g. Riyadh = 180). */
  utcOffsetMinutes: number;
}

export interface FamilyGuardianPolicy {
  quietHours: FamilyQuietHours;
  /** 0 = no daily cap (the seat's period allowance still applies). */
  dailyTokenLimit: number;
  /** Words or phrases the child cannot send (case-insensitive). */
  blockedTopics: string[];
  rules: FamilyGuardianRule[];
  companionAccess: FamilyCompanionAccess;
  /** coach = parents see categories only; full = parents also see the flagged excerpt. */
  oversightMode: FamilyOversightMode;
  /** Scaffold schoolwork with hints and questions instead of full answers. */
  learningMode: boolean;
  updatedAt: string;
}

export type FamilySafetyCategory =
  | "self_harm"
  | "stranger"
  | "contact"
  | "sexual"
  | "violence"
  | "blocked_topic"
  | "quiet_hours"
  | "daily_limit";

export type FamilySafetySeverity = "info" | "warn" | "critical";

export interface FamilySafetyEvent {
  id: string;
  memberId: string;
  memberName: string;
  category: FamilySafetyCategory;
  severity: FamilySafetySeverity;
  labelEn: string;
  labelAr: string;
  /** Only kept when the parent chose full oversight. */
  excerpt: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface FamilyActivityDay {
  /** YYYY-MM-DD in the household's timezone. */
  day: string;
  messages: number;
  tokens: number;
  blocked: number;
}

/** Stored on the child's member record. */
export interface FamilyGuardianState {
  policy: FamilyGuardianPolicy;
  safetyEvents: FamilySafetyEvent[];
  activity: FamilyActivityDay[];
}

/** Live Guardian view of a child seat, returned with the member. */
export interface FamilyGuardianStatus {
  policy: FamilyGuardianPolicy;
  quietHoursActive: boolean;
  /** Local HH:mm when quiet hours end, when active. */
  quietHoursUntil: string | null;
  tokensToday: number;
  unreadSafety: number;
  /** Last 7 days, oldest first. Managers only. */
  activity: FamilyActivityDay[];
}

export type UpdateFamilyGuardianRequest = Partial<
  Omit<FamilyGuardianPolicy, "updatedAt" | "quietHours" | "rules">
> & {
  quietHours?: Partial<FamilyQuietHours>;
  rules?: Array<Partial<FamilyGuardianRule> & { text: string }>;
};

export interface AcknowledgeFamilySafetyRequest {
  /** Omit to acknowledge every unread event. */
  ids?: string[];
}

export const FAMILY_GUARDIAN_LIMITS = {
  rules: 30,
  ruleChars: 240,
  blockedTopics: 40,
  blockedTopicChars: 40,
  safetyEvents: 60,
  activityDays: 14,
  excerptChars: 140,
} as const;

export const FAMILY_DAILY_TOKEN_PRESETS = [0, 10_000, 25_000, 50_000, 100_000] as const;

function defaultBedtime(ageTier: FamilyAgeTier | null | undefined): string {
  if (ageTier === "tier_6_9") return "20:00";
  if (ageTier === "tier_14_17") return "22:30";
  return "21:00";
}

export function defaultGuardianPolicy(
  ageTier: FamilyAgeTier | null | undefined,
  now: string,
): FamilyGuardianPolicy {
  return {
    quietHours: {
      enabled: true,
      start: defaultBedtime(ageTier),
      end: "07:00",
      days: [],
      utcOffsetMinutes: 180,
    },
    dailyTokenLimit: ageTier === "tier_6_9" ? 25_000 : 0,
    blockedTopics: [],
    rules: [],
    companionAccess: "kid_safe",
    oversightMode: "coach",
    learningMode: ageTier !== "tier_14_17",
    updatedAt: now,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const RULE_KINDS: FamilyGuardianRuleKind[] = ["hard", "soft", "schedule", "tone", "wellbeing"];

function cleanHHMM(value: unknown, fallback: string): string {
  return typeof value === "string" && HHMM.test(value) ? value : fallback;
}

/** Merge an untrusted patch onto a policy, clamping every field. */
export function mergeGuardianPolicy(
  base: FamilyGuardianPolicy,
  patch: UpdateFamilyGuardianRequest,
  now: string,
  newRuleId: () => string,
): FamilyGuardianPolicy {
  const quiet = patch.quietHours ?? {};
  const offset = Number(quiet.utcOffsetMinutes);
  const next: FamilyGuardianPolicy = {
    quietHours: {
      enabled: typeof quiet.enabled === "boolean" ? quiet.enabled : base.quietHours.enabled,
      start: cleanHHMM(quiet.start, base.quietHours.start),
      end: cleanHHMM(quiet.end, base.quietHours.end),
      days: Array.isArray(quiet.days)
        ? [...new Set(quiet.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : base.quietHours.days,
      utcOffsetMinutes:
        Number.isFinite(offset) && Math.abs(offset) <= 14 * 60
          ? Math.round(offset)
          : base.quietHours.utcOffsetMinutes,
    },
    dailyTokenLimit:
      patch.dailyTokenLimit !== undefined && Number.isFinite(Number(patch.dailyTokenLimit))
        ? Math.max(0, Math.min(10_000_000, Math.floor(Number(patch.dailyTokenLimit))))
        : base.dailyTokenLimit,
    blockedTopics: Array.isArray(patch.blockedTopics)
      ? [
          ...new Set(
            patch.blockedTopics
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim().toLowerCase().slice(0, FAMILY_GUARDIAN_LIMITS.blockedTopicChars))
              .filter((t) => t.length >= 2),
          ),
        ].slice(0, FAMILY_GUARDIAN_LIMITS.blockedTopics)
      : base.blockedTopics,
    rules: Array.isArray(patch.rules)
      ? patch.rules
          .filter((r) => r && typeof r.text === "string" && r.text.trim().length >= 4)
          .slice(0, FAMILY_GUARDIAN_LIMITS.rules)
          .map((r) => ({
            id: typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 64) : newRuleId(),
            text: r.text.trim().slice(0, FAMILY_GUARDIAN_LIMITS.ruleChars),
            kind: RULE_KINDS.includes(r.kind as FamilyGuardianRuleKind)
              ? (r.kind as FamilyGuardianRuleKind)
              : "soft",
            enabled: r.enabled !== false,
            createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
          }))
      : base.rules,
    companionAccess:
      patch.companionAccess === "all" || patch.companionAccess === "kid_safe"
        ? patch.companionAccess
        : base.companionAccess,
    oversightMode:
      patch.oversightMode === "full" || patch.oversightMode === "coach"
        ? patch.oversightMode
        : base.oversightMode,
    learningMode:
      typeof patch.learningMode === "boolean" ? patch.learningMode : base.learningMode,
    updatedAt: now,
  };
  return next;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function localParts(now: Date, offsetMinutes: number): { weekday: number; minutes: number } {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Household-local calendar day (YYYY-MM-DD). */
export function guardianDayKey(now: Date, offsetMinutes: number): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** True inside the quiet window; overnight windows count from the start day. */
export function isQuietHoursActive(quiet: FamilyQuietHours, now: Date): boolean {
  if (!quiet.enabled) return false;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  const { weekday, minutes } = localParts(now, quiet.utcOffsetMinutes);
  const dayAllowed = (day: number) => quiet.days.length === 0 || quiet.days.includes(day);
  if (start === end) return dayAllowed(weekday);
  if (start < end) return dayAllowed(weekday) && minutes >= start && minutes < end;
  if (minutes >= start) return dayAllowed(weekday);
  if (minutes < end) return dayAllowed((weekday + 6) % 7);
  return false;
}

/** First blocked phrase found in the text, matched on word boundaries. */
export function blockedTopicHit(text: string, topics: string[]): string | null {
  const value = text.toLowerCase();
  for (const topic of topics) {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(value)) {
      return topic;
    }
  }
  return null;
}

const HARD_CATEGORY: Record<string, FamilySafetyCategory> = {
  "hard-self-harm": "self_harm",
  "hard-meet-stranger": "stranger",
  "hard-contact": "contact",
  "hard-sexual": "sexual",
  "hard-violence": "violence",
};

export type GuardianMessageVerdict =
  | { allowed: true }
  | {
      allowed: false;
      category: FamilySafetyCategory;
      severity: FamilySafetySeverity;
      labelEn: string;
      labelAr: string;
    };

/** Screen one outgoing child message against hard failsafes and the parent's blocked words. */
export function screenChildMessage(
  text: string,
  policy: FamilyGuardianPolicy | null,
): GuardianMessageVerdict {
  const hard = guardianHardHit(text);
  if (hard) {
    const category = HARD_CATEGORY[hard.id] ?? "violence";
    return {
      allowed: false,
      category,
      severity: category === "self_harm" || category === "stranger" ? "critical" : "warn",
      labelEn: hard.labelEn,
      labelAr: hard.labelAr,
    };
  }
  const topic = policy ? blockedTopicHit(text, policy.blockedTopics) : null;
  if (topic) {
    return {
      allowed: false,
      category: "blocked_topic",
      severity: "info",
      labelEn: `Blocked word: “${topic}”`,
      labelAr: `كلمة محظورة: «${topic}»`,
    };
  }
  return { allowed: true };
}

const AGE_VOICE: Record<FamilyAgeTier, string> = {
  tier_6_9:
    "You are talking with a child aged 6–9. Use short, warm, simple sentences. Never describe anything scary, violent, or romantic.",
  tier_10_13:
    "You are talking with a child aged 10–13. Be honest, kind, and clear. Keep content age-appropriate and name family rules openly when they apply.",
  tier_14_17:
    "You are talking with a teenager aged 14–17. Be respectful and direct, model healthy boundaries, and do not lecture.",
};

/** System guidance appended to every child-seat conversation. */
export function guardianSystemBlock(input: {
  policy: FamilyGuardianPolicy | null;
  ageTier: FamilyAgeTier | null;
  displayName: string;
}): string {
  const { policy, ageTier } = input;
  const lines = [
    "Family Guardian is on for this conversation.",
    AGE_VOICE[ageTier ?? "tier_10_13"],
    "Never help with self-harm, meeting strangers, sharing addresses, phone numbers or social handles, adult content, or violence. If the child seems sad, scared, or unsafe, respond with care, encourage them to talk to a parent, and keep them company.",
    "Never ask for personal details (full name, school, address, photos).",
  ];
  if (policy?.learningMode) {
    lines.push(
      "Learning mode: for homework or school questions, guide with hints, questions, and worked examples of similar problems — do not hand over the final answer outright.",
    );
  }
  const rules = (policy?.rules ?? []).filter((r) => r.enabled).slice(0, 20);
  if (rules.length > 0) {
    lines.push("House rules set by the parents (follow them and name them kindly when relevant):");
    for (const rule of rules) lines.push(`- ${rule.text}`);
  }
  return lines.join("\n");
}

/** Last `days` activity buckets ending today, oldest first, zero-filled. */
export function recentActivity(
  activity: FamilyActivityDay[],
  now: Date,
  offsetMinutes: number,
  days = 7,
): FamilyActivityDay[] {
  const byDay = new Map(activity.map((a) => [a.day, a]));
  const out: FamilyActivityDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = guardianDayKey(new Date(now.getTime() - i * 86_400_000), offsetMinutes);
    out.push(byDay.get(day) ?? { day, messages: 0, tokens: 0, blocked: 0 });
  }
  return out;
}
