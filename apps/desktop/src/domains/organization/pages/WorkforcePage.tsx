import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardPlus, Loader2, Sparkles, UserPlus, UsersRound } from "lucide-react";
import type { Agent, Team } from "@arrab/shared";
import { Surface } from "@/shared/ui/Surface";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { canShowLiveMap } from "@/domains/organization/live-map-gate";
import { LiveOfficeMap } from "@/domains/organization/ui/LiveOfficeMap";
import { OrgAdministrationPanel } from "@/domains/organization/ui/OrgAdministrationPanel";
import {
  WorkforceSetupWizard,
  readWorkforceSetupState,
  type WorkforceSetupResult,
} from "@/domains/organization/ui/WorkforceSetupWizard";
import type { WorkforceActions } from "@/domains/organization/ui/workforce/companion-row";
import { WorkforceDepartments } from "@/domains/organization/ui/workforce/departments";
import { WorkforceKnowledge } from "@/domains/organization/ui/workforce/knowledge";
import { WorkforceOverview } from "@/domains/organization/ui/workforce/overview";
import { WorkforceReports } from "@/domains/organization/ui/workforce/reports";
import {
  DepartmentSheet,
  EditCompanionSheet,
  HireSheet,
  KnowledgeSheet,
  TaskSheet,
} from "@/domains/organization/ui/workforce/sheets";
import { WorkforceTasks } from "@/domains/organization/ui/workforce/tasks";
import {
  OPEN_HIRE_FLAG,
  OPEN_SETUP_FLAG,
  openAgentChat,
  openAgentDesk,
  openAgentWorkplace,
  openTeamChat,
  useWorkforceData,
} from "@/domains/organization/ui/workforce/use-workforce-data";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { MessageKey } from "@/shared/i18n/messages";
import { useOrgSeatCapabilities } from "@/domains/organization/org-seat";
import { cn } from "@/shared/lib/utils";
import { ROLE_PATH } from "@/domains/account/roles/catalog";
import { useRole } from "@/domains/account/roles/RoleProvider";

type Tab = "overview" | "departments" | "tasks" | "knowledge" | "map" | "reports" | "seats";

const TAB_KEY = "arrab.workforce.tab";
const META_KEY = "arrab.workforce.teamMeta";

function readTab(): Tab {
  const saved = sessionStorage.getItem(TAB_KEY);
  return saved === "departments" ||
    saved === "tasks" ||
    saved === "knowledge" ||
    saved === "map" ||
    saved === "reports" ||
    saved === "seats"
    ? saved
    : "overview";
}

export function WorkforcePage() {
  const { t } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const caps = useOrgSeatCapabilities();
  const { account } = useSignedInAccount();
  const data = useWorkforceData();
  const liveMap = canShowLiveMap({
    seatAllows: caps.canOpenLiveMap,
    planId: account?.planId ?? null,
    development: import.meta.env.DEV,
  });

  const [tab, setTabState] = useState<Tab>(readTab);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const setupChecked = useRef(false);
  const [hire, setHire] = useState<{ open: boolean; teamId?: string }>({ open: false });
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [taskSheet, setTaskSheet] = useState<{ open: boolean; assignee?: string; teamId?: string }>({ open: false });
  const [deptSheet, setDeptSheet] = useState<{ open: boolean; team: Team | null }>({ open: false, team: null });
  const [knowOpen, setKnowOpen] = useState(false);

  const setTab = useCallback((next: Tab) => {
    sessionStorage.setItem(TAB_KEY, next);
    setTabState(next);
  }, []);

  const tabs = useMemo(() => {
    const list: Array<{ id: Tab; label: MessageKey; count?: number; alert?: boolean }> = [
      {
        id: "overview",
        label: "wxTabOverview",
        count: data.approvals.length + data.draftsAwaitingRequest.length || undefined,
        alert: true,
      },
      { id: "departments", label: "wxTabDepartments", count: data.departments.length || undefined },
      { id: "tasks", label: "ccTasks", count: data.openTasks.length || undefined },
      { id: "knowledge", label: "ccKnowledge" },
    ];
    if (liveMap) list.push({ id: "map", label: "hqLiveMap" });
    if (caps.canAdminister) {
      list.push({ id: "reports", label: "ccReports" }, { id: "seats", label: "wxTabSeats" });
    }
    return list;
  }, [caps.canAdminister, liveMap, data.approvals.length, data.departments.length, data.draftsAwaitingRequest.length, data.openTasks.length]);

  // Seats never land on owner-only tabs.
  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) setTab("overview");
  }, [setTab, tab, tabs]);

  // First visit (or an empty org) opens the AI setup chat inside the page.
  useEffect(() => {
    if (data.loading || setupChecked.current) return;
    setupChecked.current = true;
    if (!caps.canAdminister) return;
    const requested = sessionStorage.getItem(OPEN_SETUP_FLAG) === "1";
    sessionStorage.removeItem(OPEN_SETUP_FLAG);
    const state = readWorkforceSetupState();
    if (requested || state === null || (state !== "done" && data.departments.length === 0)) {
      setSetupOpen(true);
    }
  }, [caps.canAdminister, data.departments.length, data.loading]);

  useEffect(() => {
    const openHire = () => setHire({ open: true });
    if (sessionStorage.getItem(OPEN_HIRE_FLAG) === "1" || window.location.hash.endsWith("#hire")) {
      sessionStorage.removeItem(OPEN_HIRE_FLAG);
      openHire();
    }
    window.addEventListener("arrab:open-hire", openHire);
    return () => window.removeEventListener("arrab:open-hire", openHire);
  }, []);

  function finishSetup(created: WorkforceSetupResult[]) {
    if (created.length > 0) {
      try {
        const meta = JSON.parse(localStorage.getItem(META_KEY) ?? "{}") as Record<string, unknown>;
        for (const item of created) {
          meta[item.teamId] = { mode: "supervised", approval: "human", automation: "medium", roles: item.roles };
        }
        localStorage.setItem(META_KEY, JSON.stringify(meta));
      } catch {
        // Team meta is advisory only.
      }
      setDeptId(created[0]!.teamId);
      setTab("departments");
    }
    void data.reload();
  }

  const actions: WorkforceActions = {
    openHire: (teamId) => setHire({ open: true, teamId }),
    openEdit: (agent) => setEditAgent(agent),
    openTask: (opts) => setTaskSheet({ open: true, ...opts }),
    openDept: (team) => setDeptSheet({ open: true, team }),
    goDepartment: (id) => {
      setDeptId(id);
      setTab("departments");
    },
    goTab: setTab,
    openSetup: () => setSetupOpen(true),
    chat: (agentId) => {
      openAgentChat(agentId);
      navigate(href("/chat"));
    },
    desk: (agentId) => {
      openAgentDesk(agentId);
      navigate(`/desk/${agentId}`);
    },
    workplace: (agentId) => {
      openAgentWorkplace(agentId);
      navigate(`${ROLE_PATH.organization}/workplace`);
    },
    teamRoom: (teamId) => {
      openTeamChat(teamId);
      navigate(href("/chat"));
    },
  };

  if (setupOpen) {
    return (
      <Surface className="cc-page !overflow-hidden">
        <WorkforceSetupWizard variant="page" onClose={() => setSetupOpen(false)} onComplete={finishSetup} />
      </Surface>
    );
  }

  const live = data.agents.filter((agent) => agent.status === "active").length;

  return (
    <Surface className="cc-page !overflow-hidden">
      <header className="cc-head">
        <div className="cc-head-title">
          <span className="cc-mark">
            <UsersRound className="size-[18px]" strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1>{t("workforceTitle")}</h1>
              <span className="cc-live">
                <i aria-hidden />
                {t("wxLiveCount").replace("{n}", String(live))}
              </span>
            </div>
            <p>
              {t("wxHeadSub")
                .replace("{depts}", String(data.departments.length))
                .replace("{people}", String(data.agents.length))
                .replace("{open}", String(data.openTasks.length))}
            </p>
          </div>
        </div>
        <div className="cc-head-actions">
          {caps.canAdminister ? (
            <button type="button" className="cc-btn is-ghost" onClick={() => setSetupOpen(true)}>
              <Sparkles className="size-3.5" strokeWidth={1.8} />
              {t("wxAiSetup")}
            </button>
          ) : null}
          {caps.canAssignWork ? (
            <button type="button" className="cc-btn" onClick={() => setTaskSheet({ open: true })}>
              <ClipboardPlus className="size-3.5" strokeWidth={1.8} />
              {t("wxNewTask")}
            </button>
          ) : null}
          {caps.canHireAgents ? (
            <button type="button" className="cc-btn is-primary" onClick={() => setHire({ open: true })}>
              <UserPlus className="size-3.5" strokeWidth={1.8} />
              {t("wxHireCompanion")}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="cc-tabs" aria-label={t("workforceTitle")}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn("cc-tab", tab === item.id && "is-active")}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {t(item.label)}
            {item.count ? <span className={cn("cc-tab-count", item.alert && "is-alert")}>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "map" ? (
        <div className="relative min-h-0 flex-1">
          <LiveOfficeMap
            teams={data.teams}
            membersByTeam={data.membersByTeam}
            unassigned={data.unassigned}
            tasks={data.tasks}
            taskRuns={data.taskRuns}
            approvals={data.approvals}
            draftsNeedingRequest={data.draftsAwaitingRequest}
            canAssignWork={caps.canAssignWork}
            onBack={() => setTab("overview")}
            onOpenAgent={(agentId) => actions.desk(agentId)}
            onOpenCompanionChat={(agentId) => actions.chat(agentId)}
            onOpenTeamChat={(teamId) => actions.teamRoom(teamId)}
            onOpenApprovals={() => setTab("overview")}
            onOpenConnectors={() => navigate(href("/connectors"))}
            onHire={() => setHire({ open: true })}
            onComposeTeam={() => setDeptSheet({ open: true, team: null })}
            onRefresh={() => void data.reload()}
          />
        </div>
      ) : (
        <div className="cc-body">
          {data.loading ? (
            <div className="flex h-48 items-center justify-center text-[var(--color-muted)]">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : tab === "overview" ? (
            <WorkforceOverview data={data} caps={caps} actions={actions} />
          ) : tab === "departments" ? (
            <WorkforceDepartments data={data} caps={caps} actions={actions} selectedId={deptId} onSelect={setDeptId} />
          ) : tab === "tasks" ? (
            <WorkforceTasks data={data} caps={caps} actions={actions} />
          ) : tab === "knowledge" ? (
            <WorkforceKnowledge data={data} caps={caps} onNew={() => setKnowOpen(true)} />
          ) : tab === "reports" ? (
            <WorkforceReports data={data} />
          ) : tab === "seats" ? (
            <div className="cc-wrap">
              <OrgAdministrationPanel teams={data.teams} onTeamsChanged={() => void data.reload()} />
            </div>
          ) : null}
        </div>
      )}

      <HireSheet open={hire.open} defaultTeamId={hire.teamId} data={data} onClose={() => setHire({ open: false })} />
      <EditCompanionSheet agent={editAgent} data={data} onClose={() => setEditAgent(null)} />
      <TaskSheet
        open={taskSheet.open}
        defaultAssignee={taskSheet.assignee}
        defaultTeamId={taskSheet.teamId}
        data={data}
        projects={data.projects}
        onClose={() => setTaskSheet({ open: false })}
        onCreated={() => setTab("tasks")}
      />
      <DepartmentSheet
        open={deptSheet.open}
        team={deptSheet.team}
        data={data}
        onClose={() => setDeptSheet({ open: false, team: null })}
        onSaved={(team) => actions.goDepartment(team.id)}
      />
      <KnowledgeSheet open={knowOpen} data={data} onClose={() => setKnowOpen(false)} />
    </Surface>
  );
}
