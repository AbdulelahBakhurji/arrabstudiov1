/**
 * Password-encrypted Incognito chat vault.
 * Ciphertext lives only on device (device-store "incognito").
 * The unlock key stays in RAM and is wiped on lock.
 */
import {
  deviceStoreClear,
  deviceStoreGet,
  deviceStoreKeys,
  deviceStoreRemove,
  deviceStoreSet,
} from "./device-store";

const META_KEY = "vault.meta";
const SESSION_PREFIX = "session.";
const PBKDF2_ITERATIONS = 310_000;
const VERIFIER_PLAIN = "arrab-incognito-v1";

export type IncognitoMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type IncognitoSession = {
  id: string;
  title: string;
  agentId: string | null;
  /** Ephemeral API conversation used for model calls; deleted on wipe/lock when possible. */
  apiConversationId: string | null;
  messages: IncognitoMessage[];
  updatedAt: string;
  createdAt: string;
};

type VaultMeta = {
  version: 1;
  saltB64: string;
  verifierIvB64: string;
  verifierCipherB64: string;
};

type SessionEnvelope = {
  version: 1;
  ivB64: string;
  cipherB64: string;
  updatedAt: string;
};

let unlockedKey: CryptoKey | null = null;

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<{ iv: Uint8Array; cipher: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(plain),
  );
  return { iv, cipher };
}

async function decryptBytes(key: CryptoKey, iv: Uint8Array, cipherB64: string): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(b64ToBytes(cipherB64)),
  );
  return new Uint8Array(plain);
}

async function readMeta(): Promise<VaultMeta | null> {
  const raw = await deviceStoreGet("incognito", META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultMeta;
    if (parsed?.version !== 1 || !parsed.saltB64) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function incognitoVaultExists(): Promise<boolean> {
  return (await readMeta()) != null;
}

export function isIncognitoUnlocked(): boolean {
  return unlockedKey != null;
}

export function lockIncognitoVault(): void {
  unlockedKey = null;
  clearIncognitoApiIds();
}

export async function createIncognitoVault(password: string): Promise<void> {
  if (password.trim().length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (await incognitoVaultExists()) {
    throw new Error("Vault already exists");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const { iv, cipher } = await encryptBytes(key, enc.encode(VERIFIER_PLAIN));
  const meta: VaultMeta = {
    version: 1,
    saltB64: bytesToB64(salt),
    verifierIvB64: bytesToB64(iv),
    verifierCipherB64: bytesToB64(cipher),
  };
  await deviceStoreSet("incognito", META_KEY, JSON.stringify(meta));
  unlockedKey = key;
}

export async function unlockIncognitoVault(password: string): Promise<void> {
  const meta = await readMeta();
  if (!meta) {
    throw new Error("No vault");
  }
  const key = await deriveKey(password, b64ToBytes(meta.saltB64));
  try {
    const plain = await decryptBytes(key, b64ToBytes(meta.verifierIvB64), meta.verifierCipherB64);
    const text = new TextDecoder().decode(plain);
    if (text !== VERIFIER_PLAIN) {
      throw new Error("Bad password");
    }
  } catch {
    throw new Error("Wrong password");
  }
  unlockedKey = key;
}

export async function changeIncognitoPassword(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  if (nextPassword.trim().length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  await unlockIncognitoVault(currentPassword);
  const sessions = await listIncognitoSessions();
  const full: IncognitoSession[] = [];
  for (const item of sessions) {
    const session = await loadIncognitoSession(item.id);
    if (session) full.push(session);
  }
  await wipeIncognitoVault({ keepUnlocked: false });
  await createIncognitoVault(nextPassword);
  for (const session of full) {
    await saveIncognitoSession(session);
    if (session.apiConversationId) {
      rememberIncognitoApiId(session.apiConversationId);
    }
  }
}

export async function wipeIncognitoVault(options?: { keepUnlocked?: boolean }): Promise<void> {
  await deviceStoreClear("incognito");
  clearIncognitoApiIds();
  if (!options?.keepUnlocked) {
    unlockedKey = null;
  }
}

function requireKey(): CryptoKey {
  if (!unlockedKey) {
    throw new Error("Vault is locked");
  }
  return unlockedKey;
}

export async function listIncognitoSessions(): Promise<
  Array<{ id: string; title: string; updatedAt: string; messageCount: number }>
> {
  const key = requireKey();
  const keys = (await deviceStoreKeys("incognito", SESSION_PREFIX)).filter((k) =>
    k.startsWith(SESSION_PREFIX),
  );
  const out: Array<{ id: string; title: string; updatedAt: string; messageCount: number }> = [];
  for (const storeKey of keys) {
    const raw = await deviceStoreGet("incognito", storeKey);
    if (!raw) continue;
    try {
      const envelope = JSON.parse(raw) as SessionEnvelope;
      const plain = await decryptBytes(key, b64ToBytes(envelope.ivB64), envelope.cipherB64);
      const session = JSON.parse(new TextDecoder().decode(plain)) as IncognitoSession;
      out.push({
        id: session.id,
        title: session.title || "Incognito",
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
      });
    } catch {
      // skip corrupt / wrong-key blobs
    }
  }
  return out.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function loadIncognitoSession(id: string): Promise<IncognitoSession | null> {
  const key = requireKey();
  const raw = await deviceStoreGet("incognito", `${SESSION_PREFIX}${id}`);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as SessionEnvelope;
    const plain = await decryptBytes(key, b64ToBytes(envelope.ivB64), envelope.cipherB64);
    return JSON.parse(new TextDecoder().decode(plain)) as IncognitoSession;
  } catch {
    return null;
  }
}

export async function saveIncognitoSession(session: IncognitoSession): Promise<void> {
  const key = requireKey();
  const payload: IncognitoSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  const enc = new TextEncoder();
  const { iv, cipher } = await encryptBytes(key, enc.encode(JSON.stringify(payload)));
  const envelope: SessionEnvelope = {
    version: 1,
    ivB64: bytesToB64(iv),
    cipherB64: bytesToB64(cipher),
    updatedAt: payload.updatedAt,
  };
  await deviceStoreSet("incognito", `${SESSION_PREFIX}${session.id}`, JSON.stringify(envelope));
}

export async function deleteIncognitoSession(id: string): Promise<void> {
  requireKey();
  await deviceStoreRemove("incognito", `${SESSION_PREFIX}${id}`);
}

export function newIncognitoSessionId(): string {
  return `inc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const API_IDS_KEY = "arrab.incognito.apiIds";

/** In-memory only — never leave API conversation ids in plaintext localStorage. */
const memoryApiIds = new Set<string>();

export function rememberIncognitoApiId(apiConversationId: string): void {
  memoryApiIds.add(apiConversationId);
  try {
    // Migrate/clear any legacy plaintext list from older builds.
    localStorage.removeItem(API_IDS_KEY);
  } catch {
    // ignore
  }
}

export function forgetIncognitoApiId(apiConversationId: string): void {
  memoryApiIds.delete(apiConversationId);
  try {
    localStorage.removeItem(API_IDS_KEY);
  } catch {
    // ignore
  }
}

export function listIncognitoApiIds(): Set<string> {
  try {
    localStorage.removeItem(API_IDS_KEY);
  } catch {
    // ignore
  }
  return new Set(memoryApiIds);
}

export function clearIncognitoApiIds(): void {
  memoryApiIds.clear();
  try {
    localStorage.removeItem(API_IDS_KEY);
  } catch {
    // ignore
  }
}
