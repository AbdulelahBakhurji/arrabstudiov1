import {
  NotFoundError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  brandId,
  type CancelTeamRunResponse,
  type StartTeamRunResponse,
  type TaskRun,
  type TaskRunId,
  type TeamId,
  type TeamRun,
  type TeamRunStatus,
  type WorkspaceId,
} from "@arrab/shared";
import type { TaskExecutionService } from "./task-execution-service.js";
import type { WorkspaceCommandService } from "./workspace-commands.js";

/**
 * Orchestrates one brief across every agent on a team. Child work is normal TaskRun
 * rows (with teamRunId); the TeamRun view is kept in-process for cancel + status.
 */
export class TeamRunService {
  private readonly runs = new Map<string, TeamRun>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly persistence: Persistence,
    private readonly commands: WorkspaceCommandService,
    private readonly taskExecution: TaskExecutionService,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  list(): TeamRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): TeamRun | null {
    return this.runs.get(id) ?? null;
  }

  async start(teamId: string, brief: string): Promise<StartTeamRunResponse> {
    const trimmed = brief?.trim();
    if (!trimmed) throw new ValidationError("Team run brief is required");
    if (trimmed.length > 4000) throw new ValidationError("Team run brief is too long");

    const team = await this.persistence.teams.getById(teamId);
    if (!team) throw new NotFoundError("Team", teamId);

    const memberships = await this.persistence.memberships.listByTeam(teamId);
    if (memberships.length === 0) {
      throw new ValidationError("Add employees to the team before running it");
    }

    const teamRunId = this.ids.next("trun_team");
    const controller = new AbortController();
    this.controllers.set(teamRunId, controller);

    const teamRun: TeamRun = {
      id: teamRunId,
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      teamId: brandId<TeamId>(team.id),
      status: "running",
      brief: trimmed,
      taskRunIds: [],
      createdAt: this.clock.isoNow(),
      finishedAt: null,
    };
    this.runs.set(teamRunId, teamRun);

    const childRuns: TaskRun[] = [];
    try {
      for (const membership of memberships) {
        if (controller.signal.aborted) break;
        const agent = await this.persistence.agents.getById(membership.agentId);
        if (!agent || agent.status === "archived") continue;

        const task = await this.commands.createTask({
          title: `${team.name}: ${trimmed}`.slice(0, 120),
          brief: trimmed,
          assigneeAgentId: agent.id,
          teamId: team.id,
          projectId: agent.projectId ?? undefined,
          status: "assigned",
        });

        const result = await this.taskExecution.runTask(task.id, {
          teamRunId,
          signal: controller.signal,
        });
        childRuns.push(result.run);
        teamRun.taskRunIds = [...teamRun.taskRunIds, brandId<TaskRunId>(result.run.id)];
        this.runs.set(teamRunId, { ...teamRun });
      }

      teamRun.status = this.aggregateStatus(childRuns, controller.signal.aborted);
      teamRun.finishedAt = this.clock.isoNow();
      this.runs.set(teamRunId, { ...teamRun });
      return { teamRun: { ...teamRun }, runs: childRuns };
    } finally {
      this.controllers.delete(teamRunId);
    }
  }

  async cancel(teamRunId: string): Promise<CancelTeamRunResponse> {
    const teamRun = this.runs.get(teamRunId);
    if (!teamRun) throw new NotFoundError("TeamRun", teamRunId);

    this.controllers.get(teamRunId)?.abort();

    const runs: TaskRun[] = [];
    for (const runId of teamRun.taskRunIds) {
      const run = await this.taskExecution.getRun(runId);
      if (!run) continue;
      if (run.status === "running" || run.status === "awaiting_approval") {
        runs.push(await this.taskExecution.cancelRun(runId));
      } else {
        runs.push(run);
      }
    }

    // Also cancel any still-running children that joined after the snapshot.
    const all = await this.persistence.taskRuns.list();
    for (const run of all) {
      if (run.teamRunId !== teamRunId) continue;
      if (runs.some((item) => item.id === run.id)) continue;
      if (run.status === "running" || run.status === "awaiting_approval") {
        runs.push(await this.taskExecution.cancelRun(run.id));
      } else {
        runs.push(run);
      }
    }

    const updated: TeamRun = {
      ...teamRun,
      status: "cancelled",
      finishedAt: teamRun.finishedAt ?? this.clock.isoNow(),
      taskRunIds: runs.map((run) => brandId<TaskRunId>(run.id)),
    };
    this.runs.set(teamRunId, updated);
    return { teamRun: updated, runs };
  }

  private aggregateStatus(runs: TaskRun[], aborted: boolean): TeamRunStatus {
    if (aborted || runs.some((run) => run.status === "cancelled")) {
      if (runs.every((run) => run.status === "cancelled" || run.status === "failed")) {
        return "cancelled";
      }
      return "partial";
    }
    if (runs.length === 0) return "failed";
    if (runs.every((run) => run.status === "completed" || run.status === "needs_provider")) {
      return "completed";
    }
    if (runs.every((run) => run.status === "failed")) return "failed";
    return "partial";
  }
}
