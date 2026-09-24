/**
 * User skills — reusable instruction packs (SKILL.md style) that apply to any
 * chat, on local or cloud models, for guests and signed-in users alike.
 *
 * Isolation: stored per account partition and per family seat, like the
 * Second Brain, so a child seat never sees a parent's skills.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { strFromU8, unzipSync } from "fflate";
import type { SendMessageRequest, SkillLibraryEntry, WorkspaceHint } from "@arrab/shared";
import { ACCOUNT_EVENT, readAccountSessionToken } from "./account-session";
import { FAMILY_EVENT, readActiveFamilyMemberId } from "./family-session";
import { isTauriRuntime } from "./terminal";

export const SKILLS_EVENT = "arrab:skills";
const STORE_PREFIX = "arrab.skills.v1";
const ARMED_PREFIX = "arrab.skills.armed.v1";

export const SKILL_LIMITS = {
  name: 80,
  slug: 48,
  description: 500,
  instructions: 40_000,
  resourceChars: 60_000,
  resourcesPerSkill: 24,
  resourcesTotal: 200_000,
  skills: 200,
  importFileBytes: 2_000_000,
} as const;

/** Old API servers read skills from workspace rules; newer ones strip this block. */
export const SKILLS_RULES_OPEN = "<<arrab-skills>>";
export const SKILLS_RULES_CLOSE = "<</arrab-skills>>";

export type SkillMode = "always" | "auto" | "manual";
export type SkillSource = "created" | "imported" | "starter";

export type SkillResource = { path: string; content: string };

export type UserSkill = {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  mode: SkillMode;
  enabled: boolean;
  source: SkillSource;
  origin: string | null;
  tags: string[];
  resources: SkillResource[];
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillDraft = {
  name: string;
  instructions: string;
  description?: string;
  slug?: string;
  mode?: SkillMode;
  tags?: string[];
  resources?: SkillResource[];
  source?: SkillSource;
  origin?: string | null;
  enabled?: boolean;
};

export type SkillImportResult = {
  added: UserSkill[];
  updated: UserSkill[];
  errors: string[];
};

/* ---------------- Partitioning ---------------- */

function hash(raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${Math.abs(h).toString(36)}${raw.length.toString(36)}`;
}

function partition(): string {
  const token = readAccountSessionToken();
  const account = token ? hash(`acct::${token}`).slice(0, 16) : "guest";
  const member = readActiveFamilyMemberId()?.trim() || "self";
  return `${account}.${member}`;
}

function storeKey() {
  return `${STORE_PREFIX}.${partition()}`;
}

function armedKey() {
  return `${ARMED_PREFIX}.${partition()}`;
}

function emit() {
  window.dispatchEvent(new CustomEvent(SKILLS_EVENT));
}

/* ---------------- Normalization ---------------- */

const MODES: SkillMode[] = ["always", "auto", "manual"];

export function slugifySkill(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_LIMITS.slug)
    .replace(/-+$/g, "");
}

function humanizeName(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(trimmed)) return trimmed;
  if (/^[a-z]{2,4}$/.test(trimmed)) return trimmed.toUpperCase();
  const spaced = trimmed.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function clampResources(resources: SkillResource[] | undefined): SkillResource[] {
  if (!Array.isArray(resources)) return [];
  const out: SkillResource[] = [];
  let total = 0;
  const sorted = [...resources]
    .filter((item) => item && typeof item.path === "string" && typeof item.content === "string")
    .sort((a, b) => {
      const aMd = /\.(md|markdown)$/i.test(a.path) ? 0 : 1;
      const bMd = /\.(md|markdown)$/i.test(b.path) ? 0 : 1;
      return aMd - bMd || a.path.localeCompare(b.path);
    });
  for (const item of sorted) {
    if (out.length >= SKILL_LIMITS.resourcesPerSkill) break;
    const room = SKILL_LIMITS.resourcesTotal - total;
    if (room <= 200) break;
    const content = item.content.slice(0, Math.min(SKILL_LIMITS.resourceChars, room));
    total += content.length;
    out.push({ path: item.path.slice(0, 240), content });
  }
  return out;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().slice(0, 32))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function normalizeSkill(raw: Partial<UserSkill>): UserSkill | null {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, SKILL_LIMITS.name) : "";
  const instructions =
    typeof raw.instructions === "string"
      ? raw.instructions.slice(0, SKILL_LIMITS.instructions)
      : "";
  if (!name || !instructions.trim()) return null;
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `sk_${crypto.randomUUID()}`,
    name,
    slug: slugifySkill(raw.slug || name) || `skill-${hash(name)}`,
    description:
      typeof raw.description === "string"
        ? raw.description.trim().slice(0, SKILL_LIMITS.description)
        : "",
    instructions,
    mode: MODES.includes(raw.mode as SkillMode) ? (raw.mode as SkillMode) : "auto",
    enabled: raw.enabled !== false,
    source:
      raw.source === "imported" || raw.source === "starter" ? raw.source : "created",
    origin: typeof raw.origin === "string" && raw.origin ? raw.origin.slice(0, 300) : null,
    tags: normalizeTags(raw.tags),
    resources: clampResources(raw.resources),
    uses: typeof raw.uses === "number" && raw.uses > 0 ? Math.floor(raw.uses) : 0,
    lastUsedAt: typeof raw.lastUsedAt === "string" ? raw.lastUsedAt : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

/* ---------------- Store ---------------- */

let skillsCache: { key: string; raw: string | null; skills: UserSkill[] } | null = null;
let armedCache: { key: string; raw: string | null; ids: string[] } | null = null;

export function readSkills(): UserSkill[] {
  const key = storeKey();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  if (skillsCache && skillsCache.key === key && skillsCache.raw === raw) return skillsCache.skills;
  let skills: UserSkill[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { skills?: unknown[] };
      skills = (Array.isArray(parsed.skills) ? parsed.skills : [])
        .map((item) => normalizeSkill(item as Partial<UserSkill>))
        .filter((item): item is UserSkill => Boolean(item));
    } catch {
      skills = [];
    }
  }
  skillsCache = { key, raw, skills };
  return skills;
}

function writeSkills(skills: UserSkill[]) {
  const key = storeKey();
  const raw = JSON.stringify({ version: 1, skills });
  try {
    localStorage.setItem(key, raw);
  } catch {
    throw new Error("Skill storage is full. Remove unused skills or large reference files.");
  }
  skillsCache = { key, raw, skills };
  emit();
}

export function readArmedSkillIds(): string[] {
  const key = armedKey();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  if (armedCache && armedCache.key === key && armedCache.raw === raw) return armedCache.ids;
  let ids: string[] = [];
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    ids = [];
  }
  armedCache = { key, raw, ids };
  return ids;
}

function writeArmed(ids: string[]) {
  const key = armedKey();
  const unique = [...new Set(ids)].slice(0, 8);
  const raw = JSON.stringify(unique);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // Armed skills are a convenience; ignore storage failures.
  }
  armedCache = { key, raw, ids: unique };
  emit();
}

function subscribe(onChange: () => void) {
  const handler = () => onChange();
  window.addEventListener(SKILLS_EVENT, handler);
  window.addEventListener(ACCOUNT_EVENT, handler);
  window.addEventListener(FAMILY_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SKILLS_EVENT, handler);
    window.removeEventListener(ACCOUNT_EVENT, handler);
    window.removeEventListener(FAMILY_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useSkills(): UserSkill[] {
  return useSyncExternalStore(subscribe, readSkills, readSkills);
}

export function useArmedSkillIds(): string[] {
  return useSyncExternalStore(subscribe, readArmedSkillIds, readArmedSkillIds);
}

function uniqueSlug(base: string, skills: UserSkill[], ignoreId?: string): string {
  const root = slugifySkill(base) || "skill";
  const taken = new Set(skills.filter((skill) => skill.id !== ignoreId).map((skill) => skill.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i++) {
    const candidate = `${root.slice(0, SKILL_LIMITS.slug - 4)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export function createSkill(draft: SkillDraft): UserSkill {
  const skills = readSkills();
  if (skills.length >= SKILL_LIMITS.skills) {
    throw new Error(`You can keep up to ${SKILL_LIMITS.skills} skills.`);
  }
  const now = new Date().toISOString();
  const skill = normalizeSkill({
    ...draft,
    id: `sk_${crypto.randomUUID()}`,
    slug: uniqueSlug(draft.slug || draft.name, skills),
    uses: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  if (!skill) throw new Error("A skill needs a name and instructions.");
  writeSkills([skill, ...skills]);
  return skill;
}

export function updateSkill(id: string, patch: Partial<SkillDraft>): UserSkill {
  const skills = readSkills();
  const current = skills.find((skill) => skill.id === id);
  if (!current) throw new Error("Skill not found.");
  const next = normalizeSkill({
    ...current,
    ...patch,
    slug: patch.slug !== undefined || patch.name !== undefined
      ? uniqueSlug(patch.slug || patch.name || current.slug, skills, id)
      : current.slug,
    updatedAt: new Date().toISOString(),
  });
  if (!next) throw new Error("A skill needs a name and instructions.");
  writeSkills(skills.map((skill) => (skill.id === id ? next : skill)));
  return next;
}

export function deleteSkill(id: string) {
  writeSkills(readSkills().filter((skill) => skill.id !== id));
  const armed = readArmedSkillIds();
  if (armed.includes(id)) writeArmed(armed.filter((item) => item !== id));
}

export function duplicateSkill(id: string): UserSkill {
  const source = readSkills().find((skill) => skill.id === id);
  if (!source) throw new Error("Skill not found.");
  return createSkill({
    ...source,
    name: `${source.name} copy`.slice(0, SKILL_LIMITS.name),
    slug: `${source.slug}-copy`,
    source: "created",
  });
}

/** Add or refresh skills; an existing skill with the same slug is updated in place. */
export function addSkills(drafts: SkillDraft[]): { added: UserSkill[]; updated: UserSkill[] } {
  let skills = [...readSkills()];
  const added: UserSkill[] = [];
  const updated: UserSkill[] = [];
  const now = new Date().toISOString();
  for (const draft of drafts) {
    const slug = slugifySkill(draft.slug || draft.name);
    const existing = slug ? skills.find((skill) => skill.slug === slug) : undefined;
    if (existing) {
      const next = normalizeSkill({
        ...existing,
        ...draft,
        id: existing.id,
        slug: existing.slug,
        enabled: existing.enabled,
        mode: draft.mode ?? existing.mode,
        uses: existing.uses,
        lastUsedAt: existing.lastUsedAt,
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      if (!next) continue;
      skills = skills.map((skill) => (skill.id === existing.id ? next : skill));
      updated.push(next);
      continue;
    }
    if (skills.length >= SKILL_LIMITS.skills) break;
    const skill = normalizeSkill({
      ...draft,
      id: `sk_${crypto.randomUUID()}`,
      slug: uniqueSlug(slug || draft.name, skills),
      uses: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!skill) continue;
    skills = [skill, ...skills];
    added.push(skill);
  }
  if (added.length || updated.length) writeSkills(skills);
  return { added, updated };
}

export function setSkillEnabled(id: string, enabled: boolean) {
  updateSkill(id, { enabled });
  if (!enabled) disarmSkill(id);
}

export function armSkill(id: string) {
  writeArmed([...readArmedSkillIds(), id]);
}

export function disarmSkill(id: string) {
  const armed = readArmedSkillIds();
  if (armed.includes(id)) writeArmed(armed.filter((item) => item !== id));
}

export function toggleArmedSkill(id: string) {
  const armed = readArmedSkillIds();
  writeArmed(armed.includes(id) ? armed.filter((item) => item !== id) : [...armed, id]);
}

export function clearArmedSkills() {
  writeArmed([]);
}

function markSkillsUsed(ids: string[]) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const skills = readSkills();
  try {
    writeSkills(
      skills.map((skill) =>
        ids.includes(skill.id) ? { ...skill, uses: skill.uses + 1, lastUsedAt: now } : skill,
      ),
    );
  } catch {
    // Usage stats are best-effort.
  }
}

/* ---------------- Parsing ---------------- */

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(src: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (value === "" || /^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      const list: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "")) {
        i++;
        const line = lines[i]!.trim();
        const item = line.match(/^-\s+(.*)$/);
        if (item) list.push(unquote(item[1]!));
        else if (line) block.push(line);
      }
      if (list.length) out[key] = list;
      else out[key] = value.startsWith(">") ? block.join(" ") : block.join("\n");
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => unquote(item))
        .filter(Boolean);
      continue;
    }
    out[key] = unquote(value);
  }
  return out;
}

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function firstParagraph(body: string): string {
  const para = body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk && !chunk.startsWith("#") && !chunk.startsWith("```"));
  return (para ?? "").replace(/\s+/g, " ").slice(0, 220);
}

/** Parse a SKILL.md (YAML frontmatter + Markdown body) or plain Markdown/text. */
export function parseSkillMarkdown(text: string, fallbackName = ""): SkillDraft | null {
  const source = text.replace(/^\uFEFF/, "");
  const fm = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const meta = fm ? parseFrontmatter(fm[1]!) : {};
  let body = (fm ? source.slice(fm[0].length) : source).trim();

  let name = asString(meta.name || meta.title).trim();
  if (!name) {
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) name = heading[1]!.trim();
  }
  if (!name) name = fallbackName.replace(/\.(md|markdown|txt)$/i, "");
  name = humanizeName(name);
  if (!name || !body) return null;

  const rawMode = asString(meta.mode).toLowerCase();
  const alwaysApply = asString(meta.alwaysapply || meta["always-apply"]).toLowerCase() === "true";
  const manualOnly =
    asString(meta["disable-model-invocation"]).toLowerCase() === "true" ||
    asString(meta["user-invocable-only"]).toLowerCase() === "true";
  const mode: SkillMode | undefined = MODES.includes(rawMode as SkillMode)
    ? (rawMode as SkillMode)
    : alwaysApply
      ? "always"
      : manualOnly
        ? "manual"
        : undefined;

  const tagsRaw = meta.tags ?? meta.keywords;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw
    : typeof tagsRaw === "string"
      ? tagsRaw.split(",")
      : [];

  const description =
    asString(meta.description || meta["when_to_use"] || meta.when).trim() || firstParagraph(body);

  if (body.length > SKILL_LIMITS.instructions) body = body.slice(0, SKILL_LIMITS.instructions);

  return {
    name,
    slug: slugifySkill(asString(meta.name) || name),
    description,
    instructions: body,
    mode,
    tags: tags.map((tag) => tag.trim()).filter(Boolean),
  };
}

function draftsFromJson(text: string, origin: string): SkillDraft[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { skills?: unknown }).skills)
      ? ((parsed as { skills: unknown[] }).skills)
      : [parsed];
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? item.title ?? "").trim(),
      instructions: String(item.instructions ?? item.content ?? item.prompt ?? ""),
      description: typeof item.description === "string" ? item.description : "",
      slug: typeof item.slug === "string" ? item.slug : undefined,
      mode: MODES.includes(item.mode as SkillMode) ? (item.mode as SkillMode) : undefined,
      tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
      resources: Array.isArray(item.resources) ? (item.resources as SkillResource[]) : [],
      source: "imported" as const,
      origin,
    }))
    .filter((draft) => draft.name && draft.instructions.trim());
}

export function exportSkillMarkdown(skill: UserSkill): string {
  const esc = (value: string) => (/[:#\n"']/.test(value) ? JSON.stringify(value) : value);
  const lines = [
    "---",
    `name: ${esc(skill.slug)}`,
    `title: ${esc(skill.name)}`,
    `description: ${esc(skill.description.replace(/\s+/g, " "))}`,
    `mode: ${skill.mode}`,
  ];
  if (skill.tags.length) lines.push(`tags: [${skill.tags.map(esc).join(", ")}]`);
  lines.push("---", "", skill.instructions.trim(), "");
  return lines.join("\n");
}

export function exportSkillsBundle(skills: UserSkill[]): string {
  return JSON.stringify(
    {
      format: "arrab.skills",
      version: 1,
      exportedAt: new Date().toISOString(),
      skills: skills.map((skill) => ({
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        instructions: skill.instructions,
        mode: skill.mode,
        tags: skill.tags,
        resources: skill.resources,
      })),
    },
    null,
    2,
  );
}

/* ---------------- Import (files, folders, zip, URL) ---------------- */

type Entry = { path: string; text: string };
export type PickedFile = { file: File; path: string };

const TEXT_EXT =
  /\.(md|markdown|mdx|txt|json|ya?ml|csv|tsv|py|js|cjs|mjs|ts|tsx|jsx|sh|bash|zsh|html?|css|xml|sql|toml|ini|rb|go|rs|java|kt|swift|php)$/i;
const IGNORED = /(^|\/)(__MACOSX|\.git|node_modules|\.DS_Store)(\/|$)|(^|\/)\._/;

const isSkillFile = (path: string) => /(^|\/)skill\.md$/i.test(path);
const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const inDir = (path: string, dir: string) => (dir ? path.startsWith(`${dir}/`) : true);
const relative = (path: string, dir: string) => (dir ? path.slice(dir.length + 1) : path);

function isHumanDoc(path: string) {
  return /^(readme|license|licence|changelog|contributing|code_of_conduct|security)(\.[a-z]+)?$/i.test(
    basename(path),
  );
}

function isResource(path: string) {
  return TEXT_EXT.test(path) && !isHumanDoc(path) && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function draftsFromEntries(entries: Entry[], origin: string): { drafts: SkillDraft[]; errors: string[] } {
  const files = entries
    .map((entry) => ({ path: entry.path.replace(/\\/g, "/").replace(/^\/+/, ""), text: entry.text }))
    .filter((entry) => !IGNORED.test(entry.path));
  const errors: string[] = [];
  const skillFiles = files.filter((entry) => isSkillFile(entry.path));

  if (skillFiles.length) {
    const dirs = skillFiles.map((entry) => dirname(entry.path));
    const drafts = skillFiles
      .map((entry, index) => {
        const dir = dirs[index]!;
        const nested = dirs.filter((other) => other !== dir && inDir(other, dir));
        const resources = files
          .filter(
            (file) =>
              file !== entry &&
              inDir(file.path, dir) &&
              !nested.some((other) => inDir(file.path, other)) &&
              isResource(file.path),
          )
          .map((file) => ({ path: relative(file.path, dir), content: file.text }));
        const draft = parseSkillMarkdown(entry.text, basename(dir) || "skill");
        if (!draft) {
          errors.push(`${entry.path}: empty skill`);
          return null;
        }
        return { ...draft, resources, source: "imported" as const, origin };
      })
      .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));
    return { drafts, errors };
  }

  const drafts: SkillDraft[] = [];
  for (const file of files) {
    if (/\.json$/i.test(file.path)) {
      try {
        drafts.push(...draftsFromJson(file.text, origin));
      } catch {
        errors.push(`${basename(file.path)}: not a valid skills JSON file`);
      }
      continue;
    }
    if (/\.(md|markdown|mdx|txt)$/i.test(file.path) && !isHumanDoc(file.path)) {
      const draft = parseSkillMarkdown(file.text, basename(file.path));
      if (draft) drafts.push({ ...draft, source: "imported", origin });
      else errors.push(`${basename(file.path)}: empty file`);
    }
  }
  if (!drafts.length && !errors.length) {
    errors.push("No SKILL.md, Markdown, or skills JSON found.");
  }
  return { drafts, errors };
}

function commitImport(drafts: SkillDraft[], errors: string[]): SkillImportResult {
  if (!drafts.length) return { added: [], updated: [], errors };
  const { added, updated } = addSkills(drafts);
  return { added, updated, errors };
}

function unzipEntries(bytes: Uint8Array, prefix = ""): Entry[] {
  const files = unzipSync(bytes, {
    filter: (file) =>
      !IGNORED.test(file.name) &&
      (isSkillFile(file.name) || TEXT_EXT.test(file.name)) &&
      file.originalSize <= SKILL_LIMITS.importFileBytes,
  });
  return Object.entries(files)
    .filter(([path]) => !path.endsWith("/"))
    .map(([path, data]) => ({ path: prefix ? `${prefix}/${path}` : path, text: strFromU8(data) }));
}

export async function importSkillFiles(items: PickedFile[]): Promise<SkillImportResult> {
  const entries: Entry[] = [];
  const errors: string[] = [];
  for (const { file, path } of items) {
    const name = path || file.name;
    if (IGNORED.test(name)) continue;
    try {
      if (/\.(zip|skill)$/i.test(name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        entries.push(...unzipEntries(bytes));
        continue;
      }
      if (!isSkillFile(name) && !TEXT_EXT.test(name)) continue;
      if (file.size > SKILL_LIMITS.importFileBytes) {
        errors.push(`${basename(name)}: file is too large`);
        continue;
      }
      entries.push({ path: name, text: await file.text() });
    } catch {
      errors.push(`${basename(name)}: could not be read`);
    }
  }
  if (!entries.length) {
    return { added: [], updated: [], errors: errors.length ? errors : ["No readable skill files found."] };
  }
  const origin = items.length === 1 ? basename(items[0]!.path || items[0]!.file.name) : "Local files";
  const parsed = draftsFromEntries(entries, origin);
  return commitImport(parsed.drafts, [...errors, ...parsed.errors]);
}

export function importSkillText(text: string, name = "Pasted skill"): SkillImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { added: [], updated: [], errors: ["Paste a SKILL.md or instructions first."] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return commitImport(draftsFromJson(trimmed, "Pasted"), []);
    } catch {
      // Fall through to Markdown.
    }
  }
  const draft = parseSkillMarkdown(trimmed, name);
  if (!draft) return { added: [], updated: [], errors: ["That text has no instructions."] };
  return commitImport([{ ...draft, source: "imported", origin: "Pasted" }], []);
}

/** Expand dropped files and folders (Finder drag) into files with relative paths. */
export async function filesFromDataTransfer(data: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const entries = [...data.items]
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) {
    return [...data.files].map((file) => ({ file, path: file.name }));
  }
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length > 400) return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (IGNORED.test(path)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      out.push({ file, path });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      children.push(...batch);
    }
    for (const child of children) await walk(child, path);
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "text/plain, application/json, */*" } });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Nothing found at that link.");
    throw new Error(`Download failed (${response.status}).`);
  }
  return response.text();
}

async function fetchGithubJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub rate limit reached. Try again in a few minutes, or import a .zip.");
  }
  if (response.status === 404) throw new Error("Repository or path not found (it must be public).");
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return (await response.json()) as T;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function importGithubTree(
  owner: string,
  repo: string,
  refInput: string | null,
  basePath: string,
): Promise<SkillImportResult> {
  const ref =
    refInput ||
    (await fetchGithubJson<{ default_branch: string }>(`/repos/${owner}/${repo}`)).default_branch;
  const tree = await fetchGithubJson<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated?: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const prefix = basePath.replace(/^\/+|\/+$/g, "");
  const blobs = tree.tree.filter(
    (item) =>
      item.type === "blob" &&
      !IGNORED.test(item.path) &&
      (!prefix || item.path === prefix || item.path.startsWith(`${prefix}/`)) &&
      (item.size ?? 0) <= SKILL_LIMITS.importFileBytes,
  );
  const skillDirs = blobs.filter((item) => isSkillFile(item.path)).map((item) => dirname(item.path));
  const wanted = skillDirs.length
    ? blobs.filter(
        (item) =>
          skillDirs.some((dir) => inDir(item.path, dir)) &&
          (isSkillFile(item.path) || (isResource(item.path) && (item.size ?? 0) <= 250_000)),
      )
    : blobs
        .filter((item) => /\.(md|markdown)$/i.test(item.path) && !isHumanDoc(item.path))
        .slice(0, 12);
  if (!wanted.length) {
    throw new Error("No SKILL.md or Markdown skill files found at that link.");
  }
  const limited = wanted.slice(0, 160);
  const entries: Entry[] = [];
  for (let i = 0; i < limited.length; i += 8) {
    const batch = limited.slice(i, i + 8);
    const texts = await Promise.all(
      batch.map((item) =>
        fetchText(
          `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(item.path)}`,
        ).catch(() => null),
      ),
    );
    batch.forEach((item, index) => {
      const text = texts[index];
      if (text != null) entries.push({ path: item.path, text });
    });
  }
  const parsed = draftsFromEntries(entries, `github.com/${owner}/${repo}${prefix ? `/${prefix}` : ""}`);
  return commitImport(parsed.drafts, parsed.errors);
}

/** Import from a GitHub repo/folder/file link, a raw URL, or a direct .md/.json/.zip link. */
export async function importSkillsFromUrl(input: string): Promise<SkillImportResult> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { added: [], updated: [], errors: ["Enter a full link starting with https://"] };
  }
  if (url.protocol !== "https:") {
    return { added: [], updated: [], errors: ["Only https:// links are supported."] };
  }
  try {
    if (url.hostname === "github.com" || url.hostname === "www.github.com") {
      const [owner, repoRaw, kind, ref, ...rest] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
      const repo = repoRaw?.replace(/\.git$/i, "");
      if (!owner || !repo) throw new Error("Link to a GitHub repository, folder, or SKILL.md file.");
      if (kind === "blob" && ref) {
        const path = rest.join("/");
        if (isSkillFile(path)) return await importGithubTree(owner, repo, ref, dirname(path));
        const text = await fetchText(
          `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`,
        );
        const parsed = draftsFromEntries([{ path, text }], `github.com/${owner}/${repo}`);
        return commitImport(parsed.drafts, parsed.errors);
      }
      return await importGithubTree(owner, repo, kind === "tree" ? ref ?? null : null, kind === "tree" ? rest.join("/") : "");
    }
    const path = decodeURIComponent(url.pathname);
    if (/\.(zip|skill)$/i.test(path)) {
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const entries = unzipEntries(new Uint8Array(await response.arrayBuffer()));
      const parsed = draftsFromEntries(entries, url.hostname);
      return commitImport(parsed.drafts, parsed.errors);
    }
    const text = await fetchText(url.toString());
    const fileName = basename(path) || "SKILL.md";
    const parsed = draftsFromEntries(
      [{ path: /\.(md|markdown|txt|json)$/i.test(fileName) ? fileName : `${fileName}.md`, text }],
      url.hostname,
    );
    return commitImport(parsed.drafts, parsed.errors);
  } catch (error: unknown) {
    const message =
      error instanceof TypeError
        ? "Couldn't reach that link. Check your connection, or download the file and import it."
        : error instanceof Error
          ? error.message
          : "Import failed.";
    return { added: [], updated: [], errors: [message] };
  }
}

/* ---------------- Applying skills to a message ---------------- */

const STOPWORDS = new Set(
  "the and for with that this from your you are was were have has had not but can will what when where which who how into about over them they then than also just like make made use using please need want help write me my our its it's an a to of in on at by or is be as do".split(
    " ",
  ),
);

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOPWORDS.has(word)),
  );
}

function relevance(skill: UserSkill, words: Set<string>): number {
  if (!words.size) return 0;
  const nameWords = tokens(`${skill.name} ${skill.slug.replace(/-/g, " ")} ${skill.tags.join(" ")}`);
  const descWords = tokens(skill.description);
  let score = 0;
  for (const word of words) {
    if (nameWords.has(word)) score += 2;
    else if (descWords.has(word)) score += 1;
  }
  return score;
}

/** Skills explicitly invoked with /slug anywhere in the message. */
export function invokedSkillSlugs(content: string, skills: UserSkill[]): string[] {
  const slugs = new Set(skills.map((skill) => skill.slug));
  const found: string[] = [];
  for (const match of content.matchAll(/(?:^|\s)\/([\p{L}\p{N}][\p{L}\p{N}-]*)/gu)) {
    const slug = match[1]!.toLowerCase();
    if (slugs.has(slug) && !found.includes(slug)) found.push(slug);
  }
  return found;
}

export type SkillSelection = {
  skill: UserSkill;
  reason: "invoked" | "armed" | "always" | "matched";
};

/** Installed skills plus skill-library entries (no import required). */
function skillsAvailableForMatching(): UserSkill[] {
  const installed = readSkills().filter((skill) => skill.enabled);
  const installedSlugs = new Set(installed.map((skill) => skill.slug));
  const library = catalogAsVirtualSkills().filter((skill) => !installedSlugs.has(skill.slug));
  return [...installed, ...library];
}

export function selectSkillsForMessage(content: string): SkillSelection[] {
  const skills = skillsAvailableForMatching();
  if (!skills.length) return [];
  const picked = new Map<string, SkillSelection>();
  const add = (skill: UserSkill, reason: SkillSelection["reason"]) => {
    if (!picked.has(skill.id)) picked.set(skill.id, { skill, reason });
  };
  for (const slug of invokedSkillSlugs(content, skills)) {
    const skill = skills.find((item) => item.slug === slug);
    if (skill) add(skill, "invoked");
  }
  const armed = readArmedSkillIds();
  for (const id of armed) {
    const skill = skills.find((item) => item.id === id);
    if (skill) add(skill, "armed");
  }
  for (const skill of skills) if (skill.mode === "always") add(skill, "always");
  const words = tokens(content.replace(/(?:^|\s)\/[\p{L}\p{N}][\p{L}\p{N}-]*/gu, " "));
  skills
    .filter((skill) => skill.mode === "auto" && !picked.has(skill.id))
    .map((skill) => ({ skill, score: relevance(skill, words) }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .forEach((item) => add(item.skill, "matched"));
  return [...picked.values()].slice(0, 6);
}

export type SkillContext = {
  selections: SkillSelection[];
  block: string;
  payload: Array<{ name: string; slug: string; instructions: string }>;
};

/** Build the system block for the skills that apply to this message. */
export function buildSkillContext(content: string, budget = 14_000): SkillContext {
  const selections = selectSkillsForMessage(content);
  if (!selections.length) return { selections, block: "", payload: [] };

  let remaining = budget;
  const sections = selections.map(({ skill }, index) => {
    const reserve = 700 * (selections.length - index - 1);
    const room = Math.max(600, remaining - reserve);
    const head = [
      `### Skill: ${skill.name} (/${skill.slug})`,
      skill.description ? `When to use: ${skill.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const body = skill.instructions.trim().slice(0, Math.max(200, room - head.length - 4));
    const text = `${head}\n${body}`;
    remaining -= text.length;
    return { skill, text, refs: [] as string[] };
  });

  for (const section of sections) {
    const selection = selections.find((item) => item.skill.id === section.skill.id)!;
    if (selection.reason !== "invoked" && selection.reason !== "armed") continue;
    for (const resource of section.skill.resources) {
      if (remaining < 400) break;
      const header = `\n--- Reference: ${resource.path} ---\n`;
      const chunk = resource.content.slice(0, remaining - header.length);
      section.refs.push(`${header}${chunk}`);
      remaining -= header.length + chunk.length;
    }
  }

  const payload = sections.map((section) => ({
    name: section.skill.name,
    slug: section.skill.slug,
    instructions: `${section.text}${section.refs.join("")}`,
  }));
  const block = [
    "ACTIVE SKILLS — reusable instructions the user installed. Apply every skill below to this reply.",
    "Follow their steps and output formats. If a skill conflicts with safety rules, safety wins.",
    "",
    payload.map((item) => item.instructions).join("\n\n"),
  ].join("\n");
  return { selections, block, payload };
}

type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

/** Inject skills into an Ollama chat request (local models). */
export function applySkillsToChatMessages<T extends ChatTurn>(messages: T[]): T[] {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return messages;
  const context = buildSkillContext(lastUser.content, 10_000);
  if (!context.block) return messages;
  markSkillsUsed(context.selections.map((item) => item.skill.id).filter((id) => !id.startsWith("lib:")));
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    return messages.map((message, index) =>
      index === systemIndex ? { ...message, content: `${message.content}\n\n${context.block}` } : message,
    );
  }
  return [{ role: "system", content: context.block } as T, ...messages];
}

const LIBRARY_BUDGET = 500_000;

/**
 * Claude-style library: every skill the model may load on its own (Auto) plus
 * the ones already active this turn, with bundled files for read_skill_file.
 * Skill-library catalog entries are included automatically — no import needed.
 */
export function buildSkillLibrary(activeIds: string[] = []): SkillLibraryEntry[] {
  const installed = readSkills().filter(
    (skill) => skill.enabled && (skill.mode !== "manual" || activeIds.includes(skill.id)),
  );
  const installedSlugs = new Set(installed.map((skill) => skill.slug));
  const library = catalogAsVirtualSkills().filter((skill) => !installedSlugs.has(skill.slug));
  const skills = [...installed, ...library];
  const ordered = [
    ...skills.filter((skill) => activeIds.includes(skill.id)),
    ...skills.filter((skill) => !activeIds.includes(skill.id)),
  ].slice(0, 40);
  let remaining = LIBRARY_BUDGET;
  return ordered.map((skill) => {
    const instructions = skill.instructions.slice(0, Math.max(2_000, Math.min(40_000, remaining)));
    remaining -= instructions.length + skill.description.length;
    const files: SkillResource[] = [];
    for (const resource of skill.resources) {
      if (remaining < 2_000) break;
      const content = resource.content.slice(0, Math.min(120_000, remaining));
      remaining -= content.length;
      files.push({ path: resource.path, content });
    }
    return {
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      instructions,
      active: activeIds.includes(skill.id),
      files,
      installedPath: installedSkillPath(skill),
    };
  });
}

/** Attach skills to a cloud message: active skills, the Claude-style library, and a rules fallback. */
export function applySkillsToSendBody(body: SendMessageRequest): SendMessageRequest {
  if (body.skills?.length || body.skillLibrary?.length) return body;
  const context = buildSkillContext(body.content);
  const activeIds = context.selections.map((item) => item.skill.id);
  const skillLibrary = buildSkillLibrary(activeIds);
  if (!context.block && !skillLibrary.length) return body;
  if (activeIds.length) markSkillsUsed(activeIds.filter((id) => !id.startsWith("lib:")));
  if (!context.block) return { ...body, skillLibrary };
  const fallback = `${SKILLS_RULES_OPEN}\n${context.block.slice(0, 3000)}\n${SKILLS_RULES_CLOSE}`;
  const hint: WorkspaceHint = body.workspaceHint ?? { kind: "none" };
  return {
    ...body,
    skills: context.payload.map(({ name, instructions }) => ({ name, instructions })),
    skillLibrary,
    workspaceHint: {
      ...hint,
      workspaceRules: hint.workspaceRules ? `${hint.workspaceRules}\n\n${fallback}` : fallback,
    },
  };
}

/* ---------------- Install skill files on disk (scripts can run) ---------------- */

const installed = new Map<string, { stamp: string; path: string }>();
let deskRoot: string | null = null;
let syncTimer: number | null = null;
let syncing = false;

const isScriptPath = (path: string) => /\.(py|sh|bash|zsh|js|cjs|mjs|ts|rb)$/i.test(path);

export function skillHasScripts(skill: UserSkill): boolean {
  return skill.resources.some((resource) => isScriptPath(resource.path));
}

function diskPartition(): string {
  return partition().replace(/[^A-Za-z0-9._-]/g, "_");
}

function installKey(skill: UserSkill) {
  return `${diskPartition()}/${skill.slug}`;
}

/** Absolute folder of an installed skill, or null before the first sync / outside the desktop app. */
export function installedSkillPath(skill: UserSkill): string | null {
  return installed.get(installKey(skill))?.path ?? null;
}

async function syncSkillsToDisk() {
  if (!isTauriRuntime() || syncing) return;
  syncing = true;
  try {
    deskRoot ??= await invoke<string>("ensure_assistant_desk");
    const base = `.arrab-skills/${diskPartition()}`;
    let wrote = false;
    for (const skill of readSkills()) {
      const key = installKey(skill);
      const stamp = `${skill.id}:${skill.updatedAt}`;
      if (installed.get(key)?.stamp === stamp) continue;
      const folder = `${base}/${skill.slug}`;
      const files = [
        { path: "SKILL.md", content: exportSkillMarkdown(skill) },
        ...skill.resources.filter((resource) => !/(^|\/)\.\.(\/|$)/.test(resource.path)),
      ];
      for (const file of files) {
        await invoke("write_text_file", {
          root: deskRoot,
          relative: `${folder}/${file.path}`,
          content: file.content,
        });
      }
      installed.set(key, { stamp, path: `${deskRoot.replace(/\/+$/, "")}/${folder}` });
      wrote = true;
    }
    if (wrote) emit();
  } catch {
    // Disk install is best-effort; skills still work as instructions without it.
  } finally {
    syncing = false;
  }
}

function scheduleSkillSync() {
  if (!isTauriRuntime()) return;
  if (syncTimer != null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    if (syncing) scheduleSkillSync();
    else void syncSkillsToDisk();
  }, 600);
}

if (typeof window !== "undefined") {
  window.addEventListener(SKILLS_EVENT, scheduleSkillSync);
  window.addEventListener(ACCOUNT_EVENT, scheduleSkillSync);
  window.addEventListener(FAMILY_EVENT, scheduleSkillSync);
  scheduleSkillSync();
}

/* ---------------- Skill library catalog (auto-available to companions & chat) ---------------- */

export type ClaudeCatalogSkill = {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  path: string;
  files: number;
  hasScripts: boolean;
};

export const CLAUDE_SKILLS_REPO = { owner: "anthropics", repo: "skills", ref: "main" } as const;
const CATALOG_CACHE_KEY = "arrab.skills.claudeCatalog.v2";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
/** Hide vendor-branded catalog rows from the UI and from auto-use. */
const VENDOR_BRANDED = /\b(claude|anthropic)\b/i;
let catalogMemory: ClaudeCatalogSkill[] | null = null;
let catalogWarm: Promise<ClaudeCatalogSkill[]> | null = null;

function isPublicLibrarySkill(item: Pick<ClaudeCatalogSkill, "slug" | "name" | "description">) {
  return !VENDOR_BRANDED.test(`${item.slug} ${item.name} ${item.description}`);
}

function catalogAsVirtualSkills(): UserSkill[] {
  const items = (catalogMemory ?? readCachedSkillCatalog()).filter(isPublicLibrarySkill);
  return items
    .filter((item) => item.instructions.trim().length > 40)
    .map((item) => ({
      id: `lib:${item.slug}`,
      name: item.name,
      slug: item.slug,
      description: item.description,
      instructions: item.instructions,
      mode: "auto" as const,
      enabled: true,
      source: "imported" as const,
      origin: "Skill library",
      tags: [],
      resources: [],
      uses: 0,
      createdAt: "",
      updatedAt: "",
      lastUsedAt: null,
    }));
}

function readCachedSkillCatalog(): ClaudeCatalogSkill[] {
  if (catalogMemory?.length) return catalogMemory;
  try {
    const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null") as {
      at: number;
      items: ClaudeCatalogSkill[];
    } | null;
    if (cached?.items?.length) {
      catalogMemory = cached.items;
      return cached.items;
    }
  } catch {
    // Ignore corrupt cache.
  }
  return [];
}

/** Warm the skill-library cache so companions can use skills without importing. */
export async function ensureSkillCatalogWarm(force = false): Promise<ClaudeCatalogSkill[]> {
  if (!force) {
    const cached = readCachedSkillCatalog();
    if (cached.some((item) => item.instructions?.trim())) return cached;
  }
  if (catalogWarm && !force) return catalogWarm;
  catalogWarm = fetchClaudeSkillCatalog(force).finally(() => {
    catalogWarm = null;
  });
  return catalogWarm;
}

export async function fetchClaudeSkillCatalog(force = false): Promise<ClaudeCatalogSkill[]> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || "null") as {
        at: number;
        items: ClaudeCatalogSkill[];
      } | null;
      if (
        cached &&
        Date.now() - cached.at < CATALOG_TTL_MS &&
        cached.items.length &&
        cached.items.some((item) => item.instructions?.trim())
      ) {
        catalogMemory = cached.items;
        return cached.items;
      }
    } catch {
      // Refetch below.
    }
  }
  const { owner, repo, ref } = CLAUDE_SKILLS_REPO;
  const tree = await fetchGithubJson<{ tree: Array<{ path: string; type: string }> }>(
    `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
  );
  const blobs = tree.tree.filter((item) => item.type === "blob");
  const dirs = blobs
    .filter((item) => isSkillFile(item.path) && item.path.startsWith("skills/"))
    .map((item) => dirname(item.path));
  const items: ClaudeCatalogSkill[] = [];
  for (let i = 0; i < dirs.length; i += 6) {
    const batch = dirs.slice(i, i + 6);
    const texts = await Promise.all(
      batch.map((dir) =>
        fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodePath(dir)}/SKILL.md`).catch(
          () => null,
        ),
      ),
    );
    batch.forEach((dir, index) => {
      const text = texts[index];
      const draft = text ? parseSkillMarkdown(text, basename(dir)) : null;
      const inside = blobs.filter((item) => inDir(item.path, dir) && !isSkillFile(item.path));
      items.push({
        slug: draft?.slug || slugifySkill(basename(dir)),
        name: draft?.name || humanizeName(basename(dir)),
        description: draft?.description || "",
        instructions: draft?.instructions?.slice(0, SKILL_LIMITS.instructions) || "",
        path: dir,
        files: inside.length,
        hasScripts: inside.some((item) => isScriptPath(item.path)),
      });
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  catalogMemory = items;
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
  } catch {
    // Cache is optional — keep the in-memory copy for this session.
  }
  return items;
}

export async function installClaudeSkill(item: ClaudeCatalogSkill): Promise<SkillImportResult> {
  const { owner, repo, ref } = CLAUDE_SKILLS_REPO;
  try {
    return await importGithubTree(owner, repo, ref, item.path);
  } catch (error: unknown) {
    return {
      added: [],
      updated: [],
      errors: [error instanceof Error ? error.message : "Install failed."],
    };
  }
}

/* ---------------- Starter skills ---------------- */

export type StarterSkill = SkillDraft & { nameAr: string; descriptionAr: string; icon: string };

export const STARTER_SKILLS: StarterSkill[] = [
  {
    slug: "polished-writer",
    name: "Polished writer",
    nameAr: "كاتب محترف",
    icon: "pen",
    description: "Rewrite or edit text so it is clear, concise, and professional.",
    descriptionAr: "يعيد صياغة النص ليكون واضحًا وموجزًا واحترافيًا.",
    mode: "auto",
    tags: ["writing", "edit", "rewrite", "proofread"],
    instructions: [
      "When the user asks you to write, rewrite, edit, or proofread:",
      "1. Keep the author's meaning and voice; fix grammar, flow, and structure.",
      "2. Prefer short sentences, active voice, and concrete words. Cut filler.",
      "3. Match the language of the source text (Arabic stays Arabic).",
      "4. Return the improved text first. Then list at most 3 key changes as bullets.",
      "5. If the goal or audience is unclear, make a sensible assumption and state it in one line.",
    ].join("\n"),
  },
  {
    slug: "code-reviewer",
    name: "Code reviewer",
    nameAr: "مراجع الكود",
    icon: "code",
    description: "Review code for bugs, security issues, and readability with concrete fixes.",
    descriptionAr: "يراجع الكود بحثًا عن الأخطاء والثغرات ويقترح إصلاحات محددة.",
    mode: "auto",
    tags: ["code", "review", "bug", "security", "refactor"],
    instructions: [
      "Review the code the user shares like a senior engineer.",
      "Report findings ordered by severity: Bugs → Security → Performance → Readability.",
      "For each finding give: the location, why it matters, and a minimal corrected snippet.",
      "Do not nitpick formatting that a linter would fix. Skip praise and filler.",
      "End with a one-line verdict: ship, ship with fixes, or needs rework.",
    ].join("\n"),
  },
  {
    slug: "meeting-notes",
    name: "Meeting notes",
    nameAr: "ملخص الاجتماعات",
    icon: "notes",
    description: "Turn transcripts or rough notes into decisions, action items, and owners.",
    descriptionAr: "يحوّل محضر الاجتماع إلى قرارات ومهام ومسؤولين.",
    mode: "auto",
    tags: ["meeting", "notes", "summary", "transcript", "minutes"],
    instructions: [
      "Convert the meeting material into this exact structure:",
      "## Summary — 2–3 sentences.",
      "## Decisions — bullets.",
      "## Action items — table with columns: Task | Owner | Due date (use \"—\" if unknown).",
      "## Open questions — bullets.",
      "Never invent owners or dates. Keep names exactly as written.",
    ].join("\n"),
  },
  {
    slug: "email-drafter",
    name: "Email drafter",
    nameAr: "كاتب الرسائل",
    icon: "mail",
    description: "Draft clear, well-toned emails and replies ready to send.",
    descriptionAr: "يكتب رسائل بريد واضحة بنبرة مناسبة وجاهزة للإرسال.",
    mode: "auto",
    tags: ["email", "reply", "message", "outreach"],
    instructions: [
      "Draft the email the user needs.",
      "Output: a Subject line, then the body. Keep it under 150 words unless asked otherwise.",
      "Open with the point, give needed context, and end with one clear ask or next step.",
      "Match the tone the user implies (formal, friendly, firm). Match their language.",
      "Offer one shorter alternative subject line at the end.",
    ].join("\n"),
  },
  {
    slug: "study-tutor",
    name: "Study tutor",
    nameAr: "مدرس خصوصي",
    icon: "study",
    description: "Teach step by step with checks for understanding instead of just answers.",
    descriptionAr: "يشرح خطوة بخطوة ويتأكد من الفهم بدل إعطاء الإجابة مباشرة.",
    mode: "manual",
    tags: ["study", "learn", "homework", "explain", "exam"],
    instructions: [
      "Act as a patient tutor.",
      "Explain the idea in plain language first, then a worked example.",
      "Break problems into steps and ask the learner to try the next step before revealing it.",
      "End each reply with one short practice question.",
      "Adjust difficulty to the learner's answers. Encourage, never condescend.",
    ].join("\n"),
  },
  {
    slug: "translator",
    name: "Arabic ⇄ English translator",
    nameAr: "مترجم عربي ⇄ إنجليزي",
    icon: "translate",
    description: "Translate naturally between Arabic and English, keeping tone and terms.",
    descriptionAr: "يترجم بشكل طبيعي بين العربية والإنجليزية مع الحفاظ على النبرة والمصطلحات.",
    mode: "manual",
    tags: ["translate", "translation", "arabic", "english"],
    instructions: [
      "Translate the user's text between Arabic and English (detect the source automatically).",
      "Translate meaning, not word-for-word. Keep tone, formatting, names, and numbers.",
      "Use Modern Standard Arabic unless the source is clearly a dialect.",
      "Return only the translation. If a term is ambiguous, add one short note after it.",
    ].join("\n"),
  },
  {
    slug: "research-brief",
    name: "Research brief",
    nameAr: "موجز بحثي",
    icon: "research",
    description: "Produce a structured brief with key findings, evidence, and sources.",
    descriptionAr: "ينتج موجزًا منظمًا بالنتائج الرئيسية والأدلة والمصادر.",
    mode: "auto",
    tags: ["research", "brief", "analysis", "report", "sources"],
    instructions: [
      "Write a research brief with these sections:",
      "## Bottom line — the answer in 2 sentences.",
      "## Key findings — 3–6 bullets, each with the supporting evidence.",
      "## Risks & unknowns — bullets.",
      "## Sources — list sources used; mark anything unverified as (unverified).",
      "Separate facts from your own inference. Never fabricate citations.",
    ].join("\n"),
  },
  {
    slug: "product-spec",
    name: "Product spec writer",
    nameAr: "كاتب مواصفات المنتج",
    icon: "spec",
    description: "Turn an idea into a crisp PRD with goals, scope, and acceptance criteria.",
    descriptionAr: "يحوّل الفكرة إلى وثيقة مواصفات واضحة بالأهداف والنطاق ومعايير القبول.",
    mode: "manual",
    tags: ["prd", "spec", "product", "requirements", "feature"],
    instructions: [
      "Write a product spec with: Problem, Goals & non-goals, Users, User stories,",
      "Requirements (must / should / could), Acceptance criteria (testable, numbered),",
      "Success metrics, Open questions.",
      "Be specific and measurable. Flag assumptions explicitly. Keep it to one page when possible.",
    ].join("\n"),
  },
];

export function addStarterSkill(starter: StarterSkill, locale: "en" | "ar"): UserSkill {
  const { nameAr, descriptionAr, icon: _icon, ...draft } = starter;
  const result = addSkills([
    {
      ...draft,
      name: locale === "ar" ? nameAr : draft.name,
      description: locale === "ar" ? descriptionAr : draft.description,
      source: "starter",
      origin: null,
    },
  ]);
  const skill = result.added[0] ?? result.updated[0];
  if (!skill) throw new Error("Could not add that skill.");
  return skill;
}
