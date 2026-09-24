/** Catalog companion managed by Arrab Control over the ERP API. */

export type ErpCompanionStatus = "draft" | "published" | "archived";

export interface ErpCompanionPersonality {
  warmth?: number;
  humor?: number;
  formality?: number;
  creativity?: number;
  verbosity?: number;
}

export interface ErpCompanionCapabilities {
  memory?: boolean;
  webSearch?: boolean;
  imageGeneration?: boolean;
  voice?: boolean;
  fileUpload?: boolean;
  codeInterpreter?: boolean;
}

export interface ErpCompanionKnowledge {
  title?: string;
  content?: string;
}

export interface ErpCompanionSafety {
  safeMode?: boolean;
  blockedTopics?: string[];
  maxDailyMessagesPerUser?: number;
  ageRestricted?: boolean;
}

export interface ErpCompanion {
  id: string;
  externalId?: string | null;
  name: string;
  slug?: string | null;
  tagline?: string | null;
  description?: string | null;
  avatar?: string | null;
  accent?: string | null;
  category?: string | null;
  status: ErpCompanionStatus;
  featured?: boolean;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string | null;
  greeting?: string | null;
  starterPrompts?: string[];
  personality?: ErpCompanionPersonality;
  languages?: string[];
  voice?: string | null;
  capabilities?: ErpCompanionCapabilities;
  knowledge?: ErpCompanionKnowledge[];
  tags?: string[];
  allowedPlanIds?: string[];
  assignedUserIds?: string[];
  safety?: ErpCompanionSafety;
  creditsPerMessage?: number | null;
  updatedAt: string;
}
