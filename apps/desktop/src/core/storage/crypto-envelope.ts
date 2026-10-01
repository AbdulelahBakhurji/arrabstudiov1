/**
 * Web Crypto AES-256-GCM envelopes for on-device secrets.
 * Used for companions localStorage and chat device-store caches.
 */
const PBKDF2_ITERATIONS = 310_000;

export type CryptoEnvelopeV1 = {
  v: 1;
  iv: string;
  ct: string;
};

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

export function isCryptoEnvelope(value: unknown): value is CryptoEnvelopeV1 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as CryptoEnvelopeV1).v === 1 &&
      typeof (value as CryptoEnvelopeV1).iv === "string" &&
      typeof (value as CryptoEnvelopeV1).ct === "string",
  );
}

export async function deriveAesKey(secret: string, saltB64: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(b64ToBytes(saltB64)),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function importRawAesKey(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(rawB64)),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function randomKeyB64(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomSaltB64(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<CryptoEnvelopeV1> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value ?? null));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(plain),
  );
  return { v: 1, iv: bytesToB64(iv), ct: bytesToB64(cipher) };
}

export async function decryptJson<T = unknown>(key: CryptoKey, envelope: CryptoEnvelopeV1): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(b64ToBytes(envelope.iv)) },
    key,
    asBufferSource(b64ToBytes(envelope.ct)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
