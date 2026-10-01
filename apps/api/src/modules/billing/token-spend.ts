import type { TokenSpendTier } from "@arrab/shared";

export interface SpendProfile {
  tier: TokenSpendTier;
  maxOutputTokens: number;
  historyMessages: number;
  knowledgeDocs: number;
  knowledgeChars: number;
  memories: number;
  memoryChars: number;
  skills: number;
  skillChars: number;
  hintGitChars: number;
  hintNotesChars: number;
  includeGithubBinding: boolean;
  githubReadmeChars: number;
  conciseReplyHint: boolean;
}

/** Suggested session budgets when the UI picks a tier (user can override). */
export const DEFAULT_SESSION_BUDGETS: Record<TokenSpendTier, number> = {
  low: 5_000,
  medium: 12_000,
  high: 40_000,
};

export function resolveSpendProfile(tier: TokenSpendTier): SpendProfile {
  switch (tier) {
    case "high":
      return {
        tier,
        maxOutputTokens: 1200,
        historyMessages: 20,
        knowledgeDocs: 12,
        knowledgeChars: 2400,
        memories: 8,
        memoryChars: 800,
        skills: 8,
        skillChars: 800,
        hintGitChars: 2500,
        hintNotesChars: 3000,
        includeGithubBinding: true,
        githubReadmeChars: 2500,
        conciseReplyHint: false,
      };
    case "medium":
      return {
        tier,
        maxOutputTokens: 500,
        historyMessages: 10,
        knowledgeDocs: 6,
        knowledgeChars: 1200,
        memories: 3,
        memoryChars: 400,
        skills: 3,
        skillChars: 400,
        hintGitChars: 1000,
        hintNotesChars: 1000,
        includeGithubBinding: true,
        githubReadmeChars: 1000,
        conciseReplyHint: true,
      };
    case "low":
    default:
      return {
        tier: "low",
        maxOutputTokens: 520,
        historyMessages: 8,
        knowledgeDocs: 6,
        knowledgeChars: 1200,
        memories: 4,
        memoryChars: 400,
        skills: 6,
        skillChars: 700,
        hintGitChars: 800,
        hintNotesChars: 800,
        includeGithubBinding: false,
        githubReadmeChars: 0,
        conciseReplyHint: true,
      };
  }
}

export function normalizeSpendTier(value: unknown): TokenSpendTier {
  if (value === "medium" || value === "high" || value === "low") {
    return value;
  }
  return "low";
}

export function normalizeSessionBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.min(Math.floor(n), 2_000_000);
}
