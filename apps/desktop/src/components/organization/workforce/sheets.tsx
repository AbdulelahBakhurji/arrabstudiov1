import { type FormEvent, useEffect, useState } from "react";
import type { Agent, Project, Task, TaskPriority, Team } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { Field, Segmented, Sheet } from "./primitives";
import {
  MAX_DEPT_AGENTS,
  PRIORITIES,
  cleanPurpose,
  priorityLabel,
  type WorkforceData,
} from "./use-workforce-data";

function useReset(open: boolean, reset: () => void) {
  useEffect(() => {
    if (open) reset();
  }, [open]);
}

export function HireSheet({
  open,
  onClose,
  data,
  defaultTeamId,
}: {
  open: boolean;
  onClose: () => void;
  data: WorkforceData;
  defaultTeamId?: string;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [teamId, setTeamId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [brief, setBrief] = useState("");
  const [startActive, setStartActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useReset(open, () => {
    setName("");
    setRole("");
    setSpecialty("");
    setTeamId(defaultTeamId ?? "");
    setInstructions("");
    setBrief("");
    setStartActive(true);
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const agent = await data.hire({
      name: name.trim(),
      role: role.trim() || "teammate",
      specialty: specialty.trim() || null,
      instructions: instructions.trim() || null,
      starterBrief: brief.trim() || null,
      teamId: teamId || null,
      status: startActive ? "active" : "draft",
    });
    setBusy(false);
    if (agent) onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("wxHireTitle")}
      sub={t("wxHireSub")}
      footer={
        <>
          <button type="button" className="cc-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" form="wx-hire" className="cc-btn is-primary" disabled={busy || !name.trim()}>
            {busy ? t("wxSaving") : t("wxHireCta")}
          </button>
        </>
      }
    >
      <form id="wx-hire" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t("wxFieldName")}>
          <input className="cc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wxNamePh")} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("wxFieldRole")}>
            <input className="cc-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("wxRolePh")} />
          </Field>
          <Field label={t("wxFieldSpecialty")}>
            <input className="cc-input" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder={t("wxSpecialtyPh")} />
          </Field>
        </div>
        <Field label={t("wxFieldDepartment")}>
          <select className="cc-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">{t("mapUnassigned")}</option>
            {data.departments.map((team) => {
              const seated = data.membersByTeam.get(team.id)?.length ?? 0;
              return (
                <option key={team.id} value={team.id} disabled={seated >= MAX_DEPT_AGENTS}>
                  {team.name} · {seated}/{MAX_DEPT_AGENTS}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label={t("wxFieldInstructions")}>
          <textarea className="cc-textarea" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("wxInstructionsPh")} />
        </Field>
        <Field label={t("wxFieldBrief")}>
          <textarea className="cc-textarea" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("wxBriefPh")} />
        </Field>
        <Field label={t("wxFieldStart")}>
          <Segmented
            label={t("wxFieldStart")}
            value={startActive ? "active" : "draft"}
            onChange={(next) => setStartActive(next === "active")}
            options={[
              { id: "active", label: t("wxStartActive") },
              { id: "draft", label: t("wxStartDraft") },
            ]}
          />
        </Field>
      </form>
    </Sheet>
  );
}

export function EditCompanionSheet({
  agent,
  onClose,
  data,
}: {
  agent: Agent | null;
  onClose: () => void;
  data: WorkforceData;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [instructions, setInstructions] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setRole(agent.role);
    setSpecialty(agent.specialty ?? "");
    setInstructions(agent.instructions ?? "");
    setNote("");
  }, [agent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agent || busy) return;
    setBusy(true);
    const updated = await data.updateAgent(agent.id, {
      name: name.trim() || agent.name,
      role: role.trim() || agent.role,
      specialty: specialty.trim() || null,
      instructions: instructions.trim() || null,
    });
    if (updated && note.trim()) await data.briefAgent(updated, note.trim());
    setBusy(false);
    if (updated) onClose();
  }

  return (
    <Sheet
      open={Boolean(agent)}
      onClose={onClose}
      title={t("wxEditTitle")}
      sub={agent?.name}
      footer={
        <>
          <button type="button" className="cc-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" form="wx-edit" className="cc-btn is-primary" disabled={busy}>
            {busy ? t("wxSaving") : t("wxSave")}
          </button>
        </>
      }
    >
      <form id="wx-edit" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t("wxFieldName")}>
          <input className="cc-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("wxFieldRole")}>
            <input className="cc-input" value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label={t("wxFieldSpecialty")}>
            <input className="cc-input" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </Field>
        </div>
        <Field label={t("wxFieldInstructions")}>
          <textarea className="cc-textarea" rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("wxInstructionsPh")} />
        </Field>
        <Field label={t("wxFieldNote")}>
          <textarea className="cc-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("wxNotePh")} />
        </Field>
      </form>
    </Sheet>
  );
}

export function DepartmentSheet({
  open,
  team,
  onClose,
  data,
  onSaved,
}: {
  open: boolean;
  team: Team | null;
  onClose: () => void;
  data: WorkforceData;
  onSaved?: (team: Team) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  useReset(open, () => {
    setName(team?.name ?? "");
    setPurpose(cleanPurpose(team?.purpose));
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const saved = team
      ? await data.updateDepartment(team, name, purpose)
      : await data.createDepartment(name, purpose);
    setBusy(false);
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={team ? t("wxDeptEditTitle") : t("wxDeptNewTitle")}
      sub={t("wxDeptSub")}
      footer={
        <>
          <button type="button" className="cc-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" form="wx-dept" className="cc-btn is-primary" disabled={busy || !name.trim()}>
            {busy ? t("wxSaving") : team ? t("wxSave") : t("wxDeptCreate")}
          </button>
        </>
      }
    >
      <form id="wx-dept" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t("wxFieldDeptName")}>
          <input className="cc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wxDeptNamePh")} autoFocus />
        </Field>
        <Field label={t("wxFieldMission")}>
          <textarea className="cc-textarea" rows={4} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("wxMissionPh")} />
        </Field>
      </form>
    </Sheet>
  );
}

export function TaskSheet({
  open,
  onClose,
  data,
  projects,
  defaultAssignee,
  defaultTeamId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  data: WorkforceData;
  projects: Project[];
  defaultAssignee?: string;
  defaultTeamId?: string;
  onCreated?: (task: Task) => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  useReset(open, () => {
    setTitle("");
    setBrief("");
    setPriority("medium");
    setAssignee(defaultAssignee ?? "");
    setTeamId(defaultTeamId ?? "");
    setProjectId("");
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const created = await data.createTask({
      title: title.trim(),
      brief: brief.trim() || null,
      priority,
      assigneeAgentId: assignee || null,
      teamId: teamId || null,
      projectId: projectId || null,
      status: assignee ? "assigned" : "backlog",
    });
    setBusy(false);
    if (created) {
      onCreated?.(created);
      onClose();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("wxTaskNewTitle")}
      sub={t("wxTaskNewSub")}
      footer={
        <>
          <button type="button" className="cc-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" form="wx-task" className="cc-btn is-primary" disabled={busy || !title.trim()}>
            {busy ? t("wxSaving") : t("wxTaskCreate")}
          </button>
        </>
      }
    >
      <form id="wx-task" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t("wxFieldTaskTitle")}>
          <input className="cc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("wxTaskTitlePh")} autoFocus />
        </Field>
        <Field label={t("wxFieldTaskBrief")}>
          <textarea className="cc-textarea" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("wxTaskBriefPh")} />
        </Field>
        <Field label={t("wxFieldPriority")}>
          <Segmented
            label={t("wxFieldPriority")}
            value={priority}
            onChange={setPriority}
            options={PRIORITIES.map((id) => ({ id, label: priorityLabel(id, t) }))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("wxFieldOwner")}>
            <select className="cc-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t("unassigned")}</option>
              {data.agents
                .filter((agent) => agent.status !== "archived")
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t("wxFieldDepartment")}>
            <select className="cc-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t("wxAnyDepartment")}</option>
              {data.departments.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {projects.length > 0 ? (
          <Field label={t("wxFieldProject")}>
            <select className="cc-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("none")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </form>
    </Sheet>
  );
}

export function KnowledgeSheet({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: WorkforceData;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);

  useReset(open, () => {
    setTitle("");
    setContent("");
    setProjectId("");
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || busy) return;
    setBusy(true);
    const created = await data.createKnowledge(title.trim(), content.trim(), projectId || null);
    setBusy(false);
    if (created) onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("wxKnowNewTitle")}
      sub={t("wxKnowNewSub")}
      footer={
        <>
          <button type="button" className="cc-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="submit"
            form="wx-know"
            className="cc-btn is-primary"
            disabled={busy || !title.trim() || !content.trim()}
          >
            {busy ? t("wxSaving") : t("wxSave")}
          </button>
        </>
      }
    >
      <form id="wx-know" onSubmit={(e) => void submit(e)} className="grid gap-4">
        <Field label={t("wxFieldDocTitle")}>
          <input className="cc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("wxDocTitlePh")} autoFocus />
        </Field>
        <Field label={t("wxFieldDocContent")}>
          <textarea className="cc-textarea" rows={12} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t("wxDocContentPh")} />
        </Field>
        {data.projects.length > 0 ? (
          <Field label={t("wxFieldScope")}>
            <select className="cc-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("wxScopeOrg")}</option>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </form>
    </Sheet>
  );
}
