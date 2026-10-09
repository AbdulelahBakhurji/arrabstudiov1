import { createInMemoryPersistence } from "@arrab/database";
import { describe, expect, it } from "vitest";
import { withRequestActor } from "../../platform/context/request-actor.js";
import { SealedVaultService, validateWrappedKey } from "./sealed-vault-service.js";

const wrapped = {
  v: 1 as const,
  kdf: "pbkdf2-sha256" as const,
  iterations: 600_000,
  salt: "c2FsdHNhbHRzYWx0c2FsdA==",
  iv: "aXZpdml2aXZpdml2",
  ct: "Y2lwaGVydGV4dGNpcGhlcnRleHRjaXBoZXJ0ZXh0Y2lwaGVy",
  fingerprint: "0123456789abcdef",
};

const asEmployee = <T>(id: string | null, fn: () => Promise<T>) =>
  withRequestActor({ employeeId: id }, fn);

describe("sealed vault", () => {
  it("rejects weak or malformed wrapped keys", () => {
    expect(() => validateWrappedKey({ ...wrapped, iterations: 1000 })).toThrow(/weak/);
    expect(() => validateWrappedKey({ ...wrapped, salt: "not base64!" })).toThrow(/salt/);
    expect(() => validateWrappedKey({ ...wrapped, fingerprint: "zz" })).toThrow(/fingerprint/);
    expect(validateWrappedKey(wrapped).fingerprint).toBe(wrapped.fingerprint);
  });

  it("stores the wrapped key once and only re-wraps the same chat key", async () => {
    const vault = new SealedVaultService(createInMemoryPersistence("2026-01-01T00:00:00.000Z"));
    expect((await vault.getKey()).wrappedKey).toBeNull();
    await vault.putKey({ wrappedKey: wrapped });
    await expect(vault.putKey({ wrappedKey: wrapped })).rejects.toThrow(/already set up/);
    await vault.putKey({
      wrappedKey: { ...wrapped, ct: wrapped.ct.slice(4) + "AAAA" },
      replace: true,
    });
    await expect(
      vault.putKey({ wrappedKey: { ...wrapped, fingerprint: "ffffffffffffffff" }, replace: true }),
    ).rejects.toThrow(/same chat key/);
  });

  it("syncs sealed chats, tombstones deletes, and keeps each user's vault separate", async () => {
    const vault = new SealedVaultService(createInMemoryPersistence("2026-01-01T00:00:00.000Z"));
    const sealed = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";

    await asEmployee("emp-a", () => vault.putChat("chat-aaaaaaaa", { sealed }));
    await asEmployee("emp-b", () => vault.putChat("chat-bbbbbbbb", { sealed }));

    const a = await asEmployee("emp-a", () => vault.listChats());
    expect(a.items.map((c) => c.id)).toEqual(["chat-aaaaaaaa"]);
    expect((await asEmployee(null, () => vault.listChats())).items).toEqual([]);

    await asEmployee("emp-a", () => vault.deleteChat("chat-aaaaaaaa"));
    const after = await asEmployee("emp-a", () => vault.listChats());
    expect(after.items).toEqual([]);
    expect(after.deleted).toEqual(["chat-aaaaaaaa"]);
    // A later write revives the chat.
    await asEmployee("emp-a", () => vault.putChat("chat-aaaaaaaa", { sealed }));
    expect((await asEmployee("emp-a", () => vault.listChats())).deleted).toEqual([]);
  });

  it("rejects non-ciphertext payloads and bad ids", async () => {
    const vault = new SealedVaultService(createInMemoryPersistence("2026-01-01T00:00:00.000Z"));
    await expect(vault.putChat("x", { sealed: "QUJD".repeat(8) })).rejects.toThrow(
      /Invalid chat id/,
    );
    await expect(
      vault.putChat("chat-12345678", { sealed: "plain text message!!" }),
    ).rejects.toThrow(/base64/);
  });

  it("issues a one-time phone code for a sealed chat and hides the ticket from sync", async () => {
    const vault = new SealedVaultService(createInMemoryPersistence("2026-01-01T00:00:00.000Z"));
    const sealed = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
    await vault.putChat("chat-12345678", { sealed });
    const ticket = await vault.createHandoff("chat-12345678");
    expect(ticket.code).toMatch(/^\d{6}$/);
    expect(ticket.qr).toBe(`arrab://handoff?code=${ticket.code}`);
    expect((await vault.listChats()).items.map((chat) => chat.id)).toEqual(["chat-12345678"]);

    const claimed = await vault.claimHandoff(ticket.code);
    expect(claimed.conversationId).toBe("chat-12345678");
    expect(claimed.sealed).toBe(sealed);
    expect(claimed.chats).toEqual([
      { conversationId: "chat-12345678", sealed, updatedAt: claimed.updatedAt },
    ]);
    await expect(vault.claimHandoff(ticket.code)).rejects.toThrow(/not active/);

    await vault.putChat("chat-12345678", { sealed });
    await vault.putChat("chat-87654321", { sealed });
    const both = await vault.createHandoff("chat-12345678", ["chat-87654321", "chat-12345678"]);
    const opened = await vault.claimHandoff(both.code);
    expect(opened.chats.map((chat) => chat.conversationId)).toEqual([
      "chat-12345678",
      "chat-87654321",
    ]);
    await expect(vault.putChat("hcode123456", { sealed })).rejects.toThrow(/Invalid chat id/);
  });

  it("reset wipes key and chats", async () => {
    const vault = new SealedVaultService(createInMemoryPersistence("2026-01-01T00:00:00.000Z"));
    await vault.putKey({ wrappedKey: wrapped });
    await vault.putChat("chat-12345678", { sealed: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=" });
    await vault.reset();
    expect((await vault.getKey()).wrappedKey).toBeNull();
    expect((await vault.listChats()).items).toEqual([]);
  });
});
