import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "../app.js";
import type { ApiEnv } from "../config/env.js";

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

describe("family household", () => {
  it("provisions owner seat, grants tokens, guides companions, and buys seats", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: {
        email: "parent@arrab.studio",
        password: "securepass",
        displayName: "Parent One",
      },
    });
    expect(connected.statusCode).toBe(200);
    const sessionToken = (connected.json() as { sessionToken: string }).sessionToken;

    const upgraded = await app.inject({
      method: "POST",
      url: "/v1/account/subscribe",
      payload: { code: "FAMILY-FREE-ARRAB" },
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(upgraded.statusCode).toBe(200);
    expect((upgraded.json() as { account: { planId: string } }).account.planId).toBe(
      "family_free",
    );

    const snap = await app.inject({
      method: "GET",
      url: "/v1/family",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(snap.statusCode).toBe(200);
    const household = snap.json() as {
      available: boolean;
      seatsUsed: number;
      seatLimit: number;
      extraSeats: number;
      members: Array<{
        id: string;
        displayName: string;
        isOwner: boolean;
        tokenAllowance: number;
        isManager: boolean;
      }>;
      usage: { unallocatedTokens: number } | null;
    };
    expect(household.available).toBe(true);
    expect(household.seatLimit).toBe(6);
    expect(household.seatsUsed).toBe(1);
    expect(household.members[0]?.isOwner).toBe(true);
    expect(household.members[0]?.isManager).toBe(true);
    expect(household.members[0]?.tokenAllowance).toBeGreaterThan(0);

    const child = await app.inject({
      method: "POST",
      url: "/v1/family/members",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        displayName: "Sam",
        role: "child",
        ageTier: "tier_10_13",
        pin: "1234",
      },
    });
    expect(child.statusCode).toBe(200);
    const childBody = child.json() as { id: string; hasPin: boolean; role: string };
    expect(childBody.hasPin).toBe(true);

    const granted = await app.inject({
      method: "POST",
      url: "/v1/family/tokens/grant",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        memberId: childBody.id,
        tokens: 10_000,
        fromMemberId: household.members[0]!.id,
      },
    });
    expect(granted.statusCode).toBe(200);

    const guidance = await app.inject({
      method: "POST",
      url: "/v1/family/guidance",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        companionId: "comp_study_buddy",
        childMemberId: childBody.id,
        authorMemberId: household.members[0]!.id,
        content: "Help Sam feel confident about school — be gentle and encouraging.",
      },
    });
    expect(guidance.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/family/guidance?companionId=comp_study_buddy",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: unknown[] }).items.length).toBe(1);

    const seats = await app.inject({
      method: "POST",
      url: "/v1/family/seats/purchase",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { seats: 2, code: "FAMILY-SEAT-2" },
    });
    expect(seats.statusCode).toBe(200);
    expect((seats.json() as { seatLimit: number; extraSeats: number }).extraSeats).toBe(2);
    expect((seats.json() as { seatLimit: number }).seatLimit).toBe(8);

    const badPin = await app.inject({
      method: "POST",
      url: "/v1/family/switch",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { memberId: childBody.id, pin: "9999" },
    });
    expect(badPin.statusCode).toBe(403);

    const goodPin = await app.inject({
      method: "POST",
      url: "/v1/family/switch",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { memberId: childBody.id, pin: "1234" },
    });
    expect(goodPin.statusCode).toBe(200);

    const paused = await app.inject({
      method: "PATCH",
      url: `/v1/family/members/${childBody.id}`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { isPaused: true },
    });
    expect(paused.statusCode).toBe(200);

    // Creating a conversation still works; sending must respect pause via header.
    const agent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { name: "Study Buddy", role: "companion", model: "amazon.nova-lite-v1:0" },
    });
    expect(agent.statusCode).toBe(200);
    const agentId = (agent.json() as { id: string }).id;
    const convo = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { agentId, title: "Kid chat" },
    });
    expect(convo.statusCode).toBe(200);
    const conversationId = (convo.json() as { id: string }).id;

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "x-arrab-family-member": childBody.id,
      },
      payload: { content: "hello" },
    });
    expect(blocked.statusCode).toBe(403);

    const resumed = await app.inject({
      method: "PATCH",
      url: `/v1/family/members/${childBody.id}`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { isPaused: false },
    });
    expect(resumed.statusCode).toBe(200);

    // Attribute usage to the child profile via header.
    await context.familyHousehold.recordUsage(2500, childBody.id);
    const afterUsage = await app.inject({
      method: "GET",
      url: "/v1/family",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const childAfter = (
      afterUsage.json() as { members: Array<{ id: string; tokensUsed: number }> }
    ).members.find((m) => m.id === childBody.id);
    expect(childAfter?.tokensUsed).toBeGreaterThanOrEqual(2500);

    await app.close();
  });
});
