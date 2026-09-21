/**
 * Lightweight markdown renderer for chat — code fences, inline code, bold, italic, links, lists.
 * No external deps; XSS-safe (text nodes only, no raw HTML passthrough).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const raw = match[0]!;
    const k = `${keyPrefix}-${i++}`;
    if (raw.startsWith("`")) {
      nodes.push(
        <code key={k} className="chat-md-code">
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("**")) {
      nodes.push(<strong key={k}>{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith("*")) {
      nodes.push(<em key={k}>{raw.slice(1, -1)}</em>);
    } else {
      const link = raw.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={k} href={link[2]} target="_blank" rel="noreferrer" className="chat-md-link">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(raw);
      }
    }
    last = match.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "code"; lang: string; body: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", lang, body: body.join("\n") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^[-*]\s+/.test(lines[i]!) && !/^\d+\.\s+/.test(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

export function ChatMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) {
    return <p className={cn("chat-md", className)}>{content}</p>;
  }
  return (
    <div className={cn("chat-md", className)}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={index} className="chat-md-pre" data-lang={block.lang || undefined}>
              <code>{block.body}</code>
            </pre>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="chat-md-ul">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `ul-${index}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={index} className="chat-md-ol">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `ol-${index}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="chat-md-p">
            {renderInline(block.text, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}

export async function copyChatText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Escape helper exported for tests / previews. */
export function sanitizeForPreview(htmlLike: string): string {
  return escapeText(htmlLike);
}
