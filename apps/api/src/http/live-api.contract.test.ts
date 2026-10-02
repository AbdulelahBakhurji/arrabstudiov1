/**
 * Optional smoke against a real Arrab API (staging/production).
 *
 *   ARRAB_LIVE_API_URL=https://api.arrabai.com/r/nmpi6uidtpkh1bdf pnpm exec vitest run apps/api/src/http/live-api.contract.test.ts
 *
 * Skipped by default so CI stays offline-deterministic.
 */
import { describe, expect, it } from "vitest";

const LIVE = (process.env.ARRAB_LIVE_API_URL ?? "").replace(/\/$/, "");

describe.skipIf(!LIVE)("live Arrab API contract", () => {
  it("health is ok", async () => {
    const res = await fetch(`${LIVE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; service?: string };
    expect(body.status).toBe("ok");
    expect(body.service).toMatch(/arrab/i);
  });

  it("meta reports version and persistence", async () => {
    const res = await fetch(`${LIVE}/v1/meta`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name?: string;
      version?: string;
      persistence?: string;
    };
    expect(body.name).toBe("arrab-api");
    expect(typeof body.version).toBe("string");
    expect(body.persistence).toBeTruthy();
  });

  it("unauthenticated account surface does not leak secrets", async () => {
    const res = await fetch(`${LIVE}/v1/account`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/passwordHash|sessionTokenHash|DATA_ENCRYPTION|OPENROUTER_API_KEY|sk-/i);
    const body = JSON.parse(text) as { connected?: boolean; account?: unknown };
    expect(body.connected).toBe(false);
    expect(body.account).toBeNull();
  });

  it("sign-in rejects invalid credentials without enumerating accounts", async () => {
    const res = await fetch(`${LIVE}/v1/account/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody-live-probe@arrab.studio", password: "not-a-real-password" }),
    });
    expect([401, 404, 429]).toContain(res.status);
    if (res.status === 401) {
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message?.toLowerCase()).toMatch(/invalid|password|email|credentials/);
    }
  });

  it("documents whether this host has the 0.15 client/hello surface", async () => {
    const res = await fetch(`${LIVE}/v1/client/hello`);
    // 200 = deployed 0.15+; 404 = older host (still acceptable for health/auth probes above).
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { protocol?: number; serverTime?: string };
      expect(typeof body.protocol).toBe("number");
      expect(body.serverTime).toBeTruthy();
    }
  });
});
