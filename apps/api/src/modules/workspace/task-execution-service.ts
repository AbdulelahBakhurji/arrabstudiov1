import type { AiGateway } from "@arrab/ai";
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
  type Activity,
  type ActivityId,
  type AgentId,
  type ApprovalId,
  type ConversationId,
  type MemoryId,
  type RunTaskResponse,
  type TaskId,
  type TaskRun,
  type TaskRunId,
  type WorkspaceId,
} from "@arrab/shared";
import { encryptField } from "../../platform/crypto/field-crypto.js";
import type { AccountService } from "../accounts/account-service.js";
import type { ConversationService } from "../conversations/conversation-service.js";

export class TaskExecutionService {
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly persistence: Persistence,
    private readonly conversations: ConversationService,
    private readonly gateway: AiGateway,
    private readonly accounts: AccountService,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  private async record(
    verb: Activity["verb"],
    objectType: string,
    objectId: string,
    summary: string,
    actorType: Activity["actorType"] = "system",
    actorId: string | null = null,
  ): Promise<void> {
    await this.persistence.activity.append({
      id: brandId<ActivityId>(this.ids.next("act")),
      workspaceId: this.persistence.workspaceId,
      actorType,
      actorId,
      verb,
      objectType,
      objectId,
      summary,
      createdAt: this.clock.isoNow(),
    });
  }

  async getRun(runId: string): Promise<TaskRun | null> {
    return this.persistence.taskRuns.getById(runId);
  }

  async cancelRun(runId: string): Promise<TaskRun> {
    const run = await this.persistence.taskRuns.getById(runId);
    if (!run) throw new NotFoundError("TaskRun", runId);
    if (run.status !== "running" && run.status !== "awaiting_approval") {
      throw new ValidationError(`Task run is already ${run.status}`);
    }
    const controller = this.inflight.get(run.id);
    controller?.abort();
    this.inflight.delete(run.id);
    const cancelled: TaskRun = {
      ...run,
      status: "cancelled",
      summary: run.summary ?? "Cancelled by operator",
    };
    await this.persistence.taskRuns.update(cancelled);
    await this.record("failed", "task", run.taskId, `Task run cancelled`);
    return cancelled;
  }

  async runTask(
    taskId: string,
    options: { requireApproval?: boolean; teamRunId?: string | null; signal?: AbortSignal } = {},
  ): Promise<RunTaskResponse> {
    await this.accounts.assertWithinQuota();

    const task = await this.persistence.tasks.getById(taskId);
    if (!task) {
      throw new NotFoundError("Task", taskId);
    }
    if (!task.assigneeAgentId) {
      throw new ValidationError("Assign an employee before running this task");
    }
    const agent = await this.persistence.agents.getById(task.assigneeAgentId);
    if (!agent) {
      throw new ValidationError("Assigned employee no longer exists");
    }

    if (options.requireApproval) {
      const approval = await this.persistence.approvals.create({
        id: brandId<ApprovalId>(this.ids.next("apr")),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        kind: "run_task",
        status: "pending",
        title: `Run task: ${task.title}`,
        detail: task.brief,
        agentId: brandId<AgentId>(agent.id),
        taskId: brandId<TaskId>(task.id),
        createdAt: this.clock.isoNow(),
        resolvedAt: null,
      });
      const run: TaskRun = {
        id: brandId<TaskRunId>(this.ids.next("trun")),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        taskId: brandId<TaskId>(task.id),
        agentId: brandId<AgentId>(agent.id),
        conversationId: null,
        status: "awaiting_approval",
        summary: "Waiting for operator approval before running.",
        createdAt: this.clock.isoNow(),
        teamRunId: options.teamRunId ?? null,
      };
      await this.persistence.taskRuns.create(run);
      await this.record("created", "approval", approval.id, `Approval requested to run "${task.title}"`);
      return {
        task,
        run,
        conversationId: null,
        assistantMessage: null,
        providerConfigured: this.gateway.listProviders().length > 0,
        approval,
      };
    }

    const providerConfigured = this.gateway.listProviders().length > 0;
    const prompt = [
      `CEO task assignment: ${task.title}`,
      task.brief ? `Brief: ${task.brief}` : null,
      "Produce a concrete first deliverable or plan. Be specific.",
    ]
      .filter(Boolean)
      .join("\n");

    await this.persistence.tasks.update({
      ...task,
      status: task.status === "backlog" || task.status === "assigned" ? "in_progress" : task.status,
      updatedAt: this.clock.isoNow(),
    });

    const runId = brandId<TaskRunId>(this.ids.next("trun"));
    let run: TaskRun = {
      id: runId,
      workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
      taskId: brandId<TaskId>(task.id),
      agentId: brandId<AgentId>(agent.id),
      conversationId: null,
      status: "running",
      summary: null,
      createdAt: this.clock.isoNow(),
      teamRunId: options.teamRunId ?? null,
    };
    await this.persistence.taskRuns.create(run);

    if (!providerConfigured) {
      run = {
        ...run,
        status: "needs_provider",
        summary: "No model provider configured — task marked in progress only.",
      };
      await this.persistence.taskRuns.update(run);
      await this.record(
        "ran",
        "task",
        task.id,
        `Task "${task.title}" waiting for AI provider`,
        "system",
      );
      const updated = await this.persistence.tasks.getById(task.id);
      return {
        task: updated ?? task,
        run,
        conversationId: null,
        assistantMessage: null,
        providerConfigured: false,
      };
    }

    const controller = new AbortController();
    this.inflight.set(run.id, controller);
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });
    if (options.signal?.aborted) controller.abort();

    const conversation = await this.conversations.createConversation({
      agentId: agent.id,
      title: `Task: ${task.title}`.slice(0, 120),
      projectId: task.projectId ?? agent.projectId ?? undefined,
    });
    run = { ...run, conversationId: brandId<ConversationId>(conversation.id) };
    await this.persistence.taskRuns.update(run);

    try {
      const reply = await this.conversations.sendMessage(
        conversation.id,
        { content: prompt },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        run = {
          ...run,
          status: "cancelled",
          summary: "Cancelled by operator",
        };
        await this.persistence.taskRuns.update(run);
        await this.record("failed", "task", task.id, `Task run cancelled`);
        return {
          task: (await this.persistence.tasks.getById(task.id)) ?? task,
          run,
          conversationId: conversation.id,
          assistantMessage: null,
          providerConfigured: true,
        };
      }
      const summary = reply.assistantMessage?.content?.slice(0, 280) ?? null;
      run = { ...run, status: "completed", summary };
      await this.persistence.taskRuns.update(run);
      await this.record(
        "ran",
        "task",
        task.id,
        `${agent.name} ran task "${task.title}"`,
        "agent",
        agent.id,
      );

      if (summary) {
        await this.persistence.memories.create({
          id: brandId<MemoryId>(this.ids.next("mem")),
          workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
          agentId: brandId<AgentId>(agent.id),
          projectId: task.projectId,
          content: encryptField(`Task "${task.title}": ${summary}`),
          createdAt: this.clock.isoNow(),
          updatedAt: this.clock.isoNow(),
        });
      }

      const updated = await this.persistence.tasks.getById(task.id);
      return {
        task: updated ?? task,
        run,
        conversationId: conversation.id,
        assistantMessage: reply.assistantMessage?.content ?? null,
        providerConfigured: true,
      };
    } catch (error: unknown) {
      const cancelled =
        controller.signal.aborted ||
        (error instanceof Error &&
          ((error as { code?: string }).code === "CANCELLED" || /cancel/i.test(error.message)));
      const message = error instanceof Error ? error.message : "Task run failed";
      run = {
        ...run,
        status: cancelled ? "cancelled" : "failed",
        summary: cancelled ? "Cancelled by operator" : message,
      };
      await this.persistence.taskRuns.update(run);
      await this.record(
        "failed",
        "task",
        task.id,
        cancelled ? `Task run cancelled` : `Task run failed: ${message}`,
      );
      if (cancelled) {
        return {
          task: (await this.persistence.tasks.getById(task.id)) ?? task,
          run,
          conversationId: conversation.id,
          assistantMessage: null,
          providerConfigured: true,
        };
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onOuterAbort);
      this.inflight.delete(run.id);
    }
  }
}
