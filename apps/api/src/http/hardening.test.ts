/**
 * Regression suite for production hardening (SEC-01 … SEC-07).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../app.js";
import { makeTestEnv } from "../test-support/env.js";
import { bootWorld, type World } from "../test-support/world.js";
import { clientKey, payloadLooksLikeSecretLeak } from "../platform/http/security.js";

describe("payloadLooksLikeSecretLeak", () => {
  it("flags stored-secret keys but allows one-shot auth tokens", () => {
    expect(payloadLooksLikeSecretLeak('{"passwordHash":"x"}')).toBe(true);
    expect(payloadLooksLikeSecretLeak('{"sessionTokenHash":"x"}')).toBe(true);
    expect(payloadLooksLikeSecretLeak('{"clientSecret":"x"}')).toBe(true);
    // Intentional auth handoff — must not hard-fail login/refresh.
    expect(payloadLooksLikeSecretLeak('{"sessionToken":"x","refreshToken":"y"}')).toBe(false);
    expect(payloadLooksLikeSecretLeak('{"ok":true,"planId":"solo"}')).toBe(false);
  });
});

describe("SEC-01 billing confirm is owner-only", () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld({ plan: "solo" });
  });
  afterAll(() => w.close());

  it("anonymous confirm is 401", async () => {
    const res = await w.as.anonymous("GET", "/v1/billing/confirm?invoice=inv_probe");
    expect(res.status).toBe(401);
  });

  it("owner may call confirm (non-401 auth gate)", async () => {
    const res = await w.as.owner("GET", "/v1/billing/confirm?invoice=inv_missing");
    // Past auth: missing invoice / provider not configured — never anonymous pass-through.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect([400, 404, 422, 503]).toContain(res.status);
  });
});

describe("SEC-04 production CORS blocks loopback", () => {
  it("does not allow localhost when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const context = await createApiContext(
        makeTestEnv({ corsOrigins: ["https://arrabai.com"] }),
      );
      const app = await buildApp(context);
      const res = await app.inject({
        method: "OPTIONS",
        url: "/v1/billing/plans",
        headers: {
          origin: "http://127.0.0.1:1420",
          "access-control-request-method": "GET",
        },
      });
      // Fastify CORS omits ACAO when origin is rejected.
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      await app.close();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe("SEC-03 clientKey ignores spoofed X-Forwarded-For", () => {
  it("uses request.ip only", () => {
    const key = clientKey({
      ip: "203.0.113.9",
      headers: { "x-forwarded-for": "1.2.3.4" },
    } as never);
    expect(key).toBe("203.0.113.9");
    expect(key).not.toContain("1.2.3.4");
  });
});

describe("SEC-05 unknown family member header fails closed", () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld({ plan: "family" });
  });
  afterAll(() => w.close());

  it("returns 404 for a spoofed X-Arrab-Family-Member", async () => {
    const res = await w.app.inject({
      method: "GET",
      url: "/v1/family",
      headers: {
        authorization: `Bearer ${w.ownerToken}`,
        "x-arrab-family-member": "mem_does_not_exist",
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("SEC-07 common passwords rejected on connect", () => {
  it("refuses password123 on connect", async () => {
    const context = await createApiContext(makeTestEnv());
    const app = await buildApp(context);
    const res = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "strong-check@arrab.studio", password: "password123" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/common password/i);
    await app.close();
  });
});

describe("public meta + secret filter", () => {
  it("GET /v1/meta is public", async () => {
    const w = await bootWorld({ plan: "free" });
    const res = await w.as.anonymous("GET", "/v1/meta");
    expect(res.status).toBe(200);
    expect((res.body as { version?: string }).version).toMatch(/^0\.15/);
    await w.close();
  });
});
