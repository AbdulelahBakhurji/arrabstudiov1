import { ArrowRight, Building2, CheckCircle2, Inbox, Plus, Sparkles, Zap } from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { OrgSeatCapabilities } from "@/domains/organization/org-seat";
import { cn } from "@/shared/lib/utils";
import type { WorkforceActions } from "./companion-row";
import { Avatar, Card, Empty, PriorityChip, Stat } from "./primitives";
import {
  MAX_DEPT_AGENTS,
  cleanPurpose,
  relativeAge,
  statusLabel,
  type WorkforceData,
} from "./use-workforce-data";

export function WorkforceOverview({
  data,
  caps,
  actions,
}: {
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  actions: WorkforceActions;
}) {
  const { t, locale } = useLanguage();
  const live = data.agents.filter((agent) => agent.status === "active").length;
  const urgent = data.openTasks.filter((task) => task.priority === "urgent" || task.priority === "high").length;
  const needsYou = data.approvals.length + data.draftsAwaitingRequest.length;
  const arrow = cn("size-3.5", locale === "ar" && "rotate-180");

  return (
    <div className="cc-wrap">
      {caps.canAdminister && data.departments.length === 0 ? (
        <div className="cc-banner cc-rise">
          <div className="flex min-w-0 items-center gap-3">
            <span className="cc-mark !size-9">
              <Sparkles className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold">{t("wxSetupBannerTitle")}</p>
              <p className="text-[12px] text-[var(--color-muted)]">{t("wxSetupBannerBody")}</p>
            </div>
          </div>
          <button type="button" className="cc-btn is-primary" onClick={actions.openSetup}>
            {t("wfSetupReopen")}
            <ArrowRight className={arrow} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

      <div className="cc-stats cc-rise">
        <Stat
          label={t("wxStatCompanions")}
          value={data.agents.length}
          foot={t("wxStatLive").replace("{n}", String(live))}
          onClick={() => actions.goTab("departments")}
        />
        <Stat
          label={t("wxStatDepartments")}
          value={data.departments.length}
          foot={t("wxStatUnassigned").replace("{n}", String(data.unassigned.length))}
          onClick={() => actions.goTab("departments")}
        />
        <Stat
          label={t("wxStatOpenWork")}
          value={data.openTasks.length}
          foot={t("wxStatUrgent").replace("{n}", String(urgent))}
          onClick={() => actions.goTab("tasks")}
        />
        <Stat label={t("wxStatNeedsYou")} value={needsYou} foot={t("wxStatNeedsYouFoot")} alert={needsYou > 0} />
      </div>

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="grid min-w-0 content-start gap-[18px]">
          <Card
            title={t("wxDepartmentsTitle")}
            sub={t("wxDepartmentsSub")}
            action={
              caps.canAdminister ? (
                <button type="button" className="cc-btn is-sm" onClick={() => actions.openDept(null)}>
                  <Plus className="size-3.5" strokeWidth={2} />
                  {t("wxNewDepartment")}
                </button>
              ) : null
            }
          >
            {data.departments.length === 0 ? (
              <Empty
                icon={Building2}
                title={t("wxNoDepartments")}
                body={t("wxNoDepartmentsBody")}
                action={
                  caps.canAdminister ? (
                    <button type="button" className="cc-btn is-primary" onClick={actions.openSetup}>
                      <Sparkles className="size-3.5" strokeWidth={1.8} />
                      {t("wfSetupReopen")}
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {data.departments.map((team) => {
                  const members = data.membersByTeam.get(team.id) ?? [];
                  const open = data.openTasks.filter(
                    (task) =>
                      task.teamId === team.id ||
                      members.some((agent) => agent.id === task.assigneeAgentId),
                  ).length;
                  const mission = cleanPurpose(team.purpose);
                  return (
                    <button
                      key={team.id}
                      type="button"
                      className="cc-dept"
                      onClick={() => actions.goDepartment(team.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold">{team.name}</p>
                          <p className="mt-1 line-clamp-2 min-h-[34px] text-[12px] leading-[17px] text-[var(--color-muted)]">
                            {mission || t("wxNoMission")}
                          </p>
                        </div>
                        {open > 0 ? <span className="cc-chip is-accent">{open} {t("wxOpenShort")}</span> : null}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="cc-stack">
                          {members.slice(0, 5).map((agent) => (
                            <Avatar key={agent.id} name={agent.name} size="sm" />
                          ))}
                          {members.length === 0 ? (
                            <span className="text-[11.5px] text-[var(--color-muted)]">{t("wxEmptyOffice")}</span>
                          ) : null}
                        </div>
                        <span className="text-[11.5px] tabular-nums text-[var(--color-muted)]">
                          {members.length}/{MAX_DEPT_AGENTS}
                        </span>
                      </div>
                      <div className="cc-bar">
                        <i style={{ width: `${Math.min(100, (members.length / MAX_DEPT_AGENTS) * 100)}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title={t("wxWorkInMotion")}
            sub={t("wxWorkInMotionSub")}
            action={
              <button type="button" className="cc-btn is-sm is-ghost" onClick={() => actions.goTab("tasks")}>
                {t("homeViewAll")}
                <ArrowRight className={arrow} strokeWidth={1.8} />
              </button>
            }
          >
            {data.openTasks.length === 0 ? (
              <Empty
                icon={Zap}
                title={t("wxNoOpenWork")}
                body={t("wxNoOpenWorkBody")}
                action={
                  caps.canAssignWork ? (
                    <button type="button" className="cc-btn" onClick={() => actions.openTask()}>
                      <Plus className="size-3.5" strokeWidth={2} />
                      {t("wxNewTask")}
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className="cc-list">
                {data.openTasks.slice(0, 6).map((task) => (
                  <button key={task.id} type="button" className="cc-row" onClick={() => actions.goTab("tasks")}>
                    <PriorityChip priority={task.priority} />
                    <div className="cc-row-main">
                      <p className="cc-row-title">{task.title}</p>
                      <p className="cc-row-sub">
                        {data.agentName(task.assigneeAgentId)} · {statusLabel(task.status, t)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--color-muted)]">
                      {relativeAge(task.updatedAt, t)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-[18px]">
          <Card title={t("wxNeedsYouTitle")} sub={t("wxNeedsYouSub")}>
            {needsYou === 0 ? (
              <Empty icon={CheckCircle2} title={t("wxAllClear")} body={t("wxAllClearBody")} />
            ) : (
              <div className="cc-list">
                {data.approvals.map((approval) => (
                  <div key={approval.id} className="cc-row !items-start">
                    <span className="cc-empty-icon !size-8 !rounded-[10px]">
                      <Inbox className="size-3.5" strokeWidth={1.7} />
                    </span>
                    <div className="cc-row-main">
                      <p className="cc-row-title !whitespace-normal">{approval.title}</p>
                      <p className="cc-row-sub">
                        {approval.detail ?? relativeAge(approval.createdAt, t)}
                      </p>
                      {caps.canAssignWork ? (
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            className="cc-btn is-sm is-primary"
                            onClick={() => void data.resolveApproval(approval.id, "approved")}
                          >
                            {t("wxApprove")}
                          </button>
                          <button
                            type="button"
                            className="cc-btn is-sm"
                            onClick={() => void data.resolveApproval(approval.id, "rejected")}
                          >
                            {t("wxReject")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {data.draftsAwaitingRequest.map((agent) => (
                  <div key={agent.id} className="cc-row">
                    <Avatar name={agent.name} size="sm" />
                    <div className="cc-row-main">
                      <p className="cc-row-title">{agent.name}</p>
                      <p className="cc-row-sub">{t("wxDraftWaiting")}</p>
                    </div>
                    {caps.canHireAgents ? (
                      <button
                        type="button"
                        className="cc-btn is-sm is-primary"
                        onClick={() => void data.activateAgent(agent, false)}
                      >
                        {t("wxActivate")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={t("wxRecentRuns")} sub={t("wxRecentRunsSub")}>
            {data.taskRuns.length === 0 ? (
              <p className="px-1 py-3 text-[12.5px] text-[var(--color-muted)]">{t("wxNoRuns")}</p>
            ) : (
              <div className="cc-list">
                {data.taskRuns.slice(0, 5).map((run) => (
                  <div key={run.id} className="cc-row">
                    <Avatar name={data.agentName(run.agentId)} size="sm" />
                    <div className="cc-row-main">
                      <p className="cc-row-title">
                        {data.tasks.find((task) => task.id === run.taskId)?.title ?? t("wxTaskRun")}
                      </p>
                      <p className="cc-row-sub">{run.summary ?? data.agentName(run.agentId)}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--color-muted)]">
                      {relativeAge(run.createdAt, t)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={t("wxActivityTitle")}>
            {data.activity.length === 0 ? (
              <p className="px-1 py-3 text-[12.5px] text-[var(--color-muted)]">{t("wxNoActivity")}</p>
            ) : (
              <ol className="grid gap-3 px-1">
                {data.activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex gap-3">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] leading-snug">{item.summary}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        {relativeAge(item.createdAt, t)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
