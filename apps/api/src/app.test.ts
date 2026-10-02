import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "./app.js";
import type { ApiEnv } from "./platform/config/env.js";

const testEnv: ApiEnv = {
  host: "127.0.0.1",
  port: 8787,
  logLevel: "error",
  corsOrigins: ["http://localhost:1420"],
  databaseUrl: undefined,
  dataDir: undefined,
  bedrockApiKey: "test-bedrock-key",
  bedrockRegion: "eu-north-1",
  bedrockModels: [
    "amazon.nova-lite-v1:0",
    "amazon.nova-pro-v1:0",
    "google.gemma-3-12b-it",
    "openai.gpt-oss-120b-1:0",
  ],
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
  openwaBaseUrl: "http://127.0.0.1:2785",
  openwaWebhookSecret: undefined,
  openwaSessionId: "arrab",
  openwaApiKey: undefined,
  finnhubApiKey: undefined,
  finnhubWebhookSecret: undefined,
  apiRoutePrefix: "",
  // Tests redeem public plan codes; production keeps them off (see ARRAB_ENABLE_PLAN_CODES).
  allowPlanCodes: true,
};

describe("arrab api", () => {
  it("reports health", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("returns an empty dashboard for a seeded workspace", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const response = await app.inject({ method: "GET", url: "/v1/dashboard" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      workspace: { slug: string };
      projects: unknown[];
      conversations: unknown[];
    };
    expect(body.workspace.slug).toBe("local");
    expect(body.projects).toEqual([]);
    expect(body.conversations).toEqual([]);
    await app.close();
  });

  it("creates a project and records activity", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const created = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "Launch Pad", description: "First project" },
    });
    expect(created.statusCode).toBe(200);
    const project = created.json() as { id: string; name: string };
    expect(project.name).toBe("Launch Pad");

    const agent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      payload: { name: "Researcher", role: "research", projectId: project.id },
    });
    expect(agent.statusCode).toBe(200);

    await app.close();
  });

  it("creates a conversation and stores a user message with Bedrock", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: { message: { role: "assistant", content: [{ text: "Roadmap summary." }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const context = await createApiContext(testEnv);
      const app = await buildApp(context);

      const agent = await app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: { name: "Analyst", role: "analysis", status: "active" },
      });
      const agentBody = agent.json() as { id: string };

      const conversation = await app.inject({
        method: "POST",
        url: "/v1/conversations",
        payload: { agentId: agentBody.id },
      });
      expect(conversation.statusCode).toBe(200);
      const conversationBody = conversation.json() as { id: string; title: string };
      expect(conversationBody.title).toContain("Analyst");

      const message = await app.inject({
        method: "POST",
        url: `/v1/conversations/${conversationBody.id}/messages`,
        payload: { content: "Summarize our roadmap." },
      });
      expect(message.statusCode).toBe(200);
      const messageBody = message.json() as {
        userMessage: { content: string };
        assistantMessage: { content: string } | null;
        providerConfigured: boolean;
      };
      expect(messageBody.providerConfigured).toBe(true);
      expect(messageBody.assistantMessage?.content).toContain("Roadmap");
      expect(messageBody.userMessage.content).toBe("Summarize our roadmap.");

      const detail = await app.inject({
        method: "GET",
        url: `/v1/conversations/${conversationBody.id}`,
      });
      expect(detail.statusCode).toBe(200);
      const detailBody = detail.json() as { messages: Array<{ role: string }> };
      expect(detailBody.messages.length).toBeGreaterThanOrEqual(2);

      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("streams thinking and tokens over SSE from Bedrock converse-stream", async () => {
    const encoder = new TextEncoder();
    const frame = (eventType: string, payload: unknown) => {
      const headers: number[] = [];
      for (const [name, value] of [
        [":event-type", eventType],
        [":message-type", "event"],
      ] as const) {
        const n = encoder.encode(name);
        const v = encoder.encode(value);
        headers.push(n.length, ...n, 7, v.length >> 8, v.length & 0xff, ...v);
      }
      const body = encoder.encode(JSON.stringify(payload));
      const out = new Uint8Array(12 + headers.length + body.length + 4);
      const view = new DataView(out.buffer);
      view.setUint32(0, out.length);
      view.setUint32(4, headers.length);
      out.set(headers, 12);
      out.set(body, 12 + headers.length);
      return out;
    };
    const originalFetch = globalThis.fetch;
    let streamBody: { inferenceConfig?: { maxTokens?: number } } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/converse-stream")) {
        streamBody = JSON.parse(String(init?.body)) as typeof streamBody;
        const parts = [
          frame("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "Weighing options" } } }),
          frame("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "Ship " } }),
          frame("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "Friday." } }),
          frame("messageStop", { stopReason: "end_turn" }),
          frame("metadata", { usage: { inputTokens: 4, outputTokens: 6 } }),
        ];
        return new Response(new Blob(parts), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    try {
      const context = await createApiContext(testEnv);
      const app = await buildApp(context);
      const agent = await app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: { name: "Planner", role: "planning", status: "active" },
      });
      const conversation = await app.inject({
        method: "POST",
        url: "/v1/conversations",
        payload: { agentId: (agent.json() as { id: string }).id },
      });
      const conversationId = (conversation.json() as { id: string }).id;

      const response = await app.inject({
        method: "POST",
        url: `/v1/conversations/${conversationId}/messages/stream`,
        payload: { content: "When do we ship?", thinking: "medium" },
      });
      const events = response.body
        .split("\n\n")
        .map((block) => ({
          event: /^event: (.+)$/m.exec(block)?.[1],
          data: /^data: (.+)$/m.exec(block)?.[1],
        }))
        .filter((entry) => entry.event);
      const names = events.map((entry) => entry.event);
      expect(names.indexOf("thinking")).toBeGreaterThan(-1);
      expect(names.indexOf("thinking")).toBeLessThan(names.indexOf("token"));
      expect(names.at(-1)).toBe("done");
      const tokens = events
        .filter((entry) => entry.event === "token")
        .map((entry) => (JSON.parse(entry.data!) as { text: string }).text)
        .join("");
      expect(tokens).toBe("Ship Friday.");
      const done = JSON.parse(events.at(-1)!.data!) as { assistantMessage: { content: string } };
      // Reasoning is streamed live but never stored in the transcript.
      expect(done.assistantMessage.content).toBe("Ship Friday.");
      expect(streamBody!.inferenceConfig!.maxTokens).toBeGreaterThanOrEqual(4000);
      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("tracks memberships, bindings, and empty usage", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "Repo Project" },
    });
    const projectBody = project.json() as { id: string };

    const team = await app.inject({
      method: "POST",
      url: "/v1/teams",
      payload: { name: "Core", projectId: projectBody.id },
    });
    const teamBody = team.json() as { id: string };

    const agent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      payload: { name: "Eng", role: "engineer", projectId: projectBody.id, status: "active" },
    });
    const agentBody = agent.json() as { id: string };

    const member = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamBody.id}/members`,
      payload: { agentId: agentBody.id },
    });
    expect(member.statusCode).toBe(200);

    const members = await app.inject({ method: "GET", url: "/v1/memberships" });
    expect(members.statusCode).toBe(200);
    expect((members.json() as { items: unknown[] }).items).toHaveLength(1);

    const usage = await app.inject({ method: "GET", url: "/v1/usage" });
    expect(usage.statusCode).toBe(200);
    expect((usage.json() as { totals: { events: number } }).totals.events).toBe(0);

    const meta = await app.inject({ method: "GET", url: "/v1/meta" });
    expect((meta.json() as { version: string }).version).toBe("0.15.1");

    await app.close();
  });

  it("supports operator seats: create then choose", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const created = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      payload: { displayName: "Abdulelah", addSeat: "CEO" },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json() as {
      title: string | null;
      seats: string[];
      displayName: string;
    };
    expect(createdBody.displayName).toBe("Abdulelah");
    expect(createdBody.title).toBeNull();
    expect(createdBody.seats).toContain("CEO");

    const selected = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      payload: { title: "CEO" },
    });
    expect(selected.statusCode).toBe(200);
    expect((selected.json() as { title: string }).title).toBe("CEO");

    const rejected = await app.inject({
      method: "PUT",
      url: "/v1/operator",
      payload: { title: "CTO" },
    });
    expect(rejected.statusCode).toBe(400);

    const agent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      payload: { name: "Ops", role: "ops", status: "active" },
    });
    const agentBody = agent.json() as { id: string };

    const task = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      payload: {
        title: "Ship command center",
        brief: "Build Phase 5",
        assigneeAgentId: agentBody.id,
        priority: "high",
      },
    });
    expect(task.statusCode).toBe(200);
    const taskBody = task.json() as { id: string; status: string };
    expect(taskBody.status).toBe("assigned");

    const report = await app.inject({ method: "GET", url: "/v1/reports/summary" });
    expect(report.statusCode).toBe(200);
    const reportBody = report.json() as {
      operator: { title: string | null };
      tasks: { total: number; open: number };
    };
    expect(reportBody.operator.title).toBe("CEO");
    expect(reportBody.tasks.total).toBe(1);
    expect(reportBody.tasks.open).toBe(1);

    await app.close();
  });

  it("stores knowledge and runs a task with Bedrock", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: { message: { role: "assistant", content: [{ text: "Draft ready." }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const context = await createApiContext(testEnv);
      const app = await buildApp(context);

      const agent = await app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: { name: "Runner", role: "engineer", status: "active" },
      });
      const agentBody = agent.json() as { id: string };

      const knowledge = await app.inject({
        method: "POST",
        url: "/v1/knowledge",
        payload: {
          title: "Playbook",
          content: "Keep answers short and shippable.",
        },
      });
      expect(knowledge.statusCode).toBe(200);

      const task = await app.inject({
        method: "POST",
        url: "/v1/tasks",
        payload: {
          title: "Draft plan",
          assigneeAgentId: agentBody.id,
        },
      });
      const taskBody = task.json() as { id: string };

      const run = await app.inject({
        method: "POST",
        url: `/v1/tasks/${taskBody.id}/run`,
      });
      expect(run.statusCode).toBe(200);
      const runBody = run.json() as {
        providerConfigured: boolean;
        run: { status: string };
        task: { status: string };
      };
      expect(runBody.providerConfigured).toBe(true);
      expect(runBody.run.status).toBe("completed");
      expect(["in_progress", "done"]).toContain(runBody.task.status);

      const report = await app.inject({ method: "GET", url: "/v1/reports/summary" });
      const reportBody = report.json() as {
        knowledgeCount: number;
        skillCount: number;
        pendingApprovals: number;
        recentTaskRuns: unknown[];
      };
      expect(reportBody.knowledgeCount).toBe(1);
      expect(reportBody.skillCount).toBe(0);
      expect(reportBody.pendingApprovals).toBe(0);
      expect(reportBody.recentTaskRuns.length).toBe(1);

      const meta = await app.inject({ method: "GET", url: "/v1/meta" });
      expect((meta.json() as { version: string }).version).toBe("0.15.1");

      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("teaches skills and gates high-risk runs behind approvals", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: { message: { role: "assistant", content: [{ text: "Ship report done." }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const context = await createApiContext(testEnv);
      const app = await buildApp(context);

      const agent = await app.inject({
        method: "POST",
        url: "/v1/agents",
        payload: { name: "Operator", role: "ops", status: "draft" },
      });
      const agentBody = agent.json() as { id: string; name: string };

      const skill = await app.inject({
        method: "POST",
        url: "/v1/skills",
        payload: {
          agentId: agentBody.id,
          title: "Triage inbox",
          instructions: "Summarize urgent mail and propose replies.",
        },
      });
      expect(skill.statusCode).toBe(200);
      const skillBody = skill.json() as { skill: { title: string }; task: { id: string } | null };
      expect(skillBody.skill.title).toBe("Triage inbox");
      expect(skillBody.task).not.toBeNull();

      const listed = await app.inject({
        method: "GET",
        url: `/v1/skills?agentId=${agentBody.id}`,
      });
      expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);

      const activation = await app.inject({
        method: "POST",
        url: "/v1/approvals",
        payload: {
          kind: "activate_agent",
          title: `Activate ${agentBody.name}`,
          agentId: agentBody.id,
        },
      });
      expect(activation.statusCode).toBe(200);
      const activationBody = activation.json() as { id: string };

      const resolved = await app.inject({
        method: "POST",
        url: `/v1/approvals/${activationBody.id}/resolve`,
        payload: { status: "approved" },
      });
      expect(resolved.statusCode).toBe(200);
      expect((resolved.json() as { agent?: { status: string } }).agent?.status).toBe("active");

      const task = await app.inject({
        method: "POST",
        url: "/v1/tasks",
        payload: {
          title: "Ship report",
          assigneeAgentId: agentBody.id,
          priority: "urgent",
        },
      });
      const taskBody = task.json() as { id: string };

      const gated = await app.inject({
        method: "POST",
        url: `/v1/tasks/${taskBody.id}/run`,
        payload: { requireApproval: true },
      });
      expect(gated.statusCode).toBe(200);
      const gatedBody = gated.json() as {
        run: { status: string };
        approval: { id: string; kind: string } | null;
      };
      expect(gatedBody.run.status).toBe("awaiting_approval");
      expect(gatedBody.approval?.kind).toBe("run_task");

      const pending = await app.inject({ method: "GET", url: "/v1/approvals/pending" });
      expect((pending.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

      const continueRun = await app.inject({
        method: "POST",
        url: `/v1/approvals/${gatedBody.approval!.id}/resolve`,
        payload: { status: "approved" },
      });
      expect(continueRun.statusCode).toBe(200);
      expect((continueRun.json() as { run?: { run: { status: string } } }).run?.run.status).toBe(
        "completed",
      );

      const report = await app.inject({ method: "GET", url: "/v1/reports/summary" });
      const reportBody = report.json() as { skillCount: number };
      expect(reportBody.skillCount).toBe(1);

      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates github commit payloads and creates git_push approvals", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/github/repos/acme/demo/commits",
      payload: {
        connectorId: "missing",
        message: "hello",
        files: [{ path: "README.md", content: "# hi" }],
      },
    });
    expect(missing.statusCode).toBe(404);

    const approval = await app.inject({
      method: "POST",
      url: "/v1/approvals",
      payload: {
        kind: "git_push",
        title: "Push workspace change",
        detail: JSON.stringify({ owner: "acme", repo: "demo" }),
      },
    });
    expect(approval.statusCode).toBe(200);
    expect((approval.json() as { kind: string }).kind).toBe("git_push");

    const meta = await app.inject({ method: "GET", url: "/v1/meta" });
    expect((meta.json() as { version: string }).version).toBe("0.15.1");

    await app.close();
  });

  it("connects an account, activates pro subscription, and exposes entitlements", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const before = await app.inject({ method: "GET", url: "/v1/account" });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as {
      connected: boolean;
      entitlements: { tokenLimit: number | null; connected: boolean };
    };
    expect(beforeBody.connected).toBe(false);
    expect(beforeBody.entitlements.tokenLimit).toBeNull();

    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: {
        email: "founder@arrab.studio",
        password: "securepass",
        displayName: "Founder",
      },
    });
    expect(connected.statusCode).toBe(200);
    const connectedBody = connected.json() as {
      account: { planId: string; email: string };
      entitlements: { tokenLimit: number | null };
      sessionToken: string;
    };
    expect(connectedBody.account.planId).toBe("free");
    expect(connectedBody.account.email).toBe("founder@arrab.studio");
    expect(connectedBody.entitlements.tokenLimit).toBe(100_000);
    expect(connectedBody.sessionToken.length).toBeGreaterThan(20);

    const blocked = await app.inject({ method: "GET", url: "/v1/connectors" });
    expect(blocked.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/connectors",
      headers: { authorization: `Bearer ${connectedBody.sessionToken}` },
    });
    expect(allowed.statusCode).toBe(200);

    const upgraded = await app.inject({
      method: "POST",
      url: "/v1/account/subscribe",
      headers: { authorization: `Bearer ${connectedBody.sessionToken}` },
      payload: { code: "PRO-ARRAB" },
    });
    expect(upgraded.statusCode).toBe(200);
    const upgradedBody = upgraded.json() as {
      account: { planId: string };
      entitlements: { tokenLimit: number | null; planName: string };
    };
    expect(upgradedBody.account.planId).toBe("pro");
    expect(upgradedBody.entitlements.tokenLimit).toBe(2_000_000);

    const usage = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { authorization: `Bearer ${connectedBody.sessionToken}` },
    });
    expect(
      (usage.json() as { entitlements: { planId: string } }).entitlements.planId,
    ).toBe("pro");

    const meta = await app.inject({
      method: "GET",
      url: "/v1/meta",
      headers: { authorization: `Bearer ${connectedBody.sessionToken}` },
    });
    expect((meta.json() as { account: { connected: boolean; planId: string } }).account.connected).toBe(
      true,
    );

    await app.close();
  });

  it("scopes /v1/usage totals to the current billing period", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: {
        email: "usage-period@arrab.studio",
        password: "securepass",
        displayName: "Usage Period",
      },
    });
    expect(connected.statusCode).toBe(200);
    const connectedJson = connected.json() as {
      account: { periodStart: string; periodEnd: string };
      sessionToken: string;
    };
    const account = connectedJson.account;
    const sessionToken = connectedJson.sessionToken;

    const workspace = await context.persistence.getWorkspace();
    await context.persistence.usage.append({
      id: "usage-old",
      workspaceId: workspace.workspace.id,
      conversationId: null,
      agentId: null,
      providerId: "anthropic",
      model: "claude",
      inputTokens: 500_000,
      outputTokens: 20_000,
      // Outside the current period — must not appear in Settings token cards.
      createdAt: new Date(new Date(account.periodStart).getTime() - 86_400_000).toISOString(),
    });
    await context.persistence.usage.append({
      id: "usage-current",
      workspaceId: workspace.workspace.id,
      conversationId: null,
      agentId: null,
      providerId: "anthropic",
      model: "claude",
      inputTokens: 1_200,
      outputTokens: 300,
      createdAt: new Date(
        new Date(account.periodStart).getTime() + 60_000,
      ).toISOString(),
    });

    const usage = await app.inject({
      method: "GET",
      url: "/v1/usage",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(usage.statusCode).toBe(200);
    const body = usage.json() as {
      totals: { inputTokens: number; outputTokens: number; events: number };
      entitlements: { tokensUsed: number };
    };
    expect(body.totals.inputTokens).toBe(1_200);
    expect(body.totals.outputTokens).toBe(300);
    expect(body.totals.events).toBe(1);
    expect(body.entitlements.tokensUsed).toBe(1_500);

    await app.close();
  });

  it("hires an AI person with instructions that persist on the agent", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const hired = await app.inject({
      method: "POST",
      url: "/v1/agents",
      payload: {
        name: "Maya",
        role: "Customer success",
        specialty: "Enterprise onboarding",
        bio: "Calm operator who turns chaos into checklists.",
        instructions: "Always ask for the account tier before proposing a plan.",
        status: "active",
        starterBrief: "Our ICP is mid-market SaaS in GCC.",
        starterKnowledge: {
          title: "Support tone",
          content: "Be warm, short, and never invent SLAs.",
        },
      },
    });
    expect(hired.statusCode).toBe(200);
    const body = hired.json() as {
      name: string;
      specialty: string;
      instructions: string;
      id: string;
    };
    expect(body.name).toBe("Maya");
    expect(body.specialty).toBe("Enterprise onboarding");
    expect(body.instructions).toContain("account tier");

    const memories = await app.inject({ method: "GET", url: "/v1/memories" });
    expect(memories.statusCode).toBe(200);
    expect(
      (memories.json() as { items: Array<{ content: string; agentId: string | null }> }).items.some(
        (item) => item.agentId === body.id && item.content.includes("ICP"),
      ),
    ).toBe(true);

    const knowledge = await app.inject({ method: "GET", url: "/v1/knowledge" });
    expect(
      (knowledge.json() as { items: Array<{ title: string }> }).items.some(
        (item) => item.title === "Support tone",
      ),
    ).toBe(true);

    await app.close();
  });

  it("completes browser web auth and marks the studio signed in", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const started = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/start",
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    const startBody = started.json() as {
      state: string;
      pollSecret: string;
      authorizationUrl: string;
      pollIntervalMs: number;
    };
    expect(startBody.state.length).toBeGreaterThan(10);
    expect(startBody.pollSecret.length).toBeGreaterThan(20);
    expect(startBody.authorizationUrl).toContain(startBody.state);

    const pending = await app.inject({
      method: "GET",
      url: `/v1/account/auth/web/poll?state=${encodeURIComponent(startBody.state)}&pollSecret=${encodeURIComponent(startBody.pollSecret)}`,
    });
    expect(pending.statusCode).toBe(200);
    expect((pending.json() as { status: string }).status).toBe("pending");

    const badPoll = await app.inject({
      method: "GET",
      url: `/v1/account/auth/web/poll?state=${encodeURIComponent(startBody.state)}`,
    });
    expect(badPoll.statusCode).toBe(401);

    const completed = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/complete",
      payload: {
        state: startBody.state,
        email: "web@arrab.studio",
        password: "securepass",
        displayName: "Web Operator",
        planCode: "PRO-ARRAB",
      },
    });
    expect(completed.statusCode).toBe(200);
    const completedBody = completed.json() as {
      account: { email: string; planId: string; displayName: string };
      sessionToken: string;
    };
    expect(completedBody.account.email).toBe("web@arrab.studio");
    expect(completedBody.account.planId).toBe("pro");
    expect(completedBody.sessionToken.length).toBeGreaterThan(20);

    const polled = await app.inject({
      method: "GET",
      url: `/v1/account/auth/web/poll?state=${encodeURIComponent(startBody.state)}&pollSecret=${encodeURIComponent(startBody.pollSecret)}`,
    });
    expect(polled.statusCode).toBe(200);
    const polledBody = polled.json() as {
      status: string;
      account: { email: string };
      sessionToken: string;
    };
    expect(polledBody.status).toBe("completed");
    expect(polledBody.account.email).toBe("web@arrab.studio");
    expect(polledBody.sessionToken).toBe(completedBody.sessionToken);

    const status = await app.inject({
      method: "GET",
      url: "/v1/account",
      headers: { authorization: `Bearer ${completedBody.sessionToken}` },
    });
    expect((status.json() as { connected: boolean }).connected).toBe(true);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/account/logout",
      headers: { authorization: `Bearer ${completedBody.sessionToken}` },
    });
    expect(logout.statusCode).toBe(200);
    // Logout ends the device session but keeps the account for reconnect.
    expect((logout.json() as { connected: boolean; account: unknown }).connected).toBe(true);
    expect((logout.json() as { account: { email: string } | null }).account?.email).toBe(
      "web@arrab.studio",
    );

    const staleSession = await app.inject({
      method: "POST",
      url: "/v1/account/session",
      payload: { sessionToken: completedBody.sessionToken },
    });
    expect(staleSession.statusCode).toBe(401);

    await app.close();
  });

  it("rejects web auth without a password", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const started = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/start",
      payload: {},
    });
    const state = (started.json() as { state: string }).state;
    const completed = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/complete",
      payload: { state, email: "nopass@arrab.studio", displayName: "No Pass" },
    });
    expect(completed.statusCode).toBe(400);
    await app.close();
  });

  it("verifies a session token after sign-in", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "session@arrab.studio", password: "securepass", displayName: "Sess" },
    });
    const token = (connected.json() as { sessionToken: string }).sessionToken;
    const ok = await app.inject({
      method: "POST",
      url: "/v1/account/session",
      payload: { sessionToken: token },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { connected: boolean }).connected).toBe(true);
    const bad = await app.inject({
      method: "POST",
      url: "/v1/account/session",
      payload: { sessionToken: "not-a-real-token" },
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });

  it("lists paid plans and refuses checkout without Moyasar", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const catalog = await app.inject({ method: "GET", url: "/v1/billing/plans" });
    expect(catalog.statusCode).toBe(200);
    const body = catalog.json() as {
      provider: string;
      configured: boolean;
      plans: Array<{ id: string; monthlyPriceHalalas: number }>;
    };
    expect(body.provider).toBe("moyasar");
    expect(body.configured).toBe(false);
    expect(body.plans.some((plan) => plan.id === "pro" && plan.monthlyPriceHalalas === 4900)).toBe(
      true,
    );

    const connected = await app.inject({
      method: "POST",
      url: "/v1/account/connect",
      payload: { email: "bill@arrab.studio", password: "securepass" },
    });
    const sessionToken = (connected.json() as { sessionToken: string }).sessionToken;
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { planId: "pro" },
    });
    expect(checkout.statusCode).toBe(503);

    const fake = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { planId: "pro" },
    });
    expect(fake.statusCode).toBe(503);
    await app.close();
  });

  it("rejects empty project names", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "  " },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("lets Arrab Control manage companions and hides drafts from the app", async () => {
    const context = await createApiContext({ ...testEnv, erpToken: "erp-test-token" });
    const app = await buildApp(context);
    const erp = { authorization: "Bearer erp-test-token" };

    const missing = await app.inject({ method: "GET", url: "/erp/not-a-route" });
    expect(missing.statusCode).toBe(404);
    expect(String((missing.json() as { message?: string }).message)).toMatch(/Route .+ not found/);

    const denied = await app.inject({
      method: "POST",
      url: "/erp/companions",
      payload: { name: "Nope" },
    });
    expect(denied.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/erp/companions",
      headers: erp,
      payload: {
        name: "Desk",
        externalId: "erp-desk-1",
        status: "draft",
        systemPrompt: "Help with the desk.",
        temperature: 0.4,
      },
    });
    expect(created.statusCode).toBe(200);
    const draft = created.json() as { id: string; status: string; externalId: string };
    expect(draft.status).toBe("draft");
    expect(draft.externalId).toBe("erp-desk-1");

    const published = await app.inject({
      method: "POST",
      url: "/erp/companions",
      headers: erp,
      payload: { name: "Guide", status: "published", tagline: "Ready" },
    });
    expect(published.statusCode).toBe(200);
    const live = published.json() as { id: string };

    const control = await app.inject({
      method: "GET",
      url: "/erp/companions?limit=500",
      headers: erp,
    });
    expect(control.statusCode).toBe(200);
    expect((control.json() as { items: unknown[] }).items).toHaveLength(2);

    const appView = await app.inject({ method: "GET", url: "/erp/companions?limit=500" });
    expect(appView.statusCode).toBe(200);
    const visible = (appView.json() as { items: Array<{ name: string; status: string }> }).items;
    expect(visible.map((item) => item.name)).toEqual(["Guide"]);
    expect(visible.every((item) => item.status === "published")).toBe(true);

    const patched = await app.inject({
      method: "PATCH",
      url: `/erp/companions/${draft.id}`,
      headers: erp,
      payload: { name: "Desk", externalId: "erp-desk-1", status: "published" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { status: string }).status).toBe("published");

    const removed = await app.inject({
      method: "DELETE",
      url: `/erp/companions/${live.id}`,
      headers: erp,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });

    const notice = await app.inject({
      method: "POST",
      url: "/erp/notifications",
      headers: erp,
      payload: { title: "Desk check", body: "Arrab Control says hello" },
    });
    expect(notice.statusCode).toBe(200);
    const posted = notice.json() as { id: string; title: string };
    expect(posted.title).toBe("Desk check");

    const inbox = await app.inject({ method: "GET", url: "/erp/notifications" });
    expect(inbox.statusCode).toBe(200);
    const items = (inbox.json() as { items: Array<{ id: string }> }).items;
    expect(items.some((item) => item.id === posted.id)).toBe(true);

    const blocked = await app.inject({
      method: "POST",
      url: "/erp/notifications",
      payload: { title: "No token" },
    });
    expect(blocked.statusCode).toBe(401);

    const policy = await app.inject({
      method: "POST",
      url: "/erp/maintenance",
      headers: erp,
      payload: { message: "Maintenance tonight", requireUpdate: true, minVersion: "0.12.1" },
    });
    expect(policy.statusCode).toBe(200);
    expect((policy.json() as { requireUpdate: boolean }).requireUpdate).toBe(true);

    const seen = await app.inject({
      method: "POST",
      url: "/erp/maintenance/clients",
      payload: { deviceId: "dev_desktop01", version: "0.12.0", platform: "mac" },
    });
    expect(seen.statusCode).toBe(200);

    const clients = await app.inject({
      method: "GET",
      url: "/erp/maintenance/clients",
      headers: erp,
    });
    expect(clients.statusCode).toBe(200);
    expect((clients.json() as { items: unknown[] }).items.length).toBe(1);

    await app.close();
  });

  it("delivers Arrab Control notifications to apps and lets AI draft them", async () => {
    const context = await createApiContext({ ...testEnv, erpToken: "erp-test-token" });
    const prompts: string[] = [];
    context.aiGateway.register({
      id: context.primaryProviderId,
      kind: "openai-compatible" as never,
      complete: async (request) => {
        prompts.push(request.messages.map((message) => message.content).join("\n"));
        return {
          id: "cmp_1",
          model: request.model,
          finishReason: "stop",
          usage: null,
          message: {
            role: "assistant",
            content:
              '<think>short and clear</think>```json\n{"title":"Arrab Studio 0.13 is here","body":"Replies now stream as they are written.","titleAr":"وصل Arrab Studio 0.13","bodyAr":"أصبحت الردود تظهر أثناء كتابتها.","kind":"update","href":"https://evil.example/x","native":true,"rationale":"New version, worth an OS notification."}\n```',
          },
        };
      },
    });
    const app = await buildApp(context);
    const erp = { authorization: "Bearer erp-test-token" };
    const sync = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/v1/client/sync", payload });

    const drafted = await app.inject({
      method: "POST",
      url: "/erp/notifications/compose",
      headers: erp,
      payload: { brief: "Tell desktop users 0.13 streams replies live.", version: "0.13.0", platforms: ["macos", "windows"] },
    });
    expect(drafted.statusCode).toBe(200);
    const draftBody = drafted.json() as {
      draft: { title: string; titleAr: string; kind: string; href: string | null; native: boolean };
      notification: null;
    };
    expect(draftBody.draft).toMatchObject({
      title: "Arrab Studio 0.13 is here",
      titleAr: "وصل Arrab Studio 0.13",
      kind: "update",
      href: "arrab://update",
      native: true,
    });
    expect(draftBody.notification).toBeNull();
    expect(prompts[0]).toContain("0.13.0");

    const sent = await app.inject({
      method: "POST",
      url: "/erp/notifications/compose",
      headers: erp,
      payload: { brief: "Tell desktop users 0.13 streams replies live.", platforms: ["macos", "windows"], send: true },
    });
    const notice = (sent.json() as { notification: { id: string; source: string } }).notification;
    expect(notice.source).toBe("ai");

    const general = await app.inject({
      method: "POST",
      url: "/erp/notifications",
      headers: erp,
      payload: { title: "Welcome", titleAr: "أهلاً", kind: "info", native: false, minVersion: "0.12.0" },
    });
    expect(general.statusCode).toBe(200);

    const mac = await sync({ deviceId: "dev_macbook01", platform: "macos", appVersion: "0.12.4" });
    expect(mac.statusCode).toBe(200);
    const macBody = mac.json() as {
      notifications: Array<{ id: string; title: { en: string; ar: string }; kind: string; native: boolean; deepLink: string | null }>;
      commands: unknown[];
    };
    expect(macBody.commands).toEqual([]);
    const update = macBody.notifications.find((item) => item.id === notice.id);
    expect(update).toMatchObject({
      title: { en: "Arrab Studio 0.13 is here", ar: "وصل Arrab Studio 0.13" },
      kind: "update",
      native: true,
      deepLink: "arrab://update",
    });
    expect(macBody.notifications.some((item) => item.title.en === "Welcome")).toBe(true);

    const android = await sync({ deviceId: "dev_android01", platform: "android", appVersion: "0.11.0" });
    const androidIds = (android.json() as { notifications: Array<{ id: string }> }).notifications;
    expect(androidIds).toEqual([]);

    await sync({ deviceId: "dev_macbook01", platform: "macos", appVersion: "0.12.4", ackedNotificationIds: [notice.id] });
    await app.inject({ method: "POST", url: `/v1/client/notifications/${notice.id}/ack`, payload: { action: "opened" } });

    const retracted = await app.inject({ method: "DELETE", url: `/erp/notifications/${notice.id}`, headers: erp });
    expect(retracted.statusCode).toBe(200);
    expect((retracted.json() as { retractedAt: string | null }).retractedAt).toBeTruthy();

    const after = await sync({ deviceId: "dev_macbook01", platform: "macos", appVersion: "0.12.4" });
    expect((after.json() as { notifications: Array<{ id: string }> }).notifications.map((item) => item.id)).not.toContain(
      notice.id,
    );

    const desk = await app.inject({ method: "GET", url: "/erp/notifications", headers: erp });
    const deskBody = desk.json() as { ai: boolean; items: Array<{ id: string; retractedAt: string | null; stats: unknown }> };
    expect(deskBody.ai).toBe(true);
    expect(deskBody.items.find((item) => item.id === notice.id)).toMatchObject({
      stats: { delivered: 1, opened: 1, dismissed: 0 },
    });

    const badLink = await app.inject({
      method: "POST",
      url: "/erp/notifications",
      headers: erp,
      payload: { title: "Bad", href: "arrab://settings/../../etc" },
    });
    expect(badLink.statusCode).toBe(400);

    await app.close();
  });

  it("reports a clear error when the AI cannot draft a notification", async () => {
    const context = await createApiContext({ ...testEnv, erpToken: "erp-test-token" });
    let calls = 0;
    context.aiGateway.register({
      id: context.primaryProviderId,
      kind: "openai-compatible" as never,
      complete: async () => {
        calls += 1;
        throw new Error("provider offline");
      },
    });
    const app = await buildApp(context);
    const res = await app.inject({
      method: "POST",
      url: "/erp/notifications/compose",
      headers: { authorization: "Bearer erp-test-token" },
      payload: { brief: "Hello" },
    });
    expect(res.statusCode).toBe(503);
    expect(String((res.json() as { error?: { message?: string } }).error?.message)).toMatch(/could not draft/);
    expect(calls).toBe(2);
    const badTone = await app.inject({
      method: "POST",
      url: "/erp/notifications/compose",
      headers: { authorization: "Bearer erp-test-token" },
      payload: { brief: "Hello", tone: "angry" },
    });
    expect(badTone.statusCode).toBe(400);
    const noToken = await app.inject({ method: "POST", url: "/erp/notifications/compose", payload: { brief: "x" } });
    expect(noToken.statusCode).toBe(401);
    await app.close();
  });

  it("lets Arrab Control curate the connector catalog", async () => {
    const context = await createApiContext({ ...testEnv, erpToken: "erp-test-token" });
    const app = await buildApp(context);
    const erp = { authorization: "Bearer erp-test-token" };

    const empty = await app.inject({ method: "GET", url: "/erp/connectors" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [] });

    const denied = await app.inject({
      method: "PUT",
      url: "/erp/connectors/slack",
      payload: { status: "hidden" },
    });
    expect(denied.statusCode).toBe(401);

    const featured = await app.inject({
      method: "PUT",
      url: "/erp/connectors/linear",
      headers: erp,
      payload: {
        featured: true,
        order: 1,
        name: "Linear for teams",
        logoUrl: "https://cdn.arrabai.com/logos/linear.png",
      },
    });
    expect(featured.statusCode).toBe(200);
    expect(featured.json()).toMatchObject({
      provider: "linear",
      status: "published",
      featured: true,
      order: 1,
      name: "Linear for teams",
      nameAr: null,
    });

    const hidden = await app.inject({
      method: "PUT",
      url: "/erp/connectors/finnhub",
      headers: erp,
      payload: { status: "hidden" },
    });
    expect(hidden.statusCode).toBe(200);

    const unknown = await app.inject({
      method: "PUT",
      url: "/erp/connectors/myspace",
      headers: erp,
      payload: { status: "published" },
    });
    expect(unknown.statusCode).toBe(400);

    const foreignLogo = await app.inject({
      method: "PUT",
      url: "/erp/connectors/slack",
      headers: erp,
      payload: { logoUrl: "https://evil.example/logo.png" },
    });
    expect(foreignLogo.statusCode).toBe(400);

    const listed = await app.inject({ method: "GET", url: "/erp/connectors" });
    const items = (listed.json() as { items: Array<{ provider: string; status: string }> }).items;
    expect(items.map((item) => [item.provider, item.status]).sort()).toEqual([
      ["finnhub", "hidden"],
      ["linear", "published"],
    ]);

    const reset = await app.inject({ method: "DELETE", url: "/erp/connectors/finnhub", headers: erp });
    expect(reset.json()).toEqual({ provider: "finnhub", removed: true });
    const after = await app.inject({ method: "GET", url: "/erp/connectors" });
    expect((after.json() as { items: unknown[] }).items).toHaveLength(1);

    await app.close();
  });

  it("sends hardening headers and rejects look-alike CORS origins", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-frame-options"]).toBe("DENY");
    expect(health.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(health.headers["cache-control"]).toBe("no-store");

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://tauri.localhost" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://tauri.localhost");
    const spoofed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://tauri.localhost.evil.example" },
    });
    expect(spoofed.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });

  it("escapes the sign-in page state parameter", async () => {
    const context = await createApiContext(testEnv);
    const app = await buildApp(context);
    const page = await app.inject({
      method: "GET",
      url: `/v1/account/auth/web?state=${encodeURIComponent('"><script>alert(1)</script>')}`,
    });
    expect(page.body).not.toContain("<script>alert(1)");
    expect(page.body).toContain("&lt;script&gt;");
    await app.close();
  });
});
