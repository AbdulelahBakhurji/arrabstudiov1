import {
  NotFoundError,
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
  type ConversationId,
  type CreateGoalRequest,
  type Goal,
  type GoalId,
  type ProjectId,
  type TeamId,
  type UpdateGoalRequest,
  type WorkspaceId,
} from "@arrab/shared";

export class GoalService {
  constructor(
    private readonly persistence: Persistence,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async record(summary: string, objectId: string): Promise<void> {
    await this.persistence.activity.append({
      id: brandId<ActivityId>(this.ids.next("act")),
      workspaceId: this.persistence.workspaceId,
      actorType: "system",
      actorId: null,
      verb: "updated",
      objectType: "goal",
      objectId,
      summary,
      createdAt: this.clock.isoNow(),
    } satisfies Activity);
  }

  async list(status?: string): Promise<Goal[]> {
    const items = await this.persistence.goals.listByWorkspace();
    if (!status) {
      return items;
    }
    return items.filter((goal) => goal.status === status);
  }

  async listActiveByAgent(agentId: string): Promise<Goal[]> {
    return this.persistence.goals.listActiveByAgent(agentId);
  }

  async get(id: string): Promise<Goal> {
    const goal = await this.persistence.goals.getById(id);
    if (!goal) {
      throw new NotFoundError("Goal", id);
    }
    return goal;
  }

  async create(input: CreateGoalRequest): Promise<Goal> {
    const title = input.title?.trim() ?? "";
    if (!title) {
      throw new ValidationError("Goal title is required");
    }
    if (input.agentId) {
      const agent = await this.persistence.agents.getById(input.agentId);
      if (!agent) {
        throw new ValidationError(`Unknown agent '${input.agentId}'`);
      }
    }
    const now = this.clock.isoNow();
    const goal: Goal = {
      id: brandId<GoalId>(this.ids.next("goal")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      agentId: input.agentId ? brandId<AgentId>(input.agentId) : null,
      conversationId: input.conversationId
        ? brandId<ConversationId>(input.conversationId)
        : null,
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      teamId: input.teamId ? brandId<TeamId>(input.teamId) : null,
      title: title.slice(0, 240),
      detail: input.detail?.trim() ? input.detail.trim().slice(0, 4000) : null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.goals.create(goal);
    await this.record(`Set goal "${goal.title}"`, goal.id);
    return goal;
  }

  async update(id: string, input: UpdateGoalRequest): Promise<Goal> {
    const existing = await this.get(id);
    const next: Goal = {
      ...existing,
      title: input.title?.trim() ? input.title.trim().slice(0, 240) : existing.title,
      detail:
        input.detail === undefined
          ? existing.detail
          : input.detail?.trim()
            ? input.detail.trim().slice(0, 4000)
            : null,
      status: input.status ?? existing.status,
      conversationId:
        input.conversationId === undefined
          ? existing.conversationId
          : input.conversationId
            ? brandId<ConversationId>(input.conversationId)
            : null,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.goals.update(next);
    await this.record(`Updated goal "${next.title}" (${next.status})`, next.id);
    return next;
  }
}
