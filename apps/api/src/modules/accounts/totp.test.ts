import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { generateTotpSecret, otpauthUri, verifyTotpCode } from "./totp.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) {
    bits += BASE32.indexOf(ch).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function codeFor(secret: string, nowMs: number): string {
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

describe("totp", () => {
  it("generates a secret and verifies the matching code", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    const now = Date.now();
    expect(verifyTotpCode(secret, codeFor(secret, now), now)).toBe(true);
    expect(verifyTotpCode(secret, "000000", now)).toBe(false);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", email: "owner@arrab.studio" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Arrab%20Studio");
  });
});
