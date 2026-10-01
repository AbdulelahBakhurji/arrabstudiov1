const OPEN = "<think>";
const CLOSE = "</think>";

export type SplitPart = { type: "token" | "thinking"; text: string };

/** Length of the longest suffix of `text` that is a prefix of `tag`. */
function partialTagTail(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let size = max; size > 0; size -= 1) {
    if (tag.startsWith(text.slice(-size))) return size;
  }
  return 0;
}

/**
 * Splits streamed text from models that inline their reasoning as
 * `<think>…</think>` (DeepSeek R1, Qwen, gpt-oss on some hosts). An opening
 * tag only counts before any answer text, so answers that merely mention the
 * tag are left alone.
 */
export class ThinkTagSplitter {
  private inThink = false;
  private sawAnswer = false;
  private pending = "";

  push(text: string): SplitPart[] {
    const out: SplitPart[] = [];
    let rest = this.pending + text;
    this.pending = "";
    while (rest) {
      if (this.inThink) {
        const end = rest.indexOf(CLOSE);
        if (end >= 0) {
          if (end > 0) out.push({ type: "thinking", text: rest.slice(0, end) });
          this.inThink = false;
          rest = rest.slice(end + CLOSE.length).replace(/^\s+/, "");
          continue;
        }
        const tail = partialTagTail(rest, CLOSE);
        const body = rest.slice(0, rest.length - tail);
        if (body) out.push({ type: "thinking", text: body });
        this.pending = rest.slice(rest.length - tail);
        return out;
      }
      if (!this.sawAnswer) {
        const lead = rest.replace(/^\s+/, "");
        if (lead.startsWith(OPEN)) {
          this.inThink = true;
          rest = lead.slice(OPEN.length);
          continue;
        }
        if (lead.length < OPEN.length && OPEN.startsWith(lead)) {
          this.pending = rest;
          return out;
        }
        if (!lead) {
          this.pending = rest;
          return out;
        }
      }
      this.sawAnswer = true;
      out.push({ type: "token", text: rest });
      return out;
    }
    return out;
  }

  /** Remaining buffered text at end of stream. */
  flush(): SplitPart[] {
    const rest = this.pending;
    this.pending = "";
    if (!rest) return [];
    return [{ type: this.inThink ? "thinking" : "token", text: rest }];
  }
}

/** Remove a leading `<think>…</think>` block from a complete answer. */
export function stripThinkBlock(text: string): { answer: string; thinking: string } {
  const match = /^\s*<think>([\s\S]*?)<\/think>\s*/.exec(text);
  if (!match) return { answer: text, thinking: "" };
  return { answer: text.slice(match[0].length), thinking: match[1]!.trim() };
}
