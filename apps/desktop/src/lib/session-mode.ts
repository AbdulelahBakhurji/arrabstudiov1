export const SESSION_MODES = ["agent", "plan", "debug", "multitask", "ask"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

const KEY = "arrab.sessionMode";
const EVENT = "arrab:session-mode";

export const SESSION_MODE_META: Record<
  SessionMode,
  { labelEn: string; labelAr: string; hintEn: string; hintAr: string }
> = {
  agent: {
    labelEn: "Agent",
    labelAr: "وكيل",
    hintEn: "Do the work end to end",
    hintAr: "ينفّذ العمل من البداية للنهاية",
  },
  plan: {
    labelEn: "Plan",
    labelAr: "خطة",
    hintEn: "Think through steps before acting",
    hintAr: "يفكّر بالخطوات قبل التنفيذ",
  },
  debug: {
    labelEn: "Debug",
    labelAr: "تصحيح",
    hintEn: "Find and fix what broke",
    hintAr: "يجد العطل ويصلحه",
  },
  multitask: {
    labelEn: "Multitask",
    labelAr: "مهام متعددة",
    hintEn: "Juggle several threads at once",
    hintAr: "يدير عدة خيوط معًا",
  },
  ask: {
    labelEn: "Ask",
    labelAr: "اسأل",
    hintEn: "Answer questions — no edits",
    hintAr: "يجيب فقط — بلا تعديلات",
  },
};

export function isSessionMode(value: string): value is SessionMode {
  return (SESSION_MODES as readonly string[]).includes(value);
}

export function readSessionMode(): SessionMode {
  try {
    const value = sessionStorage.getItem(KEY)?.trim().toLowerCase();
    if (value && isSessionMode(value)) return value;
  } catch {
    /* ignore */
  }
  return "agent";
}

export function writeSessionMode(mode: SessionMode): void {
  try {
    sessionStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function subscribeSessionMode(listener: (mode: SessionMode) => void): () => void {
  const onMode = (event: Event) => {
    const detail = (event as CustomEvent<SessionMode>).detail;
    listener(detail && isSessionMode(detail) ? detail : readSessionMode());
  };
  window.addEventListener(EVENT, onMode);
  return () => window.removeEventListener(EVENT, onMode);
}

/** Heuristic: when the user's message fits another mode better than the current one. */
export function detectSuggestedMode(text: string, current: SessionMode): SessionMode | null {
  const value = text.toLowerCase();
  if (
    /\b(plan|roadmap|architecture|design (a|the|this)|step[- ]by[- ]step|break (this|it) down|how (should|do) we (approach|structure|build)|outline|strategy)\b|خطة|تخطيط|خارطة طريق|تصميم/.test(
      value,
    )
  ) {
    return current === "plan" ? null : "plan";
  }
  if (
    /\b(bug|error|fix|broken|stack ?trace|not working|why (is|does|isn't|won't)|debug|traceback|exception)\b|خطأ|عطل|إصلاح|تصحيح|ليش ما/.test(
      value,
    )
  ) {
    return current === "debug" ? null : "debug";
  }
  if (
    /\b(and also|meanwhile|in parallel|multiple|several tasks|at the same time|two things|both)\b|بالتوازي|عدة مهام|وكمان|وفي نفس الوقت/.test(
      value,
    )
  ) {
    return current === "multitask" ? null : "multitask";
  }
  if (
    /\b(what is|what are|explain|how does|help me understand|tell me about|why do|define)\b|اشرح|ما هو|ما هي|ساعدني أفهم|عرّف/.test(
      value,
    ) &&
    !/\b(build|implement|fix|create|write|deploy|run)\b|ابني|نفّذ|أنشئ/.test(value)
  ) {
    return current === "ask" ? null : "ask";
  }
  if (
    /\b(implement|build|create|write the|run this|do it|make it|ship|deploy|go ahead)\b|نفّذ|ابني|أنشئ|كمّل/.test(
      value,
    ) &&
    (current === "ask" || current === "plan")
  ) {
    return "agent";
  }
  return null;
}

export function sessionModePromptPrefix(mode: SessionMode): string {
  const base =
    "If a different mode would serve the user better (agent|plan|debug|multitask|ask), end your reply with exactly one line: [[suggest_mode:MODE]] and nothing after it.\n\n";
  switch (mode) {
    case "plan":
      return `[Session mode: Plan. Do not jump into implementation. Clarify goals, constraints, and a short ordered plan. Ask before acting.]\n${base}`;
    case "debug":
      return `[Session mode: Debug. Reproduce the failure, isolate the cause, propose a minimal fix. Prefer evidence over guesses.]\n${base}`;
    case "multitask":
      return `[Session mode: Multitask. Track parallel threads clearly. Number items, keep each thread short, and say what you will do next on each.]\n${base}`;
    case "ask":
      return `[Session mode: Ask. Answer clearly. Do not edit files, run tools, or take actions unless the user explicitly asks.]\n${base}`;
    case "agent":
    default:
      return `[Session mode: Agent. Take useful action. Prefer doing the work over only describing it.]\n${base}`;
  }
}

const SUGGEST_RE = /\[\[\s*suggest_mode\s*:\s*(agent|plan|debug|multitask|ask)\s*\]\]/i;

export function stripSuggestModeMarker(text: string): {
  text: string;
  suggested: SessionMode | null;
} {
  const match = text.match(SUGGEST_RE);
  const suggested = match?.[1] ? (match[1].toLowerCase() as SessionMode) : null;
  return {
    text: text.replace(SUGGEST_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd(),
    suggested: suggested && isSessionMode(suggested) ? suggested : null,
  };
}
