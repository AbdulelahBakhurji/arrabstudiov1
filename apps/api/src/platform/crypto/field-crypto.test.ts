import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configureFieldCrypto, decryptField, encryptField } from "./field-crypto.js";

describe("field crypto", () => {
  it("round-trips with an explicit key and rejects a different key", () => {
    configureFieldCrypto("a".repeat(64));
    const sealed = encryptField("secret-token");
    expect(sealed.startsWith("arrab1:")).toBe(true);
    expect(sealed).not.toContain("secret-token");
    expect(decryptField(sealed)).toBe("secret-token");
    configureFieldCrypto("b".repeat(64));
    expect(() => decryptField(sealed)).toThrow();
  });

  it("detects tampering (GCM authentication)", () => {
    configureFieldCrypto("c".repeat(64));
    const sealed = encryptField("hello");
    const parts = sealed.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."))).toThrow();
  });

  it("uses a random per-install key for local data, not a key derivable from the source", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arrab-key-"));
    configureFieldCrypto(undefined, dir);
    const sealed = encryptField("local-secret");
    const keyFile = path.join(dir, ".data-key");
    expect(readFileSync(keyFile, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(statSync(keyFile).mode & 0o077).toBe(0);

    // A restart with the same directory reads the same key.
    configureFieldCrypto(undefined, dir);
    expect(decryptField(sealed)).toBe("local-secret");

    // A different install (different directory) cannot read it.
    configureFieldCrypto(undefined, mkdtempSync(path.join(tmpdir(), "arrab-key-")));
    expect(() => decryptField(sealed)).toThrow();
  });

  it("still reads data sealed with the legacy source-derived key, then re-seals with the real one", async () => {
    const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
    const legacy = createHash("sha256").update("arrab-local-dev-data-key-v1").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacy, iv);
    const data = Buffer.concat([cipher.update("old-secret", "utf8"), cipher.final()]);
    const old = `arrab1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;

    configureFieldCrypto(undefined, mkdtempSync(path.join(tmpdir(), "arrab-key-")));
    expect(decryptField(old)).toBe("old-secret");
    const resealed = encryptField(decryptField(old));
    configureFieldCrypto(undefined, undefined, true); // legacy key active → resealed value must NOT open with it
    expect(() => decryptField(resealed)).toThrow();
  });
});
