import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../../app.js";
import { makeTestEnv } from "../../test-support/env.js";

async function signedIn(env = makeTestEnv()) {
  const context = await createApiContext(env);
  const app = await buildApp(context);
  const connected = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: { email: "owner@arrab.studio", password: "securepass", displayName: "Owner" },
  });
  const token = (connected.json() as { sessionToken: string }).sessionToken;
  const headers = { authorization: `Bearer ${token}` };
  const subscribe = (code: string) =>
    app.inject({ method: "POST", url: "/v1/account/subscribe", payload: { code }, headers });
  return { app, context, headers, subscribe };
}

describe("public plan codes", () => {
  it("do not unlock a paid plan unless explicitly enabled", async () => {
    const { app, subscribe, headers } = await signedIn();
    for (const code of ["PRO-ARRAB", "SCALE-ARRAB", "ENTERPRISE-ARRAB", "family-arrab"]) {
      const response = await subscribe(code);
      expect(response.statusCode, code).toBe(400);
      expect(response.json().error.message).toMatch(/Billing/);
    }
    const status = await app.inject({ method: "GET", url: "/v1/account", headers });
    expect(status.json().account.planId).toBe("free");
    await app.close();
  });

  it("still allow a free-tier code", async () => {
    const { app, subscribe } = await signedIn();
    expect((await subscribe("FAMILY-FREE-ARRAB")).statusCode).toBe(200);
    await app.close();
  });

  it("cannot be used to restart an expired free month", async () => {
    const { app, context, subscribe } = await signedIn();
    const account = (await context.persistence.accounts.get())!;
    await context.persistence.accounts.upsert({
      ...account,
      periodStart: "2020-01-01T00:00:00.000Z",
      periodEnd: "2020-02-01T00:00:00.000Z",
    });
    const response = await subscribe("FREE-ARRAB");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/free month ended/i);
    await app.close();
  });

  it("are refused during browser sign-up too", async () => {
    const context = await createApiContext(makeTestEnv());
    const app = await buildApp(context);
    const started = (
      await app.inject({ method: "POST", url: "/v1/account/auth/web/start" })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/complete",
      payload: {
        state: started.state,
        email: "a@b.co",
        password: "securepass",
        planCode: "PRO-ARRAB",
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("work when an internal build enables them", async () => {
    const { app, subscribe } = await signedIn(makeTestEnv({ allowPlanCodes: true }));
    expect((await subscribe("PRO-ARRAB")).statusCode).toBe(200);
    await app.close();
  });

  it("selected live planId wins over SCALE alias when plan codes are enabled", async () => {
    const { app, headers } = await signedIn(makeTestEnv({ allowPlanCodes: true }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/subscribe",
      headers,
      payload: { code: "SCALE-ARRAB", planId: "max" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().account.planId).toBe("max");
    expect(response.json().entitlements.planId).toBe("max");
    expect(response.json().entitlements.tokenLimit).toBeGreaterThan(0);
    await app.close();
  });

  it("browser sign-up applies selected planId over SCALE planCode", async () => {
    const context = await createApiContext(makeTestEnv({ allowPlanCodes: true }));
    const app = await buildApp(context);
    const started = (
      await app.inject({ method: "POST", url: "/v1/account/auth/web/start" })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/complete",
      payload: {
        state: started.state,
        email: "pick@arrab.studio",
        password: "securepass",
        planCode: "SCALE-ARRAB",
        planId: "pro",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().account.planId).toBe("pro");
    await app.close();
  });
});

describe("account sign-up and sign-in", () => {
  it("only lets allow-listed emails create the studio account", async () => {
    const context = await createApiContext(makeTestEnv({ signupEmails: ["owner@arrab.studio"] }));
    const app = await buildApp(context);
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "stranger@evil.test", password: "securepass" },
    });
    expect(blocked.statusCode).toBe(400);
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "Owner@Arrab.Studio", password: "securepass" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("rejects absurdly long passwords instead of hashing them", async () => {
    const context = await createApiContext(makeTestEnv());
    const app = await buildApp(context);
    const response = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "owner@arrab.studio", password: "x".repeat(5000) },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("gives the same answer for a wrong email and a wrong password", async () => {
    const { app } = await signedIn();
    const wrongEmail = await app.inject({
      method: "POST",
      url: "/v1/account/sign-in",
      payload: { email: "nobody@arrab.studio", password: "securepass" },
    });
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/v1/account/sign-in",
      payload: { email: "owner@arrab.studio", password: "not-the-password" },
    });
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    // Same client-facing answer (no email enumeration). requestId differs per call.
    const a = wrongEmail.json() as { error: { code: string; message: string } };
    const b = wrongPassword.json() as { error: { code: string; message: string } };
    expect(a.error.code).toBe(b.error.code);
    expect(a.error.message).toBe(b.error.message);
    expect(a.error.message).toBe("Invalid email or password");
    await app.close();
  });
});
