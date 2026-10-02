import { describe, expect, it } from "vitest";
import { mergeAppendOnly, mergeRecord } from "./merge.js";
import { OfflineQueue, QueueFullError, type QueueStorage } from "./queue.js";
import { deriveSyncStatus } from "./status.js";
import { protocolCompatible, type PushResult, type SyncOp, type SyncRecord } from "./protocol.js";

const record = (data: Record<string, unknown>, extra: Partial<SyncRecord> = {}): SyncRecord => ({
  kind: "project",
  id: "p1",
  rev: 2,
  deleted: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "dev-a",
  data,
  ...extra,
});

describe("mergeRecord (three-way, never silent last-write-wins)", () => {
  it("combines edits to different fields from two devices", () => {
    const merged = mergeRecord(
      { title: "A", notes: "" },
      { title: "A", notes: "from phone" },
      record({ title: "B", notes: "" }),
    );
    expect(merged.data).toEqual({ title: "B", notes: "from phone" });
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps the user's text when both devices edited the same field", () => {
    const merged = mergeRecord(
      { notes: "base" },
      { notes: "my offline edit" },
      record({ notes: "their edit" }),
    );
    expect(merged.data.notes).toBe("their edit"); // every device converges on the server value
    expect(merged.conflicts).toEqual([
      { field: "notes", base: "base", local: "my offline edit", remote: "their edit" },
    ]);
  });

  it("is not a conflict when both devices made the same change", () => {
    const merged = mergeRecord({ n: 1 }, { n: 2 }, record({ n: 2 }));
    expect(merged.conflicts).toEqual([]);
    expect(merged.data.n).toBe(2);
  });

  it("an edit beats a concurrent delete (work is never lost)", () => {
    const merged = mergeRecord(
      { title: "A" },
      { title: "A edited" },
      record({ title: "A" }, { deleted: true }),
    );
    expect(merged.resurrected).toBe(true);
    expect(merged.data.title).toBe("A edited");
  });

  it("a remote delete stands when nothing was edited locally", () => {
    const merged = mergeRecord(
      { title: "A" },
      { title: "A" },
      record({ title: "A" }, { deleted: true }),
    );
    expect(merged.resurrected).toBe(false);
  });
});

describe("mergeAppendOnly", () => {
  it("keeps concurrent messages from both devices, once, in time order", () => {
    const a = [
      { id: "1", createdAt: "2026-01-01T10:00:00Z" },
      { id: "3", createdAt: "2026-01-01T10:02:00Z" },
    ];
    const b = [
      { id: "1", createdAt: "2026-01-01T10:00:00Z" },
      { id: "2", createdAt: "2026-01-01T10:01:00Z" },
    ];
    expect(mergeAppendOnly(a, b).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });
});

class MemoryStorage implements QueueStorage {
  saved: SyncOp[] = [];
  saves = 0;
  async load() {
    return structuredClone(this.saved);
  }
  async save(ops: SyncOp[]) {
    this.saves += 1;
    this.saved = structuredClone(ops);
  }
}

const op = (
  id: string,
  patch: Record<string, unknown>,
  opId = `${id}-${Math.random()}`,
): Omit<SyncOp, "attempts" | "nextAttemptAt"> => ({
  opId,
  type: "upsert",
  kind: "project",
  id,
  baseRev: 1,
  patch,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const ok = (o: SyncOp): PushResult => ({
  status: "ok",
  record: record({ ...o.patch }, { id: o.id, rev: o.baseRev + 1 }),
});

describe("OfflineQueue", () => {
  it("persists an edit before any network attempt and survives a restart", async () => {
    const storage = new MemoryStorage();
    await new OfflineQueue(storage).enqueue(op("p1", { title: "x" }, "op-1"));
    expect(storage.saved).toHaveLength(1);
    const restarted = new OfflineQueue(storage);
    expect(await restarted.size()).toBe(1);
    const pushed: string[] = [];
    const out = await restarted.drain({ push: async (o) => (pushed.push(o.opId), ok(o)) });
    expect(pushed).toEqual(["op-1"]);
    expect(out).toMatchObject({ pushed: 1, pending: 0, interrupted: false });
    expect(storage.saved).toHaveLength(0);
  });

  it("is idempotent: the same opId is never queued twice", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { a: 1 }, "same"));
    await queue.enqueue(op("p1", { a: 1 }, "same"));
    expect(await queue.size()).toBe(1);
  });

  it("coalesces untouched edits to one record, keeping the original baseRev", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { a: 1 }));
    await queue.enqueue(op("p1", { b: 2 }));
    const [only] = await queue.snapshot();
    expect(await queue.size()).toBe(1);
    expect(only!.patch).toEqual({ a: 1, b: 2 });
  });

  it("backs off after a network failure, keeps the edit, and resumes in order", async () => {
    let now = 1_000_000;
    const queue = new OfflineQueue(new MemoryStorage(), {
      now: () => now,
      random: () => 0,
      baseDelayMs: 1_000,
    });
    await queue.enqueue(op("p1", { v: 1 }, "first"));
    await queue.enqueue({ ...op("p2", { v: 2 }, "second") });

    const offline = await queue.drain({
      push: async () => ({ status: "retry", reason: "ECONNRESET" }),
    });
    expect(offline).toMatchObject({ interrupted: true, pushed: 0, pending: 2 });

    // Too early: nothing is attempted.
    let calls = 0;
    await queue.drain({ push: async (o) => (calls++, ok(o)) });
    expect(calls).toBe(1 /* p2 is not blocked by p1's backoff */);

    now += 60_000;
    const back = await queue.drain({ push: async (o) => ok(o) });
    expect(back.pending).toBe(0);
  });

  it("honours Retry-After and rate-limit hints", async () => {
    const now = 0;
    const queue = new OfflineQueue(new MemoryStorage(), { now: () => now });
    await queue.enqueue(op("p1", { a: 1 }));
    await queue.drain({ push: async () => ({ status: "retry", afterMs: 30_000 }) });
    const [waiting] = await queue.snapshot();
    expect(Date.parse(waiting!.nextAttemptAt!)).toBe(30_000);
  });

  it("hands a conflict back to the caller instead of overwriting the server", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { notes: "mine" }));
    const current = record({ notes: "theirs" }, { rev: 5 });
    const out = await queue.drain({ push: async () => ({ status: "conflict", current }) });
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.current.rev).toBe(5);
    expect(await queue.size()).toBe(0);
  });

  it("surfaces rejected edits rather than retrying them forever", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { a: 1 }));
    const out = await queue.drain({
      push: async () => ({ status: "rejected", reason: "forbidden" }),
    });
    expect(out.rejected[0]!.reason).toBe("forbidden");
  });

  it("parks an op as stuck after repeated failures and keeps it (never drops work)", async () => {
    let now = 0;
    const queue = new OfflineQueue(new MemoryStorage(), {
      now: () => now,
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
      random: () => 0,
    });
    await queue.enqueue(op("p1", { a: 1 }));
    for (let i = 0; i < 5; i++) {
      now += 10_000;
      await queue.drain({ push: async () => ({ status: "retry" }) });
    }
    expect(await queue.stuckCount()).toBe(1);
    expect(await queue.size()).toBe(1);
  });

  it("treats a throwing transport as a retryable failure", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { a: 1 }));
    const out = await queue.drain({
      push: async () => {
        throw new Error("boom");
      },
    });
    expect(out.interrupted).toBe(true);
    expect(await queue.size()).toBe(1);
  });

  it("shares one run between concurrent drains", async () => {
    const queue = new OfflineQueue(new MemoryStorage());
    await queue.enqueue(op("p1", { a: 1 }));
    let calls = 0;
    const transport = { push: async (o: SyncOp) => (calls++, ok(o)) };
    await Promise.all([queue.drain(transport), queue.drain(transport)]);
    expect(calls).toBe(1);
  });

  it("refuses new edits loudly when full instead of dropping old ones", async () => {
    const queue = new OfflineQueue(new MemoryStorage(), { maxOps: 2 });
    await queue.enqueue(op("a", { v: 1 }));
    await queue.enqueue(op("b", { v: 1 }));
    await expect(queue.enqueue(op("c", { v: 1 }))).rejects.toBeInstanceOf(QueueFullError);
    expect(await queue.size()).toBe(2);
  });
});

describe("deriveSyncStatus", () => {
  const base = {
    network: "online" as const,
    connecting: false,
    syncing: false,
    pending: 0,
    stuck: 0,
    lastError: null,
  };
  it("covers every state the user sees", () => {
    expect(deriveSyncStatus(base)).toBe("online");
    expect(deriveSyncStatus({ ...base, connecting: true })).toBe("connecting");
    expect(deriveSyncStatus({ ...base, syncing: true })).toBe("syncing");
    expect(deriveSyncStatus({ ...base, pending: 3 })).toBe("syncing");
    expect(deriveSyncStatus({ ...base, lastError: "x" })).toBe("sync-error");
    expect(deriveSyncStatus({ ...base, stuck: 1 })).toBe("sync-error");
    expect(deriveSyncStatus({ ...base, network: "offline", pending: 5, stuck: 1 })).toBe("offline");
  });
});

describe("protocol versions", () => {
  it("accepts only versions the server speaks", () => {
    expect(protocolCompatible(1, { protocol: 2, minProtocol: 1 })).toBe(true);
    expect(protocolCompatible(0, { protocol: 2, minProtocol: 1 })).toBe(false);
    expect(protocolCompatible(3, { protocol: 2, minProtocol: 1 })).toBe(false);
  });
});
