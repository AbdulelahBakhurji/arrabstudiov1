import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandId, type ConversationId, type MessageId, type WorkspaceId } from "@arrab/shared";
import { createFilePersistence } from "./file-persistence.js";

describe("createFilePersistence", () => {
  it("writes chat history to the device and reloads it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-file-persist-"));
    const first = await createFilePersistence(dir);
    expect(first.persistence.kind).toBe("file");

    const conversation = {
      id: brandId<ConversationId>("conv_device"),
      workspaceId: brandId<WorkspaceId>(first.persistence.workspaceId),
      projectId: null,
      agentId: null,
      teamId: null,
      title: "On device",
      spendTier: "low" as const,
      sessionTokenBudget: 5000,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    await first.persistence.conversations.create(conversation);
    await first.persistence.messages.create({
      id: brandId<MessageId>("msg_hello"),
      conversationId: conversation.id,
      role: "user",
      content: "Keep this on disk",
      createdAt: "2026-09-12T00:00:01.000Z",
    });
    await first.flush();

    expect(existsSync(path.join(dir, "studio.json"))).toBe(true);
    const chatFile = path.join(dir, "chats", "conv_device.json");
    expect(existsSync(chatFile)).toBe(true);
    const stored = JSON.parse(readFileSync(chatFile, "utf8")) as {
      messages: Array<{ content: string }>;
    };
    expect(stored.messages[0]?.content).toBe("Keep this on disk");

    const second = await createFilePersistence(dir);
    const threads = await second.persistence.conversations.list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.title).toBe("On device");
    const messages = await second.persistence.messages.listByConversation("conv_device");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Keep this on disk");
  });
});
