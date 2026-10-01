import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Command,
  Inbox,
  Loader2,
  MessageSquare,
  Play,
  Search,
  Send,
  Sparkles,
  Target,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import type { Agent, Task, TaskPriority, TaskStatus } from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import {
  Avatar,
  Card,
  Empty,
  PriorityChip,
  Segmented,
  Stat,
  StatusDot,
} from "@/components/organization/workforce/primitives";
import {
  OPEN_HIRE_FLAG,
  OPEN_SETUP_FLAG,
  PRIORITIES,
  openAgentChat,
  priorityLabel,
  relativeAge,
  statusLabel,
  useWorkforceData,
} from "@/components/organization/workforce/use-workforce-data";
import { useLanguage } from "@/i18n/LanguageProvider";
import { notifyStudio, pushToast } from "@/lib/notify";
import { useOrgSeatCapabilities } from "@/lib/org-seat";
import { parseStudioAssign } from "@/lib/studio-assign";
import { cn } from "@/lib/utils";
import { useRole } from "@/roles/RoleProvider";

export { parseStudioAssign } from "@/lib/studio-assign";

const STUDIO_GOAL_KEY = "arrab.studioGoal";
const RUN_NOW_KEY = "arrab.ops.runNow";
const TEMPLATES = ["opsTplReview", "opsTplResearch", "opsTplDraft", "opsTplFollowUp", "opsTplStatus"] as const;
type QueueFilter = "open" | "in_progress" | "blocked" | "done";

function readGoal(): string {
  try {
    return localStorage.getItem(STUDIO_GOAL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function HomePage() {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const caps = useOrgSeatCapabilities();
  const data = useWorkforceData();
  const commandRef = useRef<HTMLTextAreaElement | null>(null);

  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("high");
  const [runNow, setRunNow] = useState(() => localStorage.getItem(RUN_NOW_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("open");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [goal, setGoal] = useState(readGoal);
  const [goalDraft, setGoalDraft] = useState(readGoal);
  const [goalEditing, setGoalEditing] = useState(false);

  const isAr = locale === "ar";
  const people = useMemo(() => data.agents.filter((agent) => agent.status !== "archived"), [data.agents]);
  const parsed = useMemo(() => parseStudioAssign(text, people), [people, text]);
  const owner: Agent | null = parsed.agent ?? people.find((agent) => agent.id === ownerId) ?? null;

  useEffect(() => {
    commandRef.current?.focus();
  }, []);

  useEffect(() => {
    localStorage.setItem(RUN_NOW_KEY, runNow ? "1" : "0");
  }, [runNow]);

  useEffect(() => {
    if (goal.trim()) localStorage.setItem(STUDIO_GOAL_KEY, goal.trim());
    else localStorage.removeItem(STUDIO_GOAL_KEY);
  }, [goal]);

  // Owner follows department routing when the picked owner is outside it.
  useEffect(() => {
    if (!teamId || !ownerId) return;
    const members = data.membersByTeam.get(teamId) ?? [];
    if (!members.some((agent) => agent.id === ownerId)) setOwnerId(null);
  }, [data.membersByTeam, ownerId, teamId]);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return people
      .filter((agent) => `${agent.name} ${agent.role} ${agent.specialty ?? ""}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, people]);

  const ownerPool = useMemo(() => {
    const pool = teamId ? data.membersByTeam.get(teamId) ?? [] : people;
    const q = peopleQuery.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((agent) =>
      `${agent.name} ${agent.role} ${agent.specialty ?? ""} ${data.departmentOf.get(agent.id)?.name ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [data.departmentOf, data.membersByTeam, people, peopleQuery, teamId]);

  const queue = useMemo(() => {
    const list =
      queueFilter === "open"
        ? data.openTasks.filter((task) => task.status !== "blocked" && task.status !== "in_progress")
        : data.tasks.filter((task) => task.status === queueFilter);
    return [...list]
      .sort((a, b) => (queueFilter === "open" ? 0 : b.updatedAt.localeCompare(a.updatedAt)))
      .slice(0, 14);
  }, [data.openTasks, data.tasks, queueFilter]);

  const count = (status: TaskStatus) => data.tasks.filter((task) => task.status === status).length;
  const urgent = data.openTasks.filter((task) => task.priority === "urgent" || task.priority === "high").length;
  const needsYou = data.approvals.length + data.draftsAwaitingRequest.length;
  const arrow = cn("size-3.5", isAr && "rotate-180");

  function updateText(value: string, caret: number) {
    setText(value);
    setFormError(null);
    const before = value.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    setMention(match ? { query: match[2] ?? "", index: 0 } : null);
  }

  function pickMention(agent: Agent) {
    const el = commandRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(^|\s)@[^\s@]*$/, "$1");
    const after = text.slice(caret);
    setText(`${before}${after}`.replace(/\s{2,}/g, " ").trimStart());
    setOwnerId(agent.id);
    setMention(null);
    requestAnimationFrame(() => el?.focus());
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionMatches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMention({ ...mention, index: (mention.index + step + mentionMatches.length) % mentionMatches.length });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const pick = mentionMatches[mention.index];
        if (pick) pickMention(pick);
        return;
      }
      if (event.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void dispatch();
    }
  }

  async function dispatch(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (!caps.canAssignWork) {
      setFormError(t("studioAssignManagersOnly"));
      return;
    }
    const title = (parsed.title || text).trim();
    if (!title) {
      setFormError(t("studioAssignEmpty"));
      return;
    }
    if (!owner) {
      setFormError(
        parsed.nameHint ? t("studioAssignUnknown").replace("{name}", parsed.nameHint) : t("studioAssignPick"),
      );
      return;
    }
    setBusy(true);
    const task = await data.createTask({
      title: title.split("\n")[0]!.slice(0, 120),
      brief: text.trim() || null,
      assigneeAgentId: owner.id,
      teamId: teamId || data.departmentOf.get(owner.id)?.id || null,
      status: "assigned",
      priority,
    });
    if (!task) {
      setBusy(false);
      return;
    }
    const body = t("studioAssignDoneBody").replace("{task}", task.title).replace("{name}", owner.name);
    setText("");
    setOwnerId(null);
    setLastId(task.id);
    setQueueFilter("open");
    pushToast({ title: t("studioAssignDone"), body, tone: "success", href: href("/workforce") });
    void notifyStudio({ kind: "cowork", title: t("studioAssignDone"), body, href: href("/workforce") });
    if (runNow) {
      setRunningId(task.id);
      const result = await data.runTask(task, priority === "urgent" || priority === "high");
      setRunningId(null);
      if (result) pushToast({ title: t("oxRunReport").replace("{name}", owner.name), body: result.slice(0, 220), tone: "info" });
    }
    setBusy(false);
    commandRef.current?.focus();
  }

  async function runTask(task: Task) {
    setRunningId(task.id);
    const result = await data.runTask(task, task.priority === "urgent" || task.priority === "high");
    setRunningId(null);
    if (result) pushToast({ title: t("oxRunReport").replace("{name}", data.agentName(task.assigneeAgentId)), body: result.slice(0, 220), tone: "info" });
  }

  function chatWith(agentId: string, task?: Task) {
    openAgentChat(agentId, task);
    navigate(href("/chat"));
  }

  function openHire() {
    sessionStorage.setItem(OPEN_HIRE_FLAG, "1");
    navigate(href("/workforce"));
  }

  function openSetup() {
    sessionStorage.setItem(OPEN_SETUP_FLAG, "1");
    navigate(href("/workforce"));
  }

  function applyTemplate(key: (typeof TEMPLATES)[number]) {
    const line = t(key);
    setText((current) => (current.trim() ? `${current.trim()}\n${line}` : line));
    commandRef.current?.focus();
  }

  return (
    <Surface className="cc-page !overflow-hidden">
      <header className="cc-head">
        <div className="cc-head-title">
          <span className="cc-mark">
            <Command className="size-[18px]" strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1>{t("opsCommandTitle")}</h1>
              <span className="cc-live">
                <i aria-hidden />
                {t("commandStatusOnline")}
              </span>
            </div>
            <p>{t("opsCommandLead")}</p>
          </div>
        </div>
        <div className="cc-head-actions">
          <Link to={href("/workforce")} className="cc-btn is-ghost">
            {t("workforceTitle")}
            <ArrowRight className={arrow} strokeWidth={1.8} />
          </Link>
          {caps.canAdminister && data.departments.length === 0 ? (
            <button type="button" className="cc-btn is-primary" onClick={openSetup}>
              <Sparkles className="size-3.5" strokeWidth={1.8} />
              {t("wfSetupReopen")}
            </button>
          ) : caps.canHireAgents ? (
            <button type="button" className="cc-btn is-primary" onClick={openHire}>
              <UserPlus className="size-3.5" strokeWidth={1.8} />
              {t("wxHireCompanion")}
            </button>
          ) : null}
        </div>
      </header>

      <div className="cc-body">
        <div className="cc-wrap">
          <div className="cc-stats cc-rise">
            <Stat label={t("oxStatOpen")} value={data.openTasks.length} foot={t("wxStatUrgent").replace("{n}", String(urgent))} onClick={() => setQueueFilter("open")} />
            <Stat label={t("taskColInProgress")} value={count("in_progress")} foot={t("oxStatRunningFoot")} onClick={() => setQueueFilter("in_progress")} />
            <Stat label={t("taskColBlocked")} value={count("blocked")} foot={t("oxStatBlockedFoot")} alert={count("blocked") > 0} onClick={() => setQueueFilter("blocked")} />
            <Stat label={t("wxStatNeedsYou")} value={needsYou} foot={t("wxStatNeedsYouFoot")} alert={needsYou > 0} />
            <Stat
              label={t("wxStatCompanions")}
              value={people.length}
              foot={t("wxStatLive").replace("{n}", String(people.filter((agent) => agent.status === "active").length))}
            />
          </div>

          <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid min-w-0 content-start gap-[18px]">
              {caps.canAdminister && data.departments.length === 0 && !data.loading ? (
                <div className="cc-banner cc-rise">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="cc-mark !size-9">
                      <Sparkles className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold">{t("opsSetupNeededTitle")}</p>
                      <p className="text-[12px] text-[var(--color-muted)]">{t("opsSetupNeededBody")}</p>
                    </div>
                  </div>
                  <button type="button" className="cc-btn is-primary" onClick={openSetup}>
                    {t("wfSetupReopen")}
                    <ArrowRight className={arrow} strokeWidth={1.8} />
                  </button>
                </div>
              ) : null}

              <form onSubmit={(e) => void dispatch(e)} className="cc-composer cc-rise relative">
                <div className="flex items-center justify-between gap-3 px-[18px] pt-4">
                  <p className="cc-kicker">{t("oxDispatchKicker")}</p>
                  {owner ? (
                    <span className="cc-chip is-accent !h-6 !ps-1">
                      <Avatar name={owner.name} size="sm" className="!size-[18px] !rounded-full !text-[8px]" />
                      {owner.name}
                      {!parsed.agent ? (
                        <button type="button" onClick={() => setOwnerId(null)} aria-label={t("close")} className="opacity-70 hover:opacity-100">
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-[var(--color-muted)]">{t("oxNoOwner")}</span>
                  )}
                </div>
                <textarea
                  ref={commandRef}
                  value={text}
                  onChange={(e) => updateText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onKeyDown={onKey}
                  onBlur={() => window.setTimeout(() => setMention(null), 120)}
                  placeholder={t("oxComposerPh")}
                  disabled={!caps.canAssignWork}
                  aria-label={t("oxDispatchKicker")}
                />
                {mention && mentionMatches.length > 0 ? (
                  <div className="cc-mention" role="listbox">
                    {mentionMatches.map((agent, index) => (
                      <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-selected={index === mention.index}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMention(agent);
                        }}
                        className={cn("cc-row w-full !py-2", index === mention.index && "is-active")}
                      >
                        <Avatar name={agent.name} size="sm" />
                        <div className="cc-row-main">
                          <p className="cc-row-title">{agent.name}</p>
                          <p className="cc-row-sub">
                            {agent.specialty || agent.role} · {data.departmentOf.get(agent.id)?.name ?? t("mapUnassigned")}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-1.5 px-[18px] pb-1">
                  {TEMPLATES.map((key) => (
                    <button key={key} type="button" className="cc-chip hover:text-[var(--color-foreground)]" onClick={() => applyTemplate(key)}>
                      <Zap className="size-3" strokeWidth={1.8} />
                      {t(key)}
                    </button>
                  ))}
                </div>

                <div className="cc-composer-bar border-t border-[color-mix(in_srgb,var(--color-border)_45%,transparent)]">
                  <select className="cc-select !h-8 !w-auto !text-[12px]" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t("wxFieldDepartment")}>
                    <option value="">{t("wxAnyDepartment")}</option>
                    {data.departments.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="cc-select !h-8 !w-auto !max-w-[180px] !text-[12px]"
                    value={owner?.id ?? ""}
                    onChange={(e) => setOwnerId(e.target.value || null)}
                    disabled={Boolean(parsed.agent)}
                    aria-label={t("wxFieldOwner")}
                  >
                    <option value="">{t("oxPickOwner")}</option>
                    {(teamId ? data.membersByTeam.get(teamId) ?? [] : people).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                  <Segmented
                    label={t("wxFieldPriority")}
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITIES.map((id) => ({ id, label: priorityLabel(id, t) }))}
                  />
                  <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[12px] text-[var(--color-muted)]">
                    <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} className="accent-[var(--color-accent)]" />
                    {t("oxRunNow")}
                  </label>
                  <span className="ms-auto hidden items-center gap-1 sm:inline-flex">
                    <span className="cc-kbd">⌘</span>
                    <span className="cc-kbd">↵</span>
                  </span>
                  <button type="submit" className="cc-btn is-primary" disabled={busy || !caps.canAssignWork || !text.trim()}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className={cn("size-3.5", isAr && "-scale-x-100")} strokeWidth={1.8} />}
                    {t("oxDispatch")}
                  </button>
                </div>
                {formError ? <p className="px-[18px] pb-3 text-[12px] text-[var(--color-danger)]">{formError}</p> : null}
                {!caps.canAssignWork ? (
                  <p className="px-[18px] pb-3 text-[12px] text-[var(--color-muted)]">{t("studioAssignManagersOnly")}</p>
                ) : null}
              </form>

              <Card
                title={t("oxQueueTitle")}
                sub={t("oxQueueSub")}
                action={
                  <Segmented
                    label={t("oxQueueTitle")}
                    value={queueFilter}
                    onChange={setQueueFilter}
                    options={[
                      { id: "open", label: t("oxQueueOpen") },
                      { id: "in_progress", label: t("taskColInProgress") },
                      { id: "blocked", label: t("taskColBlocked") },
                      { id: "done", label: t("taskColDone") },
                    ]}
                  />
                }
              >
                {data.loading ? (
                  <div className="flex h-24 items-center justify-center text-[var(--color-muted)]">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : queue.length === 0 ? (
                  <Empty icon={CheckCircle2} title={t("oxQueueEmpty")} body={t("oxQueueEmptyBody")} />
                ) : (
                  <div className="cc-list">
                    {queue.map((task) => {
                      const assignee = task.assigneeAgentId ? data.agentById.get(task.assigneeAgentId) ?? null : null;
                      const dept = assignee ? data.departmentOf.get(assignee.id)?.name : null;
                      return (
                        <div key={task.id} className={cn("cc-row", lastId === task.id && "is-active")}>
                          <PriorityChip priority={task.priority} />
                          <div className="cc-row-main">
                            <p className="cc-row-title">{task.title}</p>
                            <p className="cc-row-sub">
                              {[assignee?.name ?? t("unassigned"), dept, statusLabel(task.status, t), relativeAge(task.updatedAt, t)]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="cc-row-actions">
                            {assignee && caps.canAssignWork && task.status !== "done" ? (
                              <button
                                type="button"
                                className="cc-icon-btn"
                                disabled={runningId === task.id}
                                onClick={() => void runTask(task)}
                                aria-label={t("wxRun")}
                                title={t("wxRun")}
                              >
                                {runningId === task.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" strokeWidth={1.8} />}
                              </button>
                            ) : null}
                            {caps.canAssignWork && task.status !== "done" ? (
                              <button
                                type="button"
                                className="cc-icon-btn"
                                onClick={() => void data.setTaskStatus(task, "done")}
                                aria-label={t("oxMarkDone")}
                                title={t("oxMarkDone")}
                              >
                                <Check className="size-3.5" strokeWidth={2} />
                              </button>
                            ) : null}
                            {assignee ? (
                              <button
                                type="button"
                                className="cc-icon-btn"
                                onClick={() => chatWith(assignee.id, task)}
                                aria-label={t("deskSoloChat")}
                                title={t("deskSoloChat")}
                              >
                                <MessageSquare className="size-3.5" strokeWidth={1.8} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            <div className="grid min-w-0 content-start gap-[18px]">
              {needsYou > 0 ? (
                <Card title={t("wxNeedsYouTitle")} sub={t("wxNeedsYouSub")}>
                  <div className="cc-list">
                    {data.approvals.slice(0, 5).map((approval) => (
                      <div key={approval.id} className="cc-row !items-start">
                        <span className="cc-empty-icon !size-8 !rounded-[10px]">
                          <Inbox className="size-3.5" strokeWidth={1.7} />
                        </span>
                        <div className="cc-row-main">
                          <p className="cc-row-title !whitespace-normal">{approval.title}</p>
                          {caps.canAssignWork ? (
                            <div className="mt-2 flex gap-1.5">
                              <button type="button" className="cc-btn is-sm is-primary" onClick={() => void data.resolveApproval(approval.id, "approved")}>
                                {t("wxApprove")}
                              </button>
                              <button type="button" className="cc-btn is-sm" onClick={() => void data.resolveApproval(approval.id, "rejected")}>
                                {t("wxReject")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {data.draftsAwaitingRequest.slice(0, 4).map((agent) => (
                      <div key={agent.id} className="cc-row">
                        <Avatar name={agent.name} size="sm" />
                        <div className="cc-row-main">
                          <p className="cc-row-title">{agent.name}</p>
                          <p className="cc-row-sub">{t("wxDraftWaiting")}</p>
                        </div>
                        {caps.canHireAgents ? (
                          <button type="button" className="cc-btn is-sm is-primary" onClick={() => void data.activateAgent(agent, false)}>
                            {t("wxActivate")}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              <Card title={t("oxOwnersTitle")} sub={t("oxOwnersSub")}>
                <div className="cc-search mb-2">
                  <Search />
                  <input className="cc-input !h-8" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder={t("wxSearchCompanions")} />
                </div>
                {people.length === 0 ? (
                  <Empty
                    icon={UserPlus}
                    title={t("oxNoOwners")}
                    body={t("oxNoOwnersBody")}
                    action={
                      caps.canHireAgents ? (
                        <button type="button" className="cc-btn is-primary" onClick={openHire}>
                          {t("wxHireCompanion")}
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  <div className="cc-list max-h-[360px] overflow-y-auto">
                    {ownerPool.map((agent) => {
                      const open = data.openTasks.filter((task) => task.assigneeAgentId === agent.id).length;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          className={cn("cc-row w-full !py-2", owner?.id === agent.id && "is-active")}
                          onClick={() => {
                            setOwnerId(agent.id);
                            commandRef.current?.focus();
                          }}
                          onDoubleClick={() => chatWith(agent.id)}
                          title={t("oxOwnerHint")}
                        >
                          <Avatar name={agent.name} size="sm" />
                          <div className="cc-row-main">
                            <p className="cc-row-title flex items-center gap-2">
                              <span className="truncate">{agent.name}</span>
                              <StatusDot status={agent.status} />
                            </p>
                            <p className="cc-row-sub">
                              {agent.specialty || agent.role} · {data.departmentOf.get(agent.id)?.name ?? t("mapUnassigned")}
                            </p>
                          </div>
                          {open > 0 ? <span className="cc-chip">{open}</span> : null}
                        </button>
                      );
                    })}
                    {ownerPool.length === 0 ? (
                      <p className="px-2 py-3 text-[12px] text-[var(--color-muted)]">{t("wxNoMatches")}</p>
                    ) : null}
                  </div>
                )}
              </Card>

              <Card
                title={t("oxNorthStar")}
                sub={t("oxNorthStarSub")}
                action={
                  !goalEditing ? (
                    <button
                      type="button"
                      className="cc-btn is-sm is-ghost"
                      onClick={() => {
                        setGoalDraft(goal);
                        setGoalEditing(true);
                      }}
                    >
                      {goal ? t("oxEdit") : t("oxSetGoal")}
                    </button>
                  ) : null
                }
              >
                {goalEditing ? (
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setGoal(goalDraft.trim());
                      setGoalEditing(false);
                    }}
                  >
                    <textarea className="cc-textarea" rows={3} value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} placeholder={t("oxGoalPh")} autoFocus />
                    <div className="flex justify-end gap-2">
                      <button type="button" className="cc-btn is-sm is-ghost" onClick={() => setGoalEditing(false)}>
                        {t("cancel")}
                      </button>
                      <button type="submit" className="cc-btn is-sm is-primary">
                        {t("wxSave")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="cc-empty-icon !size-8 !rounded-[10px]">
                      <Target className="size-3.5" strokeWidth={1.7} />
                    </span>
                    <p className={cn("text-[13px] leading-relaxed", !goal && "text-[var(--color-muted)]")}>
                      {goal || t("oxGoalEmpty")}
                    </p>
                  </div>
                )}
              </Card>

              <Card
                title={t("wxActivityTitle")}
                action={
                  <Link to={href("/activity")} className="cc-btn is-sm is-ghost">
                    {t("homeViewAll")}
                  </Link>
                }
              >
                {data.activity.length === 0 ? (
                  <p className="py-2 text-[12.5px] text-[var(--color-muted)]">{t("wxNoActivity")}</p>
                ) : (
                  <ol className="grid gap-3">
                    {data.activity.slice(0, 6).map((item) => (
                      <li key={item.id} className="flex gap-3">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] leading-snug">{item.summary}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{relativeAge(item.createdAt, t)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}
