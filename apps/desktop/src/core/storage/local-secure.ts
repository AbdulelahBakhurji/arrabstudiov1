/**
 * On-device workspace vault — encrypts companions + chat caches at rest.
 * Key material is partitioned by signed-in account so switching accounts
 * never opens another account's sealed chats.
 */
import { accountPartitionAliases, accountPartitionId, subscribeAccountPartition } from "../session/account-partition";
import {
  decryptJson,
  encryptJson,
  importRawAesKey,
  isCryptoEnvelope,
  randomKeyB64,
  type CryptoEnvelopeV1,
} from "./crypto-envelope";
import { getSecureStorage } from "../platform/secure-storage";

const LEGACY_KEY_ID = "workspace.aes.v1";

let cachedKey: CryptoKey | null = null;
let cachedPartition: string | null = null;

function keyIdFor(partition: string): string {
  return `${LEGACY_KEY_ID}.${partition}`;
}

async function loadOrCreateRawKey(partition: string): Promise<string> {
  // OS Keychain where the platform has one; the app-data file store otherwise (see secure-storage).
  const store = await getSecureStorage();
  const id = keyIdFor(partition);
  const existing = await store.get(id);
  if (existing && existing.length >= 40) {
    return existing;
  }
  // Adopt older colon-style or pre-partition device keys into this account.
  if (partition !== "guest") {
    for (const alias of accountPartitionAliases()) {
      if (alias === partition) continue;
      const aliasKey = await store.get(keyIdFor(alias));
      if (aliasKey && aliasKey.length >= 40) {
        await store.set(id, aliasKey);
        await store.remove(keyIdFor(alias));
        return aliasKey;
      }
    }
    const legacy = await store.get(LEGACY_KEY_ID);
    if (legacy && legacy.length >= 40) {
      await store.set(id, legacy);
      return legacy;
    }
  }
  const created = randomKeyB64();
  await store.set(id, created);
  return created;
}

function resetKeyCache(): void {
  cachedKey = null;
  cachedPartition = null;
}

subscribeAccountPartition(resetKeyCache);

export async function getWorkspaceCryptoKey(): Promise<CryptoKey> {
  const partition = accountPartitionId();
  if (cachedKey && cachedPartition === partition) return cachedKey;
  const raw = await loadOrCreateRawKey(partition);
  cachedKey = await importRawAesKey(raw);
  cachedPartition = partition;
  return cachedKey;
}

export async function sealLocalJson(value: unknown): Promise<CryptoEnvelopeV1> {
  const key = await getWorkspaceCryptoKey();
  return encryptJson(key, value);
}

export async function openLocalJson<T = unknown>(value: unknown): Promise<T> {
  if (!isCryptoEnvelope(value)) {
    return value as T;
  }
  const key = await getWorkspaceCryptoKey();
  return decryptJson<T>(key, value);
}

export function looksEncryptedLocal(value: unknown): boolean {
  return isCryptoEnvelope(value);
}

/** Drop this account's workspace AES key (local sealed data becomes unreadable). */
export async function wipeWorkspaceVaultKey(): Promise<void> {
  const store = await getSecureStorage();
  for (const part of accountPartitionAliases()) {
    await store.remove(keyIdFor(part));
  }
  resetKeyCache();
}
