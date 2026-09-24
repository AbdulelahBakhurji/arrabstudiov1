import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@arrab/core";
import type { ErpCompanionRepository } from "@arrab/database";
import type {
  ErpCompanion,
  ErpCompanionCapabilities,
  ErpCompanionKnowledge,
  ErpCompanionPersonality,
  ErpCompanionSafety,
  ErpCompanionStatus,
} from "@arrab/shared";

const STATUSES = new Set<ErpCompanionStatus>(["draft", "published", "archived"]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Companion body must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalNumber(value: unknown, field: string, min: number, max: number): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  const num = optionalNumber(value, field, min, max);
  if (num == null) return null;
  return Math.round(num);
}

function stringList(value: unknown, field: string, maxItems: number, maxLen: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  return value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLen));
}

function clampScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function personality(value: unknown): ErpCompanionPersonality | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("personality must be an object");
  }
  const raw = value as Record<string, unknown>;
  const next: ErpCompanionPersonality = {};
  for (const key of ["warmth", "humor", "formality", "creativity", "verbosity"] as const) {
    const score = clampScore(raw[key]);
    if (score != null) next[key] = score;
  }
  return next;
}

function capabilities(value: unknown): ErpCompanionCapabilities | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("capabilities must be an object");
  }
  const raw = value as Record<string, unknown>;
  const next: ErpCompanionCapabilities = {};
  for (const key of [
    "memory",
    "webSearch",
    "imageGeneration",
    "voice",
    "fileUpload",
    "codeInterpreter",
  ] as const) {
    if (typeof raw[key] === "boolean") next[key] = raw[key];
  }
  return next;
}

function knowledge(value: unknown): ErpCompanionKnowledge[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError("knowledge must be an array");
  return value.slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
    const content = typeof raw.content === "string" ? raw.content.trim().slice(0, 8000) : "";
    if (!title && !content) return [];
    return [{ title, content }];
  });
}

function safety(value: unknown): ErpCompanionSafety | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("safety must be an object");
  }
  const raw = value as Record<string, unknown>;
  const next: ErpCompanionSafety = {};
  if (typeof raw.safeMode === "boolean") next.safeMode = raw.safeMode;
  if (typeof raw.ageRestricted === "boolean") next.ageRestricted = raw.ageRestricted;
  if (raw.blockedTopics != null) next.blockedTopics = stringList(raw.blockedTopics, "blockedTopics", 40, 80);
  if (raw.maxDailyMessagesPerUser != null) {
    next.maxDailyMessagesPerUser =
      optionalInt(raw.maxDailyMessagesPerUser, "maxDailyMessagesPerUser", 0, 100_000) ?? undefined;
  }
  return next;
}

/** Body fields for create/replace. id and updatedAt are assigned by the server. */
export function parseErpCompanionBody(input: unknown): Omit<ErpCompanion, "id" | "updatedAt"> {
  const raw = asRecord(input);
  const name = optionalString(raw.name, "name", 120);
  if (!name) throw new ValidationError("name is required");
  const statusRaw = raw.status == null || raw.status === "" ? "draft" : raw.status;
  if (typeof statusRaw !== "string" || !STATUSES.has(statusRaw as ErpCompanionStatus)) {
    throw new ValidationError('status must be "draft", "published", or "archived"');
  }
  return {
    externalId: optionalString(raw.externalId, "externalId", 200),
    name,
    slug: optionalString(raw.slug, "slug", 120),
    tagline: optionalString(raw.tagline, "tagline", 240),
    description: optionalString(raw.description, "description", 4000),
    avatar: optionalString(raw.avatar, "avatar", 2000),
    accent: optionalString(raw.accent, "accent", 40),
    category: optionalString(raw.category, "category", 80),
    status: statusRaw as ErpCompanionStatus,
    featured: raw.featured === true,
    model: optionalString(raw.model, "model", 200),
    temperature: optionalNumber(raw.temperature, "temperature", 0, 2),
    maxTokens: optionalInt(raw.maxTokens, "maxTokens", 1, 32_000),
    systemPrompt: optionalString(raw.systemPrompt, "systemPrompt", 20_000),
    greeting: optionalString(raw.greeting, "greeting", 2000),
    starterPrompts: stringList(raw.starterPrompts, "starterPrompts", 12, 240),
    personality: personality(raw.personality),
    languages: stringList(raw.languages, "languages", 12, 40),
    voice: optionalString(raw.voice, "voice", 80),
    capabilities: capabilities(raw.capabilities),
    knowledge: knowledge(raw.knowledge),
    tags: stringList(raw.tags, "tags", 24, 40),
    allowedPlanIds: stringList(raw.allowedPlanIds, "allowedPlanIds", 24, 40),
    assignedUserIds: stringList(raw.assignedUserIds, "assignedUserIds", 200, 80),
    safety: safety(raw.safety),
    creditsPerMessage: optionalNumber(raw.creditsPerMessage, "creditsPerMessage", 0, 1_000_000),
  };
}

function newId(): string {
  return `ec_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export class ErpCompanionService {
  constructor(private readonly repo: ErpCompanionRepository) {}

  async list(input: { limit: number; publishedOnly: boolean }): Promise<ErpCompanion[]> {
    const items = await this.repo.list();
    const visible = input.publishedOnly
      ? items.filter((item) => item.status === "published")
      : items;
    visible.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return visible.slice(0, input.limit);
  }

  async create(input: unknown): Promise<ErpCompanion> {
    const body = parseErpCompanionBody(input);
    if (body.externalId) {
      const existing = await this.repo.getByExternalId(body.externalId);
      if (existing) throw new ValidationError("externalId already exists");
    }
    const item: ErpCompanion = {
      ...body,
      id: newId(),
      updatedAt: new Date().toISOString(),
    };
    return this.repo.insert(item);
  }

  async replace(id: string, input: unknown): Promise<ErpCompanion> {
    const existing = await this.repo.getById(id);
    if (!existing) throw new NotFoundError("Companion", id);
    const body = parseErpCompanionBody(input);
    if (body.externalId && body.externalId !== existing.externalId) {
      const clash = await this.repo.getByExternalId(body.externalId);
      if (clash && clash.id !== id) throw new ValidationError("externalId already exists");
    }
    const item: ErpCompanion = {
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.repo.replace(item);
    if (!saved) throw new NotFoundError("Companion", id);
    return saved;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const removed = await this.repo.delete(id);
    if (!removed) throw new NotFoundError("Companion", id);
    return { ok: true };
  }
}
