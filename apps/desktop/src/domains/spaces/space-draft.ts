export type SpaceDraft = {
  title: string;
  markdown: string;
};

/** Parse ```space-draft ... ``` or :::space-draft ... ::: blocks from a companion reply. */
export function parseSpaceDraft(text: string): SpaceDraft | null {
  const fenced =
    text.match(/```space-draft\s*\n([\s\S]*?)```/i) ??
    text.match(/:::space-draft\s*\n([\s\S]*?):::/i);
  if (!fenced?.[1]) return null;
  const body = fenced[1].trim();
  const split = body.match(/^title:\s*(.+)\n(?:---+\n)?([\s\S]*)$/i);
  if (split) {
    return {
      title: split[1]!.trim().slice(0, 200) || "Untitled",
      markdown: (split[2] ?? "").trim(),
    };
  }
  const firstLine = body.split("\n")[0]?.replace(/^#\s*/, "").trim() || "Untitled";
  return { title: firstLine.slice(0, 200), markdown: body };
}

export function stripSpaceDraftFence(text: string): string {
  return text
    .replace(/```space-draft\s*\n[\s\S]*?```/gi, "")
    .replace(/:::space-draft\s*\n[\s\S]*?:::/gi, "")
    .trim();
}
