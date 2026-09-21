import { COMPANION_PRESETS } from "@/lib/companion-catalog";
import type { CompanionProfile } from "@/lib/companions";

export type CompanionSuggestKind = "email" | "code" | "money" | "sleep" | "general" | "custom";

export type CompanionSuggestion = {
  id: string;
  labelEn: string;
  labelAr: string;
  /** Fills the composer and sends as a normal chat turn. */
  promptEn?: string;
  promptAr?: string;
  /** Opens the in-app connector picker for this family. */
  connect?: "email" | "code";
  mode?: "vent" | "take";
};

export type ConnectFamily = "email" | "code";

export type ConnectProviderOption = {
  id: string;
  labelEn: string;
  labelAr: string;
  /** OAuth in the system browser. */
  oauth?: "gmail" | "outlook" | "github" | "gitlab" | "bitbucket" | "linear" | "slack" | "notion";
  /** Open Connectors page focused on this provider. */
  connectorsProvider?: string;
};

const EMAIL_PROVIDERS: ConnectProviderOption[] = [
  { id: "gmail", labelEn: "Gmail", labelAr: "Gmail", oauth: "gmail" },
  { id: "outlook", labelEn: "Outlook", labelAr: "Outlook", oauth: "outlook" },
  {
    id: "email",
    labelEn: "Other email (IMAP)",
    labelAr: "بريد آخر (IMAP)",
    connectorsProvider: "email",
  },
];

const CODE_PROVIDERS: ConnectProviderOption[] = [
  { id: "github", labelEn: "GitHub", labelAr: "GitHub", oauth: "github" },
  { id: "gitlab", labelEn: "GitLab", labelAr: "GitLab", oauth: "gitlab" },
  { id: "ssh", labelEn: "SSH server", labelAr: "خادم SSH", connectorsProvider: "ssh" },
  {
    id: "bitbucket",
    labelEn: "Bitbucket",
    labelAr: "Bitbucket",
    oauth: "bitbucket",
  },
];

function haystack(person: CompanionProfile): string {
  return `${person.domain} ${person.name} ${(person.connectors ?? []).join(" ")}`.toLowerCase();
}

export function companionSuggestKind(person: CompanionProfile): CompanionSuggestKind {
  const text = haystack(person);
  const connectors = new Set((person.connectors ?? []).map((item) => item.toLowerCase()));
  if (
    /inbox|email|mail|بريد|gmail|outlook/.test(text) ||
    connectors.has("gmail") ||
    connectors.has("outlook") ||
    connectors.has("email")
  ) {
    return "email";
  }
  if (
    /code|coder|coding|dev|github|gitlab|ssh|focus|engineer|مطور|كود|برمجة/.test(text) ||
    connectors.has("github") ||
    connectors.has("gitlab") ||
    connectors.has("ssh") ||
    connectors.has("bitbucket")
  ) {
    return "code";
  }
  if (/money|spend|budget|مال|مصروف|فواتير/.test(text)) return "money";
  if (/sleep|نوم|سهر|راحة/.test(text)) return "sleep";
  if (person.domain === "general") return "general";
  const preset = COMPANION_PRESETS.find((item) => item.domain === person.domain);
  if (preset?.connectors.some((item) => ["gmail", "outlook", "email"].includes(item))) {
    return "email";
  }
  if (preset?.connectors.some((item) => ["github", "gitlab", "ssh"].includes(item))) {
    return "code";
  }
  return "custom";
}

export function connectProvidersFor(family: ConnectFamily): ConnectProviderOption[] {
  return family === "email" ? EMAIL_PROVIDERS : CODE_PROVIDERS;
}

/** Composer chips under the input — companion-specific + connect actions. */
export function companionComposerSuggestions(person: CompanionProfile): CompanionSuggestion[] {
  const kind = companionSuggestKind(person);
  const shared: CompanionSuggestion[] = [
    {
      id: "vent",
      labelEn: "I just want to vent",
      labelAr: "أريد أن أفضفض فقط",
      mode: "vent",
    },
    {
      id: "take",
      labelEn: "I need your take",
      labelAr: "أريد رأيك",
      mode: "take",
    },
  ];

  if (kind === "email") {
    return [
      {
        id: "connect-email",
        labelEn: "Connect email",
        labelAr: "ربط البريد",
        connect: "email",
      },
      {
        id: "triage",
        labelEn: "Triage my inbox",
        labelAr: "رتّب صندوق الوارد",
        promptEn: "Help me triage my inbox — what should I handle first?",
        promptAr: "ساعدني أرتّب صندوق الوارد — وش أبدأ فيه؟",
      },
      {
        id: "draft",
        labelEn: "Draft a reply",
        labelAr: "صغ رداً",
        promptEn: "Help me draft a clear email reply.",
        promptAr: "ساعدني أصوغ رد بريد واضح.",
      },
      shared[1]!,
    ];
  }

  if (kind === "code") {
    return [
      {
        id: "connect-code",
        labelEn: "Connect coding source",
        labelAr: "ربط مصدر برمجة",
        connect: "code",
      },
      {
        id: "review",
        labelEn: "Review this approach",
        labelAr: "راجع هذا الأسلوب",
        promptEn: "Review this approach and tell me the risks.",
        promptAr: "راجع هذا الأسلوب وقل لي المخاطر.",
      },
      {
        id: "debug",
        labelEn: "Help me debug",
        labelAr: "ساعدني أصلح خطأ",
        promptEn: "Help me debug this — ask for the error and the file.",
        promptAr: "ساعدني أصلح هذا الخطأ — اسألني عن الرسالة والملف.",
      },
      shared[1]!,
    ];
  }

  if (kind === "sleep") {
    return [
      {
        id: "late",
        labelEn: "I stayed up too late",
        labelAr: "سهرت زيادة",
        promptEn: "I stayed up too late — what should I do tonight?",
        promptAr: "سهرت زيادة — وش أسوي الليلة؟",
      },
      {
        id: "plan",
        labelEn: "Plan tonight's sleep",
        labelAr: "خطّط لنوم الليلة",
        promptEn: "Help me plan a realistic sleep window tonight.",
        promptAr: "ساعدني أخطط لنافذة نوم واقعية الليلة.",
      },
      ...shared,
    ];
  }

  if (kind === "money") {
    return [
      {
        id: "spend",
        labelEn: "Check my spending",
        labelAr: "راجع مصروفي",
        promptEn: "Help me check where spending is drifting.",
        promptAr: "ساعدني أشوف وين انحرف المصروف.",
      },
      {
        id: "bill",
        labelEn: "Upcoming bill",
        labelAr: "فاتورة قادمة",
        promptEn: "I have a bill coming up — help me plan for it.",
        promptAr: "عندي فاتورة قريبة — ساعدني أخطط لها.",
      },
      ...shared,
    ];
  }

  return [
    {
      id: "summarise",
      labelEn: "Summarise this text",
      labelAr: "لخّص لي هذا النص",
      promptEn: "Summarise this text for me:",
      promptAr: "لخّص لي هذا النص:",
    },
    {
      id: "long-day",
      labelEn: "Today was a long one",
      labelAr: "كان يوماً طويلاً",
      promptEn: "Today was a long one.",
      promptAr: "كان يوماً طويلاً.",
    },
    ...shared,
  ];
}

/** Empty-state starter cards (larger welcome buttons). */
export function companionWelcomeSuggestions(person: CompanionProfile): CompanionSuggestion[] {
  return companionComposerSuggestions(person).slice(0, 2);
}

export function detectConnectFamily(text: string, person: CompanionProfile): ConnectFamily | null {
  const value = text.toLowerCase();
  const kind = companionSuggestKind(person);
  if (
    /connect\s+(my\s+)?(email|mail|gmail|outlook|inbox)|ربط\s*(البريد|الإيميل|ايميل)|وصل\s*(البريد|الإيميل)/i.test(
      value,
    ) ||
    ((/connect|ربط|وصل/.test(value) && /email|mail|gmail|outlook|بريد|إيميل|ايميل/.test(value)))
  ) {
    return "email";
  }
  if (
    /connect\s+(my\s+)?(code|coding|github|gitlab|ssh|repo|source)|ربط\s*(مصدر|كود|برمجة|قithub|github|gitlab|ssh)/i.test(
      value,
    ) ||
    ((/connect|ربط|وصل/.test(value) &&
      /code|coder|coding|github|gitlab|ssh|repo|source|كود|برمجة|مستودع/.test(value)))
  ) {
    return "code";
  }
  if (kind === "email" && /^(connect|ربط|وصل)\b/i.test(value.trim())) return "email";
  if (kind === "code" && /^(connect|ربط|وصل)\b/i.test(value.trim())) return "code";
  return null;
}

export function detectConnectProvider(
  text: string,
  family: ConnectFamily,
): ConnectProviderOption | null {
  const value = text.toLowerCase().trim();
  if (family === "email") {
    if (/\bgmail\b/i.test(value)) return EMAIL_PROVIDERS.find((item) => item.id === "gmail") ?? null;
    if (/\boutlook\b|\bhotmail\b|\blive\.com\b/i.test(value)) {
      return EMAIL_PROVIDERS.find((item) => item.id === "outlook") ?? null;
    }
    if (/\bimap\b|other email|بريد آخر|بريد غيره/i.test(value)) {
      return EMAIL_PROVIDERS.find((item) => item.id === "email") ?? null;
    }
    return null;
  }
  if (/\bgithub\b/i.test(value)) return CODE_PROVIDERS.find((item) => item.id === "github") ?? null;
  if (/\bgitlab\b/i.test(value)) return CODE_PROVIDERS.find((item) => item.id === "gitlab") ?? null;
  if (/\bbitbucket\b/i.test(value)) {
    return CODE_PROVIDERS.find((item) => item.id === "bitbucket") ?? null;
  }
  if (/\bssh\b|سيرفر|خادم/i.test(value)) {
    return CODE_PROVIDERS.find((item) => item.id === "ssh") ?? null;
  }
  return null;
}
