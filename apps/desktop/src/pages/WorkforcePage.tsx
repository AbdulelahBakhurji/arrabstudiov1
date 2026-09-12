import { type DragEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  ClipboardList,
  BookOpen,
  Crown,
  Laptop,
  MessageSquare,
  MoreHorizontal,
  Monitor,
  Network,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
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
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import { collapseDefaultSoloDupes } from "@/lib/agents-bootstrap";
import { notifyStudio } from "@/lib/notify";
import { readPrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

type ViewMode = "org" | "tasks" | "knowledge" | "chat" | "reports";
type ChatLaunchMode = "solo" | "team";
type TeamMode = "autonomous" | "supervised" | "pair";
type ApprovalPolicy = "auto" | "human" | "dual";
type AutomationLevel = "low" | "medium" | "high";
const ALL_HANDS_TEAM = "Studio All-Hands";

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
  const [view, setView] = useState<ViewMode>("org");
  const [inspector, setInspector] = useState<"pulse" | "people" | "approvals">("people");
  const [chatLaunchMode, setChatLaunchMode] = useState<ChatLaunchMode>("solo");
  const [composeOpen, setComposeOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [hireAdvanced, setHireAdvanced] = useState(false);
  const [personMenu, setPersonMenu] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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
  const [mapDrag, setMapDrag] = useState<{ agentId: string; fromTeamId: string | null } | null>(
    null,
  );
  const [mapDropOver, setMapDropOver] = useState<string | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [teamOrder, setTeamOrder] = useState<string[]>(() => readMapTeamOrder());
  const [teamDragId, setTeamDragId] = useState<string | null>(null);
  const mapDragMoved = useRef(false);

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
        let people = a.items.filter((agent) => agent.status !== "archived");
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
    if (!personMenu) return;
    const close = () => {
      setPersonMenu(null);
      setPendingDeleteId(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [personMenu]);

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
  const peopleAgents = useMemo(
    () => agents.filter((agent) => agent.status !== "archived"),
    [agents],
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
    if (!text) return;
    const next = [
      { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() },
      ...directives,
    ].slice(0, 12);
    setDirectives(next);
    setDirectiveDraft("");
    void (async () => {
      try {
        await arrabApi.createKnowledge({
          title: "HQ operator directives",
          content: next.map((item) => `- ${item.text}`).join("\n"),
          projectId: null,
        });
        const active = agents.filter((agent) => agent.status === "active" || agent.status === "draft");
        await Promise.all(
          active.slice(0, 20).map((agent) =>
            arrabApi.createMemory({
              content: `HQ directive: ${text}`,
              agentId: agent.id,
              projectId: agent.projectId,
            }),
          ),
        );
        load();
      } catch {
        // local directive still saved
      }
    })();
  }

  async function hireAgent(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
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
      setInspector("people");
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

  async function movePersonOnMap(
    agentId: string,
    fromTeamId: string | null,
    to: string,
  ) {
    if (to === "unassigned" && !fromTeamId && !memberships.some((m) => m.agentId === agentId)) {
      return;
    }
    if (to !== "unassigned" && fromTeamId === to) return;

    setMapBusy(true);
    setError(null);
    const previous = memberships;
    try {
      const currentTeams = memberships
        .filter((item) => item.agentId === agentId)
        .map((item) => item.teamId);

      if (to === "unassigned") {
        for (const teamId of currentTeams) {
          await arrabApi.removeTeamMember(teamId, agentId);
        }
        setMemberships((current) => current.filter((item) => item.agentId !== agentId));
      } else {
        for (const teamId of currentTeams) {
          if (teamId !== to) {
            await arrabApi.removeTeamMember(teamId, agentId);
          }
        }
        if (!currentTeams.includes(to as TeamId)) {
          await arrabApi.addTeamMember(to as TeamId, { agentId: agentId as Agent["id"] });
        }
        setMemberships((current) => {
          const cleaned = current.filter((item) => item.agentId !== agentId);
          return [
            ...cleaned,
            {
              teamId: to as TeamId,
              agentId: agentId as Agent["id"],
              createdAt: new Date().toISOString(),
            },
          ];
        });
      }
    } catch (err: unknown) {
      setMemberships(previous);
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) setError(message);
    } finally {
      setMapBusy(false);
      setMapDrag(null);
      setMapDropOver(null);
    }
  }

  function reorderTeamOnMap(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setTeamOrder(() => {
      const base = orderedOrgTeams.map((team) => team.id as string);
      const without = base.filter((id) => id !== draggedId);
      const at = without.indexOf(targetId);
      if (at < 0) return [...without, draggedId];
      const next = [...without];
      next.splice(at, 0, draggedId);
      return next;
    });
  }

  function personDragProps(agent: Agent, fromTeamId: string | null) {
    return {
      draggable: !mapBusy,
      onDragStart: (event: DragEvent) => {
        event.stopPropagation();
        mapDragMoved.current = false;
        setMapDrag({ agentId: agent.id, fromTeamId });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-arrab-agent",
          JSON.stringify({ agentId: agent.id, fromTeamId }),
        );
        event.dataTransfer.setData("text/plain", agent.id);
      },
      onDrag: () => {
        mapDragMoved.current = true;
      },
      onDragEnd: () => {
        setMapDrag(null);
        setMapDropOver(null);
      },
      onClick: () => {
        if (mapDragMoved.current) {
          mapDragMoved.current = false;
          return;
        }
        setInspector("people");
        setPersonMenu(null);
        openEmployeeDesk(agent.id);
      },
    };
  }

  function dropZoneProps(targetId: string) {
    return {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setMapDropOver(targetId);
      },
      onDragLeave: () => {
        setMapDropOver((current) => (current === targetId ? null : current));
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        const teamPayload = event.dataTransfer.getData("application/x-arrab-team");
        if (teamPayload && targetId !== "unassigned") {
          reorderTeamOnMap(teamPayload, targetId);
          setTeamDragId(null);
          setMapDropOver(null);
          return;
        }
        let agentId = mapDrag?.agentId ?? "";
        let fromTeamId = mapDrag?.fromTeamId ?? null;
        try {
          const raw = event.dataTransfer.getData("application/x-arrab-agent");
          if (raw) {
            const parsed = JSON.parse(raw) as { agentId?: string; fromTeamId?: string | null };
            agentId = parsed.agentId ?? agentId;
            fromTeamId = parsed.fromTeamId ?? fromTeamId;
          }
        } catch {
          // ignore
        }
        if (!agentId) {
          agentId = event.dataTransfer.getData("text/plain") || agentId;
        }
        setMapDropOver(null);
        setMapDrag(null);
        if (agentId) {
          void movePersonOnMap(agentId, fromTeamId, targetId);
        }
      },
    };
  }

  async function setPersonStatus(id: string, status: "active" | "paused") {
    setPersonMenu(null);
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

  async function deletePerson(id: string) {
    setPersonMenu(null);
    setPendingDeleteId(null);
    const previous = agents;
    const previousMemberships = memberships;
    setAgentBusy(true);
    setError(null);
    setAgents((current) => current.filter((agent) => agent.id !== id));
    setMemberships((current) => current.filter((item) => item.agentId !== id));
    try {
      try {
        await arrabApi.deleteAgent(id);
      } catch {
        // Production may not have DELETE yet — archive still removes them from People.
        await arrabApi.updateAgent(id, { status: "archived" });
      }
    } catch {
      setAgents(previous);
      setMemberships(previousMemberships);
      setError(t("chatDeleteFailed"));
    } finally {
      setAgentBusy(false);
    }
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

  const views = [
    ["org", t("ccOrg"), Network],
    ["tasks", t("ccTasks"), ClipboardList],
    ["knowledge", t("ccKnowledge"), BookOpen],
    ["chat", t("ccChat"), MessageSquare],
    ["reports", t("ccReports"), BarChart3],
  ] as const;

  return (
    <Surface className="workforce-shell hq-shell chat-comfy flex h-full flex-col overflow-hidden">
      <div className="workforce-atmosphere pointer-events-none absolute inset-0" />
      <div className="hq-atmosphere pointer-events-none absolute inset-0 opacity-60" />

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
                <span className="chat-pro-status hidden sm:inline-flex">
                  <span className="hq-live-dot" />
                  {t("hqLive")}
                </span>
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
          <nav className="hidden shrink-0 flex-col gap-0.5 border-e border-white/[0.06] bg-[#050505] px-2 py-3 sm:flex sm:w-[148px]">
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
            {view === "org" ? (
              <div className="hq-rise grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.85fr)]">
                <section className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                    <div className="min-w-0">
                      <p className="chat-pro-kicker">{t("workforceMap")}</p>
                      <p className="mt-0.5 text-[12px] text-neutral-500">
                        {mapBusy ? t("mapMoving") : t("mapDragHint")}
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
                  <div className="hq-map relative min-h-[320px] flex-1 px-4 py-8">
                    <div className="flex justify-center">
                      <HqNode
                        title={operator?.displayName ?? t("operatorSeat")}
                        subtitle={operator?.title ?? t("noSeatChosen")}
                        root
                      />
                    </div>
                    <div className="mx-auto my-1 h-10 w-px bg-gradient-to-b from-white/35 to-white/8" />
                    <div className="flex flex-col items-center">
                      <HqNode
                        title={t("mapStudio")}
                        subtitle={`${orderedOrgTeams.length} ${t("teams")} · ${peopleAgents.length} ${t("employees")}`}
                      />
                      <button
                        type="button"
                        onClick={() => setComposeOpen(true)}
                        className="hq-map-add mt-2 inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[10px] text-neutral-400 hover:border-white/35 hover:text-neutral-200"
                      >
                        <Plus className="size-3" />
                        {t("mapAddTeam")}
                      </button>
                    </div>
                    {orderedOrgTeams.length === 0 && peopleAgents.length === 0 ? (
                      <div className="mx-auto mt-10 max-w-md text-center">
                        <p className="text-[14px] text-neutral-300">{t("hqEmptyMap")}</p>
                        <p className="mt-2 text-[12px] text-neutral-500">
                          {t("hqEmptyMapHint")}
                        </p>
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
                          <button
                            type="button"
                            onClick={() => navigate("/cowork")}
                            className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                          >
                            {t("hqOpenCowork")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mx-auto my-1 h-8 w-px bg-white/12" />
                        <div className="flex flex-wrap justify-center gap-5">
                          {orderedOrgTeams.map((team) => {
                            const meta = teamMeta[team.id];
                            const members = (membersByTeam.get(team.id) ?? []).filter(
                              (agent) => agent.status !== "archived",
                            );
                            const dropActive = mapDropOver === team.id;
                            return (
                              <div
                                key={team.id}
                                className={cn(
                                  "hq-map-column flex min-w-[200px] flex-col items-center rounded-2xl border border-transparent px-2 pb-2 pt-0 transition-colors",
                                  dropActive && "border-white/25 bg-white/[0.04]",
                                  teamDragId === team.id && "opacity-50",
                                )}
                                {...dropZoneProps(team.id)}
                              >
                                <div className="h-5 w-px bg-white/12" />
                                <div
                                  draggable={!mapBusy}
                                  onDragStart={(event) => {
                                    setTeamDragId(team.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData("application/x-arrab-team", team.id);
                                  }}
                                  onDragEnd={() => setTeamDragId(null)}
                                  className="cursor-grab active:cursor-grabbing"
                                  title={t("mapDragHint")}
                                >
                                  <HqNode
                                    title={team.name}
                                    subtitle={
                                      meta
                                        ? `${meta.mode} · ${meta.approval}`
                                        : (team.purpose ?? t("none"))
                                    }
                                  />
                                </div>
                                <div className="mt-3 flex min-h-[40px] flex-wrap items-center justify-center gap-1">
                                  <div className="flex -space-x-2">
                                    {members.slice(0, 6).map((agent) => (
                                      <button
                                        key={agent.id}
                                        type="button"
                                        {...personDragProps(agent, team.id)}
                                        className={cn(
                                          "hq-avatar flex size-9 cursor-grab items-center justify-center rounded-full border border-white/20 bg-[#111] text-[10px] text-white active:cursor-grabbing",
                                          mapDrag?.agentId === agent.id && "opacity-40",
                                        )}
                                        title={`${agent.name} · ${t("hqManageAgent")}`}
                                      >
                                        {initials(agent.name)}
                                      </button>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openHireOnMap(team.id)}
                                    className="hq-map-add flex size-8 items-center justify-center rounded-full border border-dashed border-white/25 text-neutral-500 hover:border-white/40 hover:text-white"
                                    title={t("mapAddPerson")}
                                  >
                                    <Plus className="size-3.5" strokeWidth={1.8} />
                                  </button>
                                </div>
                                {dropActive && mapDrag ? (
                                  <p className="mt-2 text-[10px] text-neutral-400">{t("mapDropHere")}</p>
                                ) : null}
                                <div className="mt-3 flex gap-1.5">
                                  <button
                                    type="button"
                                    disabled={members.length === 0}
                                    onClick={() => {
                                      openTeamChat(team.id);
                                      navigate("/chat");
                                    }}
                                    className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-neutral-300 hover:bg-white/5 disabled:opacity-40"
                                  >
                                    {t("talkToTeam")}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={members.length === 0}
                                    onClick={() => {
                                      if (members[0]) openCoworkWith(members[0].id);
                                    }}
                                    className="rounded-full bg-white px-2.5 py-1 text-[10px] text-black disabled:opacity-40"
                                  >
                                    {t("hqOpenCowork")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          <div
                            className={cn(
                              "hq-map-column flex min-w-[220px] flex-col items-center rounded-2xl border border-transparent px-2 pb-2 transition-colors",
                              mapDropOver === "unassigned" && "border-white/25 bg-white/[0.04]",
                            )}
                            {...dropZoneProps("unassigned")}
                          >
                            <div className="h-5 w-px bg-white/12" />
                            <HqNode
                              title={t("mapUnassigned")}
                              subtitle={`${unassignedAgents.length} ${t("employees")}`}
                            />
                            <div className="mt-3 flex min-h-[40px] max-w-[240px] flex-wrap justify-center gap-2">
                              {unassignedAgents.slice(0, 8).map((agent) => (
                                <button
                                  key={agent.id}
                                  type="button"
                                  {...personDragProps(agent, null)}
                                  className={cn(
                                    "hq-avatar flex size-10 cursor-grab items-center justify-center rounded-full border border-white/20 bg-[#111] text-[10px] text-white active:cursor-grabbing",
                                    mapDrag?.agentId === agent.id && "opacity-40",
                                  )}
                                  title={agent.name}
                                >
                                  {initials(agent.name)}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => openHireOnMap()}
                                className="hq-map-add flex size-10 items-center justify-center rounded-full border border-dashed border-white/25 text-neutral-500 hover:border-white/40 hover:text-white"
                                title={t("mapAddPerson")}
                              >
                                <Plus className="size-3.5" strokeWidth={1.8} />
                              </button>
                            </div>
                            {mapDropOver === "unassigned" && mapDrag ? (
                              <p className="mt-2 text-[10px] text-neutral-400">{t("mapDropHere")}</p>
                            ) : null}
                            <div className="mt-3 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => setInspector("people")}
                                className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-neutral-300 hover:bg-white/5"
                              >
                                {t("hqManagePeople")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (unassignedAgents[0]) talkTo(unassignedAgents[0].id);
                                }}
                                className="rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                              >
                                {t("deskSoloChat")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                <aside className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#060606]/0.95]">
                  <div className="flex gap-1 border-b border-white/[0.06] p-2">
                    {(
                      [
                        ["pulse", t("hqPulse")],
                        ["people", t("peopleRoster")],
                        ["approvals", t("pendingApprovals")],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setInspector(id)}
                        className={cn(
                          "flex-1 rounded-xl px-2 py-2 text-[11px] transition-colors",
                          inspector === id
                            ? "bg-white/[0.08] text-white"
                            : "text-neutral-500 hover:text-neutral-300",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {inspector === "pulse" ? (
                      <div className="space-y-4">
                        <section>
                          <div className="flex items-center gap-2">
                            <Radio className="size-3.5 text-neutral-500" />
                            <p className="chat-pro-kicker">{t("operatorDirectives")}</p>
                          </div>
                          <form onSubmit={publishDirective} className="chat-pro-composer mt-3 !p-2.5">
                            <textarea
                              value={directiveDraft}
                              onChange={(e) => setDirectiveDraft(e.target.value)}
                              placeholder={t("directivePlaceholder")}
                              rows={2}
                              className="w-full resize-none bg-transparent text-[13px] text-white outline-none placeholder:text-neutral-600"
                            />
                            <div className="mt-2 flex justify-end">
                              <button
                                type="submit"
                                disabled={!directiveDraft.trim()}
                                className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                              >
                                {t("publish")}
                              </button>
                            </div>
                          </form>
                          <ul className="mt-3 max-h-36 space-y-1.5 overflow-y-auto">
                            {directives.length === 0 ? (
                              <li className="text-[12px] text-neutral-600">{t("noDirectives")}</li>
                            ) : (
                              directives.map((d) => (
                                <li
                                  key={d.id}
                                  className="rounded-xl bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-neutral-300"
                                >
                                  {d.text}
                                </li>
                              ))
                            )}
                          </ul>
                        </section>

                        <section>
                          <p className="chat-pro-kicker">{t("priorityQueue")}</p>
                          <ul className="mt-2 space-y-1.5">
                            {(urgentTasks.length > 0 ? urgentTasks : openTasks).slice(0, 5).map((task) => (
                              <li
                                key={task.id}
                                className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] text-white">{task.title}</p>
                                  <p className="text-[10px] text-neutral-500">
                                    {task.priority} · {agentName(task.assigneeAgentId)}
                                  </p>
                                </div>
                                {task.assigneeAgentId ? (
                                  <button
                                    type="button"
                                    onClick={() => openCoworkWith(task.assigneeAgentId!)}
                                    className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                                  >
                                    {t("hqOpenCowork")}
                                  </button>
                                ) : null}
                              </li>
                            ))}
                            {openTasks.length === 0 ? (
                              <li className="text-[12px] text-neutral-600">{t("noTasksHere")}</li>
                            ) : null}
                          </ul>
                        </section>
                      </div>
                    ) : null}

                    {inspector === "people" ? (
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="chat-pro-kicker">{t("peopleRoster")}</p>
                            <p className="mt-1 text-[12px] text-neutral-500">
                              {t("hqPeopleHint").replace("{count}", String(peopleAgents.length))}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setHireOpen(true)}
                            className="home-btn-primary !h-8 !px-3 !text-[11px]"
                          >
                            <Plus className="size-3.5" strokeWidth={2} />
                            {t("hireAgent")}
                          </button>
                        </div>

                        <ul className="space-y-1.5">
                          {peopleAgents.length === 0 ? (
                            <li className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
                              <p className="text-[13px] text-neutral-300">{t("hqNoPeopleYet")}</p>
                              <p className="mt-1 text-[12px] text-neutral-600">{t("hqNoPeopleHint")}</p>
                              <button
                                type="button"
                                onClick={() => setHireOpen(true)}
                                className="chat-pro-cta mt-4 !h-9 !px-4 !text-[12px]"
                              >
                                {t("hireAgent")}
                              </button>
                            </li>
                          ) : (
                            peopleAgents.map((agent) => {
                              const paused = agent.status === "paused";
                              const draft = agent.status === "draft";
                              const menuOpen = personMenu === agent.id;
                              return (
                                <li key={agent.id} className="hq-person relative">
                                  <div className="home-person flex items-center gap-2.5 !px-2.5 !py-2">
                                    <button
                                      type="button"
                                      disabled={agentBusy}
                                      onClick={() => openEmployeeDesk(agent.id)}
                                      className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
                                    >
                                      <span className="home-avatar flex size-9 shrink-0 items-center justify-center text-[11px] font-medium">
                                        {initials(agent.name)}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] text-white">
                                          {agent.name}
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                                          {paused
                                            ? t("chatAgentPaused")
                                            : draft
                                              ? t("statusDraft")
                                              : agent.specialty || agent.role}
                                          {assignedAgentIds.has(agent.id)
                                            ? ""
                                            : ` · ${t("hqSoloLabel")}`}
                                        </span>
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white/[0.06] hover:text-white"
                                      aria-label={t("hqManageAgent")}
      onClick={(event) => {
                                        event.stopPropagation();
                                        setPendingDeleteId(null);
                                        setPersonMenu(menuOpen ? null : agent.id);
                                      }}
                                    >
                                      <MoreHorizontal className="size-4" strokeWidth={1.7} />
                                    </button>
                                  </div>
                                  {menuOpen ? (
                                    <div
                                      className="absolute end-2 top-[calc(100%-4px)] z-20 min-w-[190px] overflow-hidden rounded-2xl border border-white/10 bg-[#111] py-1 shadow-2xl"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {pendingDeleteId === agent.id ? (
                                        <>
                                          <p className="px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
                                            {t("chatDeleteAgentConfirm")}
                                          </p>
                                          <button
                                            type="button"
                                            disabled={agentBusy}
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-red-300 hover:bg-white/[0.06] disabled:opacity-40"
                                            onClick={() => void deletePerson(agent.id)}
                                          >
                                            <Trash2 className="size-3.5" strokeWidth={1.7} />
                                            {t("chatDeleteForever")}
                                          </button>
                                          <button
                                            type="button"
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-300 hover:bg-white/[0.06]"
                                            onClick={() => setPendingDeleteId(null)}
                                          >
                                            {t("cancel")}
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                                        onClick={() => {
                                          setPersonMenu(null);
                                          talkTo(agent.id);
                                        }}
                                      >
                                        <MessageSquare className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                        {t("chatOpenChat")}
                                      </button>
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                                        onClick={() => {
                                          setPersonMenu(null);
                                          openCoworkWith(agent.id);
                                        }}
                                      >
                                        <Laptop className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                        {t("hqOpenCowork")}
                                      </button>
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                                        onClick={() => {
                                          setPersonMenu(null);
                                          openEmployeeDesk(agent.id);
                                        }}
                                      >
                                        <UserRound className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                        {t("openDesk")}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={agentBusy || draft}
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06] disabled:opacity-40"
                                        onClick={() =>
                                          void setPersonStatus(
                                            agent.id,
                                            paused ? "active" : "paused",
                                          )
                                        }
                                      >
                                        {paused ? (
                                          <Play className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                        ) : (
                                          <Pause className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                        )}
                                        {paused ? t("chatResumeAgent") : t("chatPauseAgent")}
                                      </button>
                                      <div className="my-1 h-px bg-white/[0.06]" />
                                      <button
                                        type="button"
                                        disabled={agentBusy}
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-red-300 hover:bg-white/[0.06] disabled:opacity-40"
                                        onClick={() => setPendingDeleteId(agent.id)}
                                      >
                                        <Trash2 className="size-3.5" strokeWidth={1.7} />
                                        {t("chatDeleteAgent")}
                                      </button>
                                        </>
                                      )}
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })
                          )}
                        </ul>

                        {peopleAgents.length > 0 ? (
                          <form
                            onSubmit={(event) => void tellSelectedAgent(event)}
                            className="space-y-2.5 border-t border-white/[0.06] pt-3"
                          >
                            <div>
                              <p className="chat-pro-kicker">{t("tellAgent")}</p>
                              <p className="mt-1 text-[11px] text-neutral-600">{t("hqTellHint")}</p>
                            </div>
                            <select
                              value={tellAgentId || peopleAgents[0]?.id || ""}
                              onChange={(event) => setTellAgentId(event.target.value)}
                              className="hq-select"
                            >
                              {peopleAgents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                            <textarea
                              value={tellText}
                              onChange={(event) => setTellText(event.target.value)}
                              rows={5}
                              placeholder={t("tellAgentPlaceholder")}
                              className="hq-note"
                            />
                            <button
                              type="submit"
                              disabled={
                                saving ||
                                !(tellAgentId || peopleAgents[0]?.id) ||
                                !tellText.trim()
                              }
                              className="home-btn-primary h-10 w-full text-[13px] disabled:opacity-40"
                            >
                              {saving ? t("saving") : t("saveToMemory")}
                            </button>
                          </form>
                        ) : null}
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
                    className="rounded-[28px] border border-white/10 bg-[#080808] p-5"
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
                      className="min-w-[210px] flex-1 rounded-[22px] border border-white/10 bg-[#070707] p-3"
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
                  <div className="rounded-[22px] border border-white/10 bg-[#080808] p-4">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                      {t("lastRunOutput")}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{runPreview}</p>
                  </div>
                ) : null}
                {taskRuns.length > 0 ? (
                  <div className="rounded-[22px] border border-white/10 bg-[#080808] p-4">
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
                    className="rounded-[28px] border border-white/10 bg-[#080808] p-5"
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
                      className="rounded-[22px] border border-white/10 bg-[#070707] p-4"
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
                <div className="rounded-[28px] border border-white/10 bg-[#070707]/0.96] p-5">
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
                                    {members.length} {t("hqChatMembers")}
                                  </span>
                                </div>
                                <div className="mt-3 flex -space-x-2">
                                  {members.slice(0, 8).map((agent) => (
                                    <button
                                      key={agent.id}
                                      type="button"
                                      onClick={() => openEmployeeDesk(agent.id)}
                                      className="hq-avatar flex size-8 items-center justify-center rounded-full border border-white/20 bg-[#111] text-[9px] text-white"
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
              <section className="hq-rise rounded-[28px] border border-white/10 bg-[#080808] p-5">
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

      {composeOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <form
            onSubmit={launchTeam}
            className="hq-rise max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/15 bg-[#0a0a0a] p-5"
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
            className="hq-rise max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-white/15 bg-[#0a0a0a] p-5"
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
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
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
        accent ? "border-white/25 bg-white/[0.06]" : "border-white/10 bg-[#080808]",
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="mt-0.5 text-2xl tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function HqNode({
  title,
  subtitle,
  root,
}: {
  title: string;
  subtitle: string;
  root?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-[150px] rounded-2xl border px-4 py-3 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)]",
        root
          ? "border-white/40 bg-white text-black"
          : "border-white/15 bg-black/80 text-white backdrop-blur",
      )}
    >
      <p className="text-sm font-medium tracking-tight">{title}</p>
      <p className={cn("mt-1 text-[11px]", root ? "text-neutral-600" : "text-neutral-500")}>
        {subtitle}
      </p>
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
