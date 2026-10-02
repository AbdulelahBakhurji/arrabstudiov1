/**
 * Arrab sync protocol — shared by every client (macOS, Windows, iOS, Android, Huawei) and the API.
 *
 * Design rules:
 *  - Every synced record carries a monotonically increasing `rev` and the `baseRev` an edit was made on.
 *  - The server accepts a write only against the revision the client last saw; otherwise it answers
 *    with the current record and the client merges (see merge.ts). Silent last-write-wins is not allowed.
 *  - Writes are idempotent (`opId`), so retries after a dropped connection cannot duplicate work.
 *  - The protocol is versioned; a client announces its version and the server can refuse or downgrade.
 */

/** Bump when the wire format changes incompatibly. Additive changes do not bump it. */
export const SYNC_PROTOCOL_VERSION = 1;
/** Oldest protocol version the server still speaks. */
export const SYNC_PROTOCOL_MIN_VERSION = 1;

export type SyncEntityKind = "project" | "conversation" | "message" | "agent" | "setting" | "task";

/** A record as stored and synchronised. `data` is opaque to the sync layer. */
export interface SyncRecord<T = Record<string, unknown>> {
  kind: SyncEntityKind;
  id: string;
  /** Server-assigned, increases by one on every accepted write. */
  rev: number;
  /** Soft delete. A tombstone keeps its revision so other devices learn about the deletion. */
  deleted: boolean;
  updatedAt: string;
  /** Device that made the last accepted write. */
  updatedBy: string;
  data: T;
}

export type SyncOpType = "upsert" | "delete";

/** A change made on this device that has not been acknowledged yet. */
export interface SyncOp {
  /** Client-generated and unique: the server treats a repeat as already applied. */
  opId: string;
  type: SyncOpType;
  kind: SyncEntityKind;
  id: string;
  /** Revision of the record this edit was based on (0 = new record). */
  baseRev: number;
  /** Fields changed by this edit (an `upsert` patch). */
  patch: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  /** Do not retry before this instant (ISO). */
  nextAttemptAt: string | null;
}

export type PushResult =
  | { status: "ok"; record: SyncRecord }
  /** The record moved on: here is the server's current version. */
  | { status: "conflict"; current: SyncRecord }
  /** Network / 5xx / 429: keep the op and retry later. */
  | { status: "retry"; afterMs?: number; reason?: string }
  /** The server will never accept this op (validation, permission). */
  | { status: "rejected"; reason: string };

export interface SyncTransport {
  push(op: SyncOp): Promise<PushResult>;
}

/** What the UI shows. */
export type SyncStatus = "online" | "connecting" | "offline" | "syncing" | "sync-error";

export interface PullRequest {
  protocol: number;
  /** Opaque cursor from the previous pull (empty on first sync). */
  cursor: string;
  kinds?: SyncEntityKind[];
  limit?: number;
}

export interface PullResponse {
  protocol: number;
  records: SyncRecord[];
  /** More pages are waiting; pull again with `cursor`. */
  hasMore: boolean;
  cursor: string;
}

export interface ClientHello {
  protocol: number;
  platform: string;
  appVersion: string;
  deviceId: string;
}

export interface ServerHello {
  protocol: number;
  minProtocol: number;
  /** Client versions below this must update before syncing. */
  minClientVersion: string | null;
  serverTime: string;
}

export function protocolCompatible(
  clientProtocol: number,
  server: Pick<ServerHello, "protocol" | "minProtocol">,
): boolean {
  return clientProtocol >= server.minProtocol && clientProtocol <= server.protocol;
}
