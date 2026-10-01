/**
 * Zero-knowledge chat vault. Clients encrypt transcripts with a chat key that only
 * their passphrase can unwrap; this service stores and syncs the ciphertext per user
 * and cannot read any of it.
 */
import { ValidationError } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import type {
  E2eeChatsResponse,
  E2eeKeyResponse,
  E2eePutChatRequest,
  E2eePutKeyRequest,
  SealedChat,
  WrappedChatKey,
} from "@arrab/shared";
import { currentRequestActor } from "../../platform/context/request-actor.js";
import type { FamilyHouseholdService } from "../family/family-household-service.js";

const CHAT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** One sealed chat (ciphertext, base64) may be at most ~6 MB. */
const MAX_SEALED_CHARS = 6 * 1024 * 1024;
const MAX_CHATS_PER_USER = 2_000;
const MIN_PBKDF2_ITERATIONS = 200_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;

function assertB64(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || !B64.test(value)) {
    throw new ValidationError(`Invalid ${label}`);
  }
  return value;
}

export function validateWrappedKey(input: unknown): WrappedChatKey {
  const key = input as Partial<WrappedChatKey> | null;
  if (!key || key.v !== 1 || key.kdf !== "pbkdf2-sha256") {
    throw new ValidationError("Unsupported key format");
  }
  const iterations = Number(key.iterations);
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new ValidationError("Key derivation is too weak");
  }
  const fingerprint = String(key.fingerprint ?? "");
  if (!/^[a-f0-9]{8,64}$/.test(fingerprint)) throw new ValidationError("Invalid key fingerprint");
  return {
    v: 1,
    kdf: "pbkdf2-sha256",
    iterations,
    salt: assertB64(key.salt, "salt", 16, 128),
    iv: assertB64(key.iv, "iv", 12, 64),
    ct: assertB64(key.ct, "wrapped key", 32, 512),
    fingerprint,
  };
}

export class SealedVaultService {
  private familyHousehold: FamilyHouseholdService | null = null;

  constructor(private readonly persistence: Persistence) {}

  setFamilyHousehold(service: FamilyHouseholdService): void {
    this.familyHousehold = service;
  }

  /** Each user — org employee, family seat, or the account owner — has a separate vault. */
  private async ownerKey(): Promise<string> {
    const employeeId = currentRequestActor().employeeId;
    if (employeeId) return `emp:${employeeId}`;
    if (this.familyHousehold && (await this.familyHousehold.isFamilyPlanActive())) {
      const seatId = await this.familyHousehold.getActiveMemberId();
      if (seatId) return `seat:${seatId}`;
    }
    return "owner";
  }

  async getKey(): Promise<E2eeKeyResponse> {
    return { wrappedKey: await this.persistence.sealedVault.getKey(await this.ownerKey()) };
  }

  async putKey(input: E2eePutKeyRequest): Promise<E2eeKeyResponse> {
    const owner = await this.ownerKey();
    const wrapped = validateWrappedKey(input?.wrappedKey);
    const existing = await this.persistence.sealedVault.getKey(owner);
    if (existing && !input.replace) {
      throw new ValidationError("Encryption is already set up — unlock it with your passphrase");
    }
    if (existing && existing.fingerprint !== wrapped.fingerprint) {
      // Re-wrapping keeps the same chat key; a different key would orphan every sealed chat.
      throw new ValidationError("A passphrase change must keep the same chat key");
    }
    await this.persistence.sealedVault.putKey(owner, wrapped);
    return { wrappedKey: wrapped };
  }

  async listChats(since?: string): Promise<E2eeChatsResponse> {
    const owner = await this.ownerKey();
    const cutoff = since && !Number.isNaN(Date.parse(since)) ? since : null;
    const items = (await this.persistence.sealedVault.listChats(owner)).filter(
      (chat) => !cutoff || chat.updatedAt > cutoff,
    );
    // Tombstones are tiny ids; always send them all so no deletion is missed by the cursor.
    const deleted = (await this.persistence.sealedVault.listDeleted(owner)).map((tomb) => tomb.id);
    return { items, deleted };
  }

  async putChat(id: string, input: E2eePutChatRequest): Promise<SealedChat> {
    if (!CHAT_ID.test(id)) throw new ValidationError("Invalid chat id");
    const owner = await this.ownerKey();
    const sealed = input?.sealed;
    if (typeof sealed !== "string" || sealed.length < 16 || sealed.length > MAX_SEALED_CHARS) {
      throw new ValidationError("Sealed chat is empty or too large");
    }
    if (!B64.test(sealed)) throw new ValidationError("Sealed chat must be base64 ciphertext");
    // Server time is the sync cursor — a device with a skewed clock can't hide its writes.
    const updatedAt = new Date().toISOString();
    const existing = await this.persistence.sealedVault.listChats(owner);
    if (existing.length >= MAX_CHATS_PER_USER && !existing.some((chat) => chat.id === id)) {
      throw new ValidationError("Encrypted chat limit reached — delete old chats first");
    }
    const chat: SealedChat = { id, sealed, updatedAt };
    await this.persistence.sealedVault.putChat(owner, chat);
    return chat;
  }

  async deleteChat(id: string): Promise<{ ok: true }> {
    if (!CHAT_ID.test(id)) throw new ValidationError("Invalid chat id");
    await this.persistence.sealedVault.deleteChat(
      await this.ownerKey(),
      id,
      new Date().toISOString(),
    );
    return { ok: true };
  }

  /** Forgot-passphrase reset: the old ciphertext is unrecoverable, so drop it all. */
  async reset(): Promise<{ ok: true }> {
    await this.persistence.sealedVault.deleteAll(await this.ownerKey());
    return { ok: true };
  }
}
