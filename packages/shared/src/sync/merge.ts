import type { SyncRecord } from "./protocol.js";

export interface FieldConflict {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface MergeResult {
  /** Fields to write back; everything non-conflicting from both sides is combined. */
  data: Record<string, unknown>;
  /** Fields both sides changed differently. Nothing here is lost: `local` is preserved for the user. */
  conflicts: FieldConflict[];
  /** True when the remote deletion was overridden because the local side kept editing. */
  resurrected: boolean;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way, field-level merge.
 *
 *  - changed only locally  → keep local
 *  - changed only remotely → keep remote
 *  - changed to the same value → that value
 *  - changed differently on both → conflict: the *remote* value is written (so every device
 *    converges on the same record) and the *local* value is returned in `conflicts`, so the client
 *    can keep it as a conflict copy instead of discarding the user's text.
 *
 * `base` is the record as this device last synced it, `local` the device's full current state
 * (base + its own edits — not just a patch), `remote` the server's current record.
 *
 * Edit-vs-delete is resolved in favour of the edit: losing someone's work is worse than keeping a
 * record they meant to delete, and a delete is one tap to redo.
 */
export function mergeRecord(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: SyncRecord,
  localDeleted = false,
): MergeResult {
  if (remote.deleted && !localDeleted) {
    const edited = Object.keys(local).some((key) => !same(local[key], base[key]));
    if (edited) return { data: { ...local }, conflicts: [], resurrected: true };
  }

  const data: Record<string, unknown> = { ...remote.data };
  const conflicts: FieldConflict[] = [];
  for (const field of new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote.data),
  ])) {
    const b = base[field];
    const l = local[field];
    const r = remote.data[field];
    const localChanged = !same(l, b);
    const remoteChanged = !same(r, b);
    if (localChanged && !remoteChanged) data[field] = l;
    else if (!localChanged) data[field] = r;
    else if (same(l, r)) data[field] = r;
    else {
      data[field] = r;
      conflicts.push({ field, base: b, local: l, remote: r });
    }
  }
  return { data, conflicts, resurrected: false };
}

export interface HasIdAndTime {
  id: string;
  createdAt: string;
}

/**
 * Append-only collections (chat messages): the union of both sides, de-duplicated by id and ordered
 * by time. Concurrent appends from two devices both survive; nothing is overwritten.
 */
export function mergeAppendOnly<T extends HasIdAndTime>(
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of [...remote, ...local]) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
