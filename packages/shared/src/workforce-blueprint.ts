/** Organization setup — AI-drafted departments and companions for a new company. */

export type BlueprintLocale = "en" | "ar";

/** A repeatable procedure taught to a companion (stored as an agent skill). */
export interface WorkforceBlueprintSkill {
  title: string;
  instructions: string;
}

export interface WorkforceBlueprintCompanion {
  name: string;
  role: string;
  specialty: string | null;
  instructions: string;
  /** Department skills tailored to the industry. Always at least one after normalization. */
  skills: WorkforceBlueprintSkill[];
}

export interface WorkforceBlueprintDepartment {
  name: string;
  purpose: string;
  /** Industry operating notes for the department, saved as shared knowledge. */
  playbook: string;
  companions: WorkforceBlueprintCompanion[];
}

export interface WorkforceBlueprint {
  industry: string;
  summary: string;
  departments: WorkforceBlueprintDepartment[];
  /** "ai" when a model drafted it; "template" when built from the industry library. */
  source: "ai" | "template";
}

export interface WorkforceBlueprintRequest {
  /** What the company does, in the admin's own words. */
  industry: string;
  /** Size, goals, change requests from the setup chat. */
  details?: string | null;
  locale?: BlueprintLocale;
}

export const BLUEPRINT_MAX_DEPARTMENTS = 8;
export const BLUEPRINT_MAX_COMPANIONS = 5;
export const BLUEPRINT_MAX_SKILLS = 4;
const MAX_TEXT = 600;
const MAX_PLAYBOOK = 2400;

function text(value: unknown, max = 120): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function multiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function normalizeSkills(raw: unknown): WorkforceBlueprintSkill[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const skills: WorkforceBlueprintSkill[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { title?: unknown; instructions?: unknown };
    const title = text(entry.title, 80);
    const instructions = multiline(entry.instructions, MAX_TEXT);
    if (!title || instructions.length < 12 || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    skills.push({ title, instructions });
    if (skills.length >= BLUEPRINT_MAX_SKILLS) break;
  }
  return skills;
}

/** Department skills for a companion when the model or template gave none. */
export function defaultCompanionSkills(input: {
  role: string;
  specialty: string | null;
  department: string;
  industry: string;
  locale?: BlueprintLocale;
}): WorkforceBlueprintSkill[] {
  const industry = text(input.industry, 120) || (input.locale === "ar" ? "الشركة" : "the company");
  const focus = input.specialty || input.role;
  if (input.locale === "ar") {
    return [
      {
        title: focus,
        instructions: `طبّق ${focus} في قسم ${input.department} لشركة تعمل في ${industry}. ابدأ من الموجز، اتبع دليل القسم، وسلّم مخرجاً جاهزاً للمراجعة مع الافتراضات والخطوات التالية.`,
      },
      {
        title: `تقرير ${input.department} الأسبوعي`,
        instructions: `كل أسبوع لخّص في خمس نقاط: ما أُنجز، ما المتعطل، المخاطر في ${industry}، وما تحتاجه من القرار البشري.`,
      },
      {
        title: "الموافقات والتصعيد",
        instructions:
          "قبل أي دفع أو عقد أو سعر أو رسالة خارجية: اكتب المسودة واطلب موافقة بشرية. صعّد فوراً أي أمر قانوني أو يخص بيانات العملاء.",
      },
    ];
  }
  return [
    {
      title: focus,
      instructions: `Apply ${focus} inside ${input.department} for a company in ${industry}. Start from the brief, follow the department playbook, and deliver a review-ready output with assumptions and next steps.`,
    },
    {
      title: `Weekly ${input.department} report`,
      instructions: `Every week, summarize in five bullets: what shipped, what is blocked, risks specific to ${industry}, and the decisions you need from a human.`,
    },
    {
      title: "Approvals and escalation",
      instructions:
        "Before any payment, contract, price, or outbound message: draft it and request human approval. Escalate anything legal or involving customer data immediately.",
    },
  ];
}

/** Industry operating notes for a department when the model gave none. */
export function defaultDepartmentPlaybook(input: {
  name: string;
  purpose: string;
  companions: Array<{ name: string; role: string; specialty: string | null }>;
  industry: string;
  locale?: BlueprintLocale;
}): string {
  const industry = text(input.industry, 160);
  const roster = input.companions
    .map((person) => `- ${person.name} — ${person.role}${person.specialty ? ` (${person.specialty})` : ""}`)
    .join("\n");
  if (input.locale === "ar") {
    return [
      `دليل ${input.name}${industry ? ` — ${industry}` : ""}`,
      input.purpose ? `المهمة: ${input.purpose}` : "",
      roster ? `الفريق:\n${roster}` : "",
      "طريقة العمل:\n- كل مهمة تبدأ بموجز واضح ومعيار إنجاز.\n- المخرجات تُسلَّم كمسودات للمراجعة.\n- تقرير أسبوعي للقسم كل أحد.",
      "يحتاج موافقة بشرية: المدفوعات، العقود، الأسعار، الرسائل الخارجية، وأي بيانات شخصية للعملاء.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `${input.name} playbook${industry ? ` — ${industry}` : ""}`,
    input.purpose ? `Mission: ${input.purpose}` : "",
    roster ? `Team:\n${roster}` : "",
    "How we work:\n- Every task starts with a clear brief and a definition of done.\n- Deliverables ship as drafts for review.\n- One department report every Monday.",
    "Needs human approval: payments, contracts, prices, outbound messages, and any customer personal data.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Validate model output into a safe blueprint. Returns null when unusable. */
export function normalizeWorkforceBlueprint(
  raw: unknown,
  request: WorkforceBlueprintRequest,
): WorkforceBlueprint | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as { summary?: unknown; departments?: unknown };
  if (!Array.isArray(input.departments)) return null;
  const locale: BlueprintLocale = request.locale === "ar" ? "ar" : "en";
  const seen = new Set<string>();
  const departments: WorkforceBlueprintDepartment[] = [];
  for (const entry of input.departments) {
    if (!entry || typeof entry !== "object") continue;
    const dept = entry as { name?: unknown; purpose?: unknown; playbook?: unknown; companions?: unknown };
    const name = text(dept.name, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const companions: WorkforceBlueprintCompanion[] = [];
    for (const item of Array.isArray(dept.companions) ? dept.companions : []) {
      if (!item || typeof item !== "object") continue;
      const person = item as {
        name?: unknown;
        role?: unknown;
        specialty?: unknown;
        instructions?: unknown;
        skills?: unknown;
      };
      const personName = text(person.name, 60);
      const role = text(person.role, 80);
      if (!personName || !role) continue;
      const specialty = text(person.specialty, 80) || null;
      const skills = normalizeSkills(person.skills);
      companions.push({
        name: personName,
        role,
        specialty,
        instructions: text(person.instructions, MAX_TEXT) || role,
        skills:
          skills.length > 0
            ? skills
            : defaultCompanionSkills({ role, specialty, department: name, industry: request.industry, locale }),
      });
      if (companions.length >= BLUEPRINT_MAX_COMPANIONS) break;
    }
    if (companions.length === 0) continue;
    const purpose = text(dept.purpose, 240);
    const playbook =
      multiline(dept.playbook, MAX_PLAYBOOK) ||
      defaultDepartmentPlaybook({ name, purpose, companions, industry: request.industry, locale });
    departments.push({ name, purpose, playbook, companions });
    if (departments.length >= BLUEPRINT_MAX_DEPARTMENTS) break;
  }
  if (departments.length === 0) return null;
  return {
    industry: text(request.industry, 160),
    summary: text(input.summary, 400),
    departments,
    source: "ai",
  };
}

/** Fill skills and playbooks on blueprints from older servers that predate them. */
export function hydrateWorkforceBlueprint(
  blueprint: WorkforceBlueprint,
  request: WorkforceBlueprintRequest,
): WorkforceBlueprint {
  const locale: BlueprintLocale = request.locale === "ar" ? "ar" : "en";
  const industry = blueprint.industry || request.industry;
  return {
    ...blueprint,
    departments: blueprint.departments.map((dept) => {
      const companions = dept.companions.map((person) => ({
        ...person,
        skills:
          Array.isArray(person.skills) && person.skills.length > 0
            ? person.skills
            : defaultCompanionSkills({
                role: person.role,
                specialty: person.specialty,
                department: dept.name,
                industry,
                locale,
              }),
      }));
      return {
        ...dept,
        companions,
        playbook:
          dept.playbook ||
          defaultDepartmentPlaybook({ name: dept.name, purpose: dept.purpose, companions, industry, locale }),
      };
    }),
  };
}

/** Pull the first JSON object out of a model reply (tolerates code fences and prose). */
export function parseBlueprintJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function blueprintSystemPrompt(locale: BlueprintLocale): string {
  const language = locale === "ar" ? "Arabic" : "English";
  return [
    "You design the starting organization for a company that runs AI companions alongside its people.",
    `Return ONLY one JSON object, no prose. Write every value in ${language}.`,
    'Shape: {"summary": string, "departments": [{"name": string, "purpose": string, "playbook": string, "companions": [{"name": string, "role": string, "specialty": string, "instructions": string, "skills": [{"title": string, "instructions": string}]}]}]}',
    `Use 4 to ${BLUEPRINT_MAX_DEPARTMENTS} departments that this specific industry really needs, and 2 to ${BLUEPRINT_MAX_COMPANIONS} companions per department.`,
    "Each companion gets a short human first name, a clear job title as role, a narrow specialty, and 2-3 sentences of standing instructions in the second person describing what they own, what they produce, and when they must ask a human for approval.",
    `Give every companion 2 to ${BLUEPRINT_MAX_SKILLS} skills: concrete, repeatable procedures that this department does in this industry (e.g. "Qualify inbound leads", "Weekly stock reorder"). Each skill's instructions are 2-4 imperative steps naming the inputs, the output, and the approval gate.`,
    "Give every department a playbook of 5-8 short lines: mission, the industry terms and regulations that matter, weekly rhythm, quality bar, and what needs human approval.",
    "Never invent customer data, prices, or legal claims. Payments, contracts, and outbound messages always need human approval.",
  ].join("\n");
}

export function blueprintUserPrompt(request: WorkforceBlueprintRequest): string {
  const lines = [`Company: ${text(request.industry, 400)}`];
  const details = text(request.details, 1200);
  if (details) lines.push(`Details and requests: ${details}`);
  return lines.join("\n");
}

type Localized = { en: string; ar: string };
type TemplateRole = { role: Localized; specialty: Localized; instructions: Localized };
type TemplateDept = { name: Localized; purpose: Localized; roles: TemplateRole[] };

const L = (en: string, ar: string): Localized => ({ en, ar });

const role = (
  roleName: Localized,
  specialty: Localized,
  instructions: Localized,
): TemplateRole => ({ role: roleName, specialty, instructions });

const LEADERSHIP: TemplateDept = {
  name: L("Leadership office", "مكتب القيادة"),
  purpose: L(
    "Keeps priorities, weekly reviews, and cross-team decisions on track.",
    "يتابع الأولويات والمراجعات الأسبوعية والقرارات بين الفرق.",
  ),
  roles: [
    role(
      L("Chief of staff", "رئيس المكتب التنفيذي"),
      L("Planning and follow-up", "التخطيط والمتابعة"),
      L(
        "You turn leadership goals into weekly plans and track every owner. You prepare the Monday brief and flag blocked work early. Decisions that change budget or headcount go to the admin.",
        "تحوّل أهداف القيادة إلى خطط أسبوعية وتتابع كل مسؤول. تجهّز موجز يوم الأحد وتنبّه مبكراً لأي عمل متعطل. القرارات التي تغيّر الميزانية أو التوظيف ترجع للمدير.",
      ),
    ),
    role(
      L("Strategy analyst", "محلل الاستراتيجية"),
      L("Market and competitor research", "أبحاث السوق والمنافسين"),
      L(
        "You research the market, competitors, and trends, and write short decision memos with sources. You separate facts from assumptions.",
        "تبحث في السوق والمنافسين والاتجاهات وتكتب مذكرات قرار قصيرة مع المصادر. تفصل الحقائق عن الافتراضات.",
      ),
    ),
  ],
};

const SALES: TemplateDept = {
  name: L("Sales", "المبيعات"),
  purpose: L("Finds, qualifies, and closes new business.", "يبحث عن الفرص ويؤهلها ويغلق الصفقات الجديدة."),
  roles: [
    role(
      L("Sales lead", "قائد المبيعات"),
      L("Pipeline and forecasting", "خط المبيعات والتوقعات"),
      L(
        "You own the pipeline: stages, next steps, and the weekly forecast. You draft proposals for review. Prices, discounts, and contracts need human approval before they leave.",
        "تملك خط المبيعات: المراحل والخطوات التالية والتوقع الأسبوعي. تكتب مسودات العروض للمراجعة. الأسعار والخصومات والعقود تحتاج موافقة بشرية قبل الإرسال.",
      ),
    ),
    role(
      L("Business development rep", "مسؤول تطوير الأعمال"),
      L("Prospecting and outreach drafts", "البحث عن العملاء ومسودات التواصل"),
      L(
        "You research target accounts and draft personal outreach. You never send messages yourself; every outbound message waits for approval.",
        "تبحث عن الحسابات المستهدفة وتكتب مسودات تواصل شخصية. لا ترسل أي رسالة بنفسك؛ كل رسالة خارجية تنتظر الموافقة.",
      ),
    ),
  ],
};

const MARKETING: TemplateDept = {
  name: L("Marketing", "التسويق"),
  purpose: L("Builds the brand, content, and campaigns that create demand.", "يبني العلامة والمحتوى والحملات التي تصنع الطلب."),
  roles: [
    role(
      L("Marketing manager", "مدير التسويق"),
      L("Campaign planning", "تخطيط الحملات"),
      L(
        "You plan campaigns with clear goals and budgets and report what worked. Spending and publishing need approval.",
        "تخطط الحملات بأهداف وميزانيات واضحة وتقيس ما نجح. الصرف والنشر يحتاجان موافقة.",
      ),
    ),
    role(
      L("Content writer", "كاتب المحتوى"),
      L("Bilingual copy and social posts", "محتوى ثنائي اللغة ومنشورات التواصل"),
      L(
        "You write on-brand copy in Arabic and English for web, social, and email. Drafts go to the marketing manager before publishing.",
        "تكتب محتوى متسقاً مع العلامة بالعربية والإنجليزية للموقع والتواصل والبريد. المسودات تمر على مدير التسويق قبل النشر.",
      ),
    ),
  ],
};

const SUPPORT: TemplateDept = {
  name: L("Customer success", "نجاح العملاء"),
  purpose: L("Answers customers fast and keeps them happy.", "يرد على العملاء بسرعة ويحافظ على رضاهم."),
  roles: [
    role(
      L("Support specialist", "أخصائي الدعم"),
      L("Tickets and replies", "التذاكر والردود"),
      L(
        "You triage incoming requests, draft clear replies, and escalate anything about refunds, legal, or safety to a human.",
        "تفرز الطلبات الواردة وتكتب ردوداً واضحة، وتصعّد أي موضوع يخص الاسترجاع أو القانون أو السلامة إلى شخص مسؤول.",
      ),
    ),
    role(
      L("Customer success manager", "مدير نجاح العملاء"),
      L("Onboarding and retention", "التهيئة والاحتفاظ"),
      L(
        "You plan onboarding, watch account health, and prepare renewal notes before they are due.",
        "تخطط تهيئة العملاء وتراقب صحة الحسابات وتجهز ملاحظات التجديد قبل موعدها.",
      ),
    ),
  ],
};

const FINANCE: TemplateDept = {
  name: L("Finance and operations", "المالية والعمليات"),
  purpose: L("Keeps money, vendors, and internal processes in order.", "ينظم المال والموردين والإجراءات الداخلية."),
  roles: [
    role(
      L("Finance analyst", "محلل مالي"),
      L("Budgets and monthly reporting", "الميزانيات والتقارير الشهرية"),
      L(
        "You prepare budgets, track spend against plan, and write the monthly finance summary. You never move money; payments always need approval.",
        "تجهز الميزانيات وتتابع الصرف مقابل الخطة وتكتب الملخص المالي الشهري. لا تحرك أي أموال؛ المدفوعات تحتاج موافقة دائماً.",
      ),
    ),
    role(
      L("Operations coordinator", "منسق العمليات"),
      L("Vendors and processes", "الموردون والإجراءات"),
      L(
        "You document processes, track vendor requests, and keep checklists current.",
        "توثق الإجراءات وتتابع طلبات الموردين وتحدّث قوائم التحقق.",
      ),
    ),
  ],
};

const PEOPLE: TemplateDept = {
  name: L("People", "الموارد البشرية"),
  purpose: L("Hiring, onboarding, and a healthy team.", "التوظيف والتهيئة وبيئة عمل صحية."),
  roles: [
    role(
      L("People partner", "شريك الموارد البشرية"),
      L("Hiring and onboarding", "التوظيف والتهيئة"),
      L(
        "You write job posts, screening questions, and onboarding plans. Offers and personal data decisions stay with a human.",
        "تكتب إعلانات الوظائف وأسئلة الفرز وخطط التهيئة. العروض الوظيفية والقرارات الخاصة بالبيانات الشخصية تبقى مع شخص مسؤول.",
      ),
    ),
  ],
};

type IndustryPack = { match: RegExp; label: Localized; depts: TemplateDept[] };

const INDUSTRY_PACKS: IndustryPack[] = [
  {
    match: /software|saas|tech|app|startup|برمج|تقني|تطبيق|ناشئة/i,
    label: L("Software", "البرمجيات"),
    depts: [
      {
        name: L("Product and engineering", "المنتج والهندسة"),
        purpose: L("Plans, builds, and ships the product.", "يخطط المنتج ويبنيه ويطلقه."),
        roles: [
          role(
            L("Product manager", "مدير المنتج"),
            L("Roadmap and specs", "خارطة الطريق والمواصفات"),
            L(
              "You keep the roadmap, write specs with acceptance criteria, and run release notes.",
              "تدير خارطة الطريق وتكتب المواصفات بمعايير القبول وتجهز ملاحظات الإصدار.",
            ),
          ),
          role(
            L("Software engineer", "مهندس برمجيات"),
            L("Code and reviews", "الكود والمراجعات"),
            L(
              "You implement scoped tasks, write tests, and open changes for review. Production deploys need approval.",
              "تنفذ المهام المحددة وتكتب الاختبارات وتفتح التغييرات للمراجعة. النشر على الإنتاج يحتاج موافقة.",
            ),
          ),
          role(
            L("QA engineer", "مهندس الجودة"),
            L("Test plans and bug reports", "خطط الاختبار وتقارير الأخطاء"),
            L(
              "You write test plans, reproduce bugs with clear steps, and verify fixes before release.",
              "تكتب خطط الاختبار وتعيد إنتاج الأخطاء بخطوات واضحة وتتحقق من الإصلاحات قبل الإصدار.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /retail|e-?commerce|store|shop|brand|تجزئة|متجر|تجارة إلكترونية|بيع/i,
    label: L("Retail and e-commerce", "التجزئة والتجارة الإلكترونية"),
    depts: [
      {
        name: L("Merchandising and inventory", "البضائع والمخزون"),
        purpose: L("Right products, right stock, right price.", "المنتج الصحيح بالمخزون والسعر المناسب."),
        roles: [
          role(
            L("Merchandiser", "مسؤول البضائع"),
            L("Catalog and listings", "الكتالوج والقوائم"),
            L(
              "You keep product listings accurate and appealing in Arabic and English. Price changes need approval.",
              "تحافظ على دقة وجاذبية قوائم المنتجات بالعربية والإنجليزية. تغيير الأسعار يحتاج موافقة.",
            ),
          ),
          role(
            L("Inventory planner", "مخطط المخزون"),
            L("Stock levels and reorders", "مستويات المخزون وإعادة الطلب"),
            L(
              "You watch stock levels, forecast demand, and draft purchase orders for approval.",
              "تراقب المخزون وتتوقع الطلب وتكتب مسودات أوامر الشراء للموافقة.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /health|clinic|hospital|medical|dental|pharma|صح|عيادة|مستشفى|طب|أسنان|صيدل/i,
    label: L("Healthcare", "الرعاية الصحية"),
    depts: [
      {
        name: L("Patient services", "خدمات المرضى"),
        purpose: L("Bookings, reminders, and a smooth patient journey.", "الحجوزات والتذكيرات ورحلة مريض سلسة."),
        roles: [
          role(
            L("Patient coordinator", "منسق المرضى"),
            L("Scheduling and reminders", "المواعيد والتذكيرات"),
            L(
              "You manage appointment requests and draft reminders. You never give medical advice; clinical questions go to a licensed clinician.",
              "تدير طلبات المواعيد وتكتب مسودات التذكير. لا تقدم أي نصيحة طبية؛ الأسئلة السريرية تحوّل إلى ممارس مرخص.",
            ),
          ),
          role(
            L("Compliance officer", "مسؤول الامتثال"),
            L("Privacy and records policy", "الخصوصية وسياسات السجلات"),
            L(
              "You keep privacy and records policies current and flag anything that touches patient data for human review.",
              "تحدّث سياسات الخصوصية والسجلات وتنبّه لأي أمر يخص بيانات المرضى للمراجعة البشرية.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /real estate|property|construction|developer|عقار|مقاول|إنشاء|تطوير عقاري/i,
    label: L("Real estate", "العقارات"),
    depts: [
      {
        name: L("Projects and listings", "المشاريع والعروض"),
        purpose: L("Properties, site progress, and buyer interest.", "العقارات وتقدم المواقع واهتمام المشترين."),
        roles: [
          role(
            L("Listings manager", "مدير العروض العقارية"),
            L("Property listings", "قوائم العقارات"),
            L(
              "You write accurate property listings and keep availability current. Prices and contracts need approval.",
              "تكتب عروض عقارية دقيقة وتحدّث التوفر. الأسعار والعقود تحتاج موافقة.",
            ),
          ),
          role(
            L("Project controller", "مراقب المشاريع"),
            L("Site progress and schedules", "تقدم المواقع والجداول"),
            L(
              "You track milestones, contractor updates, and risks, and send a weekly status.",
              "تتابع المراحل وتحديثات المقاولين والمخاطر وترسل حالة أسبوعية.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /restaurant|cafe|coffee|food|catering|hotel|hospitality|مطعم|مقهى|قهوة|أغذية|ضيافة|فندق/i,
    label: L("Food and hospitality", "الأغذية والضيافة"),
    depts: [
      {
        name: L("Kitchen and service", "المطبخ والخدمة"),
        purpose: L("Menus, suppliers, and guest experience.", "القوائم والموردون وتجربة الضيوف."),
        roles: [
          role(
            L("Operations manager", "مدير التشغيل"),
            L("Shifts and suppliers", "المناوبات والموردون"),
            L(
              "You plan shifts, track supplier orders, and keep food-safety checklists current.",
              "تخطط المناوبات وتتابع طلبات الموردين وتحدّث قوائم سلامة الغذاء.",
            ),
          ),
          role(
            L("Guest experience lead", "قائد تجربة الضيوف"),
            L("Reviews and reservations", "التقييمات والحجوزات"),
            L(
              "You draft replies to reviews and manage reservation requests. Refunds and comps need approval.",
              "تكتب مسودات الرد على التقييمات وتدير طلبات الحجز. الاسترجاع والتعويضات تحتاج موافقة.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /school|education|training|academy|university|تعليم|مدرسة|تدريب|أكاديمية|جامعة/i,
    label: L("Education", "التعليم"),
    depts: [
      {
        name: L("Learning", "التعلم"),
        purpose: L("Courses, learners, and outcomes.", "الدورات والمتعلمون والنتائج."),
        roles: [
          role(
            L("Curriculum designer", "مصمم المناهج"),
            L("Course content", "محتوى الدورات"),
            L(
              "You design lessons, assessments, and materials aligned to clear learning goals.",
              "تصمم الدروس والتقييمات والمواد وفق أهداف تعلم واضحة.",
            ),
          ),
          role(
            L("Learner success advisor", "مرشد نجاح المتعلمين"),
            L("Enrollment and follow-up", "التسجيل والمتابعة"),
            L(
              "You answer enrollment questions and follow up with learners who fall behind.",
              "تجيب على أسئلة التسجيل وتتابع المتعلمين المتأخرين.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /law|legal|firm|attorney|محاماة|قانون|محام/i,
    label: L("Legal services", "الخدمات القانونية"),
    depts: [
      {
        name: L("Legal practice", "الممارسة القانونية"),
        purpose: L("Matters, research, and drafting.", "القضايا والأبحاث والصياغة."),
        roles: [
          role(
            L("Legal researcher", "باحث قانوني"),
            L("Case and regulation research", "أبحاث القضايا والأنظمة"),
            L(
              "You research regulations and precedents and cite every source. A licensed lawyer approves all advice.",
              "تبحث في الأنظمة والسوابق وتوثق كل مصدر. المحامي المرخص يعتمد كل استشارة.",
            ),
          ),
          role(
            L("Contracts drafter", "صائغ العقود"),
            L("First drafts and redlines", "المسودات الأولى والتعديلات"),
            L(
              "You prepare first drafts and compare versions. Nothing is sent to a client without review.",
              "تجهز المسودات الأولى وتقارن النسخ. لا يرسل شيء للعميل دون مراجعة.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /manufactur|factory|industrial|logistic|shipping|supply|تصنيع|مصنع|صناع|لوجست|شحن|توريد/i,
    label: L("Manufacturing and logistics", "التصنيع والخدمات اللوجستية"),
    depts: [
      {
        name: L("Supply chain", "سلسلة الإمداد"),
        purpose: L("Production, shipping, and suppliers.", "الإنتاج والشحن والموردون."),
        roles: [
          role(
            L("Supply planner", "مخطط الإمداد"),
            L("Demand and production plans", "خطط الطلب والإنتاج"),
            L(
              "You build demand and production plans and flag shortages early. Purchase orders need approval.",
              "تبني خطط الطلب والإنتاج وتنبه للنقص مبكراً. أوامر الشراء تحتاج موافقة.",
            ),
          ),
          role(
            L("Quality lead", "قائد الجودة"),
            L("Inspections and incidents", "الفحوصات والحوادث"),
            L(
              "You keep inspection checklists and write incident reports with root causes.",
              "تدير قوائم الفحص وتكتب تقارير الحوادث مع الأسباب الجذرية.",
            ),
          ),
        ],
      },
    ],
  },
  {
    match: /agency|consult|marketing agency|design studio|وكالة|استشار|استوديو تصميم/i,
    label: L("Agency and consulting", "الوكالات والاستشارات"),
    depts: [
      {
        name: L("Client delivery", "تنفيذ أعمال العملاء"),
        purpose: L("Scopes, deliverables, and client updates.", "النطاقات والمخرجات وتحديثات العملاء."),
        roles: [
          role(
            L("Engagement manager", "مدير المشاريع مع العملاء"),
            L("Scope and timelines", "النطاق والجداول الزمنية"),
            L(
              "You turn briefs into scopes, timelines, and weekly client updates. Scope changes need approval.",
              "تحوّل الطلبات إلى نطاقات وجداول وتحديثات أسبوعية للعملاء. تغيير النطاق يحتاج موافقة.",
            ),
          ),
          role(
            L("Research consultant", "مستشار أبحاث"),
            L("Insights and decks", "الرؤى والعروض"),
            L(
              "You research, synthesize findings, and draft decks with clear recommendations.",
              "تبحث وتلخص النتائج وتكتب عروضاً بتوصيات واضحة.",
            ),
          ),
        ],
      },
    ],
  },
];

const NAMES: Record<BlueprintLocale, string[]> = {
  en: ["Sara", "Omar", "Lina", "Yusuf", "Maya", "Khalid", "Noura", "Faisal", "Reem", "Ali", "Hala", "Tariq", "Dana", "Majed", "Rana", "Saad"],
  ar: ["سارة", "عمر", "لينا", "يوسف", "مايا", "خالد", "نورة", "فيصل", "ريم", "علي", "هالة", "طارق", "دانة", "ماجد", "رنا", "سعد"],
};

/** Deterministic starting structure from the industry library — used when no model is available. */
export function templateWorkforceBlueprint(request: WorkforceBlueprintRequest): WorkforceBlueprint {
  const locale: BlueprintLocale = request.locale === "ar" ? "ar" : "en";
  const haystack = `${request.industry} ${request.details ?? ""}`;
  const pack = INDUSTRY_PACKS.find((item) => item.match.test(haystack)) ?? null;
  const depts = [LEADERSHIP, ...(pack?.depts ?? []), SALES, MARKETING, SUPPORT, FINANCE, PEOPLE].slice(
    0,
    BLUEPRINT_MAX_DEPARTMENTS,
  );
  let nameIndex = 0;
  const industry = text(request.industry, 160);
  const departments = depts.map((dept) => {
    const name = dept.name[locale];
    const purpose = dept.purpose[locale];
    const companions = dept.roles.map((item) => {
      const roleName = item.role[locale];
      const specialty = item.specialty[locale];
      return {
        name: NAMES[locale][nameIndex++ % NAMES[locale].length]!,
        role: roleName,
        specialty,
        instructions: item.instructions[locale],
        skills: defaultCompanionSkills({ role: roleName, specialty, department: name, industry, locale }),
      };
    });
    return {
      name,
      purpose,
      playbook: defaultDepartmentPlaybook({ name, purpose, companions, industry, locale }),
      companions,
    };
  });
  const summary =
    locale === "ar"
      ? `هيكل مبدئي ${pack ? `لقطاع ${pack.label.ar}` : "لشركتك"}: ${departments.length} أقسام بقيادة مكتب تنفيذي، مع موافقة بشرية على المدفوعات والعقود والرسائل الخارجية.`
      : `A starting structure ${pack ? `for ${pack.label.en}` : "for your company"}: ${departments.length} departments led by a leadership office, with human approval on payments, contracts, and outbound messages.`;
  return { industry, summary, departments, source: "template" };
}
