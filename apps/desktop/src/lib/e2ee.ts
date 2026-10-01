/**
 * Zero-knowledge chat encryption.
 *
 * A random 256-bit chat key encrypts every transcript on the device (AES-256-GCM).
 * The key is wrapped with a key derived from the user's passphrase (PBKDF2-SHA256)
 * and only the wrapped blob is uploaded, so any signed-in device can unlock the same
 * history with the passphrase while the server only ever stores ciphertext.
 *
 * Cloud models still need plaintext for the turn itself (sent over TLS, never stored —
 * see `ephemeral` in SendMessageRequest).
 */
import type { Conversation, Message, WrappedChatKey } from "@arrab/shared";
import { accountPartitionId, subscribeAccountPartition } from "./account-partition";
import { onAccountSignOut } from "./account-session";
import { readOrgEmployeeSession } from "./org-employee-session";
import { deviceStoreGet, deviceStoreRemove, deviceStoreSet } from "./device-store";

const KEY_NS = "secure";
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSPHRASE = 10;

export type E2eeState = "unknown" | "needs-setup" | "locked" | "unlocked";

export type SealedTranscript = { conversation: Conversation; messages: Message[] };

type Api = {
  e2eeKey: () => Promise<{ wrappedKey: WrappedChatKey | null }>;
  e2eePutKey: (body: { wrappedKey: WrappedChatKey; replace?: boolean }) => Promise<unknown>;
  e2eeChats: (since?: string) => Promise<{
    items: Array<{ id: string; sealed: string; updatedAt: string }>;
    deleted: string[];
  }>;
  e2eePutChat: (id: string, body: { sealed: string }) => Promise<unknown>;
  e2eeDeleteChat: (id: string) => Promise<unknown>;
  e2eeReset: () => Promise<unknown>;
};

let api: Api | null = null;
/** api.ts registers itself here (avoids a circular import with the request layer). */
export function bindE2eeApi(next: Api): void {
  api = next;
}
function requireApi(): Api {
  if (!api) throw new Error("Encryption is not ready yet");
  return api;
}

let chatKey: CryptoKey | null = null;
let chatKeyOwner: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeE2ee(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Vaults are per user: account partition plus the org seat, if any. */
function ownerTag(): string {
  const seat = readOrgEmployeeSession()?.employee.id;
  return seat ? `${accountPartitionId()}.emp-${seat}` : accountPartitionId();
}

function storedKeyId(): string {
  return `e2ee.chatkey.${ownerTag()}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

subscribeAccountPartition(() => {
  chatKey = null;
  chatKeyOwner = null;
  notify();
});

// ── byte helpers ────────────────────────────────────────────────────────────
function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function fingerprintOf(raw: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf(raw));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function passphraseKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapRawKey(raw: Uint8Array, passphrase: string): Promise<WrappedChatKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await passphraseKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, kek, buf(raw));
  return {
    v: 1,
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    fingerprint: await fingerprintOf(raw),
  };
}

async function unwrapRawKey(wrapped: WrappedChatKey, passphrase: string): Promise<Uint8Array> {
  const kek = await passphraseKey(passphrase, fromB64(wrapped.salt), wrapped.iterations);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(fromB64(wrapped.iv)) },
      kek,
      buf(fromB64(wrapped.ct)),
    );
  } catch {
    throw new Error("Wrong passphrase");
  }
  const bytes = new Uint8Array(raw);
  if ((await fingerprintOf(bytes)) !== wrapped.fingerprint) throw new Error("Wrong passphrase");
  return bytes;
}

async function useRawKey(raw: Uint8Array, persist: boolean): Promise<void> {
  chatKey = await crypto.subtle.importKey("raw", buf(raw), { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  chatKeyOwner = ownerTag();
  if (persist) await deviceStoreSet(KEY_NS, storedKeyId(), toB64(raw));
  notify();
}

// ── state ───────────────────────────────────────────────────────────────────
export function isE2eeUnlocked(): boolean {
  return chatKey !== null && chatKeyOwner === ownerTag();
}

/** Restore this device's saved key (set after the first successful unlock here). */
async function restoreDeviceKey(): Promise<boolean> {
  if (isE2eeUnlocked()) return true;
  const stored = await deviceStoreGet(KEY_NS, storedKeyId());
  if (!stored) return false;
  try {
    await useRawKey(fromB64(stored), false);
    return true;
  } catch {
    return false;
  }
}

export async function e2eeState(): Promise<E2eeState> {
  if (!crypto?.subtle) return "unknown";
  if (await restoreDeviceKey()) return "unlocked";
  try {
    const { wrappedKey } = await requireApi().e2eeKey();
    return wrappedKey ? "locked" : "needs-setup";
  } catch {
    return "unknown";
  }
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Use at least ${MIN_PASSPHRASE} characters for the encryption passphrase`);
  }
}

/** First-time setup: mint the chat key and upload only its passphrase-wrapped form. */
export async function setupE2ee(passphrase: string): Promise<void> {
  assertPassphrase(passphrase);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await requireApi().e2eePutKey({ wrappedKey: await wrapRawKey(raw, passphrase) });
  await useRawKey(raw, true);
}

/** Unlock on this device (or any new device) with the passphrase. */
export async function unlockE2ee(passphrase: string): Promise<void> {
  const { wrappedKey } = await requireApi().e2eeKey();
  if (!wrappedKey) throw new Error("Encryption is not set up yet");
  await useRawKey(await unwrapRawKey(wrappedKey, passphrase), true);
}

/** Re-wrap the same chat key under a new passphrase; history stays readable everywhere. */
export async function changeE2eePassphrase(current: string, next: string): Promise<void> {
  assertPassphrase(next);
  const { wrappedKey } = await requireApi().e2eeKey();
  if (!wrappedKey) throw new Error("Encryption is not set up yet");
  const raw = await unwrapRawKey(wrappedKey, current);
  await requireApi().e2eePutKey({ wrappedKey: await wrapRawKey(raw, next), replace: true });
}

/** Forgot the passphrase: ciphertext is unrecoverable, so wipe it and start over. */
export async function resetE2ee(): Promise<void> {
  await requireApi().e2eeReset();
  await lockE2ee();
}

/** Forget the key on this device (sign-out, lock). The server copy stays wrapped. */
export async function lockE2ee(): Promise<void> {
  chatKey = null;
  chatKeyOwner = null;
  await deviceStoreRemove(KEY_NS, storedKeyId()).catch(() => undefined);
  notify();
}

// Signing out forgets the chat key on this device (the server only holds the wrapped copy).
onAccountSignOut(() => void lockE2ee());

// ── seal / open ─────────────────────────────────────────────────────────────
/** AAD binds each blob to its chat id so the server cannot swap ciphertexts between chats. */
async function seal(id: string, value: unknown): Promise<string> {
  if (!isE2eeUnlocked() || !chatKey) throw new Error("Encryption is locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buf(iv), additionalData: buf(new TextEncoder().encode(id)) },
      chatKey,
      buf(plain),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

async function open<T>(id: string, sealed: string): Promise<T> {
  if (!isE2eeUnlocked() || !chatKey) throw new Error("Encryption is locked");
  const bytes = fromB64(sealed);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: buf(bytes.subarray(0, 12)),
      additionalData: buf(new TextEncoder().encode(id)),
    },
    chatKey,
    buf(bytes.subarray(12)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ── sync ────────────────────────────────────────────────────────────────────
const pushTimers = new Map<string, number>();
const SINCE_KEY = "arrab.e2ee.since.";

/** Debounced upload of one chat's sealed transcript. No-op while locked. */
export function queueSealedChatPush(conversation: Conversation, messages: Message[]): void {
  if (!isE2eeUnlocked()) return;
  const id = conversation.id;
  window.clearTimeout(pushTimers.get(id));
  pushTimers.set(
    id,
    window.setTimeout(() => {
      pushTimers.delete(id);
      void pushSealedChat(conversation, messages).catch(() => undefined);
    }, 1500),
  );
}

export async function pushSealedChat(conversation: Conversation, messages: Message[]): Promise<void> {
  if (!isE2eeUnlocked()) return;
  const sealed = await seal(conversation.id, { conversation, messages } satisfies SealedTranscript);
  await requireApi().e2eePutChat(conversation.id, { sealed });
}

export async function deleteSealedChat(id: string): Promise<void> {
  if (!isE2eeUnlocked()) return;
  await requireApi().e2eeDeleteChat(id).catch(() => undefined);
}

/**
 * Pull chats other devices sealed, decrypt them locally, and hand each to `onChat`
 * (the caller merges into its local cache). Returns how many were applied.
 */
export async function pullSealedChats(
  onChat: (chat: SealedTranscript) => Promise<void>,
  onDeleted?: (id: string) => Promise<void>,
): Promise<number> {
  if (!isE2eeUnlocked()) return 0;
  const sinceKey = `${SINCE_KEY}${ownerTag()}`;
  let since: string | undefined;
  try {
    since = localStorage.getItem(sinceKey) ?? undefined;
  } catch {
    since = undefined;
  }
  const remote = await requireApi().e2eeChats(since);
  let applied = 0;
  let newest = since ?? "";
  for (const item of remote.items) {
    try {
      await onChat(await open<SealedTranscript>(item.id, item.sealed));
      applied += 1;
    } catch {
      // Sealed under a different key (e.g. after a reset) — skip, never surface garbage.
    }
    if (item.updatedAt > newest) newest = item.updatedAt;
  }
  for (const id of remote.deleted) await onDeleted?.(id);
  if (newest) {
    try {
      localStorage.setItem(sinceKey, newest);
    } catch {
      // ignore
    }
  }
  return applied;
}

/** Prior turns for an `ephemeral` model call, from the local (decrypted) transcript. */
export function toPriorMessages(
  messages: Message[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}
