/**
 * Second Brain — durable context graph for Individuals + solo chats.
 *
 * Isolation: each signed-in account and each family member gets a
 * separate local partition. Kids never see a parent's graph (or siblings').
 */
import { useSyncExternalStore } from "react";
import type { Message } from "@arrab/shared";
import { readAccountSessionToken, ACCOUNT_EVENT } from "./account-session";
import {
  FAMILY_EVENT,
  isFamilyChild,
  readActiveFamilyMemberId,
} from "./family-session";
import type { CompanionProfile, CompanionSpace, CompanionState } from "./companions";
import { findCompanion, getCompanionState } from "./companions";

const STORE_PREFIX = "arrab.secondBrain.v2";
const LEGACY_STORE_KEY = "arrab.secondBrain.v1";

export type BrainScope = "individual" | "solo";
export type BrainNodeKind =
  | "session"
  | "decision"
  | "file"
  | "project"
  | "companion"
  | "fact"
  | "work";

export type BrainLinkRel =
  | "belongs"
  | "decided"
  | "attached"
  | "mentions"
  | "follows"
  | "owns";

export type BrainNode = {
  id: string;
  kind: BrainNodeKind;
  title: string;
  summary: string;
  scope: BrainScope;
  space: CompanionSpace | "org";
  sourceId: string | null;
  companionId: string | null;
  conversationId: string | null;
  /** Owning family seat — null only when no family profile is active. */
  familyMemberId: string | null;
  /** Family Guardian decision — parent feed, not a chat transcript. */
  guardian?: boolean;
  guardianVerdict?: string | null;
  parentCoaching?: string | null;
  createdAt: string;
  updatedAt: string;
  x: number;
  y: number;
};

export type BrainLink = {
  id: string;
  from: string;
  to: string;
  rel: BrainLinkRel;
};

export type SecondBrainState = {
  version: 1;
  nodes: BrainNode[];
  links: BrainLink[];
};

type Listener = () => void;

const listeners = new Set<Listener>();

function emptyState(): SecondBrainState {
  return { version: 1, nodes: [], links: [] };
}

function hashId(...parts: string[]) {
  const raw = parts.join("::");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `sb_${Math.abs(h).toString(36)}_${raw.length.toString(36)}`;
}

function accountPartition(): string {
  const token = readAccountSessionToken();
  if (!token) return "guest";
  return hashId("acct", token).replace(/^sb_/, "").slice(0, 16);
}

function memberPartition(): string {
  return readActiveFamilyMemberId()?.trim() || "self";
}

export function currentBrainStoreKey(): string {
  return `${STORE_PREFIX}.${accountPartition()}.${memberPartition()}`;
}

function readRawFrom(key: string): SecondBrainState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SecondBrainState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return emptyState();
    return {
      version: 1,
      nodes: (parsed.nodes as BrainNode[]).map((node) => ({
        ...node,
        familyMemberId: node.familyMemberId ?? null,
      })),
      links: parsed.links as BrainLink[],
    };
  } catch {
    return emptyState();
  }
}

function activeOwnerId(): string | null {
  return readActiveFamilyMemberId();
}

/** True when this node is safe to show on the active family seat's Brain. */
function nodeVisibleOnActiveSeat(node: BrainNode): boolean {
  const owner = activeOwnerId();
  if (!owner) return true;
  if (isFamilyChild()) {
    // Kids: only their own stamped data — never null/legacy household bleed,
    // parent guidance facts, or Guardian parent-feed decisions.
    if (node.familyMemberId !== owner) return false;
    if (node.guardian) return false;
    if (node.kind === "fact" && /parent guidance/i.test(node.summary || "")) return false;
    return true;
  }
  if (node.familyMemberId && node.familyMemberId !== owner) return false;
  return true;
}

/** Companions owned by the active family seat (strict — no cross-member bleed). */
export function companionsForActiveBrain(
  companions: CompanionProfile[],
): CompanionProfile[] {
  const owner = activeOwnerId();
  if (!owner) return companions.filter((person) => !person.archivedAt);
  const child = isFamilyChild();
  return companions.filter((person) => {
    if (person.archivedAt) return false;
    if (person.familyMemberId === owner) return true;
    // Legacy unowned companions stay on parent/manager seats only — never kids.
    return !person.familyMemberId && !child;
  });
}

function resolveOwnerId(companionId: string | null | undefined): string | null {
  if (companionId) {
    const person = findCompanion(getCompanionState(), companionId);
    if (person?.familyMemberId) return person.familyMemberId;
  }
  return activeOwnerId();
}

let activeKey = currentBrainStoreKey();
let cache = readRawFrom(activeKey);

function emit() {
  listeners.forEach((fn) => fn());
}

/** Switch partition when account or family seat changes. */
export function ensureBrainPartition(): void {
  const next = currentBrainStoreKey();
  if (next === activeKey) return;
  activeKey = next;
  cache = readRawFrom(activeKey);
  emit();
}

function writeState(next: SecondBrainState) {
  ensureBrainPartition();
  cache = next;
  localStorage.setItem(activeKey, JSON.stringify(next));
  emit();
}

function mutate(fn: (draft: SecondBrainState) => void) {
  ensureBrainPartition();
  const draft: SecondBrainState = {
    version: 1,
    nodes: cache.nodes.map((n) => ({ ...n })),
    links: cache.links.map((l) => ({ ...l })),
  };
  fn(draft);
  writeState(draft);
}

export function getSecondBrain(): SecondBrainState {
  ensureBrainPartition();
  return cache;
}

export function subscribeSecondBrain(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSecondBrain(): SecondBrainState {
  return useSyncExternalStore(subscribeSecondBrain, getSecondBrain, getSecondBrain);
}

/** Wipe every brain partition on this device (sign-out / settings clear). */
export function clearAllBrainPartitions(): void {
  const remove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (
      key &&
      (key === LEGACY_STORE_KEY || key.startsWith(`${STORE_PREFIX}.`))
    ) {
      remove.push(key);
    }
  }
  for (const key of remove) localStorage.removeItem(key);
  activeKey = currentBrainStoreKey();
  cache = emptyState();
  emit();
}

function bindPartitionWatchers() {
  if (typeof window === "undefined") return;
  const reload = () => ensureBrainPartition();
  window.addEventListener(FAMILY_EVENT, reload);
  window.addEventListener(ACCOUNT_EVENT, reload);
  window.addEventListener("storage", reload);
}

bindPartitionWatchers();

function nowIso() {
  return new Date().toISOString();
}

function placeNear(kind: BrainNodeKind, seed: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) | 0;
  const ring =
    kind === "project" || kind === "companion"
      ? 0.22
      : kind === "session"
        ? 0.42
        : kind === "decision" || kind === "work"
          ? 0.58
          : 0.72;
  const angle = ((h % 360) / 360) * Math.PI * 2;
  const jitter = ((h >> 8) % 40) / 400;
  return {
    x: 0.5 + Math.cos(angle) * (ring + jitter),
    y: 0.5 + Math.sin(angle) * (ring + jitter),
  };
}

function upsertNode(
  draft: SecondBrainState,
  input: Omit<BrainNode, "x" | "y" | "createdAt" | "updatedAt"> & {
    x?: number;
    y?: number;
    createdAt?: string;
  },
): BrainNode {
  const existing = draft.nodes.find((n) => n.id === input.id);
  if (existing) {
    existing.title = input.title;
    existing.summary = input.summary;
    existing.scope = input.scope;
    existing.space = input.space;
    existing.sourceId = input.sourceId;
    existing.companionId = input.companionId;
    existing.conversationId = input.conversationId;
    existing.familyMemberId = input.familyMemberId;
    existing.kind = input.kind;
    if (input.guardian != null) existing.guardian = input.guardian;
    if (input.guardianVerdict !== undefined) existing.guardianVerdict = input.guardianVerdict;
    if (input.parentCoaching !== undefined) existing.parentCoaching = input.parentCoaching;
    existing.updatedAt = nowIso();
    return existing;
  }
  const pos = input.x != null && input.y != null ? { x: input.x, y: input.y } : placeNear(input.kind, input.id);
  const node: BrainNode = {
    ...input,
    ...pos,
    createdAt: input.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  draft.nodes.push(node);
  return node;
}

function ensureLink(
  draft: SecondBrainState,
  from: string,
  to: string,
  rel: BrainLinkRel,
) {
  if (from === to) return;
  const id = hashId("link", from, to, rel);
  if (draft.links.some((l) => l.id === id || (l.from === from && l.to === to && l.rel === rel))) {
    return;
  }
  draft.links.push({ id, from, to, rel });
}

const DECISION_RE =
  /\b(decid(?:e|ed|ing)|we'll|we will|let'?s|agreed|going with|chose|choose|قرار|قررن[اا]|سن[اا]|اتفقنا|اخترن[اا])\b/i;
const FILE_RE =
  /(?:^|[\s(])([a-zA-Z0-9_\-./]+\.(?:pdf|png|jpe?g|gif|webp|svg|md|txt|csv|json|ts|tsx|js|jsx|py|rs|go|docx?|xlsx?|pptx?|zip))\b/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function extractDecisions(text: string): string[] {
  const lines = text
    .split(/\n|(?<=[.!?؟])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 12 && line.length < 220 && DECISION_RE.test(line));
  return [...new Set(lines)].slice(0, 4);
}

export function extractFiles(text: string): { name: string; ref: string }[] {
  const found: { name: string; ref: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const name = match[1]?.trim() || match[2] || "file";
    const ref = match[2] || name;
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name: name.slice(0, 80), ref: ref.slice(0, 200) });
  }
  for (const match of text.matchAll(FILE_RE)) {
    const name = match[1];
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name: name.slice(0, 80), ref: name.slice(0, 200) });
  }
  return found.slice(0, 6);
}

function projectTitleFrom(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled project";
  return cleaned.slice(0, 48);
}

/** Seed / refresh graph from companion facts, work, threads — active seat only. */
export function syncBrainFromCompanions(state: CompanionState): void {
  const visible = companionsForActiveBrain(state.companions);
  const allowedIds = new Set(visible.map((person) => person.id));
  const owner = activeOwnerId();
  const child = isFamilyChild();

  mutate((draft) => {
    // Drop household / other-seat / parent-feed bleed from a kid partition.
    if (child && owner) {
      const keep = new Set<string>();
      draft.nodes = draft.nodes.filter((node) => {
        const ok = nodeVisibleOnActiveSeat(node);
        if (ok) keep.add(node.id);
        return ok;
      });
      draft.links = draft.links.filter((link) => keep.has(link.from) && keep.has(link.to));
    }

    for (const person of visible) {
      const companionNode = upsertNode(draft, {
        id: hashId("companion", person.id, owner ?? "self"),
        kind: "companion",
        title: person.name,
        summary: person.brief?.slice(0, 160) || person.lastMemory || person.domain,
        scope: "individual",
        space: person.space,
        sourceId: person.id,
        companionId: person.id,
        conversationId: person.conversationId,
        familyMemberId: person.familyMemberId ?? owner,
      });

      if (person.conversationId) {
        const session = upsertNode(draft, {
          id: hashId("session", "individual", person.conversationId, owner ?? "self"),
          kind: "session",
          title: person.resume?.slice(0, 48) || `${person.name} session`,
          summary: person.lastLine?.slice(0, 160) || person.lastMemory || "",
          scope: "individual",
          space: person.space,
          sourceId: person.conversationId,
          companionId: person.id,
          conversationId: person.conversationId,
          familyMemberId: person.familyMemberId ?? owner,
        });
        ensureLink(draft, session.id, companionNode.id, "belongs");
      }
    }

    for (const fact of state.facts.slice(0, 80)) {
      if (fact.companionId && !allowedIds.has(fact.companionId)) continue;
      if (!fact.companionId && owner) continue;
      // Private parent notes never appear on a kid's Brain map.
      if (child && fact.kind === "parent_guidance") continue;
      const node = upsertNode(draft, {
        id: hashId("fact", fact.id, owner ?? "self"),
        kind: "fact",
        title: fact.text.slice(0, 56),
        summary: `${fact.source} · ${fact.kind}`,
        scope: "individual",
        space: fact.space,
        sourceId: fact.id,
        companionId: fact.companionId,
        conversationId: null,
        familyMemberId: resolveOwnerId(fact.companionId) ?? owner,
      });
      if (fact.companionId) {
        ensureLink(draft, node.id, hashId("companion", fact.companionId, owner ?? "self"), "mentions");
      }
    }

    for (const work of state.work.filter((item) => item.state !== "declined").slice(0, 60)) {
      if (work.companionId && !allowedIds.has(work.companionId)) continue;
      if (!work.companionId && owner) continue;
      const node = upsertNode(draft, {
        id: hashId("work", work.id, owner ?? "self"),
        kind: "work",
        title: work.text.slice(0, 56),
        summary: `${work.state}${work.suggestedTime ? ` · ${work.suggestedTime.slice(0, 16)}` : ""}`,
        scope: "individual",
        space: work.space,
        sourceId: work.id,
        companionId: work.companionId,
        conversationId: null,
        familyMemberId: resolveOwnerId(work.companionId) ?? owner,
      });
      if (work.companionId) {
        ensureLink(draft, node.id, hashId("companion", work.companionId, owner ?? "self"), "owns");
      }
    }

    for (const thread of state.threads.filter((item) => !item.archived).slice(0, 40)) {
      if (thread.companionId && !allowedIds.has(thread.companionId)) continue;
      if (!thread.companionId && owner) continue;
      const project = upsertNode(draft, {
        id: hashId("project", thread.id, owner ?? "self"),
        kind: "project",
        title: thread.title.slice(0, 56),
        summary: thread.open || thread.summary.slice(0, 160),
        scope: "individual",
        space: thread.space,
        sourceId: thread.id,
        companionId: thread.companionId,
        conversationId: null,
        familyMemberId: resolveOwnerId(thread.companionId) ?? owner,
      });
      if (thread.companionId) {
        ensureLink(draft, project.id, hashId("companion", thread.companionId, owner ?? "self"), "belongs");
      }
    }
  });
}

export type IngestTurnInput = {
  scope: BrainScope;
  space: CompanionSpace | "org";
  companionId: string | null;
  companionName: string;
  conversationId: string | null;
  userText: string;
  assistantText: string;
  familyMemberId?: string | null;
};

/** Analyze one chat turn and grow the connected map (active seat partition only). */
export function ingestBrainTurn(input: IngestTurnInput): void {
  const blob = `${input.userText}\n${input.assistantText}`.trim();
  if (blob.length < 8) return;

  const active = activeOwnerId();
  const child = isFamilyChild();
  let owner = input.familyMemberId ?? resolveOwnerId(input.companionId);
  // Kid partitions only accept their own seat-stamped turns.
  if (child && active) {
    if (owner && owner !== active) return;
    owner = active;
  }
  if (active && owner && owner !== active) return;
  if (active && input.companionId) {
    const person = findCompanion(getCompanionState(), input.companionId);
    if (person && person.familyMemberId && person.familyMemberId !== active) return;
    // Kids never ingest unowned / household companions.
    if (child && person && person.familyMemberId !== active) return;
  }
  if (child && input.companionId) {
    const person = findCompanion(getCompanionState(), input.companionId);
    if (!person || person.familyMemberId !== active) return;
  }

  mutate((draft) => {
    const companionKey = input.companionId
      ? hashId(input.scope === "solo" ? "solo-agent" : "companion", input.companionId, owner ?? "self")
      : null;

    if (companionKey && input.companionId) {
      upsertNode(draft, {
        id: companionKey,
        kind: "companion",
        title: input.companionName,
        summary: input.scope === "solo" ? "Solo agent" : "Companion",
        scope: input.scope,
        space: input.space,
        sourceId: input.companionId,
        companionId: input.companionId,
        conversationId: input.conversationId,
        familyMemberId: owner,
      });
    }

    const sessionId = input.conversationId
      ? hashId("session", input.scope, input.conversationId, owner ?? "self")
      : hashId(
          "session",
          input.scope,
          input.companionId ?? "open",
          owner ?? "self",
          input.userText.slice(0, 24),
        );

    const session = upsertNode(draft, {
      id: sessionId,
      kind: "session",
      title: projectTitleFrom(input.userText),
      summary: input.assistantText.slice(0, 180),
      scope: input.scope,
      space: input.space,
      sourceId: input.conversationId,
      companionId: input.companionId,
      conversationId: input.conversationId,
      familyMemberId: owner,
    });

    if (companionKey) ensureLink(draft, session.id, companionKey, "belongs");

    const project = upsertNode(draft, {
      id: hashId("project", input.scope, owner ?? "self", session.title.toLowerCase()),
      kind: "project",
      title: session.title,
      summary: session.summary,
      scope: input.scope,
      space: input.space,
      sourceId: session.id,
      companionId: input.companionId,
      conversationId: input.conversationId,
      familyMemberId: owner,
    });
    ensureLink(draft, session.id, project.id, "follows");

    for (const decision of extractDecisions(blob)) {
      const node = upsertNode(draft, {
        id: hashId("decision", session.id, decision.slice(0, 40)),
        kind: "decision",
        title: decision.slice(0, 72),
        summary: `From ${input.companionName}`,
        scope: input.scope,
        space: input.space,
        sourceId: session.id,
        companionId: input.companionId,
        conversationId: input.conversationId,
        familyMemberId: owner,
      });
      ensureLink(draft, node.id, session.id, "decided");
      ensureLink(draft, node.id, project.id, "belongs");
    }

    for (const file of extractFiles(blob)) {
      const node = upsertNode(draft, {
        id: hashId("file", owner ?? "self", file.ref.toLowerCase()),
        kind: "file",
        title: file.name,
        summary: file.ref,
        scope: input.scope,
        space: input.space,
        sourceId: file.ref,
        companionId: input.companionId,
        conversationId: input.conversationId,
        familyMemberId: owner,
      });
      ensureLink(draft, node.id, session.id, "attached");
      ensureLink(draft, node.id, project.id, "attached");
    }
  });
}

/** Ingest a full solo (or individual) message list once. */
export function ingestBrainMessages(input: {
  scope: BrainScope;
  space: CompanionSpace | "org";
  companionId: string | null;
  companionName: string;
  conversationId: string | null;
  messages: Array<Pick<Message, "role" | "content">>;
  familyMemberId?: string | null;
}): void {
  const usable = input.messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  for (let i = 0; i < usable.length - 1; i++) {
    const user = usable[i];
    const assistant = usable[i + 1];
    if (!user || !assistant) continue;
    if (user.role !== "user" || assistant.role !== "assistant") continue;
    ingestBrainTurn({
      scope: input.scope,
      space: input.space,
      companionId: input.companionId,
      companionName: input.companionName,
      conversationId: input.conversationId,
      userText: user.content,
      assistantText: assistant.content,
      familyMemberId: input.familyMemberId,
    });
  }
}

export function brainNodesForScope(
  state: SecondBrainState,
  scope: BrainScope,
  space?: CompanionSpace | "org" | "all",
): BrainNode[] {
  return state.nodes.filter((node) => {
    if (node.scope !== scope) return false;
    if (!nodeVisibleOnActiveSeat(node)) return false;
    if (!space || space === "all") return true;
    return node.space === space;
  });
}

export function brainLinksForNodes(
  state: SecondBrainState,
  nodes: BrainNode[],
): BrainLink[] {
  const ids = new Set(nodes.map((n) => n.id));
  return state.links.filter((link) => ids.has(link.from) && ids.has(link.to));
}

/** Compact memory block injected into companion / solo agent context. */
export function brainContextSnippet(
  scope: BrainScope,
  companionId: string | null,
  locale: "en" | "ar" = "en",
  limit = 8,
): string {
  ensureBrainPartition();
  const owner = activeOwnerId();
  if (companionId && owner) {
    const person = findCompanion(getCompanionState(), companionId);
    if (person?.familyMemberId && person.familyMemberId !== owner) return "";
  }
  const state = getSecondBrain();
  const related = state.nodes
    .filter(
      (node) =>
        node.scope === scope &&
        nodeVisibleOnActiveSeat(node) &&
        (companionId ? node.companionId === companionId : true) &&
        (node.kind === "decision" ||
          node.kind === "project" ||
          node.kind === "file" ||
          node.kind === "fact"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
  if (!related.length) return "";
  const header =
    locale === "ar"
      ? "الدماغ الثاني (قرارات وملفات ومشاريع مرتبطة — لا تخترع غيرها):"
      : "Second brain (linked decisions, files, projects — do not invent others):";
  return [
    header,
    ...related.map(
      (node) =>
        `- [${node.kind}] ${node.title}${node.summary ? ` — ${node.summary.slice(0, 80)}` : ""}`,
    ),
  ].join("\n");
}

export function moveBrainNode(id: string, x: number, y: number): void {
  mutate((draft) => {
    const node = draft.nodes.find((n) => n.id === id);
    if (!node) return;
    node.x = Math.min(0.96, Math.max(0.04, x));
    node.y = Math.min(0.96, Math.max(0.04, y));
    node.updatedAt = nowIso();
  });
}

export function clearBrainScope(scope: BrainScope): void {
  mutate((draft) => {
    const keep = new Set(
      draft.nodes.filter((n) => n.scope !== scope).map((n) => n.id),
    );
    draft.nodes = draft.nodes.filter((n) => n.scope !== scope);
    draft.links = draft.links.filter((l) => keep.has(l.from) && keep.has(l.to));
  });
}

export const BRAIN_KIND_COLOR: Record<BrainNodeKind, string> = {
  session: "#8ba4b8",
  decision: "#c9a227",
  file: "#9b8ec4",
  project: "#5f9e86",
  companion: "#c4848f",
  fact: "#7f8db8",
  work: "#b8895d",
};

/** Persist a Guardian decision into the child's Brain partition (parent decision feed). */
export function logGuardianDecision(input: {
  companionId: string;
  companionName: string;
  childMemberId: string | null;
  space: CompanionSpace | "org";
  decision: {
    verdict: string;
    reason: string;
    reasonAr: string;
    parentCoaching?: string;
    parentCoachingAr?: string;
    hard: boolean;
  };
  kidMessagePreview: string;
}): void {
  const owner = input.childMemberId ?? activeOwnerId();
  const locale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
  const reason = locale === "ar" ? input.decision.reasonAr : input.decision.reason;
  const coaching =
    locale === "ar"
      ? input.decision.parentCoachingAr || input.decision.parentCoaching || null
      : input.decision.parentCoaching || input.decision.parentCoachingAr || null;

  mutate((draft) => {
    const id = hashId(
      "guardian",
      owner ?? "self",
      input.companionId,
      input.decision.verdict,
      String(Date.now()),
    );
    const node = upsertNode(draft, {
      id,
      kind: "decision",
      title: `Guardian · ${input.decision.verdict}`,
      summary: reason.slice(0, 220),
      scope: "individual",
      space: input.space === "org" ? "personal" : input.space,
      sourceId: `guardian:${input.decision.verdict}`,
      companionId: input.companionId,
      conversationId: null,
      familyMemberId: owner,
      guardian: true,
      guardianVerdict: input.decision.verdict,
      parentCoaching: coaching,
    });
    const companionKey = hashId("companion", input.companionId, owner ?? "self");
    if (draft.nodes.some((n) => n.id === companionKey)) {
      ensureLink(draft, node.id, companionKey, "decided");
    }
  });
}

/** Parent decision feed — Guardian nodes for one child seat. */
export function guardianDecisionsForMember(
  childMemberId: string,
  limit = 20,
): BrainNode[] {
  ensureBrainPartition();
  // Read across partitions: temporarily not needed if parent is viewing while
  // switched to their own seat — store also under child id via familyMemberId
  // inside the active partition when events fire on the kid seat.
  // For parent view, scan all v2 keys for this member.
  const collected: BrainNode[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(`${STORE_PREFIX}.`)) continue;
      if (!key.endsWith(`.${childMemberId}`)) continue;
      const state = readRawFrom(key);
      for (const node of state.nodes) {
        if (node.guardian && node.familyMemberId === childMemberId) {
          collected.push(node);
        }
      }
    }
  } catch {
    /* ignore */
  }
  // Also include any guardian nodes already in the active cache (same member).
  for (const node of cache.nodes) {
    if (node.guardian && node.familyMemberId === childMemberId) {
      if (!collected.some((n) => n.id === node.id)) collected.push(node);
    }
  }
  return collected
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

const KIND_RING: Record<BrainNodeKind, number> = {
  companion: 0.18,
  project: 0.28,
  session: 0.44,
  decision: 0.58,
  work: 0.58,
  fact: 0.7,
  file: 0.78,
};

/** Spread nodes into clean concentric rings (call after bulk ingest). */
export function relayoutBrainScope(scope: BrainScope, space?: CompanionSpace | "org" | "all"): void {
  mutate((draft) => {
    const targets = draft.nodes.filter((node) => {
      if (node.scope !== scope) return false;
      if (!nodeVisibleOnActiveSeat(node)) return false;
      if (!space || space === "all") return true;
      return node.space === space;
    });
    const byKind = new Map<BrainNodeKind, BrainNode[]>();
    for (const node of targets) {
      const list = byKind.get(node.kind) ?? [];
      list.push(node);
      byKind.set(node.kind, list);
    }
    for (const [kind, list] of byKind) {
      const ring = KIND_RING[kind];
      list.forEach((node, index) => {
        const angle = (index / Math.max(list.length, 1)) * Math.PI * 2;
        node.x = 0.5 + Math.cos(angle) * ring;
        node.y = 0.5 + Math.sin(angle) * ring;
      });
    }
  });
}
