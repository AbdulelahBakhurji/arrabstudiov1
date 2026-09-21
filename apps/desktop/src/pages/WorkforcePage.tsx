import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Search,
  Sparkles,
  CircleDot,
  Archive,
  Bell,
  Copy,
  EyeOff,
  FolderPlus,
  Pencil,
  Pin,
  ShieldCheck,
  ShieldQuestion,
  SquarePen,
  BarChart3,
  ClipboardList,
  BookOpen,
  Crown,
  Laptop,
  ListTodo,
  Map as MapIcon,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Settings2,
  Trash2,
  UsersRound,
  UserRound,
  X,
  ArrowRight,
  GripVertical,
  Upload,
  FileText,
} from "lucide-react";
import type {
  Agent,
  Approval,
  Knowledge,
  OperatorProfile,
  Project,
  ProjectRepoBinding,
  ReportSummaryResponse,
  Task,
  TaskPriority,
  TaskRun,
  TaskStatus,
  Team,
  TeamId,
  TeamMembership,
  UsageSummaryResponse,
  Activity,
} from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { AgentsOfficeHost } from "@/components/AgentsOfficeHost";
import { OrgAdministrationPanel } from "@/components/OrgAdministrationPanel";
import { WorkforceList, type WorkforceListGroup } from "@/components/WorkforceList";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import { collapseDefaultSoloDupes } from "@/lib/agents-bootstrap";
import {
  hideAgent,
  readAgentSessionPolicy,
  readHiddenAgents,
  readPinnedAgents,
  filterLiveWorkforceAgents,
  readRemovedAgents,
  rememberRemovedAgent,
  togglePinnedAgent,
  writeAgentSessionPolicy,
  type AgentSessionPolicy,
} from "@/lib/agent-session-policy";
import { notifyStudio, pushToast } from "@/lib/notify";
import {
  readOrgEmployeeSession,
  subscribeOrgEmployeeSession,
} from "@/lib/org-employee-session";
import { useOrgSeatCapabilities } from "@/lib/org-seat";
import { prepareWorkplaceStudio } from "@/lib/workplace-handoff";
import { cn } from "@/lib/utils";
import { ROLE_PATH } from "@/roles/catalog";
import { parseStudioAssign } from "@/pages/HomePage";

type ViewMode =
  | "map"
  | "org"
  | "assign"
  | "admin"
  | "tasks"
  | "knowledge"
  | "chat"
  | "reports";
type OrgSeatRole = "admin" | "manager" | "member";
type ChatLaunchMode = "solo" | "team";
type TeamMode = "autonomous" | "supervised" | "pair";
type ApprovalPolicy = "auto" | "human" | "dual";
type AutomationLevel = "low" | "medium" | "high";
const ALL_HANDS_TEAM = "Studio All-Hands";

function resolveOrgSeatRole(title: string | null | undefined): OrgSeatRole {
  const seat = (title ?? "").trim().toLowerCase();
  if (!seat) return "admin";
  if (
    /\b(ceo|founder|owner|admin|administrator|president|chief|coo|cto|cfo|operator)\b/.test(seat)
  ) {
    return "admin";
  }
  if (/\b(manager|lead|head|director|dept|department)\b/.test(seat)) {
    return "manager";
  }
  return "member";
}

type TeamMeta = {
  mode: TeamMode;
  approval: ApprovalPolicy;
  automation: AutomationLevel;
  roles: string[];
};

type OpsPolicy = {
  draftsNeedActivation: boolean;
  highRiskDual: boolean;
  notifyOnLaunch: boolean;
};

type Directive = { id: string; text: string; createdAt: string };

const ROLE_KEYS = [
  { id: "researcher", labelKey: "roleResearch" as const },
  { id: "engineer", labelKey: "roleEngineer" as const },
  { id: "reviewer", labelKey: "roleReviewer" as const },
  { id: "ops", labelKey: "roleOps" as const },
  { id: "writer", labelKey: "roleWriter" as const },
];

const TASK_COLUMNS: TaskStatus[] = ["backlog", "assigned", "in_progress", "blocked", "done"];
const META_KEY = "arrab.workforce.teamMeta";
const OPS_KEY = "arrab.workforce.ops";
const DIRECTIVES_KEY = "arrab.workforce.directives";
const MAP_ORDER_KEY = "arrab.workforce.mapTeamOrder";
/** Every department office holds at most 8 agents (matches Live Map desks). */
const MAX_DEPT_AGENTS = 8;

function readMapTeamOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MAP_ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readTeamMeta(): Record<string, TeamMeta> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? "{}") as Record<string, TeamMeta>;
  } catch {
    return {};
  }
}

function writeTeamMeta(map: Record<string, TeamMeta>) {
  localStorage.setItem(META_KEY, JSON.stringify(map));
}

function readOps(): OpsPolicy {
  try {
    const saved = JSON.parse(localStorage.getItem(OPS_KEY) ?? "null") as OpsPolicy | null;
    return (
      saved ?? {
        draftsNeedActivation: true,
        highRiskDual: true,
        notifyOnLaunch: true,
      }
    );
  } catch {
    return { draftsNeedActivation: true, highRiskDual: true, notifyOnLaunch: true };
  }
}

function readDirectives(): Directive[] {
  try {
    return JSON.parse(localStorage.getItem(DIRECTIVES_KEY) ?? "[]") as Directive[];
  } catch {
    return [];
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function openChat(agentId: string, task?: Task) {
  sessionStorage.setItem("arrab.chatAgent", agentId);
  if (task) {
    sessionStorage.setItem(
      "arrab.chatTask",
      JSON.stringify({ id: task.id, title: task.title, brief: task.brief }),
    );
  }
}

function openTeamChat(teamId: string) {
  sessionStorage.setItem("arrab.chatTeam", teamId);
}

function openDesk(agentId: string) {
  sessionStorage.setItem("arrab.deskAgent", agentId);
}

function buildWorkforceReport(input: {
  operator: OperatorProfile | null;
  agents: Agent[];
  teams: Team[];
  tasks: Task[];
  knowledge: Knowledge[];
  taskRuns: TaskRun[];
  pendingApprovals: Approval[];
}): ReportSummaryResponse {
  const agentsByStatus: Record<string, number> = {};
  for (const agent of input.agents) {
    agentsByStatus[agent.status] = (agentsByStatus[agent.status] ?? 0) + 1;
  }
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let open = 0;
  let done = 0;
  for (const task of input.tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
    if (task.status === "done") done += 1;
    else open += 1;
  }
  const operator: OperatorProfile = input.operator ?? {
    workspaceId: "ws_local" as OperatorProfile["workspaceId"],
    displayName: "Studio operator",
    title: null,
    seats: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    operator,
    agentsByStatus,
    teams: input.teams.length,
    tasks: {
      total: input.tasks.length,
      open,
      done,
      byStatus,
      byPriority,
    },
    usage: { inputTokens: 0, outputTokens: 0, events: 0 },
    recentActivity: [],
    knowledgeCount: input.knowledge.length,
    memoryCount: 0,
    skillCount: 0,
    pendingApprovals: input.pendingApprovals.length,
    recentTaskRuns: input.taskRuns.slice(0, 8),
  };
}

export function WorkforcePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [operator, setOperator] = useState<OperatorProfile | null>(null);
  const [report, setReport] = useState<ReportSummaryResponse | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummaryResponse | null>(null);
  const [featureLog, setFeatureLog] = useState<Activity[]>([]);
  const [reportAgentId, setReportAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("map");
  const [inspector, setInspector] = useState<"pulse" | "approvals">("pulse");
  const [chatLaunchMode, setChatLaunchMode] = useState<ChatLaunchMode>("solo");
  const [composeOpen, setComposeOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [hireAdvanced, setHireAdvanced] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentMenu, setAgentMenu] = useState<{
    agentId: string;
    x: number;
    y: number;
    openUp?: boolean;
    confirmDelete?: boolean;
  } | null>(null);
  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>(() => readPinnedAgents());
  const [hiddenAgentIds, setHiddenAgentIds] = useState<string[]>(() => readHiddenAgents());
  const [removedAgentIds, setRemovedAgentIds] = useState<string[]>(() => readRemovedAgents());
  const [policyTick, setPolicyTick] = useState(0);
  const [agentBusy, setAgentBusy] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [knowledgeFormOpen, setKnowledgeFormOpen] = useState(false);
  const [seatEdit, setSeatEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [runPreview, setRunPreview] = useState<string | null>(null);
  const [teamMeta, setTeamMeta] = useState<Record<string, TeamMeta>>(() => readTeamMeta());
  const [ops, setOps] = useState<OpsPolicy>(() => readOps());
  const [directives, setDirectives] = useState<Directive[]>(() => readDirectives());
  const [directiveDraft, setDirectiveDraft] = useState("");
  const [directiveBusy, setDirectiveBusy] = useState(false);
  const [directiveFlash, setDirectiveFlash] = useState<string | null>(null);
  const [assignText, setAssignText] = useState("");
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignOk, setAssignOk] = useState<string | null>(null);
  const [assignPriority, setAssignPriority] = useState<TaskPriority>("medium");
  const [assignPeopleQuery, setAssignPeopleQuery] = useState("");

  const [ceoName, setCeoName] = useState("");
  const [selectedSeat, setSelectedSeat] = useState("");
  const [newSeat, setNewSeat] = useState("");

  const [teamName, setTeamName] = useState("");
  const [mission, setMission] = useState("");
  const [projectId, setProjectId] = useState("");
  const mode: TeamMode = "supervised";
  const approval: ApprovalPolicy = "human";
  const automation: AutomationLevel = "medium";
  const [roles, setRoles] = useState<string[]>(["researcher", "engineer"]);

  const [hireName, setHireName] = useState("");
  const [hireRole, setHireRole] = useState("");
  const [hireSpecialty, setHireSpecialty] = useState("");
  const [hireBio, setHireBio] = useState("");
  const [hireInstructions, setHireInstructions] = useState("");
  const [hireBrief, setHireBrief] = useState("");
  const [hireKnowledgeTitle, setHireKnowledgeTitle] = useState("");
  const [hireKnowledge, setHireKnowledge] = useState("");
  const [hireProjectId, setHireProjectId] = useState("");
  const [hireTeamId, setHireTeamId] = useState("");
  const [hireActive, setHireActive] = useState(true);
  const [tellAgentId, setTellAgentId] = useState("");
  const [tellText, setTellText] = useState("");
  const [teamOrder] = useState<string[]>(() => readMapTeamOrder());

  const [taskTitle, setTaskTitle] = useState("");
  const [taskBrief, setTaskBrief] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskTeam, setTaskTeam] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const [taskFilterAssignee, setTaskFilterAssignee] = useState("");
  const [taskFilterPriority, setTaskFilterPriority] = useState<TaskPriority | "">("");
  const [taskFilterProject, setTaskFilterProject] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskDragId, setTaskDragId] = useState<string | null>(null);
  const [taskDropStatus, setTaskDropStatus] = useState<TaskStatus | null>(null);
  const [bindings, setBindings] = useState<ProjectRepoBinding[]>([]);

  const [knowTitle, setKnowTitle] = useState("");
  const [knowContent, setKnowContent] = useState("");
  const [knowProject, setKnowProject] = useState("");
  const [knowSearch, setKnowSearch] = useState("");
  const [knowExpandedId, setKnowExpandedId] = useState<string | null>(null);
  const [knowUploading, setKnowUploading] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setLoading(true);

    const settled = <T,>(promise: Promise<T>, fallback: T) =>
      promise.then(
        (value) => value,
        () => fallback,
      );

    void Promise.all([
      settled(arrabApi.agents(), { items: [] as Agent[] }),
      settled(arrabApi.teams(), { items: [] as Team[] }),
      settled(arrabApi.projects(), { items: [] as Project[] }),
      settled(arrabApi.memberships(), { items: [] as TeamMembership[] }),
      settled(arrabApi.tasks(), { items: [] as Task[] }),
      settled(arrabApi.operator(), null as OperatorProfile | null),
      settled(arrabApi.reportSummary(), null as ReportSummaryResponse | null),
      settled(arrabApi.knowledge(), { items: [] as Knowledge[] }),
      settled(arrabApi.taskRuns(), { items: [] as TaskRun[] }),
      settled(arrabApi.bindings(), { items: [] as ProjectRepoBinding[] }),
      settled(arrabApi.pendingApprovals(), { items: [] as Approval[] }),
    ])
      .then(async ([a, tm, p, members, taskList, op, rep, know, runs, binds, approvals]) => {
        let people = filterLiveWorkforceAgents(a.items);
        try {
          people = await collapseDefaultSoloDupes(people, t("chatSoloDefaultName"));
        } catch {
          // Keep roster even if cleanup fails.
        }
        setAgents(people);
        setTeams(tm.items);
        setProjects(p.items.filter((item) => item.status === "active"));
        setMemberships(members.items);
        setTasks(taskList.items);
        if (op) {
          setOperator(op);
          setCeoName(op.displayName);
          setSelectedSeat(op.title ?? "");
        }
        setReport(
          rep ??
            buildWorkforceReport({
              operator: op,
              agents: people,
              teams: tm.items,
              tasks: taskList.items,
              knowledge: know.items,
              taskRuns: runs.items,
              pendingApprovals: approvals.items,
            }),
        );
        setKnowledge(know.items);
        setTaskRuns(runs.items);
        setBindings(binds.items);
        setPendingApprovals(approvals.items);
      })
      .catch(() => {
        // Individual calls already soft-fail; keep the page usable.
      })
      .finally(() => {
        setLoading(false);
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const openHire = () => setHireOpen(true);
    if (window.location.hash === "#hire") openHire();
    window.addEventListener("arrab:open-hire", openHire);
    return () => window.removeEventListener("arrab:open-hire", openHire);
  }, []);

  useEffect(() => {
    if (!agentMenu) return;
    const close = () => {
      setAgentMenu(null);
      setPendingDeleteId(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [agentMenu]);

  useEffect(() => {
    localStorage.setItem(OPS_KEY, JSON.stringify(ops));
  }, [ops]);

  useEffect(() => {
    localStorage.setItem(DIRECTIVES_KEY, JSON.stringify(directives));
  }, [directives]);

  const membersByTeam = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const membership of memberships) {
      const agent = agents.find((item) => item.id === membership.agentId);
      if (!agent) continue;
      const list = map.get(membership.teamId) ?? [];
      list.push(agent);
      map.set(membership.teamId, list);
    }
    return map;
  }, [agents, memberships]);

  const pendingDrafts = useMemo(
    () => agents.filter((agent) => agent.status === "draft"),
    [agents],
  );

  const draftIdsWithPending = useMemo(() => {
    const ids = new Set<string>();
    for (const approval of pendingApprovals) {
      if (approval.kind === "activate_agent" && approval.agentId) {
        ids.add(approval.agentId);
      }
    }
    return ids;
  }, [pendingApprovals]);

  const draftsNeedingRequest = useMemo(
    () => pendingDrafts.filter((agent) => !draftIdsWithPending.has(agent.id)),
    [pendingDrafts, draftIdsWithPending],
  );

  const pendingApprovalCount = pendingApprovals.length + draftsNeedingRequest.length;
  const peopleAgents = useMemo(() => {
    void removedAgentIds;
    void hiddenAgentIds;
    return filterLiveWorkforceAgents(agents);
  }, [agents, hiddenAgentIds, removedAgentIds]);
  const selectedAgent = useMemo(
    () => peopleAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [peopleAgents, selectedAgentId],
  );
  const activeAgents = useMemo(
    () => peopleAgents.filter((agent) => agent.status === "active" || agent.status === "paused"),
    [peopleAgents],
  );
  const assignedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const membership of memberships) {
      ids.add(membership.agentId);
    }
    return ids;
  }, [memberships]);
  const unassignedAgents = useMemo(
    () => peopleAgents.filter((agent) => !assignedAgentIds.has(agent.id)),
    [assignedAgentIds, peopleAgents],
  );
  const orgTeams = useMemo(() => {
    const seen = new Map<string, Team>();
    for (const team of teams) {
      const key = team.name.trim().toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, team);
        continue;
      }
      const existingCount = (membersByTeam.get(existing.id) ?? []).length;
      const nextCount = (membersByTeam.get(team.id) ?? []).length;
      if (nextCount > existingCount) {
        seen.set(key, team);
      }
    }
    return [...seen.values()];
  }, [membersByTeam, teams]);

  const orderedOrgTeams = useMemo(() => {
    const byId = new Map(orgTeams.map((team) => [team.id, team] as const));
    const ordered: Team[] = [];
    for (const id of teamOrder) {
      const team = byId.get(id as TeamId);
      if (team) {
        ordered.push(team);
        byId.delete(id as TeamId);
      }
    }
    return [...ordered, ...byId.values()];
  }, [orgTeams, teamOrder]);

  const workforceGroups = useMemo((): WorkforceListGroup[] => {
    const hidden = new Set(hiddenAgentIds);
    const pinned = new Set(pinnedAgentIds);
    const sortAgents = <T extends { id: string; name: string }>(list: T[]) =>
      [...list].sort((a, b) => {
        const ap = pinned.has(a.id) ? 0 : 1;
        const bp = pinned.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.name.localeCompare(b.name);
      });

    const mapAgent = (agent: Agent): WorkforceListGroup["agents"][number] => ({
      id: agent.id,
      name: agent.name,
      role: agent.specialty || agent.role,
      live: agent.status === "active",
      pinned: pinned.has(agent.id),
      policy: readAgentSessionPolicy(agent.id),
    });

    const groups: WorkforceListGroup[] = orderedOrgTeams.slice(0, 8).map((team) => {
      const members = sortAgents(
        (membersByTeam.get(team.id) ?? []).filter(
          (agent) => agent.status !== "archived" && !hidden.has(agent.id),
        ),
      );
      return {
        id: team.id,
        name: team.name,
        agents: members.map(mapAgent),
      };
    });
    const visibleUnassigned = sortAgents(
      unassignedAgents.filter((agent) => !hidden.has(agent.id)),
    );
    if (visibleUnassigned.length > 0) {
      groups.push({
        id: "unassigned",
        name: t("mapUnassigned"),
        agents: visibleUnassigned.map(mapAgent),
      });
    }
    if (groups.length === 0) {
      const visiblePeople = sortAgents(peopleAgents.filter((agent) => !hidden.has(agent.id)));
      if (visiblePeople.length > 0) {
        groups.push({
          id: "workforce",
          name: t("workforceTitle"),
          agents: visiblePeople.map(mapAgent),
        });
      }
    }
    return groups;
  }, [
    hiddenAgentIds,
    membersByTeam,
    orderedOrgTeams,
    peopleAgents,
    pinnedAgentIds,
    policyTick,
    t,
    unassignedAgents,
  ]);

  useEffect(() => {
    localStorage.setItem(MAP_ORDER_KEY, JSON.stringify(teamOrder));
  }, [teamOrder]);

  useEffect(() => {
    if (!tellAgentId && peopleAgents[0]) {
      setTellAgentId(peopleAgents[0].id);
      return;
    }
    if (tellAgentId && !peopleAgents.some((agent) => agent.id === tellAgentId)) {
      setTellAgentId(peopleAgents[0]?.id ?? "");
    }
  }, [peopleAgents, tellAgentId]);

  const activeSeatTitle = selectedSeat.trim() || operator?.title || null;
  const seatRole = useMemo(() => resolveOrgSeatRole(activeSeatTitle), [activeSeatTitle]);
  const [orgSessionTick, setOrgSessionTick] = useState(0);
  useEffect(() => subscribeOrgEmployeeSession(() => setOrgSessionTick((n) => n + 1)), []);
  const orgEmployee = useMemo(() => {
    void orgSessionTick;
    return readOrgEmployeeSession()?.employee ?? null;
  }, [orgSessionTick]);
  // Signed-in employee seats use org-seat. Billing owner (no seat) = full admin.
  const seatCaps = useOrgSeatCapabilities();
  const canAssignWork = seatCaps.canAssignWork;
  const canAdminister = seatCaps.canAdminister;
  const canOpenLiveMap = seatCaps.canOpenLiveMap;

  const parsedAssign = useMemo(
    () => parseStudioAssign(assignText, peopleAgents),
    [assignText, peopleAgents],
  );
  const resolvedAssignee =
    parsedAssign.agent ?? peopleAgents.find((agent) => agent.id === assignAgentId) ?? null;

  const assignRoster = useMemo(() => {
    const q = assignPeopleQuery.trim().toLowerCase();
    if (!q) return peopleAgents;
    return peopleAgents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(q) ||
        (agent.role ?? "").toLowerCase().includes(q) ||
        (agent.specialty ?? "").toLowerCase().includes(q),
    );
  }, [assignPeopleQuery, peopleAgents]);

  useEffect(() => {
    if ((view === "admin" && !canAdminister) || (view === "map" && !canOpenLiveMap)) {
      setView(canAssignWork ? "assign" : "tasks");
    } else if (view === "assign" && !canAssignWork) {
      setView(canOpenLiveMap ? "map" : "tasks");
    }
  }, [canAdminister, canAssignWork, canOpenLiveMap, view]);

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks],
  );
  const urgentTasks = useMemo(
    () => openTasks.filter((task) => task.priority === "urgent" || task.priority === "high"),
    [openTasks],
  );

  const taskBoardAgents = useMemo(
    () => filterLiveWorkforceAgents(agents).filter((agent) => agent.status !== "archived"),
    [agents],
  );

  const filteredBoardTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    return tasks.filter((task) => {
      if (taskFilterAssignee && task.assigneeAgentId !== taskFilterAssignee) return false;
      if (taskFilterPriority && task.priority !== taskFilterPriority) return false;
      if (taskFilterProject && task.projectId !== taskFilterProject) return false;
      if (!q) return true;
      const hay = `${task.title} ${task.brief ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [taskFilterAssignee, taskFilterPriority, taskFilterProject, taskSearch, tasks]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of TASK_COLUMNS) map.set(status, []);
    for (const task of filteredBoardTasks) {
      const list = map.get(task.status) ?? [];
      list.push(task);
      map.set(task.status, list);
    }
    return map;
  }, [filteredBoardTasks]);

  const taskStats = useMemo(() => {
    const open = tasks.filter((task) => task.status !== "done").length;
    const inProgress = tasks.filter((task) => task.status === "in_progress").length;
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    const done = tasks.filter((task) => task.status === "done").length;
    return { open, inProgress, blocked, done, total: tasks.length };
  }, [tasks]);

  const liveReport = useMemo(() => {
    if (report) return report;
    return buildWorkforceReport({
      operator,
      agents,
      teams,
      tasks,
      knowledge,
      taskRuns,
      pendingApprovals,
    });
  }, [agents, knowledge, operator, pendingApprovals, report, taskRuns, tasks, teams]);

  const agentTokenRows = useMemo(() => {
    const roster = [
      ...taskBoardAgents,
      ...agents.filter((agent) => !taskBoardAgents.some((live) => live.id === agent.id)),
    ];
    const resolveName = (agentId: string | null | undefined, index: number) => {
      if (!agentId) return t("unassigned");
      const exact = roster.find((agent) => agent.id === agentId);
      const bySuffix = roster.find(
        (agent) =>
          agent.id.endsWith(agentId) ||
          agentId.endsWith(agent.id) ||
          agent.id.replace(/^agt[_-]?/i, "") === agentId.replace(/^agt[_-]?/i, ""),
      );
      const found = (exact ?? bySuffix)?.name?.trim();
      if (found && !/^agt[_-]/i.test(found) && found !== agentId) return found;
      if (roster.length === 1) {
        const solo = roster[0]?.name?.trim();
        if (solo && !/^agt[_-]/i.test(solo)) return solo;
      }
      if (roster[index]?.name?.trim()) return roster[index]!.name.trim();
      return t("hqReportsEmployee");
    };
    const fromApi = usageSummary?.byAgent;
    const source =
      fromApi && fromApi.length > 0
        ? fromApi
        : (() => {
            const map = new Map<
              string,
              { agentId: string | null; inputTokens: number; outputTokens: number; events: number }
            >();
            for (const event of usageSummary?.recent ?? []) {
              const key = event.agentId ?? "__unassigned__";
              const row = map.get(key) ?? {
                agentId: event.agentId,
                inputTokens: 0,
                outputTokens: 0,
                events: 0,
              };
              row.inputTokens += event.inputTokens;
              row.outputTokens += event.outputTokens;
              row.events += 1;
              map.set(key, row);
            }
            return [...map.values()];
          })();

    const rows = source
      .map((row, index) => ({
        ...row,
        name: resolveName(row.agentId, index),
        total: row.inputTokens + row.outputTokens,
      }))
      .sort((a, b) => b.total - a.total);

    // If usage only has orphaned IDs but we have a live roster, fold orphan
    // spend onto the matching roster person so the board never shows "Employee 1".
    if (rows.length > 0 && roster.length > 0) {
      const orphaned = rows.every(
        (row) => !row.agentId || !roster.some((agent) => agent.id === row.agentId),
      );
      if (orphaned && roster.length === 1 && rows.length === 1) {
        return [
          {
            ...rows[0]!,
            agentId: roster[0]!.id,
            name: roster[0]!.name.trim() || t("hqReportsEmployee"),
          },
        ];
      }
    }
    return rows;
  }, [agents, t, taskBoardAgents, usageSummary]);

  const selectedAgentTokens = useMemo(() => {
    if (!reportAgentId) {
      return {
        inputTokens: usageSummary?.totals.inputTokens ?? liveReport.usage.inputTokens,
        outputTokens: usageSummary?.totals.outputTokens ?? liveReport.usage.outputTokens,
        events: usageSummary?.totals.events ?? liveReport.usage.events,
        label: t("hqReportsAllEmployees"),
      };
    }
    const row = agentTokenRows.find((item) => item.agentId === reportAgentId);
    return {
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      events: row?.events ?? 0,
      label: row?.name ?? t("unassigned"),
    };
  }, [agentTokenRows, liveReport.usage, reportAgentId, t, usageSummary]);

  const selectedAgentRecent = useMemo(() => {
    const recent = usageSummary?.recent ?? [];
    if (!reportAgentId) return recent.slice(0, 10);
    return recent.filter((item) => item.agentId === reportAgentId).slice(0, 10);
  }, [reportAgentId, usageSummary]);

  const featureLogEntries = useMemo(() => {
    const fromReport = liveReport.recentActivity ?? [];
    const merged = [...featureLog, ...fromReport];
    const seen = new Set<string>();
    const unique: Activity[] = [];
    for (const entry of merged) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      unique.push(entry);
    }
    return unique
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
  }, [featureLog, liveReport.recentActivity]);

  useEffect(() => {
    if (view !== "reports") return;
    const refreshReport = () => {
      void Promise.all([
        arrabApi.reportSummary().catch(() => null),
        arrabApi.usage().catch(() => null),
        arrabApi.activity().catch(() => ({ items: [] as Activity[] })),
      ]).then(([rep, usage, activity]) => {
        if (rep) {
          setReport(rep);
        } else {
          setReport(
            buildWorkforceReport({
              operator,
              agents,
              teams,
              tasks,
              knowledge,
              taskRuns,
              pendingApprovals,
            }),
          );
        }
        if (usage) setUsageSummary(usage);
        if (activity?.items) setFeatureLog(activity.items);
      });
    };
    refreshReport();
    const id = window.setInterval(refreshReport, 10_000);
    window.addEventListener("focus", refreshReport);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refreshReport);
    };
  }, [agents, knowledge, operator, pendingApprovals, taskRuns, tasks, teams, view]);

  useEffect(() => {
    if (view !== "tasks") return;
    const refreshTasks = () => {
      void arrabApi.tasks().then(
        (res) => setTasks(res.items),
        () => undefined,
      );
    };
    const id = window.setInterval(refreshTasks, 12_000);
    window.addEventListener("focus", refreshTasks);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refreshTasks);
    };
  }, [view]);

  const projectRepo = useCallback(
    (projectId: string | null) =>
      projectId
        ? bindings.find((binding) => binding.projectId === projectId)?.repoFullName ?? null
        : null,
    [bindings],
  );

  const agentName = useCallback(
    (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? t("unassigned"),
    [agents, t],
  );

  async function saveOperatorSeat(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await arrabApi.updateOperator({
        displayName: ceoName.trim() || "Studio operator",
        title: selectedSeat.trim() || null,
      });
      setOperator(updated);
      setSeatEdit(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function createSeat() {
    const seat = newSeat.trim();
    if (!seat) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await arrabApi.updateOperator({ addSeat: seat });
      setOperator(updated);
      setSelectedSeat(seat);
      setNewSeat("");
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function launchTeam(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const purposeParts = [
        mission.trim() || null,
        `mode:${mode}`,
        `approval:${approval}`,
        `automation:${automation}`,
      ].filter(Boolean);
      const team = await arrabApi.createTeam({
        name: teamName,
        purpose: purposeParts.join(" · "),
        projectId: projectId || null,
      });
      const meta: TeamMeta = { mode, approval, automation, roles };
      const nextMeta = { ...teamMeta, [team.id]: meta };
      setTeamMeta(nextMeta);
      writeTeamMeta(nextMeta);

      for (const roleId of roles) {
        const label = ROLE_KEYS.find((role) => role.id === roleId);
        const agent = await arrabApi.createAgent({
          name: `${teamName} ${label ? t(label.labelKey) : roleId}`,
          role: roleId,
          projectId: projectId || null,
          status: approval === "auto" ? "active" : "draft",
        });
        await arrabApi.addTeamMember(team.id, { agentId: agent.id });
      }

      setTeamName("");
      setMission("");
      setProjectId("");
      setRoles(["researcher", "engineer"]);
      setComposeOpen(false);
      load();
      if (ops.notifyOnLaunch) {
        void notifyStudio({
          kind: "teamLaunch",
          title: t("teamLaunchNotify"),
          body: team.name,
          href: "/workforce",
          agentName: team.name,
          hue: 262,
          faceSeed: 44,
          presenceState: "working",
          progress: 0.4,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await arrabApi.createTask({
        title: taskTitle.trim(),
        brief: taskBrief.trim() || null,
        priority: taskPriority,
        assigneeAgentId: taskAssignee || null,
        teamId: taskTeam || null,
        projectId: taskProject || null,
      });
      setTasks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setTaskTitle("");
      setTaskBrief("");
      setTaskPriority("medium");
      setTaskAssignee("");
      setTaskTeam("");
      setTaskProject("");
      setTaskFormOpen(false);
      pushToast({ title: t("hqTasksCreated"), tone: "success" });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function setTaskStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    setTasks((prev) =>
      prev.map((item) => (item.id === task.id ? { ...item, status, updatedAt: new Date().toISOString() } : item)),
    );
    try {
      const updated = await arrabApi.updateTask(task.id, { status });
      setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      load();
    }
  }

  async function advanceTask(task: Task) {
    const order: TaskStatus[] = ["backlog", "assigned", "in_progress", "blocked", "done"];
    const index = order.indexOf(task.status);
    const next = order[Math.min(index + 1, order.length - 1)];
    if (!next || next === task.status) return;
    await setTaskStatus(task, next);
  }

  async function removeTask(task: Task) {
    setTasks((prev) => prev.filter((item) => item.id !== task.id));
    try {
      await arrabApi.deleteTask(task.id);
      pushToast({ title: t("hqTasksDeleted"), tone: "success" });
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      load();
    }
  }

  function taskColumnLabel(status: TaskStatus): string {
    switch (status) {
      case "backlog":
        return t("taskColBacklog");
      case "assigned":
        return t("taskColAssigned");
      case "in_progress":
        return t("taskColInProgress");
      case "blocked":
        return t("taskColBlocked");
      case "done":
        return t("taskColDone");
    }
  }

  function priorityLabel(priority: TaskPriority): string {
    switch (priority) {
      case "urgent":
        return t("priorityUrgent");
      case "high":
        return t("priorityHigh");
      case "medium":
        return t("priorityMedium");
      case "low":
        return t("priorityLow");
    }
  }

  function featureLabel(objectType: string): string {
    const key = objectType.trim().toLowerCase();
    if (key.includes("task")) return t("featureLogTasks");
    if (key.includes("knowledge") || key.includes("doc")) return t("featureLogKnowledge");
    if (key.includes("agent") || key.includes("employee")) return t("featureLogAgents");
    if (key.includes("approval")) return t("featureLogApprovals");
    if (key.includes("team")) return t("featureLogTeams");
    if (key.includes("project")) return t("featureLogProjects");
    if (key.includes("memory")) return t("featureLogMemory");
    if (key.includes("usage") || key.includes("token")) return t("featureLogUsage");
    if (key.includes("skill")) return t("featureLogSkills");
    return t("featureLogActivity");
  }

  async function runTask(task: Task) {
    if (!task.assigneeAgentId) {
      setError(t("assignBeforeRun"));
      return;
    }
    setRunningTaskId(task.id);
    setError(null);
    setRunPreview(null);
    try {
      const requireApproval =
        ops.highRiskDual && (task.priority === "high" || task.priority === "urgent");
      const result = await arrabApi.runTask(task.id, { requireApproval });
      if (result.approval) {
        setRunPreview(t("runAwaitingApproval"));
      } else {
        setRunPreview(result.assistantMessage ?? result.run.summary);
        if (result.conversationId && result.providerConfigured) {
          openChat(task.assigneeAgentId, task);
        }
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setRunningTaskId(null);
    }
  }

  const filteredKnowledge = useMemo(() => {
    const q = knowSearch.trim().toLowerCase();
    if (!q) return knowledge;
    return knowledge.filter((doc) => {
      const hay = `${doc.title} ${doc.content}`.toLowerCase();
      return hay.includes(q);
    });
  }, [knowSearch, knowledge]);

  const knowledgeStats = useMemo(() => {
    const orgWide = knowledge.filter((doc) => !doc.projectId).length;
    const projectScoped = knowledge.length - orgWide;
    const chars = knowledge.reduce((sum, doc) => sum + (doc.content?.length ?? 0), 0);
    return { total: knowledge.length, orgWide, projectScoped, chars };
  }, [knowledge]);

  async function createKnowledge(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await arrabApi.createKnowledge({
        title: knowTitle.trim(),
        content: knowContent.trim(),
        projectId: knowProject || null,
      });
      setKnowledge((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setKnowTitle("");
      setKnowContent("");
      setKnowProject("");
      setKnowledgeFormOpen(false);
      pushToast({ title: t("hqKnowSaved"), tone: "success" });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteKnowledge(id: string) {
    const previous = knowledge;
    setKnowledge((prev) => prev.filter((item) => item.id !== id));
    try {
      await arrabApi.deleteKnowledge(id);
      pushToast({ title: t("hqKnowDeleted"), tone: "success" });
    } catch (err: unknown) {
      setKnowledge(previous);
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function uploadKnowledgeFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const allowed = /\.(txt|md|markdown|csv|json|html|htm|log)$/i;
    setKnowUploading(true);
    setError(null);
    let saved = 0;
    try {
      for (const file of Array.from(fileList)) {
        if (!allowed.test(file.name)) {
          pushToast({ title: t("hqKnowUploadType"), tone: "warn" });
          continue;
        }
        if (file.size > 400_000) {
          pushToast({ title: t("hqKnowUploadSize"), tone: "warn" });
          continue;
        }
        const text = (await file.text()).trim();
        if (text.length < 8) {
          pushToast({ title: t("hqKnowUploadEmpty"), tone: "warn" });
          continue;
        }
        const title = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || file.name;
        const created = await arrabApi.createKnowledge({
          title,
          content: text.slice(0, 100_000),
          projectId: knowProject || null,
        });
        setKnowledge((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        saved += 1;
      }
      if (saved > 0) {
        pushToast({
          title: t("hqKnowUploaded").replace("{n}", String(saved)),
          tone: "success",
        });
        load();
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setKnowUploading(false);
    }
  }

  async function activateAgent(id: string) {
    try {
      if (ops.draftsNeedActivation) {
        const agent = agents.find((item) => item.id === id);
        await arrabApi.createApproval({
          kind: "activate_agent",
          title: `Activate ${agent?.name ?? "employee"}`,
          detail: agent ? `${agent.role} · draft → active` : null,
          agentId: id,
        });
      } else {
        await arrabApi.updateAgent(id, { status: "active" });
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function resolveApproval(id: string, status: "approved" | "rejected") {
    try {
      const result = await arrabApi.resolveApproval(id, { status });
      if (result.run?.assistantMessage) {
        setRunPreview(result.run.assistantMessage);
      } else if (status === "approved") {
        setRunPreview(t("approvalGranted"));
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  function talkTo(agentId: string, task?: Task) {
    openChat(agentId, task);
    navigate("/chat");
  }

  function openCoworkWith(agentId: string, task?: Task) {
    prepareWorkplaceStudio({ agentId, task: task ?? null, kindId: "arrab-assistant" });
    navigate(`${ROLE_PATH.organization}/workplace`);
  }

  function openEmployeeDesk(agentId: string) {
    openDesk(agentId);
    navigate(`/desk/${agentId}`);
  }

  async function openAllHandsChat() {
    setSaving(true);
    setError(null);
    try {
      let team = teams.find((item) => item.name === ALL_HANDS_TEAM) ?? null;
      if (!team) {
        team = await arrabApi.createTeam({
          name: ALL_HANDS_TEAM,
          purpose: "Studio-wide room with every active agent",
          projectId: null,
        });
      }
      const existing = new Set(
        memberships.filter((item) => item.teamId === team!.id).map((item) => item.agentId),
      );
      const roster = agents.filter(
        (agent) => agent.status === "active" || agent.status === "paused",
      );
      for (const agent of roster) {
        if (!existing.has(agent.id)) {
          await arrabApi.addTeamMember(team.id, { agentId: agent.id });
        }
      }
      openTeamChat(team.id);
      navigate("/chat");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  function publishDirective(event: FormEvent) {
    event.preventDefault();
    const text = directiveDraft.trim();
    if (!text || directiveBusy) return;
    const next = [
      { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() },
      ...directives,
    ].slice(0, 12);
    setDirectives(next);
    setDirectiveDraft("");
    setDirectiveBusy(true);
    setDirectiveFlash(null);
    void (async () => {
      try {
        await arrabApi.createKnowledge({
          title: "HQ operator directives",
          content: next.map((item) => `- ${item.text}`).join("\n"),
          projectId: null,
        });
        const active = agents.filter(
          (agent) => agent.status === "active" || agent.status === "draft",
        );
        await Promise.all(
          active.slice(0, 20).map((agent) =>
            arrabApi.createMemory({
              content: `HQ directive: ${text}`,
              agentId: agent.id,
              projectId: agent.projectId,
            }),
          ),
        );
        setDirectiveFlash(t("directivePublished"));
        load();
      } catch {
        setDirectiveFlash(t("directiveSavedLocal"));
      } finally {
        setDirectiveBusy(false);
        window.setTimeout(() => setDirectiveFlash(null), 2800);
      }
    })();
  }

  function removeDirective(id: string) {
    const next = directives.filter((item) => item.id !== id);
    setDirectives(next);
    void (async () => {
      try {
        await arrabApi.createKnowledge({
          title: "HQ operator directives",
          content: next.length
            ? next.map((item) => `- ${item.text}`).join("\n")
            : "No active directives.",
          projectId: null,
        });
      } catch {
        // local list already updated
      }
    })();
  }

  function formatDirectiveAge(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return t("minsAgo").replace("{n}", String(mins));
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("hoursAgo").replace("{n}", String(hours));
    const days = Math.floor(hours / 24);
    return t("daysAgo").replace("{n}", String(days));
  }

  async function hireAgent(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (hireTeamId) {
        const seated = (membersByTeam.get(hireTeamId) ?? []).filter(
          (agent) => agent.status !== "archived",
        ).length;
        if (seated >= MAX_DEPT_AGENTS) {
          setError(t("deptFull"));
          setSaving(false);
          return;
        }
      }
      const agent = await arrabApi.createAgent({
        name: hireName.trim(),
        role: hireRole.trim() || "teammate",
        specialty: hireSpecialty.trim() || null,
        bio: hireBio.trim() || null,
        instructions: hireInstructions.trim() || null,
        projectId: hireProjectId || null,
        teamId: hireTeamId || null,
        status: hireActive ? "active" : "draft",
        starterBrief: hireBrief.trim() || null,
        starterKnowledge:
          hireKnowledgeTitle.trim() && hireKnowledge.trim()
            ? { title: hireKnowledgeTitle.trim(), content: hireKnowledge.trim() }
            : null,
      });
      setHireOpen(false);
      setHireAdvanced(false);
      setHireName("");
      setHireRole("");
      setHireSpecialty("");
      setHireBio("");
      setHireInstructions("");
      setHireBrief("");
      setHireKnowledgeTitle("");
      setHireKnowledge("");
      setHireProjectId("");
      setHireTeamId("");
      setHireActive(true);
      setInspector("pulse");
      setAgents((current) => [agent, ...current.filter((item) => item.id !== agent.id)]);
      load();
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) setError(message);
    } finally {
      setSaving(false);
    }
  }

  function openHireOnMap(teamId = "") {
    setHireTeamId(teamId);
    setHireOpen(true);
  }

  async function setPersonStatus(id: string, status: "active" | "paused") {
    setAgentMenu(null);
    setPendingDeleteId(null);
    const previous = agents;
    setAgentBusy(true);
    setAgents((current) =>
      current.map((agent) => (agent.id === id ? { ...agent, status } : agent)),
    );
    try {
      const updated = await arrabApi.updateAgent(id, { status });
      setAgents((current) =>
        current.map((agent) => (agent.id === updated.id ? updated : agent)),
      );
    } catch (err: unknown) {
      setAgents(previous);
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setError(isTransientApiError(message) ? t("chatDeleteFailed") : message);
    } finally {
      setAgentBusy(false);
    }
  }

  async function archivePerson(id: string) {
    setAgentMenu(null);
    setPendingDeleteId(null);
    if (selectedAgentId === id) setSelectedAgentId(null);
    setAgentBusy(true);
    setError(null);
    setAgents((current) => current.filter((agent) => agent.id !== id));
    setMemberships((current) => current.filter((item) => item.agentId !== id));
    try {
      try {
        await arrabApi.archiveAgent(id);
      } catch {
        await arrabApi.updateAgent(id, { status: "archived" });
      }
      setRemovedAgentIds(rememberRemovedAgent(id));
    } catch {
      // Keep them gone locally — never show a delete/archive failure banner.
      setRemovedAgentIds(rememberRemovedAgent(id));
    } finally {
      setAgentBusy(false);
    }
  }

  async function deletePerson(id: string) {
    setAgentMenu(null);
    setPendingDeleteId(null);
    if (selectedAgentId === id) setSelectedAgentId(null);
    setAgentBusy(true);
    setError(null);
    setAgents((current) => current.filter((agent) => agent.id !== id));
    setMemberships((current) => current.filter((item) => item.agentId !== id));
    try {
      try {
        await arrabApi.removeAgent(id);
      } catch {
        try {
          await arrabApi.deleteAgent(id);
        } catch {
          try {
            await arrabApi.archiveAgent(id);
          } catch {
            await arrabApi.updateAgent(id, { status: "archived" });
          }
        }
      }
      setRemovedAgentIds(rememberRemovedAgent(id));
    } catch {
      // Last resort: stay removed in this studio — chats remain in the database.
      setRemovedAgentIds(rememberRemovedAgent(id));
    } finally {
      setAgentBusy(false);
    }
  }

  function openAgentMenu(agentId: string, clientX: number, clientY: number) {
    setSelectedAgentId(agentId);
    setPendingDeleteId(null);
    const pad = 12;
    const width = 230;
    const height = 320;
    const x = Math.min(Math.max(pad, clientX), window.innerWidth - width - pad);
    // Prefer opening upward so the menu never drops off the bottom of the screen.
    const openUp = clientY + height > window.innerHeight - pad;
    const y = openUp
      ? Math.max(pad, clientY - height)
      : Math.min(clientY, window.innerHeight - height - pad);
    setAgentMenu({ agentId, x, y, openUp });
  }

  function setAgentApproval(agentId: string, policy: AgentSessionPolicy) {
    writeAgentSessionPolicy(agentId, policy);
    setPolicyTick((n) => n + 1);
    setAgentMenu(null);
  }

  async function renamePerson(id: string) {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return;
    setAgentMenu(null);
    const next = window.prompt(t("wfRenamePrompt"), agent.name)?.trim();
    if (!next || next === agent.name) return;
    setAgentBusy(true);
    try {
      const updated = await arrabApi.updateAgent(id, { name: next });
      setAgents((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAgentBusy(false);
    }
  }

  async function duplicatePerson(id: string) {
    const source = agents.find((item) => item.id === id);
    if (!source) return;
    setAgentMenu(null);
    setAgentBusy(true);
    try {
      const created = await arrabApi.createAgent({
        name: `${source.name} ${t("chatAgentCopySuffix")}`,
        role: source.role,
        specialty: source.specialty,
        bio: source.bio,
        instructions: source.instructions,
        projectId: source.projectId,
        status: "active",
      });
      setAgents((current) => [created, ...current]);
      setSelectedAgentId(created.id);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAgentBusy(false);
    }
  }

  async function movePersonToTeam(id: string) {
    setAgentMenu(null);
    if (orderedOrgTeams.length === 0) {
      setComposeOpen(true);
      return;
    }
    const choices = orderedOrgTeams.map((team, index) => `${index + 1}. ${team.name}`).join("\n");
    const pick = window.prompt(`${t("wfMoveToTeamPrompt")}\n${choices}`, "1")?.trim();
    if (!pick) return;
    const index = Number.parseInt(pick, 10) - 1;
    const team = orderedOrgTeams[index] ?? orderedOrgTeams.find((item) => item.name === pick);
    if (!team) return;
    setAgentBusy(true);
    try {
      await arrabApi.addTeamMember(team.id, { agentId: id });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAgentBusy(false);
    }
  }

  function copyAgentId(id: string) {
    setAgentMenu(null);
    void navigator.clipboard?.writeText(id);
  }

  async function tellSelectedAgent(event: FormEvent) {
    event.preventDefault();
    const targetId = tellAgentId || peopleAgents[0]?.id || "";
    if (!targetId || !tellText.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const agent = agents.find((item) => item.id === targetId);
      await arrabApi.createMemory({
        content: tellText.trim(),
        agentId: targetId,
        projectId: agent?.projectId ?? null,
      });
      setTellText("");
      setTellAgentId(targetId);
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onAssignWork(event: FormEvent) {
    event.preventDefault();
    setAssignError(null);
    setAssignOk(null);
    if (!canAssignWork) {
      setAssignError(t("hqAssignDenied"));
      return;
    }
    if (!assignText.trim()) {
      setAssignError(t("studioAssignEmpty"));
      return;
    }
    if (!resolvedAssignee) {
      setAssignError(
        parsedAssign.nameHint
          ? t("studioAssignUnknown").replace("{name}", parsedAssign.nameHint)
          : t("studioAssignPick"),
      );
      return;
    }
    setAssignBusy(true);
    try {
      const title = (parsedAssign.title || assignText).trim().slice(0, 120) || "Task";
      const task = await arrabApi.createTask({
        title,
        brief: assignText.trim() || null,
        assigneeAgentId: resolvedAssignee.id,
        status: "assigned",
        priority: assignPriority,
      });
      const doneBody = t("studioAssignDoneBody")
        .replace("{task}", task.title)
        .replace("{name}", resolvedAssignee.name);
      setAssignText("");
      setAssignAgentId(null);
      setAssignPriority("medium");
      setAssignOk(doneBody);
      pushToast({
        title: t("studioAssignDone"),
        body: doneBody,
        tone: "success",
        href: "/workforce",
      });
      void notifyStudio({
        kind: "cowork",
        title: t("studioAssignDone"),
        body: doneBody,
        href: "/workforce",
      });
      load();
      window.setTimeout(() => setView("tasks"), 900);
    } catch (err: unknown) {
      setAssignError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAssignBusy(false);
    }
  }

  function assignInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }

  const views = (
    [
      ...(canOpenLiveMap ? ([["map", t("hqLiveMap"), MapIcon]] as const) : []),
      ["org", t("peopleRoster"), UsersRound],
      ...(canAssignWork ? ([["assign", t("studioAssignTitle"), ListTodo]] as const) : []),
      ...(canAdminister ? ([["admin", t("hqAdmin"), Settings2]] as const) : []),
      ["tasks", t("ccTasks"), ClipboardList],
      ["knowledge", t("ccKnowledge"), BookOpen],
      ["chat", t("ccChat"), MessageSquare],
      ...(canAdminister ? ([["reports", t("ccReports"), BarChart3]] as const) : []),
    ] as const
  );

  return (
    <Surface className="workforce-shell hq-shell chat-comfy flex h-full flex-col overflow-hidden">
      <div className="workforce-atmosphere pointer-events-none absolute inset-0" />
      <div className="hq-atmosphere pointer-events-none absolute inset-0 opacity-60" />

      {view === "map" ? (
        <div className="relative z-10 h-full min-h-0">
          <AgentsOfficeHost
            onBack={() => setView("org")}
            departments={[
              ...orderedOrgTeams.map((team) => ({
                id: team.id,
                name: team.name,
                agents: (membersByTeam.get(team.id) ?? [])
                  .filter((agent) => agent.status !== "archived")
                  .slice(0, MAX_DEPT_AGENTS)
                  .map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                    role: agent.role,
                    specialty: agent.specialty,
                  })),
              })),
              ...(unassignedAgents.length
                ? [
                    {
                      id: "unassigned",
                      name: "Workforce",
                      agents: unassignedAgents.slice(0, MAX_DEPT_AGENTS).map((agent) => ({
                        id: agent.id,
                        name: agent.name,
                        role: agent.role,
                        specialty: agent.specialty,
                      })),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : (
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="hq-rise flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white text-black">
              <Crown className="size-3.5" strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-medium tracking-[-0.03em] text-white">
                  {t("hqTitle")}
                </h1>
              </div>
              <p className="truncate text-[11px] text-neutral-500">
                {operator?.displayName ?? t("operatorSeat")}
                {" · "}
                {operator?.title ?? t("noSeatChosen")}
                {" · "}
                {orgTeams.length} {t("teams")} · {peopleAgents.length} {t("employees")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setSeatEdit((v) => !v)}
              className="chat-pro-icon-btn"
              title={t("operatorSeat")}
              aria-label={t("operatorSeat")}
            >
              <Crown className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => navigate(`${ROLE_PATH.organization}/workplace`)}
              className="chat-pro-icon-btn"
              title={t("hqOpenCowork")}
              aria-label={t("hqOpenCowork")}
            >
              <Laptop className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => {
                setView("tasks");
                setTaskFormOpen(true);
              }}
              className="chat-pro-icon-btn"
              title={t("assignTask")}
            >
              <ClipboardList className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="chat-pro-icon-btn"
              title={t("workforceCompose")}
            >
              <UsersRound className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              id="hire"
              onClick={() => setHireOpen(true)}
              className="ms-1 hidden h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-black sm:inline-flex"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              {t("hireAgent")}
            </button>
          </div>
        </header>

        {seatEdit ? (
          <form
            onSubmit={saveOperatorSeat}
            className="hq-rise shrink-0 border-b border-white/[0.06] bg-black/40 px-4 py-3 lg:px-6"
          >
            <p className="chat-pro-kicker mb-2">{t("operatorSeat")}</p>
            <p className="mb-3 text-[12px] text-neutral-500">{t("seatFlowHint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                  {t("profileName")}
                </span>
                <input
                  value={ceoName}
                  onChange={(e) => setCeoName(e.target.value)}
                  className="field min-w-[160px]"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                  {t("chooseSeat")}
                </span>
                <select
                  value={selectedSeat}
                  onChange={(e) => setSelectedSeat(e.target.value)}
                  className="field min-w-[140px]"
                >
                  <option value="">{t("noSeatChosen")}</option>
                  {(operator?.seats ?? []).map((seat) => (
                    <option key={seat} value={seat}>
                      {seat}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="chat-pro-cta !h-9 !px-4 !text-[12px]"
              >
                {t("saveSeat")}
              </button>
              <input
                value={newSeat}
                onChange={(e) => setNewSeat(e.target.value)}
                placeholder={t("seatPlaceholder")}
                className="field min-w-[160px]"
              />
              <button
                type="button"
                disabled={saving || !newSeat.trim()}
                onClick={() => void createSeat()}
                className="h-9 rounded-full border border-white/20 px-4 text-[12px] text-white disabled:opacity-40"
              >
                {t("addSeat")}
              </button>
            </div>
          </form>
        ) : null}

        {error && !isTransientApiError(error) ? (
          <div className="hq-rise mx-4 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.03] px-3 py-2.5 lg:mx-6">
            <p className="text-[13px] text-neutral-300">{error}</p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => load()}
                className="h-8 rounded-full bg-white px-3 text-[11px] font-medium text-black"
              >
                {t("retry")}
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="chat-pro-icon-btn"
                aria-label={t("close")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-1 flex min-h-0 flex-1 overflow-hidden">
          <nav className="hidden shrink-0 flex-col gap-0.5 border-e border-white/[0.06] bg-[var(--color-background)] px-2 py-3 sm:flex sm:w-[148px]">
            {views.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] transition-colors",
                  view === id
                    ? "bg-white/[0.08] text-white"
                    : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.7} />
                {label}
              </button>
            ))}
            <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-3">
              <p className="px-2 chat-pro-kicker">{t("hqPulse")}</p>
              <p className="px-2 text-[11px] text-neutral-500">
                {openTasks.length} {t("openTasks").toLowerCase()}
              </p>
              <p className="px-2 text-[11px] text-neutral-500">
                {pendingApprovalCount} {t("pendingApprovals").toLowerCase()}
              </p>
            </div>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2 sm:hidden">
              {views.map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]",
                    view === id ? "bg-white text-black" : "text-neutral-400",
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
            {view === "assign" && canAssignWork ? (
              <section className="hq-assign workforce-rise" aria-label={t("studioAssignTitle")}>
                <header className="hq-assign-mast">
                  <div className="min-w-0">
                    <p className="chat-pro-kicker">{t("studioAssignTitle")}</p>
                    <h2 className="hq-assign-title">{t("hqAssignHeadline")}</h2>
                    <p className="hq-assign-lead">{t("hqAssignHint")}</p>
                  </div>
                  <div className="hq-assign-badges">
                    <span className="hq-assign-badge">
                      {seatRole === "admin" ? t("hqRoleAdmin") : t("hqRoleManager")}
                    </span>
                    <span className="hq-assign-badge is-muted">
                      {peopleAgents.length} {t("employees")}
                    </span>
                  </div>
                </header>

                <form
                  onSubmit={(event) => void onAssignWork(event)}
                  className="hq-assign-grid"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.requestSubmit();
                    }
                  }}
                >
                  <div className="hq-assign-composer">
                    <label className="hq-assign-label" htmlFor="hq-assign-brief">
                      <Sparkles className="size-3.5" />
                      {t("hqAssignBriefLabel")}
                    </label>
                    <textarea
                      id="hq-assign-brief"
                      value={assignText}
                      onChange={(event) => {
                        setAssignText(event.target.value);
                        setAssignError(null);
                        setAssignOk(null);
                      }}
                      rows={6}
                      className="hq-assign-input"
                      placeholder={t("studioAssignPlaceholder")}
                      disabled={peopleAgents.length === 0 || assignBusy}
                    />
                    <div className="hq-assign-examples" aria-label={t("hqAssignExamples")}>
                      {[
                        t("hqAssignExample1"),
                        t("hqAssignExample2"),
                        t("hqAssignExample3"),
                      ].map((example) => (
                        <button
                          key={example}
                          type="button"
                          className="hq-assign-example"
                          disabled={assignBusy || peopleAgents.length === 0}
                          onClick={() => {
                            setAssignText(example);
                            setAssignError(null);
                            setAssignOk(null);
                          }}
                        >
                          {example}
                        </button>
                      ))}
                    </div>

                    <div className="hq-assign-priority">
                      <span className="hq-assign-label">
                        <CircleDot className="size-3.5" />
                        {t("taskPriority")}
                      </span>
                      <div className="hq-assign-priority-row">
                        {(["low", "medium", "high", "urgent"] as TaskPriority[]).map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={cn(
                              "hq-assign-priority-chip",
                              assignPriority === level && "is-on",
                              `is-${level}`,
                            )}
                            onClick={() => setAssignPriority(level)}
                            disabled={assignBusy}
                          >
                            {t(
                              level === "low"
                                ? "hqAssignPriorityLow"
                                : level === "medium"
                                  ? "hqAssignPriorityMedium"
                                  : level === "high"
                                    ? "hqAssignPriorityHigh"
                                    : "hqAssignPriorityUrgent",
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <aside className="hq-assign-roster">
                    <label className="hq-assign-label" htmlFor="hq-assign-search">
                      <UserRound className="size-3.5" />
                      {t("hqAssignRosterLabel")}
                    </label>
                    <div className="hq-assign-search">
                      <Search className="size-3.5 opacity-50" />
                      <input
                        id="hq-assign-search"
                        value={assignPeopleQuery}
                        onChange={(event) => setAssignPeopleQuery(event.target.value)}
                        placeholder={t("hqAssignSearchPeople")}
                        disabled={peopleAgents.length === 0 || assignBusy}
                      />
                    </div>
                    {peopleAgents.length > 0 ? (
                      <ul className="hq-assign-people" role="listbox" aria-label={t("hqAssignRosterLabel")}>
                        {assignRoster.map((agent) => {
                          const active = resolvedAssignee?.id === agent.id;
                          return (
                            <li key={agent.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={cn("hq-assign-person", active && "is-on")}
                                onClick={() =>
                                  setAssignAgentId((current) =>
                                    current === agent.id ? null : agent.id,
                                  )
                                }
                                disabled={assignBusy}
                              >
                                <span className="hq-assign-avatar">{assignInitials(agent.name)}</span>
                                <span className="min-w-0 flex-1 text-start">
                                  <span className="hq-assign-person-name">{agent.name}</span>
                                  <span className="hq-assign-person-role">
                                    {agent.role || agent.specialty || "—"}
                                  </span>
                                </span>
                                {active ? <CheckCircle2 className="size-4 shrink-0" /> : null}
                              </button>
                            </li>
                          );
                        })}
                        {assignRoster.length === 0 ? (
                          <li className="hq-assign-empty">{t("hqAssignNoMatch")}</li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="hq-assign-empty">{t("studioAssignNeedPeople")}</p>
                    )}
                  </aside>

                  <footer className="hq-assign-foot">
                    <div className="hq-assign-preview">
                      {resolvedAssignee ? (
                        <p>
                          {t("studioAssignWillGo")
                            .replace("{name}", resolvedAssignee.name)
                            .replace("{task}", parsedAssign.title.trim() || assignText.trim() || "…")}
                        </p>
                      ) : (
                        <p className="is-muted">{t("hqAssignPreviewEmpty")}</p>
                      )}
                      {assignError ? <p className="hq-assign-error">{assignError}</p> : null}
                      {assignOk ? (
                        <p className="hq-assign-success">
                          <CheckCircle2 className="size-3.5" />
                          {assignOk}
                        </p>
                      ) : null}
                    </div>
                    <div className="hq-assign-actions">
                      <button
                        type="button"
                        className="hq-assign-secondary"
                        disabled={assignBusy || (!assignText && !assignAgentId)}
                        onClick={() => {
                          setAssignText("");
                          setAssignAgentId(null);
                          setAssignPriority("medium");
                          setAssignError(null);
                          setAssignOk(null);
                        }}
                      >
                        {t("clear")}
                      </button>
                      <button
                        type="submit"
                        disabled={assignBusy || peopleAgents.length === 0 || !assignText.trim()}
                        className="hq-assign-submit"
                      >
                        <Send className="size-3.5" />
                        {assignBusy ? t("saving") : t("studioAssignCta")}
                      </button>
                    </div>
                  </footer>
                </form>
              </section>
            ) : null}

            {view === "admin" && canAdminister ? (
              <div className="mx-auto grid max-w-6xl gap-4">
                <OrgAdministrationPanel teams={orgTeams} onTeamsChanged={() => load()} />
                <div className="grid gap-4 lg:grid-cols-2">
                <section className="hq-panel rounded-[22px] border border-white/[0.08] bg-[var(--color-surface)] p-5">
                  <p className="chat-pro-kicker">{t("hqAdmin")}</p>
                  <h2 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-white">
                    {t("hqAdminTitle")}
                  </h2>
                  <p className="mt-2 text-[13px] text-neutral-400">{t("hqAdminBody")}</p>
                  <dl className="mt-5 space-y-3 text-[13px]">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                      <dt className="text-neutral-500">{t("operatorSeat")}</dt>
                      <dd className="text-neutral-200">{activeSeatTitle || t("noSeatChosen")}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                      <dt className="text-neutral-500">{t("employees")}</dt>
                      <dd className="text-neutral-200">{peopleAgents.length}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                      <dt className="text-neutral-500">{t("teams")}</dt>
                      <dd className="text-neutral-200">{orgTeams.length}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                      <dt className="text-neutral-500">{t("pendingApprovals")}</dt>
                      <dd className="text-neutral-200">{pendingApprovalCount}</dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSeatEdit(true)}
                      className="chat-pro-cta !h-9 !px-4 !text-[12px]"
                    >
                      <Crown className="size-3.5" />
                      {t("operatorSeat")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposeOpen(true)}
                      className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                    >
                      {t("mapAddTeam")}
                    </button>
                    <button
                      type="button"
                      onClick={() => openHireOnMap()}
                      className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                    >
                      {t("mapAddPerson")}
                    </button>
                  </div>
                </section>

                <section className="hq-panel rounded-[22px] border border-white/[0.08] bg-[var(--color-surface)] p-5">
                  <p className="chat-pro-kicker">{t("workforceOps")}</p>
                  <p className="mt-2 text-[13px] text-neutral-400">{t("hqAdminOpsHint")}</p>
                  <div className="mt-5 space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5 text-[13px] text-neutral-200">
                      <span>{t("ruleDrafts")}</span>
                      <input
                        type="checkbox"
                        checked={ops.draftsNeedActivation}
                        onChange={(e) =>
                          setOps((c) => ({ ...c, draftsNeedActivation: e.target.checked }))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5 text-[13px] text-neutral-200">
                      <span>{t("ruleHighRisk")}</span>
                      <input
                        type="checkbox"
                        checked={ops.highRiskDual}
                        onChange={(e) => setOps((c) => ({ ...c, highRiskDual: e.target.checked }))}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5 text-[13px] text-neutral-200">
                      <span>{t("ruleNotify")}</span>
                      <input
                        type="checkbox"
                        checked={ops.notifyOnLaunch}
                        onChange={(e) => setOps((c) => ({ ...c, notifyOnLaunch: e.target.checked }))}
                      />
                    </label>
                  </div>
                  {canAssignWork ? (
                    <button
                      type="button"
                      onClick={() => setView("assign")}
                      className="mt-5 inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200 hover:bg-white/5"
                    >
                      <ListTodo className="size-3.5" />
                      {t("studioAssignTitle")}
                    </button>
                  ) : null}
                </section>
                </div>
              </div>
            ) : null}

            {view === "org" ? (
              <div className="hq-rise grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
                <section className="wf-roster-panel flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/[0.07] bg-[var(--color-surface)]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                    <div className="min-w-0">
                      <p className="chat-pro-kicker">{t("peopleRoster")}</p>
                      <p className="mt-0.5 text-[12px] text-neutral-500">
                        {peopleAgents.length} {t("employees")} · {orderedOrgTeams.length} {t("teams")}
                        <span className="text-neutral-600"> · {t("wfContextHint")}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openHireOnMap()}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-white/12 px-3 text-[11px] text-neutral-200 hover:bg-white/5"
                      >
                        <Plus className="size-3.5" />
                        {t("mapAddPerson")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setComposeOpen(true)}
                        className="chat-pro-cta !h-8 !px-3 !text-[11px]"
                      >
                        <UsersRound className="size-3.5" />
                        {t("mapAddTeam")}
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 no-scrollbar">
                    <WorkforceList
                      hideHead
                      groups={workforceGroups}
                      selectedAgentId={selectedAgentId}
                      onAgentClick={(agentId) => {
                        setSelectedAgentId((current) => (current === agentId ? null : agentId));
                        setPendingDeleteId(null);
                        setAgentMenu(null);
                      }}
                      onAgentDoubleClick={(agentId, event) => {
                        openAgentMenu(agentId, event.clientX, event.clientY);
                      }}
                      onAgentContextMenu={(agentId, event) => {
                        openAgentMenu(agentId, event.clientX, event.clientY);
                      }}
                    />
                    {workforceGroups.length === 0 ? (
                      <div className="mx-auto mt-6 max-w-md text-center">
                        <p className="text-[14px] text-neutral-300">{t("hqEmptyMap")}</p>
                        <p className="mt-2 text-[12px] text-neutral-500">{t("hqEmptyMapHint")}</p>
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openHireOnMap()}
                            className="chat-pro-cta !h-9 !px-4 !text-[12px]"
                          >
                            <Plus className="size-3.5" />
                            {t("hireAgent")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setComposeOpen(true)}
                            className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                          >
                            {t("workforceCompose")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {peopleAgents.length > 0 ? (
                    <div className="shrink-0 border-t border-white/[0.06] px-4 py-3">
                      <p className="text-[12px] text-neutral-500">{t("wfContextHint")}</p>
                    </div>
                  ) : null}
                </section>

                <aside className="hq-pulse-panel flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/[0.07] bg-[var(--color-surface)]">
                  <div className="hq-pulse-tabs flex gap-1 border-b border-white/[0.06] p-2">
                    {(
                      [
                        ["pulse", t("hqPulse"), null],
                        ["approvals", t("pendingApprovals"), pendingApprovalCount || null],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setInspector(id)}
                        className={cn(
                          "hq-pulse-tab flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors",
                          inspector === id
                            ? "is-active bg-white text-black"
                            : "text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-200",
                        )}
                      >
                        <span className="truncate">{label}</span>
                        {typeof count === "number" && count > 0 ? (
                          <span
                            className={cn(
                              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                              inspector === id
                                ? "bg-black/10 text-black"
                                : "bg-white/10 text-neutral-300",
                            )}
                          >
                            {count}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
                    {inspector === "pulse" ? (
                      <div className="hq-pulse space-y-4">
                        <div className="hq-pulse-stats grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setHireOpen(true)}
                            className="hq-pulse-stat"
                          >
                            <span className="hq-pulse-stat-value">{peopleAgents.length}</span>
                            <span className="hq-pulse-stat-label">{t("employees")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setView("tasks");
                              setTaskFormOpen(false);
                            }}
                            className="hq-pulse-stat"
                          >
                            <span className="hq-pulse-stat-value">{openTasks.length}</span>
                            <span className="hq-pulse-stat-label">{t("openTasks")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspector("approvals")}
                            className="hq-pulse-stat"
                          >
                            <span className="hq-pulse-stat-value">{pendingApprovalCount}</span>
                            <span className="hq-pulse-stat-label">{t("approvalsShort")}</span>
                          </button>
                        </div>

                        <div className="hq-pulse-actions flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setHireOpen(true)}
                            className="hq-pulse-action"
                          >
                            <Plus className="size-3.5" strokeWidth={1.8} />
                            {t("hireAgent")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setView("tasks");
                              setTaskFormOpen(true);
                            }}
                            className="hq-pulse-action"
                          >
                            <ListTodo className="size-3.5" strokeWidth={1.8} />
                            {t("assignTask")}
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`${ROLE_PATH.organization}/workplace`)}
                            className="hq-pulse-action"
                          >
                            <Laptop className="size-3.5" strokeWidth={1.8} />
                            {t("cowork")}
                          </button>
                        </div>

                        <section className="hq-pulse-section">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Radio className="size-3.5 text-neutral-500" />
                              <p className="chat-pro-kicker">{t("operatorDirectives")}</p>
                            </div>
                            {directives.length > 0 ? (
                              <span className="text-[10px] tabular-nums text-neutral-500">
                                {directives.length}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                            {t("directiveHint")}
                          </p>
                          <form onSubmit={publishDirective} className="hq-pulse-composer mt-3">
                            <textarea
                              value={directiveDraft}
                              onChange={(e) => setDirectiveDraft(e.target.value)}
                              placeholder={t("directivePlaceholder")}
                              rows={3}
                              className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--color-foreground)] outline-none placeholder:text-neutral-500"
                            />
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-[11px] text-neutral-500">
                                {directiveFlash ??
                                  (directiveBusy ? t("directivePublishing") : t("directiveReach"))}
                              </p>
                              <button
                                type="submit"
                                disabled={!directiveDraft.trim() || directiveBusy}
                                className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                              >
                                {directiveBusy ? t("publishing") : t("publish")}
                              </button>
                            </div>
                          </form>
                          <ul className="mt-3 space-y-1.5">
                            {directives.length === 0 ? (
                              <li className="hq-pulse-empty">
                                <p>{t("noDirectives")}</p>
                                <p>{t("noDirectivesHint")}</p>
                              </li>
                            ) : (
                              directives.map((d) => (
                                <li key={d.id} className="hq-pulse-directive">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[12px] leading-relaxed text-[var(--color-foreground)]">
                                      {d.text}
                                    </p>
                                    <p className="mt-1 text-[10px] text-neutral-500">
                                      {formatDirectiveAge(d.createdAt)}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeDirective(d.id)}
                                    className="hq-pulse-directive-del"
                                    title={t("delete")}
                                    aria-label={t("delete")}
                                  >
                                    <Trash2 className="size-3.5" strokeWidth={1.7} />
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </section>

                        <section className="hq-pulse-section">
                          <div className="flex items-center justify-between gap-2">
                            <p className="chat-pro-kicker">{t("priorityQueue")}</p>
                            {openTasks.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setView("tasks")}
                                className="text-[10px] font-medium text-neutral-400 hover:text-white"
                              >
                                {t("viewAll")}
                              </button>
                            ) : null}
                          </div>
                          <ul className="mt-2 space-y-1.5">
                            {openTasks.length === 0 ? (
                              <li className="hq-pulse-empty">
                                <p>{t("priorityQueueEmpty")}</p>
                                <p>{t("priorityQueueEmptyHint")}</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setView("tasks");
                                    setTaskFormOpen(true);
                                  }}
                                  className="hq-pulse-action mt-3"
                                >
                                  <Plus className="size-3.5" strokeWidth={1.8} />
                                  {t("assignTask")}
                                </button>
                              </li>
                            ) : (
                              (urgentTasks.length > 0 ? urgentTasks : openTasks)
                                .slice(0, 5)
                                .map((task) => (
                                  <li key={task.id} className="hq-pulse-task">
                                    <span
                                      className={cn(
                                        "hq-pulse-priority",
                                        task.priority === "urgent" && "is-urgent",
                                        task.priority === "high" && "is-high",
                                        task.priority === "low" && "is-low",
                                      )}
                                      aria-hidden
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[13px] text-[var(--color-foreground)]">
                                        {task.title}
                                      </p>
                                      <p className="truncate text-[10px] text-neutral-500">
                                        {task.priority} · {agentName(task.assigneeAgentId)}
                                      </p>
                                    </div>
                                    {task.assigneeAgentId ? (
                                      <button
                                        type="button"
                                        onClick={() => openCoworkWith(task.assigneeAgentId!, task)}
                                        className="shrink-0 rounded-full bg-[var(--color-foreground)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-background)]"
                                      >
                                        {t("hqOpenCowork")}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setView("tasks");
                                          setTaskFormOpen(true);
                                        }}
                                        className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-neutral-300 hover:bg-white/5"
                                      >
                                        {t("assign")}
                                      </button>
                                    )}
                                  </li>
                                ))
                            )}
                          </ul>
                        </section>
                      </div>
                    ) : null}

                    {inspector === "approvals" ? (
                      <div className="space-y-3">
                        <p className="chat-pro-kicker">{t("pendingApprovals")}</p>
                        {pendingApprovals.length === 0 && draftsNeedingRequest.length === 0 ? (
                          <p className="flex items-center gap-2 text-[12px] text-neutral-500">
                            <ShieldCheck className="size-3.5" />
                            {t("noPending")}
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {pendingApprovals.map((approval) => (
                              <li
                                key={approval.id}
                                className="rounded-xl bg-white/[0.03] px-3 py-2.5"
                              >
                                <p className="truncate text-[13px] text-neutral-200">{approval.title}</p>
                                <p className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                                  {approval.kind.replace("_", " ")}
                                </p>
                                <div className="mt-2 flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void resolveApproval(approval.id, "approved")}
                                    className="rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                                  >
                                    {t("approve")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void resolveApproval(approval.id, "rejected")}
                                    className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-neutral-300"
                                  >
                                    {t("reject")}
                                  </button>
                                </div>
                              </li>
                            ))}
                            {draftsNeedingRequest.map((agent) => (
                              <li
                                key={agent.id}
                                className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
                              >
                                <span className="text-[13px] text-neutral-300">{agent.name}</span>
                                <button
                                  type="button"
                                  onClick={() => void activateAgent(agent.id)}
                                  className="rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                                >
                                  {ops.draftsNeedActivation ? t("requestActivation") : t("activate")}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="space-y-2 border-t border-white/[0.06] pt-3">
                          <Toggle
                            label={t("ruleDrafts")}
                            checked={ops.draftsNeedActivation}
                            onChange={(v) => setOps((c) => ({ ...c, draftsNeedActivation: v }))}
                          />
                          <Toggle
                            label={t("ruleHighRisk")}
                            checked={ops.highRiskDual}
                            onChange={(v) => setOps((c) => ({ ...c, highRiskDual: v }))}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </aside>
              </div>
            ) : null}

            {view === "tasks" ? (
              <section className="hq-tasks workforce-rise" aria-label={t("ccTasks")}>
                <header className="hq-tasks-mast">
                  <div className="min-w-0">
                    <p className="hq-tasks-kicker">{t("ccTasks")}</p>
                    <h2 className="hq-tasks-title">{t("hqTasksHeadline")}</h2>
                    <p className="hq-tasks-lead">{t("hqTasksHint")}</p>
                  </div>
                  <div className="hq-tasks-mast-actions">
                    <button
                      type="button"
                      onClick={() => setTaskFormOpen((open) => !open)}
                      className="hq-tasks-primary"
                    >
                      <Plus className="size-3.5" />
                      {t("assignTask")}
                    </button>
                  </div>
                </header>

                <div className="hq-tasks-stats">
                  <div className="hq-tasks-stat">
                    <span className="hq-tasks-stat-value">{taskStats.open}</span>
                    <span className="hq-tasks-stat-label">{t("hqTasksOpen")}</span>
                  </div>
                  <div className="hq-tasks-stat">
                    <span className="hq-tasks-stat-value">{taskStats.inProgress}</span>
                    <span className="hq-tasks-stat-label">{t("hqTasksProgress")}</span>
                  </div>
                  <div className="hq-tasks-stat is-warn">
                    <span className="hq-tasks-stat-value">{taskStats.blocked}</span>
                    <span className="hq-tasks-stat-label">{t("hqTasksBlocked")}</span>
                  </div>
                  <div className="hq-tasks-stat is-done">
                    <span className="hq-tasks-stat-value">{taskStats.done}</span>
                    <span className="hq-tasks-stat-label">{t("hqTasksDone")}</span>
                  </div>
                </div>

                <div className="hq-tasks-toolbar">
                  <label className="hq-tasks-search">
                    <Search className="size-3.5 opacity-60" />
                    <input
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      placeholder={t("hqTasksSearch")}
                      aria-label={t("hqTasksSearch")}
                    />
                  </label>
                  <select
                    value={taskFilterAssignee}
                    onChange={(e) => setTaskFilterAssignee(e.target.value)}
                    className="hq-tasks-select"
                    aria-label={t("allAssignees")}
                  >
                    <option value="">{t("allAssignees")}</option>
                    {taskBoardAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={taskFilterPriority}
                    onChange={(e) => setTaskFilterPriority(e.target.value as TaskPriority | "")}
                    className="hq-tasks-select"
                    aria-label={t("allPriorities")}
                  >
                    <option value="">{t("allPriorities")}</option>
                    <option value="urgent">{t("priorityUrgent")}</option>
                    <option value="high">{t("priorityHigh")}</option>
                    <option value="medium">{t("priorityMedium")}</option>
                    <option value="low">{t("priorityLow")}</option>
                  </select>
                  <select
                    value={taskFilterProject}
                    onChange={(e) => setTaskFilterProject(e.target.value)}
                    className="hq-tasks-select"
                    aria-label={t("allProjects")}
                  >
                    <option value="">{t("allProjects")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                {taskFormOpen ? (
                  <form onSubmit={createTask} className="hq-tasks-composer">
                    <div className="hq-tasks-composer-head">
                      <div>
                        <h3>{t("assignTask")}</h3>
                        <p>{t("assignTaskBody")}</p>
                      </div>
                      <button
                        type="button"
                        className="hq-tasks-icon"
                        onClick={() => setTaskFormOpen(false)}
                        aria-label={t("cancel")}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <div className="hq-tasks-composer-grid">
                      <label className="hq-tasks-field">
                        <span>{t("taskTitle")}</span>
                        <input
                          required
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          placeholder={t("hqTasksTitlePh")}
                        />
                      </label>
                      <label className="hq-tasks-field">
                        <span>{t("taskPriority")}</span>
                        <select
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                        >
                          <option value="low">{t("priorityLow")}</option>
                          <option value="medium">{t("priorityMedium")}</option>
                          <option value="high">{t("priorityHigh")}</option>
                          <option value="urgent">{t("priorityUrgent")}</option>
                        </select>
                      </label>
                      <label className="hq-tasks-field">
                        <span>{t("taskAssignee")}</span>
                        <select
                          value={taskAssignee}
                          onChange={(e) => setTaskAssignee(e.target.value)}
                        >
                          <option value="">{t("unassigned")}</option>
                          {taskBoardAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="hq-tasks-field">
                        <span>{t("taskTeam")}</span>
                        <select value={taskTeam} onChange={(e) => setTaskTeam(e.target.value)}>
                          <option value="">{t("none")}</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="hq-tasks-field">
                        <span>{t("colProject")}</span>
                        <select
                          value={taskProject}
                          onChange={(e) => setTaskProject(e.target.value)}
                        >
                          <option value="">{t("none")}</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                              {bindings.some((b) => b.projectId === project.id)
                                ? ` · ${t("linkedRepo")}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="hq-tasks-field hq-tasks-field-wide">
                        <span>{t("taskBrief")}</span>
                        <textarea
                          value={taskBrief}
                          onChange={(e) => setTaskBrief(e.target.value)}
                          rows={3}
                          placeholder={t("hqTasksBriefPh")}
                        />
                      </label>
                    </div>
                    {taskProject && projectRepo(taskProject) ? (
                      <p className="hq-tasks-hint-line">
                        {t("taskUsesConnector")}: {projectRepo(taskProject)}
                      </p>
                    ) : null}
                    <div className="hq-tasks-composer-actions">
                      <button
                        type="submit"
                        disabled={saving || !taskTitle.trim()}
                        className="hq-tasks-primary"
                      >
                        {t("createTask")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskFormOpen(false)}
                        className="hq-tasks-ghost"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>
                ) : null}

                <div className="hq-tasks-board">
                  {TASK_COLUMNS.map((status) => {
                    const columnTasks = tasksByStatus.get(status) ?? [];
                    return (
                      <div
                        key={status}
                        className={cn(
                          "hq-tasks-column",
                          `is-${status}`,
                          taskDropStatus === status && "is-drop",
                        )}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setTaskDropStatus(status);
                        }}
                        onDragLeave={() => {
                          setTaskDropStatus((current) => (current === status ? null : current));
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const id = event.dataTransfer.getData("text/task-id") || taskDragId;
                          setTaskDropStatus(null);
                          setTaskDragId(null);
                          const task = tasks.find((item) => item.id === id);
                          if (task) void setTaskStatus(task, status);
                        }}
                      >
                        <div className="hq-tasks-column-head">
                          <p>{taskColumnLabel(status)}</p>
                          <span>{columnTasks.length}</span>
                        </div>
                        <div className="hq-tasks-column-body">
                          {columnTasks.map((task) => (
                            <article
                              key={task.id}
                              className={cn(
                                "hq-tasks-card",
                                `prio-${task.priority}`,
                                taskDragId === task.id && "is-dragging",
                              )}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData("text/task-id", task.id);
                                event.dataTransfer.effectAllowed = "move";
                                setTaskDragId(task.id);
                              }}
                              onDragEnd={() => {
                                setTaskDragId(null);
                                setTaskDropStatus(null);
                              }}
                            >
                              <div className="hq-tasks-card-top">
                                <span className="hq-tasks-grip" aria-hidden>
                                  <GripVertical className="size-3.5" />
                                </span>
                                <span className={cn("hq-tasks-prio", `is-${task.priority}`)}>
                                  {priorityLabel(task.priority)}
                                </span>
                              </div>
                              <h4>{task.title}</h4>
                              {task.brief ? <p className="hq-tasks-brief">{task.brief}</p> : null}
                              <div className="hq-tasks-meta">
                                <span className="hq-tasks-assignee">
                                  <span className="hq-tasks-avatar">
                                    {agentName(task.assigneeAgentId).slice(0, 1).toUpperCase()}
                                  </span>
                                  {agentName(task.assigneeAgentId)}
                                </span>
                                {projectRepo(task.projectId) ? (
                                  <span className="hq-tasks-repo" title={projectRepo(task.projectId) ?? undefined}>
                                    {projectRepo(task.projectId)}
                                  </span>
                                ) : null}
                              </div>
                              <div className="hq-tasks-card-actions">
                                {task.assigneeAgentId && task.status !== "done" ? (
                                  <button
                                    type="button"
                                    disabled={runningTaskId === task.id}
                                    onClick={() => void runTask(task)}
                                  >
                                    <Play className="size-3" />
                                    {runningTaskId === task.id ? t("runningTask") : t("runTask")}
                                  </button>
                                ) : null}
                                {task.status !== "done" ? (
                                  <button type="button" onClick={() => void advanceTask(task)}>
                                    <ArrowRight className="size-3" />
                                    {t("advance")}
                                  </button>
                                ) : null}
                                {task.assigneeAgentId ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => talkTo(task.assigneeAgentId!, task)}
                                    >
                                      {t("openChat")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEmployeeDesk(task.assigneeAgentId!)}
                                    >
                                      <Monitor className="size-3" />
                                      {t("openDesk")}
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  className="is-danger"
                                  onClick={() => void removeTask(task)}
                                  aria-label={t("hqTasksDelete")}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            </article>
                          ))}
                          {columnTasks.length === 0 ? (
                            <p className="hq-tasks-empty">
                              {taskSearch || taskFilterAssignee || taskFilterPriority || taskFilterProject
                                ? t("hqTasksNoMatch")
                                : t("taskDropHere")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {runPreview ? (
                  <div className="hq-tasks-panel">
                    <p className="hq-tasks-panel-label">{t("lastRunOutput")}</p>
                    <p className="hq-tasks-panel-body">{runPreview}</p>
                  </div>
                ) : null}
                {taskRuns.length > 0 ? (
                  <div className="hq-tasks-panel">
                    <p className="hq-tasks-panel-label">{t("runHistory")}</p>
                    <ul className="hq-tasks-runs">
                      {taskRuns.slice(0, 8).map((run) => (
                        <li key={run.id}>
                          <span>{run.status}</span>
                          {run.summary ?? t("noRunSummary")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {view === "knowledge" ? (
              <section className="hq-know workforce-rise" aria-label={t("ccKnowledge")}>
                <header className="hq-know-mast">
                  <div className="min-w-0">
                    <p className="hq-know-kicker">{t("ccKnowledge")}</p>
                    <h2 className="hq-know-title">{t("hqKnowHeadline")}</h2>
                    <p className="hq-know-lead">{t("hqKnowHint")}</p>
                  </div>
                  <div className="hq-know-mast-actions">
                    <label className={cn("hq-know-ghost", knowUploading && "is-busy")}>
                      <Upload className="size-3.5" />
                      {knowUploading ? t("hqKnowUploading") : t("hqKnowUpload")}
                      <input
                        type="file"
                        accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.log,text/plain,text/markdown,text/csv,application/json,text/html"
                        multiple
                        hidden
                        disabled={knowUploading}
                        onChange={(e) => {
                          void uploadKnowledgeFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="hq-know-primary"
                      onClick={() => setKnowledgeFormOpen((open) => !open)}
                    >
                      <Plus className="size-3.5" />
                      {t("addKnowledge")}
                    </button>
                  </div>
                </header>

                <div className="hq-know-stats">
                  <div className="hq-know-stat">
                    <span className="hq-know-stat-value">{knowledgeStats.total}</span>
                    <span className="hq-know-stat-label">{t("hqKnowTotal")}</span>
                  </div>
                  <div className="hq-know-stat">
                    <span className="hq-know-stat-value">{knowledgeStats.orgWide}</span>
                    <span className="hq-know-stat-label">{t("hqKnowOrg")}</span>
                  </div>
                  <div className="hq-know-stat">
                    <span className="hq-know-stat-value">{knowledgeStats.projectScoped}</span>
                    <span className="hq-know-stat-label">{t("hqKnowProject")}</span>
                  </div>
                  <div className="hq-know-stat">
                    <span className="hq-know-stat-value">
                      {knowledgeStats.chars > 999
                        ? `${Math.round(knowledgeStats.chars / 1000)}k`
                        : knowledgeStats.chars}
                    </span>
                    <span className="hq-know-stat-label">{t("hqKnowChars")}</span>
                  </div>
                </div>

                <div className="hq-know-pill">
                  <BookOpen className="size-3.5" />
                  <p>{t("hqKnowAgentRule")}</p>
                </div>

                <label className="hq-know-search">
                  <Search className="size-3.5 opacity-60" />
                  <input
                    value={knowSearch}
                    onChange={(e) => setKnowSearch(e.target.value)}
                    placeholder={t("hqKnowSearch")}
                    aria-label={t("hqKnowSearch")}
                  />
                </label>

                {knowledgeFormOpen ? (
                  <form onSubmit={createKnowledge} className="hq-know-composer">
                    <div className="hq-know-composer-head">
                      <div>
                        <h3>{t("addKnowledge")}</h3>
                        <p>{t("ccKnowledgeBody")}</p>
                      </div>
                      <button
                        type="button"
                        className="hq-know-icon"
                        onClick={() => setKnowledgeFormOpen(false)}
                        aria-label={t("cancel")}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <div className="hq-know-composer-grid">
                      <label className="hq-know-field">
                        <span>{t("knowledgeTitle")}</span>
                        <input
                          required
                          value={knowTitle}
                          onChange={(e) => setKnowTitle(e.target.value)}
                          placeholder={t("hqKnowTitlePh")}
                        />
                      </label>
                      <label className="hq-know-field">
                        <span>{t("colProject")}</span>
                        <select
                          value={knowProject}
                          onChange={(e) => setKnowProject(e.target.value)}
                        >
                          <option value="">{t("workspaceWide")}</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="hq-know-field hq-know-field-wide">
                        <span>{t("knowledgeContent")}</span>
                        <textarea
                          required
                          value={knowContent}
                          onChange={(e) => setKnowContent(e.target.value)}
                          rows={7}
                          placeholder={t("hqKnowContentPh")}
                        />
                      </label>
                    </div>
                    <div className="hq-know-composer-actions">
                      <button
                        type="submit"
                        disabled={saving || !knowTitle.trim() || !knowContent.trim()}
                        className="hq-know-primary"
                      >
                        {t("saveKnowledge")}
                      </button>
                      <button
                        type="button"
                        className="hq-know-ghost"
                        onClick={() => setKnowledgeFormOpen(false)}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>
                ) : null}

                <div className="hq-know-grid">
                  {filteredKnowledge.map((doc) => {
                    const expanded = knowExpandedId === doc.id;
                    const projectName = doc.projectId
                      ? projects.find((p) => p.id === doc.projectId)?.name ?? doc.projectId
                      : t("workspaceWide");
                    return (
                      <article key={doc.id} className={cn("hq-know-card", expanded && "is-open")}>
                        <div className="hq-know-card-top">
                          <span className="hq-know-card-icon">
                            <FileText className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3>{doc.title}</h3>
                            <p>
                              {projectName}
                              {" · "}
                              {(doc.content?.length ?? 0).toLocaleString()} {t("hqKnowChars").toLowerCase()}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="hq-know-icon is-danger"
                            onClick={() => void deleteKnowledge(doc.id)}
                            aria-label={t("delete")}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className={cn("hq-know-excerpt", expanded && "is-full")}>{doc.content}</p>
                        <div className="hq-know-card-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setKnowExpandedId((current) => (current === doc.id ? null : doc.id))
                            }
                          >
                            {expanded ? t("hqKnowCollapse") : t("hqKnowExpand")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {filteredKnowledge.length === 0 ? (
                    <div className="hq-know-empty">
                      <BookOpen className="size-5 opacity-50" />
                      <p>
                        {knowSearch.trim()
                          ? t("hqKnowNoMatch")
                          : t("noKnowledge")}
                      </p>
                      {!knowSearch.trim() ? (
                        <div className="hq-know-empty-actions">
                          <button
                            type="button"
                            className="hq-know-primary"
                            onClick={() => setKnowledgeFormOpen(true)}
                          >
                            <Plus className="size-3.5" />
                            {t("addKnowledge")}
                          </button>
                          <label className="hq-know-ghost">
                            <Upload className="size-3.5" />
                            {t("hqKnowUpload")}
                            <input
                              type="file"
                              accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.log,text/plain"
                              multiple
                              hidden
                              onChange={(e) => {
                                void uploadKnowledgeFiles(e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {view === "chat" ? (
              <section className="hq-rise space-y-4">
                <div className="rounded-[28px] border border-white/10 bg-[var(--color-surface)] p-5">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <h2 className="text-lg text-white">{t("ccChat")}</h2>
                      <p className="mt-1 max-w-xl text-sm text-neutral-500">
                        {chatLaunchMode === "solo" ? t("hqChatPickAgent") : t("hqChatPickTeam")}
                      </p>
                    </div>
                    <div className="inline-flex rounded-full border border-white/12 bg-black/40 p-1">
                      <button
                        type="button"
                        onClick={() => setChatLaunchMode("solo")}
                        className={cn(
                          "rounded-full px-3.5 py-1.5 text-[12px] transition",
                          chatLaunchMode === "solo"
                            ? "bg-white text-black"
                            : "text-neutral-400 hover:text-white",
                        )}
                      >
                        {t("hqChatSolo")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatLaunchMode("team")}
                        className={cn(
                          "rounded-full px-3.5 py-1.5 text-[12px] transition",
                          chatLaunchMode === "team"
                            ? "bg-white text-black"
                            : "text-neutral-400 hover:text-white",
                        )}
                      >
                        {t("hqChatTeam")}
                      </button>
                    </div>
                  </div>

                  {chatLaunchMode === "solo" ? (
                    activeAgents.length === 0 ? (
                      <p className="mt-6 text-sm text-neutral-500">{t("noEmployees")}</p>
                    ) : (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {activeAgents.map((agent) => {
                          const agentTeams = memberships
                            .filter((item) => item.agentId === agent.id)
                            .map((item) => teams.find((team) => team.id === item.teamId)?.name)
                            .filter(Boolean);
                          return (
                            <article
                              key={agent.id}
                              className="group rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-4 transition hover:border-white/20"
                            >
                              <button
                                type="button"
                                onClick={() => openEmployeeDesk(agent.id)}
                                className="flex w-full items-center gap-3 text-start"
                              >
                                <div className="hq-avatar flex size-12 items-center justify-center rounded-2xl border border-white/15 text-xs text-white">
                                  {initials(agent.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm text-white">{agent.name}</p>
                                  <p className="truncate text-xs text-neutral-500">
                                    {agent.specialty || agent.role} · {agent.status}
                                  </p>
                                  {agentTeams.length > 0 ? (
                                    <p className="mt-1 truncate text-[10px] text-neutral-600">
                                      {agentTeams.join(" · ")}
                                    </p>
                                  ) : null}
                                </div>
                              </button>
                              <div className="mt-4 grid grid-cols-3 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEmployeeDesk(agent.id)}
                                  className="inline-flex h-9 items-center justify-center gap-1 rounded-full bg-white text-[11px] font-medium text-black"
                                >
                                  <Monitor className="size-3.5" />
                                  {t("hqManageAgent")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => talkTo(agent.id)}
                                  className="inline-flex h-9 items-center justify-center gap-1 rounded-full border border-white/15 text-[11px] text-neutral-200"
                                >
                                  <MessageSquare className="size-3.5" />
                                  {t("deskSoloChat")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openCoworkWith(agent.id)}
                                  className="inline-flex h-9 items-center justify-center gap-1 rounded-full border border-white/15 text-[11px] text-neutral-200"
                                >
                                  <Laptop className="size-3.5" />
                                  {t("hqOpenCowork")}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <div className="mt-5 space-y-3">
                      <button
                        type="button"
                        disabled={saving || activeAgents.length === 0}
                        onClick={() => void openAllHandsChat()}
                        className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/15 bg-gradient-to-r from-white/[0.08] to-transparent px-4 py-4 text-start transition hover:border-white/25 disabled:opacity-40"
                      >
                        <div>
                          <p className="text-sm text-white">{t("hqChatAllHands")}</p>
                          <p className="mt-1 text-xs text-neutral-500">{t("hqChatAllHandsBody")}</p>
                          <p className="mt-2 text-[11px] text-neutral-600">
                            {activeAgents.length} {t("hqChatMembers")}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-black">
                          {t("hqChatEnterRoom")}
                        </span>
                      </button>

                      {teams.length === 0 ? (
                        <p className="text-sm text-neutral-500">{t("hqEmptyMap")}</p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {teams.map((team) => {
                            const members = membersByTeam.get(team.id) ?? [];
                            return (
                              <article
                                key={team.id}
                                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm text-white">{team.name}</p>
                                    <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                                      {team.purpose ?? t("none")}
                                    </p>
                                  </div>
                                  <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                                  {Math.min(members.length, MAX_DEPT_AGENTS)}/{MAX_DEPT_AGENTS}{" "}
                                  {t("hqChatMembers")}
                                  {members.length > MAX_DEPT_AGENTS ? (
                                    <span className="text-amber-300/80"> · {t("deptFull")}</span>
                                  ) : null}
                                  </span>
                                </div>
                                <div className="mt-3 flex -space-x-2">
                                  {members.slice(0, 8).map((agent) => (
                                    <button
                                      key={agent.id}
                                      type="button"
                                      onClick={() => openEmployeeDesk(agent.id)}
                                      className="hq-avatar flex size-8 items-center justify-center rounded-full border border-white/20 bg-[var(--color-surface-2)] text-[9px] text-white"
                                      title={agent.name}
                                    >
                                      {initials(agent.name)}
                                    </button>
                                  ))}
                                  {members.length === 0 ? (
                                    <span className="text-[11px] text-neutral-600">{t("deskNoTeams")}</span>
                                  ) : null}
                                </div>
                                <div className="mt-4 flex gap-2">
                                  <button
                                    type="button"
                                    disabled={members.length === 0}
                                    onClick={() => {
                                      openTeamChat(team.id);
                                      navigate("/chat");
                                    }}
                                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-[12px] font-medium text-black disabled:opacity-40"
                                  >
                                    <Radio className="size-3.5" />
                                    {t("hqChatEnterRoom")}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={members.length === 0}
                                    onClick={() => {
                                      if (members[0]) openCoworkWith(members[0].id);
                                    }}
                                    className="inline-flex h-9 items-center justify-center rounded-full border border-white/15 px-3 text-[12px] text-neutral-200 disabled:opacity-40"
                                  >
                                    <Laptop className="size-3.5" />
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {view === "reports" ? (
              <section className="hq-reports workforce-rise" aria-label={t("ccReports")}>
                <div className="hq-reports-stage">
                  <header className="hq-reports-mast">
                    <div className="min-w-0">
                      <p className="hq-reports-kicker">{t("ccReports")}</p>
                      <h2 className="hq-reports-title">{t("hqReportsHeadline")}</h2>
                      <p className="hq-reports-lead">{t("hqReportsHint")}</p>
                    </div>
                    <div className="hq-reports-live">
                      <span className="hq-reports-live-dot" aria-hidden />
                      {t("hqReportsLive")}
                    </div>
                  </header>

                  <div className="hq-reports-command">
                    <div className="hq-reports-command-main">
                      <p className="hq-reports-command-label">{t("hqReportsTokenFocus")}</p>
                      <div className="hq-reports-command-pick">
                        <UserRound className="size-4 opacity-60" />
                        <select
                          value={reportAgentId}
                          onChange={(e) => setReportAgentId(e.target.value)}
                          aria-label={t("hqReportsPickEmployee")}
                        >
                          <option value="">{t("hqReportsAllEmployees")}</option>
                          {taskBoardAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="hq-reports-command-name">{selectedAgentTokens.label}</p>
                      <p className="hq-reports-command-total">
                        {(
                          selectedAgentTokens.inputTokens + selectedAgentTokens.outputTokens
                        ).toLocaleString()}
                        <span> {t("hqReportsTokens").toLowerCase()}</span>
                      </p>
                      {(() => {
                        const total =
                          selectedAgentTokens.inputTokens + selectedAgentTokens.outputTokens;
                        const inPct =
                          total > 0
                            ? Math.round((selectedAgentTokens.inputTokens / total) * 100)
                            : 50;
                        return (
                          <div className="hq-reports-split" aria-hidden={total === 0}>
                            <div className="hq-reports-split-track">
                              <i className="is-in" style={{ width: `${inPct}%` }} />
                              <i className="is-out" style={{ width: `${100 - inPct}%` }} />
                            </div>
                            <div className="hq-reports-split-legend">
                              <span>
                                <em className="is-in" />
                                {t("usageInputTokens")} {inPct}%
                              </span>
                              <span>
                                <em className="is-out" />
                                {t("usageOutputTokens")} {100 - inPct}%
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="hq-reports-command-stats">
                      <div>
                        <span>{t("usageInputTokens")}</span>
                        <strong>{selectedAgentTokens.inputTokens.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>{t("usageOutputTokens")}</span>
                        <strong>{selectedAgentTokens.outputTokens.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>{t("hqReportsEvents")}</span>
                        <strong>{selectedAgentTokens.events.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>{t("hqReportsHealth")}</span>
                        <strong>
                          {liveReport.tasks.open === 0 && (liveReport.pendingApprovals ?? 0) === 0
                            ? t("hqReportsHealthClear")
                            : t("hqReportsHealthActive")}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="hq-reports-strip">
                    <div>
                      <span>{t("hqReportsWorkforce")}</span>
                      <strong>{agents.length}</strong>
                      <em>
                        {liveReport.teams} {t("hqReportsTeams").toLowerCase()}
                      </em>
                    </div>
                    <div>
                      <span>{t("openTasks")}</span>
                      <strong>{liveReport.tasks.open}</strong>
                      <em>
                        {liveReport.tasks.done} {t("doneTasks").toLowerCase()}
                      </em>
                    </div>
                    <div>
                      <span>{t("knowledgeCount")}</span>
                      <strong>{liveReport.knowledgeCount}</strong>
                      <em>
                        {liveReport.pendingApprovals ?? 0} {t("pendingApprovals").toLowerCase()}
                      </em>
                    </div>
                    <div>
                      <span>{t("skillCount")}</span>
                      <strong>{liveReport.skillCount ?? 0}</strong>
                      <em>
                        {liveReport.memoryCount} {t("memoryCount").toLowerCase()}
                      </em>
                    </div>
                  </div>

                  <div className="hq-reports-grid">
                    <article className="hq-reports-card">
                      <header>
                        <h3>{t("hqReportsTaskFlow")}</h3>
                        <p>{t("hqReportsTaskFlowBody")}</p>
                      </header>
                      <div className="hq-reports-flow">
                        {TASK_COLUMNS.map((status) => {
                          const value = liveReport.tasks.byStatus[status] ?? 0;
                          const max = Math.max(1, liveReport.tasks.total, value);
                          return (
                            <div key={status} className="hq-reports-flow-row">
                              <div className="hq-reports-flow-meta">
                                <span>{taskColumnLabel(status)}</span>
                                <strong>{value}</strong>
                              </div>
                              <div className="hq-reports-flow-track">
                                <i style={{ width: `${Math.round((value / max) * 100)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>

                    <article className="hq-reports-card">
                      <header>
                        <h3>{t("hqReportsPriority")}</h3>
                        <p>{t("hqReportsPriorityBody")}</p>
                      </header>
                      <div className="hq-reports-prio-grid">
                        {(["urgent", "high", "medium", "low"] as TaskPriority[]).map((priority) => (
                          <div key={priority} className={cn("hq-reports-prio", `is-${priority}`)}>
                            <span>{priorityLabel(priority)}</span>
                            <strong>{liveReport.tasks.byPriority[priority] ?? 0}</strong>
                          </div>
                        ))}
                      </div>
                    </article>

                    <article className="hq-reports-card hq-reports-card-spend">
                      <header>
                        <h3>{t("hqReportsTopSpenders")}</h3>
                        <p>{t("hqReportsTopSpendersBody")}</p>
                      </header>
                      <div className="hq-reports-people">
                        {agentTokenRows.slice(0, 8).map((row, index) => {
                          const orgTotal = Math.max(
                            1,
                            agentTokenRows.reduce((sum, item) => sum + item.total, 0),
                          );
                          const max = Math.max(1, agentTokenRows[0]?.total ?? row.total);
                          const share = Math.round((row.total / orgTotal) * 100);
                          const bar = Math.max(6, Math.round((row.total / max) * 100));
                          const active = reportAgentId === (row.agentId ?? "");
                          const initials = row.name
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() ?? "")
                            .join("");
                          return (
                            <button
                              key={row.agentId ?? `spender-${index}`}
                              type="button"
                              className={cn("hq-reports-person", active && "is-on")}
                              onClick={() => setReportAgentId(row.agentId ?? "")}
                            >
                              <span className="hq-reports-rank">#{index + 1}</span>
                              <span className="hq-reports-avatar" aria-hidden>
                                {initials || "A"}
                              </span>
                              <span className="hq-reports-person-copy">
                                <strong>{row.name}</strong>
                                <em>
                                  {share}% {t("hqReportsShare").toLowerCase()}
                                  {" · "}
                                  {row.inputTokens.toLocaleString()} in
                                  {" / "}
                                  {row.outputTokens.toLocaleString()} out
                                </em>
                                <span className="hq-reports-person-track">
                                  <i style={{ width: `${bar}%` }} />
                                </span>
                              </span>
                              <span className="hq-reports-person-total">
                                {row.total.toLocaleString()}
                                <small>{t("hqReportsTokens")}</small>
                              </span>
                            </button>
                          );
                        })}
                        {agentTokenRows.length === 0 ? (
                          <p className="hq-reports-empty">{t("hqReportsNoTokens")}</p>
                        ) : null}
                      </div>
                    </article>

                    <article className="hq-reports-card">
                      <header>
                        <h3>{t("hqReportsTokenTimeline")}</h3>
                        <p>{t("hqReportsTokenTimelineBody")}</p>
                      </header>
                      <ul className="hq-reports-timeline">
                        {selectedAgentRecent.map((event, index) => {
                          const who =
                            agentTokenRows.find((row) => row.agentId === event.agentId)?.name ??
                            (() => {
                              const matched = event.agentId
                                ? agents.find((agent) => agent.id === event.agentId)?.name?.trim()
                                : null;
                              if (matched && !/^agt[_-]/i.test(matched) && matched !== event.agentId) {
                                return matched;
                              }
                              if (taskBoardAgents.length === 1) {
                                return taskBoardAgents[0]!.name.trim() || t("hqReportsEmployee");
                              }
                              return event.agentId ? t("hqReportsEmployee") : t("unassigned");
                            })();
                          const total = event.inputTokens + event.outputTokens;
                          return (
                            <li key={event.id}>
                              <span className="hq-reports-timeline-dot" aria-hidden />
                              <div>
                                <strong>
                                  {total.toLocaleString()} {t("hqReportsTokens").toLowerCase()}
                                </strong>
                                <p>
                                  {who}
                                  {" · "}
                                  {event.inputTokens.toLocaleString()} in
                                  {" / "}
                                  {event.outputTokens.toLocaleString()} out
                                  {" · "}
                                  {new Date(event.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                        {selectedAgentRecent.length === 0 ? (
                          <li className="hq-reports-empty">{t("hqReportsNoTokenEvents")}</li>
                        ) : null}
                      </ul>
                    </article>
                  </div>

                  <div className="hq-reports-bottom">
                    <article className="hq-reports-card">
                      <header>
                        <h3>{t("runHistory")}</h3>
                        <p>{t("hqReportsRunsBody")}</p>
                      </header>
                      <ul className="hq-reports-clean-list">
                        {(liveReport.recentTaskRuns ?? []).slice(0, 8).map((run) => (
                          <li key={run.id}>
                            <span className={cn("hq-reports-status", `is-${run.status}`)}>
                              {run.status.replaceAll("_", " ")}
                            </span>
                            <p>{run.summary ?? t("noRunSummary")}</p>
                          </li>
                        ))}
                        {(liveReport.recentTaskRuns ?? []).length === 0 ? (
                          <li className="hq-reports-empty">{t("noRunsYet")}</li>
                        ) : null}
                      </ul>
                    </article>

                    <article className="hq-reports-card">
                      <header>
                        <h3>{t("hqReportsFeatureLog")}</h3>
                        <p>{t("hqReportsFeatureLogBody")}</p>
                      </header>
                      <ul className="hq-reports-clean-list">
                        {featureLogEntries.map((entry) => (
                          <li key={entry.id}>
                            <span className="hq-reports-feature">
                              {featureLabel(entry.objectType)}
                            </span>
                            <div>
                              <p>{entry.summary}</p>
                              <em>{new Date(entry.createdAt).toLocaleString()}</em>
                            </div>
                          </li>
                        ))}
                        {featureLogEntries.length === 0 ? (
                          <li className="hq-reports-empty">{t("hqReportsNoPulse")}</li>
                        ) : null}
                      </ul>
                    </article>
                  </div>
                </div>
              </section>
            ) : null}
            </div>
          </div>
        </div>
      </div>
      )}

      {composeOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <form
            onSubmit={launchTeam}
            className="hq-rise max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/15 bg-[var(--color-surface)] p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg text-white">{t("workforceCompose")}</h2>
              <button type="button" onClick={() => setComposeOpen(false)} className="text-sm text-neutral-400">
                {t("cancel")}
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <Field label={t("teamName")}>
                <input
                  required
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="field"
                />
              </Field>
              <Field label={t("teamMission")}>
                <textarea
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  rows={2}
                  className="field"
                />
              </Field>
              <Field label={t("colProject")}>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="field"
                >
                  <option value="">{t("none")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-wrap gap-2">
                {ROLE_KEYS.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() =>
                      setRoles((c) =>
                        c.includes(role.id) ? c.filter((id) => id !== role.id) : [...c, role.id],
                      )
                    }
                    className={cn(
                      "rounded-full px-3 py-1 text-xs",
                      roles.includes(role.id)
                        ? "bg-white text-black"
                        : "border border-white/15 text-neutral-400",
                    )}
                  >
                    {t(role.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={saving || !teamName.trim() || roles.length === 0}
              className="mt-5 h-10 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
            >
              {t("createTeamAdvanced")}
            </button>
          </form>
        </div>
      ) : null}

      {hireOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <form
            onSubmit={(event) => void hireAgent(event)}
            className="hq-rise max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-white/15 bg-[var(--color-surface)] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-medium tracking-[-0.03em] text-white">
                  {t("hireAgent")}
                </h2>
                <p className="mt-1 text-[13px] text-neutral-500">{t("hqHireSimpleBody")}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHireOpen(false);
                  setHireAdvanced(false);
                }}
                className="chat-pro-icon-btn"
                aria-label={t("cancel")}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    id: "code",
                    name: t("chatStarterCode"),
                    role: "Software engineer",
                    specialty: "Coding",
                    instructions:
                      "Write clean code, propose concrete diffs, run checks before claiming done.",
                  },
                  {
                    id: "research",
                    name: t("chatStarterResearch"),
                    role: "Researcher",
                    specialty: "Research",
                    instructions:
                      "Dig for primary facts, cite assumptions, prefer concise bullets.",
                  },
                  {
                    id: "write",
                    name: t("chatStarterWrite"),
                    role: "Writer",
                    specialty: "Writing",
                    instructions: "Write clearly, match the user's voice, keep drafts useful.",
                  },
                  {
                    id: "ops",
                    name: t("chatStarterOps"),
                    role: "Ops partner",
                    specialty: "Ops",
                    instructions:
                      "Prefer checklists, safe rollbacks, and verifiable commands.",
                  },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setHireName(preset.name);
                    setHireRole(preset.role);
                    setHireSpecialty(preset.specialty);
                    setHireInstructions(preset.instructions);
                  }}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-start transition-colors",
                    hireSpecialty === preset.specialty
                      ? "border-white/25 bg-white/[0.08]"
                      : "border-white/[0.08] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="block text-[13px] font-medium text-white">{preset.name}</span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500">{preset.role}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3">
              <Field label={t("employeeName")}>
                <input
                  required
                  value={hireName}
                  onChange={(event) => setHireName(event.target.value)}
                  placeholder={t("chatSoloNamePlaceholder")}
                  className="field"
                />
              </Field>
              <Field label={t("employeeRole")}>
                <input
                  required
                  value={hireRole}
                  onChange={(event) => setHireRole(event.target.value)}
                  placeholder={t("hireRolePlaceholder")}
                  className="field"
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={() => setHireAdvanced((open) => !open)}
              className="mt-3 text-[12px] text-neutral-500 hover:text-neutral-200"
            >
              {hireAdvanced ? t("hqHireHideAdvanced") : t("hqHireShowAdvanced")}
            </button>

            {hireAdvanced ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label={t("employeeSpecialty")}>
                  <input
                    value={hireSpecialty}
                    onChange={(event) => setHireSpecialty(event.target.value)}
                    placeholder={t("hireSpecialtyPlaceholder")}
                    className="field"
                  />
                </Field>
                <Field label={t("assignTeam")}>
                  <select
                    value={hireTeamId}
                    onChange={(event) => setHireTeamId(event.target.value)}
                    className="field"
                  >
                    <option value="">{t("none")}</option>
                    {orgTeams.map((team) => {
                      const seated = (membersByTeam.get(team.id) ?? []).filter(
                        (agent) => agent.status !== "archived",
                      ).length;
                      const full = seated >= MAX_DEPT_AGENTS;
                      return (
                        <option key={team.id} value={team.id} disabled={full}>
                          {team.name} ({seated}/{MAX_DEPT_AGENTS}
                          {full ? ` — ${t("deptFull")}` : ""})
                        </option>
                      );
                    })}
                  </select>
                  <p className="mt-1 text-[11px] text-neutral-500">{t("deptSeatsHint")}</p>
                </Field>
                <Field label={t("colProject")}>
                  <select
                    value={hireProjectId}
                    onChange={(event) => setHireProjectId(event.target.value)}
                    className="field"
                  >
                    <option value="">{t("none")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-end gap-2 pb-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={hireActive}
                    onChange={(event) => setHireActive(event.target.checked)}
                  />
                  {t("hireActiveNow")}
                </label>
                <div className="md:col-span-2">
                  <Field label={t("employeeBio")}>
                    <textarea
                      value={hireBio}
                      onChange={(event) => setHireBio(event.target.value)}
                      rows={2}
                      placeholder={t("hireBioPlaceholder")}
                      className="field"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label={t("employeeInstructions")}>
                    <textarea
                      value={hireInstructions}
                      onChange={(event) => setHireInstructions(event.target.value)}
                      rows={3}
                      placeholder={t("hireInstructionsPlaceholder")}
                      className="field"
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving || !hireName.trim() || !hireRole.trim()}
              className="mt-5 h-11 w-full rounded-full bg-white text-[14px] font-medium text-black disabled:opacity-40"
            >
              {saving ? t("saving") : t("hqHireCta")}
            </button>
          </form>
        </div>
      ) : null}

      {agentMenu ? (
        <div
          className="wf-agent-menu fixed z-[90] min-w-[230px] overflow-hidden rounded-2xl border border-white/10 bg-[#111] py-1 shadow-2xl"
          style={{ left: agentMenu.x, top: agentMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const target = agents.find((agent) => agent.id === agentMenu.agentId);
            if (!target) return null;
            const pinned = pinnedAgentIds.includes(target.id);
            const policy = readAgentSessionPolicy(target.id);
            return (
              <>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => {
                    setPinnedAgentIds(togglePinnedAgent(target.id));
                    setAgentMenu(null);
                  }}
                >
                  <Pin className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {pinned ? t("wfUnpin") : t("wfPin")}
                </button>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => {
                    setAgentMenu(null);
                    talkTo(target.id);
                  }}
                >
                  <Bell className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("wfMessageAgent")}
                </button>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => void renamePerson(target.id)}
                >
                  <SquarePen className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("wfRenameAgent")}
                </button>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => {
                    setAgentMenu(null);
                    openEmployeeDesk(target.id);
                  }}
                >
                  <Pencil className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("wfEditProfile")}
                </button>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => void duplicatePerson(target.id)}
                >
                  <Copy className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("chatDuplicateAgent")}
                </button>
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => setAgentApproval(target.id, "ask")}
                >
                  <ShieldQuestion className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("coworkAskApproval")}
                  {policy === "ask" ? (
                    <span className="ms-auto text-[10px] text-neutral-500">✓</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="wf-menu-item"
                  onClick={() => setAgentApproval(target.id, "allow")}
                >
                  <ShieldCheck className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("coworkAllowEverything")}
                  {policy === "allow" ? (
                    <span className="ms-auto text-[10px] text-neutral-500">✓</span>
                  ) : null}
                </button>
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  type="button"
                  className="wf-menu-item"
                  disabled={agentBusy}
                  onClick={() => void archivePerson(target.id)}
                >
                  <Archive className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("chatArchiveAgent")}
                </button>
                <button
                  type="button"
                  className="wf-menu-item is-danger"
                  disabled={agentBusy}
                  onClick={() => void deletePerson(target.id)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.7} />
                  {t("wfDeleteAgent")}
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </Surface>
  );
}

function OpsChip({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2",
        accent ? "border-white/25 bg-white/[0.06]" : "border-white/10 bg-[var(--color-surface)]",
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="mt-0.5 text-2xl tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-start"
    >
      <span className="text-xs text-neutral-400">{label}</span>
      <span
        className={cn(
          "flex h-5 w-9 items-center rounded-full px-0.5",
          checked ? "bg-white" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full transition-transform",
            checked ? "translate-x-4 bg-black" : "bg-neutral-400",
          )}
        />
      </span>
    </button>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-white/70"
          style={{ width: `${Math.max(6, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}
