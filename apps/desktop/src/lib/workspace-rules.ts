import { readTextFile } from "./fs";

const RULE_CANDIDATES = [
  "AGENTS.md",
  ".arrab/rules.md",
  ".arrab/rules",
  ".cursorrules",
  "CLAUDE.md",
];

/** Load Cursor-style workspace rules from the open folder. */
export async function loadWorkspaceRules(folderPath: string | null): Promise<string | null> {
  if (!folderPath) return null;
  const chunks: string[] = [];
  for (const relative of RULE_CANDIDATES) {
    try {
      const file = await readTextFile(folderPath, relative);
      const body = file.content.trim();
      if (body) {
        chunks.push(`# ${relative}\n${body.slice(0, 8000)}`);
      }
    } catch {
      // missing is fine
    }
  }
  if (chunks.length === 0) return null;
  return chunks.join("\n\n").slice(0, 12_000);
}
