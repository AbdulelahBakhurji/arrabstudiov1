import { describe, expect, it } from "vitest";
import {
  createSyncEngine,
  MIN_SYNC_GAP_MS,
  nextBackoffMs,
  pollDelayMs,
  type SyncTransport,
  type Timers,
} from "../../apps/desktop/src/domains/managed/client/sync";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeClock() {
  let now = 1_000_000;
  const scheduled: Array<{ fn: () => void; at: number; id: number }> = [];
  let nextId = 1;
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.push({ fn, at: now + ms, id });
      return id;
    },
    clearTimeout: (handle) => {
      const index = scheduled.findIndex((item) => item.id === handle);
      if (index !== -1) scheduled.splice(index, 1);
    },
  };
  return {
    timers,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    /** Delay of the pending poll, relative to now. */
    nextDelay: () => (scheduled.length ? scheduled[scheduled.length - 1]!.at - now : null),
    pending: () => scheduled.length,
  };
}

const baseRequest = async () => ({
  deviceId: "d",
  platform: "macos" as const,
  vendor: "apple" as const,
  osVersion: "15",
  appVersion: "0.13.0",
  build: "1300",
  channel: "stable",
  locale: "en",
  timezone: "UTC",
  pushProvider: "none" as const,
  pushToken: null,
  capabilities: [],
  state: "foreground" as const,
  activeScreen: "chat" as const,
  activeCompanionId: null,
  configVersion: null,
});

function engineWith(transport: SyncTransport, clock = fakeClock()) {
  const responses: unknown[] = [];
  const engine = createSyncEngine({
    transport,
    buildRequest: baseRequest,
    onResponse: (response) => {
      responses.push(response);
    },
    now: clock.now,
    random: () => 0.5,
    timers: clock.timers,
  });
  return { engine, clock, responses };
}

describe("sync backoff", () => {
  it("steps 30 s → 60 s → 2 m → 5 m max with ±20% jitter", () => {
    expect(nextBackoffMs(1, () => 0.5)).toBe(30_000);
    expect(nextBackoffMs(2, () => 0.5)).toBe(60_000);
    expect(nextBackoffMs(3, () => 0.5)).toBe(120_000);
    expect(nextBackoffMs(4, () => 0.5)).toBe(300_000);
    expect(nextBackoffMs(9, () => 0.5)).toBe(300_000);
    expect(nextBackoffMs(1, () => 0)).toBe(24_000);
    expect(nextBackoffMs(1, () => 1)).toBe(36_000);
  });

  it("clamps pollAfterSec to 30–600 s", () => {
    expect(pollDelayMs(5, () => 0.5)).toBe(30_000);
    expect(pollDelayMs(10_000, () => 0.5)).toBe(600_000);
    expect(pollDelayMs(null, () => 0.5)).toBe(60_000);
  });

  it.each([404, 405, 501, 503])("status %i never throws and backs off", async (status) => {
    const { engine, clock } = engineWith(async () => ({ status, body: "" }));
    engine.start();
    await expect(engine.syncNow("x")).resolves.toBeDefined();
    await Promise.resolve();
    expect(engine.snapshot().failures).toBe(1);
    expect(clock.nextDelay()).toBe(30_000);

    clock.advance(30_000);
    await engine.syncNow("retry");
    expect(engine.snapshot().failures).toBe(2);
    expect(clock.nextDelay()).toBe(60_000);
  });

  it("network errors never throw to the caller", async () => {
    const { engine, clock } = engineWith(async () => {
      throw new TypeError("Failed to fetch");
    });
    engine.start();
    const outcome = await engine.syncNow("launch-again");
    expect(["failed", "deferred"]).toContain(outcome);
    await Promise.resolve();
    expect(engine.snapshot().failures).toBe(1);
    expect(clock.nextDelay()).toBe(30_000);
  });

  it("a success resets backoff and follows pollAfterSec", async () => {
    let fail = true;
    const { engine, clock } = engineWith(async () =>
      fail ? { status: 500, body: "" } : { status: 200, body: JSON.stringify({ pollAfterSec: 120 }) },
    );
    engine.start();
    await flush();
    fail = false;
    clock.advance(MIN_SYNC_GAP_MS);
    expect(await engine.syncNow("focus")).toBe("deferred");
    clock.advance(30_000 - MIN_SYNC_GAP_MS);
    await engine.syncNow("retry");
    expect(engine.snapshot().failures).toBe(0);
    expect(clock.nextDelay()).toBe(120_000);
  });

  it("rate-limits to one sync per 20 s", async () => {
    let calls = 0;
    const { engine, clock } = engineWith(async () => {
      calls += 1;
      return { status: 200, body: "{}" };
    });
    await engine.syncNow("a");
    expect(await engine.syncNow("b")).toBe("deferred");
    expect(calls).toBe(1);
    clock.advance(MIN_SYNC_GAP_MS);
    await engine.syncNow("c");
    expect(calls).toBe(2);
  });

  it("sends acked ids once and clears them after a successful sync", async () => {
    const bodies: Array<{ ackedCommandIds: string[]; ackedNotificationIds: string[] }> = [];
    const { engine, clock } = engineWith(async (_path, body) => {
      bodies.push(body as (typeof bodies)[number]);
      return { status: 200, body: "{}" };
    });
    engine.ackCommand("cmd_1");
    engine.ackNotification("ntf_1");
    await engine.syncNow("a");
    clock.advance(MIN_SYNC_GAP_MS);
    await engine.syncNow("b");
    expect(bodies[0]).toMatchObject({ ackedCommandIds: ["cmd_1"], ackedNotificationIds: ["ntf_1"] });
    expect(bodies[1]).toMatchObject({ ackedCommandIds: [], ackedNotificationIds: [] });
  });

  it("keeps acked ids for the next attempt when a sync fails", async () => {
    const bodies: Array<{ ackedCommandIds: string[] }> = [];
    let status = 503;
    const { engine, clock } = engineWith(async (_path, body) => {
      bodies.push(body as (typeof bodies)[number]);
      return { status, body: "{}" };
    });
    engine.ackCommand("cmd_1");
    await engine.syncNow("a");
    status = 200;
    clock.advance(MIN_SYNC_GAP_MS);
    await engine.syncNow("b");
    expect(bodies.map((b) => b.ackedCommandIds)).toEqual([["cmd_1"], ["cmd_1"]]);
  });

  it("a throwing response handler does not stop polling", async () => {
    const clock = fakeClock();
    const engine = createSyncEngine({
      transport: async () => ({ status: 200, body: "{}" }),
      buildRequest: baseRequest,
      onResponse: () => {
        throw new Error("ui bug");
      },
      now: clock.now,
      random: () => 0.5,
      timers: clock.timers,
    });
    engine.start();
    await flush();
    expect(clock.pending()).toBe(1);
    expect(engine.snapshot().failures).toBe(0);
  });
});
