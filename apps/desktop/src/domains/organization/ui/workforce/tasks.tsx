import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ClipboardList,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Task, TaskPriority, TaskStatus } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { OrgSeatCapabilities } from "@/domains/organization/org-seat";
import { cn } from "@/shared/lib/utils";
import type { WorkforceActions } from "./companion-row";
import { Avatar, Empty, Menu, PriorityChip, type MenuEntry } from "./primitives";
import {
  PRIORITIES,
  TASK_COLUMNS,
  openAgentChat,
  priorityLabel,
  priorityRank,
  relativeAge,
  statusLabel,
  type WorkforceData,
} from "./use-workforce-data";

export function WorkforceTasks({
  data,
  caps,
  actions,
}: {
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  actions: WorkforceActions;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ title: string; text: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.tasks.filter((task) => {
      if (owner && task.assigneeAgentId !== owner) return false;
      if (priority && task.priority !== priority) return false;
      if (!q) return true;
      return `${task.title} ${task.brief ?? ""}`.toLowerCase().includes(q);
    });
  }, [data.tasks, owner, priority, query]);

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(TASK_COLUMNS.map((status) => [status, []]));
    for (const task of filtered) map.get(task.status)?.push(task);
    for (const list of map.values()) {
      list.sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt),
      );
    }
    return map;
  }, [filtered]);

  async function run(task: Task) {
    setRunningId(task.id);
    const text = await data.runTask(task, task.priority === "urgent" || task.priority === "high");
    setRunningId(null);
    if (text) setRunResult({ title: task.title, text });
  }

  function drop(status: TaskStatus) {
    const task = data.tasks.find((item) => item.id === dragId);
    setDragId(null);
    setDropStatus(null);
    if (task && caps.canAssignWork) void data.setTaskStatus(task, status);
  }

  const done = data.tasks.filter((task) => task.status === "done").length;
  const rate = data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0;

  return (
    <div className="cc-wrap !max-w-none">
      <div className="cc-rise flex flex-wrap items-center gap-2">
        <div className="cc-search w-full sm:w-[260px]">
          <Search />
          <input className="cc-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wxSearchTasks")} />
        </div>
        <select className="cc-select !w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t("wxFieldOwner")}>
          <option value="">{t("wxAllOwners")}</option>
          {data.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          className="cc-select !w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
          aria-label={t("wxFieldPriority")}
        >
          <option value="">{t("wxAllPriorities")}</option>
          {PRIORITIES.map((id) => (
            <option key={id} value={id}>
              {priorityLabel(id, t)}
            </option>
          ))}
        </select>
        <span className="ms-auto hidden text-[12px] text-[var(--color-muted)] md:inline">
          {t("wxTasksSummary")
            .replace("{open}", String(data.openTasks.length))
            .replace("{rate}", String(rate))}
        </span>
        {caps.canAssignWork ? (
          <button type="button" className="cc-btn is-primary" onClick={() => actions.openTask()}>
            <Plus className="size-3.5" strokeWidth={2} />
            {t("wxNewTask")}
          </button>
        ) : null}
      </div>

      {runResult ? (
        <div className="cc-banner cc-rise !items-start">
          <div className="min-w-0 flex-1">
            <p className="cc-kicker">{t("wxLatestRun")}</p>
            <p className="mt-1 text-[13px] font-semibold">{runResult.title}</p>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              {runResult.text}
            </p>
          </div>
          <button type="button" className="cc-icon-btn" onClick={() => setRunResult(null)} aria-label={t("close")}>
            <X className="size-4" strokeWidth={1.7} />
          </button>
        </div>
      ) : null}

      {data.tasks.length === 0 ? (
        <div className="cc-card cc-rise">
          <Empty
            icon={ClipboardList}
            title={t("wxNoTasks")}
            body={t("wxNoTasksBody")}
            action={
              caps.canAssignWork ? (
                <button type="button" className="cc-btn is-primary" onClick={() => actions.openTask()}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  {t("wxNewTask")}
                </button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="cc-board cc-rise">
          {TASK_COLUMNS.map((status) => {
            const list = columns.get(status) ?? [];
            return (
              <section
                key={status}
                className={cn("cc-col", dropStatus === status && "is-drop")}
                onDragOver={(event) => {
                  if (!dragId || !caps.canAssignWork) return;
                  event.preventDefault();
                  setDropStatus(status);
                }}
                onDragLeave={() => setDropStatus((current) => (current === status ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(status);
                }}
              >
                <header className="cc-col-head">
                  <span className="text-[12px] font-semibold">{statusLabel(status, t)}</span>
                  <span className="cc-tab-count">{list.length}</span>
                </header>
                {list.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    data={data}
                    caps={caps}
                    actions={actions}
                    running={runningId === task.id}
                    dragging={dragId === task.id}
                    onRun={() => void run(task)}
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropStatus(null);
                    }}
                  />
                ))}
                {list.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11.5px] text-[var(--color-muted)]">{t("wxColumnEmpty")}</p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  data,
  caps,
  actions,
  running,
  dragging,
  onRun,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  actions: WorkforceActions;
  running: boolean;
  dragging: boolean;
  onRun: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useLanguage();
  const owner = task.assigneeAgentId ? data.agentById.get(task.assigneeAgentId) ?? null : null;
  const entries: MenuEntry[] = [];
  if (caps.canAssignWork) {
    entries.push({ kind: "label", label: t("wxMoveTo") });
    for (const status of TASK_COLUMNS) {
      entries.push({
        kind: "item",
        label: statusLabel(status, t),
        icon: ArrowRightLeft,
        disabled: status === task.status,
        onSelect: () => void data.setTaskStatus(task, status),
      });
    }
    entries.push({ kind: "label", label: t("wxReassign") });
    for (const agent of data.agents.filter((item) => item.status !== "archived").slice(0, 12)) {
      entries.push({
        kind: "item",
        label: agent.name,
        disabled: agent.id === task.assigneeAgentId,
        onSelect: () => void data.updateTask(task, { assigneeAgentId: agent.id }),
      });
    }
    entries.push(
      { kind: "sep" },
      {
        kind: "item",
        label: t("wxDelete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (window.confirm(t("wxDeleteTaskConfirm"))) void data.deleteTask(task);
        },
      },
    );
  }

  return (
    <article
      className={cn("cc-task", dragging && "is-dragging")}
      draggable={caps.canAssignWork}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center justify-between gap-2">
        <PriorityChip priority={task.priority} />
        <span className="text-[10.5px] text-[var(--color-muted)]">{relativeAge(task.updatedAt, t)}</span>
      </div>
      <p className="cc-task-title">{task.title}</p>
      {task.brief && task.brief !== task.title ? <p className="cc-task-brief">{task.brief}</p> : null}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {owner ? <Avatar name={owner.name} size="sm" /> : null}
          <span className="truncate text-[11.5px] text-[var(--color-muted)]">{owner?.name ?? t("unassigned")}</span>
        </div>
        <div className="flex items-center">
          {owner && caps.canAssignWork && task.status !== "done" ? (
            <button
              type="button"
              className="cc-icon-btn !size-7"
              disabled={running}
              onClick={onRun}
              aria-label={t("wxRun")}
              title={t("wxRun")}
            >
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" strokeWidth={1.8} />}
            </button>
          ) : null}
          {owner ? (
            <button
              type="button"
              className="cc-icon-btn !size-7"
              onClick={() => {
                openAgentChat(owner.id, task);
                actions.chat(owner.id);
              }}
              aria-label={t("deskSoloChat")}
              title={t("deskSoloChat")}
            >
              <MessageSquare className="size-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
          {entries.length > 0 ? (
            <Menu label={t("wxMore")} trigger={<MoreHorizontal className="size-3.5" strokeWidth={1.8} />} entries={entries} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
