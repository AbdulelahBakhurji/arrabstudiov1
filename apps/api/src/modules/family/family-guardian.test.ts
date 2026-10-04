import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../../app.js";
import type { ApiEnv } from "../../platform/config/env.js";

const testEnv: ApiEnv = {
  host: "127.0.0.1",
  port: 8787,
  logLevel: "error",
  corsOrigins: ["http://localhost:1420"],
  databaseUrl: undefined,
  dataDir: undefined,
  bedrockApiKey: "test-bedrock-key",
  bedrockRegion: "eu-north-1",
  bedrockModels: ["amazon.nova-lite-v1:0"],
  openRouterApiKey: undefined,
  openRouterModels: ["openai/gpt-4o-mini"],
  openAiApiKey: undefined,
  anthropicApiKey: undefined,
  xaiApiKey: undefined,
  defaultModel: "amazon.nova-lite-v1:0",
  primaryProviderId: "bedrock",
  publicBaseUrl: "http://127.0.0.1:8787",
  authWebUrl: undefined,
  siteUrl: "http://127.0.0.1:8787",
  tapSecretKey: undefined,
  tapPublicKey: undefined,
  dataEncryptionKey: undefined,
  releasesDir: "/tmp/arrab-releases-test",
  googleClientId: undefined,
  googleClientSecret: undefined,
  googleOAuthRedirectUri: undefined,
  microsoftClientId: undefined,
  microsoftClientSecret: undefined,
  microsoftOAuthRedirectUri: undefined,
  githubAppClientId: undefined,
  githubAppClientSecret: undefined,
  githubAppSlug: undefined,
  githubOAuthRedirectUri: undefined,
  gitlabClientId: undefined,
  gitlabClientSecret: undefined,
  gitlabOAuthRedirectUri: undefined,
  bitbucketClientId: undefined,
  bitbucketClientSecret: undefined,
  bitbucketOAuthRedirectUri: undefined,
  linearClientId: undefined,
  linearClientSecret: undefined,
  linearOAuthRedirectUri: undefined,
  slackClientId: undefined,
  slackClientSecret: undefined,
  slackOAuthRedirectUri: undefined,
  notionClientId: undefined,
  notionClientSecret: undefined,
  notionOAuthRedirectUri: undefined,
  whatsappWebhookVerifyToken: undefined,
  whatsappAppSecret: undefined,
  finnhubApiKey: undefined,
  finnhubWebhookSecret: undefined,
  // Tests redeem public plan codes; production keeps them off (see ARRAB_ENABLE_PLAN_CODES).
  allowPlanCodes: true,
};


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

interface Household {
  context: Awaited<ReturnType<typeof createApiContext>>;
  app: Awaited<ReturnType<typeof buildApp>>;
  parentToken: string;
  ownerId: string;
  auth: { authorization: string };
  api: (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers?: Json) => Promise<{ status: number; body: Json }>;
  addChild: (name: string, over?: Json) => Promise<Json>;
}

let counter = 0;

/** Fresh in-memory studio with a signed-in parent on the given plan code. */
async function household(planCode: string | null = "FAMILY-FREE-ARRAB"): Promise<Household> {
  const context = await createApiContext(testEnv);
  const app = await buildApp(context);
  counter += 1;
  const connected = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: { email: `parent${counter}@arrab.studio`, password: "securepass", displayName: "Parent" },
  });
  const parentToken = (connected.json() as { sessionToken: string }).sessionToken;
  const auth = { authorization: `Bearer ${parentToken}` };
  if (planCode) {
    await app.inject({ method: "POST", url: "/v1/account/subscribe", payload: { code: planCode }, headers: auth });
  }
  const api: Household["api"] = async (method, url, payload, headers) => {
    const res = await app.inject({ method, url, payload: payload as never, headers: { ...auth, ...headers } });
    return { status: res.statusCode, body: res.json() as Json };
  };
  const snap = await api("GET", "/v1/family");
  const ownerId = (snap.body.members as Json[] | undefined)?.find((m) => m.isOwner)?.id ?? "";
  const addChild = async (name: string, over: Json = {}) => {
    counter += 1;
    const res = await api("POST", "/v1/family/members", {
      displayName: name,
      role: "child",
      ageTier: "tier_10_13",
      email: `${name.toLowerCase()}${counter}@arrab.studio`,
      password: "kidpassword",
      ...over,
    });
    expect(res.status).toBe(200);
    return res.body;
  };
  return { context, app, parentToken, ownerId, auth, api, addChild };
}

/** Quiet hours off so time of day never affects a test. */
const NO_QUIET = { quietHours: { enabled: false } };

describe("family subscriptions", () => {
  it("is unavailable for non-family accounts", async () => {
    const h = await household("PRO-ARRAB");
    const snap = await h.api("GET", "/v1/family");
    expect(snap.body.available).toBe(false);
    expect(snap.body.seatLimit).toBe(0);
    const created = await h.api("POST", "/v1/family/members", { displayName: "X", role: "partner" });
    expect(created.status).toBe(403);
    await h.app.close();
  });

  it.each([
    ["FAMILY-FREE-ARRAB", "family_free", 6],
    ["FAMILY-ARRAB", "family", 6],
    ["FAMILY-PLUS-ARRAB", "family_plus", 10],
  ])("plan code %s gives %s with %i seats", async (code, planId, seats) => {
    const h = await household(code);
    const snap = await h.api("GET", "/v1/family");
    expect(snap.body).toMatchObject({ available: true, planId, seatLimit: seats, seatsUsed: 1, extraSeats: 0 });
    expect(snap.body.members).toHaveLength(1);
    expect(snap.body.members[0]).toMatchObject({ isOwner: true, role: "parent", isManager: true });
    await h.app.close();
  });

  it("enforces the seat limit and unlocks more seats with seat packs", async () => {
    const h = await household("FAMILY-FREE-ARRAB");
    for (let i = 0; i < 5; i += 1) await h.addChild(`Kid${i}`);
    expect((await h.api("GET", "/v1/family")).body.seatsUsed).toBe(6);

    const over = await h.api("POST", "/v1/family/members", {
      displayName: "Extra", role: "child", ageTier: "tier_6_9", email: "extra@arrab.studio", password: "kidpassword",
    });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toMatch(/seat limit/i);

    const bought = await h.api("POST", "/v1/family/seats/purchase", { seats: 1, code: "family-seat" });
    expect(bought.body).toMatchObject({ seatLimit: 7, extraSeats: 1 });
    const stacked = await h.api("POST", "/v1/family/seats/purchase", { seats: 5, code: "FAMILY-SEAT-5" });
    expect(stacked.body).toMatchObject({ seatLimit: 12, extraSeats: 6 });

    await h.addChild("Fits");
    expect((await h.api("GET", "/v1/family")).body.seatsUsed).toBe(7);
    await h.app.close();
  });

  it("rejects invalid seat packs", async () => {
    const h = await household();
    expect((await h.api("POST", "/v1/family/seats/purchase", { seats: 1, code: "NOPE" })).status).toBe(400);
    expect((await h.api("POST", "/v1/family/seats/purchase", { seats: 3 })).status).toBe(400);
    expect((await h.api("GET", "/v1/family")).body.extraSeats).toBe(0);
    await h.app.close();
  });

  it("exposes seat packs with prices", async () => {
    const h = await household();
    const snap = await h.api("GET", "/v1/family");
    expect(snap.body.seatPacks.map((p: Json) => p.seats)).toEqual([1, 2, 5]);
    expect(snap.body.seatPacks.every((p: Json) => p.priceHalalas > 0)).toBe(true);
    await h.app.close();
  });

  it("validates new members", async () => {
    const h = await household();
    const post = (payload: Json) => h.api("POST", "/v1/family/members", payload);
    expect((await post({ displayName: "", role: "partner" })).status).toBe(400);
    expect((await post({ displayName: "A", role: "grandma" })).status).toBe(400);
    expect((await post({ displayName: "A", role: "child", email: "a@x.io", password: "kidpassword" })).status).toBe(400);
    expect((await post({ displayName: "A", role: "child", ageTier: "tier_6_9", password: "kidpassword" })).status).toBe(400);
    expect((await post({ displayName: "A", role: "child", ageTier: "tier_6_9", email: "a@x.io", password: "short" })).status).toBe(400);
    expect((await post({ displayName: "A", role: "child", ageTier: "tier_6_9", email: "not-an-email", password: "kidpassword" })).status).toBe(400);
    const ok = await post({ displayName: "Partner", role: "partner" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ role: "partner", isManager: true, ageTier: null });
    await h.app.close();
  });

  it("refuses duplicate seat emails", async () => {
    const h = await household();
    await h.addChild("Dup", { email: "dup@arrab.studio" });
    const again = await h.api("POST", "/v1/family/members", {
      displayName: "Dup2", role: "child", ageTier: "tier_6_9", email: "DUP@arrab.studio", password: "kidpassword",
    });
    expect(again.status).toBe(400);
    await h.app.close();
  });

  it("shares the token pool without over-allocating", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Pool", { tokenAllowance: 50_000 });
    expect(kid.tokenAllowance).toBe(50_000);
    const snap = (await h.api("GET", "/v1/family")).body;
    const allocated = snap.members.reduce((n: number, m: Json) => n + m.tokenAllowance, 0);
    expect(allocated).toBeLessThanOrEqual(snap.usage.tokenLimit);

    const tooMuch = await h.api("POST", "/v1/family/tokens/grant", { memberId: kid.id, tokens: snap.usage.unallocatedTokens + 1 });
    expect(tooMuch.status).toBe(400);

    const moved = await h.api("POST", "/v1/family/tokens/grant", { memberId: kid.id, tokens: 1_000, fromMemberId: h.ownerId });
    expect(moved.body.members.find((m: Json) => m.id === kid.id).tokenAllowance).toBe(51_000);

    const zero = await h.api("POST", "/v1/family/tokens/grant", { memberId: kid.id, tokens: 0 });
    expect(zero.status).toBe(400);

    const broke = await h.api("POST", "/v1/family/tokens/grant", { memberId: h.ownerId, tokens: 1, fromMemberId: kid.id });
    expect(broke.status).toBe(200);
    const drain = await h.api("POST", "/v1/family/tokens/grant", { memberId: h.ownerId, tokens: 10_000_000, fromMemberId: kid.id });
    expect(drain.status).toBe(400);
    await h.app.close();
  });

  it("returns a removed member's allowance to the owner and protects the owner", async () => {
    const h = await household("FAMILY-ARRAB");
    const before = (await h.api("GET", "/v1/family")).body.members.find((m: Json) => m.isOwner).tokenAllowance;
    const kid = await h.addChild("Leaver", { tokenAllowance: 40_000 });
    const mid = (await h.api("GET", "/v1/family")).body.members.find((m: Json) => m.isOwner).tokenAllowance;
    expect(mid).toBe(before - 40_000);
    expect((await h.api("DELETE", `/v1/family/members/${kid.id}`)).body).toEqual({ ok: true });
    const after = (await h.api("GET", "/v1/family")).body;
    expect(after.members.find((m: Json) => m.isOwner).tokenAllowance).toBe(before);
    expect(after.seatsUsed).toBe(1);
    expect((await h.api("DELETE", `/v1/family/members/${h.ownerId}`)).status).toBe(400);
    expect((await h.api("DELETE", "/v1/family/members/missing")).status).toBe(404);
    await h.app.close();
  });

  it("keeps the owner a parent", async () => {
    const h = await household();
    const res = await h.api("PATCH", `/v1/family/members/${h.ownerId}`, { role: "child", ageTier: "tier_6_9" });
    expect(res.status).toBe(400);
    await h.app.close();
  });

  it("downgrading to a non-family plan closes the household", async () => {
    const h = await household();
    await h.addChild("Gone");
    await h.api("POST", "/v1/account/subscribe", { code: "PRO-ARRAB" });
    const snap = await h.api("GET", "/v1/family");
    expect(snap.body.available).toBe(false);
    expect(await h.context.familyHousehold.isFamilyPlanActive()).toBe(false);
    await h.app.close();
  });
});

describe("family seat sign-in", () => {
  it("signs a child in, rejects bad credentials, and blocks paused seats", async () => {
    const h = await household();
    const kid = await h.addChild("Login", { email: "login-kid@arrab.studio", password: "kidpassword" });

    const bad = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "login-kid@arrab.studio", password: "wrongpass1" } });
    expect(bad.statusCode).toBe(401);
    const unknown = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "nobody@arrab.studio", password: "kidpassword" } });
    expect(unknown.statusCode).toBe(401);
    const empty = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "login-kid@arrab.studio", password: "" } });
    expect(empty.statusCode).toBe(401);

    await h.api("PATCH", `/v1/family/members/${kid.id}`, { isPaused: true });
    const paused = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "login-kid@arrab.studio", password: "kidpassword" } });
    expect(paused.statusCode).toBe(403);

    await h.api("PATCH", `/v1/family/members/${kid.id}`, { isPaused: false });
    const ok = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "LOGIN-kid@arrab.studio", password: "kidpassword" } });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Json).member).toMatchObject({ id: kid.id, role: "child" });
    expect(JSON.stringify(ok.json())).not.toContain("passwordHash");
    await h.app.close();
  });

  it("never serialises password or PIN hashes", async () => {
    const h = await household();
    await h.addChild("Secret");
    const raw = JSON.stringify((await h.api("GET", "/v1/family")).body);
    expect(raw).not.toMatch(/passwordHash|pinHash|scrypt\$/);
    await h.app.close();
  });
});

describe("parental controls: configuring the guardian", () => {
  it("lets a parent update policy through the API and returns the sanitised result", async () => {
    const h = await household();
    const kid = await h.addChild("Policy", { ageTier: "tier_6_9" });
    expect(kid.guardian.policy).toMatchObject({ companionAccess: "kid_safe", oversightMode: "coach", dailyTokenLimit: 25_000 });

    const res = await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, {
      dailyTokenLimit: 10_000,
      blockedTopics: ["Roblox", " Fortnite "],
      quietHours: { start: "19:30", end: "06:45", days: [0, 1, 2], utcOffsetMinutes: 180 },
      rules: [{ text: "Homework before games", kind: "schedule" }],
      oversightMode: "full",
    });
    expect(res.status).toBe(200);
    expect(res.body.guardian.policy).toMatchObject({
      dailyTokenLimit: 10_000,
      blockedTopics: ["roblox", "fortnite"],
      oversightMode: "full",
      quietHours: { start: "19:30", end: "06:45", days: [0, 1, 2] },
    });
    expect(res.body.guardian.policy.rules[0]).toMatchObject({ text: "Homework before games", kind: "schedule", enabled: true });

    const snap = (await h.api("GET", "/v1/family")).body;
    const fromSnap = snap.members.find((m: Json) => m.id === kid.id);
    expect(fromSnap.guardian.policy.blockedTopics).toEqual(["roblox", "fortnite"]);
    expect(fromSnap.guardian.activity).toHaveLength(7);
    await h.app.close();
  });

  it("only applies to children and existing members", async () => {
    const h = await household();
    expect((await h.api("PATCH", `/v1/family/members/${h.ownerId}/guardian`, { dailyTokenLimit: 1 })).status).toBe(400);
    expect((await h.api("PATCH", "/v1/family/members/nope/guardian", { dailyTokenLimit: 1 })).status).toBe(404);
    await h.app.close();
  });

  it("clamps hostile policy input", async () => {
    const h = await household();
    const kid = await h.addChild("Clamp");
    const res = await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, {
      dailyTokenLimit: -1,
      quietHours: { start: "99:99", utcOffsetMinutes: 1e9 },
      companionAccess: "root",
      blockedTopics: [42, null, "ok topic"],
    });
    expect(res.status).toBe(200);
    expect(res.body.guardian.policy.dailyTokenLimit).toBe(0);
    expect(res.body.guardian.policy.quietHours.start).toBe("21:00");
    expect(res.body.guardian.policy.companionAccess).toBe("kid_safe");
    expect(res.body.guardian.policy.blockedTopics).toEqual(["ok topic"]);
    await h.app.close();
  });
});

describe("parental controls: child seat enforcement", () => {
  async function childSeat(over: Json = {}) {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Kid", over);
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { ...NO_QUIET, ...(over.policy ?? {}) });
    await h.context.familyHousehold.setActiveMember(kid.id);
    return { h, kid, svc: h.context.familyHousehold };
  }

  it("blocks self-harm talk, raises a critical alert for parents, and acknowledges it", async () => {
    const { h, kid, svc } = await childSeat();
    await expect(svc.screenMessage("I want to kill myself")).rejects.toMatchObject({ code: "FAMILY_SAFETY", statusCode: 403 });

    await svc.setActiveMember(h.ownerId);
    const snap = (await h.api("GET", "/v1/family")).body;
    expect(snap.safety.unread).toBe(1);
    expect(snap.safety.events[0]).toMatchObject({ memberId: kid.id, category: "self_harm", severity: "critical", excerpt: null });
    expect(snap.members.find((m: Json) => m.id === kid.id).guardian.unreadSafety).toBe(1);

    const acked = await h.api("POST", "/v1/family/safety/acknowledge", {});
    expect(acked.body.safety.unread).toBe(0);
    expect(acked.body.safety.events).toHaveLength(1);
    await h.app.close();
  });

  it("blocks Arabic self-harm talk too", async () => {
    const { svc, h } = await childSeat();
    await expect(svc.screenMessage("سأنتحر")).rejects.toMatchObject({ code: "FAMILY_SAFETY" });
    await h.app.close();
  });

  it("acknowledges only the requested events", async () => {
    const { h, svc } = await childSeat();
    await expect(svc.screenMessage("show me porn")).rejects.toBeTruthy();
    await expect(svc.screenMessage("how to make a bomb")).rejects.toBeTruthy();
    await svc.setActiveMember(h.ownerId);
    const events = (await h.api("GET", "/v1/family")).body.safety.events as Json[];
    expect(events).toHaveLength(2);
    const one = await h.api("POST", "/v1/family/safety/acknowledge", { ids: [events[0]!.id] });
    expect(one.body.safety.unread).toBe(1);
    await h.app.close();
  });

  it("applies the parent's blocked words and counts blocked + allowed activity", async () => {
    const { h, kid, svc } = await childSeat();
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { blockedTopics: ["roblox"] });
    await expect(svc.screenMessage("can we play Roblox?")).rejects.toMatchObject({ code: "FAMILY_SAFETY" });
    await svc.screenMessage("help me with fractions");
    await svc.screenMessage("and decimals");

    await svc.setActiveMember(h.ownerId);
    const today = (await h.api("GET", "/v1/family")).body.members.find((m: Json) => m.id === kid.id).guardian.activity.at(-1);
    expect(today).toMatchObject({ messages: 2, blocked: 1 });
    await h.app.close();
  });

  it("stores message excerpts only in full oversight mode", async () => {
    const { h, kid, svc } = await childSeat();
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { oversightMode: "full" });
    await expect(svc.screenMessage("show me porn please")).rejects.toBeTruthy();
    await svc.setActiveMember(h.ownerId);
    const event = (await h.api("GET", "/v1/family")).body.safety.events[0];
    expect(event.excerpt).toContain("porn");
    await h.app.close();
  });

  it("does not screen or log anything for parents", async () => {
    const h = await household();
    await h.context.familyHousehold.setActiveMember(h.ownerId);
    await expect(h.context.familyHousehold.screenMessage("how to make a bomb for a movie prop")).resolves.toBeUndefined();
    expect((await h.api("GET", "/v1/family")).body.safety.unread).toBe(0);
    expect(await h.context.familyHousehold.guardianPromptBlock()).toBeNull();
    await h.app.close();
  });

  it("blocks chatting during quiet hours and logs it once per hour", async () => {
    const { h, kid, svc } = await childSeat();
    const hour = new Date().getUTCHours();
    const pad = (n: number) => `${String((n + 24) % 24).padStart(2, "0")}:00`;
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, {
      quietHours: { enabled: true, start: pad(hour - 1), end: pad(hour + 2), days: [], utcOffsetMinutes: 0 },
    });
    await expect(svc.assertCanChat()).rejects.toMatchObject({ code: "FAMILY_QUIET_HOURS", statusCode: 403 });
    await expect(svc.assertCanChat()).rejects.toMatchObject({ code: "FAMILY_QUIET_HOURS" });

    await svc.setActiveMember(h.ownerId);
    const snap = (await h.api("GET", "/v1/family")).body;
    expect(snap.safety.events.filter((e: Json) => e.category === "quiet_hours")).toHaveLength(1);
    expect(snap.members.find((m: Json) => m.id === kid.id).guardian.quietHoursActive).toBe(true);

    await svc.setActiveMember(kid.id);
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { quietHours: { enabled: false } }, { "x-arrab-family-member": h.ownerId });
    await expect(svc.assertCanChat()).resolves.toBeUndefined();
    await h.app.close();
  });

  it("stops chat once the daily token limit is reached", async () => {
    const { h, kid, svc } = await childSeat();
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { dailyTokenLimit: 1_000 });
    await expect(svc.assertCanChat()).resolves.toBeUndefined();
    await svc.recordUsage(1_000);
    await expect(svc.assertCanChat()).rejects.toMatchObject({ code: "FAMILY_DAILY_LIMIT", statusCode: 403 });
    await svc.setActiveMember(h.ownerId);
    const snap = (await h.api("GET", "/v1/family")).body;
    expect(snap.safety.events.some((e: Json) => e.category === "daily_limit")).toBe(true);
    expect(snap.members.find((m: Json) => m.id === kid.id).guardian.tokensToday).toBe(1_000);
    await h.app.close();
  });

  it("treats a daily limit of 0 as unlimited", async () => {
    const { h, kid, svc } = await childSeat();
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { dailyTokenLimit: 0 });
    await svc.recordUsage(50_000);
    await expect(svc.assertCanChat()).resolves.toBeUndefined();
    await h.app.close();
  });

  it("blocks paused profiles", async () => {
    const { h, kid, svc } = await childSeat();
    await h.api("PATCH", `/v1/family/members/${kid.id}`, { isPaused: true });
    await expect(svc.assertCanChat()).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.switchProfile({ memberId: kid.id })).rejects.toMatchObject({ statusCode: 403 });
    await h.app.close();
  });

  it("blocks a child whose token allowance is spent on paid plans, but not on the free trial", async () => {
    const paid = await childSeat({ tokenAllowance: 1_000 });
    await paid.svc.recordUsage(1_000);
    await expect(paid.svc.assertCanChat()).rejects.toMatchObject({ statusCode: 403 });
    await paid.h.app.close();

    const free = await household("FAMILY-FREE-ARRAB");
    const kid = await free.addChild("Trial", { tokenAllowance: 1_000 });
    await free.api("PATCH", `/v1/family/members/${kid.id}/guardian`, NO_QUIET);
    await free.context.familyHousehold.setActiveMember(kid.id);
    await free.context.familyHousehold.recordUsage(5_000);
    await expect(free.context.familyHousehold.assertCanChat()).resolves.toBeUndefined();
    await free.app.close();
  });

  it("gives the model an age-appropriate guardian prompt with enabled house rules", async () => {
    const { h, kid, svc } = await childSeat({ ageTier: "tier_6_9" });
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, {
      rules: [
        { text: "Always be kind to siblings" },
        { text: "Secret disabled rule", enabled: false },
      ],
    });
    const block = await svc.guardianPromptBlock();
    expect(block).toContain("aged 6–9");
    expect(block).toContain("Always be kind to siblings");
    expect(block).not.toContain("Secret disabled rule");
    await h.app.close();
  });
});

describe("parental controls: seat isolation", () => {
  it("hides parent-only data and actions from a signed-in child", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Locked", { email: "locked@arrab.studio", password: "kidpassword" });
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { ...NO_QUIET, blockedTopics: ["secretword"] });
    await h.api("POST", "/v1/family/guidance", { companionId: "comp_x", childMemberId: kid.id, authorMemberId: h.ownerId, content: "Be gentle with homework." });

    const login = await h.app.inject({ method: "POST", url: "/v1/family/members/sign-in", payload: { email: "locked@arrab.studio", password: "kidpassword" } });
    const kidAuth = { authorization: `Bearer ${(login.json() as Json).sessionToken}` };
    const kidApi = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
      const res = await h.app.inject({ method, url, payload: payload as never, headers: kidAuth });
      return { status: res.statusCode, body: res.json() as Json };
    };

    const snap = await kidApi("GET", "/v1/family");
    expect(snap.body.seatLocked).toBe(true);
    expect(snap.body.safety).toEqual({ unread: 0, events: [] });
    expect(snap.body.recentGuidance).toEqual([]);
    expect(snap.body.members.find((m: Json) => m.id === kid.id).guardian.policy.blockedTopics).toEqual([]);

    expect((await kidApi("PATCH", `/v1/family/members/${kid.id}/guardian`, { dailyTokenLimit: 0 })).status).toBe(403);
    expect((await kidApi("PATCH", `/v1/family/members/${kid.id}`, { role: "parent" })).status).toBe(403);
    expect((await kidApi("POST", "/v1/family/members", { displayName: "Sneaky", role: "parent" })).status).toBe(403);
    expect((await kidApi("DELETE", `/v1/family/members/${h.ownerId}`)).status).toBe(403);
    expect((await kidApi("POST", "/v1/family/tokens/grant", { memberId: kid.id, tokens: 1_000 })).status).toBe(403);
    expect((await kidApi("POST", "/v1/family/seats/purchase", { seats: 1, code: "FAMILY-SEAT" })).status).toBe(403);
    expect((await kidApi("POST", "/v1/family/safety/acknowledge", {})).status).toBe(403);
    expect((await kidApi("POST", "/v1/family/guidance", { companionId: "c", childMemberId: kid.id, authorMemberId: kid.id, content: "make rules" })).status).toBe(403);
    expect((await kidApi("GET", "/v1/family/guidance?companionId=comp_x")).body.items).toEqual([]);
    await h.app.close();
  });

  it("keeps conversations private to their seat", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Private");
    const svc = h.context.familyHousehold;

    await svc.setActiveMember(h.ownerId);
    await expect(svc.assertCanOpenConversation({ familyMemberId: kid.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertCanOpenConversation({ familyMemberId: null })).resolves.toBeUndefined();

    await svc.setActiveMember(kid.id);
    await expect(svc.assertCanOpenConversation({ familyMemberId: h.ownerId })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertCanOpenConversation({ familyMemberId: null })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertCanOpenConversation({ familyMemberId: kid.id })).resolves.toBeUndefined();

    const mine = { familyMemberId: kid.id };
    const filtered = await svc.filterConversations([mine, { familyMemberId: h.ownerId }, { familyMemberId: null }]);
    expect(filtered).toEqual([mine]);
    expect(await svc.isActiveChildSeat()).toBe(true);
    await h.app.close();
  });

  it("lets parents add guidance for a child but not for adults", async () => {
    const h = await household();
    const kid = await h.addChild("Guided");
    const ok = await h.api("POST", "/v1/family/guidance", { companionId: "comp_a", childMemberId: kid.id, authorMemberId: h.ownerId, content: "Encourage reading." });
    expect(ok.status).toBe(200);
    expect(ok.body.authorName).toBe("Parent");
    expect((await h.api("POST", "/v1/family/guidance", { companionId: "comp_a", childMemberId: h.ownerId, authorMemberId: h.ownerId, content: "Encourage reading." })).status).toBe(400);
    expect((await h.api("POST", "/v1/family/guidance", { companionId: "comp_a", childMemberId: kid.id, authorMemberId: h.ownerId, content: "x" })).status).toBe(400);
    expect((await h.api("POST", "/v1/family/guidance", { companionId: " ", childMemberId: kid.id, authorMemberId: h.ownerId, content: "Fine words" })).status).toBe(400);
    await h.app.close();
  });
});

describe("parental controls: chat routes", () => {
  async function chat(h: Household, kidId: string, content: string) {
    const agent = await h.api("POST", "/v1/agents", { name: "Buddy", role: "companion", model: "amazon.nova-lite-v1:0" });
    await h.context.familyHousehold.setActiveMember(kidId);
    const convo = await h.api("POST", "/v1/conversations", { agentId: agent.body.id, title: "Kid chat" });
    return h.api("POST", `/v1/conversations/${convo.body.id}/messages`, { content });
  }

  it("rejects hard-failsafe messages from a child with a safety error", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Chatter");
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, NO_QUIET);
    const res = await chat(h, kid.id, "come to my house tonight");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_SAFETY");
    await h.context.familyHousehold.setActiveMember(h.ownerId);
    expect((await h.api("GET", "/v1/family")).body.safety.events[0]).toMatchObject({ category: "stranger", severity: "critical" });
    await h.app.close();
  });

  it("rejects the parent's blocked words and logs them", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Blocked");
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, { ...NO_QUIET, blockedTopics: ["fortnite"] });
    const res = await chat(h, kid.id, "tell me about Fortnite");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_SAFETY");
    await h.app.close();
  });

  it("returns FAMILY_QUIET_HOURS from the message route", async () => {
    const h = await household("FAMILY-ARRAB");
    const kid = await h.addChild("Sleepy");
    const hour = new Date().getUTCHours();
    const pad = (n: number) => `${String((n + 24) % 24).padStart(2, "0")}:00`;
    await h.api("PATCH", `/v1/family/members/${kid.id}/guardian`, {
      quietHours: { enabled: true, start: pad(hour - 1), end: pad(hour + 2), days: [], utcOffsetMinutes: 0 },
    });
    const res = await chat(h, kid.id, "hello there");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FAMILY_QUIET_HOURS");
    await h.app.close();
  });
});
