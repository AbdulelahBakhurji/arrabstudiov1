/**
 * Field-level AES-256-GCM encryption for data at rest.
 * Ciphertext is prefixed with `arrab1:` so legacy plaintext rows still load.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PREFIX = "arrab1:";

let cachedKey: Buffer | null = null;
/**
 * Data written before per-install keys existed was sealed with a key derived from a constant in
 * this source file. It is only kept to *read* that data (it is re-sealed with the real key on the
 * next write); it must never be used to encrypt anything new.
 */
const LEGACY_DEV_KEY = createHash("sha256").update("arrab-local-dev-data-key-v1").digest();
let legacyReadFallback = false;

/**
 * Local installs without DATA_ENCRYPTION_KEY get a random per-install key stored beside the data
 * (0600), instead of a key anyone can compute from the source code.
 */
function localInstallKey(dataDir: string | undefined): Buffer {
  if (!dataDir) return randomBytes(32); // in-memory: nothing outlives the process
  const file = path.join(dataDir, ".data-key");
  if (existsSync(file)) {
    const stored = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
    if (stored.length === 32) return stored;
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const fresh = randomBytes(32);
  writeFileSync(file, fresh.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // best effort on filesystems without POSIX modes
  }
  return fresh;
}

function resolveKeyMaterial(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new Error("DATA_ENCRYPTION_KEY is not configured");
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  try {
    const b64 = Buffer.from(value, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // fall through
  }
  return createHash("sha256").update(value).digest();
}

export function configureFieldCrypto(
  dataEncryptionKey: string | undefined,
  dataDir?: string,
  /** Database-backed server explicitly started without a key (ARRAB_ALLOW_INSECURE_DATA_KEY=1). */
  insecureLegacyKey = false,
): void {
  if (!dataEncryptionKey?.trim() && insecureLegacyKey) {
    // A random per-process key would make rows unreadable after a restart; keep the old behaviour
    // for this explicit, warned-about override only.
    cachedKey = LEGACY_DEV_KEY;
    legacyReadFallback = false;
  } else if (dataEncryptionKey?.trim()) {
    cachedKey = resolveKeyMaterial(dataEncryptionKey);
    legacyReadFallback = false;
  } else {
    cachedKey = localInstallKey(dataDir);
    legacyReadFallback = Boolean(dataDir);
  }
}

function key(): Buffer {
  if (!cachedKey) {
    configureFieldCrypto(process.env.DATA_ENCRYPTION_KEY);
  }
  return cachedKey!;
}

export function isEncryptedField(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptField(plain: string): string {
  if (!plain) return plain;
  if (isEncryptedField(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptField(value: string): string {
  if (!value || !isEncryptedField(value)) return value;
  const body = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Corrupt encrypted field");
  }
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const open = (withKey: Buffer) => {
    const decipher = createDecipheriv("aes-256-gcm", withKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  };
  try {
    return open(key());
  } catch (error) {
    if (!legacyReadFallback) throw error;
    return open(LEGACY_DEV_KEY);
  }
}

export function encryptJson(value: unknown): string {
  return encryptField(JSON.stringify(value ?? null));
}

export function decryptJson<T = unknown>(value: string): T {
  return JSON.parse(decryptField(value)) as T;
}

export function sealMaybeJson(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" && isEncryptedField(value)) return value;
  return encryptJson(value);
}

export function openMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!isEncryptedField(value)) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return decryptJson(value);
}
