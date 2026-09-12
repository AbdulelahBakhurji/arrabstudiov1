import type {
  ActivityId,
  AgentId,
  ApprovalId,
  ConversationId,
  GoalId,
  KnowledgeId,
  MemoryId,
  MessageId,
  ModelProviderId,
  OrganizationId,
  PermissionId,
  ProjectId,
  SkillId,
  TaskId,
  TaskRunId,
  TeamId,
  ToolId,
  UserId,
  WorkspaceId,
} from "./ids.js";

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface Organization extends Timestamps {
  id: OrganizationId;
  name: string;
}

export interface Workspace extends Timestamps {
  id: WorkspaceId;
  organizationId: OrganizationId;
  name: string;
  slug: string;
}

export interface User extends Timestamps {
  id: UserId;
  organizationId: OrganizationId;
  email: string;
  displayName: string;
}

export type ProjectStatus = "active" | "archived";

export interface Project extends Timestamps {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  description: string | null;
  status: ProjectStatus;
}

export type AgentStatus = "draft" | "active" | "paused" | "archived";

export interface Agent extends Timestamps {
  id: AgentId;
  workspaceId: WorkspaceId;
  projectId: ProjectId | null;
  name: string;
  role: string;
  /** Short specialty label (e.g. "Growth copy", "Backend SRE"). */
  specialty: string | null;
  /** Background / who this person is. */
  bio: string | null;
  /** Standing instructions — how they should work when anyone writes to them. */
  instructions: string | null;
  status: AgentStatus;
  modelProviderId: ModelProviderId | null;
}

export interface Team extends Timestamps {
  id: TeamId;
  workspaceId: WorkspaceId;
  projectId: ProjectId | null;
  name: string;
  purpose: string | null;
}

export interface TeamMembership {
  teamId: TeamId;
  agentId: AgentId;
  createdAt: string;
}

export type TokenSpendTier = "low" | "medium" | "high";

export interface Conversation extends Timestamps {
  id: ConversationId;
  workspaceId: WorkspaceId;
  projectId: ProjectId | null;
  agentId: AgentId | null;
  teamId: TeamId | null;
  title: string | null;
  /** How aggressively this session spends tokens. Default low. */
  spendTier: TokenSpendTier;
  /** Soft cap on input+output tokens for this conversation; null = no session cap. */
  sessionTokenBudget: number | null;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: MessageId;
  conversationId: ConversationId;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export type GoalStatus = "active" | "completed" | "cancelled";

export interface Goal extends Timestamps {
  id: GoalId;
  workspaceId: WorkspaceId;
  agentId: AgentId | null;
  conversationId: ConversationId | null;
  projectId: ProjectId | null;
  teamId: TeamId | null;
  title: string;
  detail: string | null;
  status: GoalStatus;
}

export interface Memory extends Timestamps {
  id: MemoryId;
  workspaceId: WorkspaceId;
  agentId: AgentId | null;
  projectId: ProjectId | null;
  content: string;
}

export interface Knowledge extends Timestamps {
  id: KnowledgeId;
  workspaceId: WorkspaceId;
  projectId: ProjectId | null;
  title: string;
  content: string;
}

export type TaskRunStatus = "completed" | "failed" | "needs_provider" | "awaiting_approval";

export interface TaskRun {
  id: TaskRunId;
  workspaceId: WorkspaceId;
  taskId: TaskId;
  agentId: AgentId;
  conversationId: ConversationId | null;
  status: TaskRunStatus;
  summary: string | null;
  createdAt: string;
}

export interface Skill extends Timestamps {
  id: SkillId;
  workspaceId: WorkspaceId;
  agentId: AgentId;
  title: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalKind = "activate_agent" | "run_task" | "git_push" | "call_tool";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: ApprovalId;
  workspaceId: WorkspaceId;
  kind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  detail: string | null;
  agentId: AgentId | null;
  taskId: TaskId | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** JSON payload stored in Approval.detail when kind === "call_tool". */
export interface CallToolApprovalDetail {
  conversationId: string;
  toolName: string;
  arguments: Record<string, string>;
}

export interface ToolDefinition extends Timestamps {
  id: ToolId;
  name: string;
  description: string;
}

export type PermissionPrincipalType = "user" | "agent" | "team";
export type PermissionAction = "read" | "write" | "execute" | "approve" | "admin";

export interface Permission {
  id: PermissionId;
  workspaceId: WorkspaceId;
  principalType: PermissionPrincipalType;
  principalId: string;
  resourceType: string;
  resourceId: string | null;
  action: PermissionAction;
  createdAt: string;
}

export type ActivityActorType = "user" | "agent" | "system";
export type ActivityVerb =
  | "created"
  | "updated"
  | "ran"
  | "completed"
  | "failed"
  | "approved"
  | "rejected";

export interface Activity {
  id: ActivityId;
  workspaceId: WorkspaceId;
  actorType: ActivityActorType;
  actorId: string | null;
  verb: ActivityVerb;
  objectType: string;
  objectId: string | null;
  summary: string;
  createdAt: string;
}

export type ModelProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "local"
  | "openai_compatible";

export interface ModelProvider {
  id: ModelProviderId;
  kind: ModelProviderKind;
  displayName: string;
  enabled: boolean;
}

export interface ProjectRepoBinding {
  projectId: ProjectId;
  connectorId: string;
  repoFullName: string;
  repoUrl: string | null;
  defaultBranch: string | null;
  boundAt: string;
}

export interface UsageEvent {
  id: string;
  workspaceId: WorkspaceId;
  conversationId: ConversationId | null;
  agentId: AgentId | null;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface ConnectorSecretRecord {
  id: string;
  workspaceId: WorkspaceId;
  provider: string;
  status: "connected" | "error";
  accountLabel: string | null;
  scopes: string[];
  connectedAt: string;
  lastVerifiedAt: string | null;
  error: string | null;
  secret: string;
}

export interface OperatorProfile extends Timestamps {
  workspaceId: WorkspaceId;
  displayName: string;
  /** Selected seat title; null until the operator creates and chooses one. */
  title: string | null;
  /** Seat titles the operator has created (e.g. CEO, Founder, Head of Product). */
  seats: string[];
}

export type TaskStatus = "backlog" | "assigned" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Task extends Timestamps {
  id: TaskId;
  workspaceId: WorkspaceId;
  title: string;
  brief: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeAgentId: AgentId | null;
  teamId: TeamId | null;
  projectId: ProjectId | null;
  dueAt: string | null;
}
