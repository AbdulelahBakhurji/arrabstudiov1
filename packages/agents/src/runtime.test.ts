import { describe, expect, it } from "vitest";
import {
  RegistryAiGateway,
  type AiCompletion,
  type AiCompletionRequest,
  type ModelProviderAdapter,
} from "@arrab/ai";
import { brandId, type Agent, type AgentId, type WorkspaceId } from "@arrab/shared";
import { AgentRuntimeError, GatewayChatRuntime, UnconfiguredAgentRuntime } from "./runtime.js";

const agent: Agent = {
  id: brandId<AgentId>("agt_1"),
  workspaceId: brandId<WorkspaceId>("ws_1"),
  projectId: null,
  name: "Researcher",
  role: "research",
  specialty: "market research",
  bio: "Former analyst who digs for primary sources.",
  instructions: "Always cite assumptions and prefer concise bullet answers.",
  status: "active",
  modelProviderId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("UnconfiguredAgentRuntime", () => {
  it("does not invent agent output", async () => {
    await expect(
      new UnconfiguredAgentRuntime().run(
        { agent, conversationId: null, input: "summarize" },
        new RegistryAiGateway(),
      ),
    ).rejects.toBeInstanceOf(AgentRuntimeError);
  });
});

describe("GatewayChatRuntime", () => {
  it("fails closed when no provider is registered", async () => {
    await expect(
      new GatewayChatRuntime().run(
        { agent, conversationId: null, input: "hello" },
        new RegistryAiGateway(),
      ),
    ).rejects.toMatchObject({ code: "NO_PROVIDER" });
  });

  it("returns gateway completion text", async () => {
    const gateway = new RegistryAiGateway();
    let capturedSystem = "";
    const adapter: ModelProviderAdapter = {
      id: "openai",
      kind: "openai_compatible",
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        capturedSystem = request.messages.find((message) => message.role === "system")?.content ?? "";
        return {
          id: "cmpl_test",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Done" },
          finishReason: "stop",
          usage: null,
        };
      },
    };
    gateway.register(adapter);
    const result = await new GatewayChatRuntime().run(
      { agent, conversationId: null, input: "hello", model: "gpt-4o-mini" },
      gateway,
    );
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Done");
    expect(capturedSystem).toContain("Standing instructions");
    expect(capturedSystem).toContain("cite assumptions");
    expect(capturedSystem).toContain("market research");
    expect(capturedSystem).not.toContain("CALL_TOOL");
  });

  it("keeps CALL_TOOL hints when a desk folder is attached", async () => {
    const gateway = new RegistryAiGateway();
    let capturedSystem = "";
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: false,
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        capturedSystem = request.messages.find((message) => message.role === "system")?.content ?? "";
        return {
          id: "cmpl_desk",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "hello",
        tools: { workspaceSummary: "mode=folder\nLocal folder: /tmp/app" },
      },
      gateway,
    );
    expect(capturedSystem).toContain("CALL_TOOL");
  });
  it("runs safe CALL_TOOL loop and returns final answer", async () => {
    const gateway = new RegistryAiGateway();
    let round = 0;
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: false,
      async complete(): Promise<AiCompletion> {
        round += 1;
        if (round === 1) {
          return {
            id: "cmpl_1",
            model: { providerId: "openai", model: "gpt-4o-mini" },
            message: { role: "assistant", content: "CALL_TOOL recall_goal" },
            finishReason: "stop",
            usage: null,
          };
        }
        return {
          id: "cmpl_2",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Goal is ship Sprint A" },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const result = await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "what is the goal?",
        tools: { activeGoal: "ship Sprint A" },
      },
      gateway,
    );
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Goal is ship Sprint A");
    expect(result.toolsUsed).toContain("recall_goal");
  });

  it("pauses for propose_action approval", async () => {
    const gateway = new RegistryAiGateway();
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: false,
      async complete(): Promise<AiCompletion> {
        return {
          id: "cmpl_1",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: {
            role: "assistant",
            content: 'CALL_TOOL propose_action {"title":"Push branch","detail":"git push origin main"}',
          },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const result = await new GatewayChatRuntime().run(
      { agent, conversationId: null, input: "push it" },
      gateway,
    );
    expect(result.status).toBe("needs_approval");
    expect(result.pendingTool?.name).toBe("propose_action");
    expect(result.pendingTool?.arguments.title).toBe("Push branch");
  });

  it("uses native tool calls when provider supports tools", async () => {
    const gateway = new RegistryAiGateway();
    let round = 0;
    let sawTools = false;
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: true,
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        if (request.tools?.length) sawTools = true;
        round += 1;
        if (round === 1) {
          return {
            id: "cmpl_1",
            model: { providerId: "openai", model: "gpt-4o-mini" },
            message: {
              role: "assistant",
              content: "",
              toolCalls: [
                { id: "call_1", name: "list_team", arguments: "{}" },
              ],
            },
            finishReason: "tool_calls",
            usage: null,
            toolCalls: [{ id: "call_1", name: "list_team", arguments: "{}" }],
          };
        }
        return {
          id: "cmpl_2",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Team has 2 people" },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const result = await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "who is on the team?",
        tools: { teamRoster: "- Ada (eng)\n- Lin (design)", workspaceSummary: "mode=folder" },
      },
      gateway,
    );
    expect(sawTools).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.toolsUsed).toContain("list_team");
    expect(result.output).toBe("Team has 2 people");
  });

  it("keeps native tools when workspaceSummary marks a local desk resume", async () => {
    const gateway = new RegistryAiGateway();
    let sawTools = false;
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: true,
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        if (request.tools?.length) sawTools = true;
        return {
          id: "cmpl_desk",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Continuing on the desk" },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const result = await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "TOOL_RESULT read_file:\nhello",
        tools: {
          workspaceSummary: "mode=folder\ndesk=local\nLocal folder: attached",
        },
      },
      gateway,
    );
    expect(sawTools).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Continuing on the desk");
  });

  it("offers and runs Gmail arrange_email without a desk folder", async () => {
    const gateway = new RegistryAiGateway();
    let toolNames: string[] = [];
    let round = 0;
    const arranged: Array<Record<string, string>> = [];
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: true,
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        toolNames = (request.tools ?? []).map((tool) => tool.name);
        round += 1;
        if (round === 1) {
          return {
            id: "cmpl_mail_1",
            model: { providerId: "openai", model: "gpt-4o-mini" },
            message: { role: "assistant", content: "" },
            finishReason: "tool_calls",
            usage: null,
            toolCalls: [
              {
                id: "call_arrange",
                name: "arrange_email",
                arguments: JSON.stringify({
                  action: "archive",
                  message_ids: "msg_a,msg_b",
                }),
              },
            ],
          };
        }
        return {
          id: "cmpl_mail_2",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Archived 2 messages." },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const result = await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "Archive those two emails",
        tools: {
          emailAccountLabel: "ops@arrabai.com",
          email: {
            listMessages: async () => "[]",
            readMessage: async () => "{}",
            sendMessage: async () => "{}",
            arrangeMessages: async (args) => {
              arranged.push(args);
              return JSON.stringify({ ok: true, modified: 2 });
            },
          },
        },
      },
      gateway,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining(["list_email", "read_email", "send_email", "arrange_email"]),
    );
    expect(toolNames.some((name) => name.startsWith("list_files") || name === "run_terminal")).toBe(
      false,
    );
    expect(arranged).toEqual([{ action: "archive", message_ids: "msg_a,msg_b" }]);
    expect(result.toolsUsed).toContain("arrange_email");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Archived 2 messages.");
  });

  it("lists skills and loads one on demand via use_skill", async () => {
    const gateway = new RegistryAiGateway();
    let toolNames: string[] = [];
    let system = "";
    let lastToolResult = "";
    let round = 0;
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      supportsTools: true,
      async complete(request: AiCompletionRequest): Promise<AiCompletion> {
        toolNames = (request.tools ?? []).map((tool) => tool.name);
        system = request.messages.find((message) => message.role === "system")?.content ?? "";
        lastToolResult = request.messages.filter((message) => message.role === "tool").at(-1)?.content ?? "";
        round += 1;
        if (round === 1) {
          return {
            id: "cmpl_skill_1",
            model: { providerId: "openai", model: "gpt-4o-mini" },
            message: { role: "assistant", content: "" },
            finishReason: "tool_calls",
            usage: null,
            toolCalls: [{ id: "call_skill", name: "use_skill", arguments: JSON.stringify({ name: "pdf" }) }],
          };
        }
        return {
          id: "cmpl_skill_2",
          model: { providerId: "openai", model: "gpt-4o-mini" },
          message: { role: "assistant", content: "Merged." },
          finishReason: "stop",
          usage: null,
        };
      },
    });
    const loaded: string[] = [];
    const result = await new GatewayChatRuntime().run(
      {
        agent,
        conversationId: null,
        input: "Merge these PDFs",
        tools: {
          skills: {
            catalog: [{ slug: "pdf", name: "PDF", description: "Work with PDF files" }],
            useSkill: (args) => {
              loaded.push(args.name ?? "");
              return "PDF skill instructions";
            },
            readSkillFile: () => "",
          },
        },
      },
      gateway,
    );
    expect(toolNames).toEqual(expect.arrayContaining(["use_skill", "read_skill_file"]));
    expect(system).toContain("Work with PDF files");
    expect(loaded).toEqual(["pdf"]);
    expect(lastToolResult).toContain("PDF skill instructions");
    expect(result.toolsUsed).toContain("use_skill");
    expect(result.output).toBe("Merged.");
  });

  it("streams tokens live from streamComplete", async () => {
    const gateway = new RegistryAiGateway();
    gateway.register({
      id: "openai",
      kind: "openai_compatible",
      async complete(): Promise<AiCompletion> {
        throw new Error("complete() should not be used while streaming");
      },
      async *streamComplete() {
        yield { type: "token" as const, text: "Hel" };
        yield { type: "token" as const, text: "lo" };
        yield {
          type: "done" as const,
          completion: {
            id: "cmpl_stream",
            model: { providerId: "openai", model: "gpt-4o-mini" },
            message: { role: "assistant" as const, content: "Hello" },
            finishReason: "stop" as const,
            usage: null,
          },
        };
      },
    });
    const tokens: string[] = [];
    let final = "";
    for await (const event of new GatewayChatRuntime().runStream!(
      { agent, conversationId: null, input: "hi", model: "gpt-4o-mini" },
      gateway,
    )) {
      if (event.type === "token") tokens.push(event.text);
      if (event.type === "done") final = event.result.output ?? "";
    }
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(final).toBe("Hello");
  });
});
