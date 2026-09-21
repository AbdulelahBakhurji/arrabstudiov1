/**
 * On-device workspace vault — encrypts companions + chat caches at rest.
 * Key material never leaves the device store.
 */
import {
  decryptJson,
  encryptJson,
  importRawAesKey,
  isCryptoEnvelope,
  randomKeyB64,
  type CryptoEnvelopeV1,
} from "./crypto-envelope";
import { deviceStoreGet, deviceStoreSet } from "./device-store";

const KEY_NS = "secure";
const KEY_ID = "workspace.aes.v1";

let cachedKey: CryptoKey | null = null;

async function loadOrCreateRawKey(): Promise<string> {
  const existing = await deviceStoreGet(KEY_NS, KEY_ID);
  if (existing && existing.length >= 40) {
    return existing;
  }
  const created = randomKeyB64();
  await deviceStoreSet(KEY_NS, KEY_ID, created);
  return created;
}

export async function getWorkspaceCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = await loadOrCreateRawKey();
  cachedKey = await importRawAesKey(raw);
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
