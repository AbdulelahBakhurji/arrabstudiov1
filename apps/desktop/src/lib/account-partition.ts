/**
 * Stable on-device partition for account-scoped local data.
 * Session tokens rotate; account id must not — same account keeps its vault.
 */
import {
  ACCOUNT_EVENT,
  readAccountId,
  readAccountSessionToken,
} from "./account-session";

function hashPartition(raw: string): string {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${Math.abs(h).toString(36)}${raw.length.toString(36)}`.slice(0, 16);
}

function readStableAccountId(): string | null {
  const stored = readAccountId();
  if (stored) return stored;
  try {
    const token = readAccountSessionToken();
    if (!token) return null;
    const raw = localStorage.getItem("arrab.account.status.cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      token?: string;
      status?: { account?: { id?: string } };
    };
    if (!parsed?.token || parsed.token !== token) return null;
    const id = parsed.status?.account?.id?.trim() ?? "";
    return id || null;
  } catch {
    return null;
  }
}

/** One partition per signed-in account. Guests share a local `guest` bucket.
 *  Only use characters safe for the Tauri device-store key sanitizer
 *  (alphanumeric, `.`, `_`, `-`) — never `:`.
 */
export function accountPartitionId(): string {
  if (!readAccountSessionToken()) return "guest";
  const accountId = readStableAccountId();
  if (accountId) return `id-${hashPartition(`acctid::${accountId}`)}`;
  const token = readAccountSessionToken();
  return token ? `tok-${hashPartition(`acct::${token}`)}` : "guest";
}

/** Older builds used `id:` / `tok:` — still recognized for wipe/migration. */
export function accountPartitionAliases(): string[] {
  const current = accountPartitionId();
  const aliases = new Set<string>([current]);
  if (current.startsWith("id-")) aliases.add(`id:${current.slice(3)}`);
  if (current.startsWith("tok-")) aliases.add(`tok:${current.slice(4)}`);
  if (current.startsWith("id:")) aliases.add(`id-${current.slice(3)}`);
  if (current.startsWith("tok:")) aliases.add(`tok-${current.slice(4)}`);
  return [...aliases];
}

export function subscribeAccountPartition(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = () => onChange();
  window.addEventListener(ACCOUNT_EVENT, handler);
  return () => window.removeEventListener(ACCOUNT_EVENT, handler);
}
