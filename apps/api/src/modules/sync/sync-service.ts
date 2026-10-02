import { ValidationError } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  SYNC_PROTOCOL_MIN_VERSION,
  SYNC_PROTOCOL_VERSION,
  type PullResponse,
  type PushResult,
  type SyncEntityKind,
  type SyncRecord,
} from "@arrab/shared";
import type { Clock } from "@arrab/core";
import { systemClock } from "@arrab/core";

const KINDS: ReadonlySet<string> = new Set<SyncEntityKind>([
  "project",
  "conversation",
  "message",
  "agent",
  "setting",
  "task",
]);
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const OP_ID = /^[A-Za-z0-9_.:-]{8,120}$/;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_BATCH = 50;
const MAX_PAGE = 500;

export interface PushOpInput {
  opId?: unknown;
  type?: unknown;
  kind?: unknown;
  id?: unknown;
  baseRev?: unknown;
  patch?: unknown;
}

/**
 * Server side of the sync protocol: compare-and-set writes (a stale edit gets the current record back
 * instead of overwriting it), idempotent by op id, and a cursor-based pull.
 */
export class SyncService {
  constructor(
    private readonly persistence: Persistence,
    /** Which user's records are these (account owner / org employee / family seat). */
    private readonly resolveOwner: () => Promise<string>,
    private readonly clock: Clock = systemClock,
  ) {}

  hello(minClientVersion: string | null) {
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      minProtocol: SYNC_PROTOCOL_MIN_VERSION,
      minClientVersion,
      serverTime: this.clock.isoNow(),
    };
  }

  private parse(raw: PushOpInput) {
    const type = raw.type === "delete" ? "delete" : raw.type === "upsert" ? "upsert" : null;
    if (!type) throw new ValidationError("Unknown operation type");
    if (typeof raw.opId !== "string" || !OP_ID.test(raw.opId))
      throw new ValidationError("Invalid op id");
    if (typeof raw.kind !== "string" || !KINDS.has(raw.kind))
      throw new ValidationError("Unknown record kind");
    if (typeof raw.id !== "string" || !ID.test(raw.id))
      throw new ValidationError("Invalid record id");
    const baseRev = raw.baseRev;
    if (typeof baseRev !== "number" || !Number.isInteger(baseRev) || baseRev < 0) {
      throw new ValidationError("Invalid base revision");
    }
    const patch =
      raw.patch && typeof raw.patch === "object" && !Array.isArray(raw.patch)
        ? (raw.patch as Record<string, unknown>)
        : {};
    if (JSON.stringify(patch).length > MAX_PATCH_BYTES)
      throw new ValidationError("Change is too large");
    return { type, opId: raw.opId, kind: raw.kind as SyncEntityKind, id: raw.id, baseRev, patch };
  }

  async push(rawOps: unknown, deviceId: string): Promise<{ results: PushResult[] }> {
    if (!Array.isArray(rawOps) || rawOps.length === 0 || rawOps.length > MAX_BATCH) {
      throw new ValidationError(`Send between 1 and ${MAX_BATCH} operations`);
    }
    const owner = await this.resolveOwner();
    const results: PushResult[] = [];
    for (const raw of rawOps as PushOpInput[]) {
      results.push(await this.applyOne(owner, this.parse(raw), deviceId));
    }
    return { results };
  }

  private async applyOne(
    owner: string,
    op: ReturnType<SyncService["parse"]>,
    deviceId: string,
  ): Promise<PushResult> {
    const repo = this.persistence.syncRecords;
    const already = await repo.getOpResult(owner, op.opId);
    if (already) return { status: "ok", record: already };

    const current = await repo.get(owner, op.kind, op.id);
    const currentRev = current?.rev ?? 0;
    if (currentRev !== op.baseRev) {
      return current
        ? { status: "conflict", current }
        : { status: "rejected", reason: "The record this change was based on no longer exists" };
    }

    const next: SyncRecord = {
      kind: op.kind,
      id: op.id,
      rev: currentRev + 1,
      deleted: op.type === "delete",
      updatedAt: this.clock.isoNow(),
      updatedBy: deviceId,
      data:
        op.type === "delete" ? (current?.data ?? {}) : { ...(current?.data ?? {}), ...op.patch },
    };
    const stored = await repo.compareAndSet(owner, next, currentRev, op.opId);
    if (stored) return { status: "ok", record: stored.record };

    // Lost a race with another device between the read and the write.
    const latest = await repo.get(owner, op.kind, op.id);
    return latest ? { status: "conflict", current: latest } : { status: "retry", reason: "busy" };
  }

  async pull(
    cursor: string | undefined,
    limit: number | undefined,
    kinds: string[] | undefined,
  ): Promise<PullResponse> {
    const after = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(after) || after < 0) throw new ValidationError("Invalid cursor");
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Math.trunc(limit ?? 200)));
    const wanted = (kinds ?? []).filter((kind) => KINDS.has(kind));
    const owner = await this.resolveOwner();
    const rows = await this.persistence.syncRecords.listAfter(owner, after, pageSize + 1, wanted);
    const page = rows.slice(0, pageSize);
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      records: page.map((row) => row.record),
      hasMore: rows.length > pageSize,
      cursor: String(page.length ? page[page.length - 1]!.seq : after),
    };
  }

  /** Wipe this user's synced records (account removal / "delete my data"). */
  async purgeAll(): Promise<void> {
    await this.persistence.syncRecords.purgeWorkspace();
  }
}
