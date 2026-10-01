import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Activity,
  Agent,
  Approval,
  CreateAgentRequest,
  CreateTaskRequest,
  Knowledge,
  Project,
  Task,
  TaskPriority,
  TaskRun,
  TaskStatus,
  Team,
  TeamMembership,
  UsageSummaryResponse,
} from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { MessageKey } from "@/shared/i18n/messages";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/core/api/api";
import { collapseDefaultSoloDupes } from "@/domains/companions/agents-bootstrap";
import { filterLiveWorkforceAgents, rememberRemovedAgent } from "@/domains/chat/agent-session-policy";
import { pushToast } from "@/domains/notifications/notify";
import { isCompanionAgent } from "@/domains/organization/org-chat";
import { purposeRegistryById } from "@/domains/companions/purpose-registry";
import { prepareWorkplaceStudio } from "@/domains/organization/workplace-handoff";

export const ALL_HANDS_TEAM = "Studio All-Hands";
/** Every department office holds at most 8 companions (matches Live Map desks). */
export const MAX_DEPT_AGENTS = 8;
export const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];
export const TASK_COLUMNS: TaskStatus[] = ["backlog", "assigned", "in_progress", "blocked", "done"];
export const ROSTER_EVENT = "arrab-workforce-roster";

/** Rooms the studio creates for itself (All-Hands, Workplace desk crew) — never departments. */
export function isSystemTeam(team: { name: string }): boolean {
  return team.name === ALL_HANDS_TEAM || /^desk crew$/i.test(team.name.trim());
}
/** Ops → Workforce handoff: open the AI setup chat on arrival. */
export const OPEN_SETUP_FLAG = "arrab.workforce.openSetup";
/** Ops → Workforce handoff: open the hire sheet on arrival. */
export const OPEN_HIRE_FLAG = "arrab.workforce.openHire";

type Translate = (key: MessageKey) => string;

export function priorityRank(priority: TaskPriority): number {
  return PRIORITIES.indexOf(priority);
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function relativeAge(iso: string, t: Translate): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return t("justNow");
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return t("minsAgo").replace("{n}", String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hoursAgo").replace("{n}", String(hours));
  return t("daysAgo").replace("{n}", String(Math.floor(hours / 24)));
}

/** Team purpose carries policy tokens ("mode:supervised · approval:human"); hide them in UI. */
export function cleanPurpose(purpose: string | null | undefined): string {
  return (purpose ?? "")
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !/^(mode|approval|automation):/i.test(part))
    .join(" · ");
}

export function priorityLabel(priority: TaskPriority, t: Translate): string {
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

export function statusLabel(status: TaskStatus, t: Translate): string {
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

export function openAgentChat(agentId: string, task?: Task) {
  sessionStorage.setItem("arrab.chatAgent", agentId);
  if (task) {
    sessionStorage.setItem(
      "arrab.chatTask",
      JSON.stringify({ id: task.id, title: task.title, brief: task.brief }),
    );
  }
}

export function openTeamChat(teamId: string) {
  sessionStorage.setItem("arrab.chatTeam", teamId);
}

export function openAgentDesk(agentId: string) {
  sessionStorage.setItem("arrab.deskAgent", agentId);
}

export function openAgentWorkplace(agentId: string, task?: Task) {
  prepareWorkplaceStudio({ agentId, task: task ?? null, kindId: "arrab-assistant" });
}

function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.then(
    (value) => value,
    () => fallback,
  );
}

type WorkforceFetch = {
  a: { items: Agent[] };
  tm: { items: Team[] };
  p: { items: Project[] };
  m: { items: TeamMembership[] };
  tk: { items: Task[] };
  kn: { items: Knowledge[] };
  runs: { items: TaskRun[] };
  ap: { items: Approval[] };
  act: { items: Activity[] };
};

let sharedFetch: Promise<WorkforceFetch> | null = null;

/**
 * Every Workforce surface mounts this hook, and each used to fire its own 9-request load.
 * Concurrent callers now share one in-flight fetch; `fresh` (after a roster change) starts a new one.
 */
function fetchWorkforceShared(fresh: boolean): Promise<WorkforceFetch> {
  if (sharedFetch && !fresh) return sharedFetch;
  const run: Promise<WorkforceFetch> = (async () => {
    const [a, tm, p, m, tk, kn, runs, ap, act] = await Promise.all([
      settle(arrabApi.agents(), { items: [] as Agent[] }),
      settle(arrabApi.teams(), { items: [] as Team[] }),
      settle(arrabApi.projects(), { items: [] as Project[] }),
      settle(arrabApi.memberships(), { items: [] as TeamMembership[] }),
      settle(arrabApi.tasks(), { items: [] as Task[] }),
      settle(arrabApi.knowledge(), { items: [] as Knowledge[] }),
      settle(arrabApi.taskRuns(), { items: [] as TaskRun[] }),
      settle(arrabApi.pendingApprovals(), { items: [] as Approval[] }),
      settle(arrabApi.activity({ limit: 200 }), { items: [] as Activity[] }),
    ]);
    return { a, tm, p, m, tk, kn, runs, ap, act };
  })().finally(() => {
    if (sharedFetch === run) sharedFetch = null;
  });
  sharedFetch = run;
  return run;
}

export function useWorkforceData({ poll = true }: { poll?: boolean } = {}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      const message = error instanceof ApiRequestError ? error.message : t("apiUnavailable");
      pushToast({
        title: isTransientApiError(message) ? t("apiUnavailable") : message,
        tone: "warn",
      });
    },
    [t],
  );

  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    const { a, tm, p, m, tk, kn, runs, ap, act } = await fetchWorkforceShared(Boolean(opts?.fresh));
    let people = filterLiveWorkforceAgents(a.items);
    try {
      people = await collapseDefaultSoloDupes(people, t("chatSoloDefaultName"));
    } catch {
      // Keep the roster even if cleanup fails.
    }
    // Personal companion rooms create agents keyed by purpose id; they only join the
    // business roster once seated in a department.
    const deptIds = new Set(tm.items.filter((team) => !isSystemTeam(team)).map((team) => team.id as string));
    const seated = new Set(
      m.items.filter((item) => deptIds.has(item.teamId)).map((item) => item.agentId as string),
    );
    people = people.filter(
      (agent) =>
        seated.has(agent.id) ||
        !(isCompanionAgent(agent) || (agent.specialty && purposeRegistryById(agent.specialty))),
    );
    if (!mounted.current) return;
    setAgents(people);
    setTeams(tm.items);
    setProjects(p.items.filter((item) => item.status === "active"));
    setMemberships(m.items);
    setTasks(tk.items);
    setKnowledge(kn.items);
    setTaskRuns(runs.items);
    setApprovals(ap.items);
    setActivity(act.items);
    setLoading(false);
  }, [t]);

  const refreshLive = useCallback(async () => {
    const [tk, ap, runs, act] = await Promise.all([
      settle(arrabApi.tasks(), null),
      settle(arrabApi.pendingApprovals(), null),
      settle(arrabApi.taskRuns(), null),
      settle(arrabApi.activity({ limit: 200 }), null),
    ]);
    if (!mounted.current) return;
    if (tk) setTasks(tk.items);
    if (ap) setApprovals(ap.items);
    if (runs) setTaskRuns(runs.items);
    if (act) setActivity(act.items);
  }, []);

  const loadUsage = useCallback(async () => {
    const next = await settle(arrabApi.usage(), null);
    if (next && mounted.current) setUsage(next);
  }, []);

  useEffect(() => {
    void load();
    const onRoster = () => void load({ fresh: true });
    window.addEventListener(ROSTER_EVENT, onRoster);
    return () => window.removeEventListener(ROSTER_EVENT, onRoster);
  }, [load]);

  useEffect(() => {
    if (!poll) return;
    const id = window.setInterval(() => void refreshLive(), 15_000);
    const onFocus = () => void refreshLive();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll, refreshLive]);

  const announceRoster = useCallback(() => {
    window.dispatchEvent(new Event(ROSTER_EVENT));
  }, []);

  const membersByTeam = useMemo(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent] as const));
    const map = new Map<string, Agent[]>();
    for (const membership of memberships) {
      const agent = byId.get(membership.agentId);
      if (!agent) continue;
      const list = map.get(membership.teamId) ?? [];
      if (!list.some((item) => item.id === agent.id)) list.push(agent);
      map.set(membership.teamId, list);
    }
    return map;
  }, [agents, memberships]);

  const allHands = useMemo(
    () => teams.find((team) => team.name === ALL_HANDS_TEAM) ?? null,
    [teams],
  );

  /** Departments = teams minus the All-Hands room, de-duplicated by name. */
  const departments = useMemo(() => {
    const seen = new Map<string, Team>();
    for (const team of teams) {
      if (isSystemTeam(team)) continue;
      const key = team.name.trim().toLowerCase();
      const existing = seen.get(key);
      if (
        !existing ||
        (membersByTeam.get(team.id)?.length ?? 0) > (membersByTeam.get(existing.id)?.length ?? 0)
      ) {
        seen.set(key, team);
      }
    }
    return [...seen.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [membersByTeam, teams]);

  const departmentOf = useMemo(() => {
    const deptIds = new Set(departments.map((team) => team.id));
    const byId = new Map(departments.map((team) => [team.id, team] as const));
    const map = new Map<string, Team>();
    for (const membership of memberships) {
      if (!deptIds.has(membership.teamId) || map.has(membership.agentId)) continue;
      const team = byId.get(membership.teamId);
      if (team) map.set(membership.agentId, team);
    }
    return map;
  }, [departments, memberships]);

  const unassigned = useMemo(
    () => agents.filter((agent) => !departmentOf.has(agent.id)),
    [agents, departmentOf],
  );

  const drafts = useMemo(() => agents.filter((agent) => agent.status === "draft"), [agents]);
  const draftsAwaitingRequest = useMemo(() => {
    const requested = new Set(
      approvals
        .filter((item) => item.kind === "activate_agent" && item.agentId)
        .map((item) => item.agentId as string),
    );
    return drafts.filter((agent) => !requested.has(agent.id));
  }, [approvals, drafts]);

  const openTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "done")
        .sort(
          (a, b) =>
            priorityRank(a.priority) - priorityRank(b.priority) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [tasks],
  );

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);
  const agentName = useCallback(
    (id: string | null | undefined) => (id ? agentById.get(id as Agent["id"])?.name : null) ?? t("unassigned"),
    [agentById, t],
  );

  // ── Tasks ────────────────────────────────────────────────────────────────
  const createTask = useCallback(
    async (body: CreateTaskRequest): Promise<Task | null> => {
      try {
        const created = await arrabApi.createTask(body);
        setTasks((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        return created;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail],
  );

  const setTaskStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      if (task.status === status) return;
      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
        ),
      );
      try {
        const updated = await arrabApi.updateTask(task.id, { status });
        setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } catch (error) {
        fail(error);
        void refreshLive();
      }
    },
    [fail, refreshLive],
  );

  const updateTask = useCallback(
    async (task: Task, patch: { assigneeAgentId?: string | null; priority?: TaskPriority }) => {
      try {
        const updated = await arrabApi.updateTask(task.id, patch);
        setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        return updated;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail],
  );

  const deleteTask = useCallback(
    async (task: Task) => {
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      try {
        await arrabApi.deleteTask(task.id);
        pushToast({ title: t("hqTasksDeleted"), tone: "success" });
      } catch (error) {
        fail(error);
        void refreshLive();
      }
    },
    [fail, refreshLive, t],
  );

  /** Returns a short result line for the UI, or null on failure. */
  const runTask = useCallback(
    async (task: Task, requireApproval: boolean): Promise<string | null> => {
      if (!task.assigneeAgentId) {
        pushToast({ title: t("assignBeforeRun"), tone: "warn" });
        return null;
      }
      try {
        const result = await arrabApi.runTask(task.id, { requireApproval });
        void refreshLive();
        if (result.approval) return t("runAwaitingApproval");
        return result.assistantMessage ?? result.run.summary ?? t("wxRunStarted");
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail, refreshLive, t],
  );

  // ── Approvals ────────────────────────────────────────────────────────────
  const resolveApproval = useCallback(
    async (id: string, status: "approved" | "rejected") => {
      setApprovals((prev) => prev.filter((item) => item.id !== id));
      try {
        await arrabApi.resolveApproval(id, { status });
        pushToast({
          title: status === "approved" ? t("approvalGranted") : t("wxApprovalRejected"),
          tone: "success",
        });
        void load({ fresh: true });
      } catch (error) {
        fail(error);
        void refreshLive();
      }
    },
    [fail, load, refreshLive, t],
  );

  const activateAgent = useCallback(
    async (agent: Agent, viaApproval: boolean) => {
      try {
        if (viaApproval) {
          await arrabApi.createApproval({
            kind: "activate_agent",
            title: `Activate ${agent.name}`,
            detail: `${agent.role} · draft → active`,
            agentId: agent.id,
          });
        } else {
          await arrabApi.updateAgent(agent.id, { status: "active" });
        }
        void load({ fresh: true });
      } catch (error) {
        fail(error);
      }
    },
    [fail, load],
  );

  // ── Companions ───────────────────────────────────────────────────────────
  const hire = useCallback(
    async (body: CreateAgentRequest): Promise<Agent | null> => {
      if (body.teamId) {
        const seated = (membersByTeam.get(body.teamId) ?? []).filter(
          (agent) => agent.status !== "archived",
        ).length;
        if (seated >= MAX_DEPT_AGENTS) {
          pushToast({ title: t("deptFull"), tone: "warn" });
          return null;
        }
      }
      try {
        const agent = await arrabApi.createAgent(body);
        setAgents((prev) => [agent, ...prev.filter((item) => item.id !== agent.id)]);
        await load({ fresh: true });
        announceRoster();
        return agent;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [announceRoster, fail, load, membersByTeam, t],
  );

  const setAgentStatus = useCallback(
    async (id: string, status: "active" | "paused") => {
      const previous = agents;
      setAgents((prev) => prev.map((agent) => (agent.id === id ? { ...agent, status } : agent)));
      try {
        const updated = await arrabApi.updateAgent(id, { status });
        setAgents((prev) => prev.map((agent) => (agent.id === updated.id ? updated : agent)));
      } catch (error) {
        setAgents(previous);
        fail(error);
      }
    },
    [agents, fail],
  );

  const updateAgent = useCallback(
    async (
      id: string,
      patch: { name?: string; role?: string; specialty?: string | null; instructions?: string | null },
    ) => {
      try {
        const updated = await arrabApi.updateAgent(id, patch);
        setAgents((prev) => prev.map((agent) => (agent.id === id ? updated : agent)));
        return updated;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail],
  );

  const moveAgent = useCallback(
    async (agentId: string, teamId: string | null) => {
      const target = teamId ? departments.find((team) => team.id === teamId) : null;
      if (target) {
        const seated = (membersByTeam.get(target.id) ?? []).filter((a) => a.id !== agentId).length;
        if (seated >= MAX_DEPT_AGENTS) {
          pushToast({ title: t("deptFull"), tone: "warn" });
          return;
        }
      }
      const deptIds = new Set(departments.map((team) => team.id as string));
      const current = memberships.filter(
        (item) => item.agentId === agentId && deptIds.has(item.teamId) && item.teamId !== teamId,
      );
      try {
        for (const membership of current) {
          await arrabApi.removeTeamMember(membership.teamId, agentId).catch(() => undefined);
        }
        if (teamId && !memberships.some((m) => m.agentId === agentId && m.teamId === teamId)) {
          await arrabApi.addTeamMember(teamId, { agentId });
        }
        await load({ fresh: true });
        announceRoster();
      } catch (error) {
        fail(error);
      }
    },
    [announceRoster, departments, fail, load, memberships, membersByTeam, t],
  );

  const removeAgent = useCallback(
    async (id: string, mode: "archive" | "delete") => {
      setAgents((prev) => prev.filter((agent) => agent.id !== id));
      setMemberships((prev) => prev.filter((item) => item.agentId !== id));
      const attempts =
        mode === "archive"
          ? [() => arrabApi.archiveAgent(id), () => arrabApi.updateAgent(id, { status: "archived" })]
          : [
              () => arrabApi.removeAgent(id),
              () => arrabApi.deleteAgent(id),
              () => arrabApi.archiveAgent(id),
              () => arrabApi.updateAgent(id, { status: "archived" }),
            ];
      for (const attempt of attempts) {
        try {
          await attempt();
          break;
        } catch {
          // try the next fallback
        }
      }
      // Stay gone in this studio even if every call failed — chats remain in the database.
      rememberRemovedAgent(id);
      announceRoster();
    },
    [announceRoster],
  );

  const briefAgent = useCallback(
    async (agent: Agent, content: string) => {
      try {
        await arrabApi.createMemory({ content, agentId: agent.id, projectId: agent.projectId });
        pushToast({ title: t("wxBriefSaved").replace("{name}", agent.name), tone: "success" });
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [fail, t],
  );

  // ── Departments ──────────────────────────────────────────────────────────
  const createDepartment = useCallback(
    async (name: string, purpose: string): Promise<Team | null> => {
      try {
        const team = await arrabApi.createTeam({
          name: name.trim(),
          purpose: [purpose.trim() || null, "mode:supervised", "approval:human", "automation:medium"]
            .filter(Boolean)
            .join(" · "),
          projectId: null,
        });
        setTeams((prev) => [...prev, team]);
        announceRoster();
        return team;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [announceRoster, fail],
  );

  const updateDepartment = useCallback(
    async (team: Team, name: string, purpose: string) => {
      const policy = (team.purpose ?? "")
        .split("·")
        .map((part) => part.trim())
        .filter((part) => /^(mode|approval|automation):/i.test(part));
      try {
        const updated = await arrabApi.updateTeam(team.id, {
          name: name.trim() || team.name,
          purpose: [purpose.trim() || null, ...policy].filter(Boolean).join(" · ") || null,
        });
        setTeams((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        return updated;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail],
  );

  /** Ensures the All-Hands room exists and seats every live companion. Returns its id. */
  const ensureAllHands = useCallback(async (): Promise<string | null> => {
    try {
      let team = allHands;
      if (!team) {
        team = await arrabApi.createTeam({
          name: ALL_HANDS_TEAM,
          purpose: "Studio-wide room with every active agent",
          projectId: null,
        });
      }
      const seated = new Set(
        memberships.filter((item) => item.teamId === team!.id).map((item) => item.agentId as string),
      );
      for (const agent of agents) {
        if ((agent.status === "active" || agent.status === "paused") && !seated.has(agent.id)) {
          await arrabApi.addTeamMember(team.id, { agentId: agent.id });
        }
      }
      void load({ fresh: true });
      return team.id;
    } catch (error) {
      fail(error);
      return null;
    }
  }, [agents, allHands, fail, load, memberships]);

  // ── Knowledge ────────────────────────────────────────────────────────────
  const createKnowledge = useCallback(
    async (title: string, content: string, projectId: string | null) => {
      try {
        const created = await arrabApi.createKnowledge({ title, content, projectId });
        setKnowledge((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        return created;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [fail],
  );

  const deleteKnowledge = useCallback(
    async (id: string) => {
      const previous = knowledge;
      setKnowledge((prev) => prev.filter((item) => item.id !== id));
      try {
        await arrabApi.deleteKnowledge(id);
        pushToast({ title: t("hqKnowDeleted"), tone: "success" });
      } catch (error) {
        setKnowledge(previous);
        fail(error);
      }
    },
    [fail, knowledge, t],
  );

  return {
    loading,
    agents,
    teams,
    projects,
    memberships,
    tasks,
    knowledge,
    taskRuns,
    approvals,
    activity,
    usage,
    departments,
    membersByTeam,
    departmentOf,
    unassigned,
    drafts,
    draftsAwaitingRequest,
    openTasks,
    allHands,
    agentById,
    agentName,
    reload: () => load({ fresh: true }),
    refreshLive,
    loadUsage,
    createTask,
    setTaskStatus,
    updateTask,
    deleteTask,
    runTask,
    resolveApproval,
    activateAgent,
    hire,
    setAgentStatus,
    updateAgent,
    moveAgent,
    removeAgent,
    briefAgent,
    createDepartment,
    updateDepartment,
    ensureAllHands,
    createKnowledge,
    deleteKnowledge,
  };
}

export type WorkforceData = ReturnType<typeof useWorkforceData>;
