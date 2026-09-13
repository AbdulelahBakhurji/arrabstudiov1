import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Plus, Sparkles } from "lucide-react";
import type { DashboardResponse } from "@arrab/shared";
import logoTall from "@/assets/logotall.png";
import symbol from "@/assets/symbol.png";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import { useRole } from "@/roles/RoleProvider";
import { cn } from "@/lib/utils";

type ComposeMode = "team" | "employee" | "project";

const STUDIO_GOAL_KEY = "arrab.studioGoal";
const GOAL_KEY_PREFIX = "arrab.chatGoal.";

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

export function HomePage() {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
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

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .dashboard()
      .then(setData)
      .catch((err: unknown) => {
        setData(null);
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
    if (!studioGoal.trim()) {
      localStorage.removeItem(STUDIO_GOAL_KEY);
      return;
    }
    localStorage.setItem(STUDIO_GOAL_KEY, studioGoal.trim());
  }, [studioGoal]);

  const activeProjects = data?.projects.filter((p) => p.status === "active") ?? [];
  const employees = useMemo(
    () => (data?.agents ?? []).filter((agent) => agent.status !== "archived").slice(0, 8),
    [data?.agents],
  );
  const teams = useMemo(() => (data?.teams ?? []).slice(0, 4), [data?.teams]);
  const isAr = locale === "ar";
  const hasPeople = employees.length > 0;

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
    <Surface className="arrab-fade studio-home overflow-hidden">
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto">
        <section className="arrab-hero relative shrink-0 overflow-hidden">
          <div className="arrab-grid pointer-events-none absolute inset-0 opacity-60" />
          <img
            src={symbol}
            alt=""
            className="brand-mark pointer-events-none absolute end-[-6%] top-[-12%] h-[125%] max-w-[55%] object-contain opacity-[0.1]"
          />

          <div className="relative mx-auto flex max-w-[980px] flex-col px-6 pb-12 pt-12 sm:px-8 sm:pb-14 sm:pt-14 lg:px-10">
            <div className="arrab-rise max-w-xl">
              <p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                {t("roleLivingOrganization")}
              </p>
              <img
                src={logoTall}
                alt={t("brand")}
                className="brand-mark mb-7 h-10 w-auto max-w-[240px] sm:h-12 sm:max-w-[280px]"
              />
              <h1
                className={cn(
                  "font-semibold text-white",
                  isAr
                    ? "text-[clamp(1.9rem,4vw,2.75rem)] leading-[1.25] tracking-normal"
                    : "text-[clamp(2.15rem,4.2vw,3.15rem)] leading-[1.08] tracking-[-0.045em]",
                )}
              >
                {t("heroTitleOrganization")}
              </h1>
              <p
                className={cn(
                  "mt-4 max-w-md text-[15px] text-neutral-400",
                  isAr ? "leading-7" : "leading-relaxed",
                )}
              >
                {t("heroBodyOrganization")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to={hasPeople ? href("/chat") : "#hire"}
                  onClick={(event) => {
                    if (!hasPeople) {
                      event.preventDefault();
                      document.getElementById("hire")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                  className="home-btn-primary inline-flex h-11 items-center gap-2 px-6 text-[14px] font-medium"
                >
                  {hasPeople ? t("homePrimaryCta") : t("homeHireFirstCta")}
                  <ArrowRight className={cn("size-4 opacity-70", isAr && "rotate-180")} strokeWidth={1.8} />
                </Link>
                <Link
                  to={href("/cowork")}
                  className="home-btn-secondary inline-flex h-11 items-center px-5 text-[14px]"
                >
                  {t("openCowork")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-[980px] space-y-6 px-6 py-8 sm:px-8 sm:py-10 lg:px-10">
          {error ? (
            <div className="home-panel px-5 py-4">
              <p className="text-sm text-white">{t("apiUnavailable")}</p>
              <p className="mt-1 text-sm text-neutral-500">{error}</p>
              <button type="button" onClick={load} className="home-btn-secondary mt-3 h-9 px-4 text-xs">
                {t("retry")}
              </button>
            </div>
          ) : null}

          <section className="arrab-rise arrab-rise-delay-1 home-panel px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-neutral-500">{t("dashStudioGoal")}</p>
                {!goalEditing ? (
                  <p className="mt-1 text-[15px] leading-snug text-neutral-200">
                    {studioGoal || t("dashStudioGoalEmpty")}
                  </p>
                ) : null}
              </div>
              {!goalEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    setGoalDraft(studioGoal);
                    setGoalEditing(true);
                  }}
                  className="home-chip shrink-0"
                >
                  {studioGoal ? t("editGoal") : t("setGoal")}
                </button>
              ) : null}
            </div>
            {goalEditing ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                  rows={2}
                  placeholder={t("dashStudioGoalPlaceholder")}
                  className="field !h-auto !rounded-2xl py-3"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!goalDraft.trim()}
                    onClick={() => applyStudioGoal(goalDraft)}
                    className="home-btn-primary h-9 px-4 text-xs disabled:opacity-40"
                  >
                    {t("setGoal")}
                  </button>
                  {studioGoal ? (
                    <button
                      type="button"
                      onClick={() => applyStudioGoal("")}
                      className="home-btn-secondary h-9 px-4 text-xs"
                    >
                      {t("markGoalDone")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(studioGoal);
                      setGoalEditing(false);
                    }}
                    className="home-btn-secondary h-9 px-4 text-xs"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-7">
            <section className="arrab-rise arrab-rise-delay-2 home-panel min-w-0 p-5 sm:p-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-medium tracking-tight text-white">
                    {t("homeRosterTitle")}
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">{t("homeRosterHint")}</p>
                </div>
                <Link to={href("/workforce")} className="text-[13px] text-neutral-500 transition-colors hover:text-white">
                  {t("homeViewAll")}
                </Link>
              </div>

              {employees.length === 0 ? (
                <div className="mt-8 flex flex-col items-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-white/5">
                    <Sparkles className="size-5 text-neutral-400" strokeWidth={1.6} />
                  </div>
                  <p className="mt-4 text-[15px] text-neutral-300">{t("homeRosterEmpty")}</p>
                  <button
                    type="button"
                    onClick={() => document.getElementById("hire")?.scrollIntoView({ behavior: "smooth" })}
                    className="home-btn-primary mt-5 h-10 px-5 text-sm"
                  >
                    {t("homeHireFirstCta")}
                  </button>
                </div>
              ) : (
                <ul className="mt-5 space-y-2.5">
                  {employees.map((agent) => {
                    let goal = "";
                    try {
                      goal = localStorage.getItem(`${GOAL_KEY_PREFIX}${agent.id}`) ?? "";
                    } catch {
                      goal = "";
                    }
                    return (
                      <li key={agent.id}>
                        <button
                          type="button"
                          onClick={() => openChatWith(agent.id)}
                          className="home-person group flex w-full items-center gap-3.5 px-3.5 py-3 text-start transition-colors"
                        >
                          <span className="home-avatar flex size-11 shrink-0 items-center justify-center text-[13px] font-medium">
                            {initials(agent.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] text-white">{agent.name}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-neutral-500">
                              {agent.role}
                              {goal ? ` · ${goal}` : ""}
                            </span>
                          </span>
                          <span className="home-chip opacity-70 transition-opacity group-hover:opacity-100">
                            {t("talk")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {teams.length > 0 ? (
                <div className="mt-7 border-t border-white/8 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[14px] font-medium text-white">{t("homeTeamsTitle")}</h3>
                    <Link to={href("/workforce")} className="text-[12px] text-neutral-500 hover:text-white">
                      {t("open")}
                    </Link>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {teams.map((team) => (
                      <li
                        key={team.id}
                        className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] text-neutral-200">{team.name}</p>
                          <p className="truncate text-[12px] text-neutral-500">
                            {team.purpose ?? t("none")}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section id="hire" className="arrab-rise arrab-rise-delay-3 home-panel min-w-0 scroll-mt-6 p-5 sm:p-6">
              <h2 className="text-[17px] font-medium tracking-tight text-white">
                {t("homeComposeTitle")}
              </h2>
              <p className="mt-1 text-[13px] text-neutral-500">{t("homeComposeBody")}</p>

              <div className="mt-5 flex gap-1 rounded-2xl bg-white/[0.04] p-1">
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
                      setShowMore(false);
                    }}
                    className={cn(
                      "flex-1 rounded-xl px-2 py-2 text-[12px] transition-colors sm:text-[13px]",
                      mode === id
                        ? "bg-white text-black shadow-none"
                        : "text-neutral-400 hover:text-neutral-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={onCompose} className="mt-5 space-y-3.5">
                <Field label={mode === "team" ? t("teamName") : mode === "employee" ? t("employeeName") : t("projectName")}>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field !h-11 !rounded-2xl"
                    placeholder={
                      mode === "team" ? t("homePlaceholderTeam") : mode === "employee" ? t("homePlaceholderEmployee") : t("homePlaceholderProject")
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
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowMore((v) => !v)}
                      className="inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-300"
                    >
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", showMore && "rotate-180")}
                        strokeWidth={1.8}
                      />
                      {t("homeMoreOptions")}
                    </button>
                    {showMore ? (
                      <div className="mt-3">
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
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {formError ? <p className="text-xs text-red-300/90">{formError}</p> : null}

                <button
                  type="submit"
                  disabled={saving}
                  className="home-btn-primary mt-1 inline-flex h-11 w-full items-center justify-center gap-2 text-[14px] font-medium disabled:opacity-40"
                >
                  <Plus className="size-4" strokeWidth={1.8} />
                  {saving ? t("saving") : mode === "employee" ? t("homeHireCta") : t("create")}
                </button>
              </form>
            </section>
          </div>

          {(data?.activity.length ?? 0) > 0 ? (
            <section className="arrab-rise arrab-rise-delay-3 home-panel p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-medium text-white">{t("recentActivity")}</h2>
                <Link to={href("/activity")} className="text-[12px] text-neutral-500 hover:text-white">
                  {t("open")}
                </Link>
              </div>
              <ol className="mt-4 space-y-3">
                {data?.activity.slice(0, 3).map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/35" />
                    <div className="min-w-0">
                      <p className="text-[14px] text-neutral-200">{entry.summary}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-600">{entry.objectType}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
