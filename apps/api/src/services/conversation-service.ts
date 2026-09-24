import type { AiGateway } from "@arrab/ai";
import {
  executeApprovedTool,
  isClientExecTool,
  type AgentRunResult,
  type AgentSkillTools,
  type AgentRuntime,
} from "@arrab/agents";
import {
  ForbiddenError,
  NotFoundError,
  SessionBudgetExceededError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Persistence } from "@arrab/database";
import {
  brandId,
  guardianHardHit,
  toolResultAttestationPayload,
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
  type SkillLibraryEntry,
  type IngestConversationMessagesRequest,
  type IngestConversationMessagesResponse,
  type SendMessageResponse,
  type SessionUsageSnapshot,
  type TeamId,
  type UsageEvent,
  type WorkspaceHint,
  type WorkspaceId,
} from "@arrab/shared";
import { decryptField, encryptField } from "../lib/field-crypto.js";
import {
  type ConnectorService,
  fetchGithubRepoContext,
} from "./connector-service.js";
import type { AccountService } from "./account-service.js";
import type { FamilyHouseholdService } from "./family-household-service.js";
import {
  normalizeSessionBudget,
  normalizeSpendTier,
  resolveSpendProfile,
} from "./token-spend.js";

/**
 * Desktop clients also mirror skills into workspace rules so older API builds
 * still apply them. When the dedicated `skills` field is present, drop that
 * copy (and the synthetic "none" hint it created) to avoid double injection.
 */
function stripSkillsFallback(
  hint: WorkspaceHint | null | undefined,
  hasSkills: boolean,
): WorkspaceHint | null {
  if (!hint) return null;
  if (!hasSkills || !hint.workspaceRules?.includes("<<arrab-skills>>")) return hint;
  const rules = hint.workspaceRules
    .replace(/\n*<<arrab-skills>>[\s\S]*?<<\/arrab-skills>>\n*/g, "\n")
    .trim();
  const next: WorkspaceHint = { ...hint, workspaceRules: rules || null };
  const hasContent = Object.entries(next).some(
    ([key, value]) =>
      key !== "kind" && value != null && !(Array.isArray(value) && value.length === 0) && value !== "",
  );
  return next.kind === "none" && !hasContent ? null : next;
}

const SKILL_LIBRARY_LIMITS = {
  skills: 40,
  instructions: 40_000,
  files: 40,
  fileChars: 120_000,
  totalChars: 700_000,
  readChars: 40_000,
} as const;

/** Server-side use_skill / read_skill_file backed by the library the desktop sent. */
function buildSkillTools(library: SendMessageRequest["skillLibrary"]): AgentSkillTools | null {
  if (!Array.isArray(library) || library.length === 0) return null;
  let total = 0;
  const skills = library
    .filter(
      (entry): entry is SkillLibraryEntry =>
        Boolean(entry) &&
        typeof entry.slug === "string" &&
        typeof entry.instructions === "string" &&
        entry.instructions.trim().length > 0,
    )
    .slice(0, SKILL_LIBRARY_LIMITS.skills)
    .map((entry) => {
      const instructions = entry.instructions.slice(0, SKILL_LIBRARY_LIMITS.instructions);
      total += instructions.length;
      const files = (Array.isArray(entry.files) ? entry.files : [])
        .filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
        .slice(0, SKILL_LIBRARY_LIMITS.files)
        .flatMap((file) => {
          const room = SKILL_LIBRARY_LIMITS.totalChars - total;
          if (room <= 0) return [];
          const content = file.content.slice(0, Math.min(SKILL_LIBRARY_LIMITS.fileChars, room));
          total += content.length;
          return [{ path: file.path.replace(/^\.?\/+/, ""), content }];
        });
      return {
        slug: entry.slug.trim().toLowerCase(),
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.slug,
        description: typeof entry.description === "string" ? entry.description.trim() : "",
        instructions,
        active: entry.active === true,
        files,
        installedPath:
          typeof entry.installedPath === "string" && entry.installedPath.trim()
            ? entry.installedPath.trim()
            : null,
      };
    });
  if (skills.length === 0) return null;

  const find = (raw: string | undefined) => {
    const key = (raw ?? "").trim().replace(/^\//, "").toLowerCase();
    if (!key) return null;
    return (
      skills.find((skill) => skill.slug === key) ??
      skills.find((skill) => skill.name.toLowerCase() === key) ??
      skills.find((skill) => skill.slug.includes(key) || key.includes(skill.slug)) ??
      null
    );
  };
  const available = () => skills.map((skill) => skill.slug).join(", ");

  return {
    catalog: skills.map(({ slug, name, description, active }) => ({ slug, name, description, active })),
    useSkill: (args) => {
      const skill = find(args.name || args.skill || args.slug);
      if (!skill) return `Unknown skill '${args.name ?? ""}'. Installed skills: ${available()}.`;
      return [
        `# Skill: ${skill.name} (${skill.slug})`,
        skill.instructions,
        skill.files.length
          ? `\nFiles bundled with this skill (open with read_skill_file):\n${skill.files.map((file) => `- ${file.path}`).join("\n")}`
          : null,
        skill.installedPath
          ? [
              `\nInstalled on the operator's computer at: ${skill.installedPath}`,
              "When run_terminal is available, run bundled scripts from there, e.g.",
              `python3 "${skill.installedPath}/scripts/<script>.py" <args>`,
            ].join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    },
    readSkillFile: (args) => {
      const skill = find(args.name || args.skill || args.slug);
      if (!skill) return `Unknown skill '${args.name ?? ""}'. Installed skills: ${available()}.`;
      const wanted = (args.path || args.file || "").trim().replace(/^\.?\/+/, "").toLowerCase();
      if (!wanted || wanted === "skill.md") return skill.instructions.slice(0, SKILL_LIBRARY_LIMITS.readChars);
      const file =
        skill.files.find((item) => item.path.toLowerCase() === wanted) ??
        skill.files.find((item) => item.path.toLowerCase().endsWith(`/${wanted}`)) ??
        skill.files.find((item) => item.path.toLowerCase().split("/").pop() === wanted.split("/").pop());
      if (!file) {
        return `File '${args.path ?? ""}' is not bundled with ${skill.slug}. Files: ${
          skill.files.map((item) => item.path).join(", ") || "(none)"
        }.`;
      }
      const content = file.content.slice(0, SKILL_LIBRARY_LIMITS.readChars);
      return content.length < file.content.length
        ? `${content}\n\n[truncated — ${file.content.length.toLocaleString()} characters total]`
        : content;
    },
  };
}

function isTraderCompanion(agent: {
  name?: string | null;
  role?: string | null;
  specialty?: string | null;
  instructions?: string | null;
}): boolean {
  const hay = [agent.name, agent.role, agent.specialty, agent.instructions]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    /\btrader\b/.test(hay) ||
    hay.includes("متداول") ||
    hay.includes("المتداول") ||
    hay.includes("trading")
  );
}

export class ConversationService {
  constructor(
    private readonly persistence: Persistence,
    private readonly gateway: AiGateway,
    private readonly runtime: AgentRuntime,
    private readonly defaultModel: string,
    private readonly connectors: ConnectorService,
    private readonly accounts: AccountService,
    private readonly familyHousehold: FamilyHouseholdService | null = null,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async trackFamilyUsage(tokens: number): Promise<void> {
    if (!this.familyHousehold || tokens <= 0) return;
    try {
      await this.familyHousehold.recordUsage(tokens);
    } catch {
      // Family metering must never block a reply.
    }
  }

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

  private sealMessage(message: Message): Message {
    return { ...message, content: encryptField(message.content) };
  }

  private openMessage(message: Message): Message {
    try {
      return { ...message, content: decryptField(message.content) };
    } catch {
      return message;
    }
  }

  private async persistMessage(message: Message): Promise<void> {
    await this.persistence.messages.create(this.sealMessage(message));
  }

  private async loadPlainMessages(conversationId: string): Promise<Message[]> {
    return (await this.persistence.messages.listByConversation(conversationId)).map((message) =>
      this.openMessage(message),
    );
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
        resultToken:
          typeof parsed.resultToken === "string" && parsed.resultToken.trim()
            ? parsed.resultToken.trim()
            : undefined,
      };
    } catch {
      return null;
    }
  }

  async listConversations(): Promise<Conversation[]> {
    return (await this.persistence.conversations.list()).map((conversation) => ({
      ...conversation,
      ownerEmployeeId: conversation.ownerEmployeeId ?? null,
      familyMemberId: conversation.familyMemberId ?? null,
      visibility: conversation.visibility ?? "workspace",
      spendTier: conversation.spendTier ?? "low",
      sessionTokenBudget:
        conversation.sessionTokenBudget === undefined ? null : conversation.sessionTokenBudget,
    }));
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
    const messages = await this.loadPlainMessages(id);
    const normalized: Conversation = {
      ...conversation,
      spendTier: conversation.spendTier ?? "low",
      sessionTokenBudget:
        conversation.sessionTokenBudget === undefined
          ? null
          : conversation.sessionTokenBudget,
      ownerEmployeeId: conversation.ownerEmployeeId ?? null,
      familyMemberId: conversation.familyMemberId ?? null,
      visibility: conversation.visibility ?? "workspace",
    };
    return {
      conversation: normalized,
      messages,
      sessionUsage: await this.sessionUsageFor(normalized),
    };
  }

  async createConversation(
    input: CreateConversationRequest,
    actorEmployeeId?: string | null,
  ): Promise<Conversation> {
    await this.accounts.assertWithinQuota();
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

    const familyMemberId =
      (await this.familyHousehold?.getActiveMemberId())?.trim() || null;

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
      ownerEmployeeId: actorEmployeeId?.trim() || null,
      familyMemberId,
      visibility: actorEmployeeId
        ? (input.visibility ?? "private")
        : (input.visibility ?? "workspace"),
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

  /** Store client-produced turns (local model / guardian) without running the LLM. */
  async ingestMessages(
    conversationId: string,
    input: IngestConversationMessagesRequest,
  ): Promise<IngestConversationMessagesResponse> {
    const items = input.messages ?? [];
    if (!items.length) {
      throw new ValidationError("At least one message is required");
    }
    if (items.length > 40) {
      throw new ValidationError("Too many messages to ingest at once");
    }

    const conversation = await this.persistence.conversations.getById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation", conversationId);
    }

    const saved: Message[] = [];
    for (const item of items) {
      const role = item.role === "assistant" ? "assistant" : "user";
      const content = item.content?.trim() ?? "";
      if (!content) continue;
      if (content.length > 8000) {
        throw new ValidationError("Message must be 8000 characters or fewer");
      }
      const message: Message = {
        id: brandId<MessageId>(this.ids.next("msg")),
        conversationId: conversation.id,
        role,
        content,
        createdAt: this.clock.isoNow(),
      };
      await this.persistMessage(message);
      saved.push(message);
    }

    if (!saved.length) {
      throw new ValidationError("Message content is required");
    }

    await this.persistence.conversations.update({
      ...conversation,
      updatedAt: this.clock.isoNow(),
    });

    return { messages: saved };
  }

  async sendMessage(
    conversationId: string,
    input: SendMessageRequest,
    options?: {
      onToken?: (text: string) => void;
      onTool?: (name: string, result: string) => void;
      onToolStart?: (name: string, detail?: string) => void;
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

    const childSeat = (await this.familyHousehold?.isActiveChildSeat()) === true;
    if (childSeat) {
      const hard = guardianHardHit(content);
      if (hard) {
        throw new ForbiddenError(
          `Family safety boundary: ${hard.labelEn}. Ask a parent if you need help.`,
        );
      }
      // Never trust client-supplied skill bodies or goal hints for child seats.
      input = {
        ...input,
        skills: [],
        skillLibrary: null,
        workspaceHint: input.workspaceHint
          ? { ...input.workspaceHint, activeGoal: null }
          : input.workspaceHint,
      };
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

    const ephemeral = Boolean(input.ephemeral);
    const now = this.clock.isoNow();
    const userMessage: Message = {
      id: brandId<MessageId>(this.ids.next("msg")),
      conversationId: conversation.id,
      role: "user",
      content,
      createdAt: now,
    };
    if (!ephemeral) {
      await this.persistMessage(userMessage);
    }

    const history = ephemeral
      ? (input.priorMessages ?? [])
          .filter(
            (message) =>
              (message.role === "user" || message.role === "assistant") &&
              Boolean(message.content?.trim()),
          )
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content.trim().slice(0, 8000),
          }))
          .slice(-profile.historyMessages)
      : (await this.loadPlainMessages(conversationId))
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

      const allDocs = childSeat ? [] : await this.persistence.knowledge.list();
      if (allDocs.length > 0 && profile.knowledgeDocs > 0) {
        const {
          selectRelevantKnowledge,
          buildKnowledgeSystemBlock,
        } = await import("../lib/knowledge-context.js");
        const ranked = selectRelevantKnowledge({
          docs: allDocs,
          query: content,
          projectId,
          limit: profile.knowledgeDocs,
          decrypt: decryptField,
        });
        const queryHadHits = ranked.some((item) => item.score > 0);
        const block = buildKnowledgeSystemBlock({
          items: ranked,
          maxCharsPerDoc: profile.knowledgeChars,
          queryHadHits,
        });
        if (block) contextParts.push(block);
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

      const memories = childSeat
        ? []
        : await this.persistence.memories.listByAgent(agent.id);
      if (memories.length > 0 && profile.memories > 0) {
        contextParts.push(
          [
            "Your recent memory notes (treat as facts the operator told you):",
            ...memories
              .slice(0, profile.memories)
              .map((memory) => `- ${decryptField(memory.content).slice(0, profile.memoryChars)}`),
          ].join("\n"),
        );
      }

      const skills = childSeat ? [] : await this.persistence.skills.listByAgent(agent.id);
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

      const userSkills = (Array.isArray(input.skills) ? input.skills : [])
        .filter(
          (skill): skill is { name: string; instructions: string } =>
            Boolean(skill) &&
            typeof skill.name === "string" &&
            typeof skill.instructions === "string" &&
            skill.instructions.trim().length > 0,
        )
        .slice(0, 6);
      if (userSkills.length > 0) {
        const budget = profile.tier === "high" ? 16_000 : profile.tier === "medium" ? 10_000 : 6_000;
        let remaining = budget;
        const sections: string[] = [];
        for (const skill of userSkills) {
          if (remaining < 300) break;
          const text = skill.instructions.trim().slice(0, remaining);
          remaining -= text.length;
          sections.push(text);
        }
        contextParts.push(
          [
            "ACTIVE SKILLS — reusable instructions the user installed. Apply every skill below to this reply.",
            "Follow their steps and output formats. If a skill conflicts with safety rules, safety wins.",
            "",
            sections.join("\n\n"),
          ].join("\n"),
        );
      }

      const hint = stripSkillsFallback(input.workspaceHint, userSkills.length > 0);
      const persistedGoal =
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
            ? `\nOperator notes:\n${hint.operatorDirectives.slice(0, profile.hintNotesChars)}`
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
                  ? [
                      "A local folder is attached on the operator's PC.",
                      "You have real desk tools: search_code, list_files, read_file, apply_patch, write_file,",
                      "delete_file, rename_file, create_dir, run_terminal, git_status, git_diff, open_path,",
                      "preview_html, generate_pdf, generate_docx, generate_presentation, generate_image, export_csv, read_document, web_search, scrape_page, fetch_url.",
                      "Workflow: search → read → edit → verify with run_terminal. Prefer apply_patch for surgical edits.",
                      "Research: web_search → scrape_page (or fetch_url). Deliverables: pdf / Word / slides / image / html / csv; read with read_document.",
                      "Do not claim you lack shell or file access. Be precise and reproducible; skip fluff.",
                    ].join(" ")
                  : "The operator runs Commit / Push / Open PR from the workspace panel.",
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
            hint.kind === "folder" ? "desk=local" : null,
            hint.folderPath ? `Local folder: ${hint.folderPath}` : null,
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
      const mailConnector = await this.connectors.findPreferredMailConnector();
      const emailTools = mailConnector
        ? {
            listMessages: async (args: Record<string, string>) => {
              const mailbox = args.mailbox?.trim() || "INBOX";
              const limit = Math.min(30, Math.max(1, Number(args.limit) || 20));
              const listed = await this.connectors.listEmailMessages(
                mailConnector.id,
                mailbox,
                limit,
              );
              return JSON.stringify(listed, null, 2);
            },
            readMessage: async (args: Record<string, string>) => {
              const messageId = args.message_id?.trim() || args.id?.trim() || "";
              if (!messageId) return "FAILED read_email: message_id is required";
              const detail = await this.connectors.readEmail(
                mailConnector.id,
                messageId,
                args.mailbox?.trim() || "INBOX",
              );
              return JSON.stringify(
                {
                  id: detail.id,
                  subject: detail.subject,
                  from: detail.from,
                  to: detail.to,
                  cc: detail.cc,
                  date: detail.date,
                  text: detail.text?.slice(0, 12_000) ?? null,
                  snippet: detail.snippet,
                },
                null,
                2,
              );
            },
            sendMessage: async (args: Record<string, string>) => {
              const sent = await this.connectors.sendEmail(mailConnector.id, {
                to: args.to?.trim() || "",
                subject: args.subject?.trim() || "",
                text: args.text ?? "",
                cc: args.cc?.trim() || null,
              });
              return JSON.stringify(sent, null, 2);
            },
            arrangeMessages: async (args: Record<string, string>) => {
              const rawIds = args.message_ids?.trim() || args.messageIds?.trim() || "";
              let messageIds: string[] = [];
              if (rawIds.startsWith("[")) {
                try {
                  const parsed = JSON.parse(rawIds) as unknown;
                  if (Array.isArray(parsed)) messageIds = parsed.map(String);
                } catch {
                  messageIds = [];
                }
              } else {
                messageIds = rawIds
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean);
              }
              const action = (args.action?.trim() || "archive") as
                | "archive"
                | "trash"
                | "untrash"
                | "mark_read"
                | "mark_unread"
                | "star"
                | "unstar"
                | "label"
                | "move";
              const arranged = await this.connectors.arrangeEmail(mailConnector.id, {
                action,
                messageIds,
                mailbox: args.mailbox?.trim() || null,
                targetMailbox: args.target_mailbox?.trim() || args.targetMailbox?.trim() || null,
                addLabelIds: (args.add_label_ids || args.addLabelIds || "")
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean),
                removeLabelIds: (args.remove_label_ids || args.removeLabelIds || "")
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean),
              });
              return JSON.stringify(arranged, null, 2);
            },
          }
        : null;
      const sshConnector = await this.connectors.findPreferredSshConnector();
      const sshTools = sshConnector
        ? {
            execCommand: async (args: Record<string, string>) => {
              const command = args.command?.trim() || "";
              if (!command) return "FAILED ssh_exec: command is required";
              const result = await this.connectors.execSsh(sshConnector.id, { command });
              return JSON.stringify(result, null, 2);
            },
            listHome: async (args: Record<string, string>) => {
              const listed = await this.connectors.resources(
                sshConnector.id,
                args.query?.trim() || undefined,
              );
              return JSON.stringify(listed, null, 2);
            },
          }
        : null;
      const finnhubAccess = await this.connectors.resolveFinnhubAccess();
      const finnhubTools = finnhubAccess
        ? {
            getQuote: async (args: Record<string, string>) => {
              const symbol = args.symbol?.trim() || "";
              if (!symbol) return "FAILED get_quote: symbol is required";
              const quote = await this.connectors.getFinnhubQuote(symbol);
              return JSON.stringify({ source: "Finnhub", ...quote }, null, 2);
            },
            getNews: async (args: Record<string, string>) => {
              const symbol = args.symbol?.trim() || "";
              if (!symbol) return "FAILED get_news: symbol is required";
              const days = Math.min(30, Math.max(1, Number(args.days) || 7));
              const items = await this.connectors.getFinnhubNews(symbol, days);
              return JSON.stringify({ source: "Finnhub", symbol, items }, null, 2);
            },
          }
        : null;
      const runRequest = {
        agent,
        conversationId: conversation.id,
        input: content,
        history,
        model: input.model?.trim() || this.defaultModel,
        systemExtra,
        maxOutputTokens:
          typeof input.maxOutputTokens === "number" && input.maxOutputTokens > 0
            ? Math.min(8_000, Math.round(input.maxOutputTokens))
            : codingFolder
              ? Math.max(profile.maxOutputTokens, codingFloor)
              : profile.maxOutputTokens,
        temperature:
          typeof input.temperature === "number" &&
          input.temperature >= 0 &&
          input.temperature <= 2
            ? input.temperature
            : codingFolder
              ? 0.2
              : undefined,
        tools: {
          workspaceSummary,
          activeGoal: activeGoalText,
          teamRoster,
          email: emailTools,
          emailAccountLabel: mailConnector?.accountLabel ?? null,
          ssh: sshTools,
          sshAccountLabel: sshConnector?.accountLabel ?? null,
          finnhub: finnhubTools,
          finnhubAccountLabel: finnhubAccess?.accountLabel ?? null,
          traderMode: isTraderCompanion(agent),
          skills: buildSkillTools(input.skillLibrary),
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
          } else if (event.type === "tool_start") {
            options.onToolStart?.(event.name, event.detail);
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
        const resultToken = randomBytes(32).toString("hex");
        const toolDetail: CallToolApprovalDetail = {
          conversationId: conversation.id,
          toolName: result.pendingTool.name,
          arguments: result.pendingTool.arguments,
          resultToken,
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
        if (!ephemeral) {
          await this.persistMessage(assistantMessage);
        }
      } else if (result.status !== "completed" || !result.output?.trim()) {
        // Prefer a soft completion over a hard failure when tools already ran
        // or the model returned an empty final string (common after web_search).
        const soft =
          (result.toolsUsed?.length ?? toolsUsed.length) > 0
            ? `I finished ${[...(result.toolsUsed ?? toolsUsed)].slice(0, 4).join(", ")}. Ask if you need more detail.`
            : result.output?.trim() || result.error || null;
        if (!soft) {
          throw new ValidationError(result.error ?? "Employee did not return a reply");
        }
        assistantMessage = {
          id: brandId<MessageId>(this.ids.next("msg")),
          conversationId: conversation.id,
          role: "assistant",
          content: soft,
          createdAt: this.clock.isoNow(),
        };
        if (!ephemeral) {
          await this.persistMessage(assistantMessage);
        }
        await this.record(
          "ran",
          "conversation",
          conversation.id,
          `${agent.name} replied in conversation`,
          "agent",
          agent.id,
        );
      } else {
        assistantMessage = {
          id: brandId<MessageId>(this.ids.next("msg")),
          conversationId: conversation.id,
          role: "assistant",
          content: result.output,
          createdAt: this.clock.isoNow(),
        };
        if (!ephemeral) {
          await this.persistMessage(assistantMessage);
        }
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
        await this.trackFamilyUsage(event.inputTokens + event.outputTokens);
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
    options?: { toolResult?: string | null; toolResultAttestation?: string | null },
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

    const childSeat = (await this.familyHousehold?.isActiveChildSeat()) === true;
    if (childSeat && isClientExecTool(detail.toolName)) {
      throw new ForbiddenError("Desktop tools are not available on child seats");
    }

    const clientExec = isClientExecTool(detail.toolName);
    if (clientExec && !options?.toolResult?.trim()) {
      throw new ValidationError(
        `${detail.toolName} requires toolResult from the desktop after local execution`,
      );
    }

    if (clientExec && options?.toolResult?.trim()) {
      const token = detail.resultToken?.trim() ?? "";
      const attestation = options.toolResultAttestation?.trim() ?? "";
      if (!token || !attestation) {
        throw new ValidationError("toolResultAttestation is required for desktop tool results");
      }
      const expected = createHash("sha256")
        .update(toolResultAttestationPayload(token, options.toolResult))
        .digest("hex");
      const provided = Buffer.from(attestation, "utf8");
      const want = Buffer.from(expected, "utf8");
      if (provided.length !== want.length || !timingSafeEqual(provided, want)) {
        throw new ForbiddenError("Invalid toolResult attestation");
      }
      // One-time use: clear token so the same approval cannot be replayed with a forged result.
      const cleared: CallToolApprovalDetail = {
        conversationId: detail.conversationId,
        toolName: detail.toolName,
        arguments: detail.arguments,
      };
      await this.persistence.approvals.update({
        ...approval,
        detail: JSON.stringify(cleared),
      });
    }

    const mailConnector = await this.connectors.findPreferredMailConnector();
    const emailTools = mailConnector
      ? {
          listMessages: async (args: Record<string, string>) => {
            const mailbox = args.mailbox?.trim() || "INBOX";
            const limit = Math.min(30, Math.max(1, Number(args.limit) || 20));
            const listed = await this.connectors.listEmailMessages(
              mailConnector.id,
              mailbox,
              limit,
            );
            return JSON.stringify(listed, null, 2);
          },
          readMessage: async (args: Record<string, string>) => {
            const messageId = args.message_id?.trim() || args.id?.trim() || "";
            if (!messageId) return "FAILED read_email: message_id is required";
            const mail = await this.connectors.readEmail(
              mailConnector.id,
              messageId,
              args.mailbox?.trim() || "INBOX",
            );
            return JSON.stringify(
              {
                id: mail.id,
                subject: mail.subject,
                from: mail.from,
                to: mail.to,
                date: mail.date,
                text: mail.text?.slice(0, 12_000) ?? null,
              },
              null,
              2,
            );
          },
          sendMessage: async (args: Record<string, string>) => {
            const sent = await this.connectors.sendEmail(mailConnector.id, {
              to: args.to?.trim() || "",
              subject: args.subject?.trim() || "",
              text: args.text ?? "",
              cc: args.cc?.trim() || null,
            });
            return JSON.stringify(sent, null, 2);
          },
          arrangeMessages: async (args: Record<string, string>) => {
            const rawIds = args.message_ids?.trim() || "";
            const messageIds = rawIds.startsWith("[")
              ? (JSON.parse(rawIds) as string[])
              : rawIds.split(",").map((part) => part.trim()).filter(Boolean);
            const arranged = await this.connectors.arrangeEmail(mailConnector.id, {
              action: (args.action?.trim() || "archive") as
                | "archive"
                | "trash"
                | "untrash"
                | "mark_read"
                | "mark_unread"
                | "star"
                | "unstar"
                | "label"
                | "move",
              messageIds,
              mailbox: args.mailbox?.trim() || null,
              targetMailbox: args.target_mailbox?.trim() || null,
              addLabelIds: (args.add_label_ids || "")
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
              removeLabelIds: (args.remove_label_ids || "")
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
            });
            return JSON.stringify(arranged, null, 2);
          },
        }
      : null;

    const sshConnector = await this.connectors.findPreferredSshConnector();
    const sshTools = sshConnector
      ? {
          execCommand: async (args: Record<string, string>) => {
            const command = args.command?.trim() || "";
            if (!command) return "FAILED ssh_exec: command is required";
            const result = await this.connectors.execSsh(sshConnector.id, { command });
            return JSON.stringify(result, null, 2);
          },
          listHome: async (args: Record<string, string>) => {
            const listed = await this.connectors.resources(
              sshConnector.id,
              args.query?.trim() || undefined,
            );
            return JSON.stringify(listed, null, 2);
          },
        }
      : null;

    const finnhubAccess = await this.connectors.resolveFinnhubAccess();
    const finnhubTools = finnhubAccess
      ? {
          getQuote: async (args: Record<string, string>) => {
            const symbol = args.symbol?.trim() || "";
            if (!symbol) return "FAILED get_quote: symbol is required";
            const quote = await this.connectors.getFinnhubQuote(symbol);
            return JSON.stringify({ source: "Finnhub", ...quote }, null, 2);
          },
          getNews: async (args: Record<string, string>) => {
            const symbol = args.symbol?.trim() || "";
            if (!symbol) return "FAILED get_news: symbol is required";
            const days = Math.min(30, Math.max(1, Number(args.days) || 7));
            const items = await this.connectors.getFinnhubNews(symbol, days);
            return JSON.stringify({ source: "Finnhub", symbol, items }, null, 2);
          },
        }
      : null;

    const toolResult = await executeApprovedTool(
      detail.toolName,
      detail.arguments,
      {
        email: emailTools,
        emailAccountLabel: mailConnector?.accountLabel ?? null,
        ssh: sshTools,
        sshAccountLabel: sshConnector?.accountLabel ?? null,
        finnhub: finnhubTools,
        finnhubAccountLabel: finnhubAccess?.accountLabel ?? null,
        traderMode: isTraderCompanion(agent),
      },
      options?.toolResult,
    );
    const profile = resolveSpendProfile(conversation.spendTier ?? "low");
    const historyMessages = (
      await this.loadPlainMessages(conversation.id)
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
      "delete_file",
      "rename_file",
      "create_dir",
      "git_status",
      "git_diff",
      "open_path",
    ];
    const isLocal = localTools.includes(detail.toolName);
    const isEmailMutating =
      detail.toolName === "send_email" || detail.toolName === "arrange_email";
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
        : isEmailMutating
          ? [
              "The operator approved this email action and it already ran once.",
              "Summarize the result clearly.",
              "Do not call send_email or arrange_email again for the same message or batch.",
            ].join(" ")
          : "The operator approved this action. Continue helping — summarize what you will do next and make concrete progress.",
    ].join("\n");

    const providerConfigured = this.gateway.listProviders().length > 0;
    if (!providerConfigured) {
      throw new ValidationError("No model provider is configured");
    }

    const localFloor =
      profile.tier === "high" ? 900 : profile.tier === "medium" ? 520 : 360;
    const deskSystemExtra = isLocal
      ? [
          "Local desk TOOL_RESULT received. You still have full PC tools for this folder:",
          "list_files, search_code, read_file, apply_patch, write_file, delete_file, rename_file, create_dir,",
          "run_terminal, git_status, git_diff, open_path, preview_html, generate_pdf, generate_docx, generate_presentation, generate_image, export_csv, read_document, web_search, scrape_page, fetch_url.",
          "Continue the coding loop until the operator's ask is done. Verify edits with run_terminal.",
          "Research: web_search → scrape_page. Deliverables: pdf / Word / slides / image / html / csv; read with read_document.",
          "Be brief and precise — prefer exact paths and commands.",
        ].join(" ")
      : isEmailMutating
        ? "Approved email TOOL_RESULT received. Do not resend or re-arrange the same items. Confirm outcome in one short update."
        : "You just received an approved tool result. Do not call propose_action again for the same action.";

    // mailConnector / emailTools / sshTools already prepared above for executeApprovedTool.

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
        systemExtra: deskSystemExtra,
        // Critical: keep native desk tools attached after the first local tool.
        // Without this, multi-step file/terminal work dies after one approval.
        tools: {
          workspaceSummary: isLocal
            ? [
                "mode=folder",
                "desk=local",
                "Local folder: attached (desktop-executed tools)",
                "Continue using search_code / list_files / read_file / apply_patch / write_file / run_terminal.",
              ].join("\n")
            : null,
          activeGoal: null,
          teamRoster: null,
          email: emailTools,
          emailAccountLabel: mailConnector?.accountLabel ?? null,
          ssh: sshTools,
          sshAccountLabel: sshConnector?.accountLabel ?? null,
          finnhub: finnhubTools,
          finnhubAccountLabel: finnhubAccess?.accountLabel ?? null,
          traderMode: isTraderCompanion(agent),
        },
      },
      this.gateway,
    );

    if (result.status === "needs_approval" && result.pendingTool) {
      const toolDetail: CallToolApprovalDetail = {
        conversationId: conversation.id,
        toolName: result.pendingTool.name,
        arguments: result.pendingTool.arguments,
        resultToken: randomBytes(32).toString("hex"),
      };
      const nextApproval: Approval = {
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
      await this.persistence.approvals.create(nextApproval);
      await this.record(
        "created",
        "approval",
        nextApproval.id,
        `Tool approval requested: ${nextApproval.title}`,
        "agent",
        agent.id,
      );

      const assistantMessage: Message = {
        id: brandId<MessageId>(this.ids.next("msg")),
        conversationId: conversation.id,
        role: "assistant",
        content:
          result.output?.trim() ||
          `Next tool awaiting desktop execution: ${nextApproval.title}`,
        createdAt: this.clock.isoNow(),
      };
      await this.persistMessage(assistantMessage);
      await this.persistence.conversations.update({
        ...conversation,
        updatedAt: this.clock.isoNow(),
      });

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
        await this.trackFamilyUsage(result.usage.inputTokens + result.usage.outputTokens);
      }

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
        approval: nextApproval,
      };
    }

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
    await this.persistMessage(assistantMessage);
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
      await this.trackFamilyUsage(result.usage.inputTokens + result.usage.outputTokens);
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
