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
  type AddTeamMemberRequest,
  type Agent,
  type AgentId,
  type BindProjectRepoRequest,
  type CreateAgentRequest,
  type CreateProjectRequest,
  type CreateTaskRequest,
  type CreateTeamRequest,
  type CreateKnowledgeRequest,
  type CreateMemoryRequest,
  type CreateSkillRequest,
  type CreateApprovalRequest,
  type ResolveApprovalRequest,
  type Approval,
  type ApprovalId,
  type Skill,
  type SkillId,
  type Knowledge,
  type KnowledgeId,
  type Memory,
  type MemoryId,
  type OperatorProfile,
  type Project,
  type ProjectId,
  type ProjectRepoBinding,
  type Task,
  type TaskId,
  type TaskPriority,
  type TaskStatus,
  type Team,
  type TeamId,
  type TeamMembership,
  type UpdateAgentRequest,
  type UpdateKnowledgeRequest,
  type UpdateOperatorRequest,
  type UpdateProjectRequest,
  type UpdateTaskRequest,
  type UpdateTeamRequest,
  type WorkspaceId,
} from "@arrab/shared";

function requireName(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  if (trimmed.length > 120) {
    throw new ValidationError(`${label} must be 120 characters or fewer`);
  }
  return trimmed;
}

function requireText(value: string | undefined, label: string, max: number): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${label} must be ${max} characters or fewer`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, max = 2000): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > max) {
    throw new ValidationError(`Text must be ${max} characters or fewer`);
  }
  return trimmed;
}

export class WorkspaceCommandService {
  constructor(
    private readonly persistence: Persistence,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async record(
    verb: Activity["verb"],
    objectType: string,
    objectId: string,
    summary: string,
  ): Promise<void> {
    const entry: Activity = {
      id: brandId<ActivityId>(this.ids.next("act")),
      workspaceId: this.persistence.workspaceId,
      actorType: "system",
      actorId: null,
      verb,
      objectType,
      objectId,
      summary,
      createdAt: this.clock.isoNow(),
    };
    await this.persistence.activity.append(entry);
  }

  private async assertProjectInWorkspace(projectId: string | null | undefined): Promise<void> {
    if (!projectId) {
      return;
    }
    const project = await this.persistence.projects.getById(projectId);
    if (!project) {
      throw new ValidationError(`Unknown project '${projectId}'`);
    }
  }

  async createProject(input: CreateProjectRequest): Promise<Project> {
    const now = this.clock.isoNow();
    const project: Project = {
      id: brandId<ProjectId>(this.ids.next("prj")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      name: requireName(input.name, "Project name"),
      description: optionalText(input.description),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.projects.create(project);
    await this.record("created", "project", project.id, `Created project "${project.name}"`);
    return project;
  }

  async updateProject(id: string, input: UpdateProjectRequest): Promise<Project> {
    const existing = await this.persistence.projects.getById(id);
    if (!existing) {
      throw new NotFoundError("Project", id);
    }
    const updated: Project = {
      ...existing,
      name: input.name === undefined ? existing.name : requireName(input.name, "Project name"),
      description:
        input.description === undefined ? existing.description : optionalText(input.description),
      status: input.status ?? existing.status,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.projects.update(updated);
    await this.record("updated", "project", updated.id, `Updated project "${updated.name}"`);
    return updated;
  }

  async createAgent(input: CreateAgentRequest): Promise<Agent> {
    await this.assertProjectInWorkspace(input.projectId);
    if (input.teamId) {
      const team = await this.persistence.teams.getById(input.teamId);
      if (!team) {
        throw new NotFoundError("Team", input.teamId);
      }
    }
    const now = this.clock.isoNow();
    const agent: Agent = {
      id: brandId<AgentId>(this.ids.next("agt")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      name: requireName(input.name, "Employee name"),
      role: requireName(input.role, "Role"),
      specialty: optionalText(input.specialty, 120),
      bio: optionalText(input.bio, 4000),
      instructions: optionalText(input.instructions, 8000),
      status: input.status ?? "draft",
      modelProviderId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.agents.create(agent);
    await this.record("created", "agent", agent.id, `Created AI employee "${agent.name}"`);

    if (input.teamId) {
      await this.persistence.memberships.add({
        teamId: brandId<TeamId>(input.teamId),
        agentId: agent.id,
        createdAt: now,
      });
    }

    if (input.starterKnowledge?.title?.trim() && input.starterKnowledge.content?.trim()) {
      await this.createKnowledge({
        title: input.starterKnowledge.title,
        content: input.starterKnowledge.content,
        projectId: input.projectId ?? null,
      });
    }

    if (input.starterBrief?.trim()) {
      await this.createMemory({
        content: input.starterBrief,
        agentId: agent.id,
        projectId: input.projectId ?? null,
      });
    }

    return agent;
  }

  async updateAgent(id: string, input: UpdateAgentRequest): Promise<Agent> {
    const existing = await this.persistence.agents.getById(id);
    if (!existing) {
      throw new NotFoundError("Agent", id);
    }
    if (input.projectId !== undefined) {
      await this.assertProjectInWorkspace(input.projectId);
    }
    const updated: Agent = {
      ...existing,
      name: input.name === undefined ? existing.name : requireName(input.name, "Employee name"),
      role: input.role === undefined ? existing.role : requireName(input.role, "Role"),
      specialty:
        input.specialty === undefined ? existing.specialty : optionalText(input.specialty, 120),
      bio: input.bio === undefined ? existing.bio : optionalText(input.bio, 4000),
      instructions:
        input.instructions === undefined
          ? existing.instructions
          : optionalText(input.instructions, 8000),
      projectId:
        input.projectId === undefined
          ? existing.projectId
          : input.projectId
            ? brandId<ProjectId>(input.projectId)
            : null,
      status: input.status ?? existing.status,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.agents.update(updated);
    await this.record("updated", "agent", updated.id, `Updated AI employee "${updated.name}"`);
    return updated;
  }

  async deleteAgent(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.agents.getById(id);
    if (!existing) {
      throw new NotFoundError("Agent", id);
    }

    const memberships = await this.persistence.memberships.list();
    for (const membership of memberships) {
      if (membership.agentId === id) {
        await this.persistence.memberships.remove(membership.teamId, id);
      }
    }

    const conversations = await this.persistence.conversations.list();
    for (const conversation of conversations) {
      if (conversation.agentId === id) {
        await this.persistence.conversations.update({
          ...conversation,
          agentId: null,
          updatedAt: this.clock.isoNow(),
        });
      }
    }

    const tasks = await this.persistence.tasks.list();
    for (const task of tasks) {
      if (task.assigneeAgentId === id) {
        await this.persistence.tasks.update({
          ...task,
          assigneeAgentId: null,
          updatedAt: this.clock.isoNow(),
        });
      }
    }

    await this.persistence.agents.delete(id);
    await this.record("updated", "agent", id, `Deleted AI employee "${existing.name}"`);
    return { ok: true };
  }

  async createTeam(input: CreateTeamRequest): Promise<Team> {
    await this.assertProjectInWorkspace(input.projectId);
    const now = this.clock.isoNow();
    const team: Team = {
      id: brandId<TeamId>(this.ids.next("team")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      name: requireName(input.name, "Team name"),
      purpose: optionalText(input.purpose),
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.teams.create(team);
    await this.record("created", "team", team.id, `Created AI team "${team.name}"`);
    return team;
  }

  async updateTeam(id: string, input: UpdateTeamRequest): Promise<Team> {
    const existing = await this.persistence.teams.getById(id);
    if (!existing) {
      throw new NotFoundError("Team", id);
    }
    if (input.projectId !== undefined) {
      await this.assertProjectInWorkspace(input.projectId);
    }
    const updated: Team = {
      ...existing,
      name: input.name === undefined ? existing.name : requireName(input.name, "Team name"),
      purpose: input.purpose === undefined ? existing.purpose : optionalText(input.purpose),
      projectId:
        input.projectId === undefined
          ? existing.projectId
          : input.projectId
            ? brandId<ProjectId>(input.projectId)
            : null,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.teams.update(updated);
    await this.record("updated", "team", updated.id, `Updated AI team "${updated.name}"`);
    return updated;
  }

  async addTeamMember(teamId: string, input: AddTeamMemberRequest): Promise<TeamMembership> {
    const team = await this.persistence.teams.getById(teamId);
    if (!team) {
      throw new NotFoundError("Team", teamId);
    }
    const agent = await this.persistence.agents.getById(input.agentId);
    if (!agent) {
      throw new ValidationError(`Unknown employee '${input.agentId}'`);
    }
    const membership: TeamMembership = {
      teamId: brandId<TeamId>(team.id),
      agentId: brandId<AgentId>(agent.id),
      createdAt: this.clock.isoNow(),
    };
    await this.persistence.memberships.add(membership);
    await this.record(
      "updated",
      "team",
      team.id,
      `Added "${agent.name}" to team "${team.name}"`,
    );
    return membership;
  }

  async removeTeamMember(teamId: string, agentId: string): Promise<{ ok: true }> {
    const team = await this.persistence.teams.getById(teamId);
    if (!team) {
      throw new NotFoundError("Team", teamId);
    }
    await this.persistence.memberships.remove(teamId, agentId);
    await this.record("updated", "team", teamId, `Removed member ${agentId} from team`);
    return { ok: true };
  }

  async bindProjectRepo(
    projectId: string,
    input: BindProjectRepoRequest,
  ): Promise<ProjectRepoBinding> {
    await this.assertProjectInWorkspace(projectId);
    const connector = await this.persistence.connectors.getById(input.connectorId);
    if (!connector) {
      throw new ValidationError(`Unknown connector '${input.connectorId}'`);
    }
    const repoFullName = input.repoFullName?.trim() ?? "";
    if (!repoFullName.includes("/")) {
      throw new ValidationError("Repository must be in owner/name form");
    }
    const binding: ProjectRepoBinding = {
      projectId: brandId<ProjectId>(projectId),
      connectorId: input.connectorId,
      repoFullName,
      repoUrl: input.repoUrl?.trim() || `https://github.com/${repoFullName}`,
      defaultBranch: input.defaultBranch?.trim() || null,
      boundAt: this.clock.isoNow(),
    };
    await this.persistence.bindings.upsert(binding);
    await this.record(
      "updated",
      "project",
      projectId,
      `Linked repository ${repoFullName} to project`,
    );
    return binding;
  }

  async unbindProjectRepo(projectId: string): Promise<{ ok: true }> {
    await this.assertProjectInWorkspace(projectId);
    await this.persistence.bindings.deleteByProject(projectId);
    await this.record("updated", "project", projectId, "Unlinked repository from project");
    return { ok: true };
  }

  async getOrCreateOperator(): Promise<OperatorProfile> {
    const existing = await this.persistence.operator.get();
    if (existing) {
      return {
        ...existing,
        seats: existing.seats ?? [],
        title: existing.title && existing.title.trim().length > 0 ? existing.title : null,
      };
    }
    const now = this.clock.isoNow();
    const profile: OperatorProfile = {
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      displayName: "Studio operator",
      title: null,
      seats: [],
      createdAt: now,
      updatedAt: now,
    };
    return this.persistence.operator.upsert(profile);
  }

  async updateOperator(input: UpdateOperatorRequest): Promise<OperatorProfile> {
    const current = await this.getOrCreateOperator();
    const displayName =
      input.displayName === undefined
        ? current.displayName
        : requireName(input.displayName, "Display name");

    let seats = [...current.seats];
    if (input.addSeat !== undefined) {
      const seat = requireName(input.addSeat, "Seat title");
      if (!seats.includes(seat)) {
        seats = [...seats, seat];
      }
    }
    if (input.removeSeat !== undefined) {
      const remove = input.removeSeat.trim();
      seats = seats.filter((seat) => seat !== remove);
    }

    let title = current.title;
    if (input.title !== undefined) {
      if (input.title === null || input.title.trim() === "") {
        title = null;
      } else {
        const selected = requireName(input.title, "Seat");
        if (!seats.includes(selected)) {
          throw new ValidationError("Create the seat first, then choose it");
        }
        title = selected;
      }
    }
    if (title && !seats.includes(title)) {
      title = null;
    }

    const updated: OperatorProfile = {
      ...current,
      displayName,
      title,
      seats,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.operator.upsert(updated);
    await this.record(
      "updated",
      "operator",
      this.persistence.workspaceId,
      title
        ? `Operator ${updated.displayName} chose seat "${title}"`
        : `Operator profile updated for ${updated.displayName}`,
    );
    return updated;
  }

  private async assertAgent(agentId: string | null | undefined): Promise<void> {
    if (!agentId) {
      return;
    }
    const agent = await this.persistence.agents.getById(agentId);
    if (!agent) {
      throw new ValidationError(`Unknown employee '${agentId}'`);
    }
  }

  private async assertTeam(teamId: string | null | undefined): Promise<void> {
    if (!teamId) {
      return;
    }
    const team = await this.persistence.teams.getById(teamId);
    if (!team) {
      throw new ValidationError(`Unknown team '${teamId}'`);
    }
  }

  async createTask(input: CreateTaskRequest): Promise<Task> {
    await this.assertProjectInWorkspace(input.projectId);
    await this.assertAgent(input.assigneeAgentId);
    await this.assertTeam(input.teamId);

    const now = this.clock.isoNow();
    let status: TaskStatus = input.status ?? "backlog";
    if (!input.status && input.assigneeAgentId) {
      status = "assigned";
    }
    const priority: TaskPriority = input.priority ?? "medium";

    const task: Task = {
      id: brandId<TaskId>(this.ids.next("task")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      title: requireName(input.title, "Task title"),
      brief: optionalText(input.brief),
      status,
      priority,
      assigneeAgentId: input.assigneeAgentId
        ? brandId<AgentId>(input.assigneeAgentId)
        : null,
      teamId: input.teamId ? brandId<TeamId>(input.teamId) : null,
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      dueAt: input.dueAt?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.tasks.create(task);
    await this.record("created", "task", task.id, `Created task "${task.title}"`);
    return task;
  }

  async updateTask(id: string, input: UpdateTaskRequest): Promise<Task> {
    const existing = await this.persistence.tasks.getById(id);
    if (!existing) {
      throw new NotFoundError("Task", id);
    }
    if (input.projectId !== undefined) {
      await this.assertProjectInWorkspace(input.projectId);
    }
    if (input.assigneeAgentId !== undefined) {
      await this.assertAgent(input.assigneeAgentId);
    }
    if (input.teamId !== undefined) {
      await this.assertTeam(input.teamId);
    }

    let status = input.status ?? existing.status;
    const assigneeAgentId =
      input.assigneeAgentId === undefined
        ? existing.assigneeAgentId
        : input.assigneeAgentId
          ? brandId<AgentId>(input.assigneeAgentId)
          : null;
    if (input.status === undefined && input.assigneeAgentId && status === "backlog") {
      status = "assigned";
    }

    const updated: Task = {
      ...existing,
      title: input.title === undefined ? existing.title : requireName(input.title, "Task title"),
      brief: input.brief === undefined ? existing.brief : optionalText(input.brief),
      status,
      priority: input.priority ?? existing.priority,
      assigneeAgentId,
      teamId:
        input.teamId === undefined
          ? existing.teamId
          : input.teamId
            ? brandId<TeamId>(input.teamId)
            : null,
      projectId:
        input.projectId === undefined
          ? existing.projectId
          : input.projectId
            ? brandId<ProjectId>(input.projectId)
            : null,
      dueAt: input.dueAt === undefined ? existing.dueAt : input.dueAt?.trim() || null,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.tasks.update(updated);
    await this.record("updated", "task", updated.id, `Updated task "${updated.title}"`);
    return updated;
  }

  async deleteTask(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.tasks.getById(id);
    if (!existing) {
      throw new NotFoundError("Task", id);
    }
    await this.persistence.tasks.delete(id);
    await this.record("updated", "task", id, `Deleted task "${existing.title}"`);
    return { ok: true };
  }

  async createKnowledge(input: CreateKnowledgeRequest): Promise<Knowledge> {
    await this.assertProjectInWorkspace(input.projectId);
    const now = this.clock.isoNow();
    const doc: Knowledge = {
      id: brandId<KnowledgeId>(this.ids.next("know")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      title: requireName(input.title, "Knowledge title"),
      content: requireText(input.content, "Knowledge content", 20_000),
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.knowledge.create(doc);
    await this.record("created", "knowledge", doc.id, `Added knowledge "${doc.title}"`);
    return doc;
  }

  async updateKnowledge(id: string, input: UpdateKnowledgeRequest): Promise<Knowledge> {
    const existing = await this.persistence.knowledge.getById(id);
    if (!existing) {
      throw new NotFoundError("Knowledge", id);
    }
    if (input.projectId !== undefined) {
      await this.assertProjectInWorkspace(input.projectId);
    }
    const updated: Knowledge = {
      ...existing,
      title: input.title === undefined ? existing.title : requireName(input.title, "Knowledge title"),
      content:
        input.content === undefined
          ? existing.content
          : requireText(input.content, "Knowledge content", 20_000),
      projectId:
        input.projectId === undefined
          ? existing.projectId
          : input.projectId
            ? brandId<ProjectId>(input.projectId)
            : null,
      updatedAt: this.clock.isoNow(),
    };
    await this.persistence.knowledge.update(updated);
    await this.record("updated", "knowledge", updated.id, `Updated knowledge "${updated.title}"`);
    return updated;
  }

  async deleteKnowledge(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.knowledge.getById(id);
    if (!existing) {
      throw new NotFoundError("Knowledge", id);
    }
    await this.persistence.knowledge.delete(id);
    await this.record("updated", "knowledge", id, `Deleted knowledge "${existing.title}"`);
    return { ok: true };
  }

  async createMemory(input: CreateMemoryRequest): Promise<Memory> {
    await this.assertProjectInWorkspace(input.projectId);
    await this.assertAgent(input.agentId);
    const now = this.clock.isoNow();
    const memory: Memory = {
      id: brandId<MemoryId>(this.ids.next("mem")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      agentId: input.agentId ? brandId<AgentId>(input.agentId) : null,
      projectId: input.projectId ? brandId<ProjectId>(input.projectId) : null,
      content: requireText(input.content, "Memory content", 4000),
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.memories.create(memory);
    await this.record("created", "memory", memory.id, "Stored agent memory");
    return memory;
  }

  async deleteMemory(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.memories.getById(id);
    if (!existing) {
      throw new NotFoundError("Memory", id);
    }
    await this.persistence.memories.delete(id);
    return { ok: true };
  }

  async createSkill(input: CreateSkillRequest): Promise<{ skill: Skill; task: Task | null }> {
    await this.assertAgent(input.agentId);
    const agent = await this.persistence.agents.getById(input.agentId);
    if (!agent) {
      throw new ValidationError(`Unknown employee '${input.agentId}'`);
    }
    const now = this.clock.isoNow();
    const skill: Skill = {
      id: brandId<SkillId>(this.ids.next("skill")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      agentId: brandId<AgentId>(agent.id),
      title: requireName(input.title, "Skill title"),
      instructions: requireText(input.instructions, "Skill instructions", 8000),
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.skills.create(skill);
    await this.record(
      "created",
      "skill",
      skill.id,
      `Taught skill "${skill.title}" to ${agent.name}`,
    );

    let task: Task | null = null;
    if (input.createTask !== false) {
      task = await this.createTask({
        title: skill.title,
        brief: skill.instructions.slice(0, 2000),
        assigneeAgentId: agent.id,
        projectId: agent.projectId,
        priority: "medium",
        status: "assigned",
      });
    }
    return { skill, task };
  }

  async deleteSkill(id: string): Promise<{ ok: true }> {
    const existing = await this.persistence.skills.getById(id);
    if (!existing) {
      throw new NotFoundError("Skill", id);
    }
    await this.persistence.skills.delete(id);
    return { ok: true };
  }

  async createApproval(input: CreateApprovalRequest): Promise<Approval> {
    if (
      input.kind !== "activate_agent" &&
      input.kind !== "run_task" &&
      input.kind !== "git_push" &&
      input.kind !== "call_tool"
    ) {
      throw new ValidationError("Unknown approval kind");
    }
    await this.assertAgent(input.agentId);
    if (input.taskId) {
      const task = await this.persistence.tasks.getById(input.taskId);
      if (!task) throw new ValidationError(`Unknown task '${input.taskId}'`);
    }
    const approval: Approval = {
      id: brandId<ApprovalId>(this.ids.next("apr")),
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      kind: input.kind,
      status: "pending",
      title: requireName(input.title, "Approval title"),
      detail: optionalText(input.detail),
      agentId: input.agentId ? brandId<AgentId>(input.agentId) : null,
      taskId: input.taskId ? brandId<TaskId>(input.taskId) : null,
      createdAt: this.clock.isoNow(),
      resolvedAt: null,
    };
    await this.persistence.approvals.create(approval);
    await this.record("created", "approval", approval.id, `Approval requested: ${approval.title}`);
    return approval;
  }

  async resolveApproval(
    id: string,
    input: ResolveApprovalRequest,
  ): Promise<{ approval: Approval; agent?: Agent }> {
    const existing = await this.persistence.approvals.getById(id);
    if (!existing) {
      throw new NotFoundError("Approval", id);
    }
    if (existing.status !== "pending") {
      throw new ValidationError("Approval already resolved");
    }
    if (input.status !== "approved" && input.status !== "rejected") {
      throw new ValidationError("Status must be approved or rejected");
    }

    const approval: Approval = {
      ...existing,
      status: input.status,
      resolvedAt: this.clock.isoNow(),
    };
    await this.persistence.approvals.update(approval);
    await this.record(
      input.status === "approved" ? "approved" : "rejected",
      "approval",
      approval.id,
      `${input.status === "approved" ? "Approved" : "Rejected"}: ${approval.title}`,
    );

    if (input.status === "approved" && approval.kind === "activate_agent" && approval.agentId) {
      const agent = await this.updateAgent(approval.agentId, { status: "active" });
      return { approval, agent };
    }

    return { approval };
  }
}
