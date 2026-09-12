import { describe, expect, it } from "vitest";
import { buildApp, createApiContext } from "./app.js";
import type { ApiEnv } from "./config/env.js";

const testEnv: ApiEnv = {
  host: "127.0.0.1",
  port: 8787,
  logLevel: "error",
  corsOrigins: ["http://localhost:1420"],
  databaseUrl: undefined,
  openaiApiKey: undefined,
  openaiBaseUrl: "https://api.openai.com/v1",
  explabsApiKey: undefined,
  explabsBaseUrl: "https://api.experientiallabs.ai/v1",
  defaultModel: "gpt-4o-mini",
  anthropicApiKey: undefined,
  googleApiKey: undefined,
  xaiApiKey: undefined,
  publicBaseUrl: "http://127.0.0.1:8787",
  authWebUrl: undefined,
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

  it("creates a conversation and stores a user message without a provider", async () => {
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
      assistantMessage: null;
      providerConfigured: boolean;
    };
    expect(messageBody.providerConfigured).toBe(false);
    expect(messageBody.assistantMessage).toBeNull();
    expect(messageBody.userMessage.content).toBe("Summarize our roadmap.");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conversationBody.id}`,
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { messages: Array<{ role: string }> };
    expect(detailBody.messages).toHaveLength(1);

    await app.close();
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
    expect((meta.json() as { version: string }).version).toBe("0.12.0");

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

  it("stores knowledge and runs a task without a provider", async () => {
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
    expect(runBody.providerConfigured).toBe(false);
    expect(runBody.run.status).toBe("needs_provider");
    expect(runBody.task.status).toBe("in_progress");

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
    expect((meta.json() as { version: string }).version).toBe("0.12.0");

    await app.close();
  });

  it("teaches skills and gates high-risk runs behind approvals", async () => {
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
      "needs_provider",
    );

    const report = await app.inject({ method: "GET", url: "/v1/reports/summary" });
    const reportBody = report.json() as { skillCount: number };
    expect(reportBody.skillCount).toBe(1);

    await app.close();
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
    expect((meta.json() as { version: string }).version).toBe("0.12.0");

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
    expect(beforeBody.entitlements.tokenLimit).toBe(25_000);

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

    const upgraded = await app.inject({
      method: "POST",
      url: "/v1/account/subscribe",
      payload: { code: "PRO-ARRAB" },
    });
    expect(upgraded.statusCode).toBe(200);
    const upgradedBody = upgraded.json() as {
      account: { planId: string };
      entitlements: { tokenLimit: number | null; planName: string };
    };
    expect(upgradedBody.account.planId).toBe("pro");
    expect(upgradedBody.entitlements.tokenLimit).toBe(2_000_000);

    const usage = await app.inject({ method: "GET", url: "/v1/usage" });
    expect(
      (usage.json() as { entitlements: { planId: string } }).entitlements.planId,
    ).toBe("pro");

    const meta = await app.inject({ method: "GET", url: "/v1/meta" });
    expect((meta.json() as { account: { connected: boolean; planId: string } }).account.connected).toBe(
      true,
    );

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
      authorizationUrl: string;
      pollIntervalMs: number;
    };
    expect(startBody.state.length).toBeGreaterThan(10);
    expect(startBody.authorizationUrl).toContain(startBody.state);

    const pending = await app.inject({
      method: "GET",
      url: `/v1/account/auth/web/poll?state=${encodeURIComponent(startBody.state)}`,
    });
    expect(pending.statusCode).toBe(200);
    expect((pending.json() as { status: string }).status).toBe("pending");

    const completed = await app.inject({
      method: "POST",
      url: "/v1/account/auth/web/complete",
      payload: {
        state: startBody.state,
        email: "web@arrab.studio",
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
      url: `/v1/account/auth/web/poll?state=${encodeURIComponent(startBody.state)}`,
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

    const status = await app.inject({ method: "GET", url: "/v1/account" });
    expect((status.json() as { connected: boolean }).connected).toBe(true);

    const logout = await app.inject({ method: "POST", url: "/v1/account/logout" });
    expect(logout.statusCode).toBe(200);
    expect((logout.json() as { connected: boolean }).connected).toBe(false);

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
});
