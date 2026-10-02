import type { SyncStatus } from "./protocol.js";

export interface SyncInputs {
  /** Device-level connectivity (from the platform network monitor). */
  network: "online" | "offline";
  /** Trying to establish a session / first request after reconnect. */
  connecting: boolean;
  /** A drain/pull is in flight. */
  syncing: boolean;
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes that gave up retrying. */
  stuck: number;
  /** The last sync attempt failed for a reason other than being offline. */
  lastError: string | null;
}

/**
 * One place decides what the user is told. Precedence: no network beats everything (changes are
 * safe locally); a stuck op is surfaced as an error even while online; otherwise in-flight work.
 */
export function deriveSyncStatus(input: SyncInputs): SyncStatus {
  if (input.network === "offline") return "offline";
  if (input.stuck > 0 || input.lastError) return "sync-error";
  if (input.connecting) return "connecting";
  if (input.syncing || input.pending > 0) return "syncing";
  return "online";
}
