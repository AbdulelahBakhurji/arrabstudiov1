/**
 * Field-level AES-256-GCM encryption for data at rest.
 * Ciphertext is prefixed with `arrab1:` so legacy plaintext rows still load.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "arrab1:";

let cachedKey: Buffer | null = null;

function resolveKeyMaterial(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    // Deterministic fallback for local file mode — still encrypts at rest on disk,
    // but production MUST set DATA_ENCRYPTION_KEY.
    return createHash("sha256").update("arrab-local-dev-data-key-v1").digest();
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

export function configureFieldCrypto(dataEncryptionKey: string | undefined): void {
  cachedKey = resolveKeyMaterial(dataEncryptionKey);
}

function key(): Buffer {
  if (!cachedKey) {
    cachedKey = resolveKeyMaterial(process.env.DATA_ENCRYPTION_KEY);
  }
  return cachedKey;
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
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
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
