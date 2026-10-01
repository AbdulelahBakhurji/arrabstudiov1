import { brandId, type ConnectorSecretRecord, type WorkspaceId } from "@arrab/shared";
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



function row(id: string, connectedAt: string): ConnectorSecretRecord {
  return {
    id,
    workspaceId: brandId<WorkspaceId>("ws_local_studio"),
    provider: "notion",
    status: "connected",
    accountLabel: id,
    scopes: [],
    connectedAt,
    lastVerifiedAt: null,
    error: null,
    secret: "token",
    familyMemberId: null,
    ownerEmployeeId: null,
  };
}

const signUp = (app: Awaited<ReturnType<typeof buildApp>>, email: string) =>
  app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: { email, password: "securepass", displayName: email },
  });

describe("a new account never inherits the previous account's data", () => {
  it("wipes connectors and the encrypted vault when the account is removed", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const first = (await signUp(app, "old@arrab.studio")).json() as { sessionToken: string };
    await context.persistence.connectors.create(row("old-notion", new Date().toISOString()));
    await context.persistence.sealedVault.putChat("owner", {
      id: "chat-12345678",
      sealed: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
      updatedAt: new Date().toISOString(),
    });

    const gone = await app.inject({
      method: "POST",
      url: "/v1/account/disconnect",
      headers: { authorization: `Bearer ${first.sessionToken}` },
    });
    expect(gone.statusCode).toBe(200);

    const second = (await signUp(app, "new@arrab.studio")).json() as { sessionToken: string };
    const auth = { authorization: `Bearer ${second.sessionToken}` };
    const list = await app.inject({ method: "GET", url: "/v1/connectors", headers: auth });
    expect((list.json() as { items: unknown[] }).items).toEqual([]);
    expect(await context.persistence.sealedVault.listChats("owner")).toEqual([]);
  });

  it("hides connectors left behind by a previous account on an already-created account", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const account = (await signUp(app, "now@arrab.studio")).json() as { sessionToken: string };
    // Leftover from before this account existed (e.g. created by a removed account).
    await context.persistence.connectors.create(row("leftover", "2000-01-01T00:00:00.000Z"));
    await context.persistence.connectors.create(row("mine", new Date(Date.now() + 1000).toISOString()));
    const auth = { authorization: `Bearer ${account.sessionToken}` };
    const list = await app.inject({ method: "GET", url: "/v1/connectors", headers: auth });
    expect((list.json() as { items: Array<{ id: string }> }).items.map((c) => c.id)).toEqual(["mine"]);
  });
});
