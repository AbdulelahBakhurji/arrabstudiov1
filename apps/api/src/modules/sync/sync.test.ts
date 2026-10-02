import { describe, expect, it } from "vitest";
import {
  mergeRecord,
  OfflineQueue,
  type PushResult,
  type QueueStorage,
  type SyncOp,
  type SyncRecord,
  type SyncTransport,
} from "@arrab/shared";
import { buildApp, createApiContext } from "../../app.js";
import { makeTestEnv } from "../../test-support/env.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON test fixtures

async function boot() {
  const app = await buildApp(await createApiContext(makeTestEnv()));
  const connect = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: { email: "o@arrab.studio", password: "securepass" },
  });
  const token1 = (connect.json() as { sessionToken: string }).sessionToken;
  const second = await app.inject({
    method: "POST",
    url: "/v1/account/sign-in",
    payload: { email: "o@arrab.studio", password: "securepass" },
  });
  const token2 = (second.json() as { sessionToken: string }).sessionToken;
  const call = async (token: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url,
      payload: payload as never,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: res.statusCode, body: res.json() as Json };
  };
  return { app, token1, token2, call };
}

const op = (over: Record<string, unknown> = {}) => ({
  opId: `op-${Math.random().toString(36).slice(2)}-xxxx`,
  type: "upsert",
  kind: "project",
  id: "proj-1",
  baseRev: 0,
  patch: { title: "Plan" },
  ...over,
});

describe("sync API", () => {
  it("requires a session", async () => {
    const { app } = await boot();
    expect(
      (await app.inject({ method: "POST", url: "/v1/sync/push", payload: { ops: [op()] } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/sync/pull" })).statusCode).toBe(401);
    await app.close();
  });

  it("serves a public version handshake", async () => {
    const { app } = await boot();
    const res = await app.inject({ method: "GET", url: "/v1/client/hello" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ protocol: 1, minProtocol: 1 });
    await app.close();
  });

  it("creates a record, then rejects a stale edit with the current version instead of overwriting", async () => {
    const { app, token1, token2, call } = await boot();
    const created = await call(token1, "POST", "/v1/sync/push", { ops: [op()] });
    expect(created.body.results[0]).toMatchObject({
      status: "ok",
      record: { rev: 1, data: { title: "Plan" } },
    });

    // Device 1 edits on top of rev 1.
    const edit1 = await call(token1, "POST", "/v1/sync/push", {
      ops: [op({ baseRev: 1, patch: { notes: "from mac" } })],
    });
    expect(edit1.body.results[0].record.rev).toBe(2);

    // Device 2 was offline and still on rev 1 → conflict, nothing overwritten.
    const edit2 = await call(token2, "POST", "/v1/sync/push", {
      ops: [op({ baseRev: 1, patch: { notes: "from phone" } })],
    });
    expect(edit2.body.results[0]).toMatchObject({
      status: "conflict",
      current: { rev: 2, data: { notes: "from mac" } },
    });
    const pulled = await call(token2, "GET", "/v1/sync/pull");
    expect(pulled.body.records[0].data.notes).toBe("from mac");
    await app.close();
  });

  it("is idempotent: retrying the same op id does not create a second revision", async () => {
    const { app, token1, call } = await boot();
    const first = op({ opId: "retry-me-1234" });
    await call(token1, "POST", "/v1/sync/push", { ops: [first] });
    const again = await call(token1, "POST", "/v1/sync/push", { ops: [first] });
    expect(again.body.results[0]).toMatchObject({ status: "ok", record: { rev: 1 } });
    const pulled = await call(token1, "GET", "/v1/sync/pull");
    expect(pulled.body.records).toHaveLength(1);
    await app.close();
  });

  it("pages with a cursor and only returns what changed", async () => {
    const { app, token1, call } = await boot();
    await call(token1, "POST", "/v1/sync/push", {
      ops: ["a", "b", "c"].map((id) => op({ id: `p-${id}` })),
    });
    const page1 = await call(token1, "GET", "/v1/sync/pull?limit=2");
    expect(page1.body.records).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await call(token1, "GET", `/v1/sync/pull?limit=2&cursor=${page1.body.cursor}`);
    expect(page2.body.records).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
    const none = await call(token1, "GET", `/v1/sync/pull?cursor=${page2.body.cursor}`);
    expect(none.body.records).toHaveLength(0);
    await app.close();
  });

  it("propagates deletes as tombstones", async () => {
    const { app, token1, call } = await boot();
    await call(token1, "POST", "/v1/sync/push", { ops: [op()] });
    await call(token1, "POST", "/v1/sync/push", {
      ops: [op({ type: "delete", baseRev: 1, patch: {} })],
    });
    const pulled = await call(token1, "GET", "/v1/sync/pull");
    expect(pulled.body.records[0]).toMatchObject({ deleted: true, rev: 2 });
    await app.close();
  });

  it("validates input at the trust boundary", async () => {
    const { app, token1, call } = await boot();
    for (const bad of [
      op({ kind: "../../etc" }),
      op({ id: "bad id with spaces" }),
      op({ type: "wipe" }),
      op({ baseRev: -1 }),
      op({ opId: "x" }),
      op({ patch: { blob: "x".repeat(300_000) } }),
    ]) {
      expect(
        (await call(token1, "POST", "/v1/sync/push", { ops: [bad] })).status,
        JSON.stringify(bad).slice(0, 60),
      ).toBe(400);
    }
    expect((await call(token1, "POST", "/v1/sync/push", { ops: [] })).status).toBe(400);
    expect((await call(token1, "GET", "/v1/sync/pull?cursor=-3")).status).toBe(400);
    await app.close();
  });

  it("two devices converge with no lost edits: offline queue + server + client-side merge", async () => {
    const { app, token1, token2, call } = await boot();
    const storage = (): QueueStorage & { ops: SyncOp[] } => {
      const s = {
        ops: [] as SyncOp[],
        load: async () => structuredClone(s.ops),
        save: async (o: SyncOp[]) => void (s.ops = structuredClone(o)),
      };
      return s;
    };
    const transportFor = (token: string): SyncTransport => ({
      push: async (o) =>
        (await call(token, "POST", "/v1/sync/push", { ops: [o] })).body.results[0] as PushResult,
    });

    // Both devices start from the same record.
    await call(token1, "POST", "/v1/sync/push", {
      ops: [op({ opId: "seed-0001", patch: { title: "Plan", notes: "base" } })],
    });
    const base = { title: "Plan", notes: "base" };

    const mac = new OfflineQueue(storage());
    const phone = new OfflineQueue(storage());
    const edit = (
      opId: string,
      patch: Record<string, unknown>,
    ): Omit<SyncOp, "attempts" | "nextAttemptAt"> => ({
      opId,
      type: "upsert",
      kind: "project",
      id: "proj-1",
      baseRev: 1,
      patch,
      createdAt: new Date().toISOString(),
    });
    // Offline edits: the phone changes the title, the Mac changes the notes — and both change a shared field.
    await phone.enqueue(edit("phone-edit-1", { title: "Plan v2", status: "phone" }));
    await mac.enqueue(edit("mac-edit-001", { notes: "mac notes", status: "mac" }));

    // Mac reconnects first and wins the race.
    expect((await mac.drain(transportFor(token1))).pushed).toBe(1);

    // Phone reconnects: its edit conflicts. Merge against the server record and re-send.
    const outcome = await phone.drain(transportFor(token2));
    expect(outcome.conflicts).toHaveLength(1);
    const { op: lost, current } = outcome.conflicts[0]!;
    // `local` is the device's full state (base + its own edits), not just the patch.
    const merged = mergeRecord(base, { ...base, ...lost.patch }, current as SyncRecord);
    expect(merged.data).toMatchObject({ title: "Plan v2", notes: "mac notes" }); // both non-conflicting edits survive
    expect(merged.conflicts).toEqual([
      { field: "status", base: undefined, local: "phone", remote: "mac" },
    ]); // the clash is surfaced, not dropped
    await phone.enqueue({
      ...edit("phone-edit-2", { title: merged.data.title }),
      baseRev: current.rev,
    });
    expect((await phone.drain(transportFor(token2))).pushed).toBe(1);

    const final = await call(token1, "GET", "/v1/sync/pull");
    expect(final.body.records[0].data).toMatchObject({ title: "Plan v2", notes: "mac notes" });
    await app.close();
  });
});
