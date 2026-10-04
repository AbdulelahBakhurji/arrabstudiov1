/**
 * Professional group chats — multi-companion rooms on the work desk.
 * Local-first; signed-in sync can follow later via companion state.
 */
import { useSyncExternalStore } from "react";

const KEY = "arrab.pro.groups";
const EVENT = "arrab:pro-groups";

export type ProfessionalGroup = {
  id: string;
  title: string;
  /** Companion profile ids in this room. */
  memberIds: string[];
  createdAt: string;
  lastAt: string | null;
  archivedAt: string | null;
};

/** Stable snapshot for useSyncExternalStore — must return same reference until data changes. */
let cache: ProfessionalGroup[] | null = null;

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // ignore
  }
}

function readAll(): ProfessionalGroup[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProfessionalGroup[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && Array.isArray(item.memberIds));
  } catch {
    return [];
  }
}

function writeAll(groups: ProfessionalGroup[]) {
  cache = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    // ignore
  }
  emit();
}

function liveGroups(): ProfessionalGroup[] {
  if (cache) return cache;
  cache = readAll()
    .filter((item) => !item.archivedAt)
    .sort((a, b) => (b.lastAt ?? b.createdAt).localeCompare(a.lastAt ?? a.createdAt));
  return cache;
}

export function listProfessionalGroups(): ProfessionalGroup[] {
  return liveGroups();
}

export function findProfessionalGroup(id: string | null | undefined): ProfessionalGroup | null {
  if (!id) return null;
  return liveGroups().find((item) => item.id === id) ?? null;
}

export function createProfessionalGroup(input: {
  title: string;
  memberIds: string[];
}): ProfessionalGroup {
  const memberIds = [...new Set(input.memberIds.map((id) => id.trim()).filter(Boolean))];
  if (memberIds.length < 2) {
    throw new Error("group_needs_members");
  }
  const title = input.title.trim() || "Group";
  const group: ProfessionalGroup = {
    id: `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.slice(0, 80),
    memberIds,
    createdAt: new Date().toISOString(),
    lastAt: null,
    archivedAt: null,
  };
  writeAll([group, ...readAll()]);
  return group;
}

export function touchProfessionalGroup(id: string): void {
  writeAll(
    readAll().map((item) =>
      item.id === id ? { ...item, lastAt: new Date().toISOString() } : item,
    ),
  );
}

export function renameProfessionalGroup(id: string, title: string): void {
  const next = title.trim().slice(0, 80);
  if (next.length < 1) return;
  writeAll(readAll().map((item) => (item.id === id ? { ...item, title: next } : item)));
}

export function archiveProfessionalGroup(id: string): void {
  writeAll(
    readAll().map((item) =>
      item.id === id ? { ...item, archivedAt: new Date().toISOString() } : item,
    ),
  );
}

/** Archive every professional group chat. */
export function clearProfessionalGroups(): number {
  const live = listProfessionalGroups();
  if (live.length === 0) return 0;
  const now = new Date().toISOString();
  writeAll(
    readAll().map((item) => (item.archivedAt ? item : { ...item, archivedAt: now })),
  );
  return live.length;
}

export function subscribeProfessionalGroups(onChange: () => void): () => void {
  const handler = () => {
    cache = null;
    onChange();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

const EMPTY: ProfessionalGroup[] = [];

export function useProfessionalGroups(): ProfessionalGroup[] {
  return useSyncExternalStore(subscribeProfessionalGroups, liveGroups, () => EMPTY);
}
