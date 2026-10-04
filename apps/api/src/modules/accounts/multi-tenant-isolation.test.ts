import { brandId, type ConnectorSecretRecord, type WorkspaceId } from "@arrab/shared";
import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../../app.js";
import { makeTestEnv } from "../../test-support/env.js";

function connector(id: string, ownerAccountId: string | null, connectedAt: string): ConnectorSecretRecord {
  return {
    id,
    workspaceId: brandId<WorkspaceId>("ws_local_studio"),
    provider: "notion",
    status: "connected",
    accountLabel: id,
    scopes: [],
    connectedAt,
    lastVerifiedAt: null,
    error: null,
    secret: "token",
    familyMemberId: null,
    ownerEmployeeId: null,
    ownerAccountId,
  };
}

describe("multi-tenant account isolation", () => {
  it("two accounts on one workspace cannot see each other's connectors or vault", async () => {
    const context = await createApiContext(makeTestEnv());
    const app = await buildApp(context);

    const a = (await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "a@arrab.studio", password: "securepass", displayName: "A" },
    })).json() as { sessionToken: string; account: { id: string } };

    const b = (await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "b@arrab.studio", password: "securepass", displayName: "B" },
    })).json() as { sessionToken: string; account: { id: string } };

    expect(a.account.id).not.toBe(b.account.id);

    await context.persistence.connectors.create(
      connector("a-notion", a.account.id, new Date().toISOString()),
    );
    await context.persistence.connectors.create(
      connector("b-notion", b.account.id, new Date().toISOString()),
    );

    await context.persistence.sealedVault.putChat(`acc:${a.account.id}`, {
      id: "chat-aaaaaaaa",
      sealed: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      updatedAt: new Date().toISOString(),
    });
    await context.persistence.sealedVault.putChat(`acc:${b.account.id}`, {
      id: "chat-bbbbbbbb",
      sealed: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      updatedAt: new Date().toISOString(),
    });

    const aList = await app.inject({
      method: "GET",
      url: "/v1/connectors",
      headers: { authorization: `Bearer ${a.sessionToken}` },
    });
    const bList = await app.inject({
      method: "GET",
      url: "/v1/connectors",
      headers: { authorization: `Bearer ${b.sessionToken}` },
    });
    expect((aList.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toEqual([
      "a-notion",
    ]);
    expect((bList.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toEqual([
      "b-notion",
    ]);

    const aVault = await app.inject({
      method: "GET",
      url: "/v1/e2ee/chats",
      headers: { authorization: `Bearer ${a.sessionToken}` },
    });
    const bVault = await app.inject({
      method: "GET",
      url: "/v1/e2ee/chats",
      headers: { authorization: `Bearer ${b.sessionToken}` },
    });
    expect((aVault.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toEqual([
      "chat-aaaaaaaa",
    ]);
    expect((bVault.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toEqual([
      "chat-bbbbbbbb",
    ]);
  });
});
