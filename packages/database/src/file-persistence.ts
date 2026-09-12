import {
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

function atomicWriteFile(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  try {
    renameSync(tmp, filePath);
  } catch {
    writeFileSync(filePath, contents, "utf8");
    rmSync(tmp, { force: true });
  }
}

function loadSnapshot(dir: string): MemorySnapshot {
  const file = studioPath(dir);
  if (!existsSync(file)) {
    return normalizeMemorySnapshot(null);
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<MemorySnapshot>;
    return normalizeMemorySnapshot(parsed);
  } catch {
    return normalizeMemorySnapshot(null);
  }
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
    rmSync(path.join(folder, name), { force: true });
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
    const pending = writing;
    writing = pending.then(() => {
      atomicWriteFile(studioPath(dataDir), JSON.stringify(snapshot, null, 2));
      writeChatFiles(dataDir, snapshot);
    });
    await writing;
  };

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 50);
  };

  const persistence = createInMemoryPersistence(snapshot.context.workspace.createdAt, {
    kind: "file",
    snapshot,
    onChange: schedule,
  });

  return { persistence, dataDir, flush };
}
