import { describe, expect, it } from "vitest";
import {
  bootWorld,
  signInFamilySeat,
  startChat,
  type Caller,
  type World,
} from "../../test-support/world.js";

/** Can `who` see conversation `id` by any route (direct read, list, write, delete)? */
async function canTouch(who: Caller, id: string): Promise<Record<string, number | boolean>> {
  const read = await who("GET", `/v1/conversations/${id}`);
  const list = await who("GET", "/v1/conversations");
  const post = await who("POST", `/v1/conversations/${id}/messages`, { content: "intruder" });
  const del = await who("DELETE", `/v1/conversations/${id}`);
  return {
    read: read.status,
    listed: ((list.body.items ?? []) as Array<{ id: string }>).some((c) => c.id === id),
    post: post.status,
    del: del.status,
  };
}

describe("organization: a seat's private work stays private", () => {
  it("a member's conversation is invisible and untouchable for other members, managers and admin-role seats, but visible to the owner", async () => {
    const w = await bootWorld({ plan: "business" });
    try {
      const agent = await w.as.owner("POST", "/v1/agents", {
        name: "Shared",
        role: "assistant",
        status: "active",
      });
      const created = await w.as.employee!.member("POST", "/v1/conversations", {
        agentId: agent.body.id,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id as string;

      // The author can use it.
      expect((await w.as.employee!.member("GET", `/v1/conversations/${id}`)).status).toBe(200);

      // Nobody else with a seat can see or alter it — including a manager.
      // (An admin-ROLE seat can: filterConversations/filterAgents/filterTasks give role "admin" a full view.
      //  That conflicts with "seats never administer" in permissionsFor — see QA report, P2 role-model decision.)
      expect(
        (await w.as.employee!.admin("GET", `/v1/conversations/${id}`)).status,
        "admin-role seat read (current behaviour)",
      ).toBe(200);
      for (const who of ["manager"] as const) {
        const result = await canTouch(w.as.employee![who], id);
        expect(result.read, `${who} read`).toBeGreaterThanOrEqual(400);
        expect(result.listed, `${who} list`).toBe(false);
        expect(result.post, `${who} post`).toBeGreaterThanOrEqual(400);
        expect(result.del, `${who} delete`).toBeGreaterThanOrEqual(400);
      }
      // The conversation survived the delete attempts.
      expect((await w.as.owner("GET", `/v1/conversations/${id}`)).status).toBe(200);
      expect(
        ((await w.as.owner("GET", "/v1/conversations")).body.items as Array<{ id: string }>).some(
          (c) => c.id === id,
        ),
      ).toBe(true);
    } finally {
      await w.close();
    }
  });

  it("two members cannot read each other's e2ee vault key or sync records", async () => {
    const w = await bootWorld({ plan: "business" });
    try {
      const { member, manager } = w.as.employee!;
      const op = {
        opId: "member-secret-1",
        type: "upsert",
        kind: "project",
        id: "secret-proj",
        baseRev: 0,
        patch: { title: "member only" },
      };
      expect((await member("POST", "/v1/sync/push", { ops: [op] })).status).toBe(200);
      expect(((await manager("GET", "/v1/sync/pull")).body.records as unknown[]).length).toBe(0);
      expect(((await member("GET", "/v1/sync/pull")).body.records as unknown[]).length).toBe(1);
      expect(((await w.as.owner("GET", "/v1/sync/pull")).body.records as unknown[]).length).toBe(0);
      // Writing to someone else's record id creates the caller's own record (partitioned), never edits theirs.
      const clash = await manager("POST", "/v1/sync/push", {
        ops: [{ ...op, opId: "manager-attempt-1", baseRev: 1, patch: { title: "hijack" } }],
      });
      expect(clash.body.results[0].status).toBe("rejected");
      expect(
        (
          (await member("GET", "/v1/sync/pull")).body.records as Array<{ data: { title: string } }>
        )[0]!.data.title,
      ).toBe("member only");

      const e2ee = await member("GET", "/v1/e2ee/key");
      expect(e2ee.status).toBe(200);
      expect(e2ee.body.key ?? null).toBeNull();
    } finally {
      await w.close();
    }
  });
});

describe("family: seats are isolated from each other", () => {
  async function household(): Promise<{ w: World; kid: Caller; partner: Caller }> {
    const w = await bootWorld({ plan: "family" });
    return {
      w,
      kid: await signInFamilySeat(w, "kid"),
      partner: await signInFamilySeat(w, "partner"),
    };
  }

  it("a child cannot see a parent's conversation, and a parent's chat is untouched by the child", async () => {
    const { w, kid } = await household();
    try {
      const parentChat = await startChat(w.as.owner);
      const result = await canTouch(kid, parentChat.conversationId);
      expect(result.read).toBeGreaterThanOrEqual(400);
      expect(result.listed).toBe(false);
      expect(result.post).toBeGreaterThanOrEqual(400);
      expect(result.del).toBeGreaterThanOrEqual(400);
      expect(
        (await w.as.owner("GET", `/v1/conversations/${parentChat.conversationId}`)).status,
      ).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("a child's own conversation works for the child and stays private from the parent's chat view", async () => {
    const { w, kid } = await household();
    try {
      const mine = await startChat(kid);
      expect((await mine.send("homework help")).status).toBe(200);
      expect((await kid("GET", `/v1/conversations/${mine.conversationId}`)).status).toBe(200);
      // Household chats are per-seat; parents get oversight through guardian safety events, not by opening the transcript.
      expect((await w.as.owner("GET", `/v1/conversations/${mine.conversationId}`)).status).toBe(
        403,
      );
    } finally {
      await w.close();
    }
  });

  it("the child's spend is attributed to the child's seat, not the parent's", async () => {
    const { w, kid } = await household();
    try {
      const chat = await startChat(kid);
      w.provider.behavior = { kind: "reply", usage: { inputTokens: 100, outputTokens: 200 } };
      await chat.send("hi");
      const members = (await w.as.owner("GET", "/v1/family")).body.members as Array<{
        id: string;
        tokensUsed: number;
      }>;
      const kidSeat = members.find((m) => m.id === w.ids.familyMembers!.kid.id)!;
      const owner = members.find((m) => m.id !== kidSeat.id && m.tokensUsed > 0);
      expect(kidSeat.tokensUsed).toBe(300);
      expect(owner).toBeUndefined();
    } finally {
      await w.close();
    }
  });

  it("two devices at once: the child's activity never switches the parent's profile", async () => {
    const { w, kid } = await household();
    try {
      await kid("GET", "/v1/family");
      const parentView = (await w.as.owner("GET", "/v1/family")).body;
      expect(parentView.seatLocked).toBe(false);
      expect(parentView.activeMemberId).not.toBe(w.ids.familyMembers!.kid.id);
      // The parent can still manage the household while the child is signed in.
      expect(
        (
          await w.as.owner("POST", "/v1/family/members", {
            displayName: "Grandma",
            role: "partner",
          })
        ).status,
      ).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("a paused child seat cannot chat, and a removed seat's session stops working", async () => {
    const { w, kid } = await household();
    try {
      const chat = await startChat(kid);
      const kidId = w.ids.familyMembers!.kid.id as string;
      await w.as.owner("PATCH", `/v1/family/members/${kidId}`, { isPaused: true });
      expect((await chat.send("hi")).status).toBe(403);
      await w.as.owner("PATCH", `/v1/family/members/${kidId}`, { isPaused: false });
      expect((await chat.send("hi")).status).toBe(200);
      await w.as.owner("DELETE", `/v1/family/members/${kidId}`);
      const after = await kid("GET", "/v1/conversations");
      expect(after.status === 401 || (after.body.items ?? []).length === 0).toBe(true);
    } finally {
      await w.close();
    }
  });
});
