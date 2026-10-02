import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../../app.js";
import { makeTestEnv } from "../../test-support/env.js";

async function boot() {
  const context = await createApiContext(makeTestEnv());
  const app = await buildApp(context);
  const connect = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    headers: {
      "x-arrab-device-name": "Abdulelah's MacBook",
      "x-arrab-platform": "macos",
      "x-arrab-app-version": "0.15.0",
    },
    payload: { email: "owner@arrab.studio", password: "securepass" },
  });
  const mac = (connect.json() as { sessionToken: string }).sessionToken;
  const signIn = async (name: string, platform: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/account/sign-in",
      headers: { "x-arrab-device-name": name, "x-arrab-platform": platform },
      payload: { email: "owner@arrab.studio", password: "securepass" },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { sessionToken: string }).sessionToken;
  };
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  return { app, context, mac, signIn, as };
}

describe("multi-device sessions", () => {
  it("signing in on a second device does not sign the first one out", async () => {
    const { app, mac, signIn, as } = await boot();
    const phone = await signIn("iPhone", "ios");
    expect(phone).not.toBe(mac);
    for (const token of [mac, phone]) {
      expect(
        (await app.inject({ method: "GET", url: "/v1/account", headers: as(token) })).statusCode,
      ).toBe(200);
    }
    await app.close();
  });

  it("lists devices without exposing token hashes and marks the current one", async () => {
    const { app, mac, signIn, as } = await boot();
    await signIn("Pixel", "android");
    const res = await app.inject({ method: "GET", url: "/v1/account/sessions", headers: as(mac) });
    const { sessions } = res.json() as { sessions: Array<Record<string, unknown>> };
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)?.platform).toBe("macos");
    expect(sessions.map((s) => s.platform).sort()).toEqual(["android", "macos"]);
    expect(JSON.stringify(sessions)).not.toMatch(/tokenHash|passwordHash/);
    await app.close();
  });

  it("logout ends only the calling device", async () => {
    const { app, mac, signIn, as } = await boot();
    const phone = await signIn("iPhone", "ios");
    await app.inject({ method: "POST", url: "/v1/account/logout", headers: as(phone) });
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(phone) })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(mac) })).statusCode,
    ).toBe(200);
    await app.close();
  });

  it("can revoke a lost device remotely, and sign out everywhere", async () => {
    const { app, mac, signIn, as } = await boot();
    const stolen = await signIn("Stolen laptop", "windows");
    const list = (
      await app.inject({ method: "GET", url: "/v1/account/sessions", headers: as(mac) })
    ).json() as {
      sessions: Array<{ id: string; deviceName: string }>;
    };
    const target = list.sessions.find((s) => s.deviceName === "Stolen laptop")!;
    await app.inject({
      method: "DELETE",
      url: `/v1/account/sessions/${target.id}`,
      headers: as(mac),
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(stolen) })).statusCode,
    ).toBe(401);

    const other = await signIn("Tablet", "android");
    await app.inject({
      method: "POST",
      url: "/v1/account/sessions/revoke-all",
      headers: as(mac),
      payload: {},
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(other) })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(mac) })).statusCode,
    ).toBe(200);
    await app.close();
  });

  it("does not expose session management to signed-out callers (no prefix collision with /session)", async () => {
    const { app } = await boot();
    for (const [method, url] of [
      ["GET", "/v1/account/sessions"],
      ["POST", "/v1/account/sessions/revoke-all"],
      ["DELETE", "/v1/account/sessions/abc"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it("rejects expired sessions", async () => {
    const { app, context, mac, as } = await boot();
    const account = (await context.persistence.accounts.get())!;
    await context.persistence.accounts.upsert({
      ...account,
      sessions: account.sessions!.map((s) => ({ ...s, expiresAt: "2020-01-01T00:00:00.000Z" })),
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/account", headers: as(mac) })).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("adopts a pre-upgrade single-token session instead of logging that device out", async () => {
    const { app, context } = await boot();
    const { createHash } = await import("node:crypto");
    const legacy = "legacy-token-legacy-token-legacy-token";
    const account = (await context.persistence.accounts.get())!;
    await context.persistence.accounts.upsert({
      ...account,
      sessions: [],
      sessionTokenHash: createHash("sha256").update(legacy).digest("hex"),
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/account",
      headers: { authorization: `Bearer ${legacy}` },
    });
    expect(res.statusCode).toBe(200);
    const after = (await context.persistence.accounts.get())!;
    expect(after.sessionTokenHash).toBeNull();
    expect(after.sessions).toHaveLength(1);
    await app.close();
  });
});
