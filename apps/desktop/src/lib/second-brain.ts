/**
 * Second Brain — durable context graph for Individuals + solo chats.
 *
 * Chats no longer start from zero: sessions, decisions, and shared files
 * land as nodes on a connected map so companions (and solo agents) keep
 * the shape of a person's life and work.
 */
import { useSyncExternalStore } from "react";
import type { Message } from "@arrab/shared";
import type { CompanionSpace, CompanionState } from "./companions";

const STORE_KEY = "arrab.secondBrain.v1";

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

function readRaw(): SecondBrainState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SecondBrainState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return emptyState();
    return {
      version: 1,
      nodes: parsed.nodes as BrainNode[],
      links: parsed.links as BrainLink[],
    };
  } catch {
    return emptyState();
  }
}

let cache = readRaw();

function writeState(next: SecondBrainState) {
  cache = next;
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

function mutate(fn: (draft: SecondBrainState) => void) {
  const draft: SecondBrainState = {
    version: 1,
    nodes: cache.nodes.map((n) => ({ ...n })),
    links: cache.links.map((l) => ({ ...l })),
  };
  fn(draft);
  writeState(draft);
}

export function getSecondBrain(): SecondBrainState {
  return cache;
}

export function subscribeSecondBrain(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSecondBrain(): SecondBrainState {
  return useSyncExternalStore(subscribeSecondBrain, getSecondBrain, getSecondBrain);
}

function nowIso() {
  return new Date().toISOString();
}

function hashId(...parts: string[]) {
  const raw = parts.join("::");
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `sb_${Math.abs(h).toString(36)}_${raw.length.toString(36)}`;
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
    existing.kind = input.kind;
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

/** Seed / refresh graph from companion facts, work, threads, and people. */
export function syncBrainFromCompanions(state: CompanionState): void {
  mutate((draft) => {
    for (const person of state.companions) {
      if (person.archivedAt) continue;
      const companionNode = upsertNode(draft, {
        id: hashId("companion", person.id),
        kind: "companion",
        title: person.name,
        summary: person.brief?.slice(0, 160) || person.lastMemory || person.domain,
        scope: "individual",
        space: person.space,
        sourceId: person.id,
        companionId: person.id,
        conversationId: person.conversationId,
      });

      if (person.conversationId) {
        const session = upsertNode(draft, {
          id: hashId("session", "individual", person.conversationId),
          kind: "session",
          title: person.resume?.slice(0, 48) || `${person.name} session`,
          summary: person.lastLine?.slice(0, 160) || person.lastMemory || "",
          scope: "individual",
          space: person.space,
          sourceId: person.conversationId,
          companionId: person.id,
          conversationId: person.conversationId,
        });
        ensureLink(draft, session.id, companionNode.id, "belongs");
      }
    }

    for (const fact of state.facts.slice(0, 80)) {
      const node = upsertNode(draft, {
        id: hashId("fact", fact.id),
        kind: "fact",
        title: fact.text.slice(0, 56),
        summary: `${fact.source} · ${fact.kind}`,
        scope: "individual",
        space: fact.space,
        sourceId: fact.id,
        companionId: fact.companionId,
        conversationId: null,
      });
      if (fact.companionId) {
        ensureLink(draft, node.id, hashId("companion", fact.companionId), "mentions");
      }
    }

    for (const work of state.work.filter((item) => item.state !== "declined").slice(0, 60)) {
      const node = upsertNode(draft, {
        id: hashId("work", work.id),
        kind: "work",
        title: work.text.slice(0, 56),
        summary: `${work.state}${work.suggestedTime ? ` · ${work.suggestedTime.slice(0, 16)}` : ""}`,
        scope: "individual",
        space: work.space,
        sourceId: work.id,
        companionId: work.companionId,
        conversationId: null,
      });
      if (work.companionId) {
        ensureLink(draft, node.id, hashId("companion", work.companionId), "owns");
      }
    }

    for (const thread of state.threads.filter((item) => !item.archived).slice(0, 40)) {
      const project = upsertNode(draft, {
        id: hashId("project", thread.id),
        kind: "project",
        title: thread.title.slice(0, 56),
        summary: thread.open || thread.summary.slice(0, 160),
        scope: "individual",
        space: thread.space,
        sourceId: thread.id,
        companionId: thread.companionId,
        conversationId: null,
      });
      if (thread.companionId) {
        ensureLink(draft, project.id, hashId("companion", thread.companionId), "belongs");
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
};

/** Analyze one chat turn and grow the connected map. */
export function ingestBrainTurn(input: IngestTurnInput): void {
  const blob = `${input.userText}\n${input.assistantText}`.trim();
  if (blob.length < 8) return;

  mutate((draft) => {
    const companionKey = input.companionId
      ? hashId(input.scope === "solo" ? "solo-agent" : "companion", input.companionId)
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
      });
    }

    const sessionId = input.conversationId
      ? hashId("session", input.scope, input.conversationId)
      : hashId("session", input.scope, input.companionId ?? "open", input.userText.slice(0, 24));

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
    });

    if (companionKey) ensureLink(draft, session.id, companionKey, "belongs");

    // Soft project hub from session title tokens
    const project = upsertNode(draft, {
      id: hashId("project", input.scope, session.title.toLowerCase()),
      kind: "project",
      title: session.title,
      summary: session.summary,
      scope: input.scope,
      space: input.space,
      sourceId: session.id,
      companionId: input.companionId,
      conversationId: input.conversationId,
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
      });
      ensureLink(draft, node.id, session.id, "decided");
      ensureLink(draft, node.id, project.id, "belongs");
    }

    for (const file of extractFiles(blob)) {
      const node = upsertNode(draft, {
        id: hashId("file", file.ref.toLowerCase()),
        kind: "file",
        title: file.name,
        summary: file.ref,
        scope: input.scope,
        space: input.space,
        sourceId: file.ref,
        companionId: input.companionId,
        conversationId: input.conversationId,
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
  const state = getSecondBrain();
  const related = state.nodes
    .filter(
      (node) =>
        node.scope === scope &&
        (companionId ? node.companionId === companionId : true) &&
        (node.kind === "decision" || node.kind === "project" || node.kind === "file" || node.kind === "fact"),
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
    ...related.map((node) => `- [${node.kind}] ${node.title}${node.summary ? ` — ${node.summary.slice(0, 80)}` : ""}`),
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
      list.sort((a, b) => a.title.localeCompare(b.title));
      const ring = KIND_RING[kind];
      const n = list.length;
      list.forEach((node, index) => {
        const angle = n === 1 ? -Math.PI / 2 : (index / n) * Math.PI * 2 - Math.PI / 2;
        const wobble = ((index % 3) - 1) * 0.018;
        node.x = 0.5 + Math.cos(angle) * (ring + wobble);
        node.y = 0.5 + Math.sin(angle) * (ring + wobble) * 0.92;
        node.updatedAt = nowIso();
      });
    }
  });
}
