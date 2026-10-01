import type { Knowledge } from "@arrab/shared";

export type RankedKnowledge = {
  doc: Knowledge;
  score: number;
  plainContent: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

/** Score how well a knowledge doc matches the operator question. */
export function scoreKnowledgeMatch(
  query: string,
  title: string,
  content: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  let score = 0;

  if (titleLower.includes(q) || contentLower.includes(q)) score += 12;

  const tokens = [...new Set(tokenize(q))];
  for (const token of tokens) {
    if (titleLower.includes(token)) score += 4;
    if (contentLower.includes(token)) score += 2;
  }

  // Prefer shorter, denser matches slightly so playbooks win over huge dumps.
  if (score > 0 && content.length < 4000) score += 1;
  return score;
}

/**
 * Pick the most relevant organization knowledge for a question.
 * Workspace-wide docs are always eligible; project docs join when projectId is set.
 */
export function selectRelevantKnowledge(params: {
  docs: Knowledge[];
  query: string;
  projectId?: string | null;
  limit: number;
  decrypt: (value: string) => string;
}): RankedKnowledge[] {
  const { docs, query, projectId, limit, decrypt } = params;
  const scoped = docs.filter((doc) => {
    if (!doc.projectId) return true;
    return Boolean(projectId && doc.projectId === projectId);
  });

  const ranked = scoped
    .map((doc) => {
      const plainContent = decrypt(doc.content);
      return {
        doc,
        plainContent,
        score: scoreKnowledgeMatch(query, doc.title, plainContent),
      };
    })
    .sort((a, b) => b.score - a.score || b.doc.updatedAt.localeCompare(a.doc.updatedAt));

  const hits = ranked.filter((item) => item.score > 0);
  const pool = hits.length > 0 ? hits : ranked;
  return pool.slice(0, Math.max(1, limit));
}

export function buildKnowledgeSystemBlock(params: {
  items: RankedKnowledge[];
  maxCharsPerDoc: number;
  queryHadHits: boolean;
}): string {
  const { items, maxCharsPerDoc, queryHadHits } = params;
  if (items.length === 0) return "";

  const lines = items.map((item, index) => {
    const body = item.plainContent.slice(0, Math.max(200, maxCharsPerDoc));
    const scope = item.doc.projectId ? "project" : "organization";
    return `${index + 1}. [${scope}] ${item.doc.title}\n${body}`;
  });

  return [
    "ORGANIZATION KNOWLEDGE BASE (authoritative for this workspace):",
    queryHadHits
      ? "The operator question matches these docs. Answer directly from them when they contain the answer. Quote or paraphrase the relevant facts. Do not invent policy that contradicts them."
      : "No strong keyword match — still prefer these docs when relevant. If they do not cover the question, answer with your general AI knowledge and briefly note that it is outside the uploaded knowledge base.",
    ...lines,
  ].join("\n\n");
}
