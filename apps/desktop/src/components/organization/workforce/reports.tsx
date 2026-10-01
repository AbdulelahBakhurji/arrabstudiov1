import { useEffect, useMemo } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { Card, Stat } from "./primitives";
import { TASK_COLUMNS, relativeAge, statusLabel, type WorkforceData } from "./use-workforce-data";

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

function Bar({ label, value, max, display }: { label: string; value: number; max: number; display?: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{display ?? value}</span>
      </div>
      <div className="cc-bar is-accent">
        <i style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

export function WorkforceReports({ data }: { data: WorkforceData }) {
  const { t } = useLanguage();
  const { loadUsage, refreshLive } = data;

  useEffect(() => {
    void loadUsage();
    const id = window.setInterval(() => {
      void loadUsage();
      void refreshLive();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [loadUsage, refreshLive]);

  const totals = data.usage?.totals ?? { inputTokens: 0, outputTokens: 0, events: 0 };
  const tokens = totals.inputTokens + totals.outputTokens;
  const done = data.tasks.filter((task) => task.status === "done").length;
  const rate = data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0;
  const live = data.agents.filter((agent) => agent.status === "active").length;

  const byStatus = TASK_COLUMNS.map((status) => ({
    status,
    count: data.tasks.filter((task) => task.status === status).length,
  }));
  const maxStatus = Math.max(1, ...byStatus.map((row) => row.count));

  const byCompanion = useMemo(() => {
    const rows = (data.usage?.byAgent ?? [])
      .map((row) => ({
        id: row.agentId ?? "none",
        name: row.agentId ? data.agentName(row.agentId) : t("unassigned"),
        total: row.inputTokens + row.outputTokens,
      }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    return rows;
  }, [data, t]);
  const maxTokens = Math.max(1, ...byCompanion.map((row) => row.total));

  const workload = useMemo(
    () =>
      data.agents
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          open: data.openTasks.filter((task) => task.assigneeAgentId === agent.id).length,
        }))
        .filter((row) => row.open > 0)
        .sort((a, b) => b.open - a.open)
        .slice(0, 8),
    [data.agents, data.openTasks],
  );
  const maxLoad = Math.max(1, ...workload.map((row) => row.open));

  return (
    <div className="cc-wrap">
      <div className="cc-stats cc-rise">
        <Stat label={t("wxRepTokens")} value={compact(tokens)} foot={t("wxRepTokensFoot")} />
        <Stat label={t("wxRepRequests")} value={compact(totals.events)} foot={t("wxRepRequestsFoot")} />
        <Stat label={t("wxRepCompletion")} value={`${rate}%`} foot={t("wxRepCompletionFoot").replace("{n}", String(done))} />
        <Stat label={t("wxStatCompanions")} value={live} foot={t("wxRepLiveFoot").replace("{n}", String(data.agents.length))} />
      </div>

      <div className="grid gap-[18px] lg:grid-cols-2">
        <Card title={t("wxRepByStatus")} sub={t("wxRepByStatusSub")}>
          <div className="grid gap-3">
            {byStatus.map((row) => (
              <Bar key={row.status} label={statusLabel(row.status, t)} value={row.count} max={maxStatus} />
            ))}
          </div>
        </Card>
        <Card title={t("wxRepByCompanion")} sub={t("wxRepByCompanionSub")}>
          {byCompanion.length === 0 ? (
            <p className="py-4 text-[12.5px] text-[var(--color-muted)]">{t("wxRepNoUsage")}</p>
          ) : (
            <div className="grid gap-3">
              {byCompanion.map((row) => (
                <Bar key={row.id} label={row.name} value={row.total} max={maxTokens} display={compact(row.total)} />
              ))}
            </div>
          )}
        </Card>
        <Card title={t("wxRepWorkload")} sub={t("wxRepWorkloadSub")}>
          {workload.length === 0 ? (
            <p className="py-4 text-[12.5px] text-[var(--color-muted)]">{t("wxNoOpenWork")}</p>
          ) : (
            <div className="grid gap-3">
              {workload.map((row) => (
                <Bar key={row.id} label={row.name} value={row.open} max={maxLoad} />
              ))}
            </div>
          )}
        </Card>
        <Card title={t("wxActivityTitle")}>
          {data.activity.length === 0 ? (
            <p className="py-4 text-[12.5px] text-[var(--color-muted)]">{t("wxNoActivity")}</p>
          ) : (
            <ol className="grid max-h-[340px] gap-3 overflow-y-auto pe-1">
              {data.activity.slice(0, 30).map((item) => (
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
  );
}
