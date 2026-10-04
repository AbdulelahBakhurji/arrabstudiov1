import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApiContext } from "../../app.js";
import { configureFieldCrypto, isEncryptedField } from "../../platform/crypto/field-crypto.js";
import { makeTestEnv } from "../../test-support/env.js";
import { withRequestActor } from "../../platform/context/request-actor.js";
import { verifyTotpCode } from "./totp.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) bits += BASE32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeFor(secret: string, nowMs = Date.now()): string {
  const step = Math.floor(nowMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

describe("MFA secret at rest", () => {
  it("stores the TOTP secret encrypted and still verifies codes", async () => {
    configureFieldCrypto("a".repeat(64));
    const context = await createApiContext(makeTestEnv({ dataEncryptionKey: "a".repeat(64) }));
    await context.accounts.connect({
      email: "mfa@arrab.studio",
      password: "securepass",
      displayName: "MFA",
    });
    const account = (await context.persistence.accounts.get())!;
    const setup = await withRequestActor({ employeeId: null, accountId: account.id }, () =>
      context.accounts.beginMfaSetup(),
    );
    expect(setup.secret.length).toBeGreaterThan(16);
    expect(verifyTotpCode(setup.secret, codeFor(setup.secret))).toBe(true);

    const stored = (await context.persistence.accounts.getById(account.id))!;
    expect(stored.mfaSecret).toBeTruthy();
    expect(isEncryptedField(stored.mfaSecret!)).toBe(true);
    expect(stored.mfaSecret).not.toContain(setup.secret);

    await withRequestActor({ employeeId: null, accountId: account.id }, () =>
      context.accounts.confirmMfaSetup(codeFor(setup.secret)),
    );
    const enabled = (await context.persistence.accounts.getById(account.id))!;
    expect(enabled.mfaEnabled).toBe(true);
    expect(isEncryptedField(enabled.mfaSecret!)).toBe(true);
  });
});
