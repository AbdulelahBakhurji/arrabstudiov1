import {
  Archive,
  ArrowRightLeft,
  ClipboardPlus,
  Laptop,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import type { Agent, Team } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { OrgSeatCapabilities } from "@/lib/org-seat";
import { Avatar, Menu, StatusDot, type MenuEntry } from "./primitives";
import type { WorkforceData } from "./use-workforce-data";

export type WorkforceActions = {
  openHire: (teamId?: string) => void;
  openEdit: (agent: Agent) => void;
  openTask: (opts?: { assignee?: string; teamId?: string }) => void;
  openDept: (team: Team | null) => void;
  goDepartment: (teamId: string) => void;
  goTab: (tab: "overview" | "departments" | "tasks" | "knowledge" | "map" | "reports" | "seats") => void;
  openSetup: () => void;
  chat: (agentId: string) => void;
  desk: (agentId: string) => void;
  workplace: (agentId: string) => void;
  teamRoom: (teamId: string) => void;
};

export function CompanionRow({
  agent,
  data,
  caps,
  actions,
  showDepartment = true,
}: {
  agent: Agent;
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  actions: WorkforceActions;
  showDepartment?: boolean;
}) {
  const { t } = useLanguage();
  const dept = data.departmentOf.get(agent.id) ?? null;
  const openCount = data.openTasks.filter((task) => task.assigneeAgentId === agent.id).length;
  const sub = [agent.specialty || agent.role, showDepartment ? dept?.name ?? t("mapUnassigned") : null]
    .filter(Boolean)
    .join(" · ");

  const entries: MenuEntry[] = [
    { kind: "item", label: t("hqOpenCowork"), icon: Laptop, onSelect: () => actions.workplace(agent.id) },
  ];
  if (caps.canAssignWork) {
    entries.push({
      kind: "item",
      label: t("wxAssignTask"),
      icon: ClipboardPlus,
      onSelect: () => actions.openTask({ assignee: agent.id, teamId: dept?.id }),
    });
  }
  if (caps.canHireAgents) {
    entries.push({ kind: "item", label: t("wxEditCompanion"), icon: Pencil, onSelect: () => actions.openEdit(agent) });
    if (agent.status === "active") {
      entries.push({ kind: "item", label: t("wxPause"), icon: Pause, onSelect: () => void data.setAgentStatus(agent.id, "paused") });
    } else if (agent.status === "paused") {
      entries.push({ kind: "item", label: t("wxResume"), icon: Play, onSelect: () => void data.setAgentStatus(agent.id, "active") });
    }
    if (data.departments.length > 0) {
      entries.push({ kind: "sep" }, { kind: "label", label: t("wxMoveTo") });
      for (const team of data.departments) {
        entries.push({
          kind: "item",
          label: team.name,
          icon: ArrowRightLeft,
          disabled: dept?.id === team.id,
          onSelect: () => void data.moveAgent(agent.id, team.id),
        });
      }
      if (dept) {
        entries.push({
          kind: "item",
          label: t("mapUnassigned"),
          icon: ArrowRightLeft,
          onSelect: () => void data.moveAgent(agent.id, null),
        });
      }
    }
    entries.push(
      { kind: "sep" },
      {
        kind: "item",
        label: t("wxArchive"),
        icon: Archive,
        onSelect: () => void data.removeAgent(agent.id, "archive"),
      },
      {
        kind: "item",
        label: t("wxDelete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (window.confirm(t("wxDeleteConfirm").replace("{name}", agent.name))) {
            void data.removeAgent(agent.id, "delete");
          }
        },
      },
    );
  }

  return (
    <div className="cc-row">
      <Avatar name={agent.name} />
      <button type="button" className="cc-row-main text-start" onClick={() => actions.desk(agent.id)}>
        <p className="cc-row-title flex items-center gap-2">
          <span className="truncate">{agent.name}</span>
          <StatusDot status={agent.status} />
          {agent.status === "draft" ? <span className="cc-chip">{t("wxDraft")}</span> : null}
          {agent.status === "paused" ? <span className="cc-chip is-high">{t("wxPaused")}</span> : null}
        </p>
        <p className="cc-row-sub">{sub}</p>
      </button>
      {openCount > 0 ? (
        <span className="cc-chip hidden sm:inline-flex" title={t("openTasks")}>
          {openCount} {t("wxOpenShort")}
        </span>
      ) : null}
      <div className="cc-row-actions">
        {agent.status === "draft" && caps.canHireAgents ? (
          <button type="button" className="cc-btn is-sm is-primary" onClick={() => void data.activateAgent(agent, false)}>
            {t("wxActivate")}
          </button>
        ) : (
          <button
            type="button"
            className="cc-icon-btn"
            onClick={() => actions.chat(agent.id)}
            aria-label={t("deskSoloChat")}
            title={t("deskSoloChat")}
          >
            <MessageSquare className="size-[15px]" strokeWidth={1.7} />
          </button>
        )}
        <button
          type="button"
          className="cc-icon-btn"
          onClick={() => actions.desk(agent.id)}
          aria-label={t("hqManageAgent")}
          title={t("hqManageAgent")}
        >
          <Monitor className="size-[15px]" strokeWidth={1.7} />
        </button>
        <Menu label={t("wxMore")} trigger={<MoreHorizontal className="size-4" strokeWidth={1.7} />} entries={entries} />
      </div>
    </div>
  );
}
