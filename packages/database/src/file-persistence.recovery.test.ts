import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandId, type ConversationId, type MessageId, type WorkspaceId } from "@arrab/shared";
import { createFilePersistence } from "./file-persistence.js";

async function seed(dir: string, title = "Precious chat") {
  const first = await createFilePersistence(dir);
  const conversation = {
    id: brandId<ConversationId>("conv_precious"),
    workspaceId: brandId<WorkspaceId>(first.persistence.workspaceId),
    projectId: null,
    agentId: null,
    teamId: null,
    title,
    spendTier: "low" as const,
    sessionTokenBudget: 5000,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
  await first.persistence.conversations.create(conversation);
  await first.persistence.messages.create({
    id: brandId<MessageId>("msg_1"),
    conversationId: conversation.id,
    role: "user",
    content: "irreplaceable words",
    createdAt: "2026-09-12T00:00:01.000Z",
  });
  await first.flush();
  return first;
}

const chatFiles = (dir: string) =>
  readdirSync(path.join(dir, "chats")).filter((f) => f.endsWith(".json"));
const quarantined = (dir: string) =>
  readdirSync(dir).filter((f) => f.startsWith("studio.json.corrupt-"));

describe("a damaged studio file never destroys the user's data", () => {
  it.each([
    ["garbage", "\u0000\u0001 not json at all"],
    ["truncated mid-write", '{"version":1,"context":{"workspace":'],
    ["empty file", ""],
    ["valid JSON, wrong shape", '{"hello":"world"}'],
  ])(
    "%s: the chats are recovered, the damaged file is kept aside, nothing is deleted",
    async (_label, damage) => {
      const dir = mkdtempSync(path.join(tmpdir(), "arrab-recover-"));
      await seed(dir);
      writeFileSync(path.join(dir, "studio.json"), damage);

      const reopened = await createFilePersistence(dir);
      const threads = await reopened.persistence.conversations.list();
      expect(threads.map((t) => t.title)).toEqual(["Precious chat"]);
      expect(
        (await reopened.persistence.messages.listByConversation("conv_precious"))[0]?.content,
      ).toBe("irreplaceable words");

      // The next save must not wipe the per-chat files…
      await reopened.flush();
      expect(chatFiles(dir)).toEqual(["conv_precious.json"]);
      // …and the damaged file is preserved for inspection (unless it was merely a wrong-shaped but valid document).
      if (damage !== '{"hello":"world"}') expect(quarantined(dir).length).toBe(1);
    },
  );

  it("prefers the last-known-good backup over rebuilding from chat files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-recover-"));
    const first = await seed(dir);
    await first.flush(); // second flush → the first good file becomes studio.json.bak
    expect(existsSync(path.join(dir, "studio.json.bak"))).toBe(true);
    writeFileSync(path.join(dir, "studio.json"), "{broken");
    const reopened = await createFilePersistence(dir);
    expect(await reopened.persistence.conversations.list()).toHaveLength(1);
  });

  it("a corrupt chat file is left alone, not deleted, and does not block startup", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-recover-"));
    await seed(dir);
    writeFileSync(path.join(dir, "chats", "conv_orphan.json"), "{not json");
    const reopened = await createFilePersistence(dir);
    await reopened.flush();
    expect(readFileSync(path.join(dir, "chats", "conv_orphan.json"), "utf8")).toBe("{not json");
  });

  it("deleting a conversation on purpose still removes its chat file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-recover-"));
    const first = await seed(dir);
    await first.persistence.conversations.delete("conv_precious");
    await first.flush();
    expect(chatFiles(dir)).toEqual([]);
  });

  it("a failed write is reported once and does not poison every later save", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-recover-"));
    const first = await seed(dir);
    // Make the data dir unwritable for one flush by replacing chats/ with a file.
    const chats = path.join(dir, "chats");
    const { rmSync, mkdirSync } = await import("node:fs");
    rmSync(chats, { recursive: true, force: true });
    writeFileSync(chats, "i am a file");
    await expect(first.flush()).rejects.toThrow();
    rmSync(chats, { force: true });
    mkdirSync(chats);
    await expect(first.flush()).resolves.toBeUndefined();
    expect(chatFiles(dir)).toEqual(["conv_precious.json"]);
  });
});
