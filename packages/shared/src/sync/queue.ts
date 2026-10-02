import type { PushResult, SyncOp, SyncRecord, SyncTransport } from "./protocol.js";

/** Durable storage for the queue. Desktop: file/SQLite; mobile: SQLite/Room/Core Data adapter. */
export interface QueueStorage {
  load(): Promise<SyncOp[]>;
  save(ops: SyncOp[]): Promise<void>;
}

export interface QueueOptions {
  now?: () => number;
  /** Largest queue we keep; beyond it new ops are refused loudly rather than silently dropped. */
  maxOps?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** After this many failed attempts an op is parked as `stuck` and the UI shows a sync error. */
  maxAttempts?: number;
  random?: () => number;
}

export interface DrainOutcome {
  pushed: number;
  conflicts: Array<{ op: SyncOp; current: SyncRecord }>;
  rejected: Array<{ op: SyncOp; reason: string }>;
  /** Ops that are waiting for a retry. */
  pending: number;
  /** Ops that exhausted their attempts (need user attention). */
  stuck: number;
  /** Stopped early because the transport reported a retryable failure. */
  interrupted: boolean;
}

export class QueueFullError extends Error {
  constructor() {
    super("Too many unsynchronised changes. Reconnect to sync before making more.");
    this.name = "QueueFullError";
  }
}

/**
 * Offline operation queue: persisted *before* any network attempt, delivered in order per record,
 * retried with exponential backoff + jitter, idempotent by `opId`.
 */
export class OfflineQueue {
  private ops: SyncOp[] = [];
  private loaded = false;
  private draining: Promise<DrainOutcome> | null = null;
  private readonly now: () => number;
  private readonly maxOps: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;

  constructor(
    private readonly storage: QueueStorage,
    options: QueueOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxOps = options.maxOps ?? 5_000;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 12;
    this.random = options.random ?? Math.random;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.ops = await this.storage.load();
    this.loaded = true;
  }

  private persist(): Promise<void> {
    return this.storage.save(this.ops);
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.ops.length;
  }

  async snapshot(): Promise<readonly SyncOp[]> {
    await this.ensureLoaded();
    return [...this.ops];
  }

  async stuckCount(): Promise<number> {
    await this.ensureLoaded();
    return this.ops.filter((op) => op.attempts >= this.maxAttempts).length;
  }

  /**
   * Record a local change. Resolves only after it is durably stored, so a crash right after
   * "saved" cannot lose the edit. A second pending edit to the same record is coalesced
   * (patches merged, original `baseRev` kept) to keep the queue small while offline.
   */
  async enqueue(op: Omit<SyncOp, "attempts" | "nextAttemptAt">): Promise<void> {
    await this.ensureLoaded();
    if (this.ops.some((existing) => existing.opId === op.opId)) return;
    let last: SyncOp | undefined;
    for (let index = this.ops.length - 1; index >= 0; index -= 1) {
      const candidate = this.ops[index]!;
      if (candidate.kind === op.kind && candidate.id === op.id) {
        last = candidate;
        break;
      }
    }
    if (last && last.type === "upsert" && op.type === "upsert" && last.attempts === 0) {
      last.patch = { ...last.patch, ...op.patch };
    } else {
      if (this.ops.length >= this.maxOps) throw new QueueFullError();
      this.ops.push({ ...op, attempts: 0, nextAttemptAt: null });
    }
    await this.persist();
  }

  private delay(attempts: number, hint?: number): number {
    if (hint !== undefined) return Math.min(this.maxDelayMs, Math.max(0, hint));
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(exp / 2 + this.random() * (exp / 2)); // "equal jitter"
  }

  /** Deliver everything that is due. Concurrent calls share one run. */
  drain(transport: SyncTransport): Promise<DrainOutcome> {
    this.draining ??= this.run(transport).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async run(transport: SyncTransport): Promise<DrainOutcome> {
    await this.ensureLoaded();
    const outcome: DrainOutcome = {
      pushed: 0,
      conflicts: [],
      rejected: [],
      pending: 0,
      stuck: 0,
      interrupted: false,
    };
    const blockedRecords = new Set<string>();

    for (const op of [...this.ops]) {
      const key = `${op.kind}:${op.id}`;
      // Order matters per record: do not send edit 2 while edit 1 is still waiting.
      if (blockedRecords.has(key)) continue;
      if (op.attempts >= this.maxAttempts) {
        blockedRecords.add(key);
        continue;
      }
      if (op.nextAttemptAt && Date.parse(op.nextAttemptAt) > this.now()) {
        blockedRecords.add(key);
        continue;
      }

      let result: PushResult;
      try {
        result = await transport.push(op);
      } catch (error) {
        result = {
          status: "retry",
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      if (result.status === "ok") {
        this.ops = this.ops.filter((item) => item.opId !== op.opId);
        outcome.pushed += 1;
      } else if (result.status === "conflict") {
        // Hand the conflict to the caller to merge and re-enqueue; the op itself is done.
        this.ops = this.ops.filter((item) => item.opId !== op.opId);
        outcome.conflicts.push({ op, current: result.current });
      } else if (result.status === "rejected") {
        this.ops = this.ops.filter((item) => item.opId !== op.opId);
        outcome.rejected.push({ op, reason: result.reason });
      } else {
        op.attempts += 1;
        op.nextAttemptAt = new Date(
          this.now() + this.delay(op.attempts, result.afterMs),
        ).toISOString();
        blockedRecords.add(key);
        // A transport-level failure usually affects every record: stop and let the caller wait.
        outcome.interrupted = true;
        await this.persist();
        break;
      }
      await this.persist();
    }

    outcome.pending = this.ops.length;
    outcome.stuck = this.ops.filter((op) => op.attempts >= this.maxAttempts).length;
    return outcome;
  }
}
