/**
 * Shared family Guardian hard failsafes — enforced on API and desktop.
 * Soft rules / coaching stay client-side; these patterns must never depend on UI alone.
 */

export type GuardianHardHit = {
  id: string;
  labelEn: string;
  labelAr: string;
};

// JS `\b` only knows ASCII word characters, so it never matches next to Arabic letters.
// These Unicode-aware edges work for both scripts. Arabic terms may carry a one-letter
// conjunction/preposition prefix (و ف ب ل ك س), e.g. "سأنتحر" or "وقنبلة".
const START = "(?<![\\p{L}\\p{N}_])";
const END = "(?![\\p{L}\\p{N}_])";
const AR_START = `${START}[وفبلكس]?`;

function pattern(latin: string, arabic: string): RegExp {
  return new RegExp(`${START}(?:${latin})${END}|${AR_START}(?:${arabic})${END}`, "iu");
}

export const GUARDIAN_HARD_PATTERNS: Array<{
  id: string;
  re: RegExp;
  labelEn: string;
  labelAr: string;
}> = [
  {
    id: "hard-self-harm",
    re: pattern(
      "kill\\s+myself|suicide|self[-\\s]?harm|cut\\s+myself|end\\s+it\\s+all",
      "أريد\\s+أموت|أنتحر|أؤذي\\s+نفسي|أقتل\\s+نفسي",
    ),
    labelEn: "Self-harm or suicide talk",
    labelAr: "حديث عن إيذاء النفس أو الانتحار",
  },
  {
    id: "hard-meet-stranger",
    re: pattern(
      "meet\\s+(up\\s+)?(with\\s+)?(a\\s+)?stranger|come\\s+to\\s+my\\s+(house|home)|send\\s+(me\\s+)?(your\\s+)?(address|location)",
      "نلتقي|تعال\\s+بيتي|أرسل\\s+(لي\\s+)?عنوان(ك)?|ارسل\\s+(لي\\s+)?عنوان(ك)?",
    ),
    labelEn: "Meeting strangers or sharing location",
    labelAr: "لقاء غرباء أو مشاركة الموقع",
  },
  {
    id: "hard-contact",
    re: pattern(
      "\\+?\\d[\\d\\s\\-().]{7,}\\d|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|whatsapp|telegram",
      "سناب|واتساب|تليجرام|رقمي|رقم\\s+هاتفي",
    ),
    labelEn: "Sharing phone, email, or chat handles",
    labelAr: "مشاركة رقم أو بريد أو حساب تواصل",
  },
  {
    id: "hard-sexual",
    re: pattern("sex|porn|nude|naked|xxx", "إباحي|جنس|عاري|عارية"),
    labelEn: "Sexual or adult content",
    labelAr: "محتوى جنسي أو للبالغين",
  },
  {
    id: "hard-violence",
    re: pattern(
      "how\\s+to\\s+(make|build)\\s+(a\\s+)?bomb|shoot\\s+(someone|people)",
      "قتل|أقتل|قنبلة",
    ),
    labelEn: "Violent harm instructions",
    labelAr: "تعليمات عنف مؤذية",
  },
];

export function guardianHardHit(text: string): GuardianHardHit | null {
  const value = text?.trim() ?? "";
  if (!value) return null;
  for (const pattern of GUARDIAN_HARD_PATTERNS) {
    if (pattern.re.test(value)) {
      return { id: pattern.id, labelEn: pattern.labelEn, labelAr: pattern.labelAr };
    }
  }
  return null;
}

/** Payload hashed for call_tool result attestation (desktop + API). */
export function toolResultAttestationPayload(resultToken: string, toolResult: string): string {
  return `${resultToken.trim()}\n${toolResult}`;
}
