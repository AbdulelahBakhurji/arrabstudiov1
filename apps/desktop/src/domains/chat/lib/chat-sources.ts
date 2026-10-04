/**
 * Sources a chat message points at — links and attached files — for the preview panel.
 * Attachments arrive as the draft text blocks written by `composer-attachments.ts`; the
 * original File objects are remembered for this session so PDFs and large images preview too.
 */
import { safeHttpUrl } from "@/shared/lib/safe-url";

export type AttachmentKind = "text" | "image" | "document" | "file";

export type AttachmentRef = {
  /** Stable per message + name so React keys and the panel can match. */
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string | null;
  sizeKb: number | null;
  /** Text file body (as sent to the model). */
  text: string | null;
  /** Inline image data URL (small images only). */
  dataUrl: string | null;
};

export type ChatSource =
  | { kind: "link"; id: string; url: string; host: string }
  | { kind: "file"; id: string; file: AttachmentRef };

const MARKER = /\[Attached (file|image|document): ([^\]\n]+?)\]/g;

function parseMeta(rest: string): { name: string; mime: string | null; sizeKb: number | null; note: string } {
  // "name (type, 12KB). trailing note" | "name — skipped, too large" | "name"
  const dash = rest.indexOf(" — ");
  const head = dash >= 0 ? rest.slice(0, dash) : rest;
  const note = dash >= 0 ? rest.slice(dash + 3) : "";
  const meta = head.match(/^(.*?) \(([^,()]*),\s*(\d+)KB\)/);
  if (meta) {
    return {
      name: meta[1]!.trim(),
      mime: meta[2]!.trim() && meta[2]!.trim() !== "binary" ? meta[2]!.trim() : null,
      sizeKb: Number(meta[3]),
      note,
    };
  }
  return { name: head.replace(/[.\s]+$/, "").trim(), mime: null, sizeKb: null, note };
}

/** File attachment blocks inside a message, in order. */
export function parseAttachments(text: string, messageId = "m"): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const matches = [...text.matchAll(MARKER)];
  matches.forEach((match, index) => {
    const label = match[1] as "file" | "image" | "document";
    const meta = parseMeta(match[2]!);
    const start = (match.index ?? 0) + match[0].length;
    const nextMarker = matches[index + 1]?.index ?? text.length;
    const bodyEnd = (() => {
      const cut = text.indexOf("\n\n[Attached ", start);
      return cut >= 0 && cut < nextMarker ? cut : nextMarker;
    })();
    const body = text.slice(start, bodyEnd).replace(/^\n/, "");
    const skipped = /could not read|skipped/i.test(meta.note);
    let kind: AttachmentKind = "file";
    let fileText: string | null = null;
    let dataUrl: string | null = null;
    if (label === "image") {
      kind = "image";
      const data = body.trim();
      if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(data)) dataUrl = data;
    } else if (label === "document") {
      kind = "document";
    } else if (!meta.mime && !meta.sizeKb && !skipped && body.trim()) {
      kind = "text";
      fileText = body;
    } else if (/\.(pdf|docx?|pptx?)$/i.test(meta.name)) {
      kind = "document";
    }
    out.push({
      id: `${messageId}:${index}:${meta.name}`,
      kind,
      name: meta.name || "file",
      mime: meta.mime,
      sizeKb: meta.sizeKb,
      text: fileText,
      dataUrl,
    });
  });
  return out;
}

/** The message as the person typed it — attachment blocks (and their bodies) removed. */
export function stripAttachmentBlocks(text: string): string {
  const first = text.search(/\[Attached (file|image|document): /);
  if (first < 0) return text;
  const before = text.slice(0, first);
  // Anything typed after the last attachment body is not recoverable reliably; keep the lead text.
  return before.replace(/\s+$/, "");
}

/** http(s) links in a message (deduped, max `limit`), ignoring inline image data. */
export function extractLinks(text: string, limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"'`\])]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && out.length < limit) {
    const safe = safeHttpUrl(match[0].replace(/[),.;:!?]+$/, ""));
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    out.push(safe);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Every link and file a list of messages points at, newest message first. */
export function collectSources(lines: Array<{ id: string; text: string }>): ChatSource[] {
  const out: ChatSource[] = [];
  const seenLinks = new Set<string>();
  for (const line of [...lines].reverse()) {
    for (const file of parseAttachments(line.text, line.id)) out.push({ kind: "file", id: file.id, file });
    for (const url of extractLinks(stripAttachmentBlocks(line.text) || line.text)) {
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      out.push({ kind: "link", id: `link:${url}`, url, host: hostOf(url) });
    }
  }
  return out;
}

/** "Preview this site: https://…" style prompts → the address to open in the panel. */
export function previewRequestUrl(text: string): string | null {
  const match = text.match(
    /(?:preview|screenshot|open|show)[^\n]*?(https?:\/\/\S+)|(?:معاينة|لقطة|شوف|افتح)[^\n]*?(https?:\/\/\S+)/i,
  );
  const raw = match?.[1] ?? match?.[2];
  return raw ? safeHttpUrl(raw.replace(/[),.;:!?]+$/, "")) : null;
}

export type CodeLanguage =
  | "ts"
  | "js"
  | "py"
  | "json"
  | "css"
  | "html"
  | "sh"
  | "sql"
  | "md"
  | "csv"
  | "rs"
  | "go"
  | "yaml"
  | "text";

export function languageForName(name: string): CodeLanguage {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "js";
  if (ext === "py") return "py";
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (["html", "xml", "svg"].includes(ext)) return "html";
  if (ext === "sh") return "sh";
  if (ext === "sql") return "sql";
  if (ext === "md") return "md";
  if (ext === "csv") return "csv";
  if (ext === "rs") return "rs";
  if (ext === "go") return "go";
  if (["yml", "yaml", "toml"].includes(ext)) return "yaml";
  return "text";
}

export type CodeToken = { text: string; kind: "plain" | "keyword" | "string" | "comment" | "number" };

const KEYWORDS =
  /^(?:const|let|var|function|return|if|else|for|while|import|from|export|default|class|extends|new|async|await|type|interface|def|elif|in|of|true|false|null|undefined|None|True|False|select|from|where|and|or|not|fn|pub|struct|impl|use|mut|package|func|try|catch|throw)$/;

/** Tiny syntax-ish tokenizer for one line (no HTML, rendered as React spans). */
export function tokenizeCodeLine(line: string, language: CodeLanguage): CodeToken[] {
  if (language === "text" || language === "csv" || language === "md") return [{ text: line, kind: "plain" }];
  const tokens: CodeToken[] = [];
  const commentStart = language === "py" || language === "sh" || language === "yaml" ? "#" : "//";
  const re = new RegExp(
    `(${commentStart === "#" ? "#" : "\\/\\/"}.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)`,
    "g",
  );
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match.index > last) tokens.push({ text: line.slice(last, match.index), kind: "plain" });
    if (match[1]) tokens.push({ text: match[1], kind: "comment" });
    else if (match[2]) tokens.push({ text: match[2], kind: "string" });
    else if (match[3]) tokens.push({ text: match[3], kind: "number" });
    else tokens.push({ text: match[4]!, kind: KEYWORDS.test(match[4]!) ? "keyword" : "plain" });
    last = match.index + match[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), kind: "plain" });
  return tokens;
}

/* ---- Session registry of the real File objects attached through the composer. ---- */

type Remembered = { file: File; url: string | null };
const registry = new Map<string, Remembered>();

export function rememberAttachments(files: FileList | File[] | null | undefined): void {
  if (!files) return;
  for (const file of Array.from(files).slice(0, 8)) {
    const previous = registry.get(file.name);
    if (previous?.url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previous.url);
    registry.set(file.name, { file, url: null });
  }
  // Keep the registry small.
  while (registry.size > 40) {
    const oldest = registry.keys().next().value as string;
    const gone = registry.get(oldest);
    if (gone?.url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(gone.url);
    registry.delete(oldest);
  }
}

export function rememberedFile(name: string): File | null {
  return registry.get(name)?.file ?? null;
}

/**
 * Object URL for a remembered file. PDFs and images are re-wrapped with a fixed, non-HTML
 * type so a mislabelled upload can never render as a page with this app's origin.
 */
export function rememberedObjectUrl(name: string, as: "pdf" | "image"): string | null {
  const entry = registry.get(name);
  if (!entry || typeof URL.createObjectURL !== "function") return null;
  if (as === "image" && !/^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(entry.file.type)) return null;
  if (!entry.url) {
    const type = as === "pdf" ? "application/pdf" : entry.file.type;
    entry.url = URL.createObjectURL(new Blob([entry.file], { type }));
  }
  return entry.url;
}

export function forgetAttachmentsForTests(): void {
  registry.clear();
}
