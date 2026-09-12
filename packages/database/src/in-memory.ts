import {
  brandId,
  type Activity,
  type Agent,
  type Approval,
  type ConnectorSecretRecord,
  type Conversation,
  type Goal,
  type Knowledge,
  type Memory,
  type Message,
  type OperatorProfile,
  type Organization,
  type OrganizationId,
  type Project,
  type ProjectRepoBinding,
  type Skill,
  type Task,
  type TaskRun,
  type Team,
  type TeamMembership,
  type UsageEvent,
  type Workspace,
  type WorkspaceId,
  type StudioAccountRecord,
} from "@arrab/shared";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_WORKSPACE_ID,
  type ActivityRepository,
  type ApprovalRepository,
  type ConnectorRepository,
  type ConversationRepository,
  type EntityRepository,
  type GoalRepository,
  type KnowledgeRepository,
  type MemoryRepository,
  type MessageRepository,
  type OperatorRepository,
  type AccountRepository,
  type Persistence,
  type ProjectRepoBindingRepository,
  type SkillRepository,
  type TaskRepository,
  type TaskRunRepository,
  type TeamMembershipRepository,
  type UsageRepository,
  type WorkspaceContext,
} from "./types.js";

class MemoryEntityRepository<T extends { id: string }> implements EntityRepository<T> {
  constructor(protected readonly items: T[]) {}

  async list(): Promise<T[]> {
    return [...this.items];
  }

  async getById(id: string): Promise<T | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: T): Promise<T> {
    this.items.push(entity);
    return entity;
  }

  async update(entity: T): Promise<T> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index < 0) {
      throw new Error(`Entity ${entity.id} was not found`);
    }
    this.items[index] = entity;
    return entity;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }
}

class MemoryConversationRepository
  extends MemoryEntityRepository<Conversation>
  implements ConversationRepository
{
  constructor(items: Conversation[]) {
    super(items);
  }

  async listByAgent(agentId: string): Promise<Conversation[]> {
    const all = await this.list();
    return all
      .filter((conversation) => conversation.agentId === agentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByTeam(teamId: string): Promise<Conversation[]> {
    const all = await this.list();
    return all
      .filter((conversation) => conversation.teamId === teamId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

class MemoryMessageRepository implements MessageRepository {
  constructor(private readonly items: Message[]) {}

  async listByConversation(conversationId: string): Promise<Message[]> {
    return this.items
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(message: Message): Promise<Message> {
    this.items.push(message);
    return message;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (this.items[index]?.conversationId === conversationId) {
        this.items.splice(index, 1);
      }
    }
  }
}

class MemoryActivityRepository implements ActivityRepository {
  constructor(private readonly items: Activity[]) {}

  async list(): Promise<Activity[]> {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async append(entry: Activity): Promise<Activity> {
    this.items.push(entry);
    return entry;
  }
}

class MemoryMembershipRepository implements TeamMembershipRepository {
  constructor(private readonly items: TeamMembership[]) {}

  async list(): Promise<TeamMembership[]> {
    return [...this.items];
  }

  async listByTeam(teamId: string): Promise<TeamMembership[]> {
    return this.items.filter((item) => item.teamId === teamId);
  }

  async add(membership: TeamMembership): Promise<TeamMembership> {
    const exists = this.items.some(
      (item) => item.teamId === membership.teamId && item.agentId === membership.agentId,
    );
    if (!exists) {
      this.items.push(membership);
    }
    return membership;
  }

  async remove(teamId: string, agentId: string): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.teamId === teamId && item.agentId === agentId,
    );
    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }
}

class MemoryConnectorRepository implements ConnectorRepository {
  constructor(private readonly items: ConnectorSecretRecord[]) {}

  async list(): Promise<ConnectorSecretRecord[]> {
    return [...this.items];
  }

  async getById(id: string): Promise<ConnectorSecretRecord | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord> {
    this.items.push(record);
    return record;
  }

  async update(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord> {
    const index = this.items.findIndex((item) => item.id === record.id);
    if (index < 0) {
      throw new Error(`Connector ${record.id} was not found`);
    }
    this.items[index] = record;
    return record;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error(`Connector ${id} was not found`);
    }
    this.items.splice(index, 1);
  }
}

class MemoryBindingRepository implements ProjectRepoBindingRepository {
  constructor(private readonly items: ProjectRepoBinding[]) {}

  async list(): Promise<ProjectRepoBinding[]> {
    return [...this.items];
  }

  async getByProject(projectId: string): Promise<ProjectRepoBinding | null> {
    return this.items.find((item) => item.projectId === projectId) ?? null;
  }

  async upsert(binding: ProjectRepoBinding): Promise<ProjectRepoBinding> {
    const index = this.items.findIndex((item) => item.projectId === binding.projectId);
    if (index >= 0) {
      this.items[index] = binding;
    } else {
      this.items.push(binding);
    }
    return binding;
  }

  async deleteByProject(projectId: string): Promise<void> {
    const index = this.items.findIndex((item) => item.projectId === projectId);
    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }
}

class MemoryUsageRepository implements UsageRepository {
  constructor(private readonly items: UsageEvent[]) {}

  async append(event: UsageEvent): Promise<UsageEvent> {
    this.items.push(event);
    return event;
  }

  async listRecent(limit: number): Promise<UsageEvent[]> {
    return [...this.items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listAll(): Promise<UsageEvent[]> {
    return [...this.items];
  }

  async listByConversation(conversationId: string): Promise<UsageEvent[]> {
    return this.items.filter((event) => event.conversationId === conversationId);
  }
}

class MemoryTaskRepository implements TaskRepository {
  constructor(private readonly items: Task[]) {}

  async list(): Promise<Task[]> {
    return [...this.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getById(id: string): Promise<Task | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: Task): Promise<Task> {
    this.items.push(entity);
    return entity;
  }

  async update(entity: Task): Promise<Task> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index < 0) {
      throw new Error(`Task ${entity.id} was not found`);
    }
    this.items[index] = entity;
    return entity;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error(`Task ${id} was not found`);
    }
    this.items.splice(index, 1);
  }
}

class MemoryOperatorRepository implements OperatorRepository {
  private profile: OperatorProfile | null = null;

  async get(): Promise<OperatorProfile | null> {
    return this.profile;
  }

  async upsert(profile: OperatorProfile): Promise<OperatorProfile> {
    this.profile = profile;
    return profile;
  }
}

class MemoryAccountRepository implements AccountRepository {
  private account: StudioAccountRecord | null = null;

  async get(): Promise<StudioAccountRecord | null> {
    return this.account;
  }

  async upsert(account: StudioAccountRecord): Promise<StudioAccountRecord> {
    this.account = account;
    return account;
  }

  async delete(): Promise<void> {
    this.account = null;
  }
}

class MemoryKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly items: Knowledge[]) {}

  async list(): Promise<Knowledge[]> {
    return [...this.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByProject(projectId: string | null): Promise<Knowledge[]> {
    const all = await this.list();
    if (!projectId) {
      return all.filter((item) => item.projectId === null);
    }
    return all.filter((item) => item.projectId === projectId || item.projectId === null);
  }

  async getById(id: string): Promise<Knowledge | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: Knowledge): Promise<Knowledge> {
    this.items.push(entity);
    return entity;
  }

  async update(entity: Knowledge): Promise<Knowledge> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index < 0) throw new Error(`Knowledge ${entity.id} was not found`);
    this.items[index] = entity;
    return entity;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Knowledge ${id} was not found`);
    this.items.splice(index, 1);
  }
}

class MemoryMemoryNotesRepository implements MemoryRepository {
  constructor(private readonly items: Memory[]) {}

  async list(): Promise<Memory[]> {
    return [...this.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByAgent(agentId: string): Promise<Memory[]> {
    return (await this.list()).filter((item) => item.agentId === agentId);
  }

  async getById(id: string): Promise<Memory | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: Memory): Promise<Memory> {
    this.items.push(entity);
    return entity;
  }

  async update(entity: Memory): Promise<Memory> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index < 0) throw new Error(`Memory ${entity.id} was not found`);
    this.items[index] = entity;
    return entity;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Memory ${id} was not found`);
    this.items.splice(index, 1);
  }
}

class MemoryTaskRunRepository implements TaskRunRepository {
  constructor(private readonly items: TaskRun[]) {}

  async list(): Promise<TaskRun[]> {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByTask(taskId: string): Promise<TaskRun[]> {
    return (await this.list()).filter((item) => item.taskId === taskId);
  }

  async create(run: TaskRun): Promise<TaskRun> {
    this.items.push(run);
    return run;
  }
}

class MemorySkillRepository implements SkillRepository {
  constructor(private readonly items: Skill[]) {}

  async list(): Promise<Skill[]> {
    return [...this.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByAgent(agentId: string): Promise<Skill[]> {
    return (await this.list()).filter((item) => item.agentId === agentId);
  }

  async getById(id: string): Promise<Skill | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(entity: Skill): Promise<Skill> {
    this.items.push(entity);
    return entity;
  }

  async update(entity: Skill): Promise<Skill> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index < 0) throw new Error(`Skill ${entity.id} was not found`);
    this.items[index] = entity;
    return entity;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Skill ${id} was not found`);
    this.items.splice(index, 1);
  }
}

class MemoryApprovalRepository implements ApprovalRepository {
  constructor(private readonly items: Approval[]) {}

  async list(): Promise<Approval[]> {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPending(): Promise<Approval[]> {
    return (await this.list()).filter((item) => item.status === "pending");
  }

  async getById(id: string): Promise<Approval | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async create(approval: Approval): Promise<Approval> {
    this.items.push(approval);
    return approval;
  }

  async update(approval: Approval): Promise<Approval> {
    const index = this.items.findIndex((item) => item.id === approval.id);
    if (index < 0) throw new Error(`Approval ${approval.id} was not found`);
    this.items[index] = approval;
    return approval;
  }
}

class MemoryGoalRepository extends MemoryEntityRepository<Goal> implements GoalRepository {
  constructor(items: Goal[]) {
    super(items);
  }

  async listByWorkspace(): Promise<Goal[]> {
    return (await this.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listActiveByAgent(agentId: string): Promise<Goal[]> {
    return (await this.list())
      .filter((goal) => goal.agentId === agentId && goal.status === "active")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

function seedLocalWorkspace(now: string): WorkspaceContext {
  const organization: Organization = {
    id: brandId<OrganizationId>(LOCAL_ORGANIZATION_ID),
    name: "Local Studio",
    createdAt: now,
    updatedAt: now,
  };
  const workspace: Workspace = {
    id: brandId<WorkspaceId>(LOCAL_WORKSPACE_ID),
    organizationId: organization.id,
    name: "Local studio",
    slug: "local",
    createdAt: now,
    updatedAt: now,
  };
  return { organization, workspace };
}

export function createInMemoryPersistence(now = new Date().toISOString()): Persistence {
  const context = seedLocalWorkspace(now);
  return {
    kind: "memory",
    workspaceId: context.workspace.id,
    getWorkspace: async () => context,
    projects: new MemoryEntityRepository<Project>([]),
    agents: new MemoryEntityRepository<Agent>([]),
    teams: new MemoryEntityRepository<Team>([]),
    conversations: new MemoryConversationRepository([]),
    messages: new MemoryMessageRepository([]),
    activity: new MemoryActivityRepository([]),
    memberships: new MemoryMembershipRepository([]),
    connectors: new MemoryConnectorRepository([]),
    bindings: new MemoryBindingRepository([]),
    usage: new MemoryUsageRepository([]),
    tasks: new MemoryTaskRepository([]),
    operator: new MemoryOperatorRepository(),
    accounts: new MemoryAccountRepository(),
    knowledge: new MemoryKnowledgeRepository([]),
    memories: new MemoryMemoryNotesRepository([]),
    taskRuns: new MemoryTaskRunRepository([]),
    skills: new MemorySkillRepository([]),
    approvals: new MemoryApprovalRepository([]),
    goals: new MemoryGoalRepository([]),
  };
}
