/**
 * Parse a user- or model-supplied address and return it only if it is a plain http(s) URL.
 * Used before anything is put in an iframe `src`, a link `href`, or handed to the OS: a
 * `javascript:` / `data:` / `file:` string must never survive to those sinks.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Like `safeHttpUrl`, but treats a bare host ("example.com/x") as https. */
export function normalizeBrowserAddress(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text) ? text : `https://${text}`;
  return safeHttpUrl(withScheme);
}
