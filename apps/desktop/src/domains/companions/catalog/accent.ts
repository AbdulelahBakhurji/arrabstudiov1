/** Arabic dialect a companion speaks when replying in Arabic. */
export type ArabicAccentId =
  | "auto"
  | "msa"
  | "najdi"
  | "hijazi"
  | "gulf"
  | "emirati"
  | "kuwaiti"
  | "qatari"
  | "bahraini"
  | "omani"
  | "yemeni"
  | "iraqi"
  | "levantine"
  | "jordanian"
  | "palestinian"
  | "lebanese"
  | "syrian"
  | "egyptian"
  | "sudanese"
  | "libyan"
  | "tunisian"
  | "algerian"
  | "moroccan";

export interface ArabicAccent {
  id: ArabicAccentId;
  labelEn: string;
  labelAr: string;
  regionEn: string;
  regionAr: string;
  /** BCP-47 tag for voice preview. */
  speechLang: string;
  /** Short line in this dialect for previews. */
  sample: string;
  /** How the model should write — dialect name for the prompt. */
  prompt: string;
}

export const ARABIC_ACCENTS: readonly ArabicAccent[] = [
  {
    id: "auto",
    labelEn: "Match my Arabic",
    labelAr: "مثل لهجتي",
    regionEn: "Automatic",
    regionAr: "تلقائي",
    speechLang: "ar-SA",
    sample: "أهلًا، أنا معك. وش تحتاج اليوم؟",
    prompt: "",
  },
  {
    id: "msa",
    labelEn: "Modern Standard (Fusha)",
    labelAr: "الفصحى",
    regionEn: "Pan-Arab",
    regionAr: "عربي عام",
    speechLang: "ar-SA",
    sample: "مرحبًا، أنا هنا لمساعدتك. ماذا تحتاج اليوم؟",
    prompt: "Modern Standard Arabic (Fusha) — clear, correct, no dialect words",
  },
  {
    id: "najdi",
    labelEn: "Saudi — Najdi",
    labelAr: "سعودي — نجدي",
    regionEn: "Riyadh, Qassim",
    regionAr: "الرياض، القصيم",
    speechLang: "ar-SA",
    sample: "هلا والله، وش تبي نسوي اليوم؟",
    prompt: "Saudi Najdi dialect (Riyadh/Qassim) — e.g. وش، أبي، زين، الحين",
  },
  {
    id: "hijazi",
    labelEn: "Saudi — Hijazi",
    labelAr: "سعودي — حجازي",
    regionEn: "Jeddah, Makkah, Madinah",
    regionAr: "جدة، مكة، المدينة",
    speechLang: "ar-SA",
    sample: "أهلين، إيش تبغى نسوي اليوم؟",
    prompt: "Saudi Hijazi dialect (Jeddah/Makkah) — e.g. إيش، أبغى، كده، دحين",
  },
  {
    id: "gulf",
    labelEn: "Gulf (Khaleeji)",
    labelAr: "خليجي",
    regionEn: "Gulf region",
    regionAr: "الخليج العربي",
    speechLang: "ar-AE",
    sample: "هلا، شو تبي نسوي اليوم؟",
    prompt: "general Gulf (Khaleeji) Arabic",
  },
  {
    id: "emirati",
    labelEn: "Emirati",
    labelAr: "إماراتي",
    regionEn: "UAE",
    regionAr: "الإمارات",
    speechLang: "ar-AE",
    sample: "هلا والله، شو تبا نسوي اليوم؟",
    prompt: "Emirati dialect — e.g. شو، تبا، وايد، الحين",
  },
  {
    id: "kuwaiti",
    labelEn: "Kuwaiti",
    labelAr: "كويتي",
    regionEn: "Kuwait",
    regionAr: "الكويت",
    speechLang: "ar-KW",
    sample: "هلا، شنو تبي نسوي اليوم؟",
    prompt: "Kuwaiti dialect — e.g. شنو، تبي، وايد، چذي",
  },
  {
    id: "qatari",
    labelEn: "Qatari",
    labelAr: "قطري",
    regionEn: "Qatar",
    regionAr: "قطر",
    speechLang: "ar-QA",
    sample: "هلا، شو تبي نسوي اليوم؟",
    prompt: "Qatari dialect",
  },
  {
    id: "bahraini",
    labelEn: "Bahraini",
    labelAr: "بحريني",
    regionEn: "Bahrain",
    regionAr: "البحرين",
    speechLang: "ar-BH",
    sample: "هلا، شنو تبي نسوي اليوم؟",
    prompt: "Bahraini dialect",
  },
  {
    id: "omani",
    labelEn: "Omani",
    labelAr: "عُماني",
    regionEn: "Oman",
    regionAr: "عُمان",
    speechLang: "ar-OM",
    sample: "هلا، ايش تبا نسوي اليوم؟",
    prompt: "Omani dialect",
  },
  {
    id: "yemeni",
    labelEn: "Yemeni",
    labelAr: "يمني",
    regionEn: "Yemen",
    regionAr: "اليمن",
    speechLang: "ar-YE",
    sample: "أهلين، ايش تشتي نسوي اليوم؟",
    prompt: "Yemeni (Sanaani) dialect — e.g. ايش، أشتي",
  },
  {
    id: "iraqi",
    labelEn: "Iraqi",
    labelAr: "عراقي",
    regionEn: "Iraq",
    regionAr: "العراق",
    speechLang: "ar-IQ",
    sample: "هلا بيك، شتريد نسوي اليوم؟",
    prompt: "Iraqi (Baghdadi) dialect — e.g. شنو، أريد، هواية، هسه",
  },
  {
    id: "levantine",
    labelEn: "Levantine (Shami)",
    labelAr: "شامي",
    regionEn: "Levant",
    regionAr: "بلاد الشام",
    speechLang: "ar-SY",
    sample: "أهلين، شو بدك نعمل اليوم؟",
    prompt: "general Levantine (Shami) Arabic — e.g. شو، بدّي، هلّق، كتير",
  },
  {
    id: "jordanian",
    labelEn: "Jordanian",
    labelAr: "أردني",
    regionEn: "Jordan",
    regionAr: "الأردن",
    speechLang: "ar-JO",
    sample: "يا هلا، شو بدك نعمل اليوم؟",
    prompt: "Jordanian dialect",
  },
  {
    id: "palestinian",
    labelEn: "Palestinian",
    labelAr: "فلسطيني",
    regionEn: "Palestine",
    regionAr: "فلسطين",
    speechLang: "ar-PS",
    sample: "أهلين، شو بدك نعمل اليوم؟",
    prompt: "Palestinian dialect",
  },
  {
    id: "lebanese",
    labelEn: "Lebanese",
    labelAr: "لبناني",
    regionEn: "Lebanon",
    regionAr: "لبنان",
    speechLang: "ar-LB",
    sample: "هاي، كيفك؟ شو بدّك نعمل اليوم؟",
    prompt: "Lebanese dialect",
  },
  {
    id: "syrian",
    labelEn: "Syrian",
    labelAr: "سوري",
    regionEn: "Syria",
    regionAr: "سوريا",
    speechLang: "ar-SY",
    sample: "أهلين، شو بدك نساوي اليوم؟",
    prompt: "Syrian (Damascene) dialect",
  },
  {
    id: "egyptian",
    labelEn: "Egyptian",
    labelAr: "مصري",
    regionEn: "Egypt",
    regionAr: "مصر",
    speechLang: "ar-EG",
    sample: "أهلًا، عايز نعمل إيه النهارده؟",
    prompt: "Egyptian (Cairene) dialect — e.g. إيه، عايز، كده، دلوقتي، النهارده",
  },
  {
    id: "sudanese",
    labelEn: "Sudanese",
    labelAr: "سوداني",
    regionEn: "Sudan",
    regionAr: "السودان",
    speechLang: "ar-SD",
    sample: "أهلًا، داير نعمل شنو الليلة؟",
    prompt: "Sudanese dialect",
  },
  {
    id: "libyan",
    labelEn: "Libyan",
    labelAr: "ليبي",
    regionEn: "Libya",
    regionAr: "ليبيا",
    speechLang: "ar-LY",
    sample: "مرحبتين، شن تبي نديروا اليوم؟",
    prompt: "Libyan dialect",
  },
  {
    id: "tunisian",
    labelEn: "Tunisian",
    labelAr: "تونسي",
    regionEn: "Tunisia",
    regionAr: "تونس",
    speechLang: "ar-TN",
    sample: "عسلامة، شنوّة تحب نعملو اليوم؟",
    prompt: "Tunisian dialect",
  },
  {
    id: "algerian",
    labelEn: "Algerian",
    labelAr: "جزائري",
    regionEn: "Algeria",
    regionAr: "الجزائر",
    speechLang: "ar-DZ",
    sample: "صحّا، واش تحب نديرو اليوم؟",
    prompt: "Algerian dialect",
  },
  {
    id: "moroccan",
    labelEn: "Moroccan (Darija)",
    labelAr: "مغربي (دارجة)",
    regionEn: "Morocco",
    regionAr: "المغرب",
    speechLang: "ar-MA",
    sample: "مرحبا، شنو بغيتي نديرو اليوم؟",
    prompt: "Moroccan Darija — e.g. شنو، بغيت، بزاف، دابا",
  },
] as const;

export function arabicAccentById(id: string | null | undefined): ArabicAccent {
  return ARABIC_ACCENTS.find((item) => item.id === id) ?? ARABIC_ACCENTS[0]!;
}

export function normalizeArabicAccent(id: unknown): ArabicAccentId | null {
  if (typeof id !== "string") return null;
  return ARABIC_ACCENTS.some((item) => item.id === id) ? (id as ArabicAccentId) : null;
}

/** Prompt line for the agent; null when the companion mirrors the operator. */
export function arabicAccentDirective(id: string | null | undefined): string | null {
  const accent = arabicAccentById(id);
  if (!accent.prompt) return null;
  return `ARABIC ACCENT: When replying in Arabic, speak in ${accent.prompt}. Keep the dialect natural and consistent on every reply; do not switch to another dialect unless the operator asks.`;
}
