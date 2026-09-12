import type {
  Activity,
  Agent,
  Approval,
  ApprovalKind,
  Conversation,
  Message,
  OperatorProfile,
  Project,
  Task,
  TaskPriority,
  TaskRun,
  TaskStatus,
  Team,
  TokenSpendTier,
  Workspace,
} from "./entities.js";

export type { TokenSpendTier } from "./entities.js";

export const healthContractPath = "/health";
export const apiV1Prefix = "/v1";

export interface HealthResponse {
  status: "ok";
  service: "arrab-api";
  time: string;
}

export type PersistenceMode = "memory" | "file" | "postgres";

export interface ApiMetaResponse {
  name: "arrab-api";
  version: string;
  persistence: PersistenceMode;
  workspaceId: string;
  aiProviders: string[];
  account?: {
    connected: boolean;
    planId: string | null;
    tokenLimit: number | null;
    tokensUsed: number;
    tokensRemaining: number | null;
    overLimit: boolean;
  };
}

export interface CollectionResponse<T> {
  items: T[];
}

export interface DashboardResponse {
  workspace: Workspace;
  projects: Project[];
  agents: Agent[];
  teams: Team[];
  activity: Activity[];
  conversations: Conversation[];
}

export interface AiGatewayStatusResponse {
  configured: boolean;
  providers: string[];
  defaultModel: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  status?: "active" | "archived";
}

export interface CreateAgentRequest {
  name: string;
  role: string;
  specialty?: string | null;
  bio?: string | null;
  instructions?: string | null;
  projectId?: string | null;
  status?: "draft" | "active" | "paused" | "archived";
  /** Optional starter playbook stored as knowledge for their project/workspace. */
  starterKnowledge?: { title: string; content: string } | null;
  /** Optional brief stored as a personal memory. */
  starterBrief?: string | null;
  /** Optionally add the new hire to a team. */
  teamId?: string | null;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
  specialty?: string | null;
  bio?: string | null;
  instructions?: string | null;
  projectId?: string | null;
  status?: "draft" | "active" | "paused" | "archived";
}

export interface CreateTeamRequest {
  name: string;
  purpose?: string | null;
  projectId?: string | null;
}

export interface UpdateTeamRequest {
  name?: string;
  purpose?: string | null;
  projectId?: string | null;
}

export interface SessionSpendSettings {
  tier: TokenSpendTier;
  /** Null/omit = no per-session cap (plan quota still applies). */
  sessionTokenBudget?: number | null;
}

export interface CreateConversationRequest {
  /** Required unless `teamId` is set (team chat picks a facilitator). */
  agentId?: string | null;
  /** Start a team conversation — first member facilitates replies. */
  teamId?: string | null;
  title?: string | null;
  projectId?: string | null;
  spend?: SessionSpendSettings;
}

export interface SendMessageRequest {
  content: string;
  workspaceHint?: WorkspaceHint | null;
  /** Mid-session override; persists on the conversation. */
  spend?: SessionSpendSettings;
  /** Prefer server-side active goal for this agent when true (default). */
  usePersistedGoal?: boolean;
}

export interface CreateGoalRequest {
  title: string;
  detail?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
}

export interface UpdateGoalRequest {
  title?: string;
  detail?: string | null;
  status?: "active" | "completed" | "cancelled";
  conversationId?: string | null;
}

export interface WorkspaceHint {
  kind: "folder" | "github" | "none";
  folderPath?: string | null;
  repoFullName?: string | null;
  branch?: string | null;
  gitStatus?: string | null;
  treeSummary?: string | null;
  /** Desk/session notes the operator wrote for this coworker. */
  sessionNotes?: string | null;
  /** Latest HQ operator directives. */
  operatorDirectives?: string | null;
  /**
   * Active finish-line objective for this chat.
   * The agent should keep working toward it until the operator marks it complete.
   */
  activeGoal?: string | null;
  /** Currently open file path (relative) on the desk. */
  openFilePath?: string | null;
  /** Truncated contents of the open file for grounded edits. */
  openFileContent?: string | null;
  /** Recent laptop terminal output so the agent stays in sync with the desk. */
  recentTerminal?: string | null;
  /** Workspace rules from AGENTS.md / .arrab/rules (Cursor-style). */
  workspaceRules?: string | null;
  /** @-mentions the operator attached to this turn (files, folders, agents). */
  mentions?: WorkspaceMention[] | null;
}

export interface WorkspaceMention {
  kind: "file" | "folder" | "agent" | "rule";
  label: string;
  path?: string | null;
  /** Truncated file body when kind is file. */
  content?: string | null;
  agentId?: string | null;
}

export interface SessionUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  budget: number | null;
  remaining: number | null;
  tier: TokenSpendTier;
}

export interface ConversationDetailResponse {
  conversation: Conversation;
  messages: Message[];
  sessionUsage: SessionUsageSnapshot;
}

export interface SendMessageToolEvent {
  name: string;
  result: string;
}

export interface SendMessageResponse {
  userMessage: Message;
  assistantMessage: Message | null;
  providerConfigured: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  githubContextAttached: boolean;
  sessionUsage: SessionUsageSnapshot;
  /** Tools executed during this turn (read-only or after approval). */
  toolsUsed?: string[];
  /** Present when a gated tool is waiting for operator approval. */
  approval?: Approval | null;
}

export type ConnectorProvider =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "linear"
  | "slack"
  | "notion"
  | "email";

export type ConnectorConnectionStatus = "connected" | "error";

export interface ConnectorPublic {
  id: string;
  provider: ConnectorProvider;
  status: ConnectorConnectionStatus;
  accountLabel: string | null;
  scopes: string[];
  connectedAt: string;
  lastVerifiedAt: string | null;
  error: string | null;
}

export interface ConnectorResource {
  id: string;
  name: string;
  url: string | null;
  kind: string;
}

export interface ConnectConnectorRequest {
  provider: ConnectorProvider;
  /** Access token, PAT, app password, or bot token depending on provider. */
  token: string;
  label?: string | null;
  /**
   * Provider-specific settings.
   * Email: address, imapHost, imapPort, smtpHost, smtpPort
   * Bitbucket: username
   * GitLab: baseUrl (optional self-hosted)
   */
  config?: Record<string, string> | null;
}

export interface ConnectorsCatalogItem {
  provider: ConnectorProvider;
  available: boolean;
  description: string;
}

export interface EmailMessageSummary {
  id: string;
  subject: string;
  from: string;
  date: string | null;
  seen: boolean;
  snippet: string | null;
}

export interface EmailMessageDetail extends EmailMessageSummary {
  to: string[];
  cc: string[];
  text: string | null;
  html: string | null;
}

export interface ListEmailMessagesResponse {
  mailbox: string;
  items: EmailMessageSummary[];
}

export interface SendEmailRequest {
  to: string;
  subject: string;
  text: string;
  cc?: string | null;
  html?: string | null;
}

export interface SendEmailResponse {
  messageId: string | null;
  accepted: string[];
}

export interface BindProjectRepoRequest {
  connectorId: string;
  repoFullName: string;
  repoUrl?: string | null;
  defaultBranch?: string | null;
}

export interface GithubRepoMetaResponse {
  fullName: string;
  url: string | null;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  language: string | null;
}

export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface GithubTreeResponse {
  ref: string;
  truncated: boolean;
  entries: GithubTreeEntry[];
}

export interface GithubCommitFile {
  path: string;
  content: string;
}

export interface GithubCommitRequest {
  connectorId: string;
  message: string;
  branch?: string;
  files: GithubCommitFile[];
  requireApproval?: boolean;
}

export interface GithubCommitResponse {
  sha: string;
  branch: string;
  url: string | null;
  approval?: Approval | null;
}

export interface GithubCreatePullRequest {
  connectorId: string;
  title: string;
  body?: string | null;
  head: string;
  base?: string;
  requireApproval?: boolean;
}

export interface GithubPullRequestResponse {
  number: number;
  url: string;
  title: string;
  approval?: Approval | null;
}

export interface AddTeamMemberRequest {
  agentId: string;
}

export interface UsageSummaryResponse {
  totals: {
    inputTokens: number;
    outputTokens: number;
    events: number;
  };
  byProvider: Array<{ providerId: string; inputTokens: number; outputTokens: number; events: number }>;
  recent: Array<{
    id: string;
    providerId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
    agentId: string | null;
  }>;
  entitlements?: import("./account.js").AccountEntitlements;
}

export interface ConnectAccountRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface SignInAccountRequest {
  email: string;
  password: string;
}

export interface ActivateSubscriptionRequest {
  /** Redeem code such as PRO-ARRAB, TEAM-ARRAB, UNLIMITED-ARRAB */
  code: string;
}

export interface UpdateAccountProfileRequest {
  displayName?: string;
}

export interface ConnectAccountResponse {
  account: import("./account.js").AccountPublic;
  entitlements: import("./account.js").AccountEntitlements;
  /** Shown once — store on desktop for reconnect/auth */
  sessionToken: string;
}

export interface StartWebAuthRequest {
  /** Optional return hint for external auth providers. */
  returnTo?: string | null;
}

export interface StartWebAuthResponse {
  state: string;
  authorizationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
}

export interface PollWebAuthResponse {
  status: "pending" | "completed" | "expired";
  account?: import("./account.js").AccountPublic;
  entitlements?: import("./account.js").AccountEntitlements;
  sessionToken?: string;
  message?: string;
}

export interface CompleteWebAuthRequest {
  state: string;
  email: string;
  displayName?: string;
  /** Optional plan redeem code applied on first web sign-in. */
  planCode?: string | null;
}

export interface UpdateOperatorRequest {
  displayName?: string;
  /** Select an existing seat, or null to clear. */
  title?: string | null;
  /** Create a new seat title (then you can select it). */
  addSeat?: string;
  removeSeat?: string;
}

export interface CreateTaskRequest {
  title: string;
  brief?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeAgentId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  dueAt?: string | null;
}

export interface UpdateTaskRequest {
  title?: string;
  brief?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeAgentId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  dueAt?: string | null;
}

export interface ReportSummaryResponse {
  operator: OperatorProfile;
  agentsByStatus: Record<string, number>;
  teams: number;
  tasks: {
    total: number;
    open: number;
    done: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    events: number;
  };
  recentActivity: Activity[];
  knowledgeCount: number;
  memoryCount: number;
  skillCount: number;
  pendingApprovals: number;
  recentTaskRuns: TaskRun[];
}

export interface CreateKnowledgeRequest {
  title: string;
  content: string;
  projectId?: string | null;
}

export interface UpdateKnowledgeRequest {
  title?: string;
  content?: string;
  projectId?: string | null;
}

export interface CreateMemoryRequest {
  content: string;
  agentId?: string | null;
  projectId?: string | null;
}

export interface RunTaskResponse {
  task: Task;
  run: TaskRun;
  conversationId: string | null;
  assistantMessage: string | null;
  providerConfigured: boolean;
  approval?: Approval | null;
}

export interface CreateSkillRequest {
  agentId: string;
  title: string;
  instructions: string;
  createTask?: boolean;
}

export interface CreateApprovalRequest {
  kind: ApprovalKind;
  title: string;
  detail?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}

export interface ResolveApprovalRequest {
  status: "approved" | "rejected";
  /** Client-supplied result after local execution (required for run_terminal). */
  toolResult?: string | null;
}

