import { useEffect, useState } from "react";
import type {
  CompanionDeskView,
  Memory,
  ProfessionalSection,
  ProfessionalWorkspaceView,
  Skill,
} from "@arrab/shared";
import {
  Activity,
  CheckSquare,
  ClipboardList,
  Link2,
  MemoryStick,
  Plug,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { arrabApi } from "@/core/api/api";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { CompanionProfile } from "@/domains/companions/model/companions";

const copy = {
  en: {
    companions: "Companions",
    status: "Status",
    approvals: "Approvals",
    routines: "Routines",
    skills: "Skills",
    memory: "Memory",
    reachability: "Reachability",
    boundaries: "Boundaries",
    audit: "Audit",
    emptyStatus: "No companions on this desk yet.",
    needsYou: "Needs you",
    working: "Working",
    idle: "Idle",
    paused: "Paused",
    pause: "Pause",
    resume: "Resume",
    emptyApprovals: "Nothing waiting for you.",
    approve: "Approve",
    stop: "Stop",
    emptyRoutines: "No standing routines yet.",
    turnOn: "Turn on",
    turnOff: "Pause",
    remove: "Remove",
    addRoutine: "Add routine",
    responsibility: "Responsibilities",
    addResponsibility: "Add responsibility",
    title: "Title",
    instruction: "Instruction",
    emptySkills: "No skills yet — create them in Settings, then grant them here.",
    grant: "Granted",
    revoke: "Revoke",
    emptyMemory: "No memories yet.",
    addMemory: "Add memory",
    memoryPh: "A fact they should keep",
    emptyReach: "No Slack / Teams / SMS bindings yet.",
    addReach: "Bind channel",
    channel: "Channel",
    target: "Target",
    emptyBoundaries: "No boundary rules.",
    addBoundary: "Add rule",
    label: "Label",
    match: "Match",
    tool: "Tool",
    pace: "Pace",
    allow: "Allow",
    ask: "Ask",
    never: "Never",
    emptyAudit: "No actions recorded yet.",
    plugins: "MCP plugins",
    enable: "Enable",
    disable: "Disable",
    grantTo: "Grant to active",
    save: "Save",
    failed: "Could not save that.",
    takeWheel: "Take the wheel",
    releaseWheel: "Hand back",
    controlHint: "While you drive, companion computer actions are refused.",
    activity: "Activity",
    emptyActivity: "Nothing on their screen yet.",
  },
  ar: {
    companions: "الرفاق",
    status: "الحالة",
    approvals: "الموافقات",
    routines: "الروتين",
    skills: "المهارات",
    memory: "الذاكرة",
    reachability: "الوصول",
    boundaries: "الحدود",
    audit: "السجل",
    emptyStatus: "لا رفاق على هذا المكتب بعد.",
    needsYou: "يحتاجك",
    working: "يعمل",
    idle: "خامل",
    paused: "متوقف",
    pause: "إيقاف",
    resume: "استئناف",
    emptyApprovals: "لا شيء ينتظرك.",
    approve: "موافقة",
    stop: "إيقاف",
    emptyRoutines: "لا روتين ثابت بعد.",
    turnOn: "تشغيل",
    turnOff: "إيقاف",
    remove: "حذف",
    addRoutine: "أضف روتين",
    responsibility: "المسؤوليات",
    addResponsibility: "أضف مسؤولية",
    title: "العنوان",
    instruction: "التعليمات",
    emptySkills: "لا مهارات بعد — أنشئها في الإعدادات ثم امنحها هنا.",
    grant: "ممنوح",
    revoke: "سحب",
    emptyMemory: "لا ذكريات بعد.",
    addMemory: "أضف ذاكرة",
    memoryPh: "حقيقة يجب أن يحتفظوا بها",
    emptyReach: "لا ربط لـ Slack أو Teams أو SMS بعد.",
    addReach: "اربط قناة",
    channel: "القناة",
    target: "الهدف",
    emptyBoundaries: "لا قواعد حدود.",
    addBoundary: "أضف قاعدة",
    label: "التسمية",
    match: "المطابقة",
    tool: "الأداة",
    pace: "الإيقاع",
    allow: "سماح",
    ask: "اسأل",
    never: "أبداً",
    emptyAudit: "لا إجراءات مسجّلة بعد.",
    plugins: "إضافات MCP",
    enable: "تفعيل",
    disable: "إيقاف",
    grantTo: "امنح للنشط",
    save: "حفظ",
    failed: "تعذّر الحفظ.",
    takeWheel: "خذ المقود",
    releaseWheel: "أعده",
    controlHint: "أثناء قيادتك تُرفض إجراءات حاسوب الرفيق.",
    activity: "النشاط",
    emptyActivity: "لا شيء على شاشتهم بعد.",
  },
} as const;

const SECTIONS: Array<{
  id: ProfessionalSection;
  icon: typeof Users;
}> = [
  { id: "companions", icon: Users },
  { id: "status", icon: Activity },
  { id: "approvals", icon: CheckSquare },
  { id: "routines", icon: ClipboardList },
  { id: "skills", icon: Sparkles },
  { id: "memory", icon: MemoryStick },
  { id: "reachability", icon: Link2 },
  { id: "boundaries", icon: Shield },
  { id: "audit", icon: Plug },
];

export function useProfessionalWorkspace(enabled: boolean) {
  const [workspace, setWorkspace] = useState<ProfessionalWorkspaceView | null>(null);
  async function reload() {
    try {
      setWorkspace(await arrabApi.professionalWorkspace());
    } catch {
      /* Desk stays usable offline. */
    }
  }
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const id = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return { workspace, reload, setWorkspace };
}

export function ProfessionalHubNav({
  section,
  onSection,
}: {
  section: ProfessionalSection;
  onSection: (next: ProfessionalSection) => void;
}) {
  const { locale } = useLanguage();
  const text = copy[locale];
  return (
    <nav className="pro-hub-nav" aria-label="Professional">
      {SECTIONS.map((entry) => {
        const Icon = entry.icon;
        const label = text[entry.id];
        return (
          <button
            key={entry.id}
            type="button"
            className={section === entry.id ? "is-active" : undefined}
            aria-pressed={section === entry.id}
            onClick={() => onSection(entry.id)}
            title={label}
          >
            <Icon size={15} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function ProfessionalHubPanel({
  section,
  people,
  desk,
  workspace,
  activeCompanion,
  onReloadDesk,
  onReloadWorkspace,
}: {
  section: ProfessionalSection;
  people: CompanionProfile[];
  desk: CompanionDeskView | null;
  workspace: ProfessionalWorkspaceView | null;
  activeCompanion: CompanionProfile | null;
  onReloadDesk: () => void;
  onReloadWorkspace: () => void;
}) {
  const { locale } = useLanguage();
  const text = copy[locale];
  const [error, setError] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [respTitle, setRespTitle] = useState("");
  const [respInstruction, setRespInstruction] = useState("");
  const [boundLabel, setBoundLabel] = useState("");
  const [boundMatch, setBoundMatch] = useState("");
  const [boundTool, setBoundTool] = useState<"shell" | "browser" | "file" | "mcp" | "*">("*");
  const [boundPace, setBoundPace] = useState<"allow" | "ask" | "never">("ask");
  const [reachChannel, setReachChannel] = useState<"slack" | "teams" | "sms">("slack");
  const [reachTarget, setReachTarget] = useState("");
  const [routineTitle, setRoutineTitle] = useState("");

  useEffect(() => {
    if (section !== "skills" && section !== "memory") return;
    void (async () => {
      try {
        if (section === "skills") {
          const res = await arrabApi.skills();
          setSkills(res.items ?? []);
        } else {
          const res = await arrabApi.memories();
          setMemories(res.items ?? []);
        }
      } catch {
        /* offline */
      }
    })();
  }, [section, workspace?.updatedAt]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      onReloadWorkspace();
      onReloadDesk();
    } catch {
      setError(text.failed);
    }
  }

  if (section === "companions") return null;

  return (
    <div className="pro-hub-panel">
      {error ? <p className="pro-hub-error">{error}</p> : null}

      {section === "status" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.status}</h2>
            {activeCompanion ? (
              <button
                type="button"
                className="cp-button"
                onClick={() =>
                  void run(() =>
                    arrabApi.takeProfessionalControl({
                      companionId: activeCompanion.domain || activeCompanion.id,
                      taken: !(
                        workspace?.controlTaken &&
                        workspace.controlCompanionId ===
                          (activeCompanion.domain || activeCompanion.id)
                      ),
                    }),
                  )
                }
              >
                {workspace?.controlTaken &&
                workspace.controlCompanionId === (activeCompanion.domain || activeCompanion.id)
                  ? text.releaseWheel
                  : text.takeWheel}
              </button>
            ) : null}
          </header>
          <p className="pro-hub-hint">{text.controlHint}</p>
          {(workspace?.companionStatus.length ?? 0) === 0 && people.length === 0 ? (
            <p className="pro-hub-empty">{text.emptyStatus}</p>
          ) : (
            <ul className="pro-hub-list">
              {people.map((person) => {
                const row = workspace?.companionStatus.find(
                  (item) => item.companionId === person.domain || item.companionId === person.id,
                );
                const status = row?.paused
                  ? "paused"
                  : row?.status === "needs_you"
                    ? "needs_you"
                    : row?.status === "working"
                      ? "working"
                      : "idle";
                const label =
                  status === "needs_you"
                    ? text.needsYou
                    : status === "working"
                      ? text.working
                      : status === "paused"
                        ? text.paused
                        : text.idle;
                return (
                  <li key={person.id} className="pro-hub-row">
                    <div>
                      <strong>{person.name}</strong>
                      <span data-status={status}>{label}</span>
                      {row?.needsYou ? <p>{row.needsYou}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() =>
                        void run(() =>
                          arrabApi.setProfessionalCompanionStatus({
                            companionId: person.domain || person.id,
                            companionName: person.name,
                            paused: !row?.paused,
                            status: row?.paused ? "idle" : "paused",
                          }),
                        )
                      }
                    >
                      {row?.paused ? text.resume : text.pause}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <h3>{text.activity}</h3>
          {(workspace?.activity.length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyActivity}</p>
          ) : (
            <ul className="pro-hub-list">
              {[...(workspace?.activity ?? [])].reverse().slice(0, 40).map((event) => (
                <li key={event.id} className="pro-hub-row">
                  <div>
                    <strong>{event.title}</strong>
                    <span>{event.kind}</span>
                    {event.output ? <pre>{event.output}</pre> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {section === "approvals" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.approvals}</h2>
          </header>
          {(desk?.jobs.filter((job) => job.status === "needs_you").length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyApprovals}</p>
          ) : (
            <ul className="pro-hub-list">
              {(desk?.jobs ?? [])
                .filter((job) => job.status === "needs_you")
                .map((job) => (
                  <li key={job.id} className="pro-hub-row">
                    <div>
                      <strong>{job.title}</strong>
                      <span>{job.companionName}</span>
                      {job.result ? <p>{job.result}</p> : null}
                    </div>
                    <div className="pro-hub-actions">
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() =>
                          void run(async () => {
                            await arrabApi.approveDeskJob(job.id, {
                              draftHash: job.resultHash ?? undefined,
                            });
                          })
                        }
                      >
                        {text.approve}
                      </button>
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() => void run(() => arrabApi.stopDeskJob(job.id))}
                      >
                        {text.stop}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
          {(workspace?.audit.filter((event) => event.verdict === "pending").length ?? 0) > 0 ? (
            <ul className="pro-hub-list">
              {(workspace?.audit ?? [])
                .filter((event) => event.verdict === "pending")
                .slice(-20)
                .reverse()
                .map((event) => (
                  <li key={event.id} className="pro-hub-row">
                    <div>
                      <strong>{event.action}</strong>
                      <span>
                        {event.companionName} · {event.tool}
                      </span>
                      <p>{event.detail}</p>
                    </div>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {section === "routines" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.routines}</h2>
          </header>
          <form
            className="pro-hub-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!routineTitle.trim()) return;
              void run(async () => {
                await arrabApi.addDeskSchedule({
                  title: routineTitle.trim(),
                  hour: 9,
                  repeat: "weekdays",
                  companionId: activeCompanion?.domain || activeCompanion?.id,
                  companionName: activeCompanion?.name,
                });
                setRoutineTitle("");
              });
            }}
          >
            <input
              value={routineTitle}
              onChange={(event) => setRoutineTitle(event.target.value)}
              placeholder={text.addRoutine}
            />
            <button type="submit" className="cp-button">
              {text.save}
            </button>
          </form>
          {(desk?.schedules.length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyRoutines}</p>
          ) : (
            <ul className="pro-hub-list">
              {(desk?.schedules ?? []).map((schedule) => (
                <li key={schedule.id} className="pro-hub-row">
                  <div>
                    <strong>{schedule.title}</strong>
                    <span>
                      {schedule.companionName} · {schedule.hour}:00 · {schedule.repeat}
                    </span>
                  </div>
                  <div className="pro-hub-actions">
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() =>
                        void run(() => arrabApi.pauseDeskSchedule(schedule.id, !schedule.paused))
                      }
                    >
                      {schedule.paused ? text.turnOn : text.turnOff}
                    </button>
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() => void run(() => arrabApi.removeDeskSchedule(schedule.id))}
                    >
                      {text.remove}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3>{text.responsibility}</h3>
          <form
            className="pro-hub-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!respTitle.trim()) return;
              void run(async () => {
                await arrabApi.upsertProfessionalResponsibility({
                  title: respTitle.trim(),
                  instruction: respInstruction.trim(),
                  companionId: activeCompanion?.domain || activeCompanion?.id,
                  companionName: activeCompanion?.name,
                  scheduleHour: 9,
                });
                setRespTitle("");
                setRespInstruction("");
              });
            }}
          >
            <input
              value={respTitle}
              onChange={(event) => setRespTitle(event.target.value)}
              placeholder={text.title}
            />
            <input
              value={respInstruction}
              onChange={(event) => setRespInstruction(event.target.value)}
              placeholder={text.instruction}
            />
            <button type="submit" className="cp-button">
              {text.addResponsibility}
            </button>
          </form>
          <ul className="pro-hub-list">
            {(workspace?.responsibilities ?? []).map((item) => (
              <li key={item.id} className="pro-hub-row">
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.companionName} · {item.status}
                  </span>
                  {item.instruction ? <p>{item.instruction}</p> : null}
                </div>
                <button
                  type="button"
                  className="cp-button"
                  onClick={() => void run(() => arrabApi.removeProfessionalResponsibility(item.id))}
                >
                  {text.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === "skills" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.skills}</h2>
          </header>
          {skills.length === 0 ? (
            <p className="pro-hub-empty">{text.emptySkills}</p>
          ) : (
            <ul className="pro-hub-list">
              {skills.map((skill) => {
                const companionId = activeCompanion?.domain || activeCompanion?.id || "";
                const grant = workspace?.skillGrants.find(
                  (item) => item.skillId === skill.id && item.companionId === companionId,
                );
                return (
                  <li key={skill.id} className="pro-hub-row">
                    <div>
                      <strong>{skill.title}</strong>
                      {skill.instructions ? <p>{skill.instructions}</p> : null}
                    </div>
                    {companionId ? (
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() =>
                          void run(() =>
                            arrabApi.setProfessionalSkillGrant({
                              skillId: skill.id,
                              companionId,
                              enabled: !grant?.enabled,
                            }),
                          )
                        }
                      >
                        {grant?.enabled ? text.revoke : text.grant}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <h3>{text.plugins}</h3>
          <ul className="pro-hub-list">
            {(workspace?.plugins ?? []).map((plugin) => {
              const companionId = activeCompanion?.domain || activeCompanion?.id || "";
              const granted = companionId
                ? plugin.grantedCompanionIds.includes(companionId)
                : false;
              return (
                <li key={plugin.id} className="pro-hub-row">
                  <div>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.key}</span>
                  </div>
                  <div className="pro-hub-actions">
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() =>
                        void run(() =>
                          arrabApi.upsertProfessionalPlugin({
                            id: plugin.id,
                            key: plugin.key,
                            name: plugin.name,
                            kind: plugin.kind,
                            url: plugin.url,
                            enabled: !plugin.enabled,
                            grantedCompanionIds: plugin.grantedCompanionIds,
                          }),
                        )
                      }
                    >
                      {plugin.enabled ? text.disable : text.enable}
                    </button>
                    {companionId ? (
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() =>
                          void run(() =>
                            arrabApi.upsertProfessionalPlugin({
                              id: plugin.id,
                              key: plugin.key,
                              name: plugin.name,
                              kind: plugin.kind,
                              url: plugin.url,
                              enabled: plugin.enabled,
                              grantedCompanionIds: granted
                                ? plugin.grantedCompanionIds.filter((id) => id !== companionId)
                                : [...plugin.grantedCompanionIds, companionId],
                            }),
                          )
                        }
                      >
                        {text.grantTo}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {section === "memory" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.memory}</h2>
          </header>
          <form
            className="pro-hub-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!memoryDraft.trim()) return;
              void run(async () => {
                await arrabApi.createMemory({ content: memoryDraft.trim() });
                setMemoryDraft("");
                const res = await arrabApi.memories();
                setMemories(res.items ?? []);
              });
            }}
          >
            <input
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder={text.memoryPh}
            />
            <button type="submit" className="cp-button">
              {text.addMemory}
            </button>
          </form>
          {memories.length === 0 ? (
            <p className="pro-hub-empty">{text.emptyMemory}</p>
          ) : (
            <ul className="pro-hub-list">
              {memories.slice(0, 50).map((memory) => (
                <li key={memory.id} className="pro-hub-row">
                  <div>
                    <p>{memory.content}</p>
                  </div>
                  <button
                    type="button"
                    className="cp-button"
                    onClick={() =>
                      void run(async () => {
                        await arrabApi.deleteMemory(memory.id);
                        setMemories((current) => current.filter((item) => item.id !== memory.id));
                      })
                    }
                  >
                    {text.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {section === "reachability" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.reachability}</h2>
          </header>
          <form
            className="pro-hub-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reachTarget.trim()) return;
              void run(async () => {
                await arrabApi.upsertProfessionalReachability({
                  channel: reachChannel,
                  target: reachTarget.trim(),
                  companionId: activeCompanion?.domain || activeCompanion?.id,
                  companionName: activeCompanion?.name,
                });
                setReachTarget("");
              });
            }}
          >
            <select
              value={reachChannel}
              onChange={(event) =>
                setReachChannel(event.target.value as "slack" | "teams" | "sms")
              }
              aria-label={text.channel}
            >
              <option value="slack">Slack</option>
              <option value="teams">Teams</option>
              <option value="sms">SMS</option>
            </select>
            <input
              value={reachTarget}
              onChange={(event) => setReachTarget(event.target.value)}
              placeholder={text.target}
            />
            <button type="submit" className="cp-button">
              {text.addReach}
            </button>
          </form>
          {(workspace?.reachability.length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyReach}</p>
          ) : (
            <ul className="pro-hub-list">
              {(workspace?.reachability ?? []).map((item) => (
                <li key={item.id} className="pro-hub-row">
                  <div>
                    <strong>{item.channel}</strong>
                    <span>
                      {item.companionName} · {item.target}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cp-button"
                    onClick={() => void run(() => arrabApi.removeProfessionalReachability(item.id))}
                  >
                    {text.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {section === "boundaries" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.boundaries}</h2>
          </header>
          <form
            className="pro-hub-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!boundLabel.trim()) return;
              void run(async () => {
                await arrabApi.upsertProfessionalBoundary({
                  label: boundLabel.trim(),
                  match: boundMatch.trim(),
                  tool: boundTool,
                  pace: boundPace,
                });
                setBoundLabel("");
                setBoundMatch("");
              });
            }}
          >
            <input
              value={boundLabel}
              onChange={(event) => setBoundLabel(event.target.value)}
              placeholder={text.label}
            />
            <input
              value={boundMatch}
              onChange={(event) => setBoundMatch(event.target.value)}
              placeholder={text.match}
            />
            <select
              value={boundTool}
              onChange={(event) =>
                setBoundTool(event.target.value as typeof boundTool)
              }
              aria-label={text.tool}
            >
              <option value="*">*</option>
              <option value="shell">shell</option>
              <option value="browser">browser</option>
              <option value="file">file</option>
              <option value="mcp">mcp</option>
            </select>
            <select
              value={boundPace}
              onChange={(event) =>
                setBoundPace(event.target.value as typeof boundPace)
              }
              aria-label={text.pace}
            >
              <option value="allow">{text.allow}</option>
              <option value="ask">{text.ask}</option>
              <option value="never">{text.never}</option>
            </select>
            <button type="submit" className="cp-button">
              {text.addBoundary}
            </button>
          </form>
          {(workspace?.boundaries.length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyBoundaries}</p>
          ) : (
            <ul className="pro-hub-list">
              {(workspace?.boundaries ?? []).map((rule) => (
                <li key={rule.id} className="pro-hub-row">
                  <div>
                    <strong>{rule.label}</strong>
                    <span>
                      {rule.tool} · {rule.pace}
                      {rule.match ? ` · ${rule.match}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cp-button"
                    onClick={() => void run(() => arrabApi.removeProfessionalBoundary(rule.id))}
                  >
                    {text.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {section === "audit" ? (
        <section className="pro-hub-section">
          <header className="pro-hub-head">
            <h2>{text.audit}</h2>
          </header>
          {(workspace?.audit.length ?? 0) === 0 ? (
            <p className="pro-hub-empty">{text.emptyAudit}</p>
          ) : (
            <ul className="pro-hub-list">
              {[...(workspace?.audit ?? [])].reverse().slice(0, 80).map((event) => (
                <li key={event.id} className="pro-hub-row">
                  <div>
                    <strong>{event.action}</strong>
                    <span data-verdict={event.verdict}>
                      {event.verdict} · {event.tool} · {event.companionName} · {event.initiator}
                    </span>
                    {event.detail ? <p>{event.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
