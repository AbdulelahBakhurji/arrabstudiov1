import type { AiGateway } from "@arrab/ai";
import {
  executeApprovedTool,
  type AgentRunResult,
  type AgentRuntime,
} from "@arrab/agents";
import {
  NotFoundError,
  SessionBudgetExceededError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  brandId,
  type Activity,
  type ActivityId,
  type AgentId,
  type Approval,
  type ApprovalId,
  type CallToolApprovalDetail,
  type Conversation,
  type ConversationId,
  type CreateConversationRequest,
  type Message,
  type MessageId,
  type ProjectId,
  type SendMessageRequest,
  type SendMessageResponse,
  type SessionUsageSnapshot,
  type TeamId,
  type UsageEvent,
  type WorkspaceId,
} from "@arrab/shared";
import {
  ConnectorService,
  fetchGithubRepoContext,
} from "./connector-service.js";
import type { AccountService } from "./account-service.js";
import {
  normalizeSessionBudget,
  normalizeSpendTier,
  resolveSpendProfile,
} from "./token-spend.js";

export class ConversationService {
  constructor(
    private readonly persistence: Persistence,
    private readonly gateway: AiGateway,
    private readonly runtime: AgentRuntime,
    private readonly defaultModel: string,
    private readonly connectors: ConnectorService,
    private readonly accounts: AccountService,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async record(
    verb: Activity["verb"],
    objectType: string,
    objectId: string,
    summary: string,
    actorType: Activity["actorType"] = "system",
    actorId: string | null = null,
  ): Promise<void> {
    await this.persistence.activity.append({
      id: brandId<ActivityId>(this.ids.next("act")),
      workspaceId: this.persistence.workspaceId,
      actorType,
      actorId,
      verb,
      objectType,
      objectId,
      summary,
      createdAt: this.clock.isoNow(),
    });
  }

  private async sessionUsageFor(
    conversation: Conversation,
  ): Promise<SessionUsageSnapshot> {
    const events = await this.persistence.usage.listByConversation(conversation.id);
    const inputTokens = events.reduce((sum, event) => sum + event.inputTokens, 0);
    const outputTokens = events.reduce((sum, event) => sum + event.outputTokens, 0);
    const totalTokens = inputTokens + outputTokens;
    const budget = conversation.sessionTokenBudget;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      budget,
      remaining: budget === null ? null : Math.max(0, budget - totalTokens),
      tier: conversation.spendTier,
    };
  }

  private parseCallToolDetail(detail: string | null): CallToolApprovalDetail | null {
    if (!detail?.trim()) return null;
    try {
      const parsed = JSON.parse(detail) as CallToolApprovalDetail;
      if (!parsed.conversationId || !parsed.toolName) return null;
      return {
        conversationId: parsed.conversationId,
        toolName: parsed.toolName,
        arguments: parsed.arguments ?? {},
      };
    } catch {
      return null;
    }
  }

  async listConversations(): Promise<Conversation[]> {
    return this.persistence.conversations.list();
  }

  async deleteConversation(id: string): Promise<{ ok: true }> {
    const conversation = await this.persistence.conversations.getById(id);
    if (!conversation) {
      throw new NotFoundError("Conversation", id);
    }
    await this.persistence.messages.deleteByConversation(id);
    await this.persistence.conversations.delete(id);
    await this.record("updated", "conversation", id, "Deleted conversation");
    return { ok: true };
  }

  async listByAgent(agentId: string): Promise<Conversation[]> {
    return this.persistence.conversations.listByAgent(agentId);
  }

  async getConversation(
    id: string,
  ): Promise<{ conversation: Conversation; messages: Message[]; sessionUsage: SessionUsageSnapshot }> {
    const conversation = await this.persistence.conversations.getById(id);
    if (!conversation) {
      throw new NotFoundError("Conversation", id);
    }
    const messages = await this.persistence.messages.listByConversation(id);
    const normalized: Conversation = {
      ...conversation,
      spendTier: conversation.spendTier ?? "low",
      sessionTokenBudget:
        conversation.sessionTokenBudget === undefined
          ? null
          : conversation.sessionTokenBudget,
    };
    return {
      conversation: normalized,
      messages,
      sessionUsage: await this.sessionUsageFor(normalized),
    };
  }

  async createConversation(input: CreateConversationRequest): Promise<Conversation> {
    const teamId = input.teamId?.trim() || null;
    let agentId = input.agentId?.trim() || null;
    let agentName = "Team";

    if (teamId) {
      const team = await this.persistence.teams.getById(teamId);
      if (!team) {
        throw new ValidationError(`Unknown team '${teamId}'`);
      }
      const members = await this.persistence.memberships.listByTeam(teamId);
      if (members.length === 0) {
        throw new ValidationError("Add at least one employee to the team before chatting");
      }
      if (!agentId) {
        agentId = members[0]!.agentId;
      }
      const facilitator = await this.persistence.agents.getById(agentId);
      if (!facilitator || facilitator.status === "archived") {
        throw new ValidationError("Team facilitator is missing or archived");
      }
      agentName = `${team.name} (via ${facilitator.name})`;
    } else {
      if (!agentId) {
        throw new ValidationError("agentId or teamId is required");
      }
      const agent = await this.persistence.agents.getById(agentId);
      if (!agent) {
        throw new ValidationError(`Unknown agent '${agentId}'`);
      }
      if (agent.status === "archived") {
        throw new ValidationError("Cannot start a conversation with an archived employee");
      }
      agentName = agent.name;
    }

    const agent = await this.persistence.agents.getById(agentId!);
    if (!agent) {
      throw new ValidationError(`Unknown agent '${agentId}'`);
    }

    const now = this.clock.isoNow();
    const title =
      input.title?.trim() && input.title.trim().length > 0
        ? input.title.trim().slice(0, 120)
        : teamId
          ? `Team chat · ${agentName}`
          : `Chat with ${agent.name}`;

    const spendTier = normalizeSpendTier(input.spend?.tier ?? "low");
    const sessionTokenBudget =
      input.spend && "sessionTokenBudget" in input.spend
        ? normalizeSessionBudget(input.spend.sessionTokenBudget)
        : normalizeSessionBudget(5_000);

    const conversation: Conversation = {
      id: brandId<ConversationId>(this.ids.next("conv")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      projectId: input.projectId
        ? brandId<ProjectId>(input.projectId)
        : agent.projectId,
      agentId: brandId<AgentId>(agent.id),
      teamId: teamId ? brandId<TeamId>(teamId) : null,
      title,
      spendTier,
      sessionTokenBudget,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.conversations.create(conversation);
    await this.record(
      "created",
      "conversation",
      conversation.id,
      teamId
        ? `Started team conversation (${spendTier} spend)`
        : `Started conversation with "${agent.name}" (${spendTier} spend)`,
    );
    return conversation;
  }

  async sendMessage(
    conversationId: string,
    input: SendMessageRequest,
    options?: {
      onToken?: (text: string) => void;
      onTool?: (name: string, result: string) => void;
      onApproval?: (approval: Approval) => void;
    },
  ): Promise<SendMessageResponse> {
    const content = input.content?.trim() ?? "";
    if (content.length === 0) {
      throw new ValidationError("Message content is required");
    }
    if (content.length > 8000) {
      throw new ValidationError("Message must be 8000 characters or fewer");
    }

    await this.accounts.assertWithinQuota();

    let conversation = await this.persistence.conversations.getById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation", conversationId);
    }
    if (!conversation.agentId) {
      throw new ValidationError("Conversation has no assigned employee");
    }
    const agentId = conversation.agentId;

    if (input.spend) {
      conversation = {
        ...conversation,
        spendTier: normalizeSpendTier(input.spend.tier),
        sessionTokenBudget:
          "sessionTokenBudget" in input.spend
            ? normalizeSessionBudget(input.spend.sessionTokenBudget)
            : conversation.sessionTokenBudget,
        updatedAt: this.clock.isoNow(),
      };
      await this.persistence.conversations.update(conversation);
    }

    // Backfill older conversations that predate spend fields.
    if (!conversation.spendTier) {
      conversation = {
        ...conversation,
        spendTier: "low",
        sessionTokenBudget: conversation.sessionTokenBudget ?? 5_000,
      };
    }

    const profile = resolveSpendProfile(conversation.spendTier);
    const priorUsage = await this.sessionUsageFor(conversation);
    if (
      conversation.sessionTokenBudget !== null &&
      priorUsage.totalTokens >= conversation.sessionTokenBudget
    ) {
      throw new SessionBudgetExceededError(
        `Session budget of ${conversation.sessionTokenBudget} tokens is used up. Raise the budget or start a new session.`,
      );
    }

    const agent = await this.persistence.agents.getById(agentId);
    if (!agent) {
      throw new NotFoundError("Agent", agentId);
    }

    const now = this.clock.isoNow();
    const userMessage: Message = {
      id: brandId<MessageId>(this.ids.next("msg")),
      conversationId: conversation.id,
      role: "user",
      content,
      createdAt: now,
    };
    await this.persistence.messages.create(userMessage);

    const history = (await this.persistence.messages.listByConversation(conversationId))
      .filter((message) => message.id !== userMessage.id)
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-profile.historyMessages)
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));

    const providerConfigured = this.gateway.listProviders().length > 0;
    let assistantMessage: Message | null = null;
    let usage: SendMessageResponse["usage"] = null;
    let githubContextAttached = false;
    let toolsUsed: string[] = [];
    let approval: Approval | null = null;

    if (providerConfigured) {
      const projectId = conversation.projectId ?? agent.projectId;
      const contextParts: string[] = [];

      if (profile.conciseReplyHint) {
        contextParts.push(
          "Token-saving mode: keep replies short and concrete. Prefer bullets over long prose. Do not repeat the question.",
        );
      }

      if (profile.includeGithubBinding && projectId) {
        const binding = await this.persistence.bindings.getByProject(projectId);
        if (binding) {
          const secret = await this.connectors.getSecret(binding.connectorId);
          if (secret) {
            const github = await fetchGithubRepoContext(secret, binding.repoFullName);
            if (github) {
              contextParts.push(github.slice(0, Math.max(profile.githubReadmeChars, 800)));
              githubContextAttached = true;
            }
          }
        }
      }

      const docs = await this.persistence.knowledge.listByProject(projectId ?? null);
      if (docs.length > 0 && profile.knowledgeDocs > 0) {
        contextParts.push(
          [
            "Project knowledge base:",
            ...docs.slice(0, profile.knowledgeDocs).map(
              (doc) => `- ${doc.title}: ${doc.content.slice(0, profile.knowledgeChars)}`,
            ),
          ].join("\n"),
        );
      }

      const memberships = await this.persistence.memberships.list();
      const teamIds = memberships
        .filter((membership) => membership.agentId === agent.id)
        .map((membership) => membership.teamId);
      if (teamIds.length > 0) {
        const teams = await this.persistence.teams.list();
        const purposes = teams
          .filter((team) => teamIds.includes(team.id) && team.purpose)
          .map((team) => `- ${team.name}: ${team.purpose}`);
        if (purposes.length > 0) {
          contextParts.push(["Your team mission:", ...purposes].join("\n"));
        }
      }

      const memories = await this.persistence.memories.listByAgent(agent.id);
      if (memories.length > 0 && profile.memories > 0) {
        contextParts.push(
          [
            "Your recent memory notes (treat as facts the operator told you):",
            ...memories
              .slice(0, profile.memories)
              .map((memory) => `- ${memory.content.slice(0, profile.memoryChars)}`),
          ].join("\n"),
        );
      }

      const skills = await this.persistence.skills.listByAgent(agent.id);
      if (skills.length > 0 && profile.skills > 0) {
        contextParts.push(
          [
            "Skills you have been taught:",
            ...skills.slice(0, profile.skills).map(
              (skill) =>
                `- ${skill.title}: ${skill.instructions.slice(0, profile.skillChars)}`,
            ),
          ].join("\n"),
        );
      }

      const hint = input.workspaceHint;
      let persistedGoal =
        input.usePersistedGoal === false
          ? null
          : (await this.persistence.goals.listActiveByAgent(agent.id))[0] ?? null;
      const activeGoalText =
        hint?.activeGoal?.trim() ||
        (persistedGoal
          ? `${persistedGoal.title}${persistedGoal.detail ? ` — ${persistedGoal.detail}` : ""}`
          : null);

      if (!hint?.activeGoal && activeGoalText) {
        contextParts.push(
          [
            "ACTIVE GOAL (primary objective — keep working until fully achieved):",
            activeGoalText.slice(0, profile.hintNotesChars),
            "Treat this goal as your north star for every reply. Make concrete progress,",
            "report what you did and what remains, and do not stop at a vague plan.",
            "Only treat the goal as done when the operator marks it complete.",
          ].join("\n"),
        );
      }

      let teamRoster: string | null = null;
      if (conversation.teamId) {
        const members = await this.persistence.memberships.listByTeam(conversation.teamId);
        const agents = await this.persistence.agents.list();
        const team = await this.persistence.teams.getById(conversation.teamId);
        const roster = members
          .map((membership) => agents.find((item) => item.id === membership.agentId))
          .filter(Boolean)
          .map((member) => `- ${member!.name} (${member!.role})`)
          .join("\n");
        teamRoster = roster;
        contextParts.push(
          [
            `You are facilitating a TEAM conversation${team ? ` for "${team.name}"` : ""}.`,
            team?.purpose ? `Team purpose: ${team.purpose}` : null,
            "Team roster:",
            roster || "- (empty)",
            "Speak as the facilitator, but represent the team's shared mission. Invite other roles' perspectives when useful.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      if (hint) {
        const lines = [
          "Active agent workspace:",
          `- Mode: ${hint.kind}`,
          hint.folderPath ? `- Local folder: ${hint.folderPath}` : null,
          hint.repoFullName ? `- GitHub repo: ${hint.repoFullName}` : null,
          hint.branch ? `- Branch: ${hint.branch}` : null,
          hint.gitStatus
            ? `\nGit status:\n${hint.gitStatus.slice(0, profile.hintGitChars)}`
            : null,
          hint.treeSummary
            ? `\nRepo tree (sample):\n${hint.treeSummary.slice(0, profile.hintGitChars)}`
            : null,
          hint.openFilePath
            ? [
                `\nOpen file on desk: ${hint.openFilePath}`,
                hint.openFileContent
                  ? `Contents (truncated):\n${hint.openFileContent.slice(0, Math.min(8000, profile.hintNotesChars * 4))}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n")
            : null,
          hint.recentTerminal
            ? `\nRecent laptop terminal:\n${hint.recentTerminal.slice(0, Math.min(2500, profile.hintNotesChars * 2))}`
            : null,
          hint.activeGoal
            ? [
                "\nACTIVE GOAL (primary objective — keep working until fully achieved):",
                hint.activeGoal.slice(0, profile.hintNotesChars),
                "Treat this goal as your north star for every reply. Make concrete progress,",
                "report what you did and what remains, and do not stop at a vague plan.",
                "Only treat the goal as done when the operator marks it complete.",
              ].join("\n")
            : null,
          hint.sessionNotes
            ? `\nOperator desk notes for you:\n${hint.sessionNotes.slice(0, profile.hintNotesChars)}`
            : null,
          hint.operatorDirectives
            ? `\nHQ operator directives (obey):\n${hint.operatorDirectives.slice(0, profile.hintNotesChars)}`
            : null,
          hint.workspaceRules
            ? `\nWORKSPACE RULES (always follow — like Cursor rules / AGENTS.md):\n${hint.workspaceRules.slice(0, Math.min(6000, profile.hintNotesChars * 4))}`
            : null,
          hint.mentions && hint.mentions.length > 0
            ? [
                "\nOPERATOR @MENTIONS for this turn:",
                ...hint.mentions.slice(0, 12).map((mention) => {
                  if (mention.kind === "file") {
                    return [
                      `- @file ${mention.path || mention.label}`,
                      mention.content
                        ? `  Contents (truncated):\n${mention.content.slice(0, 4000)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("\n");
                  }
                  if (mention.kind === "folder") {
                    return `- @folder ${mention.path || mention.label}`;
                  }
                  if (mention.kind === "agent") {
                    return `- @agent ${mention.label}${mention.agentId ? ` (${mention.agentId})` : ""}`;
                  }
                  return `- @${mention.kind} ${mention.label}`;
                }),
              ].join("\n")
            : null,
          hint.kind === "folder" || hint.kind === "github"
            ? [
                "You can propose concrete file edits, commits, and PRs.",
                hint.kind === "folder"
                  ? "A local folder is attached — use search_code/list_files/read_file/apply_patch/write_file/run_terminal/web_search. Workflow: search → read → edit → verify. Prefer apply_patch for surgical edits."
                  : "The operator runs Commit / Push / Open PR from the workspace panel.",
                hint.kind === "folder"
                  ? "Do not claim you lack shell or file access when a folder is open. Be precise and reproducible; skip fluff."
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : null,
        ].filter(Boolean);
        contextParts.push(lines.join("\n"));
      }

      const systemExtra = contextParts.length > 0 ? contextParts.join("\n\n") : null;

      const workspaceSummary = hint
        ? [
            `mode=${hint.kind}`,
            hint.folderPath,
            hint.repoFullName,
            hint.branch,
            hint.gitStatus?.slice(0, 1200),
            hint.treeSummary?.slice(0, 1200),
            hint.openFilePath ? `openFile=${hint.openFilePath}` : null,
            hint.recentTerminal?.slice(0, 800),
          ]
            .filter(Boolean)
            .join("\n")
        : null;

      const codingFolder = hint?.kind === "folder";
      // Keep desk work capable without blowing the eco budget (old floor was 900).
      const codingFloor =
        profile.tier === "high" ? 900 : profile.tier === "medium" ? 520 : 360;
      const runRequest = {
        agent,
        conversationId: conversation.id,
        input: content,
        history,
        model: this.defaultModel,
        systemExtra,
        maxOutputTokens: codingFolder
          ? Math.max(profile.maxOutputTokens, codingFloor)
          : profile.maxOutputTokens,
        temperature: codingFolder ? 0.2 : undefined,
        tools: {
          workspaceSummary,
          activeGoal: activeGoalText,
          teamRoster,
        },
      };

      let result: AgentRunResult;
      if (options?.onToken && this.runtime.runStream) {
        result = {
          status: "completed",
          output: "",
          error: null,
          usage: null,
          providerId: null,
          model: null,
          toolsUsed: [],
        };
        for await (const event of this.runtime.runStream(runRequest, this.gateway)) {
          if (event.type === "token") {
            options.onToken(event.text);
            result.output = (result.output ?? "") + event.text;
          } else if (event.type === "tool") {
            options.onTool?.(event.name, event.result);
            toolsUsed.push(event.name);
          } else if (event.type === "done") {
            result = event.result;
            toolsUsed = event.result.toolsUsed ?? toolsUsed;
          }
        }
      } else {
        result = await this.runtime.run(runRequest, this.gateway);
        toolsUsed = result.toolsUsed ?? [];
      }

      if (result.status === "needs_approval" && result.pendingTool) {
        const toolDetail: CallToolApprovalDetail = {
          conversationId: conversation.id,
          toolName: result.pendingTool.name,
          arguments: result.pendingTool.arguments,
        };
        approval = {
          id: brandId<ApprovalId>(this.ids.next("apr")),
          workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
          kind: "call_tool",
          status: "pending",
          title: result.pendingTool.arguments.title || `Tool: ${result.pendingTool.name}`,
          detail: JSON.stringify(toolDetail),
          agentId: brandId<AgentId>(agent.id),
          taskId: null,
          createdAt: this.clock.isoNow(),
          resolvedAt: null,
        };
        await this.persistence.approvals.create(approval);
        await this.record(
          "created",
          "approval",
          approval.id,
          `Tool approval requested: ${approval.title}`,
          "agent",
          agent.id,
        );
        options?.onApproval?.(approval);

        assistantMessage = {
          id: brandId<MessageId>(this.ids.next("msg")),
          conversationId: conversation.id,
          role: "assistant",
          content:
            result.output?.trim() ||
            `Proposed action awaiting your approval: ${approval.title}`,
          createdAt: this.clock.isoNow(),
        };
        await this.persistence.messages.create(assistantMessage);
      } else if (result.status !== "completed" || !result.output) {
        throw new ValidationError(result.error ?? "Employee did not return a reply");
      } else {
        assistantMessage = {
          id: brandId<MessageId>(this.ids.next("msg")),
          conversationId: conversation.id,
          role: "assistant",
          content: result.output,
          createdAt: this.clock.isoNow(),
        };
        await this.persistence.messages.create(assistantMessage);
        await this.record(
          "ran",
          "conversation",
          conversation.id,
          `${agent.name} replied in conversation`,
          "agent",
          agent.id,
        );
      }

      if (result.usage && result.providerId && result.model) {
        usage = result.usage;
        const event: UsageEvent = {
          id: this.ids.next("use"),
          workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
          conversationId: conversation.id,
          agentId: brandId<AgentId>(agent.id),
          providerId: result.providerId,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          createdAt: this.clock.isoNow(),
        };
        await this.persistence.usage.append(event);
      }
    }

    await this.persistence.conversations.update({
      ...conversation,
      updatedAt: this.clock.isoNow(),
    });

    const sessionUsage = await this.sessionUsageFor(conversation);

    return {
      userMessage,
      assistantMessage,
      providerConfigured,
      usage,
      githubContextAttached,
      sessionUsage,
      toolsUsed,
      approval,
    };
  }

  async resumeAfterToolApproval(
    approval: Approval,
    options?: { toolResult?: string | null },
  ): Promise<SendMessageResponse> {
    if (approval.kind !== "call_tool") {
      throw new ValidationError("Approval is not a tool call");
    }
    const detail = this.parseCallToolDetail(approval.detail);
    if (!detail) {
      throw new ValidationError("Invalid call_tool approval detail");
    }

    const conversation = await this.persistence.conversations.getById(detail.conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation", detail.conversationId);
    }
    if (!conversation.agentId) {
      throw new ValidationError("Conversation has no assigned employee");
    }

    const agent = await this.persistence.agents.getById(conversation.agentId);
    if (!agent) {
      throw new NotFoundError("Agent", conversation.agentId);
    }

    await this.accounts.assertWithinQuota();

    if (
      [
        "run_terminal",
        "list_files",
        "search_code",
        "read_file",
        "write_file",
        "apply_patch",
      ].includes(detail.toolName) &&
      !options?.toolResult?.trim()
    ) {
      throw new ValidationError(
        `${detail.toolName} requires toolResult from the desktop after local execution`,
      );
    }

    const toolResult = executeApprovedTool(
      detail.toolName,
      detail.arguments,
      null,
      options?.toolResult,
    );
    const profile = resolveSpendProfile(conversation.spendTier ?? "low");
    const historyMessages = (
      await this.persistence.messages.listByConversation(conversation.id)
    )
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-profile.historyMessages);

    const history = historyMessages.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

    const localTools = [
      "run_terminal",
      "list_files",
      "search_code",
      "read_file",
      "write_file",
      "apply_patch",
    ];
    const isLocal = localTools.includes(detail.toolName);
    const resumeInput = [
      `TOOL_RESULT ${detail.toolName}:`,
      toolResult,
      "",
      isLocal
        ? [
            "Local desk tool finished.",
            "Continue the coding loop: if you edited files, verify with run_terminal (typecheck/test).",
            "If this failed, fix from the error output. State clearly what changed or what failed.",
            "Call another tool when needed — do not claim done without verification when edits were made.",
          ].join(" ")
        : "The operator approved this action. Continue helping — summarize what you will do next and make concrete progress.",
    ].join("\n");

    const providerConfigured = this.gateway.listProviders().length > 0;
    if (!providerConfigured) {
      throw new ValidationError("No model provider is configured");
    }

    const localFloor =
      profile.tier === "high" ? 900 : profile.tier === "medium" ? 520 : 360;
    const result = await this.runtime.run(
      {
        agent,
        conversationId: conversation.id,
        input: resumeInput,
        history,
        model: this.defaultModel,
        maxOutputTokens: Math.max(
          profile.maxOutputTokens,
          isLocal ? localFloor : profile.maxOutputTokens,
        ),
        temperature: isLocal ? 0.2 : undefined,
        systemExtra: isLocal
          ? "TOOL_RESULT received. Continue with local tools if needed. Be brief and precise."
          : "You just received an approved tool result. Do not call propose_action again for the same action.",
        tools: null,
      },
      this.gateway,
    );

    if (result.status !== "completed" || !result.output) {
      throw new ValidationError(result.error ?? "Employee did not continue after approval");
    }

    const assistantMessage: Message = {
      id: brandId<MessageId>(this.ids.next("msg")),
      conversationId: conversation.id,
      role: "assistant",
      content: result.output,
      createdAt: this.clock.isoNow(),
    };
    await this.persistence.messages.create(assistantMessage);
    await this.record(
      "ran",
      "conversation",
      conversation.id,
      `${agent.name} continued after tool approval`,
      "agent",
      agent.id,
    );

    let usage: SendMessageResponse["usage"] = null;
    if (result.usage && result.providerId && result.model) {
      usage = result.usage;
      await this.persistence.usage.append({
        id: this.ids.next("use"),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        conversationId: conversation.id,
        agentId: brandId<AgentId>(agent.id),
        providerId: result.providerId,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        createdAt: this.clock.isoNow(),
      });
    }

    await this.persistence.conversations.update({
      ...conversation,
      updatedAt: this.clock.isoNow(),
    });

    const lastUser =
      historyMessages.filter((message) => message.role === "user").at(-1) ??
      ({
        id: brandId<MessageId>(this.ids.next("msg")),
        conversationId: conversation.id,
        role: "user" as const,
        content: "[approved tool]",
        createdAt: this.clock.isoNow(),
      });

    return {
      userMessage: lastUser,
      assistantMessage,
      providerConfigured: true,
      usage,
      githubContextAttached: false,
      sessionUsage: await this.sessionUsageFor(conversation),
      toolsUsed: [detail.toolName, ...(result.toolsUsed ?? [])],
      approval: null,
    };
  }
}
