const MAX_ASK_CHARS = 2_000;

const INJECTION_LINE =
  /^(system|assistant|developer|tool)\s*:|ignore (all |any )?(previous|prior|above) (instructions|rules|prompts)|reveal (your |the )?(system |safety )?(prompt|instructions)|override (your |the )?safety|disregard (your |the )?(rules|instructions)/i;

/**
 * Bound and clean a quick-ask before it is sent to a companion.
 * Drops lines that try to rewrite standing instructions. The user's request stays.
 */
export function sanitizeCompanionAsk(raw: string): string {
  const cleaned = raw
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !INJECTION_LINE.test(line.trim()))
    .join("\n")
    .trim();

  if (!cleaned) {
    throw new Error("Write a normal request");
  }
  return cleaned.slice(0, MAX_ASK_CHARS);
}

/** Approval ids we mint are short tokens, never paths or markup. */
export function isApprovalId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,80}$/.test(value);
}
