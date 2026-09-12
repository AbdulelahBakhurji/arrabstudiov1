import { describe, expect, it } from "vitest";
import {
  AiGatewayError,
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
        tools: { teamRoster: "- Ada (eng)\n- Lin (design)" },
      },
      gateway,
    );
    expect(sawTools).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.toolsUsed).toContain("list_team");
    expect(result.output).toBe("Team has 2 people");
  });
});
