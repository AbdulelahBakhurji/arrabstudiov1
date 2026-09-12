import { useEffect } from "react";
import type { Conversation, Message } from "@arrab/shared";
import {
  deviceStoreClear,
  deviceStoreGetJson,
  deviceStoreKeys,
  deviceStoreRemove,
  deviceStoreSetJson,
} from "./device-store";

export type CachedChat = {
  conversation: Conversation;
  messages: Message[];
  savedAt: string;
};

function chatKey(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
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
  await deviceStoreSetJson("chats", chatKey(conversation.id), payload);
}

export async function loadChatHistory(id: string): Promise<CachedChat | null> {
  const cached = await deviceStoreGetJson<CachedChat>("chats", chatKey(id));
  if (!cached?.conversation || !Array.isArray(cached.messages)) {
    return null;
  }
  return cached;
}

export async function listCachedChats(): Promise<CachedChat[]> {
  const keys = await deviceStoreKeys("chats");
  const items: CachedChat[] = [];
  for (const key of keys) {
    const cached = await deviceStoreGetJson<CachedChat>("chats", key);
    if (!cached?.conversation || !Array.isArray(cached.messages)) {
      continue;
    }
    items.push(cached);
  }
  return items.sort((a, b) =>
    b.conversation.updatedAt.localeCompare(a.conversation.updatedAt),
  );
}

export async function deleteChatHistory(id: string): Promise<void> {
  await deviceStoreRemove("chats", chatKey(id));
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
}
