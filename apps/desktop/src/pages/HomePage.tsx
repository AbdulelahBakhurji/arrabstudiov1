import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Send } from "lucide-react";
import type { Agent, DashboardResponse, TeamMembership } from "@arrab/shared";
import { WorkforceList, type WorkforceListGroup } from "@/components/WorkforceList";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import { filterLiveWorkforceAgents } from "@/lib/agent-session-policy";
import { notifyStudio, pushToast } from "@/lib/notify";
import { useRole } from "@/roles/RoleProvider";
import { useOrgSeatCapabilities } from "@/lib/org-seat";
import { cn } from "@/lib/utils";

type ComposeMode = "team" | "employee" | "project";

const STUDIO_GOAL_KEY = "arrab.studioGoal";

function readStudioGoal(): string {
  try {
    return localStorage.getItem(STUDIO_GOAL_KEY) ?? "";
  } catch {
    return "";
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findAgentByName(agents: Agent[], rawName: string): Agent | null {
  const needle = normalizeName(rawName);
  if (!needle) return null;
  const exact = agents.find((agent) => normalizeName(agent.name) === needle);
  if (exact) return exact;
  const starts = agents.find((agent) => normalizeName(agent.name).startsWith(needle));
  if (starts) return starts;
  return agents.find((agent) => normalizeName(agent.name).includes(needle)) ?? null;
}

/** Parse "assign X to Mohammed", "@sam do Y", or free text + selected assignee. */
export function parseStudioAssign(
  input: string,
  agents: Agent[],
): { title: string; agent: Agent | null; nameHint: string | null } {
  const text = input.trim();
  if (!text) return { title: "", agent: null, nameHint: null };

  const atMatch = text.match(/^@([^\s]+)\s+(.+)$/s);
  if (atMatch) {
    const nameHint = atMatch[1]!.trim();
    return {
      title: atMatch[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const assignToColon = text.match(/^assign\s+to\s+([^:]+):\s*(.+)$/is);
  if (assignToColon) {
    const nameHint = assignToColon[1]!.trim();
    return {
      title: assignToColon[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const forColon = text.match(/^(?:for|to)\s+([^:]+):\s*(.+)$/is);
  if (forColon) {
    const nameHint = forColon[1]!.trim();
    return {
      title: forColon[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const assignTo = text.match(/^(?:assign|give|send)\s+(.+?)\s+to\s+(.+)$/is);
  if (assignTo) {
    let title = assignTo[1]!.trim();
    const nameHint = assignTo[2]!.trim();
    title = title.replace(/^(?:this\s+)?(?:task|one)$/i, "Task").trim() || "Task";
    return {
      title,
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  return { title: text, agent: null, nameHint: null };
}

export function HomePage() {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const { canAssignWork, canHireAgents } = useOrgSeatCapabilities();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ComposeMode>("employee");
  const [name, setName] = useState("");
  const [secondary, setSecondary] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [studioGoal, setStudioGoal] = useState(readStudioGoal);
  const [goalDraft, setGoalDraft] = useState(readStudioGoal);
  const [goalEditing, setGoalEditing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [assignText, setAssignText] = useState("");
  const [assignAgentId, setAssignAgentId] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void Promise.all([
      arrabApi.dashboard(),
      arrabApi.memberships().catch(() => ({ items: [] as TeamMembership[] })),
    ])
      .then(([dashboard, membershipList]) => {
        setData(dashboard);
        setMemberships(membershipList.items);
      })
      .catch((err: unknown) => {
        setData(null);
        setMemberships([]);
        const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
        if (!isTransientApiError(message)) {
          setError(message);
        }
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onRoster = () => load();
    window.addEventListener("arrab-workforce-roster", onRoster);
    window.addEventListener("storage", onRoster);
    return () => {
      window.removeEventListener("arrab-workforce-roster", onRoster);
      window.removeEventListener("storage", onRoster);
    };
  }, [load]);

  useEffect(() => {
    if (!studioGoal.trim()) {
      localStorage.removeItem(STUDIO_GOAL_KEY);
      return;
    }
    localStorage.setItem(STUDIO_GOAL_KEY, studioGoal.trim());
  }, [studioGoal]);

  const activeProjects = data?.projects.filter((p) => p.status === "active") ?? [];
  const employees = useMemo(
    () => filterLiveWorkforceAgents(data?.agents ?? []),
    [data?.agents],
  );
  const workforceGroups = useMemo((): WorkforceListGroup[] => {
    const byTeam = new Map<string, Agent[]>();
    for (const membership of memberships) {
      const agent = employees.find((item) => item.id === membership.agentId);
      if (!agent) continue;
      const list = byTeam.get(membership.teamId) ?? [];
      list.push(agent);
      byTeam.set(membership.teamId, list);
    }
    const assigned = new Set(
      memberships.map((membership) => membership.agentId).filter(Boolean),
    );
    const sortedTeams = [...(data?.teams ?? [])].sort((a, b) => {
      const score = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.includes("studio")) return 0;
        if (lower.includes("all-hands") || lower.includes("all hands")) return 1;
        return 2;
      };
      return score(a.name) - score(b.name);
    });
    const groups: WorkforceListGroup[] = sortedTeams.slice(0, 8).map((team) => ({
      id: team.id,
      name: team.name,
      agents: (byTeam.get(team.id) ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
      })),
    }));
    const unassigned = employees.filter((agent) => !assigned.has(agent.id));
    if (groups.length === 0 && employees.length > 0) {
      groups.push({
        id: "workforce",
        name: t("workforceTitle"),
        agents: employees.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        })),
      });
    } else if (unassigned.length > 0) {
      groups.push({
        id: "unassigned",
        name: t("mapUnassigned"),
        agents: unassigned.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        })),
      });
    }
    return groups;
  }, [data?.teams, employees, memberships, t]);
  const isAr = locale === "ar";
  const hasPeople = employees.length > 0;

  const parsedAssign = useMemo(
    () => parseStudioAssign(assignText, employees),
    [assignText, employees],
  );
  const resolvedAssignee =
    parsedAssign.agent ?? employees.find((agent) => agent.id === assignAgentId) ?? null;

  async function onCompose(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (mode === "team") {
        await arrabApi.createTeam({
          name,
          purpose: secondary.trim() || null,
          projectId: projectId || null,
        });
      } else if (mode === "employee") {
        await arrabApi.createAgent({
          name,
          role: secondary.trim() || "generalist",
          projectId: projectId || null,
          status: "active",
        });
      } else {
        await arrabApi.createProject({
          name,
          description: secondary.trim() || null,
        });
      }
      setName("");
      setSecondary("");
      setProjectId("");
      setShowMore(false);
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!canAssignWork) {
      setAssignError(t("studioAssignManagersOnly"));
      return;
    }
    setAssignError(null);
    const title = parsedAssign.title.trim();
    if (!title) {
      setAssignError(t("studioAssignEmpty"));
      return;
    }
    if (!resolvedAssignee) {
      setAssignError(
        parsedAssign.nameHint
          ? t("studioAssignUnknown").replace("{name}", parsedAssign.nameHint)
          : t("studioAssignPick"),
      );
      return;
    }
    setAssignBusy(true);
    try {
      const task = await arrabApi.createTask({
        title,
        brief: assignText.trim() || null,
        assigneeAgentId: resolvedAssignee.id,
        status: "assigned",
        priority: "medium",
      });
      setAssignText("");
      setAssignAgentId(null);
      pushToast({
        title: t("studioAssignDone"),
        body: t("studioAssignDoneBody")
          .replace("{task}", task.title)
          .replace("{name}", resolvedAssignee.name),
        tone: "success",
        href: href("/workplace"),
      });
      void notifyStudio({
        kind: "cowork",
        title: t("studioAssignDone"),
        body: t("studioAssignDoneBody")
          .replace("{task}", task.title)
          .replace("{name}", resolvedAssignee.name),
        href: href("/workplace"),
      });
      load();
    } catch (err: unknown) {
      setAssignError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAssignBusy(false);
    }
  }

  function openChatWith(agentId: string) {
    sessionStorage.setItem("arrab.chatAgent", agentId);
    navigate(href("/chat"));
  }

  function applyStudioGoal(next: string) {
    const trimmed = next.trim();
    setStudioGoal(trimmed);
    setGoalDraft(trimmed);
    setGoalEditing(false);
  }

  return (
    <Surface className="cp-ui studio-org !overflow-hidden">
      <div className="studio-org-page studio-claude flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="studio-claude-glow pointer-events-none absolute inset-0" aria-hidden />

        <header className="studio-claude-head relative shrink-0 px-5 pt-7 sm:px-8 sm:pt-9">
          <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-end justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <h1>{t("hq")}</h1>
              <p className="studio-claude-lead">{t("studioOrgLead")}</p>
              {studioGoal && !goalEditing ? (
                <p className="studio-claude-goal">
                  <span>{t("dashStudioGoal")}</span>
                  {studioGoal}
                  <button type="button" onClick={() => { setGoalDraft(studioGoal); setGoalEditing(true); }}>
                    {t("edit")}
                  </button>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={hasPeople ? href("/chat") : href("/workforce")}
                onClick={(event) => {
                  if (!hasPeople) {
                    event.preventDefault();
                    if (canHireAgents) setShowMore(true);
                  }
                }}
                className="studio-claude-primary"
              >
                {hasPeople ? t("homePrimaryCta") : canHireAgents ? t("homeHireFirstCta") : t("homePrimaryCta")}
                <ArrowRight className={cn("size-3.5", isAr && "rotate-180")} strokeWidth={1.8} />
              </Link>
              {!studioGoal && !goalEditing ? (
                <button
                  type="button"
                  className="studio-claude-quiet"
                  onClick={() => {
                    setGoalDraft("");
                    setGoalEditing(true);
                  }}
                >
                  {t("setGoal")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {goalEditing ? (
          <div className="relative mx-auto w-full max-w-[1080px] shrink-0 px-5 pt-4 sm:px-8">
            <div className="studio-claude-goal-edit">
              <textarea
                value={goalDraft}
                onChange={(event) => setGoalDraft(event.target.value)}
                rows={2}
                placeholder={t("dashStudioGoalPlaceholder")}
                className="studio-assign-input"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!goalDraft.trim()}
                  onClick={() => applyStudioGoal(goalDraft)}
                  className="studio-claude-primary disabled:opacity-40"
                >
                  {t("setGoal")}
                </button>
                {studioGoal ? (
                  <button type="button" onClick={() => applyStudioGoal("")} className="studio-claude-quiet">
                    {t("markGoalDone")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setGoalDraft(studioGoal);
                    setGoalEditing(false);
                  }}
                  className="studio-claude-quiet"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <section className="relative mx-auto mt-4 w-full max-w-[1080px] shrink-0 px-5 sm:px-8">
            <div className="studio-org-card">
              <p className="text-sm text-[var(--cp-text)]">{t("apiUnavailable")}</p>
              <p className="mt-1 text-sm text-[var(--cp-muted)]">{error}</p>
              <button type="button" onClick={load} className="studio-claude-quiet mt-3">
                {t("retry")}
              </button>
            </div>
          </section>
        ) : null}

        <div className="relative mx-auto flex min-h-0 w-full max-w-[1080px] flex-1 flex-col gap-4 px-5 py-5 sm:px-8 sm:py-6">
          <div className="studio-org-stage min-h-0 flex-1">
            <WorkforceList
              className="studio-workforce-list"
              groups={workforceGroups}
              onAgentClick={openChatWith}
            />

            {canAssignWork ? (
              <section className="studio-claude-compose" aria-label={t("studioAssignTitle")}>
                <h2>{t("studioAssignTitle")}</h2>
                <p className="studio-org-hint">{t("studioAssignHint")}</p>
                <form onSubmit={(event) => void onAssign(event)} className="studio-assign-form mt-4">
                  <textarea
                    value={assignText}
                    onChange={(event) => setAssignText(event.target.value)}
                    rows={4}
                    className="studio-assign-input"
                    placeholder={t("studioAssignPlaceholder")}
                    disabled={!hasPeople || assignBusy}
                  />

                  {hasPeople ? (
                    <div className="studio-assign-people" role="list">
                      {employees.slice(0, 10).map((agent) => {
                        const active =
                          resolvedAssignee?.id === agent.id ||
                          (!parsedAssign.agent && assignAgentId === agent.id);
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            role="listitem"
                            className={cn("studio-assign-chip", active && "is-on")}
                            onClick={() =>
                              setAssignAgentId((current) => (current === agent.id ? null : agent.id))
                            }
                          >
                            <span className="studio-assign-avatar">{initials(agent.name)}</span>
                            {agent.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="studio-org-hint">{t("studioAssignNeedPeople")}</p>
                  )}

                  {resolvedAssignee ? (
                    <p className="text-[12px] text-[var(--cp-muted)]">
                      {t("studioAssignWillGo")
                        .replace("{name}", resolvedAssignee.name)
                        .replace("{task}", parsedAssign.title.trim() || "…")}
                    </p>
                  ) : null}

                  {assignError ? <p className="text-xs text-red-300/90">{assignError}</p> : null}

                  <button
                    type="submit"
                    disabled={assignBusy || !hasPeople || !assignText.trim()}
                    className="studio-claude-primary self-start disabled:opacity-40"
                  >
                    {assignBusy ? (
                      t("saving")
                    ) : (
                      <>
                        <Send size={15} strokeWidth={1.8} />
                        {t("studioAssignCta")}
                      </>
                    )}
                  </button>
                </form>
              </section>
            ) : (
              <section className="studio-claude-compose" aria-label={t("studioAssignTitle")}>
                <h2>{t("studioAssignTitle")}</h2>
                <p className="studio-org-hint">{t("studioAssignManagersOnly")}</p>
              </section>
            )}
          </div>
        </div>

        {showMore && canHireAgents ? (
          <div
            className="studio-org-sheet"
            id="hire"
            onClick={() => setShowMore(false)}
            role="presentation"
          >
            <div
              className="studio-org-sheet-panel"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t("homeComposeTitle")}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2>{t("homeComposeTitle")}</h2>
                  <p className="studio-org-hint">{t("homeComposeBody")}</p>
                </div>
                <button type="button" onClick={() => setShowMore(false)} className="studio-claude-quiet">
                  {t("close")}
                </button>
              </div>

              <div className="studio-org-tabs">
                {(
                  [
                    ["employee", t("createEmployee")],
                    ["team", t("createTeam")],
                    ["project", t("createProject")],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setMode(id);
                      setShowMore(true);
                    }}
                    className={cn(mode === id && "is-on")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={(event) => void onCompose(event)} className="mt-5 space-y-3.5">
                <Field
                  label={
                    mode === "team"
                      ? t("teamName")
                      : mode === "employee"
                        ? t("employeeName")
                        : t("projectName")
                  }
                >
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field !h-11 !rounded-2xl"
                    placeholder={
                      mode === "team"
                        ? t("homePlaceholderTeam")
                        : mode === "employee"
                          ? t("homePlaceholderEmployee")
                          : t("homePlaceholderProject")
                    }
                  />
                </Field>
                <Field
                  label={
                    mode === "team"
                      ? t("teamPurpose")
                      : mode === "employee"
                        ? t("employeeRole")
                        : t("homeProjectAbout")
                  }
                >
                  <input
                    value={secondary}
                    onChange={(e) => setSecondary(e.target.value)}
                    className="field !h-11 !rounded-2xl"
                    placeholder={
                      mode === "employee" ? t("homePlaceholderRole") : t("homePlaceholderOptional")
                    }
                    required={mode === "employee"}
                  />
                </Field>

                {mode !== "project" ? (
                  <Field label={t("linkedProject")}>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="field !h-11 !rounded-2xl"
                    >
                      <option value="">{t("unassigned")}</option>
                      {activeProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {formError ? <p className="text-xs text-red-300/90">{formError}</p> : null}

                <button
                  type="submit"
                  disabled={saving}
                  className="studio-claude-primary mt-1 w-full justify-center disabled:opacity-40"
                >
                  <Plus className="size-4" strokeWidth={1.8} />
                  {saving ? t("saving") : mode === "employee" ? t("homeHireCta") : t("create")}
                </button>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] text-[var(--cp-muted)]">{label}</span>
      {children}
    </label>
  );
}
