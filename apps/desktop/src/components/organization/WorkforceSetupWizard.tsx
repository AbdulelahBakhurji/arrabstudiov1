import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Building2,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import type { WorkforceBlueprint } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { MessageKey } from "@/i18n/messages";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

const SETUP_KEY = "arrab.workforce.setup.v1";

export function readWorkforceSetupState(): "done" | "skipped" | null {
  try {
    const value = localStorage.getItem(SETUP_KEY);
    return value === "done" || value === "skipped" ? value : null;
  } catch {
    return null;
  }
}

function writeWorkforceSetupState(value: "done" | "skipped") {
  try {
    localStorage.setItem(SETUP_KEY, value);
  } catch {
    // ignore
  }
}

type Stage = "industry" | "details" | "drafting" | "review" | "building" | "done";
type Line = { from: "ai" | "you"; text: string };

export type WorkforceSetupResult = { teamId: string; roles: string[] };

const INDUSTRY_CHIPS: MessageKey[] = [
  "wfSetupChipSoftware",
  "wfSetupChipRetail",
  "wfSetupChipHealthcare",
  "wfSetupChipRealEstate",
  "wfSetupChipHospitality",
  "wfSetupChipEducation",
  "wfSetupChipLegal",
  "wfSetupChipLogistics",
  "wfSetupChipAgency",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

export function WorkforceSetupWizard({
  onClose,
  onComplete,
  variant = "modal",
}: {
  onClose: () => void;
  onComplete: (created: WorkforceSetupResult[]) => void;
  /** "page" renders inline, filling the host surface instead of an overlay. */
  variant?: "modal" | "page";
}) {
  const { t, locale, dir } = useLanguage();
  const [stage, setStage] = useState<Stage>("industry");
  const [lines, setLines] = useState<Line[]>(() => [{ from: "ai", text: t("wfSetupHello") }]);
  const [draft, setDraft] = useState("");
  const [industry, setIndustry] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const [blueprint, setBlueprint] = useState<WorkforceBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [step, setStep] = useState("");
  const createdTeams = useRef(new Map<number, string>());
  const createdAgents = useRef(new Map<string, string>());
  /** Keys of finished teaching steps: profile, playbooks, and skills — so a retry resumes. */
  const taught = useRef(new Set<string>());
  const results = useRef<WorkforceSetupResult[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, stage]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [stage]);

  const counts = useMemo(() => {
    const departments = blueprint?.departments.length ?? 0;
    const companions =
      blueprint?.departments.reduce((sum, dept) => sum + dept.companions.length, 0) ?? 0;
    const skills =
      blueprint?.departments.reduce(
        (sum, dept) => sum + dept.companions.reduce((n, person) => n + person.skills.length, 0),
        0,
      ) ?? 0;
    return { departments, companions, skills };
  }, [blueprint]);

  const say = (line: Line) => setLines((current) => [...current, line]);

  async function runDraft(company: string, notes: string[], refining: boolean) {
    setStage("drafting");
    setError(null);
    say({ from: "ai", text: refining ? t("wfSetupRefining") : t("wfSetupDrafting") });
    try {
      const next = await arrabApi.workforceBlueprint({
        industry: company,
        details: notes.join("\n") || null,
        locale,
      });
      setBlueprint(next);
      createdTeams.current.clear();
      createdAgents.current.clear();
      taught.current.clear();
      results.current = [];
      say({
        from: "ai",
        text: [next.summary, t("wfSetupReviewHint")].filter(Boolean).join("\n\n"),
      });
      setStage("review");
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setError(message);
      say({ from: "ai", text: t("wfSetupDraftFailed") });
      setStage(blueprint ? "review" : "details");
    }
  }

  function submit(value: string) {
    const text = value.trim();
    if (!text || stage === "drafting" || stage === "building" || stage === "done") return;
    setDraft("");
    say({ from: "you", text });
    if (stage === "industry") {
      setIndustry(text);
      say({ from: "ai", text: t("wfSetupAskDetails") });
      setStage("details");
      return;
    }
    const notes = [...details, text];
    setDetails(notes);
    void runDraft(industry, notes, stage === "review");
  }

  function skipDetails() {
    say({ from: "you", text: t("wfSetupSkip") });
    void runDraft(industry, details, false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(draft);
  }

  function removeDepartment(index: number) {
    setBlueprint((current) =>
      current
        ? { ...current, departments: current.departments.filter((_, i) => i !== index) }
        : current,
    );
  }

  function removeCompanion(deptIndex: number, personIndex: number) {
    setBlueprint((current) => {
      if (!current) return current;
      const departments = current.departments
        .map((dept, i) =>
          i === deptIndex
            ? { ...dept, companions: dept.companions.filter((_, j) => j !== personIndex) }
            : dept,
        )
        .filter((dept) => dept.companions.length > 0);
      return { ...current, departments };
    });
  }

  function companyProfile(current: WorkforceBlueprint): string {
    return [
      `${t("wfSetupProfileIndustry")}: ${current.industry || industry}`,
      details.length > 0 ? `${t("wfSetupProfileNotes")}:\n${details.map((note) => `- ${note}`).join("\n")}` : "",
      current.summary,
      `${t("wfSetupProfileDepartments")}:\n${current.departments
        .map((dept) => `- ${dept.name}${dept.purpose ? ` — ${dept.purpose}` : ""}`)
        .join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function build() {
    if (!blueprint || counts.departments === 0) return;
    setStage("building");
    setError(null);
    const total = 1 + counts.departments * 2 + counts.companions + counts.skills;
    let done = createdTeams.current.size + createdAgents.current.size + taught.current.size;
    let missed = 0;
    const tick = () => setProgress({ done: ++done, total });
    /** Teaching steps are best-effort: a failed doc or skill must not strand the org half-built. */
    const teach = async (key: string, label: string, run: () => Promise<unknown>) => {
      if (taught.current.has(key)) return;
      setStep(label);
      try {
        await run();
      } catch {
        missed += 1;
      }
      taught.current.add(key);
      tick();
    };
    setProgress({ done, total });
    const industryName = blueprint.industry || industry;
    try {
      await teach("profile", t("wfSetupStepProfile"), () =>
        arrabApi.createKnowledge({
          title: t("wfSetupProfileTitle").replace("{industry}", industryName),
          content: companyProfile(blueprint),
        }),
      );
      for (const [deptIndex, dept] of blueprint.departments.entries()) {
        let teamId = createdTeams.current.get(deptIndex);
        if (!teamId) {
          setStep(t("wfSetupStepDepartment").replace("{name}", dept.name));
          const team = await arrabApi.createTeam({
            name: dept.name,
            purpose: [dept.purpose || null, "mode:supervised", "approval:human", "automation:medium"]
              .filter(Boolean)
              .join(" · "),
          });
          teamId = team.id;
          createdTeams.current.set(deptIndex, teamId);
          results.current.push({ teamId, roles: dept.companions.map((person) => person.role) });
          tick();
        }
        const playbookTitle = t("wfSetupPlaybookTitle").replace("{name}", dept.name);
        await teach(`playbook:${deptIndex}`, t("wfSetupStepPlaybook").replace("{name}", dept.name), () =>
          arrabApi.createKnowledge({ title: playbookTitle, content: dept.playbook }),
        );
        for (const [personIndex, person] of dept.companions.entries()) {
          const key = `${deptIndex}:${personIndex}`;
          let agentId = createdAgents.current.get(key);
          if (!agentId) {
            setStep(t("wfSetupStepCompanion").replace("{name}", person.name));
            const context = t("wfSetupAgentContext")
              .replace("{department}", dept.name)
              .replace("{industry}", industryName)
              .replace("{playbook}", playbookTitle);
            const agent = await arrabApi.createAgent({
              name: person.name,
              role: person.role,
              specialty: person.specialty,
              instructions: `${person.instructions}\n\n${context}`,
              status: "active",
            });
            agentId = agent.id;
            await arrabApi.addTeamMember(teamId, { agentId });
            createdAgents.current.set(key, agentId);
            tick();
          }
          for (const [skillIndex, skill] of person.skills.entries()) {
            const id = agentId;
            await teach(
              `skill:${key}:${skillIndex}`,
              t("wfSetupStepSkill").replace("{name}", person.name).replace("{skill}", skill.title),
              () =>
                arrabApi.createSkill({
                  agentId: id,
                  title: skill.title,
                  instructions: skill.instructions,
                  createTask: false,
                }),
            );
          }
        }
      }
      writeWorkforceSetupState("done");
      setStep("");
      say({
        from: "ai",
        text: [
          t("wfSetupDone"),
          t("wfSetupTaughtSummary")
            .replace("{skills}", String(counts.skills))
            .replace("{companions}", String(counts.companions))
            .replace("{docs}", String(counts.departments + 1)),
          missed > 0 ? t("wfSetupTeachPartial").replace("{count}", String(missed)) : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      setStage("done");
    } catch (err: unknown) {
      setStep("");
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      say({ from: "ai", text: t("wfSetupBuildFailed") });
      setStage("review");
    }
  }

  function skip() {
    writeWorkforceSetupState("skipped");
    if (results.current.length > 0) onComplete(results.current);
    onClose();
  }

  const locked = createdTeams.current.size > 0;
  const composerOpen =
    stage === "industry" || stage === "details" || (stage === "review" && !locked);
  const placeholder =
    stage === "industry"
      ? t("wfSetupIndustryPlaceholder")
      : stage === "details"
        ? t("wfSetupDetailsPlaceholder")
        : t("wfSetupChangePlaceholder");
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const inPage = variant === "page";

  return (
    <div
      className={cn(
        "no-drag",
        inPage
          ? "relative z-10 flex h-full min-h-0 w-full p-3 lg:p-5"
          : "fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm",
      )}
      dir={dir}
      role={inPage ? "region" : "dialog"}
      aria-modal={inPage ? undefined : true}
      aria-label={t("wfSetupTitle")}
    >
      <div
        className={cn(
          "hq-rise flex w-full overflow-hidden rounded-[24px] border border-white/10 bg-[var(--color-surface)]",
          inPage ? "h-full min-h-0 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.9)]" : "h-[min(760px,92vh)] max-w-6xl shadow-2xl",
        )}
      >
        <section className="flex min-w-0 flex-1 flex-col border-e border-white/[0.07]">
          <header className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="flex size-9 items-center justify-center rounded-xl bg-white text-black">
              <Sparkles className="size-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-medium tracking-[-0.02em] text-white">
                {t("wfSetupTitle")}
              </h2>
              <p className="truncate text-[11px] text-neutral-500">{t("wfSetupLead")}</p>
            </div>
            {stage !== "building" ? (
              <button
                type="button"
                onClick={stage === "done" ? () => {
                  onComplete(results.current);
                  onClose();
                } : skip}
                className="chat-pro-icon-btn"
                aria-label={t("wfSetupClose")}
                title={t("wfSetupClose")}
              >
                <X className="size-4" strokeWidth={1.7} />
              </button>
            ) : null}
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {lines.map((line, index) => (
              <div
                key={index}
                className={cn("flex gap-3", line.from === "you" ? "justify-end" : "justify-start")}
              >
                {line.from === "ai" ? (
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                    <Sparkles className="size-3.5 text-white" strokeWidth={1.7} />
                  </div>
                ) : null}
                <div
                  className={cn(
                    "max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed",
                    line.from === "you"
                      ? "bg-white text-black"
                      : "border border-white/[0.07] bg-white/[0.03] text-neutral-200",
                  )}
                >
                  {line.text}
                </div>
              </div>
            ))}
            {stage === "drafting" ? (
              <div className="flex items-center gap-2 ps-10 text-[12px] text-neutral-500">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                {t("wfSetupThinking")}
              </div>
            ) : null}
            {stage === "industry" ? (
              <div className="flex flex-wrap gap-2 ps-10">
                {INDUSTRY_CHIPS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => submit(t(key))}
                    className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-neutral-300 transition-colors hover:border-white/25 hover:text-white"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            ) : null}
            {stage === "details" ? (
              <div className="ps-10">
                <button
                  type="button"
                  onClick={skipDetails}
                  className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-neutral-300 hover:border-white/25 hover:text-white"
                >
                  {t("wfSetupSkip")}
                </button>
              </div>
            ) : null}
            {error ? (
              <p className="ps-10 text-[12px] text-rose-300/90">{error}</p>
            ) : null}
          </div>

          {composerOpen ? (
            <form onSubmit={onSubmit} className="border-t border-white/[0.07] p-4">
              <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 focus-within:border-white/25">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      submit(draft);
                    }
                  }}
                  rows={1}
                  placeholder={placeholder}
                  className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-white outline-none placeholder:text-neutral-600"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label={t("wfSetupSend")}
                  className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:opacity-30"
                >
                  <ArrowUp className="size-4" strokeWidth={2} />
                </button>
              </div>
            </form>
          ) : null}
        </section>

        <aside className="hidden w-[46%] min-w-[360px] flex-col md:flex">
          <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                {t("wfSetupPreview")}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-white">
                {blueprint
                  ? t("wfSetupCounts")
                      .replace("{departments}", String(counts.departments))
                      .replace("{companions}", String(counts.companions)) +
                    " · " +
                    t("wfSetupSkillsCount").replace("{count}", String(counts.skills))
                  : t("wfSetupPreviewEmpty")}
              </p>
            </div>
            {blueprint ? (
              <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-neutral-400">
                {blueprint.source === "ai" ? t("wfSetupSourceAi") : t("wfSetupSourceTemplate")}
              </span>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {!blueprint ? (
              <div className="grid h-full place-items-center text-center">
                <div className="max-w-[260px] space-y-3">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                    {stage === "drafting" ? (
                      <Loader2 className="size-5 animate-spin text-neutral-400" strokeWidth={1.6} />
                    ) : (
                      <Building2 className="size-5 text-neutral-400" strokeWidth={1.6} />
                    )}
                  </div>
                  <p className="text-[12px] leading-relaxed text-neutral-500">{t("wfSetupPreviewHint")}</p>
                </div>
              </div>
            ) : (
              blueprint.departments.map((dept, deptIndex) => {
                const built = createdTeams.current.has(deptIndex);
                return (
                  <article
                    key={`${dept.name}-${deptIndex}`}
                    className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                        {built ? (
                          <Check className="size-4 text-emerald-300" strokeWidth={2} />
                        ) : (
                          <UsersRound className="size-4 text-neutral-300" strokeWidth={1.6} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[13px] font-medium text-white">{dept.name}</h3>
                        {dept.purpose ? (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{dept.purpose}</p>
                        ) : null}
                      </div>
                      {stage === "review" && !locked ? (
                        <button
                          type="button"
                          onClick={() => removeDepartment(deptIndex)}
                          className="text-neutral-600 hover:text-white"
                          aria-label={t("wfSetupRemoveDept")}
                          title={t("wfSetupRemoveDept")}
                        >
                          <X className="size-3.5" strokeWidth={1.8} />
                        </button>
                      ) : null}
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {dept.companions.map((person, personIndex) => {
                        const done = createdAgents.current.has(`${deptIndex}:${personIndex}`);
                        return (
                          <li
                            key={`${person.name}-${personIndex}`}
                            className="group flex items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/[0.03]"
                            title={person.instructions}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[10px] font-medium uppercase text-neutral-200">
                              {initials(person.name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] text-white">
                                {person.name}
                                <span className="text-neutral-500"> · {person.role}</span>
                              </span>
                              {person.specialty ? (
                                <span className="block truncate text-[11px] text-neutral-500">
                                  {person.specialty}
                                </span>
                              ) : null}
                              {person.skills.length > 0 ? (
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {person.skills.map((skill) => (
                                    <span
                                      key={skill.title}
                                      title={skill.instructions}
                                      className="max-w-[180px] truncate rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-neutral-400"
                                    >
                                      {skill.title}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </span>
                            {done ? (
                              <Check className="size-3.5 text-emerald-300" strokeWidth={2} />
                            ) : stage === "review" && !locked ? (
                              <button
                                type="button"
                                onClick={() => removeCompanion(deptIndex, personIndex)}
                                className="text-neutral-600 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                                aria-label={t("wfSetupRemoveCompanion")}
                                title={t("wfSetupRemoveCompanion")}
                              >
                                <X className="size-3.5" strokeWidth={1.8} />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                );
              })
            )}
          </div>

          <footer className="space-y-3 border-t border-white/[0.07] px-5 py-4">
            {stage === "building" ? (
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span className="min-w-0 truncate">{step || t("wfSetupBuilding")}</span>
                  <span>{percent}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-white transition-all" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              {stage === "done" ? (
                <button
                  type="button"
                  onClick={() => {
                    onComplete(results.current);
                    onClose();
                  }}
                  className="h-10 flex-1 rounded-full bg-white px-4 text-[13px] font-medium text-black"
                >
                  {t("wfSetupOpenWorkforce")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={skip}
                    disabled={stage === "building"}
                    className="h-10 rounded-full border border-white/12 px-4 text-[12px] text-neutral-300 hover:text-white disabled:opacity-40"
                  >
                    {t("wfSetupManual")}
                  </button>
                  {blueprint && stage === "review" && !locked ? (
                    <button
                      type="button"
                      onClick={() => void runDraft(industry, details, true)}
                      className="chat-pro-icon-btn"
                      aria-label={t("wfSetupRedraft")}
                      title={t("wfSetupRedraft")}
                    >
                      <RotateCcw className="size-4" strokeWidth={1.6} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void build()}
                    disabled={!blueprint || counts.departments === 0 || stage !== "review"}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black disabled:opacity-30"
                  >
                    {stage === "building" ? (
                      <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                    ) : null}
                    {locked ? t("wfSetupResume") : t("wfSetupBuild")}
                  </button>
                </>
              )}
            </div>
          </footer>
        </aside>
      </div>
    </div>
  );
}
