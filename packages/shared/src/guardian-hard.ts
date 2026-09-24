/**
 * Shared family Guardian hard failsafes — enforced on API and desktop.
 * Soft rules / coaching stay client-side; these patterns must never depend on UI alone.
 */

export type GuardianHardHit = {
  id: string;
  labelEn: string;
  labelAr: string;
};

export const GUARDIAN_HARD_PATTERNS: Array<{
  id: string;
  re: RegExp;
  labelEn: string;
  labelAr: string;
}> = [
  {
    id: "hard-self-harm",
    re: /\b(kill\s+myself|suicide|self[-\s]?harm|cut\s+myself|end\s+it\s+all|أريد\s+أموت|أنتحر|أؤذي\s+نفسي)\b/i,
    labelEn: "Self-harm or suicide talk",
    labelAr: "حديث عن إيذاء النفس أو الانتحار",
  },
  {
    id: "hard-meet-stranger",
    re: /\b(meet\s+(up\s+)?(with\s+)?(a\s+)?stranger|come\s+to\s+my\s+(house|home)|send\s+(me\s+)?(your\s+)?(address|location)|نلتقي|تعال\s+بيتي|أرسل\s+عنوان)\b/i,
    labelEn: "Meeting strangers or sharing location",
    labelAr: "لقاء غرباء أو مشاركة الموقع",
  },
  {
    id: "hard-contact",
    re: /\b(\+?\d[\d\s\-().]{7,}\d|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|whatsapp|telegram|سناب|واتساب|رقمي|رقم\s+هاتفي)\b/i,
    labelEn: "Sharing phone, email, or chat handles",
    labelAr: "مشاركة رقم أو بريد أو حساب تواصل",
  },
  {
    id: "hard-sexual",
    re: /\b(sex|porn|nude|naked|xxx|إباحي|جنس|عاري)\b/i,
    labelEn: "Sexual or adult content",
    labelAr: "محتوى جنسي أو للبالغين",
  },
  {
    id: "hard-violence",
    re: /\b(how\s+to\s+(make|build)\s+(a\s+)?bomb|shoot\s+(someone|people)|قتل|أقتل|قنبلة)\b/i,
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
