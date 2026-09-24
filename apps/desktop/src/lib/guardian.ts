/**
 * Family Guardian — co-parenting decision-maker for child seats.
 *
 * Not a covert filter. Companions model boundaries in the open; parents
 * get digested coaching instead of raw transcripts. Hard rules use
 * deterministic failsafes; soft rules ride into the companion prompt so
 * the first pass usually complies (no double LLM hop).
 */
import type { FamilyAgeTier } from "@arrab/shared";
import { guardianHardHit } from "@arrab/shared";
import {
  getCompanionState,
  visibleFacts,
  type CompanionProfile,
} from "@/lib/companions";
import {
  brainNodesForScope,
  getSecondBrain,
  logGuardianDecision,
  type BrainNode,
} from "@/lib/second-brain";
import {
  getActiveFamilyMember,
  isFamilyChild,
  readActiveFamilyMemberId,
} from "@/lib/family-session";
import {
  getDowntime,
  isWithinDowntime,
  pushCoachingAlert,
  rulesForChild,
} from "@/lib/guardian-store";

export type GuardianVerdict =
  | "allow"
  | "scaffold"
  | "model_boundary"
  | "coach_parent"
  | "pause_with_care";

export type GuardianRuleKind = "hard" | "soft" | "schedule" | "tone" | "wellbeing";

export type GuardianRule = {
  id: string;
  text: string;
  kind: GuardianRuleKind;
  source: "builtin" | "parent";
  /** Optional keyword cues for fast soft matching (EN + AR). */
  cues?: string[];
};

export type GuardianDecision = {
  verdict: GuardianVerdict;
  reason: string;
  reasonAr: string;
  /** Reply shown to the kid when we replace the draft. */
  modifiedReply?: string;
  /** Digested insight + script for the parent feed. */
  parentCoaching?: string;
  parentCoachingAr?: string;
  ruleIds: string[];
  hard: boolean;
};

export type GuardianEvalInput = {
  kidMessage: string;
  companionDraft: string;
  companion: CompanionProfile;
  childName: string;
  companionName: string;
  ageTier: FamilyAgeTier | null;
  locale: "en" | "ar";
  recentBrain?: BrainNode[];
  /** Only hard safety + quiet hours — used before streaming. */
  preflightOnly?: boolean;
};

const WELLBEING_CUES = [
  "scared",
  "afraid",
  "anxious",
  "anxiety",
  "depressed",
  "lonely",
  "bullied",
  "bullying",
  "hate myself",
  "nobody likes me",
  "can't sleep",
  "nightmare",
  "خايف",
  "خائف",
  "قلقان",
  "حزين",
  "وحيد",
  "تنمر",
  "ما أقدر أنام",
];

const HOMEWORK_CUES = [
  "homework",
  "exam",
  "test",
  "assignment",
  "quiz",
  "واجب",
  "اختبار",
  "امتحان",
];

function ageDefaults(ageTier: FamilyAgeTier | null): GuardianRule[] {
  const younger = ageTier === "tier_6_9" || ageTier === "tier_10_13";
  return [
    {
      id: "builtin-kind",
      text: younger
        ? "Keep replies warm, short, and age-appropriate. Never scare or shame."
        : "Stay supportive and honest; model healthy boundaries when family rules apply.",
      kind: "tone",
      source: "builtin",
    },
    {
      id: "builtin-no-adult",
      text: "Do not discuss adult sexual content, dating apps, or graphic violence.",
      kind: "hard",
      source: "builtin",
      cues: ["sex", "porn", "dating app", "إباحي"],
    },
    {
      id: "builtin-strangers",
      text: "Never help arrange meetings with people the child does not know offline. Name the family safety rule openly if asked.",
      kind: "hard",
      source: "builtin",
      cues: ["stranger", "meet up", "غريب", "نلتقي"],
    },
    {
      id: "builtin-wellbeing",
      text: "If the child shares lasting fear, sadness, or bullying, stay with them warmly and coach the parent — do not interrogate.",
      kind: "wellbeing",
      source: "builtin",
      cues: WELLBEING_CUES,
    },
    {
      id: "builtin-scaffold",
      text: "For homework, help them think — ask guiding questions instead of handing full answers.",
      kind: "soft",
      source: "builtin",
      cues: HOMEWORK_CUES,
    },
  ];
}

/** Collect active rules for a child's companion (builtins + stored + parent guidance). */
export function loadGuardianRules(
  companion: CompanionProfile,
  ageTier: FamilyAgeTier | null,
): GuardianRule[] {
  const builtins = ageDefaults(ageTier);
  const childId = companion.familyMemberId || readActiveFamilyMemberId();
  const stored: GuardianRule[] = childId
    ? rulesForChild(childId).map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        source: "parent" as const,
        cues: r.cues,
      }))
    : [];
  const facts = visibleFacts(getCompanionState(), companion).filter(
    (f) => f.kind === "parent_guidance" && (f.companionId === companion.id || !f.companionId),
  );
  const guidanceRules: GuardianRule[] = facts.slice(0, 8).map((fact, index) => ({
    id: `guidance-${fact.id || index}`,
    text: fact.text.trim(),
    kind: "soft" as const,
    source: "parent" as const,
    cues: fact.text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3)
      .slice(0, 8),
  }));
  return [...builtins, ...stored, ...guidanceRules];
}

/**
 * First-pass prompt block — companion generates a compliant reply in one hop.
 * Transparent: instruct the companion to name family rules kindly when needed.
 */
export function guardianPromptPrefix(input: {
  rules: GuardianRule[];
  childName: string;
  locale: "en" | "ar";
}): string {
  if (!input.rules.length) return "";
  const ruleLines = input.rules
    .slice(0, 10)
    .map((r) => `- ${r.text}`)
    .join("\n");
  if (input.locale === "ar") {
    return [
      `[حارس العائلة — قواعد يجب احترامها مع ${input.childName}]`,
      "أنت رفيق موثوق، لست رقيباً سرياً. إن تعارض طلب مع قاعدة العائلة:",
      "1) سمِّ القاعدة بلطف ووضوح.",
      "2) ابقَ مع الطفل عاطفياً.",
      "3) اعرض بديلاً آمناً أو مساعدة في سؤال الوالد.",
      "لا تكشف ملاحظات الوالدين الخاصة حرفياً.",
      "للواجبات: ساعد على التفكير بأسئلة موجهة، لا تعطِ الإجابة كاملة.",
      "القواعد:",
      ruleLines,
      "",
    ].join("\n");
  }
  return [
    `Family notes for ${input.childName}:`,
    "You are a trusted companion. If a request conflicts with a family rule, name that rule kindly, stay with the child, and offer a safer next step or help them ask a parent.",
    "Parent notes are private context. Paraphrase them; do not read them aloud.",
    "For homework, ask guiding questions instead of handing over a full answer.",
    "Rules:",
    ruleLines,
    "",
  ].join("\n");
}

function haystack(...parts: string[]): string {
  return parts.join("\n").toLowerCase();
}

function matchCues(text: string, cues: string[] | undefined): boolean {
  if (!cues?.length) return false;
  const lower = text.toLowerCase();
  return cues.some((cue) => lower.includes(cue.toLowerCase()));
}

function pauseWithCareReply(input: {
  companionName: string;
  childName: string;
  labelEn: string;
  labelAr: string;
  locale: "en" | "ar";
}): string {
  if (input.locale === "ar") {
    return (
      `يا ${input.childName}، هذا الموضوع كبير وفيه قاعدة عائلية مهمة (` +
      `${input.labelAr}). أنا هنا معك، وما بقدر أكمل بهذا الاتجاه لأن أهلك وأنا اتفقنا نحافظ على سلامتك. ` +
      `تبي نتنفس شوي مع بعض، ولا تبي أساعدك تسأل أحد من أهلك عنه؟`
    );
  }
  return (
    `${input.childName}, that sounds like a really big thing — and we have a family safety rule about it (${input.labelEn}). ` +
    `I'm right here with you, and I can't go further on that because your family and I agreed to keep you safe. ` +
    `Want to take a couple of slow breaths with me, or should I help you ask a parent about it?`
  );
}

function modelBoundaryReply(input: {
  companionName: string;
  childName: string;
  ruleText: string;
  locale: "en" | "ar";
}): string {
  if (input.locale === "ar") {
    return (
      `يا ${input.childName}، أحب نكمل كلامنا — وفيه قاعدة عائلية نلتزم فيها: «${input.ruleText.slice(0, 120)}». ` +
      `خلّنا نختار موضوعاً آمناً نكمّل معه، أو أساعدك تسأل أهلك إن حاب توضّح القاعدة.`
    );
  }
  return (
    `Hey ${input.childName} — I'd love to keep talking with you. We also have a family rule I need to honour: ` +
    `“${input.ruleText.slice(0, 140)}”. ` +
    `Want to pick a safer angle together, or should I help you ask a parent about that rule?`
  );
}

function scaffoldReply(input: {
  childName: string;
  kidMessage: string;
  locale: "en" | "ar";
}): string {
  if (input.locale === "ar") {
    return (
      `يا ${input.childName}، خلّنا نفكّرها سوا بدل ما أعطيك الجواب جاهز. ` +
      `وش الجزء اللي تفهمه للحين؟ وإذا اخترت خطوة واحدة صغيرة تبدأ فيها، وش تكون؟`
    );
  }
  return (
    `${input.childName}, let's think this through together instead of me handing you the whole answer. ` +
    `What part do you already understand — and what's one small next step you'd try first?`
  );
}

function parentCoachingCopy(input: {
  childName: string;
  signal: string;
  locale: "en" | "ar";
}): { en: string; ar: string } {
  return {
    en:
      `${input.childName} shared something that sounds heavy (${input.signal}). ` +
      `Instead of “Are you okay?”, try a low-pressure invite: a short walk, a snack, or “I’m around if you want to vent.” ` +
      `Let them lead — your presence matters more than the perfect question.`,
    ar:
      `${input.childName} شارك شيئاً يبدو ثقيلاً (${input.signal}). ` +
      `بدل «هل أنت بخير؟»، جرّب دعوة خفيفة الضغط: مشية قصيرة، أو وجبة خفيفة، أو «أنا موجود إذا تبي تفضفض». ` +
      `خلّهم يقودون الحديث — وجودك أهم من السؤال المثالي.`,
  };
}

/**
 * Evaluate after the companion drafts a reply.
 * Hard rules → pause_with_care immediately.
 * Soft rules → transparent model_boundary / scaffold / coach_parent.
 */
export function evaluateGuardian(input: GuardianEvalInput): GuardianDecision {
  const rules = loadGuardianRules(input.companion, input.ageTier);
  const combined = haystack(input.kidMessage, input.companionDraft);
  const kidOnly = input.kidMessage;
  const childId = input.companion.familyMemberId || readActiveFamilyMemberId();

  if (childId) {
    const schedule = getDowntime(childId);
    const allowed =
      schedule.alwaysAllowedCompanionIds.includes(input.companion.id) ||
      input.companion.domain === "general";
    if (isWithinDowntime(schedule) && !allowed) {
      const windowLabel = `${schedule.start}–${schedule.end}`;
      return {
        verdict: "model_boundary",
        reason: `Quiet hours (${windowLabel}) — companion named the family rest rule.`,
        reasonAr: `ساعات الهدوء (${windowLabel}) — الرفيق سمّى قاعدة الراحة العائلية.`,
        modifiedReply:
          input.locale === "ar"
            ? `يا ${input.childName}، أحب نكمل — بس هذي ساعات الهدوء (${windowLabel}) اللي أهلنا اتفقنا عليها عشان ترتاح. نخزن مكاننا ونكمّل بكرة؟`
            : `Hey ${input.childName} — I'd love to keep going, but we're in quiet hours (${windowLabel}) that your family set so you can rest. Want to save our spot and pick this up tomorrow?`,
        parentCoaching:
          input.locale === "ar"
            ? `${input.childName} حاول الدردشة أثناء ساعات الهدوء. لا حاجة للتأنيب — مجرّد تذكير لطيف غداً يكفي.`
            : `${input.childName} tried to chat during quiet hours. No need to scold — a gentle reminder tomorrow is enough.`,
        parentCoachingAr: `${input.childName} حاول الدردشة أثناء ساعات الهدوء. لا حاجة للتأنيب — مجرّد تذكير لطيف غداً يكفي.`,
        ruleIds: ["downtime"],
        hard: false,
      };
    }
  }

  const hard = guardianHardHit(combined) ?? guardianHardHit(kidOnly);
  if (hard) {
    return {
      verdict: "pause_with_care",
      reason: `Family safety boundary: ${hard.labelEn}`,
      reasonAr: `حد أمان عائلي: ${hard.labelAr}`,
      modifiedReply: pauseWithCareReply({
        companionName: input.companionName,
        childName: input.childName,
        labelEn: hard.labelEn,
        labelAr: hard.labelAr,
        locale: input.locale,
      }),
      parentCoaching: parentCoachingCopy({
        childName: input.childName,
        signal: hard.labelEn,
        locale: input.locale,
      }).en,
      parentCoachingAr: parentCoachingCopy({
        childName: input.childName,
        signal: hard.labelAr,
        locale: input.locale,
      }).ar,
      ruleIds: [hard.id],
      hard: true,
    };
  }

  if (input.preflightOnly) {
    return {
      verdict: "allow",
      reason: "Within family rules.",
      reasonAr: "ضمن قواعد العائلة.",
      ruleIds: [],
      hard: false,
    };
  }

  const wellbeingRule = rules.find((r) => r.kind === "wellbeing");
  if (wellbeingRule && matchCues(kidOnly, WELLBEING_CUES)) {
    const coaching = parentCoachingCopy({
      childName: input.childName,
      signal: "stress / fear / loneliness",
      locale: input.locale,
    });
    return {
      verdict: "coach_parent",
      reason: "Child shared a heavy feeling — companion stays present; parent gets a gentle script.",
      reasonAr: "الطفل شارك شعوراً ثقيلاً — الرفيق يبقى حاضراً؛ الوالد يحصل على نص لطيف.",
      parentCoaching: coaching.en,
      parentCoachingAr: coaching.ar,
      ruleIds: [wellbeingRule.id],
      hard: false,
    };
  }

  const softHit = rules.find(
    (r) =>
      r.source === "parent" &&
      r.kind === "soft" &&
      matchCues(combined, r.cues) &&
      r.text.length > 8,
  );
  if (softHit) {
    return {
      verdict: "model_boundary",
      reason: softHit.text.slice(0, 100),
      reasonAr: softHit.text.slice(0, 100),
      modifiedReply: modelBoundaryReply({
        companionName: input.companionName,
        childName: input.childName,
        ruleText: softHit.text,
        locale: input.locale,
      }),
      ruleIds: [softHit.id],
      hard: false,
    };
  }

  const wantsFullAnswer =
    /\b(just\s+give\s+me\s+(the\s+)?answer|do\s+(my|the)\s+homework\s+for\s+me|write\s+(the|my)\s+essay|حل\s+الواجب|أعطني\s+الجواب)\b/i.test(
      kidOnly,
    );
  if (wantsFullAnswer || (matchCues(kidOnly, HOMEWORK_CUES) && /\b(answer|solve|finish|حل|جاوب)\b/i.test(kidOnly))) {
    return {
      verdict: "scaffold",
      reason: "Scaffolded learning instead of handing over the full answer.",
      reasonAr: "ساعدت على التفكير بدل تسليم الإجابة كاملة.",
      modifiedReply: scaffoldReply({
        childName: input.childName,
        kidMessage: kidOnly,
        locale: input.locale,
      }),
      ruleIds: ["builtin-scaffold"],
      hard: false,
    };
  }

  return {
    verdict: "allow",
    reason: "Within family rules.",
    reasonAr: "ضمن قواعد العائلة.",
    ruleIds: [],
    hard: false,
  };
}

/** True when the active seat is a child and this companion belongs to them. */
export function shouldRunGuardian(companion: CompanionProfile): boolean {
  if (!isFamilyChild()) return false;
  const activeId = readActiveFamilyMemberId();
  if (!activeId) return false;
  if (companion.familyMemberId && companion.familyMemberId !== activeId) return false;
  // Child seat chatting — always chaperone their companions (including unstamped legacy).
  return true;
}

export function guardianChildContext(companion: CompanionProfile): {
  childName: string;
  ageTier: FamilyAgeTier | null;
} {
  const active = getActiveFamilyMember();
  return {
    childName: active?.displayName?.trim() || "friend",
    ageTier: active?.ageTier ?? null,
  };
}

export function recentBrainForGuardian(limit = 8): BrainNode[] {
  const brain = getSecondBrain();
  return brainNodesForScope(brain, "individual", "all")
    .filter((n) => n.kind === "decision" || n.kind === "session" || n.kind === "fact")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/**
 * Pre-stream check — hard safety + quiet hours before any LLM tokens.
 * Soft rules still run after the draft so the companion can model them in-character.
 */
export function evaluateGuardianPreflight(input: {
  kidMessage: string;
  companion: CompanionProfile;
  locale: "en" | "ar";
}): GuardianDecision | null {
  if (!shouldRunGuardian(input.companion)) return null;
  const { childName, ageTier } = guardianChildContext(input.companion);
  return evaluateGuardian({
    kidMessage: input.kidMessage,
    companionDraft: "",
    companion: input.companion,
    childName,
    companionName: input.companion.name,
    ageTier,
    locale: input.locale,
    recentBrain: recentBrainForGuardian(),
    preflightOnly: true,
  });
}

/**
 * Full turn hook: inject prompt prefix → after draft → evaluate → maybe replace → log.
 */
export function applyGuardianToTurn(input: {
  companion: CompanionProfile;
  kidMessage: string;
  companionDraft: string;
  locale: "en" | "ar";
  /** Skip soft re-eval when preflight already produced a hard/downtime verdict. */
  preflight?: GuardianDecision | null;
}): { reply: string; decision: GuardianDecision | null; promptPrefix: string } {
  if (!shouldRunGuardian(input.companion)) {
    return { reply: input.companionDraft, decision: null, promptPrefix: "" };
  }
  const { childName, ageTier } = guardianChildContext(input.companion);
  const rules = loadGuardianRules(input.companion, ageTier);
  const promptPrefix = guardianPromptPrefix({
    rules,
    childName,
    locale: input.locale,
  });

  const decision =
    input.preflight &&
    (input.preflight.hard ||
      input.preflight.ruleIds.includes("downtime") ||
      input.preflight.verdict === "pause_with_care" ||
      (input.preflight.verdict === "model_boundary" && input.preflight.ruleIds.includes("downtime")))
      ? input.preflight
      : evaluateGuardian({
          kidMessage: input.kidMessage,
          companionDraft: input.companionDraft,
          companion: input.companion,
          childName,
          companionName: input.companion.name,
          ageTier,
          locale: input.locale,
          recentBrain: recentBrainForGuardian(),
        });

  const reply =
    decision.modifiedReply && decision.verdict !== "allow" && decision.verdict !== "coach_parent"
      ? decision.modifiedReply
      : input.companionDraft;

  if (decision.verdict !== "allow" || decision.parentCoaching) {
    const childId = readActiveFamilyMemberId();
    logGuardianDecision({
      companionId: input.companion.id,
      companionName: input.companion.name,
      childMemberId: childId,
      space: input.companion.space,
      decision,
      kidMessagePreview: input.kidMessage.slice(0, 120),
    });
    if (
      childId &&
      decision.parentCoaching &&
      (decision.verdict === "coach_parent" || decision.verdict === "pause_with_care")
    ) {
      pushCoachingAlert({
        childMemberId: childId,
        childName,
        companionName: input.companion.name,
        coaching:
          input.locale === "ar"
            ? decision.parentCoachingAr || decision.parentCoaching
            : decision.parentCoaching,
        verdict: decision.verdict,
      });
    }
  }

  return { reply, decision, promptPrefix };
}

/** Prompt-only helper for the first hop (before ask). */
export function guardianFramingForSend(
  companion: CompanionProfile,
  locale: "en" | "ar",
): string {
  if (!shouldRunGuardian(companion)) return "";
  const { childName, ageTier } = guardianChildContext(companion);
  return guardianPromptPrefix({
    rules: loadGuardianRules(companion, ageTier),
    childName,
    locale,
  });
}
