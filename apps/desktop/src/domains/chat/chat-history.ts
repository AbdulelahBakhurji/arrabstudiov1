import { useEffect } from "react";
import type { Conversation, Message } from "@arrab/shared";
import { accountPartitionAliases, accountPartitionId, subscribeAccountPartition } from "../../core/session/account-partition";
import {
  deviceStoreClear,
  deviceStoreGetJson,
  deviceStoreKeys,
  deviceStoreRemove,
  deviceStoreSetJson,
} from "../../core/storage/device-store";
import { looksEncryptedLocal, openLocalJson, sealLocalJson } from "../../core/storage/local-secure";
import { deleteSealedChat, pullSealedChats, queueSealedChatPush } from "../encryption/e2ee";

export type CachedChat = {
  conversation: Conversation;
  messages: Message[];
  savedAt: string;
};

function partitionPrefix(part = accountPartitionId()): string {
  return `acct.${part}.`;
}

function chatKey(id: string): string {
  return `${partitionPrefix()}${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

function isCurrentPartitionKey(key: string): boolean {
  return accountPartitionAliases().some((part) => key.startsWith(partitionPrefix(part)));
}

/** Legacy flat keys (pre account partition) — adopt once into the signed-in account. */
function isLegacyChatKey(key: string): boolean {
  return !key.startsWith("acct.");
}

async function writeCachedChat(key: string, payload: CachedChat): Promise<void> {
  const sealed = await sealLocalJson(payload);
  await deviceStoreSetJson("chats", key, sealed);
}

async function readCachedChat(key: string): Promise<CachedChat | null> {
  const raw = await deviceStoreGetJson<unknown>("chats", key);
  if (!raw) return null;
  const cached = looksEncryptedLocal(raw)
    ? await openLocalJson<CachedChat>(raw)
    : (raw as CachedChat);
  if (!cached?.conversation || !Array.isArray(cached.messages)) {
    return null;
  }
  // Migrate legacy plaintext cache into sealed storage.
  if (!looksEncryptedLocal(raw)) {
    void writeCachedChat(key, cached);
  }
  return cached;
}

async function adoptLegacyChatsIfNeeded(): Promise<void> {
  const partition = accountPartitionId();
  if (partition === "guest") return;
  const keys = await deviceStoreKeys("chats");
  const legacy = keys.filter(isLegacyChatKey);
  if (legacy.length === 0) return;
  // Only adopt if this account has no partitioned chats yet.
  if (keys.some(isCurrentPartitionKey)) return;
  for (const key of legacy) {
    const cached = await readCachedChat(key);
    if (!cached) continue;
    await writeCachedChat(chatKey(cached.conversation.id), cached);
    await deviceStoreRemove("chats", key);
  }
}

export async function saveChatHistory(
  conversation: Conversation,
  messages: Message[],
): Promise<void> {
  const payload: CachedChat = {
    conversation,
    messages,
    savedAt: new Date().toISOString(),
  };
  await writeCachedChat(chatKey(conversation.id), payload);
  // Encrypted sync: other devices get this transcript as ciphertext (no-op while locked).
  queueSealedChatPush(conversation, messages);
}

export async function loadChatHistory(id: string): Promise<CachedChat | null> {
  await adoptLegacyChatsIfNeeded();
  return readCachedChat(chatKey(id));
}

export async function listCachedChats(): Promise<CachedChat[]> {
  await adoptLegacyChatsIfNeeded();
  const keys = await deviceStoreKeys("chats");
  const items: CachedChat[] = [];
  for (const key of keys) {
    if (!isCurrentPartitionKey(key)) continue;
    const cached = await readCachedChat(key);
    if (!cached) continue;
    items.push(cached);
  }
  return items.sort((a, b) =>
    b.conversation.updatedAt.localeCompare(a.conversation.updatedAt),
  );
}

export async function deleteChatHistory(id: string): Promise<void> {
  await deviceStoreRemove("chats", chatKey(id));
  void deleteSealedChat(id);
}

function lastMessageAt(messages: Message[]): string {
  return messages.reduce((latest, m) => (m.createdAt > latest ? m.createdAt : latest), "");
}

/**
 * Pull transcripts other devices sealed, decrypt them here, and fold them into the local
 * cache (the newer transcript wins). Returns how many chats changed.
 */
export async function syncEncryptedChats(): Promise<number> {
  let changed = 0;
  const applied = await pullSealedChats(
    async ({ conversation, messages }) => {
      const local = await readCachedChat(chatKey(conversation.id));
      if (local && lastMessageAt(local.messages) >= lastMessageAt(messages)) return;
      await writeCachedChat(chatKey(conversation.id), {
        conversation,
        messages,
        savedAt: new Date().toISOString(),
      });
      changed += 1;
    },
    async (id) => {
      await deviceStoreRemove("chats", chatKey(id));
    },
  );
  return applied > 0 ? changed : 0;
}

/** Wipe sealed chat cache for the signed-in account only. */
export async function clearAccountChatHistory(): Promise<void> {
  const keys = await deviceStoreKeys("chats");
  for (const key of keys) {
    if (!isCurrentPartitionKey(key)) continue;
    await deviceStoreRemove("chats", key);
  }
}

export async function clearChatHistory(): Promise<void> {
  await deviceStoreClear("chats");
}

export async function mergeRemoteConversations(
  remote: Conversation[],
): Promise<Conversation[]> {
  const cached = await listCachedChats();
  const byId = new Map<string, Conversation>();
  for (const item of cached) {
    byId.set(item.conversation.id, item.conversation);
  }
  for (const item of remote) {
    const previous = byId.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadBestMessages(
  id: string,
  remote?: Message[],
): Promise<Message[]> {
  const cached = await loadChatHistory(id);
  if (!remote) {
    return cached?.messages ?? [];
  }
  if (!cached || cached.messages.length <= remote.length) {
    return remote;
  }
  return cached.messages;
}

export function usePersistedChat(
  conversation: Conversation | null,
  messages: Message[],
): void {
  useEffect(() => {
    if (!conversation) {
      return;
    }
    void saveChatHistory(conversation, messages);
  }, [conversation, messages]);

  useEffect(() => subscribeAccountPartition(() => {
    // Account switched — callers remount conversation state via API session.
  }), []);
}
