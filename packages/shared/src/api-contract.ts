import type {
  AccountEntitlements,
  AccountPublic,
  SubscriptionPlanId,
} from "./account.js";
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
    pauseMode: "upgrade_required" | "upgrade_or_wait" | "payment_required" | null;
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
  models?: string[];
  region?: string | null;
  primaryProvider?: string | null;
  replyPath?: string | null;
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
  /** Defaults to private when an employee session creates the chat. */
  visibility?: "private" | "department" | "workspace";
}

export interface SendMessageRequest {
  content: string;
  workspaceHint?: WorkspaceHint | null;
  /** Mid-session override; persists on the conversation. */
  spend?: SessionSpendSettings;
  /** Prefer server-side active goal for this agent when true (default). */
  usePersistedGoal?: boolean;
  /** Optional model override (OpenRouter/Bedrock/OpenAI/Anthropic id). */
  model?: string | null;
  /** Companion-specific sampling. Omitted uses the runtime default. */
  temperature?: number | null;
  /** Companion-specific completion cap. */
  maxOutputTokens?: number | null;
  /**
   * Incognito / private mode: run the model but do not store transcript rows
   * on the account. Client supplies prior turns from the on-device vault.
   */
  ephemeral?: boolean;
  /** Prior user/assistant turns when `ephemeral` is true (device-side history). */
  priorMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  /** User skills (SKILL.md-style instruction packs) that apply to this turn only. */
  skills?: Array<{ name: string; instructions: string }> | null;
  /**
   * Claude-style skill library for progressive disclosure: the model sees each
   * skill's name + description and loads instructions/files via use_skill and
   * read_skill_file only when relevant.
   */
  skillLibrary?: SkillLibraryEntry[] | null;
}

export interface SkillLibraryEntry {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  /** Already applied in the system prompt for this turn. */
  active?: boolean;
  files?: Array<{ path: string; content: string }>;
  /** Absolute folder where the desktop installed this skill (scripts can run from here). */
  installedPath?: string | null;
}

/** Persist turns that were produced client-side (local model / guardian) onto the account. */
export interface IngestConversationMessagesRequest {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export interface IngestConversationMessagesResponse {
  messages: Message[];
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
  | "gmail"
  | "outlook"
  | "email"
  | "ssh"
  | "whatsapp"
  | "finnhub"
  | "whoop"
  | "fitbit"
  | "google_drive"
  | "google_calendar"
  | "figma";

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
  /** Family seat owner — null outside family plans. */
  familyMemberId: string | null;
}

export interface ConnectorResource {
  id: string;
  name: string;
  url: string | null;
  kind: string;
}

export interface ConnectConnectorRequest {
  provider: ConnectorProvider;
  /** Access token, PAT, app password, or bot token depending on provider. Unused for Gmail OAuth. */
  token?: string;
  label?: string | null;
  /**
   * Provider-specific settings.
   * Email: address, imapHost, imapPort, smtpHost, smtpPort
   * Bitbucket: username
   * GitLab: baseUrl (optional self-hosted)
   * SSH: host, port, username, authMode (password|key), privateKey, passphrase
   * WhatsApp: phone_number_id, waba_id (token = permanent Cloud API access token)
   */
  config?: Record<string, string> | null;
}

/** POST /v1/connectors/gmail/oauth/start  (same shape for Outlook start) */
export interface StartGmailOAuthResponse {
  url: string;
  state: string;
}

/** Alias — Outlook / GitHub OAuth start returns the same payload. */
export type StartOutlookOAuthResponse = StartGmailOAuthResponse;
export type StartGithubOAuthResponse = StartGmailOAuthResponse;

export type ArrangeEmailAction =
  | "archive"
  | "trash"
  | "untrash"
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "label"
  | "move";

/** POST /v1/connectors/:id/email/arrange */
export interface ArrangeEmailRequest {
  action: ArrangeEmailAction;
  /** Gmail message ids (or IMAP UIDs for legacy email connectors). */
  messageIds: string[];
  mailbox?: string | null;
  addLabelIds?: string[] | null;
  removeLabelIds?: string[] | null;
  /** Destination mailbox/label for action=move */
  targetMailbox?: string | null;
}

export interface ArrangeEmailResponse {
  ok: true;
  modified: number;
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

/** POST /v1/connectors/:id/whatsapp/send */
export interface SendWhatsAppRequest {
  /** E.164 phone digits (with or without +). */
  to: string;
  text: string;
}

export interface SendWhatsAppResponse {
  ok: true;
  messageId: string | null;
  to: string;
}

export interface WhatsAppInboundMessage {
  id: string;
  connectorId: string | null;
  phoneNumberId: string;
  from: string;
  to: string | null;
  text: string;
  timestamp: string;
  rawType: string;
  receivedAt: string;
}

export interface ListWhatsAppMessagesResponse {
  items: WhatsAppInboundMessage[];
}

/** POST /v1/connectors/:id/ssh/exec */
export interface SshExecRequest {
  command: string;
}

export interface SshExecResponse {
  code: number | null;
  stdout: string;
  stderr: string;
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
  byAgent: Array<{
    agentId: string | null;
    inputTokens: number;
    outputTokens: number;
    events: number;
  }>;
  recent: Array<{
    id: string;
    providerId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
    agentId: string | null;
  }>;
  entitlements?: AccountEntitlements;
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
  /** Redeem code such as PRO-ARRAB, TEAM-ARRAB, SCALE-ARRAB */
  code: string;
}

export interface UpdateAccountProfileRequest {
  displayName?: string;
}

export interface ConnectAccountResponse {
  account: AccountPublic;
  entitlements: AccountEntitlements;
  /** Shown once — store on desktop for reconnect/auth */
  sessionToken: string;
  /** True when this response created a brand-new account (not a returning sign-in). */
  accountCreated?: boolean;
}

export interface StartWebAuthRequest {
  /** Optional return hint for external auth providers. */
  returnTo?: string | null;
}

export interface StartWebAuthResponse {
  state: string;
  /** Required when polling — proves this desktop started the session. */
  pollSecret?: string;
  authorizationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
}

export interface PollWebAuthResponse {
  status: "pending" | "completed" | "expired";
  account?: AccountPublic;
  entitlements?: AccountEntitlements;
  sessionToken?: string;
  message?: string;
  /** True when the completed handoff created a new account. */
  accountCreated?: boolean;
}

export interface CompleteWebAuthRequest {
  state: string;
  email: string;
  /** Required — website and desktop linking always collect a password. */
  password: string;
  displayName?: string;
  /** Optional plan redeem code applied on first web sign-in. */
  planCode?: string | null;
}

export interface VerifyAccountSessionRequest {
  sessionToken: string;
}

export interface BillingCheckoutRequest {
  planId: SubscriptionPlanId;
}

export interface BillingCheckoutResponse {
  planId: SubscriptionPlanId;
  invoiceId: string;
  checkoutUrl: string;
  amountHalalas: number;
  currency: "SAR";
  amountLabel: string;
}

export interface BillingConfirmRequest {
  invoiceId: string;
}

export interface StudioRelease {
  id: string;
  filename: string;
  url: string;
  platform: "macos" | "linux" | "windows" | "other";
  kind: string;
  version: string | null;
  sizeBytes: number;
  updatedAt: string;
}

export interface StudioReleasesResponse {
  items: StudioRelease[];
  latestMacDmg: StudioRelease | null;
}

export interface UpdateOperatorRequest {
  displayName?: string;
  /** Select an existing seat, or null to clear. */
  title?: string | null;
  /** Create a new seat title (then you can select it). */
  addSeat?: string;
  removeSeat?: string;
}

/** Cloud document for Individuals companions — synced across devices. */
export interface CompanionStateDocument {
  updatedAt: string;
  /** Opaque CompanionState payload from the desktop companion engine. */
  state: unknown;
}

export interface UpsertCompanionStateRequest {
  updatedAt: string;
  state: unknown;
}

export interface CreateTaskRequest {
  title: string;
  brief?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeAgentId?: string | null;
  assigneeEmployeeId?: string | null;
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
  assigneeEmployeeId?: string | null;
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
  /**
   * sha256hex(`${resultToken}\\n${toolResult}`) from CallToolApprovalDetail.resultToken.
   * Required when toolResult is provided for client-exec tools.
   */
  toolResultAttestation?: string | null;
}

