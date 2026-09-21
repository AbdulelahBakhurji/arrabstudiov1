import type { CompanionToneName } from "@/lib/companions";
import {
  purposeRegistryById,
  resolvePurposeIdFromDomain,
} from "@/lib/purpose-registry";

/** Ready-made companions offered on the Add catalog page. */
export type CompanionPreset = {
  id: string;
  domain: string;
  /** Registry purpose id — required for every preset. */
  purposeId: string;
  name: string;
  nameAr: string;
  brief: string;
  briefAr: string;
  blurb: string;
  blurbAr: string;
  toneName: CompanionToneName;
  connectors: string[];
};

export const COMPANION_PRESETS: CompanionPreset[] = [
  {
    id: "sleep",
    domain: "sleep",
    purposeId: "sleep",
    name: "Sleep",
    nameAr: "النوم",
    brief: "Track rest, call out late nights, and keep advice short and practical.",
    briefAr: "تابع الراحة، نبّه للسهر، وأبقِ النصيحة قصيرة وعملية.",
    blurb: "Rest, late nights, and recovery",
    blurbAr: "الراحة والسهر والتعافي",
    toneName: "measured",
    connectors: [],
  },
  {
    id: "money",
    domain: "money",
    purposeId: "money",
    name: "Money",
    nameAr: "المال",
    brief: "Watch spending and bills. Flag drift early without shaming.",
    briefAr: "راقب المصروف والفواتير. نبّه مبكراً دون توبيخ.",
    blurb: "Spending, bills, and budgets",
    blurbAr: "المصروف والفواتير والميزانية",
    toneName: "direct",
    connectors: [],
  },
  {
    id: "work",
    domain: "work",
    purposeId: "work",
    name: "Work",
    nameAr: "العمل",
    brief: "Own deadlines, meetings, and follow-through. Prefer concrete next steps.",
    briefAr: "تابع المواعيد والاجتماعات والتنفيذ. فضّل خطوات واضحة.",
    blurb: "Deadlines, clients, and shipping",
    blurbAr: "المواعيد والعملاء والإطلاق",
    toneName: "direct",
    connectors: ["gmail", "outlook", "github"],
  },
  {
    id: "study",
    domain: "study",
    purposeId: "study",
    name: "Study",
    nameAr: "الدراسة",
    brief: "Hold the study plan, challenge weak excuses, and keep every reply practical.",
    briefAr: "التزم بخطة الدراسة، واجه الأعذار الضعيفة، وأبقِ الرد عملياً.",
    blurb: "Exams, courses, and focus",
    blurbAr: "الاختبارات والمقررات والتركيز",
    toneName: "measured",
    connectors: [],
  },
  {
    id: "training",
    domain: "training",
    purposeId: "training",
    name: "Training",
    nameAr: "التمرين",
    brief: "Keep training honest: sessions done, skipped, and what comes next.",
    briefAr: "أبقِ التمرين صادقاً: ما تم وما فُوّت وما التالي.",
    blurb: "Gym, runs, and consistency",
    blurbAr: "النادي والجري والاستمرار",
    toneName: "direct",
    connectors: [],
  },
  {
    id: "focus",
    domain: "focus",
    purposeId: "focus",
    name: "Focus",
    nameAr: "التركيز",
    brief: "Protect deep work blocks, cut distraction, and keep priorities visible.",
    briefAr: "احمِ أوقات العمل العميق، قلّل التشتيت، وأبقِ الأولويات واضحة.",
    blurb: "Deep work and distractions",
    blurbAr: "العمل العميق والتشتيت",
    toneName: "measured",
    connectors: ["github", "gitlab"],
  },
  {
    id: "coder",
    domain: "coder",
    purposeId: "coder",
    name: "Coder",
    nameAr: "المبرمج",
    brief: "Own code, repos, and debugging. Prefer concrete diffs and next steps.",
    briefAr: "تابع الكود والمستودعات والأخطاء. فضّل فروقات واضحة وخطوات عملية.",
    blurb: "Repos, reviews, and debugging",
    blurbAr: "المستودعات والمراجعة وإصلاح الأخطاء",
    toneName: "direct",
    connectors: ["github", "gitlab", "ssh"],
  },
  {
    id: "inbox",
    domain: "inbox",
    purposeId: "inbox",
    name: "Inbox",
    nameAr: "البريد",
    brief:
      "Triage and arrange mail end-to-end: list inbox, read threads, archive/trash/star/label/move, draft replies, and send only after Ask-first approval — never send the same email twice.",
    briefAr:
      "رتّب البريد بالكامل: اعرض الوارد، اقرأ الرسائل، أرشف/احذف/نجّم/سمِّ/انقل، صغ الردود، وأرسل فقط بعد موافقة اسأل أولاً — ولا ترسل نفس الرسالة مرتين.",
    blurb: "Mail triage, arrange, and replies",
    blurbAr: "ترتيب البريد والردود والإرسال",
    toneName: "measured",
    connectors: ["gmail", "outlook", "email"],
  },
  {
    id: "trader",
    domain: "trader",
    purposeId: "trader",
    name: "Trader",
    nameAr: "المتداول",
    brief:
      "You are a Trader companion in Arrab Studio. Help the operator think clearly about markets: symbols, levels, catalysts, and risk. This is NOT financial advice and NEVER a guarantee to buy or sell. Prefer live data when Finnhub (or other market tools) are connected — call quote/news tools before opinion. Always state source and that prices may be delayed. Ask horizon and risk tolerance when giving perspective. Use cautious language (bias / watch / invalidation), never certainty. If data is missing, say so and do not invent prices.",
    briefAr:
      "أنت رفيق متداول في استوديو عراب. ساعد المشغّل على التفكير بوضوح في الأسواق: الرموز والمستويات والمحفزات والمخاطر. هذا ليس نصيحة مالية ولا ضمان شراء أو بيع. فضّل البيانات الحية عند ربط Finnhub أو أدوات السوق — استدعِ أدوات السعر/الأخبار قبل الرأي. اذكر المصدر وأن الأسعار قد تتأخر. اسأل عن الأفق وتحمل المخاطر. استخدم لغة حذرة (انحياز/مراقبة/إبطال) بلا يقين. إن نقصت البيانات فقل ذلك ولا تخترع أسعاراً.",
    blurb: "Market perspective — quotes, news, and risk framing",
    blurbAr: "منظور السوق — أسعار وأخبار وإطار مخاطر",
    toneName: "direct",
    connectors: ["finnhub"],
  },
  {
    id: "ui-designer",
    domain: "ui-designer",
    purposeId: "web-design",
    name: "UI Designer",
    nameAr: "مصمم الواجهة",
    brief:
      "Design websites and UI in Studio. Output real HTML, CSS, and JS files with clear filenames so the preview and file tree update. Prefer complete pages over vague advice.",
    briefAr:
      "صمّم المواقع والواجهات في الاستوديو. أخرج ملفات HTML وCSS وJS بأسماء واضحة حتى تتحدث المعاينة وشجرة الملفات. فضّل صفحات مكتملة على النصائح العامة.",
    blurb: "Web UI, layouts, and live preview",
    blurbAr: "واجهات الويب والمعاينة المباشرة",
    toneName: "direct",
    connectors: [],
  },
];

/** Localized companion label from preset domain (falls back to stored name). */
export function companionDisplayName(
  person: { name: string; domain: string },
  locale: string,
): string {
  const preset = COMPANION_PRESETS.find((item) => item.domain === person.domain);
  if (!preset) return person.name;
  return locale === "ar" ? preset.nameAr : preset.name;
}

/** Localized public purpose line for UI (never system prompts). */
export function companionDisplayBrief(
  person: { brief?: string | null; domain: string; purposeId?: string | null },
  locale: string,
): string {
  return companionDisplayBlurb(person, locale, safePublicBrief(person.brief));
}

/** Localized short blurb under a face (memory wins when set). */
export function companionDisplayBlurb(
  person: {
    domain: string;
    lastMemory?: string | null;
    brief?: string | null;
    purposeId?: string | null;
  },
  locale: string,
  fallback = "",
): string {
  if (person.lastMemory?.trim()) return person.lastMemory.trim();
  const purposeId =
    person.purposeId?.trim() || resolvePurposeIdFromDomain(person.domain) || undefined;
  if (purposeId) {
    const purpose = purposeRegistryById(purposeId);
    if (purpose) return locale === "ar" ? purpose.blurbAr : purpose.blurb;
  }
  const preset = COMPANION_PRESETS.find((item) => item.domain === person.domain);
  if (preset) return locale === "ar" ? preset.blurbAr : preset.blurb;
  const brief = safePublicBrief(person.brief);
  if (brief) return brief;
  return fallback || person.domain;
}

function safePublicBrief(text: string | null | undefined): string {
  const brief = text?.trim() || "";
  if (!brief || looksLikeSystemPrompt(brief)) return "";
  return brief;
}

/** True when stored brief is internal model instructions (must not show in UI). */
export function isSecretCompanionBrief(text: string | null | undefined): boolean {
  return Boolean(text?.trim() && looksLikeSystemPrompt(text));
}

function looksLikeSystemPrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^you are\b/i.test(trimmed) ||
    /^أنت\b/.test(trimmed) ||
    /\breply in 1 short sentence\b/i.test(trimmed) ||
    /\bnever paste code\b/i.test(trimmed) ||
    /\bemit html\/css\/js\b/i.test(trimmed)
  );
}
