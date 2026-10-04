import type { Pool } from "pg";
import type {
  ErpCompanion,
  ControlNotification,
  ControlClient,
  ControlConnector,
  ControlMaintenance,
  CompanionDeskState,
  SpacesDocument,
} from "@arrab/shared";
import type {
  Activity,
  Agent,
  Approval,
  ConnectorSecretRecord,
  Conversation,
  Knowledge,
  Memory,
  Message,
  Goal,
  OperatorProfile,
  Organization,
  Project,
  ProjectRepoBinding,
  Skill,
  Task,
  TaskRun,
  Team,
  TeamMembership,
  UsageEvent,
  Workspace,
  WorkspaceId,
  StudioAccountRecord,
  OrgDepartment,
  OrgEmployeeRecord,
  OrgSecurityEvent,
  FamilyMemberRecord,
  FamilyGuidanceRecord,
} from "@arrab/shared";
import type {
  OrgDepartmentRepository,
  OrgEmployeeRepository,
  OrgSecurityEventRepository,
} from "./org-workforce-repos.js";
import type {
  FamilyGuidanceRepository,
  FamilyHouseholdMetaRepository,
  FamilyMemberRepository,
} from "./family-repos.js";

export interface DatabaseConfig {
  connectionString: string;
}

export interface DatabaseConnection {
  ping(): Promise<boolean>;
  close(): Promise<void>;
  pool: Pool;
}

export interface EntityRepository<T> {
  list(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(entity: T): Promise<T>;
}

export interface AgentRepository extends EntityRepository<Agent> {
  delete(id: string): Promise<void>;
}

export interface ActivityRepository {
  list(): Promise<Activity[]>;
  append(entry: Activity): Promise<Activity>;
}

export interface ConversationRepository extends EntityRepository<Conversation> {
  listByAgent(agentId: string): Promise<Conversation[]>;
  listByTeam(teamId: string): Promise<Conversation[]>;
  delete(id: string): Promise<void>;
}

export interface MessageRepository {
  listByConversation(conversationId: string): Promise<Message[]>;
  create(message: Message): Promise<Message>;
  deleteByConversation(conversationId: string): Promise<void>;
}

export interface GoalRepository extends EntityRepository<Goal> {
  listActiveByAgent(agentId: string): Promise<Goal[]>;
  listByWorkspace(): Promise<Goal[]>;
}

export interface TeamMembershipRepository {
  list(): Promise<TeamMembership[]>;
  listByTeam(teamId: string): Promise<TeamMembership[]>;
  add(membership: TeamMembership): Promise<TeamMembership>;
  remove(teamId: string, agentId: string): Promise<void>;
}

export interface ConnectorRepository {
  list(): Promise<ConnectorSecretRecord[]>;
  getById(id: string): Promise<ConnectorSecretRecord | null>;
  create(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord>;
  update(record: ConnectorSecretRecord): Promise<ConnectorSecretRecord>;
  delete(id: string): Promise<void>;
}

export interface ProjectRepoBindingRepository {
  list(): Promise<ProjectRepoBinding[]>;
  getByProject(projectId: string): Promise<ProjectRepoBinding | null>;
  upsert(binding: ProjectRepoBinding): Promise<ProjectRepoBinding>;
  deleteByProject(projectId: string): Promise<void>;
}

export interface UsageRepository {
  append(event: UsageEvent): Promise<UsageEvent>;
  listRecent(limit: number): Promise<UsageEvent[]>;
  listAll(): Promise<UsageEvent[]>;
  listByConversation(conversationId: string): Promise<UsageEvent[]>;
}

export interface TaskRepository extends EntityRepository<Task> {
  delete(id: string): Promise<void>;
}

export interface OperatorRepository {
  get(): Promise<OperatorProfile | null>;
  upsert(profile: OperatorProfile): Promise<OperatorProfile>;
}

/** Cloud-synced Individuals companion roster + chat pointers (JSON document). */
export interface CompanionStateRepository {
  get(): Promise<{ updatedAt: string; state: unknown } | null>;
  upsert(doc: { updatedAt: string; state: unknown }): Promise<{ updatedAt: string; state: unknown }>;
}

export interface AccountRepository {
  /** Primary operator for the workspace (legacy single-account callers). */
  get(): Promise<StudioAccountRecord | null>;
  getById(id: string): Promise<StudioAccountRecord | null>;
  getByEmail(email: string): Promise<StudioAccountRecord | null>;
  /** Account that owns this hashed session token (device session or legacy hash). */
  findBySessionTokenHash(tokenHash: string): Promise<StudioAccountRecord | null>;
  list(): Promise<StudioAccountRecord[]>;
  upsert(account: StudioAccountRecord): Promise<StudioAccountRecord>;
  /** Remove every account in the workspace (destructive reset). */
  delete(): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export interface KnowledgeRepository extends EntityRepository<Knowledge> {
  delete(id: string): Promise<void>;
  listByProject(projectId: string | null): Promise<Knowledge[]>;
}

export interface MemoryRepository extends EntityRepository<Memory> {
  delete(id: string): Promise<void>;
  listByAgent(agentId: string): Promise<Memory[]>;
}

export interface TaskRunRepository {
  list(): Promise<TaskRun[]>;
  listByTask(taskId: string): Promise<TaskRun[]>;
  getById(id: string): Promise<TaskRun | null>;
  create(run: TaskRun): Promise<TaskRun>;
  update(run: TaskRun): Promise<TaskRun>;
}

export interface SkillRepository extends EntityRepository<Skill> {
  delete(id: string): Promise<void>;
  listByAgent(agentId: string): Promise<Skill[]>;
}

export interface ApprovalRepository {
  list(): Promise<Approval[]>;
  listPending(): Promise<Approval[]>;
  getById(id: string): Promise<Approval | null>;
  create(approval: Approval): Promise<Approval>;
  update(approval: Approval): Promise<Approval>;
}

export interface WorkspaceContext {
  organization: Organization;
  workspace: Workspace;
}

export type PersistenceKind = "memory" | "file" | "postgres";

export interface ErpCompanionRepository {
  list(): Promise<ErpCompanion[]>;
  getById(id: string): Promise<ErpCompanion | null>;
  getByExternalId(externalId: string): Promise<ErpCompanion | null>;
  insert(item: ErpCompanion): Promise<ErpCompanion>;
  replace(item: ErpCompanion): Promise<ErpCompanion | null>;
  delete(id: string): Promise<boolean>;
}

export interface ControlNotificationRepository {
  listRecent(limit: number): Promise<ControlNotification[]>;
  insert(item: ControlNotification): Promise<ControlNotification>;
  getById(id: string): Promise<ControlNotification | null>;
  replace(item: ControlNotification): Promise<ControlNotification | null>;
}

export interface CompanionDeskRepository {
  get(): Promise<CompanionDeskState>;
  save(state: CompanionDeskState): Promise<CompanionDeskState>;
}

export interface ProfessionalWorkspaceRepository {
  get(): Promise<import("@arrab/shared").ProfessionalWorkspaceState>;
  save(
    state: import("@arrab/shared").ProfessionalWorkspaceState,
  ): Promise<import("@arrab/shared").ProfessionalWorkspaceState>;
}

export interface DocumentSpacesRepository {
  get(): Promise<SpacesDocument>;
  save(state: SpacesDocument): Promise<SpacesDocument>;
}

export interface CrewRepository {
  get(): Promise<import("@arrab/shared").CrewState>;
  save(state: import("@arrab/shared").CrewState): Promise<import("@arrab/shared").CrewState>;
}

/** Opaque ciphertext store for the zero-knowledge chat vault, keyed per user. */
export interface SealedVaultRepository {
  getKey(ownerKey: string): Promise<import("@arrab/shared").WrappedChatKey | null>;
  putKey(ownerKey: string, key: import("@arrab/shared").WrappedChatKey): Promise<void>;
  listChats(ownerKey: string): Promise<import("@arrab/shared").SealedChat[]>;
  /** Last write wins by `updatedAt`; a tombstoned id older than the write is revived. */
  putChat(ownerKey: string, chat: import("@arrab/shared").SealedChat): Promise<void>;
  deleteChat(ownerKey: string, id: string, deletedAt: string): Promise<void>;
  listDeleted(ownerKey: string): Promise<Array<{ id: string; deletedAt: string }>>;
  /** Wipe the user's whole vault (key + chats + tombstones). */
  deleteAll(ownerKey: string): Promise<void>;
  /** Wipe every user's vault in this workspace (the account was removed or replaced). */
  purgeWorkspace(): Promise<void>;
}

/**
 * Revisioned records for cross-device sync (see `@arrab/shared` sync protocol).
 * Writes are compare-and-set on `rev`, so two devices can never silently overwrite each other.
 */
export interface SyncRecordRepository {
  get(ownerKey: string, kind: string, id: string): Promise<import("@arrab/shared").SyncRecord | null>;
  /**
   * Store `record` only if the stored revision is `expectedRev` (0 = must not exist).
   * Returns the stored record with its server sequence, or `null` if the revision moved.
   * `opId` makes the call idempotent: a repeat returns the record the first call produced.
   */
  compareAndSet(
    ownerKey: string,
    record: import("@arrab/shared").SyncRecord,
    expectedRev: number,
    opId: string,
  ): Promise<{ record: import("@arrab/shared").SyncRecord; seq: number } | null>;
  /** The record a previously applied op produced, if this op id was already seen. */
  getOpResult(ownerKey: string, opId: string): Promise<import("@arrab/shared").SyncRecord | null>;
  /** Records changed after `afterSeq`, oldest first. */
  listAfter(
    ownerKey: string,
    afterSeq: number,
    limit: number,
    kinds?: string[],
  ): Promise<Array<{ record: import("@arrab/shared").SyncRecord; seq: number }>>;
  purgeOwner(ownerKey: string): Promise<void>;
  purgeWorkspace(): Promise<void>;
}

export interface ControlDeskRepository {
  getPolicy(): Promise<ControlMaintenance | null>;
  setPolicy(policy: ControlMaintenance): Promise<ControlMaintenance>;
  upsertClient(client: ControlClient): Promise<ControlClient>;
  listClients(): Promise<ControlClient[]>;
  listConnectors(): Promise<ControlConnector[]>;
  upsertConnector(entry: ControlConnector): Promise<ControlConnector>;
  deleteConnector(provider: string): Promise<boolean>;
}

export interface Persistence {
  readonly kind: PersistenceKind;
  readonly workspaceId: WorkspaceId;
  getWorkspace(): Promise<WorkspaceContext>;
  projects: EntityRepository<Project>;
  agents: AgentRepository;
  teams: EntityRepository<Team>;
  conversations: ConversationRepository;
  messages: MessageRepository;
  activity: ActivityRepository;
  memberships: TeamMembershipRepository;
  connectors: ConnectorRepository;
  bindings: ProjectRepoBindingRepository;
  usage: UsageRepository;
  tasks: TaskRepository;
  operator: OperatorRepository;
  companionState: CompanionStateRepository;
  accounts: AccountRepository;
  knowledge: KnowledgeRepository;
  memories: MemoryRepository;
  taskRuns: TaskRunRepository;
  skills: SkillRepository;
  approvals: ApprovalRepository;
  goals: GoalRepository;
  orgDepartments: OrgDepartmentRepository;
  orgEmployees: OrgEmployeeRepository;
  orgSecurityEvents: OrgSecurityEventRepository;
  familyMembers: FamilyMemberRepository;
  familyGuidance: FamilyGuidanceRepository;
  familyHouseholdMeta: FamilyHouseholdMetaRepository;
  erpCompanions: ErpCompanionRepository;
  controlNotifications: ControlNotificationRepository;
  controlDesk: ControlDeskRepository;
  companionDesk: CompanionDeskRepository;
  professionalWorkspace: ProfessionalWorkspaceRepository;
  documentSpaces: DocumentSpacesRepository;
  crew: CrewRepository;
  sealedVault: SealedVaultRepository;
  syncRecords: SyncRecordRepository;
}

export const LOCAL_ORGANIZATION_ID = "org_local_studio";
export const LOCAL_WORKSPACE_ID = "ws_local_studio";
