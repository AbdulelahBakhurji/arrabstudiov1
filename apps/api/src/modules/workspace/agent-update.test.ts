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
  moyasarSecretKey: undefined,
  moyasarPublishableKey: undefined,
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
};

describe("agent updates", () => {
  it("does not rewrite or log an update that changes nothing", async () => {
    const app = await buildApp(await createApiContext(testEnv));
    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "agents@arrab.studio", password: "securepass", displayName: "Agents" },
    });
    const headers = { authorization: `Bearer ${(connected.json() as { sessionToken: string }).sessionToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers,
      payload: { name: "Sara", role: "Account manager", instructions: "Be concise." },
    });
    const agent = created.json() as { id: string; updatedAt: string };
    const updatedCount = async () => {
      const res = await app.inject({ method: "GET", url: "/v1/activity", headers });
      const body = res.json() as { items?: Array<{ summary?: string }> } | Array<{ summary?: string }>;
      const items = Array.isArray(body) ? body : (body.items ?? []);
      return items.filter((item) => /Updated AI employee/.test(JSON.stringify(item))).length;
    };
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/v1/agents/${agent.id}`, headers, payload });

    const same = await patch({ instructions: "Be concise.", role: "Account manager" });
    expect(same.statusCode).toBe(200);
    expect((same.json() as { updatedAt: string }).updatedAt).toBe(agent.updatedAt);
    expect(await updatedCount()).toBe(0);

    await patch({ instructions: "Be brief." });
    expect(await updatedCount()).toBe(1);
  });

  it("returns the same agent for a repeated clientKey", async () => {
    const app = await buildApp(await createApiContext(testEnv));
    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "key@arrab.studio", password: "securepass", displayName: "Key" },
    });
    const headers = { authorization: `Bearer ${(connected.json() as { sessionToken: string }).sessionToken}` };
    const create = (clientKey: string) =>
      app.inject({
        method: "POST",
        url: "/v1/agents",
        headers,
        payload: { name: "General", role: "General", clientKey },
      });
    const a = (await create("companion:c1:personal")).json() as { id: string };
    const b = (await create("companion:c1:personal")).json() as { id: string };
    const c = (await create("companion:c1:work")).json() as { id: string };
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it("paginates activity newest-first with a cursor", async () => {
    const app = await buildApp(await createApiContext(testEnv));
    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "page@arrab.studio", password: "securepass", displayName: "Page" },
    });
    const headers = { authorization: `Bearer ${(connected.json() as { sessionToken: string }).sessionToken}` };
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/agents",
        headers,
        payload: { name: `Agent ${i}`, role: "Tester" },
      });
    }
    const first = (await app.inject({ method: "GET", url: "/v1/activity?limit=2", headers })).json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]!.id);
    const second = (
      await app.inject({ method: "GET", url: `/v1/activity?limit=2&before=${first.nextCursor}`, headers })
    ).json() as { items: Array<{ id: string }> };
    expect(second.items).toHaveLength(2);
    expect(second.items.some((item) => first.items.some((seen) => seen.id === item.id))).toBe(false);
  });

  it("caches CORS preflights", async () => {
    const app = await buildApp(await createApiContext(testEnv));
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/agents",
      headers: { origin: "http://localhost:1420", "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-max-age"]).toBe("600");
  });
});
