import { useMemo, useState } from "react";
import { ClipboardPlus, Pencil, Plus, Radio, Search, UserPlus, UsersRound } from "lucide-react";
import type { Agent } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { OrgSeatCapabilities } from "@/domains/organization/org-seat";
import { cn } from "@/shared/lib/utils";
import { CompanionRow, type WorkforceActions } from "./companion-row";
import { Empty, PriorityChip } from "./primitives";
import { MAX_DEPT_AGENTS, cleanPurpose, statusLabel, type WorkforceData } from "./use-workforce-data";

export const UNASSIGNED_ID = "unassigned";

export function WorkforceDepartments({
  data,
  caps,
  actions,
  selectedId,
  onSelect,
}: {
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  actions: WorkforceActions;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);

  const activeId =
    selectedId && (selectedId === UNASSIGNED_ID || data.departments.some((team) => team.id === selectedId))
      ? selectedId
      : data.departments[0]?.id ?? UNASSIGNED_ID;
  const team = data.departments.find((item) => item.id === activeId) ?? null;
  const members: Agent[] = team ? (data.membersByTeam.get(team.id) ?? []) : data.unassigned;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((agent) =>
      `${agent.name} ${agent.role} ${agent.specialty ?? ""}`.toLowerCase().includes(q),
    );
  }, [members, query]);

  const deptTasks = useMemo(
    () =>
      data.openTasks.filter((task) =>
        team
          ? task.teamId === team.id || members.some((agent) => agent.id === task.assigneeAgentId)
          : members.some((agent) => agent.id === task.assigneeAgentId),
      ),
    [data.openTasks, members, team],
  );

  async function openAllHands() {
    setRoomBusy(true);
    const id = await data.ensureAllHands();
    setRoomBusy(false);
    if (id) actions.teamRoom(id);
  }

  const mission = cleanPurpose(team?.purpose);
  const full = team ? members.length >= MAX_DEPT_AGENTS : false;

  return (
    <div className="cc-wrap">
      <div className="grid gap-[18px] lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="cc-card cc-rise !p-2 content-start self-start">
          <button
            type="button"
            className="cc-row w-full"
            disabled={roomBusy || data.agents.length === 0}
            onClick={() => void openAllHands()}
          >
            <span className="cc-avatar is-sm !bg-[var(--color-primary)] !text-[var(--color-on-primary)]">
              <Radio className="size-3.5" strokeWidth={1.8} />
            </span>
            <div className="cc-row-main">
              <p className="cc-row-title">{t("hqChatAllHands")}</p>
              <p className="cc-row-sub">{t("wxAllHandsSub").replace("{n}", String(data.agents.length))}</p>
            </div>
          </button>
          <div className="cc-menu-sep !my-2" />
          <p className="cc-menu-label">{t("wxDepartmentsTitle")}</p>
          <div className="cc-list">
            {data.departments.map((item) => {
              const count = data.membersByTeam.get(item.id)?.length ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn("cc-row w-full !py-2.5", activeId === item.id && "is-active")}
                >
                  <div className="cc-row-main">
                    <p className="cc-row-title">{item.name}</p>
                  </div>
                  <span className="text-[11px] tabular-nums text-[var(--color-muted)]">
                    {count}/{MAX_DEPT_AGENTS}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onSelect(UNASSIGNED_ID)}
              className={cn("cc-row w-full !py-2.5", activeId === UNASSIGNED_ID && "is-active")}
            >
              <div className="cc-row-main">
                <p className="cc-row-title text-[var(--color-muted)]">{t("mapUnassigned")}</p>
              </div>
              <span className="text-[11px] tabular-nums text-[var(--color-muted)]">{data.unassigned.length}</span>
            </button>
          </div>
          {caps.canAdminister ? (
            <button type="button" className="cc-btn is-ghost mt-2 w-full !justify-start" onClick={() => actions.openDept(null)}>
              <Plus className="size-3.5" strokeWidth={2} />
              {t("wxNewDepartment")}
            </button>
          ) : null}
        </aside>

        <div className="grid min-w-0 content-start gap-[18px]">
          <section className="cc-card cc-rise">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="cc-kicker">{team ? t("wxDepartment") : t("wxPool")}</p>
                <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">
                  {team?.name ?? t("mapUnassigned")}
                </h2>
                <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                  {team ? mission || t("wxNoMission") : t("wxPoolBody")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {team && caps.canAdminister ? (
                  <button type="button" className="cc-icon-btn" onClick={() => actions.openDept(team)} aria-label={t("wxDeptEditTitle")} title={t("wxDeptEditTitle")}>
                    <Pencil className="size-[15px]" strokeWidth={1.7} />
                  </button>
                ) : null}
                {team ? (
                  <button type="button" className="cc-btn" disabled={members.length === 0} onClick={() => actions.teamRoom(team.id)}>
                    <Radio className="size-3.5" strokeWidth={1.8} />
                    {t("hqChatEnterRoom")}
                  </button>
                ) : null}
                {caps.canAssignWork ? (
                  <button type="button" className="cc-btn" onClick={() => actions.openTask({ teamId: team?.id })}>
                    <ClipboardPlus className="size-3.5" strokeWidth={1.8} />
                    {t("wxAssignWork")}
                  </button>
                ) : null}
                {caps.canHireAgents ? (
                  <button type="button" className="cc-btn is-primary" disabled={full} onClick={() => actions.openHire(team?.id)}>
                    <UserPlus className="size-3.5" strokeWidth={1.8} />
                    {full ? t("deptFull") : t("wxHireHere")}
                  </button>
                ) : null}
              </div>
            </div>
            {team ? (
              <div className="mt-4 flex items-center gap-3">
                <div className="cc-bar flex-1">
                  <i style={{ width: `${Math.min(100, (members.length / MAX_DEPT_AGENTS) * 100)}%` }} />
                </div>
                <span className="text-[11.5px] tabular-nums text-[var(--color-muted)]">
                  {t("wxDesksUsed").replace("{n}", String(members.length)).replace("{max}", String(MAX_DEPT_AGENTS))}
                </span>
              </div>
            ) : null}
          </section>

          <section className="cc-card cc-rise">
            <header className="cc-card-head !items-center">
              <h3 className="cc-card-title">
                {t("wxCompanions")} <span className="text-[var(--color-muted)]">· {members.length}</span>
              </h3>
              <div className="cc-search w-[220px]">
                <Search />
                <input className="cc-input !h-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wxSearchCompanions")} />
              </div>
            </header>
            {members.length === 0 ? (
              <Empty
                icon={UsersRound}
                title={team ? t("wxEmptyOffice") : t("wxPoolEmpty")}
                body={team ? t("wxEmptyOfficeBody") : undefined}
                action={
                  team && caps.canHireAgents ? (
                    <button type="button" className="cc-btn is-primary" onClick={() => actions.openHire(team.id)}>
                      <UserPlus className="size-3.5" strokeWidth={1.8} />
                      {t("wxHireHere")}
                    </button>
                  ) : null
                }
              />
            ) : filtered.length === 0 ? (
              <p className="px-1 py-4 text-[12.5px] text-[var(--color-muted)]">{t("wxNoMatches")}</p>
            ) : (
              <div className="cc-list">
                {filtered.map((agent) => (
                  <CompanionRow key={agent.id} agent={agent} data={data} caps={caps} actions={actions} showDepartment={false} />
                ))}
              </div>
            )}
          </section>

          {deptTasks.length > 0 ? (
            <section className="cc-card cc-rise">
              <header className="cc-card-head">
                <h3 className="cc-card-title">
                  {t("wxDeptWork")} <span className="text-[var(--color-muted)]">· {deptTasks.length}</span>
                </h3>
              </header>
              <div className="cc-list">
                {deptTasks.slice(0, 8).map((task) => (
                  <button key={task.id} type="button" className="cc-row" onClick={() => actions.goTab("tasks")}>
                    <PriorityChip priority={task.priority} />
                    <div className="cc-row-main">
                      <p className="cc-row-title">{task.title}</p>
                      <p className="cc-row-sub">
                        {data.agentName(task.assigneeAgentId)} · {statusLabel(task.status, t)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
