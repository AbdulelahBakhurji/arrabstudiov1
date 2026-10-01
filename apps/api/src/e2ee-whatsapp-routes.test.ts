import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "./app.js";
import type { ApiEnv } from "./config/env.js";

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


async function signedInApp() {
  const app = await buildApp(await createApiContext(testEnv));
  const connected = await app.inject({
    method: "POST",
    url: "/v1/account/connect",
    payload: { email: "owner@arrab.studio", password: "securepass", displayName: "Owner" },
  });
  const token = (connected.json() as { sessionToken: string }).sessionToken;
  return { app, auth: { authorization: `Bearer ${token}` } };
}

describe("encrypted chat vault routes", () => {
  it("requires a session and round-trips ciphertext only", async () => {
    const { app, auth } = await signedInApp();
    expect((await app.inject({ method: "GET", url: "/v1/e2ee/key" })).statusCode).toBe(401);

    const key = {
      v: 1,
      kdf: "pbkdf2-sha256",
      iterations: 600000,
      salt: "c2FsdHNhbHRzYWx0c2FsdA==",
      iv: "aXZpdml2aXZpdml2",
      ct: "Y2lwaGVydGV4dGNpcGhlcnRleHRjaXBoZXJ0ZXh0Y2lwaGVy",
      fingerprint: "0123456789abcdef",
    };
    const put = await app.inject({
      method: "PUT",
      url: "/v1/e2ee/key",
      headers: auth,
      payload: { wrappedKey: key },
    });
    expect(put.statusCode).toBe(200);
    const got = await app.inject({ method: "GET", url: "/v1/e2ee/key", headers: auth });
    expect((got.json() as { wrappedKey: { fingerprint: string } }).wrappedKey.fingerprint).toBe(
      "0123456789abcdef",
    );

    const sealed = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
    const chat = await app.inject({
      method: "PUT",
      url: "/v1/e2ee/chats/chat-12345678",
      headers: auth,
      payload: { sealed },
    });
    expect(chat.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/v1/e2ee/chats", headers: auth });
    expect((list.json() as { items: Array<{ sealed: string }> }).items[0]?.sealed).toBe(sealed);
  });
});

describe("WhatsApp (OpenWA) webhook", () => {
  it("is reachable without a studio session but still demands a valid signature", async () => {
    const { app } = await signedInApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/connectors/openwa/webhook",
      payload: { event: "message.received", sessionId: "unknown", data: { from: "1", body: "hi" } },
    });
    // 401 would mean the gateway can never deliver inbound messages.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(400);
  });
});
