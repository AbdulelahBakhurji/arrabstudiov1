import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message } from "@arrab/shared";

vi.mock("@/core/storage/device-store", () => {
  const data = new Map<string, string>();
  return {
    deviceStoreGet: async (ns: string, key: string) => data.get(`${ns}/${key}`) ?? null,
    deviceStoreSet: async (ns: string, key: string, value: string) => void data.set(`${ns}/${key}`, value),
    deviceStoreRemove: async (ns: string, key: string) => void data.delete(`${ns}/${key}`),
  };
});

import {
  bindE2eeApi,
  changeE2eePassphrase,
  e2eeState,
  isE2eeUnlocked,
  lockE2ee,
  pullSealedChats,
  pushSealedChat,
  setupE2ee,
  unlockE2ee,
  type SealedTranscript,
} from "@/domains/encryption/e2ee";

/** A server that, like the real one, only ever holds opaque strings. */
function fakeServer() {
  let wrappedKey: unknown = null;
  const chats = new Map<string, { sealed: string; updatedAt: string }>();
  let tick = 0;
  const api = {
    e2eeKey: async () => ({ wrappedKey: wrappedKey as never }),
    e2eePutKey: async (body: { wrappedKey: unknown }) => {
      wrappedKey = body.wrappedKey;
    },
    e2eeChats: async () => ({
      items: [...chats.entries()].map(([id, c]) => ({ id, ...c })),
      deleted: [] as string[],
    }),
    e2eePutChat: async (id: string, body: { sealed: string }) => {
      chats.set(id, { sealed: body.sealed, updatedAt: new Date(Date.now() + tick++).toISOString() });
    },
    e2eeDeleteChat: async (id: string) => void chats.delete(id),
    e2eeReset: async () => {
      wrappedKey = null;
      chats.clear();
    },
  };
  return { api, chats, wrapped: () => wrappedKey };
}

const conversation = { id: "chat-12345678", title: "Secret plans" } as unknown as Conversation;
const messages = [
  { id: "m1", conversationId: "chat-12345678", role: "user", content: "the launch is on friday", createdAt: "2026-01-01T00:00:00.000Z" },
] as unknown as Message[];

beforeEach(async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  await lockE2ee();
});

async function pull() {
  const out: SealedTranscript[] = [];
  await pullSealedChats(async (chat) => void out.push(chat));
  return out;
}

describe("chat end-to-end encryption", () => {
  it("never puts plaintext on the server and opens on a second device with the passphrase", async () => {
    const server = fakeServer();
    bindE2eeApi(server.api);
    expect(await e2eeState()).toBe("needs-setup");

    await setupE2ee("correct horse battery");
    expect(isE2eeUnlocked()).toBe(true);
    await pushSealedChat(conversation, messages);

    const stored = JSON.stringify([...server.chats.values()]) + JSON.stringify(server.wrapped());
    expect(stored).not.toContain("launch");
    expect(stored).not.toContain("Secret plans");
    expect(stored).not.toContain("correct horse");

    // New device: nothing local, only the passphrase.
    await lockE2ee();
    expect(await e2eeState()).toBe("locked");
    await expect(unlockE2ee("wrong passphrase!!")).rejects.toThrow(/Wrong passphrase/);
    await unlockE2ee("correct horse battery");
    const restored = await pull();
    expect(restored[0]?.messages[0]?.content).toBe("the launch is on friday");
    expect(restored[0]?.conversation.title).toBe("Secret plans");
  });

  it("refuses ciphertext the server moved to another chat id", async () => {
    const server = fakeServer();
    bindE2eeApi(server.api);
    await setupE2ee("correct horse battery");
    await pushSealedChat(conversation, messages);
    const original = server.chats.get("chat-12345678")!;
    server.chats.delete("chat-12345678");
    server.chats.set("chat-87654321", original);
    expect(await pull()).toEqual([]);
  });

  it("keeps history readable after a passphrase change, and the old passphrase stops working", async () => {
    const server = fakeServer();
    bindE2eeApi(server.api);
    await setupE2ee("correct horse battery");
    await pushSealedChat(conversation, messages);
    await changeE2eePassphrase("correct horse battery", "a brand new passphrase");

    await lockE2ee();
    await expect(unlockE2ee("correct horse battery")).rejects.toThrow(/Wrong passphrase/);
    await unlockE2ee("a brand new passphrase");
    expect((await pull())[0]?.messages).toHaveLength(1);
  });
});
