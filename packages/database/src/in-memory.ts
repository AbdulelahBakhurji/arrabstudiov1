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
  type OrgDepartment,
  type OrgEmployeeRecord,
  type OrgSecurityEvent,
} from "@arrab/shared";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_WORKSPACE_ID,
  type ActivityRepository,
  type ApprovalRepository,
  type CompanionStateRepository,
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
  constructor(private readonly holder: { operator: OperatorProfile | null }) {}

  async get(): Promise<OperatorProfile | null> {
    return this.holder.operator;
  }

  async upsert(profile: OperatorProfile): Promise<OperatorProfile> {
    this.holder.operator = profile;
    return profile;
  }
}

class MemoryCompanionStateRepository implements CompanionStateRepository {
  constructor(
    private readonly holder: { companionState: { updatedAt: string; state: unknown } | null },
  ) {}

  async get(): Promise<{ updatedAt: string; state: unknown } | null> {
    return this.holder.companionState;
  }

  async upsert(doc: {
    updatedAt: string;
    state: unknown;
  }): Promise<{ updatedAt: string; state: unknown }> {
    this.holder.companionState = doc;
    return doc;
  }
}

class MemoryAccountRepository implements AccountRepository {
  constructor(private readonly holder: { account: StudioAccountRecord | null }) {}

  async get(): Promise<StudioAccountRecord | null> {
    return this.holder.account;
  }

  async upsert(account: StudioAccountRecord): Promise<StudioAccountRecord> {
    this.holder.account = account;
    return account;
  }

  async delete(): Promise<void> {
    this.holder.account = null;
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

export type MemorySnapshot = {
  version: 1;
  context: WorkspaceContext;
  projects: Project[];
  agents: Agent[];
  teams: Team[];
  conversations: Conversation[];
  messages: Message[];
  activity: Activity[];
  memberships: TeamMembership[];
  connectors: ConnectorSecretRecord[];
  bindings: ProjectRepoBinding[];
  usage: UsageEvent[];
  tasks: Task[];
  operator: OperatorProfile | null;
  companionState: { updatedAt: string; state: unknown } | null;
  account: StudioAccountRecord | null;
  knowledge: Knowledge[];
  memories: Memory[];
  taskRuns: TaskRun[];
  skills: Skill[];
  approvals: Approval[];
  goals: Goal[];
  orgDepartments: OrgDepartment[];
  orgEmployees: OrgEmployeeRecord[];
  orgSecurityEvents: OrgSecurityEvent[];
};

export type MemoryPersistenceOptions = {
  kind?: "memory" | "file";
  snapshot?: Partial<MemorySnapshot>;
  onChange?: () => void;
};

const READ_METHODS = new Set([
  "list",
  "get",
  "getById",
  "listByAgent",
  "listByTeam",
  "listByConversation",
  "listByProject",
  "listByTask",
  "listPending",
  "listRecent",
  "listAll",
  "listByWorkspace",
  "listActiveByAgent",
]);

function withChangeNotifications<T extends object>(repo: T, onChange?: () => void): T {
  if (!onChange) {
    return repo;
  }
  return new Proxy(repo, {
    get(target, prop, receiver) {
      // Read from the raw target so class fields/methods keep a real `this`
      // (Proxy as receiver breaks private/instance field access).
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") {
        return Reflect.get(target, prop, receiver);
      }
      const method = String(prop);
      return (...args: unknown[]) => {
        const result = (value as (...inner: unknown[]) => unknown).apply(target, args);
        if (READ_METHODS.has(method)) {
          return result;
        }
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<unknown>).then((resolved) => {
            onChange();
            return resolved;
          });
        }
        onChange();
        return result;
      };
    },
  });
}

export function emptyMemorySnapshot(now = new Date().toISOString()): MemorySnapshot {
  return {
    version: 1,
    context: seedLocalWorkspace(now),
    projects: [],
    agents: [],
    teams: [],
    conversations: [],
    messages: [],
    activity: [],
    memberships: [],
    connectors: [],
    bindings: [],
    usage: [],
    tasks: [],
    operator: null,
    companionState: null,
    account: null,
    knowledge: [],
    memories: [],
    taskRuns: [],
    skills: [],
    approvals: [],
    goals: [],
    orgDepartments: [],
    orgEmployees: [],
    orgSecurityEvents: [],
  };
}

export function normalizeMemorySnapshot(
  raw: Partial<MemorySnapshot> | null | undefined,
  now = new Date().toISOString(),
): MemorySnapshot {
  const base = emptyMemorySnapshot(now);
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const complete =
    raw.version === 1 &&
    Boolean(raw.context) &&
    Array.isArray(raw.projects) &&
    Array.isArray(raw.agents) &&
    Array.isArray(raw.teams) &&
    Array.isArray(raw.conversations) &&
    Array.isArray(raw.messages) &&
    Array.isArray(raw.activity) &&
    Array.isArray(raw.memberships) &&
    Array.isArray(raw.connectors) &&
    Array.isArray(raw.bindings) &&
    Array.isArray(raw.usage) &&
    Array.isArray(raw.tasks) &&
    Array.isArray(raw.knowledge) &&
    Array.isArray(raw.memories) &&
    Array.isArray(raw.taskRuns) &&
    Array.isArray(raw.skills) &&
    Array.isArray(raw.approvals) &&
    Array.isArray(raw.goals);
  if (complete) {
    const snapshot = raw as MemorySnapshot;
    snapshot.operator = snapshot.operator ?? null;
    snapshot.account = snapshot.account ?? null;
    return snapshot;
  }
  return {
    version: 1,
    context: raw.context ?? base.context,
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    activity: Array.isArray(raw.activity) ? raw.activity : [],
    memberships: Array.isArray(raw.memberships) ? raw.memberships : [],
    connectors: Array.isArray(raw.connectors) ? raw.connectors : [],
    bindings: Array.isArray(raw.bindings) ? raw.bindings : [],
    usage: Array.isArray(raw.usage) ? raw.usage : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    operator: raw.operator ?? null,
    companionState: raw.companionState ?? null,
    account: raw.account ?? null,
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge : [],
    memories: Array.isArray(raw.memories) ? raw.memories : [],
    taskRuns: Array.isArray(raw.taskRuns) ? raw.taskRuns : [],
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    approvals: Array.isArray(raw.approvals) ? raw.approvals : [],
    goals: Array.isArray(raw.goals) ? raw.goals : [],
    orgDepartments: Array.isArray(raw.orgDepartments) ? raw.orgDepartments : [],
    orgEmployees: Array.isArray(raw.orgEmployees) ? raw.orgEmployees : [],
    orgSecurityEvents: Array.isArray(raw.orgSecurityEvents) ? raw.orgSecurityEvents : [],
  };
}


class MemoryOrgDepartmentRepository {
  private readonly items: OrgDepartment[];
  constructor(items: OrgDepartment[] = []) {
    this.items = Array.isArray(items) ? items : [];
  }
  async list(): Promise<OrgDepartment[]> {
    return [...this.items].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getById(id: string): Promise<OrgDepartment | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }
  async create(entity: OrgDepartment): Promise<OrgDepartment> {
    this.items.push(entity);
    return entity;
  }
  async update(entity: OrgDepartment): Promise<OrgDepartment> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index >= 0) this.items[index] = entity;
    return entity;
  }
  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
  }
}

class MemoryOrgEmployeeRepository {
  private readonly items: OrgEmployeeRecord[];
  constructor(items: OrgEmployeeRecord[] = []) {
    this.items = Array.isArray(items) ? items : [];
  }
  async list(): Promise<OrgEmployeeRecord[]> {
    return [...this.items].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  async getById(id: string): Promise<OrgEmployeeRecord | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }
  async getByEmail(email: string): Promise<OrgEmployeeRecord | null> {
    const needle = email.trim().toLowerCase();
    return this.items.find((item) => item.email.toLowerCase() === needle) ?? null;
  }
  async getBySessionHash(hash: string): Promise<OrgEmployeeRecord | null> {
    return this.items.find((item) => item.sessionTokenHash === hash) ?? null;
  }
  async create(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord> {
    this.items.push(entity);
    return entity;
  }
  async update(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord> {
    const index = this.items.findIndex((item) => item.id === entity.id);
    if (index >= 0) this.items[index] = entity;
    return entity;
  }
  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
  }
}


class MemoryOrgSecurityEventRepository {
  private readonly items: OrgSecurityEvent[];
  constructor(items: OrgSecurityEvent[] = []) {
    this.items = Array.isArray(items) ? items : [];
  }
  async listRecent(limit = 50): Promise<OrgSecurityEvent[]> {
    return [...this.items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(200, Math.max(1, limit)));
  }
  async append(event: OrgSecurityEvent): Promise<OrgSecurityEvent> {
    this.items.unshift(event);
    return event;
  }
}

export function createInMemoryPersistence(
  now = new Date().toISOString(),
  options?: MemoryPersistenceOptions,
): Persistence {
  const snapshot = normalizeMemorySnapshot(options?.snapshot, now);
  const touch = options?.onChange;
  const wrap = <T extends object>(repo: T): T => withChangeNotifications(repo, touch);
  const context = snapshot.context;

  return {
    kind: options?.kind ?? "memory",
    workspaceId: context.workspace.id,
    getWorkspace: async () => context,
    projects: wrap(new MemoryEntityRepository<Project>(snapshot.projects)),
    agents: wrap(new MemoryEntityRepository<Agent>(snapshot.agents)),
    teams: wrap(new MemoryEntityRepository<Team>(snapshot.teams)),
    conversations: wrap(new MemoryConversationRepository(snapshot.conversations)),
    messages: wrap(new MemoryMessageRepository(snapshot.messages)),
    activity: wrap(new MemoryActivityRepository(snapshot.activity)),
    memberships: wrap(new MemoryMembershipRepository(snapshot.memberships)),
    connectors: wrap(new MemoryConnectorRepository(snapshot.connectors)),
    bindings: wrap(new MemoryBindingRepository(snapshot.bindings)),
    usage: wrap(new MemoryUsageRepository(snapshot.usage)),
    tasks: wrap(new MemoryTaskRepository(snapshot.tasks)),
    operator: wrap(new MemoryOperatorRepository(snapshot)),
    companionState: wrap(new MemoryCompanionStateRepository(snapshot)),
    accounts: wrap(new MemoryAccountRepository(snapshot)),
    knowledge: wrap(new MemoryKnowledgeRepository(snapshot.knowledge)),
    memories: wrap(new MemoryMemoryNotesRepository(snapshot.memories)),
    taskRuns: wrap(new MemoryTaskRunRepository(snapshot.taskRuns)),
    skills: wrap(new MemorySkillRepository(snapshot.skills)),
    approvals: wrap(new MemoryApprovalRepository(snapshot.approvals)),
    goals: wrap(new MemoryGoalRepository(snapshot.goals)),
    // Org repos keep a plain object `this` — Proxy wrappers break instance field access.
    orgDepartments: (() => {
      const repo = new MemoryOrgDepartmentRepository(snapshot.orgDepartments);
      if (!touch) return repo;
      return {
        list: () => repo.list(),
        getById: (id: string) => repo.getById(id),
        create: async (entity: OrgDepartment) => {
          const created = await repo.create(entity);
          touch();
          return created;
        },
        update: async (entity: OrgDepartment) => {
          const updated = await repo.update(entity);
          touch();
          return updated;
        },
        delete: async (id: string) => {
          await repo.delete(id);
          touch();
        },
      };
    })(),
    orgEmployees: (() => {
      const repo = new MemoryOrgEmployeeRepository(snapshot.orgEmployees);
      if (!touch) return repo;
      return {
        list: () => repo.list(),
        getById: (id: string) => repo.getById(id),
        getByEmail: (email: string) => repo.getByEmail(email),
        getBySessionHash: (hash: string) => repo.getBySessionHash(hash),
        create: async (entity: OrgEmployeeRecord) => {
          const created = await repo.create(entity);
          touch();
          return created;
        },
        update: async (entity: OrgEmployeeRecord) => {
          const updated = await repo.update(entity);
          touch();
          return updated;
        },
        delete: async (id: string) => {
          await repo.delete(id);
          touch();
        },
      };
    })(),
    orgSecurityEvents: (() => {
      const repo = new MemoryOrgSecurityEventRepository(snapshot.orgSecurityEvents);
      if (!touch) return repo;
      return {
        listRecent: (limit?: number) => repo.listRecent(limit),
        append: async (event: OrgSecurityEvent) => {
          const created = await repo.append(event);
          touch();
          return created;
        },
      };
    })(),
  };
}
