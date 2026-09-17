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
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  UsersRound,
  UserRound,
  X,
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
import { readPrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
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
  const [bindings, setBindings] = useState<ProjectRepoBinding[]>([]);

  const [knowTitle, setKnowTitle] = useState("");
  const [knowContent, setKnowContent] = useState("");
  const [knowProject, setKnowProject] = useState("");

  const load = useCallback(() => {
    setError(null);
    setLoading(true);
    const allowAnalytics = readPrefs().privacyAnalytics;

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
      allowAnalytics
        ? settled(arrabApi.reportSummary(), null as ReportSummaryResponse | null)
        : Promise.resolve(null as ReportSummaryResponse | null),
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
        setReport(rep);
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
  // Studio owner (no employee seat) keeps operator seat rules.
  // Signed-in employees: members/managers lose Live Map + Administration.
  const canAssignWork =
    orgEmployee == null
      ? seatRole === "admin" || seatRole === "manager"
      : orgEmployee.role === "admin" || orgEmployee.role === "manager";
  const canAdminister =
    orgEmployee == null ? seatRole === "admin" : orgEmployee.role === "admin";
  const canOpenLiveMap = orgEmployee == null || orgEmployee.role === "admin";

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

  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of TASK_COLUMNS) map.set(status, []);
    const filtered = tasks.filter((task) => {
      if (taskFilterAssignee && task.assigneeAgentId !== taskFilterAssignee) return false;
      if (taskFilterPriority && task.priority !== taskFilterPriority) return false;
      if (taskFilterProject && task.projectId !== taskFilterProject) return false;
      return true;
    });
    for (const task of filtered) {
      const list = map.get(task.status) ?? [];
      list.push(task);
      map.set(task.status, list);
    }
    return map;
  }, [taskFilterAssignee, taskFilterPriority, taskFilterProject, tasks]);

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
      await arrabApi.createTask({
        title: taskTitle,
        brief: taskBrief || null,
        priority: taskPriority,
        assigneeAgentId: taskAssignee || null,
        teamId: taskTeam || null,
        projectId: taskProject || null,
      });
      setTaskTitle("");
      setTaskBrief("");
      setTaskPriority("medium");
      setTaskAssignee("");
      setTaskTeam("");
      setTaskProject("");
      setTaskFormOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function advanceTask(task: Task) {
    const order: TaskStatus[] = ["backlog", "assigned", "in_progress", "blocked", "done"];
    const index = order.indexOf(task.status);
    const next = order[Math.min(index + 1, order.length - 1)];
    if (!next || next === task.status) return;
    try {
      await arrabApi.updateTask(task.id, { status: next });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
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

  async function createKnowledge(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await arrabApi.createKnowledge({
        title: knowTitle,
        content: knowContent,
        projectId: knowProject || null,
      });
      setKnowTitle("");
      setKnowContent("");
      setKnowProject("");
      setKnowledgeFormOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteKnowledge(id: string) {
    try {
      await arrabApi.deleteKnowledge(id);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
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

  function openCoworkWith(agentId: string) {
    try {
      localStorage.setItem("arrab.cowork.lastAgent", agentId);
    } catch {
      // ignore
    }
    sessionStorage.setItem("arrab.chatAgent", agentId);
    navigate("/cowork");
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
              onClick={() => load()}
              className="chat-pro-icon-btn"
              title={t("refresh")}
              aria-label={t("refresh")}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => navigate("/cowork")}
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
                            onClick={() => navigate("/cowork")}
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
                                        onClick={() => openCoworkWith(task.assigneeAgentId!)}
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
              <div className="hq-rise flex h-full min-h-0 flex-col space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg text-white">{t("ccTasks")}</h2>
                    <p className="mt-0.5 text-sm text-neutral-500">{t("ccTasksBody")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTaskFormOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-black"
                  >
                    <Plus className="size-3.5" />
                    {t("assignTask")}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={taskFilterAssignee}
                    onChange={(e) => setTaskFilterAssignee(e.target.value)}
                    className="field"
                  >
                    <option value="">{t("allAssignees")}</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={taskFilterPriority}
                    onChange={(e) => setTaskFilterPriority(e.target.value as TaskPriority | "")}
                    className="field"
                  >
                    <option value="">{t("allPriorities")}</option>
                    <option value="urgent">urgent</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                  <select
                    value={taskFilterProject}
                    onChange={(e) => setTaskFilterProject(e.target.value)}
                    className="field"
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
                  <form
                    onSubmit={createTask}
                    className="rounded-[28px] border border-white/10 bg-[var(--color-surface)] p-5"
                  >
                    <h2 className="text-lg text-white">{t("assignTask")}</h2>
                    <p className="mt-1 text-sm text-neutral-500">{t("assignTaskBody")}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Field label={t("taskTitle")}>
                        <input
                          required
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          className="field"
                        />
                      </Field>
                      <Field label={t("taskPriority")}>
                        <select
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                          className="field"
                        >
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                          <option value="urgent">urgent</option>
                        </select>
                      </Field>
                      <Field label={t("taskAssignee")}>
                        <select
                          value={taskAssignee}
                          onChange={(e) => setTaskAssignee(e.target.value)}
                          className="field"
                        >
                          <option value="">{t("unassigned")}</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("taskTeam")}>
                        <select
                          value={taskTeam}
                          onChange={(e) => setTaskTeam(e.target.value)}
                          className="field"
                        >
                          <option value="">{t("none")}</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("colProject")}>
                        <select
                          value={taskProject}
                          onChange={(e) => setTaskProject(e.target.value)}
                          className="field"
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
                      </Field>
                      <Field label={t("taskBrief")}>
                        <textarea
                          value={taskBrief}
                          onChange={(e) => setTaskBrief(e.target.value)}
                          rows={3}
                          className="field"
                        />
                      </Field>
                    </div>
                    {taskProject && projectRepo(taskProject) ? (
                      <p className="mt-3 text-xs text-neutral-500">
                        {t("taskUsesConnector")}: {projectRepo(taskProject)}
                      </p>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <button
                        type="submit"
                        disabled={saving || !taskTitle.trim()}
                        className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                      >
                        {t("createTask")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskFormOpen(false)}
                        className="h-9 rounded-full border border-white/15 px-4 text-sm text-neutral-300"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>
                ) : null}
                <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
                  {TASK_COLUMNS.map((status) => (
                    <div
                      key={status}
                      className="min-w-[210px] flex-1 rounded-[22px] border border-white/10 bg-[var(--color-surface)] p-3"
                    >
                      <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                        {status.replace("_", " ")}
                      </p>
                      <div className="mt-3 max-h-[48vh] space-y-2 overflow-y-auto">
                        {(tasksByStatus.get(status) ?? []).map((task) => (
                          <div
                            key={task.id}
                            className="rounded-xl border border-white/10 bg-black/50 p-3"
                          >
                            <p className="text-sm text-white">{task.title}</p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                              {task.priority} · {agentName(task.assigneeAgentId)}
                            </p>
                            {projectRepo(task.projectId) ? (
                              <p className="mt-1 truncate text-[10px] text-neutral-600">
                                {projectRepo(task.projectId)}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {task.assigneeAgentId && task.status !== "done" ? (
                                <button
                                  type="button"
                                  disabled={runningTaskId === task.id}
                                  onClick={() => void runTask(task)}
                                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] text-black disabled:opacity-40"
                                >
                                  <Play className="size-2.5" />
                                  {runningTaskId === task.id ? t("runningTask") : t("runTask")}
                                </button>
                              ) : null}
                              {task.status !== "done" ? (
                                <button
                                  type="button"
                                  onClick={() => void advanceTask(task)}
                                  className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-neutral-300"
                                >
                                  {t("advance")}
                                </button>
                              ) : null}
                              {task.assigneeAgentId ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => talkTo(task.assigneeAgentId!, task)}
                                    className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-neutral-300"
                                  >
                                    {t("openChat")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEmployeeDesk(task.assigneeAgentId!)}
                                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-neutral-300"
                                  >
                                    <Monitor className="size-2.5" />
                                    {t("openDesk")}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {(tasksByStatus.get(status) ?? []).length === 0 ? (
                          <p className="text-xs text-neutral-600">{t("noTasksHere")}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {runPreview ? (
                  <div className="rounded-[22px] border border-white/10 bg-[var(--color-surface)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("lastRunOutput")}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{runPreview}</p>
                  </div>
                ) : null}
                {taskRuns.length > 0 ? (
                  <div className="rounded-[22px] border border-white/10 bg-[var(--color-surface)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("runHistory")}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {taskRuns.slice(0, 8).map((run) => (
                        <li key={run.id} className="text-sm text-neutral-300">
                          <span className="text-neutral-500">{run.status}</span>
                          {" · "}
                          {run.summary ?? t("noRunSummary")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {view === "knowledge" ? (
              <div className="hq-rise space-y-4">
                {knowledgeFormOpen ? (
                  <form
                    onSubmit={createKnowledge}
                    className="rounded-[28px] border border-white/10 bg-[var(--color-surface)] p-5"
                  >
                    <h2 className="text-lg text-white">{t("addKnowledge")}</h2>
                    <p className="mt-1 text-sm text-neutral-500">{t("ccKnowledgeBody")}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Field label={t("knowledgeTitle")}>
                        <input
                          required
                          value={knowTitle}
                          onChange={(e) => setKnowTitle(e.target.value)}
                          className="field"
                        />
                      </Field>
                      <Field label={t("colProject")}>
                        <select
                          value={knowProject}
                          onChange={(e) => setKnowProject(e.target.value)}
                          className="field"
                        >
                          <option value="">{t("workspaceWide")}</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="md:col-span-2">
                        <Field label={t("knowledgeContent")}>
                          <textarea
                            required
                            value={knowContent}
                            onChange={(e) => setKnowContent(e.target.value)}
                            rows={5}
                            className="field"
                          />
                        </Field>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="submit"
                        disabled={saving || !knowTitle.trim() || !knowContent.trim()}
                        className="h-9 rounded-full bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
                      >
                        {t("saveKnowledge")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setKnowledgeFormOpen(false)}
                        className="h-9 rounded-full border border-white/15 px-4 text-sm text-neutral-300"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setKnowledgeFormOpen(true)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm text-neutral-200"
                    >
                      <Plus className="size-3.5" />
                      {t("addKnowledge")}
                    </button>
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  {knowledge.map((doc) => (
                    <article
                      key={doc.id}
                      className="rounded-[22px] border border-white/10 bg-[var(--color-surface)] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-white">{doc.title}</p>
                          <p className="mt-1 text-[11px] text-neutral-500">
                            {doc.projectId
                              ? projects.find((p) => p.id === doc.projectId)?.name ?? doc.projectId
                              : t("workspaceWide")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteKnowledge(doc.id)}
                          className="text-[11px] text-neutral-500 hover:text-neutral-300"
                        >
                          {t("delete")}
                        </button>
                      </div>
                      <p className="mt-3 line-clamp-4 text-sm text-neutral-400">{doc.content}</p>
                    </article>
                  ))}
                  {knowledge.length === 0 ? (
                    <p className="text-sm text-neutral-500 md:col-span-2">{t("noKnowledge")}</p>
                  ) : null}
                </div>
              </div>
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
              <section className="hq-rise rounded-[28px] border border-white/10 bg-[var(--color-surface)] p-5">
                <h2 className="text-lg text-white">{t("ccReports")}</h2>
                <p className="mt-1 text-sm text-neutral-500">{t("ccReportsBody")}</p>
                {report ? (
                  <>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <OpsChip label={t("openTasks")} value={report.tasks.open} />
                      <OpsChip label={t("doneTasks")} value={report.tasks.done} />
                      <OpsChip label={t("knowledgeCount")} value={report.knowledgeCount} />
                      <OpsChip label={t("memoryCount")} value={report.memoryCount} />
                      <OpsChip label={t("skillCount")} value={report.skillCount ?? 0} />
                      <OpsChip
                        label={t("pendingApprovals")}
                        value={report.pendingApprovals ?? 0}
                      />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <OpsChip label={t("usageInputTokens")} value={report.usage.inputTokens} />
                      <OpsChip label={t("usageOutputTokens")} value={report.usage.outputTokens} />
                    </div>
                    <div className="mt-6 grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                          {t("agentsByStatus")}
                        </p>
                        <div className="mt-3 space-y-2">
                          {Object.entries(report.agentsByStatus).map(([status, count]) => (
                            <BarRow
                              key={status}
                              label={status}
                              value={count}
                              max={Math.max(1, agents.length)}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                          {t("runHistory")}
                        </p>
                        <ul className="mt-3 space-y-2">
                          {(report.recentTaskRuns ?? []).slice(0, 6).map((run) => (
                            <li key={run.id} className="text-sm text-neutral-300">
                              <span className="text-neutral-500">{run.status}</span>
                              {" · "}
                              {run.summary ?? t("noRunSummary")}
                            </li>
                          ))}
                          {(report.recentTaskRuns ?? []).length === 0 ? (
                            <li className="text-sm text-neutral-600">{t("noRunsYet")}</li>
                          ) : null}
                        </ul>
                      </div>
                      <div className="lg:col-span-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                          {t("recentPulse")}
                        </p>
                        <ul className="mt-3 space-y-2">
                          {report.recentActivity.slice(0, 8).map((entry) => (
                            <li key={entry.id} className="text-sm text-neutral-300">
                              {entry.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-neutral-500">{t("loading")}</p>
                )}
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
