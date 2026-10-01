import { parseSyncResponseText, type SyncRequest, type SyncResponse } from "./types";

export const SYNC_PATH = "/v1/client/sync";
export const MIN_SYNC_GAP_MS = 20_000;
export const BACKGROUND_POLL_MS = 15 * 60_000;
const BACKOFF_STEPS_SEC = [30, 60, 120, 300] as const;
const DEFAULT_POLL_SEC = 60;
const SYNC_TIMEOUT_MS = 15_000;
const MAX_PENDING_ACKS = 200;

export type TransportResult = { status: number; body: string };
export type SyncTransport = (
  path: string,
  body: unknown,
  timeoutMs: number,
) => Promise<TransportResult>;

export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

function jitter(ms: number, random: () => number): number {
  return Math.round(ms * (0.8 + random() * 0.4));
}

/** 30 s → 60 s → 2 m → 5 m (max), each ±20%. `failures` starts at 1. */
export function nextBackoffMs(failures: number, random: () => number = Math.random): number {
  const step = BACKOFF_STEPS_SEC[Math.min(Math.max(failures, 1), BACKOFF_STEPS_SEC.length) - 1]!;
  return jitter(step * 1000, random);
}

/** Server-suggested poll interval clamped to 30–600 s, ±20% so clients spread out. */
export function pollDelayMs(pollAfterSec: number | null, random: () => number = Math.random): number {
  const sec = Math.min(600, Math.max(30, pollAfterSec ?? DEFAULT_POLL_SEC));
  return jitter(sec * 1000, random);
}

export type SyncOutcome = "ok" | "failed" | "deferred";

export type SyncLogEntry = {
  at: number;
  kind: "sync";
  outcome: SyncOutcome;
  status: number | null;
  reason: string;
};

export type SyncEngineDeps = {
  transport: SyncTransport;
  /** Everything except the ack lists, which the engine owns. */
  buildRequest: () => Promise<Omit<SyncRequest, "ackedCommandIds" | "ackedNotificationIds">>;
  onResponse: (response: SyncResponse) => void | Promise<void>;
  isBackground?: () => boolean;
  now?: () => number;
  random?: () => number;
  timers?: Timers;
  log?: (entry: SyncLogEntry) => void;
};

export function createSyncEngine(deps: SyncEngineDeps) {
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const timers: Timers = deps.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  const ackedCommands = new Set<string>();
  const ackedNotifications = new Set<string>();
  let failures = 0;
  let lastAttemptAt: number | null = null;
  let timer: unknown = null;
  let nextAt: number | null = null;
  let running = false;
  let inFlight: Promise<SyncOutcome> | null = null;
  let rerun = false;

  function schedule(ms: number) {
    if (!running) return;
    if (timer !== null) timers.clearTimeout(timer);
    const delay = deps.isBackground?.() ? Math.max(ms, BACKGROUND_POLL_MS) : ms;
    nextAt = now() + delay;
    timer = timers.setTimeout(() => {
      timer = null;
      void syncNow("poll");
    }, delay);
  }

  function remember(set: Set<string>, id: string) {
    set.add(id);
    while (set.size > MAX_PENDING_ACKS) {
      const first = set.values().next().value;
      if (first === undefined) break;
      set.delete(first);
    }
  }

  async function attempt(reason: string): Promise<SyncOutcome> {
    lastAttemptAt = now();
    const sentCommands = [...ackedCommands];
    const sentNotifications = [...ackedNotifications];
    let status: number | null = null;
    try {
      const base = await deps.buildRequest();
      const body: SyncRequest = {
        ...base,
        ackedCommandIds: sentCommands,
        ackedNotificationIds: sentNotifications,
      };
      const result = await deps.transport(SYNC_PATH, body, SYNC_TIMEOUT_MS);
      status = result.status;
      if (status < 200 || status >= 300) throw new Error(`status ${status}`);
      const response = parseSyncResponseText(result.body);
      for (const id of sentCommands) ackedCommands.delete(id);
      for (const id of sentNotifications) ackedNotifications.delete(id);
      failures = 0;
      schedule(pollDelayMs(response.pollAfterSec, random));
      try {
        await deps.onResponse(response);
      } catch {
        // A handler bug must never stop polling.
      }
      deps.log?.({ at: now(), kind: "sync", outcome: "ok", status, reason });
      return "ok";
    } catch {
      failures += 1;
      schedule(nextBackoffMs(failures, random));
      deps.log?.({ at: now(), kind: "sync", outcome: "failed", status, reason });
      return "failed";
    }
  }

  /** Never throws. Calls within 20 s of the last attempt are coalesced. */
  async function syncNow(reason = "manual"): Promise<SyncOutcome> {
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    // While failing, only the backoff timer may retry; focus/auth triggers wait for it.
    if (reason !== "poll" && failures > 0 && nextAt !== null && nextAt > now()) {
      deps.log?.({ at: now(), kind: "sync", outcome: "deferred", status: null, reason });
      return "deferred";
    }
    if (lastAttemptAt !== null) {
      const wait = lastAttemptAt + MIN_SYNC_GAP_MS - now();
      if (wait > 0) {
        if (nextAt === null || nextAt > now() + wait) schedule(wait);
        deps.log?.({ at: now(), kind: "sync", outcome: "deferred", status: null, reason });
        return "deferred";
      }
    }
    inFlight = attempt(reason);
    try {
      return await inFlight;
    } finally {
      inFlight = null;
      if (rerun) {
        rerun = false;
        void syncNow("coalesced");
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void syncNow("launch");
    },
    stop() {
      running = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      nextAt = null;
    },
    syncNow,
    ackCommand: (id: string) => remember(ackedCommands, id),
    ackNotification: (id: string) => remember(ackedNotifications, id),
    snapshot: () => ({
      failures,
      lastAttemptAt,
      nextAt,
      pendingCommandAcks: [...ackedCommands],
      pendingNotificationAcks: [...ackedNotifications],
    }),
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
