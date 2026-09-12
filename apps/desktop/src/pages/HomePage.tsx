import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Target } from "lucide-react";
import type { DashboardResponse } from "@arrab/shared";
import logoTall from "@/assets/logotall.png";
import symbol from "@/assets/symbol.png";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
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

export function HomePage() {
  const { t, locale } = useLanguage();
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

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .dashboard()
      .then(setData)
      .catch((err: unknown) => {
        setData(null);
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
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
    () => (data?.agents ?? []).filter((agent) => agent.status !== "archived").slice(0, 6),
    [data?.agents],
  );
  const teams = useMemo(() => (data?.teams ?? []).slice(0, 4), [data?.teams]);
  const isAr = locale === "ar";

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
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  function openChatWith(agentId: string) {
    sessionStorage.setItem("arrab.chatAgent", agentId);
    navigate("/chat");
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
          <div className="arrab-grid pointer-events-none absolute inset-0" />
          <div className="arrab-scan pointer-events-none absolute inset-x-0 top-[42%] h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <img
            src={symbol}
            alt=""
            className="brand-mark pointer-events-none absolute end-[-4%] top-[-8%] h-[115%] max-w-[52%] object-contain opacity-[0.12]"
          />

          <div className="relative mx-auto flex max-w-[1100px] flex-col px-6 pb-10 pt-10 sm:px-8 sm:pb-12 sm:pt-12 lg:px-10">
            <div className="arrab-rise max-w-2xl">
              <img
                src={logoTall}
                alt={t("brand")}
                className="brand-mark mb-6 h-11 w-auto max-w-[260px] sm:h-14 sm:max-w-[320px] lg:h-16 lg:max-w-[380px]"
              />
              <h1
                className={cn(
                  "font-medium text-white",
                  isAr
                    ? "text-[clamp(1.85rem,4vw,2.9rem)] leading-[1.22] tracking-normal"
                    : "text-[clamp(2.1rem,4.4vw,3.4rem)] leading-[1.04] tracking-[-0.04em]",
                )}
              >
                {t("heroTitle")}
              </h1>
              <p
                className={cn(
                  "mt-4 max-w-xl text-neutral-400",
                  isAr ? "text-[15px] leading-7" : "text-[15px] leading-relaxed",
                )}
              >
                {t("heroBody")}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to="/chat"
                  className="inline-flex h-11 items-center gap-2 bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
                >
                  {t("homePrimaryCta")}
                  <ArrowRight className={cn("size-4", isAr && "rotate-180")} strokeWidth={1.8} />
                </Link>
                <Link
                  to="/workforce"
                  className="inline-flex h-11 items-center border border-white/20 px-5 text-sm text-neutral-200 transition-colors hover:border-white/40 hover:text-white"
                >
                  {t("homeSecondaryCta")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-[1100px] gap-10 px-6 py-8 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14 lg:px-10 lg:py-10">
          {error ? (
            <div className="border border-white/15 px-4 py-4 lg:col-span-2">
              <p className="text-sm text-white">{t("apiUnavailable")}</p>
              <p className="mt-1 text-sm text-neutral-500">{error}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 h-9 border border-white/20 px-4 text-xs text-white hover:bg-white/5"
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          <section className="arrab-rise arrab-rise-delay-2 min-w-0 space-y-8">
            <div>
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Target className="mt-0.5 size-3.5 shrink-0 text-neutral-500" strokeWidth={1.7} />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[11px] text-neutral-500",
                        isAr ? "tracking-normal" : "uppercase tracking-[0.18em]",
                      )}
                    >
                      {t("dashStudioGoal")}
                    </p>
                    {!goalEditing ? (
                      <p className="mt-1 text-sm leading-relaxed text-neutral-300">
                        {studioGoal || t("dashStudioGoalEmpty")}
                      </p>
                    ) : null}
                  </div>
                </div>
                {!goalEditing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(studioGoal);
                      setGoalEditing(true);
                    }}
                    className="shrink-0 border border-white/15 px-3 py-1.5 text-xs text-neutral-300 hover:border-white/30 hover:text-white"
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
                    className="w-full resize-none border border-white/12 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/30"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!goalDraft.trim()}
                      onClick={() => applyStudioGoal(goalDraft)}
                      className="h-8 bg-white px-3 text-xs font-medium text-black disabled:opacity-40"
                    >
                      {t("setGoal")}
                    </button>
                    {studioGoal ? (
                      <button
                        type="button"
                        onClick={() => applyStudioGoal("")}
                        className="h-8 border border-white/15 px-3 text-xs text-neutral-300"
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
                      className="h-8 border border-white/15 px-3 text-xs text-neutral-300"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <p
                className={cn(
                  "text-[11px] text-neutral-500",
                  isAr ? "tracking-normal" : "uppercase tracking-[0.18em]",
                )}
              >
                {t("compose")}
              </p>
              <h2 className="mt-2 text-xl text-white">{t("homeComposeTitle")}</h2>
              <p className="mt-2 text-sm text-neutral-500">{t("homeComposeBody")}</p>

              <div className="mt-5 flex gap-5 border-b border-white/10">
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
                    onClick={() => setMode(id)}
                    className={cn(
                      "relative pb-2.5 text-sm transition-colors",
                      mode === id ? "text-white" : "text-neutral-500 hover:text-neutral-300",
                    )}
                  >
                    {label}
                    {mode === id ? (
                      <span className="absolute inset-x-0 -bottom-px h-px bg-white" />
                    ) : null}
                  </button>
                ))}
              </div>

              <form onSubmit={onCompose} className="mt-5 space-y-3">
                <Field
                  label={
                    mode === "team"
                      ? t("teamName")
                      : mode === "employee"
                        ? t("employeeName")
                        : t("projectName")
                  }
                  isAr={isAr}
                >
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field !rounded-md"
                    placeholder={mode === "team" ? "Core" : mode === "employee" ? "Researcher" : "Launch"}
                  />
                </Field>
                <Field
                  label={
                    mode === "team"
                      ? t("teamPurpose")
                      : mode === "employee"
                        ? t("employeeRole")
                        : t("teamPurpose")
                  }
                  isAr={isAr}
                >
                  <input
                    value={secondary}
                    onChange={(e) => setSecondary(e.target.value)}
                    className="field !rounded-md"
                    placeholder={mode === "employee" ? "research" : "Optional"}
                    required={mode === "employee"}
                  />
                </Field>
                {mode !== "project" ? (
                  <Field label={t("linkedProject")} isAr={isAr}>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="field !rounded-md"
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
                {formError ? <p className="text-xs text-neutral-400">{formError}</p> : null}
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-1 inline-flex h-10 items-center gap-2 bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-40"
                >
                  <Plus className="size-4" strokeWidth={1.8} />
                  {saving ? t("saving") : t("create")}
                </button>
              </form>
            </div>
          </section>

          <section className="arrab-rise arrab-rise-delay-3 min-w-0 space-y-8">
            <div>
              <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p
                    className={cn(
                      "text-[11px] text-neutral-500",
                      isAr ? "tracking-normal" : "uppercase tracking-[0.18em]",
                    )}
                  >
                    {t("employees")}
                  </p>
                  <h2 className="mt-1 text-lg text-white">{t("homeRosterTitle")}</h2>
                </div>
                <Link to="/workforce" className="text-xs text-neutral-500 hover:text-white">
                  {t("homeViewAll")}
                </Link>
              </div>

              {employees.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-500">{t("homeRosterEmpty")}</p>
              ) : (
                <ul className="mt-1 divide-y divide-white/8">
                  {employees.map((agent) => {
                    let goal = "";
                    try {
                      goal = localStorage.getItem(`${GOAL_KEY_PREFIX}${agent.id}`) ?? "";
                    } catch {
                      goal = "";
                    }
                    return (
                      <li key={agent.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{agent.name}</p>
                          <p className="mt-0.5 truncate text-xs text-neutral-500">
                            {agent.role}
                            {goal ? ` · ${t("activeGoal")}: ${goal}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openChatWith(agent.id)}
                          className="shrink-0 border border-white/15 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/35 hover:text-white"
                        >
                          {t("talk")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p
                    className={cn(
                      "text-[11px] text-neutral-500",
                      isAr ? "tracking-normal" : "uppercase tracking-[0.18em]",
                    )}
                  >
                    {t("teams")}
                  </p>
                  <h2 className="mt-1 text-lg text-white">{t("homeTeamsTitle")}</h2>
                </div>
                <Link to="/workforce" className="text-xs text-neutral-500 hover:text-white">
                  {t("open")}
                </Link>
              </div>

              {teams.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-500">{t("noTeams")}</p>
              ) : (
                <ul className="mt-1 divide-y divide-white/8">
                  {teams.map((team) => (
                    <li key={team.id} className="py-3">
                      <p className="text-sm text-white">{team.name}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{team.purpose ?? t("none")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(data?.activity.length ?? 0) > 0 ? (
              <div>
                <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-3">
                  <h2 className="text-lg text-white">{t("recentActivity")}</h2>
                  <Link to="/activity" className="text-xs text-neutral-500 hover:text-white">
                    {t("open")}
                  </Link>
                </div>
                <ol className="mt-3 space-y-3 border-s border-white/10 ps-4">
                  {data?.activity.slice(0, 4).map((entry) => (
                    <li key={entry.id}>
                      <p className="text-sm text-neutral-200">{entry.summary}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-600">{entry.objectType}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </Surface>
  );
}

function Field({ label, children, isAr }: { label: string; children: ReactNode; isAr: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span
        className={cn(
          "text-[11px] text-neutral-500",
          isAr ? "tracking-normal" : "uppercase tracking-[0.14em]",
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
