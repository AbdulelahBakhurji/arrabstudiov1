import type { Persistence } from "@arrab/database";
import type {
  Activity,
  Agent,
  Conversation,
  DashboardResponse,
  Knowledge,
  Memory,
  OperatorProfile,
  Project,
  ProjectRepoBinding,
  ReportSummaryResponse,
  Task,
  TaskRun,
  Team,
  TeamMembership,
  UsageSummaryResponse,
  Workspace,
} from "@arrab/shared";
import type { WorkspaceCommandService } from "./workspace-commands.js";

export class WorkspaceQueryService {
  constructor(
    private readonly persistence: Persistence,
    private readonly commands?: WorkspaceCommandService,
  ) {}

  async dashboard(): Promise<DashboardResponse> {
    const [{ workspace }, projects, agents, teams, activity, conversations] = await Promise.all([
      this.persistence.getWorkspace(),
      this.listProjects(),
      this.listAgents(),
      this.listTeams(),
      this.listActivity(),
      this.listConversations(),
    ]);
    return { workspace, projects, agents, teams, activity, conversations };
  }

  async getWorkspace(): Promise<Workspace> {
    const context = await this.persistence.getWorkspace();
    return context.workspace;
  }

  listProjects(): Promise<Project[]> {
    return this.persistence.projects.list();
  }

  listAgents(): Promise<Agent[]> {
    return this.persistence.agents.list();
  }

  listTeams(): Promise<Team[]> {
    return this.persistence.teams.list();
  }

  listActivity(): Promise<Activity[]> {
    return this.persistence.activity.list();
  }

  listConversations(): Promise<Conversation[]> {
    return this.persistence.conversations.list();
  }

  listMemberships(): Promise<TeamMembership[]> {
    return this.persistence.memberships.list();
  }

  listMembershipsByTeam(teamId: string): Promise<TeamMembership[]> {
    return this.persistence.memberships.listByTeam(teamId);
  }

  listBindings(): Promise<ProjectRepoBinding[]> {
    return this.persistence.bindings.list();
  }

  getBinding(projectId: string): Promise<ProjectRepoBinding | null> {
    return this.persistence.bindings.getByProject(projectId);
  }

  listTasks(): Promise<Task[]> {
    return this.persistence.tasks.list();
  }

  getTask(id: string): Promise<Task | null> {
    return this.persistence.tasks.getById(id);
  }

  async getOperator(): Promise<OperatorProfile> {
    if (this.commands) {
      return this.commands.getOrCreateOperator();
    }
    const existing = await this.persistence.operator.get();
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    return this.persistence.operator.upsert({
      workspaceId: this.persistence.workspaceId,
      displayName: "Studio operator",
      title: null,
      seats: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  async usageSummary(accounts?: import("./account-service.js").AccountService): Promise<UsageSummaryResponse> {
    const events = await this.persistence.usage.listAll();
    const byProviderMap = new Map<
      string,
      { providerId: string; inputTokens: number; outputTokens: number; events: number }
    >();
    let inputTokens = 0;
    let outputTokens = 0;
    for (const event of events) {
      inputTokens += event.inputTokens;
      outputTokens += event.outputTokens;
      const current = byProviderMap.get(event.providerId) ?? {
        providerId: event.providerId,
        inputTokens: 0,
        outputTokens: 0,
        events: 0,
      };
      current.inputTokens += event.inputTokens;
      current.outputTokens += event.outputTokens;
      current.events += 1;
      byProviderMap.set(event.providerId, current);
    }
    const recent = await this.persistence.usage.listRecent(20);
    const entitlements = accounts ? await accounts.buildEntitlements(await this.persistence.accounts.get()) : undefined;
    return {
      totals: {
        inputTokens,
        outputTokens,
        events: events.length,
      },
      byProvider: [...byProviderMap.values()].sort((a, b) => b.events - a.events),
      recent: recent.map((event) => ({
        id: event.id,
        providerId: event.providerId,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        createdAt: event.createdAt,
        agentId: event.agentId,
      })),
      entitlements,
    };
  }

  listKnowledge(): Promise<Knowledge[]> {
    return this.persistence.knowledge.list();
  }

  listMemories(): Promise<Memory[]> {
    return this.persistence.memories.list();
  }

  listSkills(agentId?: string): Promise<import("@arrab/shared").Skill[]> {
    return agentId
      ? this.persistence.skills.listByAgent(agentId)
      : this.persistence.skills.list();
  }

  listApprovals(): Promise<import("@arrab/shared").Approval[]> {
    return this.persistence.approvals.list();
  }

  listPendingApprovals(): Promise<import("@arrab/shared").Approval[]> {
    return this.persistence.approvals.listPending();
  }

  listTaskRuns(taskId?: string): Promise<TaskRun[]> {
    return taskId
      ? this.persistence.taskRuns.listByTask(taskId)
      : this.persistence.taskRuns.list();
  }

  async reportSummary(): Promise<ReportSummaryResponse> {
    const [
      operator,
      agents,
      teams,
      tasks,
      activity,
      usage,
      knowledge,
      memories,
      taskRuns,
      skills,
      pendingApprovals,
    ] = await Promise.all([
      this.getOperator(),
      this.listAgents(),
      this.listTeams(),
      this.listTasks(),
      this.listActivity(),
      this.usageSummary(),
      this.listKnowledge(),
      this.listMemories(),
      this.listTaskRuns(),
      this.listSkills(),
      this.listPendingApprovals(),
    ]);

    const agentsByStatus: Record<string, number> = {};
    for (const agent of agents) {
      agentsByStatus[agent.status] = (agentsByStatus[agent.status] ?? 0) + 1;
    }

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let open = 0;
    let done = 0;
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
      if (task.status === "done") {
        done += 1;
      } else {
        open += 1;
      }
    }

    return {
      operator,
      agentsByStatus,
      teams: teams.length,
      tasks: {
        total: tasks.length,
        open,
        done,
        byStatus,
        byPriority,
      },
      usage: {
        inputTokens: usage.totals.inputTokens,
        outputTokens: usage.totals.outputTokens,
        events: usage.totals.events,
      },
      recentActivity: activity.slice(0, 12),
      knowledgeCount: knowledge.length,
      memoryCount: memories.length,
      skillCount: skills.length,
      pendingApprovals: pendingApprovals.length,
      recentTaskRuns: taskRuns.slice(0, 8),
    };
  }
}
