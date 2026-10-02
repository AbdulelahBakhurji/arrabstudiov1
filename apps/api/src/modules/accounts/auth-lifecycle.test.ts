import { describe, expect, it } from "vitest";
import { bootWorld, signInFamilySeat, type World } from "../../test-support/world.js";

const REFRESH = { "x-arrab-refresh": "1" };
async function api(w: World, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await w.app.inject({ method: method as never, url, payload: payload as never, headers });
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = res.json();
  } catch {
    // empty
  }
  return { status: res.statusCode, body, headers: res.headers };
}

/** A studio with a refresh-capable owner session created through the real sign-up endpoint. */
async function refreshableOwner(plan = "solo") {
  const w = await bootWorld({ plan, seats: false });
  // The fixture's owner is a classic session; add a refresh-capable device by signing in again.
  const email = (await w.as.owner("GET", "/v1/account")).body.account.email as string;
  const device = await api(w, "POST", "/v1/account/sign-in", { email, password: "securepass" }, { ...REFRESH, "x-arrab-platform": "macos" });
  expect(device.status).toBe(200);
  return { w, email, tokens: device.body as { sessionToken: string; refreshToken: string; accessExpiresAt: string } };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const expireAccess = async (w: World, token: string) => {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  const account = (await w.context.persistence.accounts.get())!;
  await w.context.persistence.accounts.upsert({
    ...account,
    sessions: account.sessions!.map((s) => (s.tokenHash === hash ? { ...s, accessExpiresAt: "2000-01-01T00:00:00.000Z" } : s)),
  });
};

describe("registration and login hand out the right kind of session", () => {
  it("a refresh-capable client gets a short-lived access token and a refresh token; a classic client does not", async () => {
    const w = await bootWorld({ plan: "free", seats: false });
    try {
      const modern = await api(w, "POST", "/v1/account/sign-in", { email: (await w.as.owner("GET", "/v1/account")).body.account.email, password: "securepass" }, REFRESH);
      expect(modern.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      const ttl = Date.parse(modern.body.accessExpiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(14 * 60_000);
      expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 1000);
      const classic = await api(w, "POST", "/v1/account/sign-in", { email: (await w.as.owner("GET", "/v1/account")).body.account.email, password: "securepass" });
      expect(classic.body.refreshToken).toBeUndefined();
      expect(classic.body.accessExpiresAt).toBeUndefined();
    } finally {
      await w.close();
    }
  });

  it("registration itself can opt in (first device of a brand-new studio)", async () => {
    const { buildApp, createApiContext } = await import("../../app.js");
    const { makeTestEnv } = await import("../../test-support/env.js");
    const app = await buildApp(await createApiContext(makeTestEnv()));
    const res = await app.inject({ method: "POST", url: "/v1/account/connect", payload: { email: "new@arrab.test", password: "securepass" }, headers: REFRESH });
    expect(res.json().refreshToken).toBeTruthy();
    expect(res.json().accountCreated).toBe(true);
    await app.close();
  });

  it("tokens are never stored in the clear", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      const raw = JSON.stringify(await w.context.persistence.accounts.get());
      expect(raw).not.toContain(tokens.sessionToken);
      expect(raw).not.toContain(tokens.refreshToken);
    } finally {
      await w.close();
    }
  });
});

describe("access-token expiry and refresh", () => {
  it("an expired access token says TOKEN_EXPIRED (refresh), an unknown one says UNAUTHORIZED (sign in)", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      expect((await api(w, "GET", "/v1/account", undefined, bearer(tokens.sessionToken))).status).toBe(200);
      await expireAccess(w, tokens.sessionToken);
      const expired = await api(w, "GET", "/v1/account", undefined, bearer(tokens.sessionToken));
      expect(expired.status).toBe(401);
      expect(expired.body.error.code).toBe("TOKEN_EXPIRED");
      const unknown = await api(w, "GET", "/v1/account", undefined, bearer("f".repeat(64)));
      expect(unknown.status).toBe(401);
      expect(unknown.body.error.code).toBe("UNAUTHORIZED");
    } finally {
      await w.close();
    }
  });

  it("refreshing yields a working pair, kills the old access token, and the session keeps its device identity", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      await expireAccess(w, tokens.sessionToken);
      const refreshed = await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.sessionToken).not.toBe(tokens.sessionToken);
      expect(refreshed.body.refreshToken).not.toBe(tokens.refreshToken);
      expect((await api(w, "GET", "/v1/account", undefined, bearer(refreshed.body.sessionToken))).status).toBe(200);
      expect((await api(w, "GET", "/v1/account", undefined, bearer(tokens.sessionToken))).status).toBe(401);
      const sessions = (await w.as.owner("GET", "/v1/account/sessions")).body.sessions as Array<{ platform: string }>;
      expect(sessions.filter((s) => s.platform === "macos")).toHaveLength(1); // rotated in place, not duplicated
    } finally {
      await w.close();
    }
  });

  it("refresh-token rotation chains: each new refresh token works exactly once", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      let refresh = tokens.refreshToken;
      for (let i = 0; i < 4; i++) {
        const res = await api(w, "POST", "/v1/account/refresh", { refreshToken: refresh });
        expect(res.status, `round ${i}`).toBe(200);
        refresh = res.body.refreshToken;
      }
    } finally {
      await w.close();
    }
  });

  it("a refresh token used again after rotation (theft) ends the whole session — the thief's and the owner's", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      const legit = await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken });
      expect(legit.status).toBe(200);
      // Outside the race window, the old token reappears: an attacker replaying a stolen copy.
      const account = (await w.context.persistence.accounts.get())!;
      await w.context.persistence.accounts.upsert({
        ...account,
        sessions: account.sessions!.map((s) => (s.prevRefreshHash ? { ...s, rotatedAt: "2000-01-01T00:00:00.000Z" } : s)),
      });
      const replay = await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe("REFRESH_REUSED");
      // Both parties are locked out: the owner must sign in again.
      expect((await api(w, "GET", "/v1/account", undefined, bearer(legit.body.sessionToken))).status).toBe(401);
      expect((await api(w, "POST", "/v1/account/refresh", { refreshToken: legit.body.refreshToken })).status).toBe(401);
    } finally {
      await w.close();
    }
  });

  it("two windows refreshing at once: one wins, the other is told to retry (409) and the session survives", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      const [a, b] = await Promise.all([
        api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken }),
        api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const winner = a.status === 200 ? a : b;
      expect((await api(w, "GET", "/v1/account", undefined, bearer(winner.body.sessionToken))).status).toBe(200);
    } finally {
      await w.close();
    }
  });

  it.each([[""], ["short"], ["x".repeat(300)], ["0".repeat(64)], [null], [{ a: 1 }]])("a malformed or unknown refresh token is rejected: %j", async (refreshToken) => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      const res = await api(w, "POST", "/v1/account/refresh", { refreshToken });
      expect(res.status).toBe(401);
      expect((await api(w, "POST", "/v1/account/refresh", undefined)).status).toBe(401);
    } finally {
      await w.close();
    }
  });

  it("logging out, revoking a device, or an expired session kills the refresh token too", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      await api(w, "POST", "/v1/account/logout", {}, bearer(tokens.sessionToken));
      expect((await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken })).status).toBe(401);
    } finally {
      await w.close();
    }
    const second = await refreshableOwner();
    try {
      const account = (await second.w.context.persistence.accounts.get())!;
      await second.w.context.persistence.accounts.upsert({ ...account, sessions: account.sessions!.map((s) => ({ ...s, expiresAt: "2000-01-01T00:00:00.000Z" })) });
      expect((await api(second.w, "POST", "/v1/account/refresh", { refreshToken: second.tokens.refreshToken })).status).toBe(401);
    } finally {
      await second.w.close();
    }
  });

  it("refresh is rate limited like sign-in", async () => {
    const w = await bootWorld({ plan: "solo", seats: false });
    try {
      let last = 0;
      for (let i = 0; i < 45 && last !== 429; i++) last = (await api(w, "POST", "/v1/account/refresh", { refreshToken: "0".repeat(64) })).status;
      expect(last).toBe(429);
    } finally {
      await w.close();
    }
  });

  it("family seats get their own refreshable sessions, and a downgrade kills them", async () => {
    const w = await bootWorld({ plan: "family" });
    try {
      const member = w.ids.familyMembers!.kid;
      const signIn = await api(w, "POST", "/v1/family/members/sign-in", { email: member.email, password: "kidpassword" }, REFRESH);
      expect(signIn.body.refreshToken).toBeTruthy();
      const rotated = await api(w, "POST", "/v1/account/refresh", { refreshToken: signIn.body.refreshToken });
      expect(rotated.status).toBe(200);
      // The rotated seat session is still bound to the seat (cannot reach owner-only routes).
      expect((await api(w, "POST", "/v1/account/subscribe", { code: "FREE-ARRAB" }, bearer(rotated.body.sessionToken))).status).toBe(403);
      await w.as.owner("POST", "/v1/account/subscribe", { code: "SOLO-ARRAB" });
      expect((await api(w, "POST", "/v1/account/refresh", { refreshToken: rotated.body.refreshToken })).status).toBe(401);
      void signInFamilySeat;
    } finally {
      await w.close();
    }
  });
});

describe("multiple devices", () => {
  it("devices refresh independently; revoking one leaves the other working", async () => {
    const { w, email, tokens } = await refreshableOwner();
    try {
      const phone = (await api(w, "POST", "/v1/account/sign-in", { email, password: "securepass" }, { ...REFRESH, "x-arrab-platform": "ios", "x-arrab-device-name": "iPhone" })).body;
      const mac = await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken });
      expect(mac.status).toBe(200);
      const list = (await w.as.owner("GET", "/v1/account/sessions")).body.sessions as Array<{ id: string; platform: string }>;
      await w.as.owner("DELETE", `/v1/account/sessions/${list.find((s) => s.platform === "ios")!.id}`);
      expect((await api(w, "GET", "/v1/account", undefined, bearer(phone.sessionToken))).status).toBe(401);
      expect((await api(w, "POST", "/v1/account/refresh", { refreshToken: phone.refreshToken })).status).toBe(401);
      expect((await api(w, "GET", "/v1/account", undefined, bearer(mac.body.sessionToken))).status).toBe(200);
    } finally {
      await w.close();
    }
  });
});

describe("password change", () => {
  it("proves the current password, enforces strength, and signs every other device out", async () => {
    const { w, email, tokens } = await refreshableOwner();
    try {
      const me = bearer(tokens.sessionToken);
      expect((await api(w, "POST", "/v1/account/password", { currentPassword: "wrong-password", newPassword: "brand-new-pass-1" }, me)).status).toBe(401);
      expect((await api(w, "POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "short" }, me)).status).toBe(400);
      expect((await api(w, "POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "securepass" }, me)).status).toBe(400);
      expect((await api(w, "POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "x".repeat(300) }, me)).status).toBe(400);

      const other = (await api(w, "POST", "/v1/account/sign-in", { email, password: "securepass" })).body.sessionToken as string;
      const changed = await api(w, "POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "brand-new-pass-1" }, me);
      expect(changed.status).toBe(200);
      expect((await api(w, "GET", "/v1/account", undefined, me)).status).toBe(200); // this device stays signed in
      expect((await api(w, "GET", "/v1/account", undefined, bearer(other))).status).toBe(401); // everyone else is out
      expect((await api(w, "GET", "/v1/account", undefined, bearer(w.ownerToken))).status).toBe(401);
      expect((await api(w, "POST", "/v1/account/sign-in", { email, password: "securepass" })).status).toBe(401);
      expect((await api(w, "POST", "/v1/account/sign-in", { email, password: "brand-new-pass-1" })).status).toBe(200);
    } finally {
      await w.close();
    }
  });

  it("seats and anonymous callers cannot change the owner's password", async () => {
    const w = await bootWorld({ plan: "family" });
    try {
      const kid = await signInFamilySeat(w, "kid");
      expect((await kid("POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "brand-new-pass-1" })).status).toBe(403);
      expect((await w.as.anonymous("POST", "/v1/account/password", { currentPassword: "securepass", newPassword: "brand-new-pass-1" })).status).toBe(401);
    } finally {
      await w.close();
    }
  });
});

describe("account deletion", () => {
  it("removes the account and all its sessions; a new account cannot be entered with the old tokens", async () => {
    const { w, tokens } = await refreshableOwner();
    try {
      const oldOwner = w.ownerToken;
      expect((await api(w, "POST", "/v1/account/disconnect", {}, bearer(tokens.sessionToken))).status).toBe(200);
      expect((await api(w, "POST", "/v1/account/refresh", { refreshToken: tokens.refreshToken })).status).toBe(401);
      const fresh = await api(w, "POST", "/v1/account/connect", { email: "second@arrab.test", password: "securepass" });
      expect(fresh.status).toBe(200);
      for (const token of [oldOwner, tokens.sessionToken]) expect((await api(w, "GET", "/v1/account", undefined, bearer(token))).status, "old token vs new account").toBe(401);
      expect((await api(w, "GET", "/v1/account", undefined, bearer(fresh.body.sessionToken))).status).toBe(200);
    } finally {
      await w.close();
    }
  });
});
