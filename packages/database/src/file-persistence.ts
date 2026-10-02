import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Conversation, Message } from "@arrab/shared";
import {
  createInMemoryPersistence,
  normalizeMemorySnapshot,
  type MemorySnapshot,
} from "./in-memory.js";
import type { Persistence } from "./types.js";

export type FilePersistenceHandle = {
  persistence: Persistence;
  dataDir: string;
  flush: () => Promise<void>;
};

export function defaultStudioDataDir(): string {
  return path.join(os.homedir(), ".arrab-studio");
}

function studioPath(dir: string): string {
  return path.join(dir, "studio.json");
}

function chatsDir(dir: string): string {
  return path.join(dir, "chats");
}

function chatFileName(id: string): string {
  return `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

function atomicWriteFile(filePath: string, contents: string, keepBackup = false): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  if (keepBackup && existsSync(filePath)) {
    // Last-known-good copy: if the next write is ever torn or damaged, this is what we recover from.
    try {
      copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      // a missing backup must never block saving
    }
  }
  try {
    renameSync(tmp, filePath);
  } catch {
    writeFileSync(filePath, contents, "utf8");
    rmSync(tmp, { force: true });
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isUsableSnapshot(raw: unknown): raw is Partial<MemorySnapshot> {
  const s = raw as Partial<MemorySnapshot> | null | undefined;
  return Boolean(
    s &&
      typeof s === "object" &&
      s.version === 1 &&
      s.context &&
      Array.isArray(s.conversations) &&
      Array.isArray(s.messages),
  );
}

/** Rebuild conversations and messages from the per-chat files (a second copy of the user's history). */
function rebuildFromChats(dir: string): MemorySnapshot {
  const snapshot = normalizeMemorySnapshot(null);
  const folder = chatsDir(dir);
  if (!existsSync(folder)) return snapshot;
  const seen = new Set<string>();
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".json")) continue;
    const parsed = readJson(path.join(folder, name)) as
      | { conversation?: Conversation; messages?: Message[] }
      | undefined;
    if (!parsed?.conversation?.id || !Array.isArray(parsed.messages) || seen.has(parsed.conversation.id)) continue;
    seen.add(parsed.conversation.id);
    snapshot.conversations.push(parsed.conversation);
    snapshot.messages.push(...parsed.messages);
  }
  return snapshot;
}

/**
 * Load the studio file without ever throwing user data away:
 *  - a missing file is a fresh install;
 *  - a damaged file is moved aside (`studio.json.corrupt-<time>`), never overwritten or deleted, and the
 *    state is recovered from the last-known-good `.bak`, else rebuilt from the per-chat files.
 */
function loadSnapshot(dir: string): MemorySnapshot {
  const file = studioPath(dir);
  if (!existsSync(file)) {
    return existsSync(chatsDir(dir)) && readdirSync(chatsDir(dir)).some((n) => n.endsWith(".json"))
      ? rebuildFromChats(dir)
      : normalizeMemorySnapshot(null);
  }
  const parsed = readJson(file);
  if (isUsableSnapshot(parsed)) return normalizeMemorySnapshot(parsed);

  try {
    renameSync(file, `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } catch {
    // If it cannot be moved it will still not be deleted; the backup/chat recovery below runs either way.
  }
  const backup = readJson(`${file}.bak`);
  if (isUsableSnapshot(backup)) return normalizeMemorySnapshot(backup);
  return rebuildFromChats(dir);
}

function writeChatFiles(dir: string, snapshot: MemorySnapshot): void {
  const folder = chatsDir(dir);
  mkdirSync(folder, { recursive: true });
  const keep = new Set(snapshot.conversations.map((conversation) => chatFileName(conversation.id)));
  const savedAt = new Date().toISOString();

  for (const conversation of snapshot.conversations) {
    const messages = snapshot.messages.filter(
      (message) => message.conversationId === conversation.id,
    );
    atomicWriteFile(
      path.join(folder, chatFileName(conversation.id)),
      JSON.stringify(
        {
          conversation,
          messages,
          savedAt,
        } satisfies { conversation: Conversation; messages: Message[]; savedAt: string },
        null,
        2,
      ),
    );
  }

  if (!existsSync(folder)) {
    return;
  }
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".json") || keep.has(name)) {
      continue;
    }
    // Only a readable chat that is no longer in the studio is a deleted chat. An unreadable file is
    // someone's possibly-recoverable data: leave it.
    const parsed = readJson(path.join(folder, name)) as { conversation?: { id?: string } } | undefined;
    if (parsed?.conversation?.id) rmSync(path.join(folder, name), { force: true });
  }
}

export async function createFilePersistence(dir: string): Promise<FilePersistenceHandle> {
  const dataDir = path.resolve(dir);
  mkdirSync(chatsDir(dataDir), { recursive: true });
  const snapshot = loadSnapshot(dataDir);

  let writing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // A failed save is reported to the caller that asked for it, but must not poison the chain:
    // the next flush starts clean (otherwise one full disk would break saving until restart).
    const run = writing
      .catch(() => undefined)
      .then(() => {
        writeChatFiles(dataDir, snapshot);
        atomicWriteFile(studioPath(dataDir), JSON.stringify(snapshot, null, 2), true);
      });
    writing = run.catch(() => undefined);
    await run;
  };

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      flush().catch((error: unknown) => {
        // Background saves have no caller to tell: log it (the next change retries).
        console.error("[arrab] could not save studio data:", error instanceof Error ? error.message : error);
      });
    }, 50);
  };

  const persistence = createInMemoryPersistence(snapshot.context.workspace.createdAt, {
    kind: "file",
    snapshot,
    onChange: schedule,
  });

  return { persistence, dataDir, flush };
}
