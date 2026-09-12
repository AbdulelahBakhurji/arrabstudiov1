import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Brain,
  Briefcase,
  ClipboardList,
  GraduationCap,
  Laptop,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import type {
  Agent,
  AgentStatus,
  Knowledge,
  Memory,
  Project,
  ProjectRepoBinding,
  Skill,
  Task,
  Team,
  TeamMembership,
} from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { LAST_COWORK_AGENT_KEY } from "@/lib/prefs";
import { cn } from "@/lib/utils";

type DeskTab = "overview" | "profile" | "data" | "skills" | "team" | "work";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function EmployeeDeskPage() {
  const { agentId = "" } = useParams();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [binding, setBinding] = useState<ProjectRepoBinding | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<DeskTab>("overview");

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [bio, setBio] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<AgentStatus>("active");

  const [memoryDraft, setMemoryDraft] = useState("");
  const [skillTitle, setSkillTitle] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [joinTeamId, setJoinTeamId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskBrief, setTaskBrief] = useState("");

  const load = useCallback(async () => {
    if (!agentId) return;
    setError(null);
    try {
      const [
        agentsRes,
        projectsRes,
        teamsRes,
        membersRes,
        taskList,
        bindings,
        skillList,
        memoryList,
        knowList,
      ] = await Promise.all([
        arrabApi.agents(),
        arrabApi.projects(),
        arrabApi.teams(),
        arrabApi.memberships(),
        arrabApi.tasks(),
        arrabApi.bindings(),
        arrabApi.skills(agentId),
        arrabApi.memories(),
        arrabApi.knowledge(),
      ]);
      const found = agentsRes.items.find((item) => item.id === agentId) ?? null;
      setAgent(found);
      setName(found?.name ?? "");
      setRole(found?.role ?? "");
      setSpecialty(found?.specialty ?? "");
      setBio(found?.bio ?? "");
      setInstructions(found?.instructions ?? "");
      setProjectId(found?.projectId ?? "");
      setStatus(found?.status ?? "active");
      setProjects(projectsRes.items.filter((item) => item.status === "active"));
      setTeams(teamsRes.items);
      setMemberships(membersRes.items);
      setBinding(bindings.items.find((item) => item.projectId === found?.projectId) ?? null);
      setTasks(taskList.items.filter((task) => task.assigneeAgentId === agentId));
      setSkills(skillList.items);
      setMemories(memoryList.items.filter((memory) => memory.agentId === agentId));
      setKnowledge(knowList.items);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }, [agentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentTeams = useMemo(() => {
    const ids = new Set(
      memberships.filter((item) => item.agentId === agentId).map((item) => item.teamId),
    );
    return teams.filter((team) => ids.has(team.id));
  }, [agentId, memberships, teams]);

  const availableTeams = useMemo(() => {
    const joined = new Set(agentTeams.map((team) => team.id));
    return teams.filter((team) => !joined.has(team.id));
  }, [agentTeams, teams]);

  const project = useMemo(
    () => projects.find((item) => item.id === (projectId || agent?.projectId)) ?? null,
    [agent?.projectId, projectId, projects],
  );

  const tabs: Array<{ id: DeskTab; label: string; icon: typeof Briefcase }> = [
    { id: "overview", label: t("deskTabOverview"), icon: Briefcase },
    { id: "profile", label: t("deskTabProfile"), icon: GraduationCap },
    { id: "data", label: t("deskTabData"), icon: Brain },
    { id: "skills", label: t("deskTabSkills"), icon: GraduationCap },
    { id: "team", label: t("deskTabTeam"), icon: UsersRound },
    { id: "work", label: t("deskTabWork"), icon: ClipboardList },
  ];

  async function saveProfile(event?: FormEvent) {
    event?.preventDefault();
    if (!agent || !name.trim() || !role.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await arrabApi.updateAgent(agent.id, {
        name: name.trim(),
        role: role.trim(),
        specialty: specialty.trim() || null,
        bio: bio.trim() || null,
        instructions: instructions.trim() || null,
        projectId: projectId || null,
        status,
      });
      setAgent(updated);
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function addMemory(event: FormEvent) {
    event.preventDefault();
    if (!agent || !memoryDraft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await arrabApi.createMemory({
        content: memoryDraft.trim(),
        agentId: agent.id,
        projectId: agent.projectId,
      });
      setMemoryDraft("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function removeMemory(id: string) {
    try {
      await arrabApi.deleteMemory(id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function addSkill(event: FormEvent) {
    event.preventDefault();
    if (!agent || !skillTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await arrabApi.createSkill({
        agentId: agent.id,
        title: skillTitle.trim(),
        instructions: skillInstructions.trim() || skillTitle.trim(),
        createTask: false,
      });
      setSkillTitle("");
      setSkillInstructions("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function removeSkill(id: string) {
    try {
      await arrabApi.deleteSkill(id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function joinTeam(event: FormEvent) {
    event.preventDefault();
    if (!agent || !joinTeamId) return;
    setSaving(true);
    setError(null);
    try {
      await arrabApi.addTeamMember(joinTeamId, { agentId: agent.id });
      setJoinTeamId("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function leaveTeam(teamId: string) {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      await arrabApi.removeTeamMember(teamId, agent.id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  async function assignTask(event: FormEvent) {
    event.preventDefault();
    if (!agent || !taskTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await arrabApi.createTask({
        title: taskTitle.trim(),
        brief: taskBrief.trim() || null,
        priority: "medium",
        assigneeAgentId: agent.id,
        projectId: agent.projectId,
        teamId: agentTeams[0]?.id ?? null,
      });
      setTaskTitle("");
      setTaskBrief("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  function openSoloChat() {
    if (!agent) return;
    sessionStorage.setItem("arrab.chatAgent", agent.id);
    navigate("/chat");
  }

  function openCowork() {
    if (!agent) return;
    try {
      localStorage.setItem(LAST_COWORK_AGENT_KEY, agent.id);
    } catch {
      // ignore
    }
    sessionStorage.setItem("arrab.chatAgent", agent.id);
    navigate("/cowork");
  }

  function openTeamChat(teamId: string) {
    sessionStorage.setItem("arrab.chatTeam", teamId);
    navigate("/chat");
  }

  if (!agentId) {
    return (
      <Surface className="flex items-center justify-center">
        <p className="text-sm text-neutral-500">{t("deskMissingEmployee")}</p>
      </Surface>
    );
  }

  return (
    <Surface className="desk-shell chat-comfy flex h-full flex-col overflow-hidden">
      <div className="workforce-atmosphere pointer-events-none absolute inset-0" />
      <div className="desk-atmosphere pointer-events-none absolute inset-0 opacity-70" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3 lg:px-6">
          <Link
            to="/workforce"
            className="chat-pro-icon-btn"
            aria-label={t("backToHq")}
            title={t("backToHq")}
          >
            <ArrowLeft className="size-4" strokeWidth={1.6} />
          </Link>
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-2xl border text-[12px] font-medium",
              agent?.status === "active"
                ? "border-white/25 bg-white text-black"
                : "border-white/10 bg-white/[0.04] text-neutral-300",
            )}
          >
            {agent ? initials(agent.name) : "—"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[15px] font-medium tracking-[-0.03em] text-white">
                {agent?.name ?? t("loading")}
              </h1>
              {agent ? (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-400">
                  {agent.status}
                </span>
              ) : null}
            </div>
            <p className="truncate text-[11px] text-neutral-500">
              {role || agent?.role || "—"}
              {specialty || agent?.specialty ? ` · ${specialty || agent?.specialty}` : ""}
              {project ? ` · ${project.name}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => void load()} className="chat-pro-icon-btn" title={t("refresh")}>
              <RefreshCw className="size-4" strokeWidth={1.6} />
            </button>
            <button type="button" onClick={openSoloChat} className="chat-pro-icon-btn" title={t("deskSoloChat")}>
              <MessageSquare className="size-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={openCowork}
              className="ms-1 hidden h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-black sm:inline-flex"
            >
              <Laptop className="size-3.5" />
              {t("hqOpenCowork")}
            </button>
          </div>
        </header>

        {error ? (
          <div className="mx-4 mt-3 rounded-2xl border border-white/12 bg-white/[0.03] px-3 py-2 text-[13px] text-neutral-300 lg:mx-6">
            {error}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav className="hidden w-[160px] shrink-0 flex-col gap-0.5 border-e border-white/[0.06] bg-[#050505] px-2 py-3 lg:flex">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] transition-colors",
                  tab === item.id
                    ? "bg-white/[0.08] text-white"
                    : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200",
                )}
              >
                <item.icon className="size-3.5" strokeWidth={1.7} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2 lg:hidden">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-[11px]",
                    tab === item.id ? "bg-white text-black" : "text-neutral-400",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
              {tab === "overview" ? (
                <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <section className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-5">
                    <p className="chat-pro-kicker">{t("employeeDesk")}</p>
                    <h2 className="mt-2 text-2xl font-medium tracking-[-0.03em] text-white">
                      {agent?.name}
                    </h2>
                    <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-neutral-400">
                      {bio || agent?.bio || t("deskOverviewHint")}
                    </p>
                    <div className="mt-5 grid gap-2 sm:grid-cols-3">
                      <Stat label={t("deskTabSkills")} value={skills.length} />
                      <Stat label={t("deskTabData")} value={memories.length} />
                      <Stat label={t("deskTabWork")} value={tasks.length} />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button type="button" onClick={openSoloChat} className="chat-pro-cta !h-9 !px-4 !text-[12px]">
                        <MessageSquare className="size-3.5" />
                        {t("deskSoloChat")}
                      </button>
                      <button
                        type="button"
                        onClick={openCowork}
                        className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                      >
                        {t("hqOpenCowork")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("profile")}
                        className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-200"
                      >
                        {t("editProfile")}
                      </button>
                    </div>
                  </section>
                  <section className="space-y-3">
                    <Card title={t("deskPosition")}>
                      <p className="text-[13px] text-white">{role || agent?.role}</p>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        {specialty || agent?.specialty || t("none")}
                      </p>
                      <p className="mt-3 text-[11px] text-neutral-500">
                        {t("colProject")}: {project?.name ?? t("none")}
                        {binding?.repoFullName ? ` · ${binding.repoFullName}` : ""}
                      </p>
                    </Card>
                    <Card title={t("deskTabTeam")}>
                      {agentTeams.length === 0 ? (
                        <p className="text-[12px] text-neutral-600">{t("deskNoTeams")}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {agentTeams.map((team) => (
                            <li key={team.id} className="flex items-center justify-between gap-2">
                              <span className="text-[13px] text-neutral-200">{team.name}</span>
                              <button
                                type="button"
                                onClick={() => openTeamChat(team.id)}
                                className="text-[10px] text-neutral-400 hover:text-white"
                              >
                                {t("talkToTeam")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                    <Card title={t("standingInstructions")}>
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-400">
                        {instructions || agent?.instructions || t("deskNoInstructions")}
                      </p>
                    </Card>
                  </section>
                </div>
              ) : null}

              {tab === "profile" ? (
                <form
                  onSubmit={(event) => void saveProfile(event)}
                  className="mx-auto max-w-2xl space-y-4 rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-5"
                >
                  <div>
                    <p className="chat-pro-kicker">{t("deskTabProfile")}</p>
                    <p className="mt-1 text-[12px] text-neutral-500">{t("editProfileBody")}</p>
                  </div>
                  <Field label={t("employeeName")}>
                    <input value={name} onChange={(e) => setName(e.target.value)} className="field" required />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("employeeRole")}>
                      <input value={role} onChange={(e) => setRole(e.target.value)} className="field" required />
                    </Field>
                    <Field label={t("employeeSpecialty")}>
                      <input
                        value={specialty}
                        onChange={(e) => setSpecialty(e.target.value)}
                        className="field"
                        placeholder={t("hireSpecialtyPlaceholder")}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("colProject")}>
                      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="field">
                        <option value="">{t("none")}</option>
                        {projects.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("status")}>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as AgentStatus)}
                        className="field"
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="archived">archived</option>
                      </select>
                    </Field>
                  </div>
                  <Field label={t("employeeBio")}>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      className="field field-bio"
                      placeholder={t("hireBioPlaceholder")}
                    />
                  </Field>
                  <Field label={t("employeeInstructions")}>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      rows={6}
                      className="field field-instructions"
                      placeholder={t("hireInstructionsPlaceholder")}
                    />
                  </Field>
                  <button
                    type="submit"
                    disabled={saving}
                    className="chat-pro-cta !h-9 !px-4 !text-[12px] disabled:opacity-40"
                  >
                    <Save className="size-3.5" />
                    {saving ? t("saving") : t("saveProfile")}
                  </button>
                </form>
              ) : null}

              {tab === "data" ? (
                <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2">
                  <section className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4">
                    <p className="chat-pro-kicker">{t("tellAgent")}</p>
                    <form onSubmit={(event) => void addMemory(event)} className="mt-3 space-y-2">
                      <textarea
                        value={memoryDraft}
                        onChange={(e) => setMemoryDraft(e.target.value)}
                        rows={3}
                        placeholder={t("tellAgentPlaceholder")}
                        className="field"
                      />
                      <button
                        type="submit"
                        disabled={saving || !memoryDraft.trim()}
                        className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                      >
                        <Plus className="size-3.5" />
                        {t("saveToMemory")}
                      </button>
                    </form>
                    <ul className="mt-4 max-h-[420px] space-y-2 overflow-y-auto">
                      {memories.length === 0 ? (
                        <li className="text-[12px] text-neutral-600">{t("deskNoMemories")}</li>
                      ) : (
                        memories.map((memory) => (
                          <li
                            key={memory.id}
                            className="flex items-start justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
                          >
                            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-300">
                              {memory.content}
                            </p>
                            <button
                              type="button"
                              onClick={() => void removeMemory(memory.id)}
                              className="shrink-0 text-neutral-500 hover:text-white"
                              aria-label={t("delete")}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4">
                    <p className="chat-pro-kicker">{t("knowledge")}</p>
                    <p className="mt-1 text-[12px] text-neutral-500">{t("deskKnowledgeHint")}</p>
                    <ul className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">
                      {knowledge.length === 0 ? (
                        <li className="text-[12px] text-neutral-600">{t("noKnowledge")}</li>
                      ) : (
                        knowledge.slice(0, 40).map((item) => (
                          <li key={item.id} className="rounded-xl bg-white/[0.03] px-3 py-2">
                            <p className="text-[13px] text-white">{item.title}</p>
                            <p className="mt-1 line-clamp-3 text-[11px] text-neutral-500">{item.content}</p>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                </div>
              ) : null}

              {tab === "skills" ? (
                <div className="mx-auto max-w-2xl space-y-4">
                  <form
                    onSubmit={(event) => void addSkill(event)}
                    className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4"
                  >
                    <p className="chat-pro-kicker">{t("taughtSkills")}</p>
                    <p className="mt-1 text-[12px] text-neutral-500">{t("teachSkillBody")}</p>
                    <div className="mt-3 space-y-2">
                      <input
                        value={skillTitle}
                        onChange={(e) => setSkillTitle(e.target.value)}
                        placeholder={t("skillTitle")}
                        className="field"
                      />
                      <textarea
                        value={skillInstructions}
                        onChange={(e) => setSkillInstructions(e.target.value)}
                        rows={3}
                        placeholder={t("skillInstructionsPlaceholder")}
                        className="field"
                      />
                      <button
                        type="submit"
                        disabled={saving || !skillTitle.trim()}
                        className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                      >
                        {t("saveTaughtSkill")}
                      </button>
                    </div>
                  </form>
                  <ul className="space-y-2">
                    {skills.length === 0 ? (
                      <li className="text-[12px] text-neutral-600">{t("noSkillsYet")}</li>
                    ) : (
                      skills.map((skill) => (
                        <li
                          key={skill.id}
                          className="rounded-[18px] border border-white/[0.07] bg-[#060606]/0.9] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[13px] text-white">{skill.title}</p>
                              <p className="mt-1 whitespace-pre-wrap text-[12px] text-neutral-500">
                                {skill.instructions}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void removeSkill(skill.id)}
                              className="text-neutral-500 hover:text-white"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}

              {tab === "team" ? (
                <div className="mx-auto max-w-2xl space-y-4">
                  <section className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4">
                    <p className="chat-pro-kicker">{t("deskCurrentTeams")}</p>
                    <ul className="mt-3 space-y-2">
                      {agentTeams.length === 0 ? (
                        <li className="text-[12px] text-neutral-600">{t("deskNoTeams")}</li>
                      ) : (
                        agentTeams.map((team) => (
                          <li
                            key={team.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5"
                          >
                            <div>
                              <p className="text-[13px] text-white">{team.name}</p>
                              <p className="text-[11px] text-neutral-500">{team.purpose || t("none")}</p>
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => openTeamChat(team.id)}
                                className="rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                              >
                                {t("talkToTeam")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void leaveTeam(team.id)}
                                className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-neutral-300"
                              >
                                {t("deskLeaveTeam")}
                              </button>
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <form
                    onSubmit={(event) => void joinTeam(event)}
                    className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4"
                  >
                    <p className="chat-pro-kicker">{t("deskAssignTeam")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <select
                        value={joinTeamId}
                        onChange={(e) => setJoinTeamId(e.target.value)}
                        className="field min-w-[200px] flex-1"
                      >
                        <option value="">{t("assignTeam")}</option>
                        {availableTeams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={saving || !joinTeamId}
                        className="chat-pro-cta !h-9 !px-4 !text-[12px] disabled:opacity-40"
                      >
                        {t("deskJoinTeam")}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}

              {tab === "work" ? (
                <div className="mx-auto max-w-3xl space-y-4">
                  <form
                    onSubmit={(event) => void assignTask(event)}
                    className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4"
                  >
                    <p className="chat-pro-kicker">{t("assignTask")}</p>
                    <div className="mt-3 space-y-2">
                      <input
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder={t("taskTitle")}
                        className="field"
                      />
                      <textarea
                        value={taskBrief}
                        onChange={(e) => setTaskBrief(e.target.value)}
                        rows={2}
                        placeholder={t("taskBrief")}
                        className="field"
                      />
                      <button
                        type="submit"
                        disabled={saving || !taskTitle.trim()}
                        className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                      >
                        {t("assignTask")}
                      </button>
                    </div>
                  </form>
                  <ul className="space-y-2">
                    {tasks.length === 0 ? (
                      <li className="text-[12px] text-neutral-600">{t("deskNoTasks")}</li>
                    ) : (
                      tasks.map((task) => (
                        <li
                          key={task.id}
                          className="rounded-[18px] border border-white/[0.07] bg-[#060606]/0.9] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[13px] text-white">{task.title}</p>
                              <p className="mt-1 text-[11px] text-neutral-500">
                                {task.status} · {task.priority}
                              </p>
                              {task.brief ? (
                                <p className="mt-2 text-[12px] text-neutral-400">{task.brief}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                sessionStorage.setItem("arrab.chatAgent", agentId);
                                sessionStorage.setItem(
                                  "arrab.chatTask",
                                  JSON.stringify({
                                    id: task.id,
                                    title: task.title,
                                    brief: task.brief,
                                  }),
                                );
                                navigate("/chat");
                              }}
                              className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-neutral-300"
                            >
                              {t("openChat")}
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] px-3 py-3">
      <p className="chat-pro-kicker">{label}</p>
      <p className="mt-1 text-xl text-white">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-[#060606]/0.9] p-4">
      <p className="chat-pro-kicker">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
