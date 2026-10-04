/** Professional desk state for Individual (then Organization). */

export type ProfessionalSection =
  | "companions"
  | "status"
  | "approvals"
  | "routines"
  | "skills"
  | "memory"
  | "reachability"
  | "boundaries"
  | "audit";

export type ProfessionalToolKind =
  | "browser"
  | "shell"
  | "file"
  | "mcp"
  | "connector"
  | "computer";

export type ProfessionalPace = "allow" | "ask" | "never";

export type ProfessionalAuditVerdict = "permitted" | "refused" | "failed" | "pending";

export interface ProfessionalBoundaryRule {
  id: string;
  /** Short label shown in Boundaries. */
  label: string;
  tool: ProfessionalToolKind | "*";
  /** Substring / glob-ish match on command, url, or tool name. Empty = any. */
  match: string;
  pace: ProfessionalPace;
  enabled: boolean;
  createdAt: string;
}

export interface ProfessionalAuditEvent {
  id: string;
  at: string;
  companionId: string;
  companionName: string;
  tool: ProfessionalToolKind;
  action: string;
  detail: string;
  verdict: ProfessionalAuditVerdict;
  /** Rule id that caused a refusal, if any. */
  ruleId: string | null;
  initiator: "person" | "routine" | "responsibility" | "companion";
}

export interface ProfessionalActivityEvent {
  id: string;
  at: string;
  companionId: string;
  kind: "command" | "file" | "browser" | "note";
  title: string;
  /** Output preview — never secrets. */
  output: string;
}

export interface ProfessionalResponsibility {
  id: string;
  companionId: string;
  companionName: string;
  title: string;
  instruction: string;
  successCriteria: string;
  status: "active" | "paused" | "done";
  /** Hour 0–23 in Asia/Riyadh when schedule trigger is set; null = manual only. */
  scheduleHour: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfessionalSkillGrant {
  skillId: string;
  companionId: string;
  enabled: boolean;
}

export interface ProfessionalReachabilityBinding {
  id: string;
  companionId: string;
  companionName: string;
  channel: "slack" | "teams" | "sms";
  /** External channel / conversation handle. */
  target: string;
  enabled: boolean;
  createdAt: string;
}

export interface ProfessionalMcpPlugin {
  id: string;
  key: string;
  name: string;
  /** Catalogue vs custom URL. */
  kind: "catalogue" | "custom";
  url: string;
  enabled: boolean;
  /** Companion ids granted this plugin. Empty = none. */
  grantedCompanionIds: string[];
  createdAt: string;
}

export interface ProfessionalCompanionStatus {
  companionId: string;
  companionName: string;
  /** What they are doing right now. */
  status: "idle" | "working" | "needs_you" | "paused";
  needsYou: string | null;
  paused: boolean;
  updatedAt: string;
}

/** Source-backed suggestion the person can accept or dismiss. */
export interface MuseIdea {
  id: string;
  title: string;
  body: string;
  source: string;
  status: "open" | "accepted" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

/** Recurring public-page watch. */
export interface MuseWatch {
  id: string;
  url: string;
  label: string;
  kind: "change" | "text" | "price";
  /** For price watches — USD threshold. */
  thresholdUsd: number | null;
  /** Last observed snapshot (hash or short text). */
  lastObservation: string;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Spending summary from a CSV import. */
export interface MuseFinanceSummary {
  id: string;
  title: string;
  categoryTotals: Array<{ category: string; amount: number }>;
  transactionCount: number;
  savingsGoal: string;
  createdAt: string;
}

/** Goal with milestones. */
export interface MuseGoal {
  id: string;
  title: string;
  milestones: Array<{ id: string; title: string; done: boolean }>;
  status: "open" | "done" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface ProfessionalWorkspaceState {
  boundaries: ProfessionalBoundaryRule[];
  audit: ProfessionalAuditEvent[];
  activity: ProfessionalActivityEvent[];
  responsibilities: ProfessionalResponsibility[];
  skillGrants: ProfessionalSkillGrant[];
  reachability: ProfessionalReachabilityBinding[];
  plugins: ProfessionalMcpPlugin[];
  companionStatus: ProfessionalCompanionStatus[];
  ideas: MuseIdea[];
  watches: MuseWatch[];
  finance: MuseFinanceSummary[];
  goals: MuseGoal[];
  /**
   * Always-on stay: API worker keeps sweeping
   * schedules, watches, and responsibilities even when the UI is idle.
   */
  stayEnabled: boolean;
  /** ISO time of the last stay sweep (null until first run). */
  lastStaySweepAt: string | null;
  /** When true, companion computer actions are refused (person is driving). */
  controlTaken: boolean;
  controlCompanionId: string | null;
  /** Consecutive routine failures before auto-disable. */
  routineFatigueLimit: number;
}

export interface ProfessionalWorkspaceView extends ProfessionalWorkspaceState {
  updatedAt: string;
}

export interface UpsertBoundaryRequest {
  id?: string;
  label: string;
  tool?: ProfessionalToolKind | "*";
  match?: string;
  pace?: ProfessionalPace;
  enabled?: boolean;
}

export interface RecordProfessionalActionRequest {
  companionId?: string;
  companionName?: string;
  tool: ProfessionalToolKind;
  action: string;
  detail?: string;
  initiator?: ProfessionalAuditEvent["initiator"];
}

export interface RecordProfessionalActionResponse {
  allowed: boolean;
  verdict: ProfessionalAuditVerdict;
  event: ProfessionalAuditEvent;
  ruleId: string | null;
}

export interface UpsertResponsibilityRequest {
  id?: string;
  companionId?: string;
  companionName?: string;
  title: string;
  instruction?: string;
  successCriteria?: string;
  scheduleHour?: number | null;
  status?: ProfessionalResponsibility["status"];
}

export interface UpsertReachabilityRequest {
  id?: string;
  companionId?: string;
  companionName?: string;
  channel: ProfessionalReachabilityBinding["channel"];
  target: string;
  enabled?: boolean;
}

export interface UpsertMcpPluginRequest {
  id?: string;
  key: string;
  name: string;
  kind?: ProfessionalMcpPlugin["kind"];
  url?: string;
  enabled?: boolean;
  grantedCompanionIds?: string[];
}

export interface SetSkillGrantRequest {
  skillId: string;
  companionId: string;
  enabled: boolean;
}

export interface SetCompanionStatusRequest {
  companionId: string;
  companionName?: string;
  status?: ProfessionalCompanionStatus["status"];
  needsYou?: string | null;
  paused?: boolean;
}

export interface AppendActivityRequest {
  companionId: string;
  kind: ProfessionalActivityEvent["kind"];
  title: string;
  output?: string;
}

export interface TakeControlRequest {
  companionId: string;
  taken: boolean;
}

export interface UpsertMuseIdeaRequest {
  id?: string;
  title: string;
  body?: string;
  source?: string;
  status?: MuseIdea["status"];
}

export interface UpsertMuseWatchRequest {
  id?: string;
  url: string;
  label?: string;
  kind?: MuseWatch["kind"];
  thresholdUsd?: number | null;
  paused?: boolean;
}

export interface ImportMuseFinanceRequest {
  title?: string;
  /** Raw CSV text: category,amount rows or date,description,amount,category. */
  csv: string;
  savingsGoal?: string;
}

export interface UpsertMuseGoalRequest {
  id?: string;
  title: string;
  milestones?: Array<{ id?: string; title: string; done?: boolean }>;
  status?: MuseGoal["status"];
}

export interface ObserveMuseWatchRequest {
  id: string;
  observation: string;
  /** Optional price seen (for price watches). */
  priceUsd?: number | null;
}

export interface SetProfessionalStayRequest {
  enabled: boolean;
}

export function emptyProfessionalWorkspace(): ProfessionalWorkspaceState {
  return {
    boundaries: [
      {
        id: "bound_default_shell",
        label: "Shell asks first",
        tool: "shell",
        match: "",
        pace: "ask",
        enabled: true,
        createdAt: new Date(0).toISOString(),
      },
      {
        id: "bound_default_browser",
        label: "Browser asks first",
        tool: "browser",
        match: "",
        pace: "ask",
        enabled: true,
        createdAt: new Date(0).toISOString(),
      },
    ],
    audit: [],
    activity: [],
    responsibilities: [],
    skillGrants: [],
    reachability: [],
    plugins: [
      {
        id: "mcp_parallel",
        key: "parallel-search",
        name: "Parallel Search",
        kind: "catalogue",
        url: "",
        enabled: false,
        grantedCompanionIds: [],
        createdAt: new Date(0).toISOString(),
      },
      {
        id: "mcp_notion",
        key: "notion",
        name: "Notion",
        kind: "catalogue",
        url: "",
        enabled: false,
        grantedCompanionIds: [],
        createdAt: new Date(0).toISOString(),
      },
      {
        id: "mcp_drive",
        key: "google-drive",
        name: "Google Drive",
        kind: "catalogue",
        url: "",
        enabled: false,
        grantedCompanionIds: [],
        createdAt: new Date(0).toISOString(),
      },
    ],
    companionStatus: [],
    ideas: [],
    watches: [],
    finance: [],
    goals: [],
    stayEnabled: true,
    lastStaySweepAt: null,
    controlTaken: false,
    controlCompanionId: null,
    routineFatigueLimit: 10,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeProfessionalWorkspace(
  raw: Partial<ProfessionalWorkspaceState> | null | undefined,
): ProfessionalWorkspaceState {
  const base = emptyProfessionalWorkspace();
  if (!raw || typeof raw !== "object") return base;

  const tools: Array<ProfessionalToolKind | "*"> = [
    "browser",
    "shell",
    "file",
    "mcp",
    "connector",
    "computer",
    "*",
  ];
  const paces: ProfessionalPace[] = ["allow", "ask", "never"];
  const verdicts: ProfessionalAuditVerdict[] = ["permitted", "refused", "failed", "pending"];

  return {
    boundaries: Array.isArray(raw.boundaries)
      ? raw.boundaries
          .filter((item): item is ProfessionalBoundaryRule => Boolean(item && typeof item === "object"))
          .map((item) => ({
            id: asString(item.id, `bound_${Math.random().toString(36).slice(2, 10)}`),
            label: asString(item.label, "Rule").slice(0, 120),
            tool: tools.includes(item.tool as ProfessionalToolKind | "*")
              ? (item.tool as ProfessionalToolKind | "*")
              : "*",
            match: asString(item.match).slice(0, 240),
            pace: paces.includes(item.pace as ProfessionalPace)
              ? (item.pace as ProfessionalPace)
              : "ask",
            enabled: asBool(item.enabled, true),
            createdAt: asString(item.createdAt, new Date().toISOString()),
          }))
          .slice(0, 200)
      : base.boundaries,
    audit: Array.isArray(raw.audit)
      ? (raw.audit
          .filter((item): item is ProfessionalAuditEvent => Boolean(item && typeof item === "object"))
          .map((item): ProfessionalAuditEvent => ({
            id: asString(item.id),
            at: asString(item.at),
            companionId: asString(item.companionId),
            companionName: asString(item.companionName),
            tool: (tools.includes(item.tool as ProfessionalToolKind)
              ? item.tool
              : "computer") as ProfessionalToolKind,
            action: asString(item.action).slice(0, 200),
            detail: asString(item.detail).slice(0, 2000),
            verdict: verdicts.includes(item.verdict as ProfessionalAuditVerdict)
              ? (item.verdict as ProfessionalAuditVerdict)
              : "pending",
            ruleId: typeof item.ruleId === "string" ? item.ruleId : null,
            initiator:
              item.initiator === "routine" ||
              item.initiator === "responsibility" ||
              item.initiator === "companion"
                ? item.initiator
                : "person",
          }))
          .slice(-500) as ProfessionalAuditEvent[])
      : [],
    activity: Array.isArray(raw.activity)
      ? (raw.activity
          .filter((item): item is ProfessionalActivityEvent => Boolean(item && typeof item === "object"))
          .map((item): ProfessionalActivityEvent => ({
            id: asString(item.id),
            at: asString(item.at),
            companionId: asString(item.companionId),
            kind:
              item.kind === "file" || item.kind === "browser" || item.kind === "note"
                ? item.kind
                : "command",
            title: asString(item.title).slice(0, 200),
            output: asString(item.output).slice(0, 4000),
          }))
          .slice(-200) as ProfessionalActivityEvent[])
      : [],
    responsibilities: Array.isArray(raw.responsibilities)
      ? (raw.responsibilities
          .filter((item): item is ProfessionalResponsibility => Boolean(item && typeof item === "object"))
          .map((item): ProfessionalResponsibility => ({
            id: asString(item.id),
            companionId: asString(item.companionId),
            companionName: asString(item.companionName),
            title: asString(item.title).slice(0, 160),
            instruction: asString(item.instruction).slice(0, 2000),
            successCriteria: asString(item.successCriteria).slice(0, 800),
            status:
              item.status === "paused" || item.status === "done" ? item.status : "active",
            scheduleHour:
              typeof item.scheduleHour === "number" &&
              Number.isInteger(item.scheduleHour) &&
              item.scheduleHour >= 0 &&
              item.scheduleHour <= 23
                ? item.scheduleHour
                : null,
            createdAt: asString(item.createdAt),
            updatedAt: asString(item.updatedAt),
          }))
          .slice(0, 100) as ProfessionalResponsibility[])
      : [],
    skillGrants: Array.isArray(raw.skillGrants)
      ? raw.skillGrants
          .filter((item): item is ProfessionalSkillGrant => Boolean(item && typeof item === "object"))
          .map((item) => ({
            skillId: asString(item.skillId),
            companionId: asString(item.companionId),
            enabled: asBool(item.enabled, true),
          }))
          .slice(0, 500)
      : [],
    reachability: Array.isArray(raw.reachability)
      ? (raw.reachability
          .filter((item): item is ProfessionalReachabilityBinding =>
            Boolean(item && typeof item === "object"),
          )
          .map((item): ProfessionalReachabilityBinding => ({
            id: asString(item.id),
            companionId: asString(item.companionId),
            companionName: asString(item.companionName),
            channel:
              item.channel === "teams" || item.channel === "sms" ? item.channel : "slack",
            target: asString(item.target).slice(0, 240),
            enabled: asBool(item.enabled, true),
            createdAt: asString(item.createdAt),
          }))
          .slice(0, 100) as ProfessionalReachabilityBinding[])
      : [],
    plugins: Array.isArray(raw.plugins)
      ? (raw.plugins
          .filter((item): item is ProfessionalMcpPlugin => Boolean(item && typeof item === "object"))
          .map((item): ProfessionalMcpPlugin => ({
            id: asString(item.id),
            key: asString(item.key).slice(0, 80),
            name: asString(item.name).slice(0, 120),
            kind: item.kind === "custom" ? "custom" : "catalogue",
            url: asString(item.url).slice(0, 500),
            enabled: asBool(item.enabled, false),
            grantedCompanionIds: Array.isArray(item.grantedCompanionIds)
              ? item.grantedCompanionIds.filter((id): id is string => typeof id === "string").slice(0, 100)
              : [],
            createdAt: asString(item.createdAt),
          }))
          .slice(0, 100) as ProfessionalMcpPlugin[])
      : base.plugins,
    companionStatus: Array.isArray(raw.companionStatus)
      ? (raw.companionStatus
          .filter((item): item is ProfessionalCompanionStatus =>
            Boolean(item && typeof item === "object"),
          )
          .map((item): ProfessionalCompanionStatus => ({
            companionId: asString(item.companionId),
            companionName: asString(item.companionName),
            status:
              item.status === "working" ||
              item.status === "needs_you" ||
              item.status === "paused"
                ? item.status
                : "idle",
            needsYou: typeof item.needsYou === "string" ? item.needsYou.slice(0, 400) : null,
            paused: asBool(item.paused, false),
            updatedAt: asString(item.updatedAt),
          }))
          .slice(0, 200) as ProfessionalCompanionStatus[])
      : [],
    ideas: Array.isArray(raw.ideas)
      ? (raw.ideas
          .filter((item): item is MuseIdea => Boolean(item && typeof item === "object"))
          .map((item): MuseIdea => ({
            id: asString(item.id),
            title: asString(item.title).slice(0, 160),
            body: asString(item.body).slice(0, 2000),
            source: asString(item.source).slice(0, 240),
            status:
              item.status === "accepted" || item.status === "dismissed" ? item.status : "open",
            createdAt: asString(item.createdAt),
            updatedAt: asString(item.updatedAt),
          }))
          .slice(0, 100) as MuseIdea[])
      : [],
    watches: Array.isArray(raw.watches)
      ? (raw.watches
          .filter((item): item is MuseWatch => Boolean(item && typeof item === "object"))
          .map((item): MuseWatch => ({
            id: asString(item.id),
            url: asString(item.url).slice(0, 500),
            label: asString(item.label).slice(0, 120),
            kind: item.kind === "text" || item.kind === "price" ? item.kind : "change",
            thresholdUsd:
              typeof item.thresholdUsd === "number" && Number.isFinite(item.thresholdUsd)
                ? item.thresholdUsd
                : null,
            lastObservation: asString(item.lastObservation).slice(0, 500),
            paused: asBool(item.paused, false),
            createdAt: asString(item.createdAt),
            updatedAt: asString(item.updatedAt),
          }))
          .slice(0, 100) as MuseWatch[])
      : [],
    finance: Array.isArray(raw.finance)
      ? (raw.finance
          .filter((item): item is MuseFinanceSummary => Boolean(item && typeof item === "object"))
          .map((item): MuseFinanceSummary => ({
            id: asString(item.id),
            title: asString(item.title).slice(0, 120),
            categoryTotals: Array.isArray(item.categoryTotals)
              ? item.categoryTotals
                  .filter((row) => row && typeof row === "object")
                  .map((row) => ({
                    category: asString((row as { category?: string }).category).slice(0, 80),
                    amount: Number((row as { amount?: number }).amount) || 0,
                  }))
                  .slice(0, 40)
              : [],
            transactionCount:
              typeof item.transactionCount === "number" ? item.transactionCount : 0,
            savingsGoal: asString(item.savingsGoal).slice(0, 200),
            createdAt: asString(item.createdAt),
          }))
          .slice(0, 20) as MuseFinanceSummary[])
      : [],
    goals: Array.isArray(raw.goals)
      ? (raw.goals
          .filter((item): item is MuseGoal => Boolean(item && typeof item === "object"))
          .map((item): MuseGoal => ({
            id: asString(item.id),
            title: asString(item.title).slice(0, 160),
            milestones: Array.isArray(item.milestones)
              ? item.milestones
                  .filter((row) => row && typeof row === "object")
                  .map((row, index) => ({
                    id:
                      asString((row as { id?: string }).id) ||
                      `ms_${index}`,
                    title: asString((row as { title?: string }).title).slice(0, 160),
                    done: asBool((row as { done?: boolean }).done, false),
                  }))
                  .slice(0, 40)
              : [],
            status:
              item.status === "done" || item.status === "cancelled" ? item.status : "open",
            createdAt: asString(item.createdAt),
            updatedAt: asString(item.updatedAt),
          }))
          .slice(0, 100) as MuseGoal[])
      : [],
    stayEnabled: asBool(raw.stayEnabled, true),
    lastStaySweepAt:
      typeof raw.lastStaySweepAt === "string" && raw.lastStaySweepAt.trim()
        ? raw.lastStaySweepAt
        : null,
    controlTaken: asBool(raw.controlTaken, false),
    controlCompanionId:
      typeof raw.controlCompanionId === "string" ? raw.controlCompanionId : null,
    routineFatigueLimit:
      typeof raw.routineFatigueLimit === "number" &&
      Number.isInteger(raw.routineFatigueLimit) &&
      raw.routineFatigueLimit >= 3 &&
      raw.routineFatigueLimit <= 50
        ? raw.routineFatigueLimit
        : 10,
  };
}
