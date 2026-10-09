/**
 * Zero-knowledge chat vault. Clients encrypt transcripts with a chat key that only
 * their passphrase can unwrap; this service stores and syncs the ciphertext per user
 * and cannot read any of it.
 */
import { randomInt } from "node:crypto";
import { ValidationError } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import type {
  E2eeChatsResponse,
  E2eeKeyResponse,
  E2eeClaimHandoffResponse,
  E2eeHandoffResponse,
  E2eePutChatRequest,
  E2eePutKeyRequest,
  SealedChat,
  WrappedChatKey,
} from "@arrab/shared";
import { currentRequestActor } from "../../platform/context/request-actor.js";
import type { FamilyHouseholdService } from "../family/family-household-service.js";

const CHAT_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** Short-lived phone tickets live beside sealed chats and never sync as transcripts. */
const HANDOFF_PREFIX = "hcode";
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** One sealed chat (ciphertext, base64) may be at most ~6 MB. */
const MAX_SEALED_CHARS = 6 * 1024 * 1024;
const MAX_CHATS_PER_USER = 2_000;
const MIN_PBKDF2_ITERATIONS = 200_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;

function isHandoffId(id: string): boolean {
  return id.startsWith(HANDOFF_PREFIX);
}

function readHandoff(sealed: string): { conversationIds: string[]; expiresAt: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(sealed, "base64").toString("utf8")) as {
      conversationId?: unknown;
      conversationIds?: unknown;
      expiresAt?: unknown;
    };
    if (typeof parsed.expiresAt !== "string" || Number.isNaN(Date.parse(parsed.expiresAt))) {
      return null;
    }
    const raw = Array.isArray(parsed.conversationIds)
      ? parsed.conversationIds
      : [parsed.conversationId];
    const conversationIds = [
      ...new Set(
        raw.filter((id): id is string => typeof id === "string" && CHAT_ID.test(id) && !isHandoffId(id)),
      ),
    ];
    if (!conversationIds.length) return null;
    return { conversationIds, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

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
  /** Also used by sync so every per-user store is partitioned identically. */
  async currentOwnerKey(): Promise<string> {
    return this.ownerKey();
  }

  private async ownerKey(): Promise<string> {
    const employeeId = currentRequestActor().employeeId;
    if (employeeId) return `emp:${employeeId}`;
    if (this.familyHousehold && (await this.familyHousehold.isFamilyPlanActive())) {
      const seatId = await this.familyHousehold.getActiveMemberId();
      if (seatId) return `seat:${seatId}`;
    }
    const accountId = currentRequestActor().accountId;
    if (accountId) return `acc:${accountId}`;
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
      (chat) => !isHandoffId(chat.id) && (!cutoff || chat.updatedAt > cutoff),
    );
    // Tombstones are tiny ids; always send them all so no deletion is missed by the cursor.
    const deleted = (await this.persistence.sealedVault.listDeleted(owner))
      .map((tomb) => tomb.id)
      .filter((id) => !isHandoffId(id));
    return { items, deleted };
  }

  async putChat(id: string, input: E2eePutChatRequest): Promise<SealedChat> {
    if (!CHAT_ID.test(id) || isHandoffId(id)) throw new ValidationError("Invalid chat id");
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

  /**
   * Desktop asks the phone to open one sealed chat. The code is useless without this
   * account's session, and the transcript itself stays ciphertext.
   */
  async createHandoff(conversationId: string, also: string[] = []): Promise<E2eeHandoffResponse> {
    const conversationIds = [
      ...new Set(
        [conversationId, ...also].filter(
          (id) => CHAT_ID.test(id) && !isHandoffId(id),
        ),
      ),
    ];
    if (
      !conversationIds.length ||
      conversationIds.length > 40 ||
      conversationIds[0] !== conversationId
    ) {
      throw new ValidationError("Invalid chat id");
    }
    const owner = await this.ownerKey();
    const chats = await this.persistence.sealedVault.listChats(owner);
    if (conversationIds.some((id) => !chats.some((chat) => chat.id === id))) {
      throw new ValidationError("Seal this chat before sending it to your phone");
    }
    await this.dropExpiredHandoffs(owner, chats);
    const fresh = await this.persistence.sealedVault.listChats(owner);
    const wanted = new Set(conversationIds);
    for (const chat of fresh) {
      if (!isHandoffId(chat.id)) continue;
      const ticket = readHandoff(chat.sealed);
      if (ticket?.conversationIds.some((id) => wanted.has(id))) {
        await this.persistence.sealedVault.deleteChat(owner, chat.id, new Date().toISOString());
      }
    }
    const code = await this.mintCode(owner);
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
    const sealed = Buffer.from(
      JSON.stringify({ conversationId, conversationIds, expiresAt }),
      "utf8",
    ).toString("base64");
    await this.persistence.sealedVault.putChat(owner, {
      id: `${HANDOFF_PREFIX}${code}`,
      sealed,
      updatedAt: new Date().toISOString(),
    });
    return { code, expiresAt, qr: `arrab://handoff?code=${code}` };
  }

  /** Phone claims the ticket once. A wrong account never sees another account's code. */
  async claimHandoff(code: string): Promise<E2eeClaimHandoffResponse> {
    const clean = String(code ?? "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(clean)) throw new ValidationError("Enter the 6-digit code");
    const owner = await this.ownerKey();
    const chats = await this.persistence.sealedVault.listChats(owner);
    const ticketRow = chats.find((chat) => chat.id === `${HANDOFF_PREFIX}${clean}`);
    if (!ticketRow) throw new ValidationError("That code is not active");
    const ticket = readHandoff(ticketRow.sealed);
    const now = new Date().toISOString();
    if (!ticket || ticket.expiresAt <= now) {
      await this.persistence.sealedVault.deleteChat(owner, ticketRow.id, now);
      throw new ValidationError("That code expired");
    }
    const claimed = ticket.conversationIds
      .map((id) => chats.find((item) => item.id === id))
      .filter((item): item is SealedChat => Boolean(item))
      .map((item) => ({
        conversationId: item.id,
        sealed: item.sealed,
        updatedAt: item.updatedAt,
      }));
    await this.persistence.sealedVault.deleteChat(owner, ticketRow.id, now);
    const first = claimed[0];
    if (!first) throw new ValidationError("That encrypted chat is gone");
    return { ...first, chats: claimed };
  }

  private async mintCode(owner: string): Promise<string> {
    const taken = new Set(
      (await this.persistence.sealedVault.listChats(owner))
        .filter((chat) => isHandoffId(chat.id))
        .map((chat) => chat.id.slice(HANDOFF_PREFIX.length)),
    );
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      if (!taken.has(code)) return code;
    }
    throw new ValidationError("Could not open a phone code. Try again.");
  }

  private async dropExpiredHandoffs(owner: string, chats: SealedChat[]): Promise<void> {
    const now = new Date().toISOString();
    for (const chat of chats) {
      if (!isHandoffId(chat.id)) continue;
      const ticket = readHandoff(chat.sealed);
      if (!ticket || ticket.expiresAt <= now) {
        await this.persistence.sealedVault.deleteChat(owner, chat.id, now);
      }
    }
  }

  /** Account removed or replaced: nobody inherits the previous account's ciphertext. */
  async purgeAll(): Promise<void> {
    await this.persistence.sealedVault.purgeWorkspace();
  }

  /** Forgot-passphrase reset: the old ciphertext is unrecoverable, so drop it all. */
  async reset(): Promise<{ ok: true }> {
    await this.persistence.sealedVault.deleteAll(await this.ownerKey());
    return { ok: true };
  }
}
