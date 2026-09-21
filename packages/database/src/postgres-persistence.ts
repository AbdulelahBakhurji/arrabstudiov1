import {
  brandId,
  type Activity,
  type ActivityActorType,
  type ActivityId,
  type ActivityVerb,
  type Agent,
  type AgentId,
  type AgentStatus,
  type ConnectorSecretRecord,
  type Conversation,
  type ConversationId,
  type Message,
  type MessageId,
  type MessageRole,
  type ModelProviderId,
  type OperatorProfile,
  type Organization,
  type OrganizationId,
  type Project,
  type ProjectId,
  type ProjectRepoBinding,
  type ProjectStatus,
  type Knowledge,
  type KnowledgeId,
  type Memory,
  type MemoryId,
  type Skill,
  type SkillId,
  type Approval,
  type ApprovalId,
  type Goal,
  type GoalId,
  type GoalStatus,
  type Task,
  type TaskId,
  type TaskPriority,
  type TaskRun,
  type TaskRunId,
  type TaskRunStatus,
  type TaskStatus,
  type Team,
  type TeamId,
  type TeamMembership,
  type UsageEvent,
  type Workspace,
  type WorkspaceId,
  type StudioAccountRecord,
  type SubscriptionPlanId,
  type SubscriptionStatus,
  type OrgDepartment,
  type OrgEmployeeRecord,
  type OrgDepartmentId,
  type OrgEmployeeId,
  type OrgSecurityEvent,
  type FamilyMemberRecord,
  type FamilyMemberId,
  type FamilyMemberRole,
  type FamilyAgeTier,
  type FamilyGuidanceRecord,
} from "@arrab/shared";
import type { Pool } from "pg";
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
import type {
  OrgDepartmentRepository,
  OrgEmployeeRepository,
  OrgSecurityEventRepository,
} from "./org-workforce-repos.js";
import type { FamilyMemberRepository, FamilyGuidanceRepository, FamilyHouseholdMetaRepository } from "./family-repos.js";

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
};

type AgentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  role: string;
  specialty: string | null;
  bio: string | null;
  instructions: string | null;
  status: AgentStatus;
  model_provider_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type TeamRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  purpose: string | null;
  created_at: Date;
  updated_at: Date;
};

type ActivityRow = {
  id: string;
  workspace_id: string;
  actor_type: ActivityActorType;
  actor_id: string | null;
  verb: ActivityVerb;
  object_type: string;
  object_id: string | null;
  summary: string;
  created_at: Date;
};

type ConversationRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  agent_id: string | null;
  team_id: string | null;
  title: string | null;
  spend_tier?: string | null;
  session_token_budget?: number | null;
  owner_employee_id?: string | null;
  visibility?: string | null;
  created_at: Date;
  updated_at: Date;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: Date;
};

function iso(value: Date): string {
  return value.toISOString();
}

function mapProject(row: ProjectRow): Project {
  return {
    id: brandId<ProjectId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: brandId<AgentId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
    name: row.name,
    role: row.role,
    specialty: row.specialty ?? null,
    bio: row.bio ?? null,
    instructions: row.instructions ?? null,
    status: row.status,
    modelProviderId: row.model_provider_id
      ? brandId<ModelProviderId>(row.model_provider_id)
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapTeam(row: TeamRow): Team {
  return {
    id: brandId<TeamId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
    name: row.name,
    purpose: row.purpose,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapActivity(row: ActivityRow): Activity {
  return {
    id: brandId<ActivityId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    actorType: row.actor_type,
    actorId: row.actor_id,
    verb: row.verb,
    objectType: row.object_type,
    objectId: row.object_id,
    summary: row.summary,
    createdAt: iso(row.created_at),
  };
}

function mapConversation(row: ConversationRow): Conversation {
  const tier =
    row.spend_tier === "medium" || row.spend_tier === "high" || row.spend_tier === "low"
      ? row.spend_tier
      : "low";
  const visibility =
    row.visibility === "private" || row.visibility === "department" || row.visibility === "workspace"
      ? row.visibility
      : "workspace";
  return {
    id: brandId<ConversationId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
    agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
    teamId: row.team_id ? brandId<TeamId>(row.team_id) : null,
    title: row.title,
    spendTier: tier,
    sessionTokenBudget:
      row.session_token_budget === null || row.session_token_budget === undefined
        ? null
        : Number(row.session_token_budget),
    ownerEmployeeId: row.owner_employee_id ?? null,
    visibility,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: brandId<MessageId>(row.id),
    conversationId: brandId<ConversationId>(row.conversation_id),
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
  };
}

class PostgresProjectRepository implements EntityRepository<Project> {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Project[]> {
    const result = await this.pool.query<ProjectRow>(
      `select * from projects where workspace_id = $1 order by created_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapProject);
  }

  async getById(id: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `select * from projects where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async create(entity: Project): Promise<Project> {
    await this.pool.query(
      `insert into projects (id, workspace_id, name, description, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.name,
        entity.description,
        entity.status,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Project): Promise<Project> {
    await this.pool.query(
      `update projects set name = $1, description = $2, status = $3, updated_at = $4
       where id = $5 and workspace_id = $6`,
      [
        entity.name,
        entity.description,
        entity.status,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }
}

class PostgresAgentRepository implements EntityRepository<Agent> {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Agent[]> {
    const result = await this.pool.query<AgentRow>(
      `select * from agents where workspace_id = $1 order by created_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapAgent);
  }

  async getById(id: string): Promise<Agent | null> {
    const result = await this.pool.query<AgentRow>(
      `select * from agents where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapAgent(row) : null;
  }

  async create(entity: Agent): Promise<Agent> {
    await this.pool.query(
      `insert into agents
       (id, workspace_id, project_id, name, role, specialty, bio, instructions, status, model_provider_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entity.id,
        entity.workspaceId,
        entity.projectId,
        entity.name,
        entity.role,
        entity.specialty,
        entity.bio,
        entity.instructions,
        entity.status,
        entity.modelProviderId,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Agent): Promise<Agent> {
    await this.pool.query(
      `update agents set project_id = $1, name = $2, role = $3, specialty = $4, bio = $5,
       instructions = $6, status = $7, model_provider_id = $8, updated_at = $9
       where id = $10 and workspace_id = $11`,
      [
        entity.projectId,
        entity.name,
        entity.role,
        entity.specialty,
        entity.bio,
        entity.instructions,
        entity.status,
        entity.modelProviderId,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from agents where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresTeamRepository implements EntityRepository<Team> {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Team[]> {
    const result = await this.pool.query<TeamRow>(
      `select * from teams where workspace_id = $1 order by created_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapTeam);
  }

  async getById(id: string): Promise<Team | null> {
    const result = await this.pool.query<TeamRow>(
      `select * from teams where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapTeam(row) : null;
  }

  async create(entity: Team): Promise<Team> {
    await this.pool.query(
      `insert into teams (id, workspace_id, project_id, name, purpose, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.projectId,
        entity.name,
        entity.purpose,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Team): Promise<Team> {
    await this.pool.query(
      `update teams set project_id = $1, name = $2, purpose = $3, updated_at = $4
       where id = $5 and workspace_id = $6`,
      [
        entity.projectId,
        entity.name,
        entity.purpose,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }
}

class PostgresActivityRepository implements ActivityRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Activity[]> {
    const result = await this.pool.query<ActivityRow>(
      `select * from activity where workspace_id = $1 order by created_at desc limit 100`,
      [this.workspaceId],
    );
    return result.rows.map(mapActivity);
  }

  async append(entry: Activity): Promise<Activity> {
    await this.pool.query(
      `insert into activity
       (id, workspace_id, actor_type, actor_id, verb, object_type, object_id, summary, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.workspaceId,
        entry.actorType,
        entry.actorId,
        entry.verb,
        entry.objectType,
        entry.objectId,
        entry.summary,
        entry.createdAt,
      ],
    );
    return entry;
  }
}

class PostgresConversationRepository implements ConversationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `select * from conversations where workspace_id = $1 order by updated_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapConversation);
  }

  async listByAgent(agentId: string): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `select * from conversations
       where workspace_id = $1 and agent_id = $2
       order by updated_at desc`,
      [this.workspaceId, agentId],
    );
    return result.rows.map(mapConversation);
  }

  async listByTeam(teamId: string): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `select * from conversations
       where workspace_id = $1 and team_id = $2
       order by updated_at desc`,
      [this.workspaceId, teamId],
    );
    return result.rows.map(mapConversation);
  }

  async getById(id: string): Promise<Conversation | null> {
    const result = await this.pool.query<ConversationRow>(
      `select * from conversations where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapConversation(row) : null;
  }

  async create(entity: Conversation): Promise<Conversation> {
    await this.pool.query(
      `insert into conversations
       (id, workspace_id, project_id, agent_id, team_id, title, spend_tier, session_token_budget,
        owner_employee_id, visibility, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entity.id,
        entity.workspaceId,
        entity.projectId,
        entity.agentId,
        entity.teamId,
        entity.title,
        entity.spendTier,
        entity.sessionTokenBudget,
        entity.ownerEmployeeId,
        entity.visibility,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Conversation): Promise<Conversation> {
    await this.pool.query(
      `update conversations
       set project_id = $1, agent_id = $2, team_id = $3, title = $4,
           spend_tier = $5, session_token_budget = $6,
           owner_employee_id = $7, visibility = $8, updated_at = $9
       where id = $10 and workspace_id = $11`,
      [
        entity.projectId,
        entity.agentId,
        entity.teamId,
        entity.title,
        entity.spendTier,
        entity.sessionTokenBudget,
        entity.ownerEmployeeId,
        entity.visibility,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(
      `delete from conversations where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
  }
}

class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly pool: Pool) {}

  async listByConversation(conversationId: string): Promise<Message[]> {
    const result = await this.pool.query<MessageRow>(
      `select * from messages where conversation_id = $1 order by created_at asc`,
      [conversationId],
    );
    return result.rows.map(mapMessage);
  }

  async create(message: Message): Promise<Message> {
    await this.pool.query(
      `insert into messages (id, conversation_id, role, content, created_at)
       values ($1, $2, $3, $4, $5)`,
      [message.id, message.conversationId, message.role, message.content, message.createdAt],
    );
    return message;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await this.pool.query(`delete from messages where conversation_id = $1`, [conversationId]);
  }
}

class PostgresMembershipRepository implements TeamMembershipRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<TeamMembership[]> {
    const result = await this.pool.query<{
      team_id: string;
      agent_id: string;
      created_at: Date;
    }>(`select * from team_memberships order by created_at asc`);
    return result.rows.map((row) => ({
      teamId: brandId<TeamId>(row.team_id),
      agentId: brandId<AgentId>(row.agent_id),
      createdAt: iso(row.created_at),
    }));
  }

  async listByTeam(teamId: string): Promise<TeamMembership[]> {
    const result = await this.pool.query<{
      team_id: string;
      agent_id: string;
      created_at: Date;
    }>(`select * from team_memberships where team_id = $1 order by created_at asc`, [teamId]);
    return result.rows.map((row) => ({
      teamId: brandId<TeamId>(row.team_id),
      agentId: brandId<AgentId>(row.agent_id),
      createdAt: iso(row.created_at),
    }));
  }

  async add(membership: TeamMembership): Promise<TeamMembership> {
    await this.pool.query(
      `insert into team_memberships (team_id, agent_id, created_at)
       values ($1, $2, $3)
       on conflict (team_id, agent_id) do nothing`,
      [membership.teamId, membership.agentId, membership.createdAt],
    );
    return membership;
  }

  async remove(teamId: string, agentId: string): Promise<void> {
    await this.pool.query(`delete from team_memberships where team_id = $1 and agent_id = $2`, [
      teamId,
      agentId,
    ]);
  }
}

class PostgresConnectorRepository implements ConnectorRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<ConnectorSecretRecord[]> {
    const result = await this.pool.query<ConnectorRow>(
      `select * from connectors where workspace_id = $1 order by connected_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapConnector);
  }

  async getById(id: string): Promise<ConnectorSecretRecord | null> {
    const result = await this.pool.query<ConnectorRow>(
      `select * from connectors where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapConnector(row) : null;
  }

  async create(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord> {
    await this.pool.query(
      `insert into connectors
       (id, workspace_id, provider, status, account_label, scopes, connected_at, last_verified_at, error, secret)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.id,
        record.workspaceId,
        record.provider,
        record.status,
        record.accountLabel,
        record.scopes,
        record.connectedAt,
        record.lastVerifiedAt,
        record.error,
        record.secret,
      ],
    );
    return record;
  }

  async update(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord> {
    await this.pool.query(
      `update connectors set provider = $1, status = $2, account_label = $3, scopes = $4,
       connected_at = $5, last_verified_at = $6, error = $7, secret = $8
       where id = $9 and workspace_id = $10`,
      [
        record.provider,
        record.status,
        record.accountLabel,
        record.scopes,
        record.connectedAt,
        record.lastVerifiedAt,
        record.error,
        record.secret,
        record.id,
        record.workspaceId,
      ],
    );
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from connectors where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresBindingRepository implements ProjectRepoBindingRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<ProjectRepoBinding[]> {
    const result = await this.pool.query<BindingRow>(`select * from project_repo_bindings`);
    return result.rows.map(mapBinding);
  }

  async getByProject(projectId: string): Promise<ProjectRepoBinding | null> {
    const result = await this.pool.query<BindingRow>(
      `select * from project_repo_bindings where project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? mapBinding(row) : null;
  }

  async upsert(binding: ProjectRepoBinding): Promise<ProjectRepoBinding> {
    await this.pool.query(
      `insert into project_repo_bindings (project_id, connector_id, repo_full_name, repo_url, default_branch, bound_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (project_id) do update set
         connector_id = excluded.connector_id,
         repo_full_name = excluded.repo_full_name,
         repo_url = excluded.repo_url,
         default_branch = excluded.default_branch,
         bound_at = excluded.bound_at`,
      [
        binding.projectId,
        binding.connectorId,
        binding.repoFullName,
        binding.repoUrl,
        binding.defaultBranch,
        binding.boundAt,
      ],
    );
    return binding;
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.pool.query(`delete from project_repo_bindings where project_id = $1`, [projectId]);
  }
}

class PostgresUsageRepository implements UsageRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async append(event: UsageEvent): Promise<UsageEvent> {
    await this.pool.query(
      `insert into usage_events
       (id, workspace_id, conversation_id, agent_id, provider_id, model, input_tokens, output_tokens, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.id,
        event.workspaceId,
        event.conversationId,
        event.agentId,
        event.providerId,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.createdAt,
      ],
    );
    return event;
  }

  async listRecent(limit: number): Promise<UsageEvent[]> {
    const result = await this.pool.query<UsageRow>(
      `select * from usage_events where workspace_id = $1 order by created_at desc limit $2`,
      [this.workspaceId, limit],
    );
    return result.rows.map(mapUsage);
  }

  async listAll(): Promise<UsageEvent[]> {
    const result = await this.pool.query<UsageRow>(
      `select * from usage_events where workspace_id = $1 order by created_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapUsage);
  }

  async listByConversation(conversationId: string): Promise<UsageEvent[]> {
    const result = await this.pool.query<UsageRow>(
      `select * from usage_events
       where workspace_id = $1 and conversation_id = $2
       order by created_at asc`,
      [this.workspaceId, conversationId],
    );
    return result.rows.map(mapUsage);
  }
}

type ConnectorRow = {
  id: string;
  workspace_id: string;
  provider: string;
  status: "connected" | "error";
  account_label: string | null;
  scopes: string[] | null;
  connected_at: Date;
  last_verified_at: Date | null;
  error: string | null;
  secret: string;
};

type BindingRow = {
  project_id: string;
  connector_id: string;
  repo_full_name: string;
  repo_url: string | null;
  default_branch: string | null;
  bound_at: Date;
};

type UsageRow = {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  provider_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: Date;
};

function mapConnector(row: ConnectorRow): ConnectorSecretRecord {
  return {
    id: row.id,
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    provider: row.provider,
    status: row.status,
    accountLabel: row.account_label,
    scopes: row.scopes ?? [],
    connectedAt: iso(row.connected_at),
    lastVerifiedAt: row.last_verified_at ? iso(row.last_verified_at) : null,
    error: row.error,
    secret: row.secret,
  };
}

function mapBinding(row: BindingRow): ProjectRepoBinding {
  return {
    projectId: brandId<ProjectId>(row.project_id),
    connectorId: row.connector_id,
    repoFullName: row.repo_full_name,
    repoUrl: row.repo_url,
    defaultBranch: row.default_branch ?? null,
    boundAt: iso(row.bound_at),
  };
}

function mapUsage(row: UsageRow): UsageEvent {
  return {
    id: row.id,
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    conversationId: row.conversation_id
      ? brandId<ConversationId>(row.conversation_id)
      : null,
    agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
    providerId: row.provider_id,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: iso(row.created_at),
  };
}

type TaskRow = {
  id: string;
  workspace_id: string;
  title: string;
  brief: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_agent_id: string | null;
  assignee_employee_id?: string | null;
  team_id: string | null;
  project_id: string | null;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type OperatorRow = {
  workspace_id: string;
  display_name: string;
  title: string | null;
  seats: string[] | null;
  created_at: Date;
  updated_at: Date;
};

function mapTask(row: TaskRow): Task {
  return {
    id: brandId<TaskId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    title: row.title,
    brief: row.brief,
    status: row.status,
    priority: row.priority,
    assigneeAgentId: row.assignee_agent_id ? brandId<AgentId>(row.assignee_agent_id) : null,
    assigneeEmployeeId: row.assignee_employee_id ?? null,
    teamId: row.team_id ? brandId<TeamId>(row.team_id) : null,
    projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
    dueAt: row.due_at ? iso(row.due_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapOperator(row: OperatorRow): OperatorProfile {
  const seats = row.seats ?? [];
  const title = row.title && row.title.trim().length > 0 ? row.title : null;
  return {
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    displayName: row.display_name,
    title,
    seats,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

class PostgresTaskRepository implements TaskRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Task[]> {
    const result = await this.pool.query<TaskRow>(
      `select * from tasks where workspace_id = $1 order by updated_at desc`,
      [this.workspaceId],
    );
    return result.rows.map(mapTask);
  }

  async getById(id: string): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>(
      `select * from tasks where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapTask(row) : null;
  }

  async create(entity: Task): Promise<Task> {
    await this.pool.query(
      `insert into tasks
       (id, workspace_id, title, brief, status, priority, assignee_agent_id, assignee_employee_id,
        team_id, project_id, due_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entity.id,
        entity.workspaceId,
        entity.title,
        entity.brief,
        entity.status,
        entity.priority,
        entity.assigneeAgentId,
        entity.assigneeEmployeeId,
        entity.teamId,
        entity.projectId,
        entity.dueAt,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Task): Promise<Task> {
    await this.pool.query(
      `update tasks set title = $1, brief = $2, status = $3, priority = $4,
       assignee_agent_id = $5, assignee_employee_id = $6, team_id = $7, project_id = $8,
       due_at = $9, updated_at = $10
       where id = $11 and workspace_id = $12`,
      [
        entity.title,
        entity.brief,
        entity.status,
        entity.priority,
        entity.assigneeAgentId,
        entity.assigneeEmployeeId,
        entity.teamId,
        entity.projectId,
        entity.dueAt,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from tasks where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresOperatorRepository implements OperatorRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async get(): Promise<OperatorProfile | null> {
    const result = await this.pool.query<OperatorRow>(
      `select * from operator_profiles where workspace_id = $1`,
      [this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapOperator(row) : null;
  }

  async upsert(profile: OperatorProfile): Promise<OperatorProfile> {
    await this.pool.query(
      `insert into operator_profiles (workspace_id, display_name, title, seats, created_at, updated_at)
       values ($1, $2, $3, $4::text[], $5, $6)
       on conflict (workspace_id) do update set
         display_name = excluded.display_name,
         title = excluded.title,
         seats = excluded.seats,
         updated_at = excluded.updated_at`,
      [
        profile.workspaceId,
        profile.displayName,
        // Older schemas had title NOT NULL — empty string maps back to null in mapOperator.
        profile.title ?? "",
        profile.seats ?? [],
        profile.createdAt,
        profile.updatedAt,
      ],
    );
    return {
      ...profile,
      seats: profile.seats ?? [],
      title: profile.title && profile.title.trim().length > 0 ? profile.title : null,
    };
  }
}

class PostgresCompanionStateRepository implements CompanionStateRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async get(): Promise<{ updatedAt: string; state: unknown } | null> {
    const result = await this.pool.query<{ updated_at: Date | string; state: unknown }>(
      `select updated_at, state from companion_states where workspace_id = $1`,
      [this.workspaceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const updatedAt =
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
    return { updatedAt, state: row.state };
  }

  async upsert(doc: {
    updatedAt: string;
    state: unknown;
  }): Promise<{ updatedAt: string; state: unknown }> {
    await this.pool.query(
      `insert into companion_states (workspace_id, updated_at, state)
       values ($1, $2, $3::jsonb)
       on conflict (workspace_id) do update set
         updated_at = excluded.updated_at,
         state = excluded.state`,
      [this.workspaceId, doc.updatedAt, JSON.stringify(doc.state ?? {})],
    );
    return doc;
  }
}

type AccountRow = {
  workspace_id: string;
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  plan_id: SubscriptionPlanId;
  subscription_status: SubscriptionStatus;
  period_start: Date;
  period_end: Date;
  session_token_hash: string | null;
  connected_at: Date;
  created_at: Date;
  updated_at: Date;
};

function mapAccount(row: AccountRow): StudioAccountRecord {
  return {
    id: brandId(row.id),
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    planId: row.plan_id,
    subscriptionStatus: row.subscription_status,
    periodStart: iso(row.period_start),
    periodEnd: iso(row.period_end),
    sessionTokenHash: row.session_token_hash,
    connectedAt: iso(row.connected_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

class PostgresAccountRepository implements AccountRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async get(): Promise<StudioAccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `select * from studio_accounts where workspace_id = $1`,
      [this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapAccount(row) : null;
  }

  async upsert(account: StudioAccountRecord): Promise<StudioAccountRecord> {
    await this.pool.query(
      `insert into studio_accounts (
         workspace_id, id, email, display_name, password_hash, plan_id, subscription_status,
         period_start, period_end, session_token_hash, connected_at, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (workspace_id) do update set
         id = excluded.id,
         email = excluded.email,
         display_name = excluded.display_name,
         password_hash = excluded.password_hash,
         plan_id = excluded.plan_id,
         subscription_status = excluded.subscription_status,
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         session_token_hash = excluded.session_token_hash,
         connected_at = excluded.connected_at,
         updated_at = excluded.updated_at`,
      [
        account.workspaceId,
        account.id,
        account.email,
        account.displayName,
        account.passwordHash,
        account.planId,
        account.subscriptionStatus,
        account.periodStart,
        account.periodEnd,
        account.sessionTokenHash,
        account.connectedAt,
        account.createdAt,
        account.updatedAt,
      ],
    );
    return account;
  }

  async delete(): Promise<void> {
    await this.pool.query(`delete from studio_accounts where workspace_id = $1`, [
      this.workspaceId,
    ]);
  }
}

class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Knowledge[]> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      title: string;
      content: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from knowledge_docs where workspace_id = $1 order by updated_at desc`, [
      this.workspaceId,
    ]);
    return result.rows.map((row) => ({
      id: brandId<KnowledgeId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
      title: row.title,
      content: row.content,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async listByProject(projectId: string | null): Promise<Knowledge[]> {
    const all = await this.list();
    if (!projectId) return all.filter((item) => item.projectId === null);
    return all.filter((item) => item.projectId === projectId || item.projectId === null);
  }

  async getById(id: string): Promise<Knowledge | null> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      title: string;
      content: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from knowledge_docs where id = $1 and workspace_id = $2`, [id, this.workspaceId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: brandId<KnowledgeId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
      title: row.title,
      content: row.content,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async create(entity: Knowledge): Promise<Knowledge> {
    await this.pool.query(
      `insert into knowledge_docs (id, workspace_id, project_id, title, content, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.projectId,
        entity.title,
        entity.content,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Knowledge): Promise<Knowledge> {
    await this.pool.query(
      `update knowledge_docs set project_id = $1, title = $2, content = $3, updated_at = $4
       where id = $5 and workspace_id = $6`,
      [
        entity.projectId,
        entity.title,
        entity.content,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from knowledge_docs where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresMemoryNotesRepository implements MemoryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Memory[]> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      agent_id: string | null;
      project_id: string | null;
      content: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from memories where workspace_id = $1 order by updated_at desc`, [
      this.workspaceId,
    ]);
    return result.rows.map((row) => ({
      id: brandId<MemoryId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
      projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
      content: row.content,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async listByAgent(agentId: string): Promise<Memory[]> {
    return (await this.list()).filter((item) => item.agentId === agentId);
  }

  async getById(id: string): Promise<Memory | null> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      agent_id: string | null;
      project_id: string | null;
      content: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from memories where id = $1 and workspace_id = $2`, [id, this.workspaceId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: brandId<MemoryId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
      projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
      content: row.content,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async create(entity: Memory): Promise<Memory> {
    await this.pool.query(
      `insert into memories (id, workspace_id, agent_id, project_id, content, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.agentId,
        entity.projectId,
        entity.content,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Memory): Promise<Memory> {
    await this.pool.query(
      `update memories set agent_id = $1, project_id = $2, content = $3, updated_at = $4
       where id = $5 and workspace_id = $6`,
      [
        entity.agentId,
        entity.projectId,
        entity.content,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from memories where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresTaskRunRepository implements TaskRunRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<TaskRun[]> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      task_id: string;
      agent_id: string;
      conversation_id: string | null;
      status: TaskRunStatus;
      summary: string | null;
      created_at: Date;
    }>(`select * from task_runs where workspace_id = $1 order by created_at desc`, [
      this.workspaceId,
    ]);
    return result.rows.map((row) => ({
      id: brandId<TaskRunId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      taskId: brandId<TaskId>(row.task_id),
      agentId: brandId<AgentId>(row.agent_id),
      conversationId: row.conversation_id
        ? brandId<ConversationId>(row.conversation_id)
        : null,
      status: row.status,
      summary: row.summary,
      createdAt: iso(row.created_at),
    }));
  }

  async listByTask(taskId: string): Promise<TaskRun[]> {
    return (await this.list()).filter((item) => item.taskId === taskId);
  }

  async create(run: TaskRun): Promise<TaskRun> {
    await this.pool.query(
      `insert into task_runs
       (id, workspace_id, task_id, agent_id, conversation_id, status, summary, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        run.id,
        run.workspaceId,
        run.taskId,
        run.agentId,
        run.conversationId,
        run.status,
        run.summary,
        run.createdAt,
      ],
    );
    return run;
  }
}

class PostgresSkillRepository implements SkillRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<Skill[]> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      agent_id: string;
      title: string;
      instructions: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from skills where workspace_id = $1 order by updated_at desc`, [
      this.workspaceId,
    ]);
    return result.rows.map((row) => ({
      id: brandId<SkillId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      agentId: brandId<AgentId>(row.agent_id),
      title: row.title,
      instructions: row.instructions,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async listByAgent(agentId: string): Promise<Skill[]> {
    return (await this.list()).filter((item) => item.agentId === agentId);
  }

  async getById(id: string): Promise<Skill | null> {
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      agent_id: string;
      title: string;
      instructions: string;
      created_at: Date;
      updated_at: Date;
    }>(`select * from skills where id = $1 and workspace_id = $2`, [id, this.workspaceId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: brandId<SkillId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      agentId: brandId<AgentId>(row.agent_id),
      title: row.title,
      instructions: row.instructions,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async create(entity: Skill): Promise<Skill> {
    await this.pool.query(
      `insert into skills (id, workspace_id, agent_id, title, instructions, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.agentId,
        entity.title,
        entity.instructions,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: Skill): Promise<Skill> {
    await this.pool.query(
      `update skills set title = $1, instructions = $2, updated_at = $3
       where id = $4 and workspace_id = $5`,
      [entity.title, entity.instructions, entity.updatedAt, entity.id, this.workspaceId],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from skills where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  private map(row: {
    id: string;
    workspace_id: string;
    kind: Approval["kind"];
    status: Approval["status"];
    title: string;
    detail: string | null;
    agent_id: string | null;
    task_id: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }): Approval {
    return {
      id: brandId<ApprovalId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      kind: row.kind,
      status: row.status,
      title: row.title,
      detail: row.detail,
      agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
      taskId: row.task_id ? brandId<TaskId>(row.task_id) : null,
      createdAt: iso(row.created_at),
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    };
  }

  async list(): Promise<Approval[]> {
    const result = await this.pool.query(
      `select * from approvals where workspace_id = $1 order by created_at desc`,
      [this.workspaceId],
    );
    return result.rows.map((row) => this.map(row as Parameters<PostgresApprovalRepository["map"]>[0]));
  }

  async listPending(): Promise<Approval[]> {
    return (await this.list()).filter((item) => item.status === "pending");
  }

  async getById(id: string): Promise<Approval | null> {
    const result = await this.pool.query(
      `select * from approvals where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? this.map(row as Parameters<PostgresApprovalRepository["map"]>[0]) : null;
  }

  async create(approval: Approval): Promise<Approval> {
    await this.pool.query(
      `insert into approvals (id, workspace_id, kind, status, title, detail, agent_id, task_id, created_at, resolved_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        approval.id,
        approval.workspaceId,
        approval.kind,
        approval.status,
        approval.title,
        approval.detail,
        approval.agentId,
        approval.taskId,
        approval.createdAt,
        approval.resolvedAt,
      ],
    );
    return approval;
  }

  async update(approval: Approval): Promise<Approval> {
    await this.pool.query(
      `update approvals set status = $1, resolved_at = $2
       where id = $3 and workspace_id = $4`,
      [approval.status, approval.resolvedAt, approval.id, this.workspaceId],
    );
    return approval;
  }
}

class PostgresGoalRepository implements GoalRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  private map(row: {
    id: string;
    workspace_id: string;
    agent_id: string | null;
    conversation_id: string | null;
    project_id: string | null;
    team_id: string | null;
    title: string;
    detail: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }): Goal {
    return {
      id: brandId<GoalId>(row.id),
      workspaceId: brandId<WorkspaceId>(row.workspace_id),
      agentId: row.agent_id ? brandId<AgentId>(row.agent_id) : null,
      conversationId: row.conversation_id
        ? brandId<ConversationId>(row.conversation_id)
        : null,
      projectId: row.project_id ? brandId<ProjectId>(row.project_id) : null,
      teamId: row.team_id ? brandId<TeamId>(row.team_id) : null,
      title: row.title,
      detail: row.detail,
      status: row.status as GoalStatus,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async list(): Promise<Goal[]> {
    return this.listByWorkspace();
  }

  async listByWorkspace(): Promise<Goal[]> {
    const result = await this.pool.query(
      `select * from goals where workspace_id = $1 order by updated_at desc`,
      [this.workspaceId],
    );
    return result.rows.map((row) => this.map(row as Parameters<PostgresGoalRepository["map"]>[0]));
  }

  async listActiveByAgent(agentId: string): Promise<Goal[]> {
    const result = await this.pool.query(
      `select * from goals
       where workspace_id = $1 and agent_id = $2 and status = 'active'
       order by updated_at desc`,
      [this.workspaceId, agentId],
    );
    return result.rows.map((row) => this.map(row as Parameters<PostgresGoalRepository["map"]>[0]));
  }

  async getById(id: string): Promise<Goal | null> {
    const result = await this.pool.query(
      `select * from goals where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? this.map(row as Parameters<PostgresGoalRepository["map"]>[0]) : null;
  }

  async create(goal: Goal): Promise<Goal> {
    await this.pool.query(
      `insert into goals
       (id, workspace_id, agent_id, conversation_id, project_id, team_id, title, detail, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        goal.id,
        goal.workspaceId,
        goal.agentId,
        goal.conversationId,
        goal.projectId,
        goal.teamId,
        goal.title,
        goal.detail,
        goal.status,
        goal.createdAt,
        goal.updatedAt,
      ],
    );
    return goal;
  }

  async update(goal: Goal): Promise<Goal> {
    await this.pool.query(
      `update goals set
         title = $1, detail = $2, status = $3, conversation_id = $4,
         agent_id = $5, project_id = $6, team_id = $7, updated_at = $8
       where id = $9 and workspace_id = $10`,
      [
        goal.title,
        goal.detail,
        goal.status,
        goal.conversationId,
        goal.agentId,
        goal.projectId,
        goal.teamId,
        goal.updatedAt,
        goal.id,
        this.workspaceId,
      ],
    );
    return goal;
  }
}

async function ensureLocalWorkspace(pool: Pool, now: string): Promise<WorkspaceContext> {
  await pool.query(
    `insert into organizations (id, name, created_at, updated_at)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [LOCAL_ORGANIZATION_ID, "Local Studio", now, now],
  );
  await pool.query(
    `insert into workspaces (id, organization_id, name, slug, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do nothing`,
    [LOCAL_WORKSPACE_ID, LOCAL_ORGANIZATION_ID, "Local studio", "local", now, now],
  );

  const org = await pool.query<{
    id: string;
    name: string;
    created_at: Date;
    updated_at: Date;
  }>(`select * from organizations where id = $1`, [LOCAL_ORGANIZATION_ID]);
  const ws = await pool.query<{
    id: string;
    organization_id: string;
    name: string;
    slug: string;
    created_at: Date;
    updated_at: Date;
  }>(`select * from workspaces where id = $1`, [LOCAL_WORKSPACE_ID]);

  const organizationRow = org.rows[0];
  const workspaceRow = ws.rows[0];
  if (!organizationRow || !workspaceRow) {
    throw new Error("Failed to bootstrap local workspace");
  }

  const organization: Organization = {
    id: brandId<OrganizationId>(organizationRow.id),
    name: organizationRow.name,
    createdAt: iso(organizationRow.created_at),
    updatedAt: iso(organizationRow.updated_at),
  };
  const workspace: Workspace = {
    id: brandId<WorkspaceId>(workspaceRow.id),
    organizationId: brandId<OrganizationId>(workspaceRow.organization_id),
    name: workspaceRow.name,
    slug: workspaceRow.slug,
    createdAt: iso(workspaceRow.created_at),
    updatedAt: iso(workspaceRow.updated_at),
  };
  return { organization, workspace };
}

export async function createPostgresPersistence(pool: Pool): Promise<Persistence> {
  const now = new Date().toISOString();
  const context = await ensureLocalWorkspace(pool, now);
  return {
    kind: "postgres",
    workspaceId: context.workspace.id,
    getWorkspace: async () => context,
    projects: new PostgresProjectRepository(pool, context.workspace.id),
    agents: new PostgresAgentRepository(pool, context.workspace.id),
    teams: new PostgresTeamRepository(pool, context.workspace.id),
    conversations: new PostgresConversationRepository(pool, context.workspace.id),
    messages: new PostgresMessageRepository(pool),
    activity: new PostgresActivityRepository(pool, context.workspace.id),
    memberships: new PostgresMembershipRepository(pool),
    connectors: new PostgresConnectorRepository(pool, context.workspace.id),
    bindings: new PostgresBindingRepository(pool),
    usage: new PostgresUsageRepository(pool, context.workspace.id),
    tasks: new PostgresTaskRepository(pool, context.workspace.id),
    operator: new PostgresOperatorRepository(pool, context.workspace.id),
    companionState: new PostgresCompanionStateRepository(pool, context.workspace.id),
    accounts: new PostgresAccountRepository(pool, context.workspace.id),
    knowledge: new PostgresKnowledgeRepository(pool, context.workspace.id),
    memories: new PostgresMemoryNotesRepository(pool, context.workspace.id),
    taskRuns: new PostgresTaskRunRepository(pool, context.workspace.id),
    skills: new PostgresSkillRepository(pool, context.workspace.id),
    approvals: new PostgresApprovalRepository(pool, context.workspace.id),
    goals: new PostgresGoalRepository(pool, context.workspace.id),
    orgDepartments: new PostgresOrgDepartmentRepository(pool, context.workspace.id),
    orgEmployees: new PostgresOrgEmployeeRepository(pool, context.workspace.id),
    orgSecurityEvents: new PostgresOrgSecurityEventRepository(pool, context.workspace.id),
    familyMembers: new PostgresFamilyMemberRepository(pool, context.workspace.id),
    familyGuidance: new PostgresFamilyGuidanceRepository(pool, context.workspace.id),
    familyHouseholdMeta: new PostgresFamilyHouseholdMetaRepository(pool, context.workspace.id),
  };
}

class PostgresOrgDepartmentRepository implements OrgDepartmentRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<OrgDepartment[]> {
    const result = await this.pool.query(
      `select * from org_departments where workspace_id = $1 order by name asc`,
      [this.workspaceId],
    );
    return result.rows.map(mapOrgDepartment);
  }

  async getById(id: string): Promise<OrgDepartment | null> {
    const result = await this.pool.query(
      `select * from org_departments where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapOrgDepartment(row) : null;
  }

  async create(entity: OrgDepartment): Promise<OrgDepartment> {
    await this.pool.query(
      `insert into org_departments
       (id, workspace_id, name, description, team_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id,
        entity.workspaceId,
        entity.name,
        entity.description,
        entity.teamId,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: OrgDepartment): Promise<OrgDepartment> {
    await this.pool.query(
      `update org_departments
       set name = $1, description = $2, team_id = $3, updated_at = $4
       where id = $5 and workspace_id = $6`,
      [
        entity.name,
        entity.description,
        entity.teamId,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from org_departments where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

class PostgresOrgEmployeeRepository implements OrgEmployeeRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<OrgEmployeeRecord[]> {
    const result = await this.pool.query(
      `select * from org_employees where workspace_id = $1 order by display_name asc`,
      [this.workspaceId],
    );
    return result.rows.map(mapOrgEmployee);
  }

  async getById(id: string): Promise<OrgEmployeeRecord | null> {
    const result = await this.pool.query(
      `select * from org_employees where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapOrgEmployee(row) : null;
  }

  async getByEmail(email: string): Promise<OrgEmployeeRecord | null> {
    const result = await this.pool.query(
      `select * from org_employees where workspace_id = $1 and lower(email) = lower($2)`,
      [this.workspaceId, email],
    );
    const row = result.rows[0];
    return row ? mapOrgEmployee(row) : null;
  }

  async getBySessionHash(hash: string): Promise<OrgEmployeeRecord | null> {
    const result = await this.pool.query(
      `select * from org_employees where workspace_id = $1 and session_token_hash = $2`,
      [this.workspaceId, hash],
    );
    const row = result.rows[0];
    return row ? mapOrgEmployee(row) : null;
  }

  async create(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord> {
    await this.pool.query(
      `insert into org_employees
       (id, workspace_id, department_id, email, display_name, title, role, status,
        password_hash, session_token_hash, session_expires_at, failed_login_count,
        locked_until, password_changed_at, must_change_password, last_login_at,
        created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        entity.id,
        entity.workspaceId,
        entity.departmentId,
        entity.email,
        entity.displayName,
        entity.title,
        entity.role,
        entity.status,
        entity.passwordHash,
        entity.sessionTokenHash,
        entity.sessionExpiresAt,
        entity.failedLoginCount,
        entity.lockedUntil,
        entity.passwordChangedAt,
        entity.mustChangePassword,
        entity.lastLoginAt,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord> {
    await this.pool.query(
      `update org_employees set
         department_id = $1, email = $2, display_name = $3, title = $4, role = $5, status = $6,
         password_hash = $7, session_token_hash = $8, session_expires_at = $9,
         failed_login_count = $10, locked_until = $11, password_changed_at = $12,
         must_change_password = $13, last_login_at = $14, updated_at = $15
       where id = $16 and workspace_id = $17`,
      [
        entity.departmentId,
        entity.email,
        entity.displayName,
        entity.title,
        entity.role,
        entity.status,
        entity.passwordHash,
        entity.sessionTokenHash,
        entity.sessionExpiresAt,
        entity.failedLoginCount,
        entity.lockedUntil,
        entity.passwordChangedAt,
        entity.mustChangePassword,
        entity.lastLoginAt,
        entity.updatedAt,
        entity.id,
        entity.workspaceId,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from org_employees where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

function mapOrgDepartment(row: {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  team_id: string | null;
  created_at: Date;
  updated_at: Date;
}): OrgDepartment {
  return {
    id: brandId<OrgDepartmentId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    name: row.name,
    description: row.description,
    teamId: row.team_id ? brandId<TeamId>(row.team_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapOrgEmployee(row: {
  id: string;
  workspace_id: string;
  department_id: string | null;
  email: string;
  display_name: string;
  title: string | null;
  role: OrgEmployeeRecord["role"];
  status: OrgEmployeeRecord["status"];
  password_hash: string;
  session_token_hash: string | null;
  session_expires_at?: Date | null;
  failed_login_count?: number | null;
  locked_until?: Date | null;
  password_changed_at?: Date | null;
  must_change_password?: boolean | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): OrgEmployeeRecord {
  return {
    id: brandId<OrgEmployeeId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    departmentId: row.department_id ? brandId<OrgDepartmentId>(row.department_id) : null,
    email: row.email,
    displayName: row.display_name,
    title: row.title,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    sessionTokenHash: row.session_token_hash,
    sessionExpiresAt: row.session_expires_at ? iso(row.session_expires_at) : null,
    failedLoginCount: Number(row.failed_login_count ?? 0),
    lockedUntil: row.locked_until ? iso(row.locked_until) : null,
    passwordChangedAt: row.password_changed_at ? iso(row.password_changed_at) : null,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at ? iso(row.last_login_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

class PostgresOrgSecurityEventRepository implements OrgSecurityEventRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async listRecent(limit = 50): Promise<OrgSecurityEvent[]> {
    const result = await this.pool.query(
      `select * from org_security_events
       where workspace_id = $1
       order by created_at desc
       limit $2`,
      [this.workspaceId, Math.min(200, Math.max(1, limit))],
    );
    return result.rows.map(mapOrgSecurityEvent);
  }

  async append(event: OrgSecurityEvent): Promise<OrgSecurityEvent> {
    await this.pool.query(
      `insert into org_security_events
       (id, workspace_id, kind, actor_employee_id, target_employee_id, detail, ip_hash, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.id,
        event.workspaceId,
        event.kind,
        event.actorEmployeeId,
        event.targetEmployeeId,
        event.detail,
        event.ipHash,
        event.createdAt,
      ],
    );
    return event;
  }
}

function mapOrgSecurityEvent(row: {
  id: string;
  workspace_id: string;
  kind: OrgSecurityEvent["kind"];
  actor_employee_id: string | null;
  target_employee_id: string | null;
  detail: string;
  ip_hash: string | null;
  created_at: Date;
}): OrgSecurityEvent {
  return {
    id: row.id,
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    kind: row.kind,
    actorEmployeeId: row.actor_employee_id,
    targetEmployeeId: row.target_employee_id,
    detail: row.detail,
    ipHash: row.ip_hash,
    createdAt: iso(row.created_at),
  };
}

class PostgresFamilyMemberRepository implements FamilyMemberRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async list(): Promise<FamilyMemberRecord[]> {
    const result = await this.pool.query(
      `select * from family_members
       where workspace_id = $1
       order by is_owner desc, display_name asc`,
      [this.workspaceId],
    );
    return result.rows.map(mapFamilyMember);
  }

  async getById(id: string): Promise<FamilyMemberRecord | null> {
    const result = await this.pool.query(
      `select * from family_members where id = $1 and workspace_id = $2`,
      [id, this.workspaceId],
    );
    const row = result.rows[0];
    return row ? mapFamilyMember(row) : null;
  }

  async create(entity: FamilyMemberRecord): Promise<FamilyMemberRecord> {
    await this.pool.query(
      `insert into family_members
       (id, workspace_id, display_name, role, age_tier, color, pin_hash, is_owner, is_paused, token_allowance, tokens_used, last_active_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        entity.id,
        entity.workspaceId,
        entity.displayName,
        entity.role,
        entity.ageTier,
        entity.color,
        entity.pinHash,
        entity.isOwner,
        entity.isPaused,
        entity.tokenAllowance,
        entity.tokensUsed,
        entity.lastActiveAt,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async update(entity: FamilyMemberRecord): Promise<FamilyMemberRecord> {
    await this.pool.query(
      `update family_members set
         display_name = $3,
         role = $4,
         age_tier = $5,
         color = $6,
         pin_hash = $7,
         is_owner = $8,
         is_paused = $9,
         token_allowance = $10,
         tokens_used = $11,
         last_active_at = $12,
         updated_at = $13
       where id = $1 and workspace_id = $2`,
      [
        entity.id,
        entity.workspaceId,
        entity.displayName,
        entity.role,
        entity.ageTier,
        entity.color,
        entity.pinHash,
        entity.isOwner,
        entity.isPaused,
        entity.tokenAllowance,
        entity.tokensUsed,
        entity.lastActiveAt,
        entity.updatedAt,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from family_members where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

function mapFamilyMember(row: {
  id: string;
  workspace_id: string;
  display_name: string;
  role: FamilyMemberRole;
  age_tier: FamilyAgeTier | null;
  color: string;
  pin_hash: string | null;
  is_owner: boolean;
  is_paused: boolean;
  token_allowance?: number | null;
  tokens_used?: number | null;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): FamilyMemberRecord {
  return {
    id: brandId<FamilyMemberId>(row.id),
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    displayName: row.display_name,
    role: row.role,
    ageTier: row.age_tier,
    color: row.color,
    pinHash: row.pin_hash,
    isOwner: row.is_owner,
    isPaused: row.is_paused,
    tokenAllowance: row.token_allowance ?? 0,
    tokensUsed: row.tokens_used ?? 0,
    lastActiveAt: row.last_active_at ? iso(row.last_active_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

class PostgresFamilyGuidanceRepository implements FamilyGuidanceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async listRecent(limit = 40): Promise<FamilyGuidanceRecord[]> {
    const result = await this.pool.query(
      `select * from family_guidance where workspace_id = $1 order by created_at desc limit $2`,
      [this.workspaceId, Math.min(100, Math.max(1, limit))],
    );
    return result.rows.map(mapFamilyGuidance);
  }

  async listByCompanion(companionId: string): Promise<FamilyGuidanceRecord[]> {
    const result = await this.pool.query(
      `select * from family_guidance
       where workspace_id = $1 and companion_id = $2
       order by created_at desc`,
      [this.workspaceId, companionId],
    );
    return result.rows.map(mapFamilyGuidance);
  }

  async create(entity: FamilyGuidanceRecord): Promise<FamilyGuidanceRecord> {
    await this.pool.query(
      `insert into family_guidance
       (id, workspace_id, companion_id, child_member_id, author_member_id, author_name, content, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entity.id,
        entity.workspaceId,
        entity.companionId,
        entity.childMemberId,
        entity.authorMemberId,
        entity.authorName,
        entity.content,
        entity.createdAt,
      ],
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`delete from family_guidance where id = $1 and workspace_id = $2`, [
      id,
      this.workspaceId,
    ]);
  }
}

function mapFamilyGuidance(row: {
  id: string;
  workspace_id: string;
  companion_id: string;
  child_member_id: string;
  author_member_id: string;
  author_name: string;
  content: string;
  created_at: Date;
}): FamilyGuidanceRecord {
  return {
    id: row.id,
    workspaceId: brandId<WorkspaceId>(row.workspace_id),
    companionId: row.companion_id,
    childMemberId: brandId<FamilyMemberId>(row.child_member_id),
    authorMemberId: brandId<FamilyMemberId>(row.author_member_id),
    authorName: row.author_name,
    content: row.content,
    createdAt: iso(row.created_at),
  };
}

class PostgresFamilyHouseholdMetaRepository implements FamilyHouseholdMetaRepository {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  async getExtraSeats(): Promise<number> {
    const result = await this.pool.query(
      `select extra_seats from family_household where workspace_id = $1`,
      [this.workspaceId],
    );
    return Number(result.rows[0]?.extra_seats ?? 0);
  }

  async setExtraSeats(seats: number): Promise<number> {
    const next = Math.max(0, Math.floor(seats));
    const now = new Date().toISOString();
    await this.pool.query(
      `insert into family_household (workspace_id, extra_seats, active_member_id, updated_at)
       values ($1, $2, null, $3)
       on conflict (workspace_id) do update set extra_seats = $2, updated_at = $3`,
      [this.workspaceId, next, now],
    );
    return next;
  }

  async getActiveMemberId(): Promise<string | null> {
    const result = await this.pool.query(
      `select active_member_id from family_household where workspace_id = $1`,
      [this.workspaceId],
    );
    const value = result.rows[0]?.active_member_id;
    return typeof value === "string" && value ? value : null;
  }

  async setActiveMemberId(id: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `insert into family_household (workspace_id, extra_seats, active_member_id, updated_at)
       values ($1, 0, $2, $3)
       on conflict (workspace_id) do update set active_member_id = $2, updated_at = $3`,
      [this.workspaceId, id, now],
    );
  }
}
