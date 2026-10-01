import { COMPANION_PRESETS, type CompanionPreset } from "@/domains/companions/companion-catalog";

/** Work companions. Home, health, and family presets stay off this desk. */
export const PROFESSIONAL_DOMAINS = [
  "work",
  "meetings",
  "inbox",
  "coder",
  "colleagues",
  "paperwork",
  "focus",
  "career",
  "trader",
  "ui-designer",
] as const;

export type ProfessionalDomain = (typeof PROFESSIONAL_DOMAINS)[number];

export type ProfessionalDuty = {
  domain: ProfessionalDomain;
  hour: number;
  repeat: "daily" | "weekdays" | "friday" | "once";
  title: string;
  titleAr: string;
  brief: string;
  briefAr: string;
};

export type ProfessionalCapability = {
  id: string;
  label: string;
  labelAr: string;
};

export type ProfessionalQuickAction = {
  id: string;
  label: string;
  labelAr: string;
  /** Composer prompt injected when the user taps the chip. */
  prompt: string;
  promptAr: string;
  /** Opens the sealed computer after send when true. */
  needsComputer?: boolean;
};

export type ProfessionalSpec = {
  domain: ProfessionalDomain;
  tagline: string;
  taglineAr: string;
  /** Short operating model — shown in Details. */
  operatingModel: string;
  operatingModelAr: string;
  capabilities: ProfessionalCapability[];
  tools: ProfessionalCapability[];
  quickActions: ProfessionalQuickAction[];
};

export const PROFESSIONAL_DUTIES: ProfessionalDuty[] = [
  {
    domain: "work",
    hour: 8,
    repeat: "weekdays",
    title: "Today's deadlines",
    titleAr: "مواعيد اليوم",
    brief: "List what is due and whether the week is too full. Do not send anything.",
    briefAr: "اذكر ما يستحق اليوم وهل الأسبوع مزدحم. لا ترسل شيئاً.",
  },
  {
    domain: "meetings",
    hour: 8,
    repeat: "weekdays",
    title: "Open promises",
    titleAr: "الوعود المفتوحة",
    brief: "List promises from meetings that still need an owner. Do not send anything.",
    briefAr: "اذكر وعود الاجتماعات التي ما زالت بلا مسؤول. لا ترسل شيئاً.",
  },
  {
    domain: "inbox",
    hour: 8,
    repeat: "weekdays",
    title: "Inbox triage",
    titleAr: "ترتيب البريد",
    brief: "Draft what needs a reply. Do not send mail.",
    briefAr: "اكتب مسودة لما يحتاج رداً. لا ترسل البريد.",
  },
  {
    domain: "coder",
    hour: 9,
    repeat: "weekdays",
    title: "Open code work",
    titleAr: "عمل الكود المفتوح",
    brief: "Say what is waiting in the repo. Do not run a command until it is approved.",
    briefAr: "قل ماذا ينتظر في المستودع. لا تشغّل أمراً إلا بعد الموافقة.",
  },
  {
    domain: "colleagues",
    hour: 9,
    repeat: "weekdays",
    title: "Who is waiting",
    titleAr: "من ينتظر",
    brief: "Name one person at work who is waiting. Do not send a message.",
    briefAr: "سمِّ شخصاً واحداً في العمل ينتظر. لا ترسل رسالة.",
  },
  {
    domain: "paperwork",
    hour: 10,
    repeat: "friday",
    title: "What expires",
    titleAr: "ما ينتهي",
    brief: "List papers that need renewal. Do not pay anything.",
    briefAr: "اذكر الأوراق التي تحتاج تجديداً. لا تدفع شيئاً.",
  },
  {
    domain: "focus",
    hour: 8,
    repeat: "weekdays",
    title: "Deep work block",
    titleAr: "وقت العمل العميق",
    brief: "Name the one block to protect today. Do not rearrange the calendar.",
    briefAr: "سمِّ الوقت الواحد الذي يُحمى اليوم. لا تغيّر التقويم.",
  },
  {
    domain: "career",
    hour: 16,
    repeat: "friday",
    title: "Career check",
    titleAr: "مراجعة المسار",
    brief: "One question about fit and load. No verdict.",
    briefAr: "سؤال واحد عن المناسبة والحمل. بلا حكم.",
  },
  {
    domain: "trader",
    hour: 8,
    repeat: "weekdays",
    title: "Market note",
    titleAr: "ملاحظة السوق",
    brief: "A careful note only. Do not invent prices. Do not tell anyone to buy or sell.",
    briefAr: "ملاحظة حذرة فقط. لا تخترع أسعاراً. لا تقل لأحد أن يشتري أو يبيع.",
  },
  {
    domain: "ui-designer",
    hour: 10,
    repeat: "weekdays",
    title: "What the page still needs",
    titleAr: "ما تبقى في الصفحة",
    brief: "Name the next layout piece. Do not publish it.",
    briefAr: "سمِّ قطعة التصميم التالية. لا تنشرها.",
  },
];

const CAP = {
  plan: { id: "plan", label: "Plan & prioritize", labelAr: "تخطيط وأولوية" },
  draft: { id: "draft", label: "Draft for approval", labelAr: "مسودة للموافقة" },
  research: { id: "research", label: "Research & brief", labelAr: "بحث وموجز" },
  track: { id: "track", label: "Track commitments", labelAr: "تتبع الالتزامات" },
  code: { id: "code", label: "Code & review", labelAr: "كود ومراجعة" },
  design: { id: "design", label: "UI critique", labelAr: "نقد واجهة" },
  market: { id: "market", label: "Market scan", labelAr: "مسح السوق" },
  coach: { id: "coach", label: "Career coaching", labelAr: "توجيه مهني" },
  focus: { id: "focus", label: "Focus guard", labelAr: "حماية التركيز" },
  relations: { id: "relations", label: "Relationship pulse", labelAr: "نبض العلاقات" },
} as const;

const TOOL = {
  computer: { id: "computer", label: "Sealed computer", labelAr: "حاسوب معزول" },
  browser: { id: "browser", label: "Chrome", labelAr: "كروم" },
  terminal: { id: "terminal", label: "Terminal", labelAr: "طرفية" },
  files: { id: "files", label: "Finder", labelAr: "الملفات" },
  notes: { id: "notes", label: "Notes", labelAr: "ملاحظات" },
  desk: { id: "desk", label: "Desk jobs", labelAr: "مهام المكتب" },
  schedule: { id: "schedule", label: "Standing duties", labelAr: "واجبات ثابتة" },
  whatsapp: { id: "whatsapp", label: "WhatsApp drafts", labelAr: "مسودات واتساب" },
} as const;

export const PROFESSIONAL_SPECS: ProfessionalSpec[] = [
  {
    domain: "work",
    tagline: "Chief of staff for your workday",
    taglineAr: "رئيس موظفين ليوم عملك",
    operatingModel:
      "Scans deadlines, drafts the next move, and waits for your yes before anything leaves the desk.",
    operatingModelAr: "يفحص المواعيد، يكتب الخطوة التالية، وينتظر نعمك قبل أن يخرج أي شيء من المكتب.",
    capabilities: [CAP.plan, CAP.draft, CAP.track, CAP.research],
    tools: [TOOL.computer, TOOL.browser, TOOL.notes, TOOL.desk, TOOL.schedule],
    quickActions: [
      {
        id: "briefing",
        label: "Morning briefing",
        labelAr: "إحاطة الصباح",
        prompt: "Give me today's work briefing: top deadlines, risks, and the one thing I should finish first.",
        promptAr: "أعطني إحاطة عمل اليوم: أهم المواعيد، المخاطر، والشيء الواحد الذي أنجزه أولاً.",
      },
      {
        id: "unblock",
        label: "Unblock me",
        labelAr: "فكّ الحصار",
        prompt: "I'm stuck. Diagnose the blocker and propose the smallest next step I can approve.",
        promptAr: "أنا عالق. شخص العائق واقترح أصغر خطوة تالية أوافق عليها.",
      },
      {
        id: "research-tab",
        label: "Research in Chrome",
        labelAr: "ابحث في كروم",
        prompt: "Open Chrome on your computer and research the top priority for today. Summarize sources before I approve anything.",
        promptAr: "افتح كروم على حاسوبك وابحث عن أولوية اليوم. لخّص المصادر قبل أن أوافق على أي شيء.",
        needsComputer: true,
      },
    ],
  },
  {
    domain: "meetings",
    tagline: "Meeting memory that never drops a promise",
    taglineAr: "ذاكرة اجتماعات لا تُسقط وعداً",
    operatingModel: "Turns notes into owners and follow-ups. Never emails or messages until you release a draft.",
    operatingModelAr: "يحوّل الملاحظات إلى مسؤولين ومتابعات. لا يرسل بريداً ولا رسالة حتى تعتمد المسودة.",
    capabilities: [CAP.track, CAP.draft, CAP.plan],
    tools: [TOOL.notes, TOOL.desk, TOOL.schedule, TOOL.computer],
    quickActions: [
      {
        id: "promises",
        label: "Open promises",
        labelAr: "الوعود المفتوحة",
        prompt: "List open meeting promises with owners and the next nudge — draft only.",
        promptAr: "اذكر وعود الاجتماعات المفتوحة مع المسؤولين والدفعة التالية — مسودة فقط.",
      },
      {
        id: "recap",
        label: "Recap last meeting",
        labelAr: "ملخص آخر اجتماع",
        prompt: "Draft a crisp meeting recap with decisions, owners, and due dates. Do not send it.",
        promptAr: "اكتب ملخص اجتماع مختصر: قرارات، مسؤولون، ومواعيد. لا ترسله.",
      },
    ],
  },
  {
    domain: "inbox",
    tagline: "Triage that protects your attention",
    taglineAr: "فرز يحمي انتباهك",
    operatingModel: "Ranks what needs a reply, drafts responses, and never hits send without your release.",
    operatingModelAr: "يرتب ما يحتاج رداً، يكتب المسودات، ولا يضغط إرسال دون اعتمادك.",
    capabilities: [CAP.draft, CAP.plan, CAP.track],
    tools: [TOOL.browser, TOOL.notes, TOOL.desk, TOOL.whatsapp],
    quickActions: [
      {
        id: "triage",
        label: "Triage inbox",
        labelAr: "فرز البريد",
        prompt: "Triage my inbox into: reply today, wait, and ignore. Draft the top reply only.",
        promptAr: "فرّز بريدي إلى: رد اليوم، انتظار، وتجاهل. اكتب مسودة أهم رد فقط.",
      },
      {
        id: "draft-reply",
        label: "Draft a reply",
        labelAr: "مسودة رد",
        prompt: "Draft a professional reply for the most urgent thread. Keep it short and ready for my edit.",
        promptAr: "اكتب رداً مهنياً لأهم خيط. اجعله قصيراً وجاهزاً لتعديلي.",
      },
    ],
  },
  {
    domain: "coder",
    tagline: "Pair engineer on a sealed Mac sandbox",
    taglineAr: "مهندس شريك على صندوق معزول",
    operatingModel: "Inspects code, proposes patches, and runs terminal only after you release each line.",
    operatingModelAr: "يفحص الكود، يقترح تعديلات، ويشغّل الطرفية فقط بعد اعتماد كل سطر.",
    capabilities: [CAP.code, CAP.research, CAP.plan],
    tools: [TOOL.computer, TOOL.terminal, TOOL.files, TOOL.browser, TOOL.desk],
    quickActions: [
      {
        id: "status",
        label: "Repo status",
        labelAr: "حالة المستودع",
        prompt: "Open the terminal on your computer and check git status. Summarize what is dirty before running anything else.",
        promptAr: "افتح الطرفية على حاسوبك وافحص git status. لخّص ما هو متسخ قبل تشغيل أي شيء آخر.",
        needsComputer: true,
      },
      {
        id: "review",
        label: "Review a change",
        labelAr: "راجع تغييراً",
        prompt: "Review the current change set for bugs and risk. Propose a patch plan — do not apply until I approve.",
        promptAr: "راجع التغيير الحالي بحثاً عن أخطاء ومخاطر. اقترح خطة تعديل — لا تطبّق حتى أوافق.",
      },
      {
        id: "fix",
        label: "Debug with me",
        labelAr: "صحّح معي",
        prompt: "Help me debug. Ask for the error, open Finder/terminal if needed, and propose the smallest fix.",
        promptAr: "ساعدني في التصحيح. اطلب الخطأ، افتح الملفات/الطرفية عند الحاجة، واقترح أصغر إصلاح.",
        needsComputer: true,
      },
    ],
  },
  {
    domain: "colleagues",
    tagline: "Relationship radar for work",
    taglineAr: "رادار علاقات العمل",
    operatingModel: "Surfaces who is waiting and drafts the reach-out. Never sends without your yes.",
    operatingModelAr: "يُظهر من ينتظر ويكتب مسودة التواصل. لا يرسل دون نعمك.",
    capabilities: [CAP.relations, CAP.draft, CAP.track],
    tools: [TOOL.notes, TOOL.whatsapp, TOOL.desk, TOOL.schedule],
    quickActions: [
      {
        id: "waiting",
        label: "Who is waiting",
        labelAr: "من ينتظر",
        prompt: "Who at work is waiting on me? One person, why it matters, and a draft message.",
        promptAr: "من في العمل ينتظرني؟ شخص واحد، لماذا يهم، ومسودة رسالة.",
      },
      {
        id: "nudge",
        label: "Draft a nudge",
        labelAr: "مسودة تنبيه",
        prompt: "Draft a short, respectful nudge to the colleague who has been waiting longest.",
        promptAr: "اكتب تنبيهاً قصيراً ومحترماً لزميل الانتظار الأطول.",
      },
    ],
  },
  {
    domain: "paperwork",
    tagline: "Compliance desk without surprise bills",
    taglineAr: "مكتب أوراق بلا فواتير مفاجئة",
    operatingModel: "Tracks renewals and drafts paperwork. Never pays or submits until you release.",
    operatingModelAr: "يتتبع التجديدات ويكتب الأوراق. لا يدفع ولا يقدّم حتى تعتمد.",
    capabilities: [CAP.track, CAP.draft, CAP.plan],
    tools: [TOOL.files, TOOL.notes, TOOL.desk, TOOL.browser],
    quickActions: [
      {
        id: "expires",
        label: "What expires",
        labelAr: "ما ينتهي",
        prompt: "List papers and renewals that expire soon, with the next action — draft only, no payment.",
        promptAr: "اذكر الأوراق والتجديدات القريبة الانتهاء مع الخطوة التالية — مسودة فقط بلا دفع.",
      },
      {
        id: "folder",
        label: "Open paperwork folder",
        labelAr: "افتح مجلد الأوراق",
        prompt: "Open Finder on your computer to the paperwork folder and list what you see.",
        promptAr: "افتح الملفات على حاسوبك لمجلد الأوراق واذكر ما تراه.",
        needsComputer: true,
      },
    ],
  },
  {
    domain: "focus",
    tagline: "Deep-work bodyguard",
    taglineAr: "حارس العمل العميق",
    operatingModel: "Protects one block, kills noise, and refuses calendar gymnastics without approval.",
    operatingModelAr: "يحمي وقتاً واحداً، يقطع الضجيج، ويرفض تعديل التقويم دون موافقة.",
    capabilities: [CAP.focus, CAP.plan],
    tools: [TOOL.notes, TOOL.schedule, TOOL.desk],
    quickActions: [
      {
        id: "block",
        label: "Protect a block",
        labelAr: "احمِ وقتاً",
        prompt: "Name the one deep-work block I should protect today and what to defer.",
        promptAr: "سمِّ وقت العمل العميق الذي أحميه اليوم وما يؤجَّل.",
      },
      {
        id: "noise",
        label: "Kill the noise",
        labelAr: "اقطع الضجيج",
        prompt: "What should I ignore for the next 90 minutes so I can finish the main task?",
        promptAr: "ماذا أتجاهل خلال التسعين دقيقة القادمة لأنهي المهمة الرئيسية؟",
      },
    ],
  },
  {
    domain: "career",
    tagline: "Honest career sparring partner",
    taglineAr: "شريك صريح للمسار المهني",
    operatingModel: "Asks sharp questions about fit and load. No verdicts dressed as advice.",
    operatingModelAr: "يطرح أسئلة حادة عن المناسبة والحمل. بلا أحكام متنكرة كنصائح.",
    capabilities: [CAP.coach, CAP.research, CAP.plan],
    tools: [TOOL.notes, TOOL.browser, TOOL.schedule],
    quickActions: [
      {
        id: "fit",
        label: "Fit check",
        labelAr: "فحص المناسبة",
        prompt: "Ask me one sharp question about role fit this week, then wait for my answer.",
        promptAr: "اسألني سؤالاً حاداً واحداً عن مناسبة الدور هذا الأسبوع، ثم انتظر جوابي.",
      },
      {
        id: "load",
        label: "Load check",
        labelAr: "فحص الحمل",
        prompt: "Is my load sustainable? Challenge me with evidence from what you remember — no pep talk.",
        promptAr: "هل حملي مستدام؟ تحدَّني بأدلة مما تتذكره — بلا تشجيع فارغ.",
      },
    ],
  },
  {
    domain: "trader",
    tagline: "Careful market note — never a tip",
    taglineAr: "ملاحظة سوق حذرة — ليست توصية",
    operatingModel: "Researches carefully, never invents prices, never tells you to buy or sell.",
    operatingModelAr: "يبحث بحذر، لا يخترع أسعاراً، ولا يقول اشترِ أو بِع.",
    capabilities: [CAP.market, CAP.research, CAP.draft],
    tools: [TOOL.browser, TOOL.notes, TOOL.computer, TOOL.desk],
    quickActions: [
      {
        id: "note",
        label: "Market note",
        labelAr: "ملاحظة السوق",
        prompt: "Give a careful market note for today. No prices you cannot verify. No buy/sell.",
        promptAr: "أعطِ ملاحظة سوق حذرة لليوم. بلا أسعار لا تتحقق منها. بلا شراء/بيع.",
      },
      {
        id: "scan",
        label: "Scan in Chrome",
        labelAr: "امسح في كروم",
        prompt: "Open Chrome on your computer and scan reputable sources for today's market context. Summarize only.",
        promptAr: "افتح كروم على حاسوبك وامسح مصادر موثوقة لسياق السوق اليوم. لخّص فقط.",
        needsComputer: true,
      },
    ],
  },
  {
    domain: "ui-designer",
    tagline: "Product design critic on call",
    taglineAr: "ناقد تصميم منتج تحت الطلب",
    operatingModel: "Names the next layout piece and critiques clarity. Never publishes without approval.",
    operatingModelAr: "يسمّي قطعة التصميم التالية وينتقد الوضوح. لا ينشر دون موافقة.",
    capabilities: [CAP.design, CAP.research, CAP.draft],
    tools: [TOOL.browser, TOOL.files, TOOL.notes, TOOL.computer],
    quickActions: [
      {
        id: "next",
        label: "Next layout piece",
        labelAr: "قطعة التصميم التالية",
        prompt: "What does this page still need? Name the next layout piece and why it matters.",
        promptAr: "ماذا ما زالت الصفحة تحتاج؟ سمِّ قطعة التصميم التالية ولماذا تهم.",
      },
      {
        id: "critique",
        label: "Critique this UI",
        labelAr: "انتقد هذه الواجهة",
        prompt: "Critique the current UI for hierarchy, spacing, and clarity. Give three concrete fixes.",
        promptAr: "انتقد الواجهة الحالية للتسلسل والمسافات والوضوح. أعطِ ثلاثة إصلاحات ملموسة.",
      },
    ],
  },
];

export function professionalPresets(): CompanionPreset[] {
  return PROFESSIONAL_DOMAINS.map((domain) => COMPANION_PRESETS.find((item) => item.domain === domain)).filter(
    (item): item is CompanionPreset => Boolean(item),
  );
}

export function professionalDuty(domain: string): ProfessionalDuty | null {
  return PROFESSIONAL_DUTIES.find((item) => item.domain === domain) ?? null;
}

export function professionalSpec(domain: string): ProfessionalSpec | null {
  return PROFESSIONAL_SPECS.find((item) => item.domain === domain) ?? null;
}

/** User phrasing that should wake the sealed computer (signed-in only). */
export function userAskedForComputer(text: string): boolean {
  const line = text.trim();
  if (line.length < 3) return false;
  return (
    /\b(computer|desktop|sandbox|chrome|browser|finder|terminal|notes?\s+app)\b/i.test(line) ||
    /\bopen\s+(chrome|browser|finder|files|notes?|terminal)\b/i.test(line) ||
    /\b(use|run|check|browse|search)\s+.{0,40}\b(computer|chrome|browser|finder|terminal)\b/i.test(line) ||
    /(الكمبيوتر|الحاسوب|كروم|المتصفح|الملفات|الطرفية|الصندوق المعزول)/i.test(line) ||
    /افتح\s+(كروم|المتصفح|الملفات|الطرفية|الملاحظات)/i.test(line)
  );
}
