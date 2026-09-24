/**
 * Persistent Guardian config per child seat — rules, downtime, approvals.
 * Lives on-device (same privacy model as Second Brain partitions).
 */
import { useSyncExternalStore } from "react";
import type { CompanionSpace } from "@/lib/companions";
import type { GuardianRuleKind } from "@/lib/guardian";

const STORE_KEY = "arrab.guardian.v1";
export const GUARDIAN_STORE_EVENT = "arrab:guardian-store";

export type StoredGuardianRule = {
  id: string;
  childMemberId: string;
  text: string;
  kind: GuardianRuleKind;
  enabled: boolean;
  cues: string[];
  createdAt: string;
};

export type DowntimeSchedule = {
  childMemberId: string;
  enabled: boolean;
  /** Local HH:mm */
  start: string;
  /** Local HH:mm */
  end: string;
  /** Always-allowed companion ids during downtime */
  alwaysAllowedCompanionIds: string[];
};

export type CompanionApprovalRequest = {
  id: string;
  childMemberId: string;
  childName: string;
  name: string;
  domain: string;
  purposeId: string;
  brief: string;
  space: CompanionSpace;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  resolvedAt: string | null;
};

export type GuardianAuditEvent = {
  id: string;
  childMemberId: string;
  kind:
    | "rule_added"
    | "rule_removed"
    | "rule_toggled"
    | "downtime_saved"
    | "approval_approved"
    | "approval_declined"
    | "pause"
    | "resume"
    | "preset_applied"
    | "guardian_decision"
    | "coaching_alert";
  title: string;
  detail: string;
  createdAt: string;
};

export type GuardianCoachingAlert = {
  id: string;
  childMemberId: string;
  childName: string;
  companionName: string;
  coaching: string;
  verdict: string;
  createdAt: string;
  read: boolean;
};

export type GuardianStoreState = {
  version: 1;
  rules: StoredGuardianRule[];
  downtime: DowntimeSchedule[];
  approvals: CompanionApprovalRequest[];
  audit: GuardianAuditEvent[];
  alerts: GuardianCoachingAlert[];
  /** Per-child day-one prefs from Add Family Member wizard. */
  childPrefs: ChildSeatPrefs[];
};

export type CompanionAccessMode = "kid_safe" | "all";
export type OversightMode = "coach" | "full";

export type ChildSeatPrefs = {
  childMemberId: string;
  companionAccess: CompanionAccessMode;
  oversightMode: OversightMode;
  /** Hex color / avatar key chosen in the add-member wizard. */
  avatarKey: string | null;
  updatedAt: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emptyState(): GuardianStoreState {
  return {
    version: 1,
    rules: [],
    downtime: [],
    approvals: [],
    audit: [],
    alerts: [],
    childPrefs: [],
  };
}

function readRaw(): GuardianStoreState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<GuardianStoreState>;
    return {
      version: 1,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      downtime: Array.isArray(parsed.downtime) ? parsed.downtime : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      childPrefs: Array.isArray(parsed.childPrefs) ? parsed.childPrefs : [],
    };
  } catch {
    return emptyState();
  }
}

let cache = readRaw();

function emit() {
  listeners.forEach((fn) => fn());
  try {
    window.dispatchEvent(new CustomEvent(GUARDIAN_STORE_EVENT));
  } catch {
    /* ignore */
  }
}

function write(next: GuardianStoreState) {
  cache = next;
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  emit();
}

function mutate(fn: (draft: GuardianStoreState) => void) {
  const draft: GuardianStoreState = {
    version: 1,
    rules: cache.rules.map((r) => ({ ...r, cues: [...r.cues] })),
    downtime: cache.downtime.map((d) => ({
      ...d,
      alwaysAllowedCompanionIds: [...d.alwaysAllowedCompanionIds],
    })),
    approvals: cache.approvals.map((a) => ({ ...a })),
    audit: cache.audit.map((a) => ({ ...a })),
    alerts: cache.alerts.map((a) => ({ ...a })),
    childPrefs: cache.childPrefs.map((p) => ({ ...p })),
  };
  fn(draft);
  write(draft);
}

export function getGuardianStore(): GuardianStoreState {
  return cache;
}

export function subscribeGuardianStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuardianStore(): GuardianStoreState {
  return useSyncExternalStore(subscribeGuardianStore, getGuardianStore, getGuardianStore);
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function cuesFromText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3)
    .slice(0, 10);
}

/** Turn natural language into a structured rule (zero-shot authoring). */
export function draftRuleFromNaturalLanguage(
  text: string,
): { kind: GuardianRuleKind; text: string } {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  let kind: GuardianRuleKind = "soft";
  if (
    /bedtime|after\s+\d|quiet|downtime|screen\s*time|نوم|بعد\s*الساعة|هدوء/.test(lower)
  ) {
    kind = "schedule";
  } else if (/stranger|meet|address|phone|sex|porn|harm|غريب|عنوان|رقم|أذى/.test(lower)) {
    kind = "hard";
  } else if (/sad|scared|anxious|bully|feel|حزين|خايف|تنمر|قلق/.test(lower)) {
    kind = "wellbeing";
  } else if (/tone|kind|gentle|short|لطيف|قصير/.test(lower)) {
    kind = "tone";
  }
  return { kind, text: raw };
}

export function addGuardianRule(input: {
  childMemberId: string;
  text: string;
  kind?: GuardianRuleKind;
  silent?: boolean;
}): StoredGuardianRule | null {
  const text = input.text.trim();
  if (!text || text.length < 4) return null;
  const drafted = draftRuleFromNaturalLanguage(text);
  const rule: StoredGuardianRule = {
    id: newId("grule"),
    childMemberId: input.childMemberId,
    text: drafted.text,
    kind: input.kind ?? drafted.kind,
    enabled: true,
    cues: cuesFromText(drafted.text),
    createdAt: new Date().toISOString(),
  };
  mutate((draft) => {
    draft.rules.unshift(rule);
    if (!input.silent) {
      draft.audit.unshift({
        id: newId("gaud"),
        childMemberId: input.childMemberId,
        kind: "rule_added",
        title: "Rule added",
        detail: rule.text.slice(0, 160),
        createdAt: new Date().toISOString(),
      });
      draft.audit = draft.audit.slice(0, 80);
    }
  });
  return rule;
}

export function toggleGuardianRule(ruleId: string, enabled: boolean): void {
  mutate((draft) => {
    const rule = draft.rules.find((r) => r.id === ruleId);
    if (!rule) return;
    rule.enabled = enabled;
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: rule.childMemberId,
      kind: "rule_toggled",
      title: enabled ? "Rule enabled" : "Rule disabled",
      detail: rule.text.slice(0, 160),
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
}

export function removeGuardianRule(ruleId: string): void {
  mutate((draft) => {
    const rule = draft.rules.find((r) => r.id === ruleId);
    if (!rule) return;
    draft.rules = draft.rules.filter((r) => r.id !== ruleId);
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: rule.childMemberId,
      kind: "rule_removed",
      title: "Rule removed",
      detail: rule.text.slice(0, 160),
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
}

export function rulesForChild(childMemberId: string): StoredGuardianRule[] {
  return cache.rules.filter((r) => r.childMemberId === childMemberId && r.enabled);
}

export function getDowntime(childMemberId: string): DowntimeSchedule {
  return (
    cache.downtime.find((d) => d.childMemberId === childMemberId) ?? {
      childMemberId,
      enabled: false,
      start: "21:00",
      end: "07:00",
      alwaysAllowedCompanionIds: [],
    }
  );
}

export function setDowntime(input: {
  childMemberId: string;
  enabled: boolean;
  start: string;
  end: string;
  alwaysAllowedCompanionIds?: string[];
}): void {
  mutate((draft) => {
    const existing = draft.downtime.find((d) => d.childMemberId === input.childMemberId);
    const next: DowntimeSchedule = {
      childMemberId: input.childMemberId,
      enabled: input.enabled,
      start: input.start,
      end: input.end,
      alwaysAllowedCompanionIds:
        input.alwaysAllowedCompanionIds ?? existing?.alwaysAllowedCompanionIds ?? [],
    };
    if (existing) Object.assign(existing, next);
    else draft.downtime.push(next);
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: input.childMemberId,
      kind: "downtime_saved",
      title: input.enabled ? "Quiet hours on" : "Quiet hours off",
      detail: `${input.start}–${input.end}`,
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
}

/** Default bedtime start by age tier (local HH:mm). */
export function defaultBedtimeForAgeTier(
  ageTier: "tier_6_9" | "tier_10_13" | "tier_14_17" | null | undefined,
): string {
  if (ageTier === "tier_6_9") return "20:00";
  if (ageTier === "tier_14_17") return "22:00";
  return "21:00";
}

export function getChildSeatPrefs(childMemberId: string): ChildSeatPrefs {
  return (
    cache.childPrefs.find((p) => p.childMemberId === childMemberId) ?? {
      childMemberId,
      companionAccess: "kid_safe",
      oversightMode: "coach",
      avatarKey: null,
      updatedAt: new Date(0).toISOString(),
    }
  );
}

export function setChildSeatPrefs(input: {
  childMemberId: string;
  companionAccess: CompanionAccessMode;
  oversightMode: OversightMode;
  avatarKey?: string | null;
}): void {
  mutate((draft) => {
    const existing = draft.childPrefs.find((p) => p.childMemberId === input.childMemberId);
    const next: ChildSeatPrefs = {
      childMemberId: input.childMemberId,
      companionAccess: input.companionAccess,
      oversightMode: input.oversightMode,
      avatarKey: input.avatarKey ?? existing?.avatarKey ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, next);
    else draft.childPrefs.push(next);
  });
}

/**
 * Apply day-one child guardrails from the Add Family Member wizard.
 */
export function applyChildDayOneGuardrails(input: {
  childMemberId: string;
  ageTier: "tier_6_9" | "tier_10_13" | "tier_14_17" | null;
  bedtimeStart: string;
  companionAccess: CompanionAccessMode;
  oversightMode: OversightMode;
  avatarKey?: string | null;
}): void {
  setDowntime({
    childMemberId: input.childMemberId,
    enabled: true,
    start: input.bedtimeStart || defaultBedtimeForAgeTier(input.ageTier),
    end: "07:00",
  });
  setChildSeatPrefs({
    childMemberId: input.childMemberId,
    companionAccess: input.companionAccess,
    oversightMode: input.oversightMode,
    avatarKey: input.avatarKey ?? null,
  });
}

/** True when local clock is inside downtime window (supports overnight ranges). */
export function isWithinDowntime(schedule: DowntimeSchedule, now = new Date()): boolean {
  if (!schedule.enabled) return false;
  const [sh, sm] = schedule.start.split(":").map(Number);
  const [eh, em] = schedule.end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function requestCompanionApproval(input: {
  childMemberId: string;
  childName: string;
  name: string;
  domain: string;
  purposeId: string;
  brief: string;
  space: CompanionSpace;
}): CompanionApprovalRequest {
  const req: CompanionApprovalRequest = {
    id: newId("gapr"),
    childMemberId: input.childMemberId,
    childName: input.childName,
    name: input.name.trim() || input.domain,
    domain: input.domain,
    purposeId: input.purposeId,
    brief: input.brief,
    space: input.space,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  mutate((draft) => {
    draft.approvals.unshift(req);
  });
  return req;
}

export function pendingApprovalsForChild(childMemberId: string): CompanionApprovalRequest[] {
  return cache.approvals.filter(
    (a) => a.childMemberId === childMemberId && a.status === "pending",
  );
}

export function allPendingApprovals(): CompanionApprovalRequest[] {
  return cache.approvals.filter((a) => a.status === "pending");
}

export function resolveCompanionApproval(
  id: string,
  status: "approved" | "declined",
): CompanionApprovalRequest | null {
  let found: CompanionApprovalRequest | null = null;
  mutate((draft) => {
    const item = draft.approvals.find((a) => a.id === id);
    if (!item || item.status !== "pending") return;
    item.status = status;
    item.resolvedAt = new Date().toISOString();
    found = { ...item };
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: item.childMemberId,
      kind: status === "approved" ? "approval_approved" : "approval_declined",
      title: status === "approved" ? "Companion approved" : "Companion declined",
      detail: item.name,
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
  return found;
}

export function logGuardianAudit(input: {
  childMemberId: string;
  kind: GuardianAuditEvent["kind"];
  title: string;
  detail: string;
}): void {
  mutate((draft) => {
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: input.childMemberId,
      kind: input.kind,
      title: input.title,
      detail: input.detail.slice(0, 200),
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
}

export function auditForChild(childMemberId: string, limit = 30): GuardianAuditEvent[] {
  return cache.audit
    .filter((a) => a.childMemberId === childMemberId)
    .slice(0, limit);
}

export function pushCoachingAlert(input: {
  childMemberId: string;
  childName: string;
  companionName: string;
  coaching: string;
  verdict: string;
}): void {
  mutate((draft) => {
    draft.alerts.unshift({
      id: newId("galt"),
      childMemberId: input.childMemberId,
      childName: input.childName,
      companionName: input.companionName,
      coaching: input.coaching.slice(0, 280),
      verdict: input.verdict,
      createdAt: new Date().toISOString(),
      read: false,
    });
    draft.alerts = draft.alerts.slice(0, 40);
    draft.audit.unshift({
      id: newId("gaud"),
      childMemberId: input.childMemberId,
      kind: "coaching_alert",
      title: `Heads-up · ${input.childName}`,
      detail: input.coaching.slice(0, 160),
      createdAt: new Date().toISOString(),
    });
    draft.audit = draft.audit.slice(0, 80);
  });
}

export function unreadCoachingAlerts(): GuardianCoachingAlert[] {
  return cache.alerts.filter((a) => !a.read);
}

export function markCoachingAlertRead(id: string): void {
  mutate((draft) => {
    const item = draft.alerts.find((a) => a.id === id);
    if (item) item.read = true;
  });
}

export function markAllCoachingAlertsRead(): void {
  mutate((draft) => {
    for (const alert of draft.alerts) alert.read = true;
  });
}

/** Age-tier starter packs — transparent boundary culture, not a ban list. */
export function applyAgeTierPreset(
  childMemberId: string,
  tier: "tier_6_9" | "tier_10_13" | "tier_14_17",
): number {
  const packs: Record<typeof tier, string[]> = {
    tier_6_9: [
      "Keep replies short, warm, and playful — never scary.",
      "If they ask to meet someone new online, name the family safety rule and offer to ask a parent together.",
      "For homework, practice thinking together — never hand full answers.",
      "If they feel sad or scared, stay with them and coach a parent with a gentle script.",
    ],
    tier_10_13: [
      "Be honest and kind. Name family rules openly when they apply.",
      "No help arranging meetups with strangers or sharing contact details.",
      "Scaffold schoolwork with questions; celebrate effort over perfection.",
      "If bullying or lasting worry shows up, stay present and coach a parent without panic.",
    ],
    tier_14_17: [
      "Treat them with respect and honesty — model adult boundaries, don't lecture.",
      "Refuse illegal or harmful how-tos; explain why and offer safer paths.",
      "Support independence while keeping family safety rules clear.",
      "Escalate wellbeing concerns to a parent with coaching, not interrogation tips.",
    ],
  };
  let added = 0;
  for (const text of packs[tier]) {
    const created = addGuardianRule({ childMemberId, text, silent: true });
    if (created) added += 1;
  }
  logGuardianAudit({
    childMemberId,
    kind: "preset_applied",
    title: `Age preset · ${tier}`,
    detail: `${added} starter rules applied`,
  });
  return added;
}

export function weeklyDigestNarrative(
  childMemberId: string,
  childName: string,
  locale: "en" | "ar",
): string {
  const d = weeklyDigestForChild(childMemberId);
  if (d.decisions === 0) {
    return locale === "ar"
      ? `أسبوع هادئ لـ ${childName} — لا قرارات حارس بعد. استمرّوا في بناء الثقة بالقواعد الواضحة.`
      : `A quiet week for ${childName} — no Guardian decisions yet. Keep building trust with clear rules.`;
  }
  if (locale === "ar") {
    return (
      `هذا الأسبوع رافق الحارس ${childName} في ${d.decisions} قراراً` +
      (d.boundaries ? `، منها ${d.boundaries} حدود سُمّيت بلطف` : "") +
      (d.coaching ? `، و${d.coaching} توجيهات لكيف تظهر لهم` : "") +
      (d.pauses ? `، و${d.pauses} توقف أمان دافئ` : "") +
      `. ركّز على الحضور أكثر من الاستجواب.`
    );
  }
  return (
    `This week Guardian walked with ${childName} through ${d.decisions} decision${d.decisions === 1 ? "" : "s"}` +
    (d.boundaries ? `, including ${d.boundaries} kindly named boundar${d.boundaries === 1 ? "y" : "ies"}` : "") +
    (d.coaching ? `, and ${d.coaching} coaching note${d.coaching === 1 ? "" : "s"} for how to show up` : "") +
    (d.pauses ? `, plus ${d.pauses} warm safety pause${d.pauses === 1 ? "" : "s"}` : "") +
    `. Lead with presence, not interrogation.`
  );
}

export function weeklyDigestForChild(childMemberId: string): {
  decisions: number;
  boundaries: number;
  coaching: number;
  pauses: number;
} {
  // Lightweight local tally from brain partitions (best-effort).
  let decisions = 0;
  let boundaries = 0;
  let coaching = 0;
  let pauses = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith("arrab.secondBrain.v2.") || !key.endsWith(`.${childMemberId}`)) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        nodes?: Array<{
          guardian?: boolean;
          guardianVerdict?: string | null;
          parentCoaching?: string | null;
          familyMemberId?: string | null;
          updatedAt?: string;
        }>;
      };
      for (const node of parsed.nodes ?? []) {
        if (!node.guardian || node.familyMemberId !== childMemberId) continue;
        if (node.updatedAt && new Date(node.updatedAt).getTime() < weekAgo) continue;
        decisions += 1;
        if (node.guardianVerdict === "model_boundary" || node.guardianVerdict === "scaffold") {
          boundaries += 1;
        }
        if (node.parentCoaching) coaching += 1;
        if (node.guardianVerdict === "pause_with_care") pauses += 1;
      }
    }
  } catch {
    /* ignore */
  }
  return { decisions, boundaries, coaching, pauses };
}
