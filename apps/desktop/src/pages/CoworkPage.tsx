import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowUp,
  Server,
  EyeOff,
  Cable,
  ClipboardList,
  Columns2,
  FolderOpen,
  Laptop,
  MessagesSquare,
  PanelRight,
  Play,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PauseSendButton, QueuedQueryBar } from "@/components/QueuedQueryBar";
import type {
  Agent,
  Approval,
  ConnectorPublic,
  Conversation,
  Message,
  Project,
  SessionUsageSnapshot,
  Task,
  Team,
  TokenSpendTier,
  WorkspaceMention,
} from "@arrab/shared";
import { IncognitoRoom } from "@/components/companions/IncognitoRoom";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import { ArtifactsPanel, extractArtifacts } from "@/components/ArtifactsPanel";
import { AgentSteps, friendlyToolTitle, type AgentStep } from "@/components/AgentSteps";
import { humanizeApprovalCopy } from "@/lib/approval-copy";
import { MentionComposer } from "@/components/MentionComposer";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useStudioPrefs } from "@/hooks/useStudioPrefs";
import { LAST_COWORK_AGENT_KEY } from "@/lib/prefs";
import { notifyStudio } from "@/lib/notify";
import { showAgentPresence, subscribePresenceResolve } from "@/lib/agent-presence";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import { buildResolveApprovalBody } from "@/lib/resolve-approval";
import {
  filterLiveWorkforceAgents,
  readAgentSessionPolicy,
  writeAgentSessionPolicy,
} from "@/lib/agent-session-policy";
import {
  defaultSoloAgentBody,
  ensureDefaultSoloAgent,
} from "@/lib/agents-bootstrap";
import {
  executeLocalAgentTool,
  formatToolDiffPreview,
  isAutoClientTool,
  isClientExecTool,
  isEmailPolicyTool,
  isPolicyClientTool,
  listEditCheckpoints,
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
  restoreEditCheckpoint,
  type EditCheckpoint,
} from "@/lib/agent-local-tools";
import { listDir, readTextFile, type FsEntry } from "@/lib/fs";
import { isTauriRuntime, pickFolder, runLocalCommand, type TerminalLine } from "@/lib/terminal";
import { loadWorkspaceRules } from "@/lib/workspace-rules";
import { loadBestMessages, listCachedChats, usePersistedChat } from "@/lib/chat-history";
import {
  accessLabel,
  readCompanionAccess,
  writeCompanionAccess,
  type RuntimeTarget,
} from "@/lib/cowork-companion-access";
import { resolveAiRuntime, resolvePreferredModel } from "@/lib/ai-prefs";
import { streamOllamaChat } from "@/lib/local-models";
import {
  liveCompanions,
  useCompanionState,
  type CompanionProfile,
} from "@/lib/companions";
import { syncWorkProfilesFromAgents } from "@/lib/org-chat";
import { prepareWorkplaceDesk, WORKPLACE_TASK_KEY } from "@/lib/workplace-handoff";
import { useOrgSeatCapabilities } from "@/lib/org-seat";
import { cn } from "@/lib/utils";
import { ROLE_PATH } from "@/roles/catalog";

type FocusMode = "chat" | "split";
type DeskTab = "run" | "notes" | "restore";
type TerminalPolicy = "ask" | "allow";
type AgentTab = {
  key: string;
  kind: "solo" | "team";
  agentId: string | null;
  teamId: string | null;
  label: string;
};
type FileTab = { path: string; content: string; dirty: boolean };

const FOLDER_KEY = "arrab.cowork.folder";
const GOAL_KEY_PREFIX = "arrab.chatGoal.";
const TERMINAL_POLICY_KEY = "arrab.cowork.terminalPolicy";
const SPEND_KEY = "arrab.coworkSpend";
const DESK_TEAM_KEY = "arrab.cowork.deskTeamId";

const DEFAULT_SESSION_BUDGETS: Record<TokenSpendTier, number> = {
  low: 40_000,
  medium: 40_000,
  high: 40_000,
};

function readSpendPrefs(): { tier: TokenSpendTier; budgetInput: string } {
  // Cowork stays on the fast lean path — no Eco/Balanced/Max UI.
  return { tier: "low", budgetInput: "" };
}

const RUN_PRESETS = [
  { id: "git-status", labelKey: "presetGitStatus" as const, command: "git status -sb" },
  { id: "git-diff", labelKey: "presetGitDiff" as const, command: "git diff --stat && git diff" },
  { id: "git-log", labelKey: "presetGitLog" as const, command: "git log -8 --oneline --decorate" },
  { id: "git-pull", labelKey: "presetGitPull" as const, command: "git pull --ff-only" },
  { id: "pnpm-install", labelKey: "presetPnpmInstall" as const, command: "pnpm install" },
  { id: "pnpm-typecheck", labelKey: "presetPnpmTypecheck" as const, command: "pnpm typecheck" },
  { id: "pnpm-test", labelKey: "presetPnpmTest" as const, command: "pnpm test" },
  { id: "npm-test", labelKey: "presetNpmTest" as const, command: "npm test" },
  { id: "pytest", labelKey: "presetPytest" as const, command: "pytest -q" },
  { id: "cargo-test", labelKey: "presetCargoTest" as const, command: "cargo test" },
];

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Prefer the real companion face/photo; otherwise draw a stable portrait from the agent id. */
function portraitForAgent(
  agent: Agent,
  people: CompanionProfile[],
): CompanionProfile {
  const match =
    people.find((person) => person.agentId === agent.id) ??
    people.find(
      (person) => person.name.trim().toLowerCase() === agent.name.trim().toLowerCase(),
    );
  if (match) return match;
  const seed = hashSeed(agent.id || agent.name);
  return {
    id: `cowork-face:${agent.id}`,
    agentId: agent.id,
    conversationId: null,
    parentConversationId: null,
    name: agent.name,
    domain: "work",
    purposeId: "work",
    brief: null,
    toneNote: null,
    connectors: [],
    hue: seed % 360,
    faceSeed: seed % 4096,
    avatarPhoto: null,
    space: "work",
    tone: {
      bluntness: 45,
      humour: 40,
      replyLength: 35,
      warmth: 55,
      formality: 35,
      criticism: 40,
      pace: 45,
    },
    toneName: "measured",
    callOut: [],
    lastMemory: null,
    lastLine: null,
    lastAt: null,
    resume: null,
    familyMemberId: null,
    createdAt: "",
    archivedAt: null,
  };
}

function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function CoworkPage({ asWorkplace = false }: { asWorkplace?: boolean } = {}) {
  const { t } = useLanguage();
  const prefs = useStudioPrefs();
  const companionState = useCompanionState();
  const { employee } = useOrgSeatCapabilities();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentId, setAgentId] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [activeGoal, setActiveGoal] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setProviderConfigured] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState<import("@arrab/shared").AiGatewayStatusResponse | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [streamDraft, setStreamDraft] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMention[]>([]);
  const [workspaceRules, setWorkspaceRules] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<EditCheckpoint[]>([]);
  const [spendTier] = useState<TokenSpendTier>("low");
  const [budgetInput] = useState("");
  const [sessionUsage, setSessionUsage] = useState<SessionUsageSnapshot | null>(null);
  const [queuedQuery, setQueuedQuery] = useState<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [deskTeamId, setDeskTeamId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DESK_TEAM_KEY);
    } catch {
      return null;
    }
  });
  const [agentTabs, setAgentTabs] = useState<AgentTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState("");
  const [deskReady, setDeskReady] = useState(false);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [terminalPolicy, setTerminalPolicy] = useState<TerminalPolicy>(() => {
    try {
      const raw = localStorage.getItem(TERMINAL_POLICY_KEY);
      return raw === "allow" ? "allow" : "ask";
    } catch {
      return "ask";
    }
  });
  const [terminalInput, setTerminalInput] = useState("");
  const terminalPolicyRef = useRef(terminalPolicy);
  terminalPolicyRef.current = terminalPolicy;
  const handledApprovalsRef = useRef(new Set<string>());
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [focus, setFocus] = useState<FocusMode>("split");
  const [deskTab, setDeskTab] = useState<DeskTab>("notes");
  const accessHydratingRef = useRef(false);
  const [tabMenu, setTabMenu] = useState<{
    key: string;
    agentId: string | null;
    x: number;
    y: number;
    confirmDelete?: boolean;
  } | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(FOLDER_KEY);
    } catch {
      return null;
    }
  });
  const [runtimeTarget, setRuntimeTarget] = useState<RuntimeTarget>(() => {
    try {
      const raw = localStorage.getItem("arrab.cowork.runtimeTarget");
      return raw === "ssh" || raw === "github" || raw === "pc" ? raw : "pc";
    } catch {
      return "pc";
    }
  });
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [sshConnectorId, setSshConnectorId] = useState<string>(() => {
    try {
      return localStorage.getItem("arrab.cowork.sshConnectorId") ?? "";
    } catch {
      return "";
    }
  });
  const [githubConnectorId, setGithubConnectorId] = useState<string>(() => {
    try {
      return localStorage.getItem("arrab.cowork.githubConnectorId") ?? "";
    } catch {
      return "";
    }
  });
  const [githubRepo, setGithubRepo] = useState<string>(() => {
    try {
      return localStorage.getItem("arrab.cowork.githubRepo") ?? "";
    } catch {
      return "";
    }
  });
  const [githubRepos, setGithubRepos] = useState<Array<{ id: string; name: string; fullName?: string }>>([]);
  const [incognitoOpen, setIncognitoOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState("");
  const [machineBusy, setMachineBusy] = useState(false);
  const [dirRel, setDirRel] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    { id: "sys-1", kind: "system", text: t("terminalReady") },
  ]);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const termEnd = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agentId, agents],
  );

  const workPeople = useMemo(
    () => liveCompanions(companionState, "work").filter((person) => person.domain !== "general"),
    [companionState],
  );

  useEffect(() => {
    if (agents.length === 0) return;
    syncWorkProfilesFromAgents(agents);
  }, [agents]);

  const selectedPortrait = useMemo(
    () => (selectedAgent ? portraitForAgent(selectedAgent, workPeople) : null),
    [selectedAgent, workPeople],
  );

  const linkedProject = useMemo(() => {
    const id = selectedAgent?.projectId ?? conversation?.projectId;
    return projects.find((project) => project.id === id) ?? null;
  }, [conversation?.projectId, projects, selectedAgent?.projectId]);

  const spendPayload = useMemo(
    () => ({
      tier: "low" as const,
      sessionTokenBudget: null,
    }),
    [],
  );

  const budgetExhausted = false;

  const activeAgentTab = useMemo(
    () => agentTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [activeTabKey, agentTabs],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        SPEND_KEY,
        JSON.stringify({ tier: "low", budgetInput: "" }),
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("arrab.cowork.runtimeTarget", runtimeTarget);
      if (sshConnectorId) localStorage.setItem("arrab.cowork.sshConnectorId", sshConnectorId);
      if (githubConnectorId) localStorage.setItem("arrab.cowork.githubConnectorId", githubConnectorId);
      if (githubRepo) localStorage.setItem("arrab.cowork.githubRepo", githubRepo);
    } catch {
      // ignore
    }
  }, [runtimeTarget, sshConnectorId, githubConnectorId, githubRepo]);

  // Load per-companion workspace access when switching companions.
  useEffect(() => {
    if (!agentId) return;
    const saved = readCompanionAccess(agentId);
    if (!saved) return;
    accessHydratingRef.current = true;
    setRuntimeTarget(saved.target);
    setFolderPath(saved.folderPath);
    setSshConnectorId(saved.sshConnectorId);
    setGithubConnectorId(saved.githubConnectorId);
    setGithubRepo(saved.githubRepo);
    setDirRel("");
    setOpenFile(null);
    setFileContent("");
    setFileDirty(false);
    const timer = window.setTimeout(() => {
      accessHydratingRef.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentId]);

  // Persist access for the active companion.
  useEffect(() => {
    if (!agentId || accessHydratingRef.current) return;
    writeCompanionAccess(agentId, {
      target: runtimeTarget,
      folderPath,
      sshConnectorId,
      githubConnectorId,
      githubRepo,
    });
  }, [agentId, runtimeTarget, folderPath, sshConnectorId, githubConnectorId, githubRepo]);

  const sshConnectors = useMemo(
    () => connectors.filter((item) => item.provider === "ssh" && item.status === "connected"),
    [connectors],
  );
  const githubConnectors = useMemo(
    () => connectors.filter((item) => item.provider === "github" && item.status === "connected"),
    [connectors],
  );
  const selectedSsh = useMemo(
    () => sshConnectors.find((item) => item.id === sshConnectorId) ?? sshConnectors[0] ?? null,
    [sshConnectorId, sshConnectors],
  );
  const selectedGithub = useMemo(
    () => githubConnectors.find((item) => item.id === githubConnectorId) ?? githubConnectors[0] ?? null,
    [githubConnectorId, githubConnectors],
  );

  usePersistedChat(conversation, messages);

  const boot = useCallback(async () => {
    setError(null);
    try {
      const preferred = sessionStorage.getItem("arrab.coworkAgent");
      if (preferred) {
        sessionStorage.removeItem("arrab.coworkAgent");
      }
      const lastAgent = prefs.coworkAutoResume
        ? localStorage.getItem(LAST_COWORK_AGENT_KEY)
        : null;
      const preferredFocus = sessionStorage.getItem("arrab.coworkFocus");
      if (preferredFocus === "chat" || preferredFocus === "split") {
        sessionStorage.removeItem("arrab.coworkFocus");
        setFocus(preferredFocus);
        setDeskOpen(preferredFocus === "split");
      } else if (prefs.coworkTerminalDock) {
        setFocus("split");
        setDeskOpen(true);
      } else {
        setFocus("split");
        setDeskOpen(false);
      }
      const [agentList, projectList, ai, teamList, connectorList, taskList] = await Promise.all([
        arrabApi.agents(),
        arrabApi.projects(),
        arrabApi.aiStatus(),
        arrabApi.teams().catch(() => ({ items: [] as Team[] })),
        arrabApi.connectors().catch(() => ({ items: [] as ConnectorPublic[] })),
        asWorkplace
          ? arrabApi.tasks().catch(() => ({ items: [] as Task[] }))
          : Promise.resolve({ items: [] as Task[] }),
      ]);
      setConnectors(connectorList.items);
      let active = filterLiveWorkforceAgents(agentList.items);
      active = await ensureDefaultSoloAgent(
        active,
        defaultSoloAgentBody(
          t("chatSoloDefaultName"),
          t("chatSoloDefaultRole"),
          t("chatSoloDefaultInstructions"),
        ),
      );
      setAgents(filterLiveWorkforceAgents(active));
      setProjects(projectList.items);
      setProviderConfigured(ai.configured);
      setAiStatus(ai);

      if (asWorkplace) {
        const agentIds = new Set(active.map((agent) => agent.id));
        const employeeId = employee?.id ?? null;
        setAssignedTasks(
          taskList.items.filter((task) => {
            if (task.status === "done" || task.status === "backlog") return false;
            if (employeeId && task.assigneeEmployeeId === employeeId) return true;
            return Boolean(task.assigneeAgentId && agentIds.has(task.assigneeAgentId));
          }),
        );
      } else {
        setAssignedTasks([]);
      }

      // Ensure Desk crew team so agents know each other.
      let teamId: string | null = null;
      try {
        teamId = localStorage.getItem(DESK_TEAM_KEY);
      } catch {
        teamId = null;
      }
      const existingTeam =
        (teamId ? teamList.items.find((team) => team.id === teamId) : null) ??
        teamList.items.find((team) => /desk crew/i.test(team.name)) ??
        null;
      if (existingTeam) {
        teamId = existingTeam.id;
      } else {
        try {
          const createdTeam = await arrabApi.createTeam({
            name: "Desk crew",
            purpose: "Laptop desk coworkers who coordinate on the open folder",
          });
          teamId = createdTeam.id;
        } catch {
          teamId = teamList.items[0]?.id ?? null;
        }
      }
      if (teamId) {
        setDeskTeamId(teamId);
        try {
          localStorage.setItem(DESK_TEAM_KEY, teamId);
        } catch {
          // ignore
        }
        for (const agent of active) {
          try {
            await arrabApi.addTeamMember(teamId, { agentId: agent.id });
          } catch {
            // already a member
          }
        }
      }

      const tabs: AgentTab[] = [
        {
          key: "team",
          kind: "team",
          agentId: null,
          teamId,
          label: t("coworkTeamTab"),
        },
        ...active.slice(0, 8).map((agent) => ({
          key: `solo:${agent.id}`,
          kind: "solo" as const,
          agentId: agent.id,
          teamId: null,
          label: agent.name,
        })),
      ];
      setAgentTabs(tabs);

      setError(null);
      setAgentId((current) => {
        if (preferred && active.some((agent) => agent.id === preferred)) {
          return preferred;
        }
        if (current && active.some((agent) => agent.id === current)) {
          return current;
        }
        if (lastAgent && active.some((agent) => agent.id === lastAgent)) {
          return lastAgent;
        }
        return active[0]?.id ?? "";
      });
      setActiveTabKey((current) => {
        if (current === "team") return current;
        if (preferred && tabs.some((tab) => tab.key === `solo:${preferred}`)) {
          return `solo:${preferred}`;
        }
        if (tabs.some((tab) => tab.key === current)) return current;
        const fallbackAgent =
          (preferred && active.some((a) => a.id === preferred) && preferred) ||
          (lastAgent && active.some((a) => a.id === lastAgent) && lastAgent) ||
          active[0]?.id;
        return fallbackAgent ? `solo:${fallbackAgent}` : "team";
      });
      if (
        prefs.notifyCowork &&
        active.length > 0 &&
        !sessionStorage.getItem("arrab.coworkNotified")
      ) {
        sessionStorage.setItem("arrab.coworkNotified", "1");
        void notifyStudio({
          kind: "cowork",
          title: t("coworkReminderTitle"),
          body: t("coworkReminderBody"),
          href: asWorkplace ? `${ROLE_PATH.organization}/workplace` : "/cowork",
        });
      }
      setDeskReady(true);
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) {
        setError(message);
      }
      setDeskReady(true);
    }
  }, [asWorkplace, employee?.id, prefs.coworkAutoResume, prefs.coworkTerminalDock, prefs.notifyCowork, t]);

  useEffect(() => {
    void boot();
    // Boot once per Cowork mount. Pref/`t` identity churn used to spawn extra Solo agents.
  }, []);

  useEffect(() => {
    if (!asWorkplace || agents.length === 0) return;
    let alive = true;
    void arrabApi
      .tasks()
      .then((response) => {
        if (!alive) return;
        const agentIds = new Set(agents.map((agent) => agent.id));
        const employeeId = employee?.id ?? null;
        setAssignedTasks(
          response.items.filter((task) => {
            if (task.status === "done" || task.status === "backlog") return false;
            if (employeeId && task.assigneeEmployeeId === employeeId) return true;
            return Boolean(task.assigneeAgentId && agentIds.has(task.assigneeAgentId));
          }),
        );
      })
      .catch(() => {
        if (alive) setAssignedTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [asWorkplace, agents, employee?.id]);

  // Heal sticky "API unavailable" once the API is reachable again — silently.
  useEffect(() => {
    if (!error) return;
    if (!isTransientApiError(error)) return;
    const timer = window.setInterval(() => {
      void arrabApi
        .health()
        .then(() => {
          setError(null);
          void boot();
        })
        .catch(() => {
          // still down — keep quiet
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [boot, error]);

  useEffect(() => {
    if (folderPath) {
      localStorage.setItem(FOLDER_KEY, folderPath);
    } else {
      localStorage.removeItem(FOLDER_KEY);
    }
  }, [folderPath]);

  useEffect(() => {
    if (!folderPath || !isTauriRuntime()) {
      setWorkspaceRules(null);
      setCheckpoints([]);
      return;
    }
    void loadWorkspaceRules(folderPath).then(setWorkspaceRules);
    setCheckpoints(listEditCheckpoints(folderPath));
  }, [folderPath]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    localStorage.setItem(LAST_COWORK_AGENT_KEY, agentId);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    const saved = prefs.privacyLocalNotes
      ? sessionStorage.getItem(`arrab.coworkNotes.${agentId}`)
      : null;
    const taskRaw = sessionStorage.getItem(WORKPLACE_TASK_KEY);
    if (taskRaw) {
      sessionStorage.removeItem(WORKPLACE_TASK_KEY);
      try {
        const task = JSON.parse(taskRaw) as { title?: string; brief?: string | null };
        const block = [
          `CEO task: ${task.title ?? "Untitled"}`,
          task.brief ? `Brief: ${task.brief}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        setNotes(saved ? `${block}\n\n${saved}` : block);
        return;
      } catch {
        // fall through
      }
    }
    setNotes(saved ?? "");
  }, [agentId, prefs.privacyLocalNotes]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (!prefs.privacyLocalNotes) {
      sessionStorage.removeItem(`arrab.coworkNotes.${agentId}`);
      return;
    }
    sessionStorage.setItem(`arrab.coworkNotes.${agentId}`, notes);
  }, [agentId, notes, prefs.privacyLocalNotes]);

  useEffect(() => {
    if (!agentId) {
      setActiveGoal("");
      setGoalDraft("");
      setGoalEditorOpen(false);
      return;
    }
    const saved = localStorage.getItem(`${GOAL_KEY_PREFIX}${agentId}`) ?? "";
    setActiveGoal(saved);
    setGoalDraft(saved);
    setGoalEditorOpen(false);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (!activeGoal.trim()) {
      localStorage.removeItem(`${GOAL_KEY_PREFIX}${agentId}`);
      return;
    }
    localStorage.setItem(`${GOAL_KEY_PREFIX}${agentId}`, activeGoal.trim());
  }, [agentId, activeGoal]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, agentSteps, pendingApproval, streamDraft]);

  useEffect(() => {
    termEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  const appendTerm = useCallback((kind: TerminalLine["kind"], text: string) => {
    setLines((current) => [...current, { id: crypto.randomUUID(), kind, text }]);
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!folderPath || !isTauriRuntime()) {
      setEntries([]);
      return;
    }
    try {
      const result = await listDir(folderPath, dirRel);
      setEntries(
        result.entries.map((entry) => ({
          ...entry,
          kind:
            entry.kind === "dir" || entry.kind === "file" || entry.kind === "other"
              ? entry.kind
              : "other",
        })),
      );
    } catch {
      // silent — auto-refresh should not spam the banner
    }
  }, [dirRel, folderPath]);

  const refreshGit = useCallback(async () => {
    if (!folderPath || !isTauriRuntime()) {
      setGitStatus("");
      setBranch(null);
      return;
    }
    setMachineBusy(true);
    try {
      const [status, branchResult] = await Promise.all([
        runLocalCommand("git status -sb", folderPath),
        runLocalCommand("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo", folderPath),
      ]);
      setGitStatus([status.stdout, status.stderr].filter(Boolean).join("\n").trim() || t("gitClean"));
      const nextBranch = branchResult.stdout.trim();
      setBranch(nextBranch && !nextBranch.includes("fatal") ? nextBranch : null);
      if (/fatal: not a git repository/i.test(status.stderr + status.stdout)) {
        setGitStatus(t("coworkNotGitRepo"));
      }
    } catch {
      // silent
    } finally {
      setMachineBusy(false);
    }
  }, [folderPath, t]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  // Auto-refresh files — no manual refresh button.
  useEffect(() => {
    if (!folderPath || !isTauriRuntime()) return;
    const timer = window.setInterval(() => {
      void refreshFiles();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [folderPath, refreshFiles]);


  async function refreshGithubRepos(connectorId: string) {
    if (!connectorId) {
      setGithubRepos([]);
      return;
    }
    try {
      const resources = await arrabApi.connectorResources(connectorId);
      const repos = resources.items.map((item) => ({
        id: item.id,
        name: item.name,
        fullName: item.name,
      }));
      setGithubRepos(repos);
      if (!githubRepo && repos[0]) {
        setGithubRepo(repos[0].fullName || repos[0].name);
      }
    } catch {
      setGithubRepos([]);
    }
  }


  useEffect(() => {
    if (selectedSsh && selectedSsh.id !== sshConnectorId) {
      setSshConnectorId(selectedSsh.id);
    }
  }, [selectedSsh, sshConnectorId]);

  useEffect(() => {
    if (selectedGithub && selectedGithub.id !== githubConnectorId) {
      setGithubConnectorId(selectedGithub.id);
    }
  }, [selectedGithub, githubConnectorId]);

  useEffect(() => {
    if (runtimeTarget === "github" && selectedGithub) {
      void refreshGithubRepos(selectedGithub.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeTarget, selectedGithub?.id]);

  async function chooseFolder() {
    setError(null);
    if (!isTauriRuntime()) {
      setError(t("folderNeedsDesktop"));
      return;
    }
    try {
      const path = await pickFolder();
      if (!path) {
        return;
      }
      setFolderPath(path);
      setDirRel("");
      setOpenFile(null);
      setFileContent("");
      setFileDirty(false);
      setFocus("chat");
      setDeskOpen(false);
      appendTerm("system", `${t("openedFolder")}: ${path}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    }
  }

  async function runInFolder(command: string, label?: string) {
    if (runtimeTarget === "ssh") {
      const connector = selectedSsh;
      if (!connector) {
        setError(t("coworkNeedSshConnector"));
        return;
      }
      setTerminalBusy(true);
      appendTerm("input", `ssh:${connector.accountLabel || "server"} $ ${label ?? command}`);
      try {
        const result = await arrabApi.sshExec(connector.id, { command });
        if (result.stdout.trim()) appendTerm("stdout", result.stdout.trimEnd());
        if (result.stderr.trim()) appendTerm("stderr", result.stderr.trimEnd());
        appendTerm("system", `exit ${result.code ?? 0}`);
      } catch (err: unknown) {
        appendTerm("error", err instanceof Error ? err.message : String(err));
      } finally {
        setTerminalBusy(false);
      }
      return;
    }
    if (!folderPath) {
      setError(t("openFolderFirst"));
      return;
    }
    if (!isTauriRuntime()) {
      setError(t("folderNeedsDesktop"));
      return;
    }
    setTerminalBusy(true);
    appendTerm("input", `${folderName(folderPath)} $ ${label ?? command}`);
    try {
      const result = await runLocalCommand(command, folderPath);
      if (result.stdout.trim()) {
        appendTerm("stdout", result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        appendTerm("stderr", result.stderr.trimEnd());
      }
      appendTerm("system", `exit ${result.code}`);
      if (command.includes("git ")) {
        await refreshGit();
      }
    } catch (err: unknown) {
      appendTerm("error", err instanceof Error ? err.message : String(err));
    } finally {
      setTerminalBusy(false);
    }
  }

  const applyConversationDetail = useCallback(
    async (detail: {
      conversation: Conversation;
      messages: Message[];
      sessionUsage?: SessionUsageSnapshot;
    }) => {
      const history = await loadBestMessages(detail.conversation.id, detail.messages);
      setConversation(detail.conversation);
      setMessages(history);
      if (detail.sessionUsage) {
        setSessionUsage(detail.sessionUsage);
      }
      if (detail.conversation.agentId) {
        setAgentId(detail.conversation.agentId);
      }
      setError(null);
    },
    [],
  );

  const startSession = useCallback(
    async (mode: "resume" | "fresh" = "resume"): Promise<Conversation | null> => {
      const tab = agentTabs.find((item) => item.key === activeTabKey);
      const wantTeam = tab?.kind === "team" || activeTabKey === "team";
      let workingAgentId = tab?.agentId || agentId;
      let workingTeamId = wantTeam ? deskTeamId || tab?.teamId : null;

      if (wantTeam && !workingTeamId) {
        try {
          const createdTeam = await arrabApi.createTeam({
            name: "Desk crew",
            purpose: "Laptop desk coworkers who coordinate on the open folder",
          });
          workingTeamId = createdTeam.id;
          setDeskTeamId(createdTeam.id);
          try {
            localStorage.setItem(DESK_TEAM_KEY, createdTeam.id);
          } catch {
            // ignore
          }
          for (const agent of agents) {
            try {
              await arrabApi.addTeamMember(createdTeam.id, { agentId: agent.id });
            } catch {
              // already member
            }
          }
        } catch (err: unknown) {
          const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
          if (!isTransientApiError(message)) setError(message);
          return null;
        }
      }

      if (!wantTeam && !workingAgentId) {
        try {
          const ensured = await ensureDefaultSoloAgent(
            agents,
            defaultSoloAgentBody(
              t("chatSoloDefaultName"),
              t("chatSoloDefaultRole"),
              t("chatSoloDefaultInstructions"),
            ),
          );
          setAgents(ensured);
          workingAgentId = ensured[0]?.id ?? "";
          if (!workingAgentId) return null;
          setAgentId(workingAgentId);
          setActiveTabKey(`solo:${workingAgentId}`);
        } catch (err: unknown) {
          const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
          if (!isTransientApiError(message)) setError(message);
          return null;
        }
      }

      setSessionBusy(true);
      setError(null);
      try {
        const loadDetail = async (id: string) => {
          const detail = await arrabApi.conversation(id);
          await applyConversationDetail(detail);
          return detail.conversation;
        };

        if (wantTeam && workingTeamId) {
          if (mode === "fresh") {
            const created = await arrabApi.createConversation({
              teamId: workingTeamId,
              projectId: selectedAgent?.projectId ?? null,
              spend: spendPayload,
            });
            return loadDetail(created.id);
          }
          const threads = await arrabApi.conversations();
          const latest = threads.items.find((item) => item.teamId === workingTeamId);
          if (latest) return loadDetail(latest.id);
          const created = await arrabApi.createConversation({
            teamId: workingTeamId,
            projectId: selectedAgent?.projectId ?? null,
            spend: spendPayload,
          });
          return loadDetail(created.id);
        }

        if (mode === "fresh") {
          const created = await arrabApi.createConversation({
            agentId: workingAgentId!,
            projectId: selectedAgent?.projectId ?? null,
            spend: spendPayload,
          });
          return loadDetail(created.id);
        }
        const existing = await arrabApi.agentConversations(workingAgentId!);
        const latest = existing.items[0];
        if (latest) return loadDetail(latest.id);
        const created = await arrabApi.createConversation({
          agentId: workingAgentId!,
          projectId: selectedAgent?.projectId ?? null,
          spend: spendPayload,
        });
        return loadDetail(created.id);
      } catch (err: unknown) {
        const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
        if (/unknown agent/i.test(message)) {
          try {
            localStorage.removeItem(LAST_COWORK_AGENT_KEY);
            const latest = await arrabApi.agents();
            const ensured = await ensureDefaultSoloAgent(
              filterLiveWorkforceAgents(latest.items),
              defaultSoloAgentBody(
                t("chatSoloDefaultName"),
                t("chatSoloDefaultRole"),
                t("chatSoloDefaultInstructions"),
              ),
            );
            setAgents(filterLiveWorkforceAgents(ensured));
            const pick = ensured[0];
            if (!pick) return null;
            setAgentId(pick.id);
            setActiveTabKey(`solo:${pick.id}`);
            const convo = await arrabApi.createConversation({
              agentId: pick.id,
              projectId: pick.projectId,
              spend: spendPayload,
            });
            const detail = await arrabApi.conversation(convo.id);
            await applyConversationDetail(detail);
            return detail.conversation;
          } catch (retryErr: unknown) {
            const retryMessage =
              retryErr instanceof ApiRequestError ? retryErr.message : t("apiUnavailable");
            if (!isTransientApiError(retryMessage)) setError(retryMessage);
            return null;
          }
        }
        if (!isTransientApiError(message)) setError(message);
        const cached = await listCachedChats();
        const match = cached.find((item) =>
          wantTeam && workingTeamId
            ? item.conversation.teamId === workingTeamId
            : Boolean(workingAgentId) && item.conversation.agentId === workingAgentId,
        );
        if (match) {
          await applyConversationDetail({
            conversation: match.conversation,
            messages: match.messages,
          });
          return match.conversation;
        }
        return null;
      } finally {
        setSessionBusy(false);
      }
    },
    [
      activeTabKey,
      agentId,
      agentTabs,
      agents,
      applyConversationDetail,
      deskTeamId,
      selectedAgent?.projectId,
      spendPayload,
      t,
    ],
  );

  // Load conversation when agent tab changes.
  useEffect(() => {
    if (!deskReady) return;
    if (!activeTabKey && !agentId) return;
    let cancelled = false;
    setSessionBusy(true);
    void (async () => {
      const convo = await startSession("resume");
      if (!cancelled && !convo) {
        // startSession already set error if needed
      }
      if (!cancelled) setSessionBusy(false);
    })();
    return () => {
      cancelled = true;
    };
    // intentionally only when tab/agent changes — startSession identity churn would loop
  }, [deskReady, activeTabKey, agentId]);

  function applyGoal(next: string, kickoff = false) {
    const trimmed = next.trim();
    setActiveGoal(trimmed);
    setGoalDraft(trimmed);
    setGoalEditorOpen(false);
    if (kickoff && trimmed) {
      setDraft((current) => {
        if (current.trim()) {
          return current;
        }
        return `${t("goalKickoff")}\n\nGoal: ${trimmed}`;
      });
      composerRef.current?.focus();
    }
  }

  function applyTerminalPolicy(next: TerminalPolicy) {
    setTerminalPolicy(next);
    try {
      localStorage.setItem(TERMINAL_POLICY_KEY, next);
    } catch {
      // ignore
    }
    if (agentId) writeAgentSessionPolicy(agentId, next);
    if (next === "allow" && pendingApproval && isLocalToolApproval(pendingApproval)) {
      void resolveCoworkApproval(pendingApproval, "approved");
    }
  }

  useEffect(() => {
    if (!agentId) return;
    setTerminalPolicy(readAgentSessionPolicy(agentId));
  }, [agentId]);

  function approvalDetailPreview(approval: Approval): string {
    const args = parseToolArgsFromApproval(approval.detail);
    const toolName = parseToolNameFromApproval(approval.detail, approval.title);
    const formatted = formatToolDiffPreview(toolName, args);
    if (formatted) return formatted;
    return approval.detail || approval.title;
  }

  function isLocalToolApproval(approval: Approval): boolean {
    const name = parseToolNameFromApproval(approval.detail, approval.title);
    return Boolean(name && isClientExecTool(name));
  }

  async function executeApprovalLocally(approval: Approval): Promise<{
    toolName: string;
    toolResult: string;
    ok: boolean;
    summary: string;
  }> {
    const toolName =
      parseToolNameFromApproval(approval.detail, approval.title) ?? "run_terminal";
    const args = parseToolArgsFromApproval(approval.detail);
    const executed = await executeLocalAgentTool(toolName, args, folderPath, {
      onTerminal: (kind, text) => {
        if (toolName === "run_terminal") {
          setFocus((current) => (current === "chat" ? "split" : current));
          if (kind === "input") {
            appendTerm("input", `${folderPath ? folderName(folderPath) : "desk"} $ ${text}`);
          } else {
            appendTerm(kind, text);
          }
        }
      },
    });
    if (toolName === "write_file" || toolName === "apply_patch") {
      void refreshFiles();
      void refreshGit();
      setCheckpoints(listEditCheckpoints(folderPath));
      const path = args.path;
      if (path && openFile === path) {
        try {
          if (folderPath) {
            const file = await readTextFile(folderPath, path);
            setFileContent(file.content);
            setFileDirty(false);
          }
        } catch {
          // ignore refresh errors
        }
      }
    }
    if (toolName === "run_terminal") {
      void refreshFiles();
      void refreshGit();
    }
    return {
      toolName,
      toolResult: executed.toolResult,
      ok: executed.ok,
      summary: executed.summary,
    };
  }

  async function resolveCoworkApproval(
    approval: Approval,
    status: "approved" | "rejected",
  ) {
    setApprovalBusy(true);
    setError(null);
    try {
      let toolResult: string | undefined;
      if (status === "approved" && isLocalToolApproval(approval)) {
        const executed = await executeApprovalLocally(approval);
        toolResult = executed.toolResult;
        const detail = `${executed.ok ? "OK" : "FAILED"} — ${executed.summary}\n${executed.toolResult}`.slice(
          0,
          2500,
        );
        setAgentSteps((current) => {
          const pendingIdx = [...current]
            .map((step, index) => ({ step, index }))
            .reverse()
            .find(
              ({ step }) =>
                step.status === "pending" ||
                step.status === "running" ||
                step.title.includes(executed.toolName.replace(/_/g, " ")),
            )?.index;
          const next: AgentStep = {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(executed.toolName, detail),
            detail,
            status: executed.ok ? "done" : "failed",
          };
          if (pendingIdx == null) return [...current, next];
          const copy = [...current];
          copy[pendingIdx] = { ...copy[pendingIdx]!, ...next, id: copy[pendingIdx]!.id };
          return copy;
        });
      }
      const result = await arrabApi.resolveApproval(
        approval.id,
        await buildResolveApprovalBody({
          status,
          approvalDetail: approval.detail,
          toolResult: toolResult ?? null,
        }),
      );
      setPendingApproval(null);
      const toolName = parseToolNameFromApproval(approval.detail, approval.title);
      if (status === "approved" && toolName && isEmailPolicyTool(toolName)) {
        setAgentSteps((current) => {
          const runningIdx = [...current]
            .map((step, index) => ({ step, index }))
            .reverse()
            .find(({ step }) => step.status === "running" || step.status === "pending")?.index;
          const done: AgentStep = {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, approval.detail ?? undefined),
            detail: approval.detail ?? t("approvalGranted"),
            status: "done",
          };
          if (runningIdx == null) return [...current, done];
          const copy = [...current];
          copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
          return copy;
        });
      }
      if (status === "approved" && result.continued?.assistantMessage) {
        setMessages((current) => [...current, result.continued!.assistantMessage!]);
        if (result.continued.sessionUsage) {
          setSessionUsage(result.continued.sessionUsage);
        }
        if (result.continued.toolsUsed?.length) {
          setAgentSteps((current) => {
            const existingTitles = new Set(current.map((step) => step.title.toLowerCase()));
            const extras = result.continued!.toolsUsed!.filter((name) => {
              const title = friendlyToolTitle(name).toLowerCase();
              return !existingTitles.has(title) && !existingTitles.has(name.replace(/_/g, " "));
            });
            if (extras.length === 0) return current;
            return [
              ...current,
              ...extras.map((name) => ({
                id: `tool-${crypto.randomUUID()}`,
                title: friendlyToolTitle(name),
                detail: t("approvalGranted"),
                status: "done" as const,
              })),
            ];
          });
        }
        if (result.continued.approval) {
          void handleIncomingApproval(result.continued.approval);
        }
      } else if (status === "rejected") {
        setError(t("chatApprovalRejected"));
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setApprovalBusy(false);
    }
  }

  useEffect(() => {
    if (!pendingApproval) return;
    return subscribePresenceResolve((request) => {
      if (pendingApproval.id !== request.approvalId) {
        return false;
      }
      void resolveCoworkApproval(pendingApproval, request.status);
      return true;
    });
  }, [pendingApproval]);

  async function handleIncomingApproval(approval: Approval) {
    if (handledApprovalsRef.current.has(approval.id)) {
      return;
    }
    handledApprovalsRef.current.add(approval.id);
    const toolName = parseToolNameFromApproval(approval.detail, approval.title);
    const allowAll = terminalPolicyRef.current === "allow";
    const auto =
      (toolName && isAutoClientTool(toolName)) ||
      (toolName && isPolicyClientTool(toolName) && allowAll) ||
      (toolName && isEmailPolicyTool(toolName) && allowAll);
    if (auto && toolName && (isClientExecTool(toolName) || isEmailPolicyTool(toolName))) {
      setAgentSteps((current) => [
        ...current.map((step) =>
          step.id === "thinking" && step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
        ),
        {
          id: `tool-${crypto.randomUUID()}`,
          title: friendlyToolTitle(toolName, approval.detail ?? undefined),
          detail: isEmailPolicyTool(toolName)
            ? approval.detail ?? undefined
            : t("coworkTerminalAutoRunning"),
          status: "running",
        },
      ]);
      await resolveCoworkApproval(approval, "approved");
      return;
    }
    setAgentSteps((current) => [
      ...current.map((step) =>
        step.id === "thinking" && step.status === "running"
          ? { ...step, status: "done" as const }
          : step,
      ),
      {
        id: `approval-${approval.id}`,
        title: friendlyToolTitle(toolName || "tool", approval.detail ?? undefined),
        detail: approval.detail ?? approval.title,
        status: "pending",
      },
    ]);
    setPendingApproval(approval);
    const copy = humanizeApprovalCopy({
      title: approval.title,
      detail: approval.detail,
    });
    void showAgentPresence({
      agentName: "Arrab",
      title: copy.title,
      body: copy.body,
      preview: copy.preview,
      progress: 0.8,
      state: "needs_you",
      approvalId: approval.id,
      hue: 42,
    });
  }

  function buildWorkspaceHint() {
    const treeLimit = 25;
    const fileCap = 2500;
    const termLines = 10;
    const treeSummary = entries
      .slice(0, treeLimit)
      .map((entry) => `${entry.kind === "dir" ? "dir" : "file"} ${entry.path}`)
      .join("\n");
    let operatorDirectives: string | null = null;
    try {
      const raw = JSON.parse(localStorage.getItem("arrab.workforce.directives") ?? "[]") as Array<{
        text?: string;
      }>;
      const directiveLines = raw.map((item) => item.text?.trim()).filter(Boolean) as string[];
      operatorDirectives =
        directiveLines.length > 0 ? directiveLines.slice(0, 4).join("\n") : null;
    } catch {
      operatorDirectives = null;
    }
    const recentTerminal = lines
      .slice(-termLines)
      .map((line) => {
        const prefix =
          line.kind === "input"
            ? "$ "
            : line.kind === "stderr" || line.kind === "error"
              ? "! "
              : "";
        return `${prefix}${line.text}`.slice(0, 180);
      })
      .join("\n");
    const roster = agents
      .slice(0, 12)
      .map((agent) => `- ${agent.name} (${agent.role})`)
      .join("\n");
    const runtimeNote =
      runtimeTarget === "ssh"
        ? [
            "Runtime target: remote SSH server.",
            selectedSsh
              ? `SSH connector: ${selectedSsh.accountLabel || selectedSsh.provider} (${selectedSsh.id}).`
              : "No SSH connector selected — ask the operator to connect one in Connectors.",
            "Use terminal/run commands; they execute on the remote host via SSH.",
            "Do not claim local Mac file edits unless a PC folder is also open.",
          ].join("\n")
        : runtimeTarget === "github"
          ? [
              "Runtime target: GitHub connector.",
              selectedGithub
                ? `GitHub connector: ${selectedGithub.accountLabel || selectedGithub.provider}.`
                : "No GitHub connector selected.",
              githubRepo ? `Active repo: ${githubRepo}.` : "No repo selected yet.",
              "Prefer GitHub-aware planning; local tools only if a PC folder is open.",
            ].join("\n")
          : folderPath
            ? "Runtime target: this PC folder (local files + terminal)."
            : "Runtime target: this PC (chat/web until a folder is opened).";

    return {
      kind: (runtimeTarget === "github" && githubRepo
        ? "github"
        : folderPath
          ? "folder"
          : "none") as "folder" | "github" | "none",
      folderPath,
      repoFullName: runtimeTarget === "github" ? githubRepo || null : null,
      branch,
      gitStatus: gitStatus.slice(0, 600) || null,
      treeSummary: folderPath
        ? [dirRel ? `cwd: ${dirRel}` : "cwd: .", treeSummary].filter(Boolean).join("\n") || null
        : null,
      operatorDirectives,
      activeGoal: activeGoal.trim() || null,
      openFilePath: openFile,
      openFileContent: openFile
        ? fileContent.slice(0, fileCap) + (fileContent.length > fileCap ? "\n…(truncated)" : "")
        : null,
      recentTerminal: recentTerminal.trim() || null,
      workspaceRules: workspaceRules ? workspaceRules.slice(0, 2000) : null,
      mentions: mentions.length > 0 ? mentions : null,
      sessionNotes: [
        runtimeNote,
        notes.trim() || null,
        roster
          ? [
              "Desk coworkers (they share this laptop — coordinate, don't duplicate):",
              roster,
              activeAgentTab?.kind === "team"
                ? "You are on the Team desk — speak for the crew and use list_team when useful."
                : `You are ${selectedAgent?.name ?? "the active coworker"}; others may work in parallel tabs.`,
            ].join("\n")
          : null,
        folderPath
          ? "Desk: use list_files/search_code/read_file then apply_patch/write_file/run_terminal. Be brief. Prefer mv over delete."
          : [
              "No local folder is open.",
              "- Use web_search for live facts, docs, and research.",
              "- Answer questions, plan work, and draft text freely.",
              "- If the operator opens a folder later, you will get file/terminal tools.",
              "- Do not claim you edited local files until a folder is attached.",
            ].join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n") || null,
    };
  }

  function pauseStream() {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setSending(false);
    setAgentSteps((current) =>
      current.map((step) =>
        step.status === "running" || step.status === "pending"
          ? { ...step, status: "failed" as const }
          : step,
      ),
    );
  }

  async function onSend(event?: FormEvent, overrideContent?: string) {
    event?.preventDefault();
    const content = (overrideContent ?? draft).trim();
    if (!content || budgetExhausted) {
      return;
    }
    if (sending && !overrideContent) {
      setQueuedQuery(content);
      setDraft("");
      setMentions([]);
      return;
    }

    const runtime = resolveAiRuntime(prefs);
    if (runtime === "blocked") {
      setError(t("cloudNeedsSignIn"));
      return;
    }

    if (runtime === "local") {
      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setSending(true);
      setError(null);
      setAgentSteps([{ id: "thinking", title: "thinking", status: "running" }]);
      setPendingApproval(null);
      setStreamDraft("");
      if (!overrideContent) {
        setDraft("");
        setMentions([]);
      }
      try {
        const reply = await streamOllamaChat(
          prefs.aiLocalModel.trim(),
          [
            {
              role: "system",
              content:
                "You are Arrab Studio's local coworker on this Mac (Ollama). Be concise. Match the user's language. You cannot edit files or run shell tools in local mode.",
            },
            { role: "user", content },
          ],
          (text) => {
            if (controller.signal.aborted) return;
            setStreamDraft((current) => {
              if (!current) {
                setAgentSteps((steps) =>
                  steps.map((step) =>
                    step.id === "thinking" && step.status === "running"
                      ? { ...step, status: "done" }
                      : step,
                  ),
                );
              }
              return current + text;
            });
          },
          controller.signal,
          prefs.aiLocalBaseUrl,
        );
        if (!controller.signal.aborted && reply.trim()) {
          setStreamDraft(reply);
          setAgentSteps([]);
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : t("apiUnavailable"));
        }
      } finally {
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
        setSending(false);
      }
      return;
    }

    let activeConversation = conversation;
    if (!activeConversation) {
      activeConversation = await startSession("resume");
      if (!activeConversation) return;
    }
    const attachedMentions = overrideContent ? [] : mentions;
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setSending(true);
    setError(null);
    setAgentSteps([
      { id: "thinking", title: "thinking", status: "running" },
    ]);
    setPendingApproval(null);
    setStreamDraft("");
    if (!overrideContent) {
      setDraft("");
      setMentions([]);
    }
    const streamOnce = async (conversationId: string) => {
      let finalAssistant: Message | null = null;
      await arrabApi.sendMessageStream(
        conversationId,
        {
          content,
          spend: spendPayload,
          model: resolvePreferredModel(aiStatus, prefs),
          workspaceHint: {
            ...buildWorkspaceHint(),
            mentions: attachedMentions.length > 0 ? attachedMentions : null,
          },
        },
        {
          onToken: (text) => {
            if (controller.signal.aborted) return;
            setStreamDraft((current) => {
              if (!current) {
                setAgentSteps((steps) =>
                  steps.map((step) =>
                    step.id === "thinking" && step.status === "running"
                      ? { ...step, status: "done" }
                      : step,
                  ),
                );
              }
              return current + text;
            });
          },
          onToolStart: (name, detail) => {
            if (controller.signal.aborted) return;
            setAgentSteps((current) => [
              ...current.map((step) =>
                step.id === "thinking" && step.status === "running"
                  ? { ...step, status: "done" as const }
                  : step,
              ),
              {
                id: `tool-run-${name}-${crypto.randomUUID()}`,
                title: friendlyToolTitle(name, detail),
                detail,
                status: "running",
              },
            ]);
          },
          onTool: (name, result) => {
            if (controller.signal.aborted) return;
            const detail = result.slice(0, 2000);
            setAgentSteps((current) => {
              const runningIdx = [...current]
                .map((step, index) => ({ step, index }))
                .reverse()
                .find(
                  ({ step }) =>
                    step.status === "running" &&
                    step.title === friendlyToolTitle(name, step.detail),
                )?.index;
              const done: AgentStep = {
                id: `tool-${crypto.randomUUID()}`,
                title: friendlyToolTitle(name, detail),
                detail,
                status: detail.toLowerCase().includes("fail") ? "failed" : "done",
              };
              if (runningIdx == null) {
                return [
                  ...current.map((step) =>
                    step.id === "thinking" && step.status === "running"
                      ? { ...step, status: "done" as const }
                      : step,
                  ),
                  done,
                ];
              }
              const copy = [...current];
              copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
              return copy;
            });
          },
          onApproval: (approval) => {
            void handleIncomingApproval(approval);
          },
          onDone: (response) => {
            if (controller.signal.aborted) return;
            setProviderConfigured(response.providerConfigured);
            if (!response.providerConfigured) {
              setError(t("noProvider"));
            }
            if (response.sessionUsage) {
              setSessionUsage(response.sessionUsage);
            }
            setMessages((current) => [
              ...current,
              response.userMessage,
              ...(response.assistantMessage ? [response.assistantMessage] : []),
            ]);
            finalAssistant = response.assistantMessage;
            setStreamDraft("");
            setAgentSteps((current) =>
              current.map((step) =>
                step.status === "running" ? { ...step, status: "done" as const } : step,
              ),
            );
            if (response.approval) {
              void handleIncomingApproval(response.approval);
            }
            if (response.toolsUsed?.length) {
              setAgentSteps((current) => {
                const titles = new Set(current.map((step) => step.title.toLowerCase()));
                const extras = response.toolsUsed!.filter((name) => {
                  const friendly = friendlyToolTitle(name).toLowerCase();
                  return !titles.has(friendly) && !titles.has(name.replace(/_/g, " "));
                });
                if (extras.length === 0) return current;
                return [
                  ...current,
                  ...extras.map((name) => ({
                    id: `tool-${crypto.randomUUID()}`,
                    title: friendlyToolTitle(name),
                    detail: t("chatToolUsed").replace("{name}", name),
                    status: "done" as const,
                  })),
                ];
              });
            }
          },
          onError: (message) => {
            if (controller.signal.aborted) return;
            setAgentSteps((current) =>
              current.map((step) =>
                step.status === "running" || step.status === "pending"
                  ? { ...step, status: "failed" as const }
                  : step,
              ),
            );
            if (!isTransientApiError(message)) setError(message);
          },
        },
        controller.signal,
      );
      return finalAssistant;
    };

    try {
      await streamOnce(activeConversation.id);
      composerRef.current?.focus();
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (/unknown|not found/i.test(message)) {
        const healed = await startSession("fresh");
        if (healed) {
          try {
            setError(null);
            setStreamDraft("");
            await streamOnce(healed.id);
            composerRef.current?.focus();
            return;
          } catch (retryErr: unknown) {
            if (controller.signal.aborted) return;
            const retryMessage =
              retryErr instanceof ApiRequestError ? retryErr.message : t("apiUnavailable");
            if (!isTransientApiError(retryMessage)) setError(retryMessage);
            setDraft(content);
            return;
          }
        }
      }
      if (!isTransientApiError(message)) setError(message);
      setDraft(content);
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
        setSending(false);
        if (!controller.signal.aborted) {
          setStreamDraft("");
        }
      }
    }
  }

  async function sendQueuedNow() {
    const text = queuedQuery?.trim();
    if (!text) return;
    setQueuedQuery(null);
    pauseStream();
    await onSend(undefined, text);
  }

  async function onTerminal(event: FormEvent) {
    event.preventDefault();
    const command = terminalInput.trim();
    if (!command) {
      appendTerm("error", t("commandEmpty"));
      return;
    }
    setTerminalInput("");
    await runInFolder(command);
  }

  const showCompanions = focus === "split";
  const showChat = true;
  const showDesk = deskOpen && focus === "split";
  const runtimeSubtitle =
    runtimeTarget === "ssh"
      ? selectedSsh
        ? `${t("coworkRuntimeServer")}: ${selectedSsh.accountLabel || selectedSsh.provider}`
        : t("coworkPickSsh")
      : runtimeTarget === "github"
        ? githubRepo
          ? `${t("coworkRuntimeGithub")}: ${githubRepo}`
          : t("coworkPickGithubRepo")
        : folderPath
          ? [folderName(folderPath), branch ? branch : null].filter(Boolean).join(" · ")
          : t("coworkNoFolderHint");

  const companionAccessHint = useMemo(() => {
    if (!agentId) return t("coworkNoAccessYet");
    const saved = readCompanionAccess(agentId);
    if (runtimeTarget === "ssh" && selectedSsh) {
      return selectedSsh.accountLabel || selectedSsh.provider || t("coworkRuntimeServer");
    }
    if (runtimeTarget === "github" && githubRepo) return githubRepo;
    if (runtimeTarget === "pc" && folderPath) return folderName(folderPath);
    return accessLabel(saved, t("coworkNoAccessYet"));
  }, [agentId, folderPath, githubRepo, runtimeTarget, selectedSsh, t]);

  function selectCompanion(agent: Agent) {
    openAgentTab(agent);
  }

  function openAssignedTask(task: Task) {
    const agent =
      (task.assigneeAgentId
        ? agents.find((item) => item.id === task.assigneeAgentId)
        : null) ?? agents[0] ?? null;
    if (!agent) return;
    prepareWorkplaceDesk(agent.id, task);
    openAgentTab(agent);
    const block = [
      `CEO task: ${task.title}`,
      task.brief ? `Brief: ${task.brief}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    setNotes((current) => (current.trim() ? `${block}\n\n${current}` : block));
    setDeskTab("notes");
    setDeskOpen(true);
    setFocus("split");
  }

  function closeAgentTab(key: string) {
    setAgentTabs((current) => {
      const next = current.filter((tab) => tab.key !== key);
      if (activeTabKey === key) {
        const fallback = next[0] ?? null;
        if (fallback) {
          setActiveTabKey(fallback.key);
          if (fallback.kind === "solo" && fallback.agentId) setAgentId(fallback.agentId);
        } else {
          setActiveTabKey("solo");
        }
        setConversation(null);
        setMessages([]);
        setPendingApproval(null);
        setAgentSteps([]);
      }
      return next;
    });
    setTabMenu(null);
  }

  async function archiveAgentFromTab(agentId: string, tabKey: string) {
    setTabMenu(null);
    setSessionBusy(true);
    setAgents((current) => current.filter((agent) => agent.id !== agentId));
    closeAgentTab(tabKey);
    try {
      try {
        await arrabApi.archiveAgent(agentId);
      } catch {
        await arrabApi.updateAgent(agentId, { status: "archived" });
      }
    } catch {
      // stay removed locally
    } finally {
      setSessionBusy(false);
    }
  }

  async function deleteAgentFromTab(agentId: string, tabKey: string) {
    setTabMenu(null);
    setSessionBusy(true);
    setAgents((current) => current.filter((agent) => agent.id !== agentId));
    closeAgentTab(tabKey);
    try {
      try {
        await arrabApi.removeAgent(agentId);
      } catch {
        try {
          await arrabApi.deleteAgent(agentId);
        } catch {
          try {
            await arrabApi.archiveAgent(agentId);
          } catch {
            await arrabApi.updateAgent(agentId, { status: "archived" });
          }
        }
      }
    } catch {
      // stay removed locally — chats remain in the database
    } finally {
      setSessionBusy(false);
    }
  }

  async function hireCoworker() {
    setError(null);
    setSessionBusy(true);
    try {
      const created = await arrabApi.createAgent({
        name: t("chatSoloDefaultName"),
        role: t("chatSoloDefaultRole"),
        specialty: "general",
        status: "active",
        instructions: t("chatSoloDefaultInstructions"),
      });
      setAgents((current) => [...current, created]);
      openAgentTab(created);
      if (folderPath) {
        await startSession("resume");
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSessionBusy(false);
    }
  }

  function switchAgentTab(tab: AgentTab) {
    setActiveTabKey(tab.key);
    if (tab.kind === "solo" && tab.agentId) {
      setAgentId(tab.agentId);
    }
    setConversation(null);
    setMessages([]);
    setSessionUsage(null);
    setPendingApproval(null);
    setAgentSteps([]);
  }

  function openAgentTab(agent: Agent) {
    const key = `solo:${agent.id}`;
    setAgentTabs((current) => {
      if (current.some((tab) => tab.key === key)) return current;
      return [
        ...current.filter((tab) => tab.kind === "team"),
        ...current.filter((tab) => tab.kind === "solo"),
        { key, kind: "solo", agentId: agent.id, teamId: null, label: agent.name },
      ];
    });
    switchAgentTab({
      key,
      kind: "solo",
      agentId: agent.id,
      teamId: null,
      label: agent.name,
    });
  }

  return (
    <Surface className="cowork-shell chat-comfy cowork-friendly flex h-full flex-col overflow-hidden">
      <div className="cowork-atmosphere pointer-events-none absolute inset-0" />

      {incognitoOpen ? (
        <div className="absolute inset-0 z-50">
          <IncognitoRoom onExit={() => setIncognitoOpen(false)} />
        </div>
      ) : null}

      <header className="cowork-topbar relative z-10 flex shrink-0 items-center gap-3 px-4 py-3 lg:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[0.08em] text-neutral-500 uppercase">
            {asWorkplace
              ? `${t("plansOrganizations")} / ${t("workplace")}`
              : `${t("plansOrganizations")} / ${t("coworkTitle")}`}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[15px] font-medium tracking-[-0.02em] text-white">
              {activeAgentTab?.kind === "team"
                ? t("coworkTeamTab")
                : selectedAgent?.name ?? (asWorkplace ? t("workplaceDesk") : t("coworkTitle"))}
            </h1>
            {conversation ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-neutral-400">
                <span className="cowork-pulse size-1.5 rounded-full bg-emerald-400/90" />
                {t("sessionLive")}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (deskOpen && focus === "split") {
                setDeskOpen(false);
              } else {
                setFocus("split");
                setDeskOpen(true);
              }
            }}
            className={cn("chat-pro-icon-btn", deskOpen && focus === "split" && "is-on")}
            title={t("coworkDeskTitle")}
            aria-label={t("coworkDeskTitle")}
          >
            <PanelRight className="size-4" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {asWorkplace ? (
        <div className="relative z-10 shrink-0 border-b border-white/[0.06] px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-3.5 shrink-0 text-neutral-500" strokeWidth={1.7} />
            <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-500">
              {t("workplaceMyWork")}
            </p>
            <span className="text-[11px] text-neutral-600">
              {assignedTasks.length > 0
                ? t("workplaceMyWorkCount").replace("{count}", String(assignedTasks.length))
                : t("workplaceMyWorkEmpty")}
            </span>
          </div>
          {assignedTasks.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
              {assignedTasks.slice(0, 12).map((task) => {
                const agentName =
                  agents.find((item) => item.id === task.assigneeAgentId)?.name ?? t("coworker");
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openAssignedTask(task)}
                    className="min-w-[180px] max-w-[240px] shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                  >
                    <p className="truncate text-[12px] font-medium text-white">{task.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-neutral-500">
                      {agentName} · {task.status.replace("_", " ")}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {error && !isTransientApiError(error) ? (
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-white/8 bg-white/[0.02] px-4 py-2.5 text-xs text-neutral-400 lg:px-6">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                void boot();
              }}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              {t("retry")}
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              className="rounded-md px-2 py-1 text-[10px] text-neutral-500 transition hover:text-neutral-300"
              aria-label={t("close")}
            >
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-0 flex-1">
        <aside
          className={cn(
            "cowork-companions-rail cowork-rise hidden sm:flex",
            !showCompanions && "!hidden",
          )}
        >
          <div className="cowork-companions-head">
            <div className="min-w-0">
              <p className="text-[13px] font-medium tracking-tight text-white">{t("coworkCompanionsTitle")}</p>
              <p className="mt-0.5 truncate text-[11px] text-neutral-500">{t("coworkCompanionsHint")}</p>
            </div>
            <button
              type="button"
              onClick={() => setAgentPickerOpen((open) => !open)}
              className="chat-pro-icon-btn"
              title={t("coworkOpenAgent")}
              aria-label={t("coworkOpenAgent")}
            >
              <Plus className="size-3.5" strokeWidth={2} />
            </button>
          </div>

          {agentPickerOpen ? (
            <div className="mx-2 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface)] py-1 shadow-xl">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    selectCompanion(agent);
                    setAgentPickerOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-[12px] text-neutral-300 hover:bg-white/[0.05]"
                >
                  <PersonAvatar person={portraitForAgent(agent, workPeople)} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </button>
              ))}
              {agents.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-neutral-500">{t("coworkHireBody")}</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setAgentPickerOpen(false);
                  void hireCoworker();
                }}
                className="flex w-full items-center gap-2 border-t border-white/[0.06] px-3 py-2.5 text-start text-[12px] text-neutral-300 hover:bg-white/[0.05]"
              >
                <Plus className="size-3.5" />
                {t("coworkHireCta")}
              </button>
            </div>
          ) : null}

          <ul className="cowork-companions-list">
            {agentTabs
              .filter((tab) => tab.kind === "team")
              .map((tab) => (
                <li key={tab.key}>
                  <button
                    type="button"
                    onClick={() => switchAgentTab(tab)}
                    className={cn("cowork-companion-row", activeTabKey === tab.key && "is-on")}
                  >
                    <span className="cowork-face-ring !size-9">
                      <Users className="size-4" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-white">
                        {t("coworkTeamTab")}
                      </strong>
                      <small className="mt-0.5 block truncate text-[11px] text-neutral-500">
                        {t("coworkAgentsTogether")}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            {agents.map((agent) => {
              const saved = readCompanionAccess(agent.id);
              const access = accessLabel(saved, t("coworkNoAccessYet"));
              const isOn = agentId === agent.id && activeAgentTab?.kind !== "team";
              const portrait = portraitForAgent(agent, workPeople);
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => selectCompanion(agent)}
                    className={cn("cowork-companion-row", isOn && "is-on")}
                  >
                    <span className="cowork-companion-avatar">
                      <PersonAvatar person={portrait} active={isOn} size="md" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-white">
                        {agent.name}
                      </strong>
                      <small className="mt-0.5 block truncate text-[11px] text-neutral-500">
                        {access}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setIncognitoOpen(true)}
                className="cowork-companion-row"
              >
                <span className="cowork-face-ring cowork-face-incognito !size-9">
                  <EyeOff className="size-4" strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[13px] font-medium text-white">
                    {t("coworkIncognito")}
                  </strong>
                  <small className="mt-0.5 block truncate text-[11px] text-neutral-500">
                    {t("coworkIncognitoHint")}
                  </small>
                </span>
              </button>
            </li>
          </ul>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="cowork-access-strip">
            <div className="cowork-access-label">
              <p className="text-[11px] tracking-[0.06em] text-neutral-500 uppercase">
                {t("coworkCompanionAccess")}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-neutral-300">{companionAccessHint}</p>
            </div>
            <div className="cowork-runtime-seg">
              {(
                [
                  ["pc", t("coworkRuntimePc"), Laptop],
                  ["ssh", t("coworkRuntimeServer"), Server],
                  ["github", t("coworkRuntimeGithub"), Cable],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRuntimeTarget(id)}
                  className={cn("cowork-runtime-chip", runtimeTarget === id && "is-on")}
                >
                  <Icon className="size-3.5" strokeWidth={1.7} />
                  {label}
                </button>
              ))}
            </div>
            <div className="cowork-runtime-actions">
              {runtimeTarget === "pc" ? (
                <button
                  type="button"
                  onClick={() => void chooseFolder()}
                  className="home-btn-secondary h-8 items-center gap-1.5 px-3 text-[11px] inline-flex"
                >
                  <FolderOpen className="size-3.5" strokeWidth={1.6} />
                  {folderPath ? t("changeFolder") : t("openPcFolder")}
                </button>
              ) : null}
              {runtimeTarget === "ssh" ? (
                sshConnectors.length > 0 ? (
                  <select
                    value={selectedSsh?.id ?? ""}
                    onChange={(event) => setSshConnectorId(event.target.value)}
                    className="cowork-runtime-select"
                  >
                    {sshConnectors.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.accountLabel || item.provider}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-neutral-500">{t("coworkNeedSshConnector")}</span>
                )
              ) : null}
              {runtimeTarget === "github" ? (
                <>
                  {githubConnectors.length > 0 ? (
                    <select
                      value={selectedGithub?.id ?? ""}
                      onChange={(event) => {
                        setGithubConnectorId(event.target.value);
                        void refreshGithubRepos(event.target.value);
                      }}
                      className="cowork-runtime-select"
                    >
                      {githubConnectors.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.accountLabel || item.provider}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[11px] text-neutral-500">{t("coworkNeedGithubConnector")}</span>
                  )}
                  {githubRepos.length > 0 ? (
                    <select
                      value={githubRepo}
                      onChange={(event) => setGithubRepo(event.target.value)}
                      className="cowork-runtime-select"
                    >
                      <option value="">{t("coworkPickGithubRepo")}</option>
                      {githubRepos.map((repo) => (
                        <option key={repo.id} value={repo.fullName || repo.name}>
                          {repo.fullName || repo.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </>
              ) : null}
              <div className="hidden items-center rounded-2xl bg-white/[0.04] p-1 md:flex">
                  {(
                    [
                      ["chat", t("coworkFocusChatOnly"), MessagesSquare],
                      ["split", t("coworkFocusSplit"), Columns2],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      title={label}
                      aria-label={label}
                      onClick={() => {
                        setFocus(id);
                        if (id === "chat") {
                          setDeskOpen(false);
                        } else {
                          setDeskOpen(true);
                        }
                      }}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-xl transition-colors",
                        focus === id ? "bg-white text-black" : "text-neutral-500 hover:text-white",
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={1.7} />
                    </button>
                  ))}
                </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
          {showChat ? (
            <section
              className={cn(
                "cowork-room cowork-rise flex min-h-0 min-w-0 flex-col",
                showDesk ? "flex-[1.2]" : "flex-1",
              )}
            >
              <div className="cowork-room-header">
                <div className="cowork-room-person">
                  {activeAgentTab?.kind === "team" ? (
                    <span className="cowork-face-ring !size-10">
                      <Users className="size-4" strokeWidth={1.6} />
                    </span>
                  ) : selectedPortrait ? (
                    <PersonAvatar person={selectedPortrait} active size="md" />
                  ) : (
                    <span className="cowork-face-ring !size-10">
                      <Laptop className="size-4" strokeWidth={1.6} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <strong className="truncate">
                      {activeAgentTab?.kind === "team"
                        ? t("coworkTeamTab")
                        : selectedAgent?.name ?? t("coworker")}
                    </strong>
                    <p className="cp-muted truncate">{runtimeSubtitle}</p>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8 no-scrollbar">
                {!conversation && agents.length === 0 ? (
                  <EmptyState
                    title={t("coworkHireTitle")}
                    body={t("coworkHireBody")}
                    actionLabel={t("coworkHireCta")}
                    onAction={() => void hireCoworker()}
                    hero
                  />
                ) : null}
                {!conversation && agents.length > 0 ? (
                  <EmptyState
                    title={t("coworkEmptyTitle")}
                    body={
                      runtimeTarget === "ssh"
                        ? t("coworkSshReadyBody")
                        : runtimeTarget === "github"
                          ? t("coworkGithubReadyBody")
                          : folderPath
                            ? t("coworkPcEmpty").replace("{folder}", folderName(folderPath))
                            : t("coworkChatReadyBody")
                    }
                    actionLabel={t("startSession")}
                    onAction={() => void startSession("resume")}
                    hero
                  />
                ) : null}
                {conversation && messages.length === 0 && !sending ? (
                  <EmptyState
                    title={selectedAgent?.name ?? t("coworker")}
                    body={
                      folderPath
                        ? t("coworkPcReady").replace("{folder}", folderName(folderPath))
                        : runtimeSubtitle
                    }
                    soft
                  />
                ) : null}

                <div className="mx-auto flex max-w-2xl flex-col gap-5">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      youLabel={t("you")}
                      coworkerLabel={selectedAgent?.name ?? t("coworker")}
                    />
                  ))}
                  {(() => {
                    const arts = extractArtifacts(
                      [...messages.map((m) => m.content), streamDraft].join("\n\n"),
                    );
                    return arts.length > 0 ? (
                      <ArtifactsPanel
                        artifacts={arts}
                        emptyLabel={t("artifactsEmpty")}
                        copyLabel={t("copy")}
                        className="min-h-[180px]"
                      />
                    ) : null;
                  })()}
                  {agentSteps.length > 0 ? (
                    <AgentSteps steps={agentSteps} thinkingLabel={`${t("thinking")}…`} />
                  ) : null}
                  {pendingApproval ? (
                    <div className="rounded-2xl border border-white/[0.12] bg-[var(--color-surface)] p-4">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                        {t("chatApprovalTitle")}
                      </p>
                      <h3 className="mt-1.5 text-[15px] font-medium text-white">
                        {pendingApproval.title}
                      </h3>
                      <p className="mt-1 text-[12px] text-neutral-500">{t("chatApprovalBody")}</p>
                      {pendingApproval.detail ? (
                        <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/40 px-3 py-2 font-mono text-[12px] text-neutral-400">
                          {approvalDetailPreview(pendingApproval)}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={approvalBusy}
                          onClick={() => void resolveCoworkApproval(pendingApproval, "approved")}
                          className="h-9 rounded-full bg-white px-4 text-[12px] font-medium text-black disabled:opacity-40"
                        >
                          {approvalBusy ? t("chatApprovalResolving") : t("approve")}
                        </button>
                        <button
                          type="button"
                          disabled={approvalBusy}
                          onClick={() => void resolveCoworkApproval(pendingApproval, "rejected")}
                          className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-300 disabled:opacity-40"
                        >
                          {t("reject")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {streamDraft ? (
                    <MessageBubble
                      message={{
                        id: "stream-draft" as Message["id"],
                        conversationId: conversation?.id ?? ("pending" as Conversation["id"]),
                        role: "assistant",
                        content: streamDraft,
                        createdAt: new Date().toISOString(),
                      }}
                      youLabel={t("you")}
                      coworkerLabel={selectedAgent?.name ?? t("coworker")}
                    />
                  ) : null}
                  <div ref={chatEnd} />
                </div>
              </div>

              <form
                  onSubmit={(event) => void onSend(event)}
                  className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-[var(--color-background)]/95 via-[var(--color-background)]/60 to-transparent px-4 py-4 lg:px-10"
                >
                  <div className="mx-auto max-w-2xl space-y-3">
                    {activeGoal || goalEditorOpen ? (
                      <div className="chat-pro-goal">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <Target className="mt-0.5 size-3.5 shrink-0 text-neutral-500" strokeWidth={1.7} />
                            <div className="min-w-0">
                              <p className="chat-pro-kicker">{t("activeGoal")}</p>
                              {!goalEditorOpen ? (
                                <p className="mt-1 text-[13px] leading-relaxed text-neutral-200">
                                  {activeGoal}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          {!goalEditorOpen ? (
                            <div className="flex shrink-0 gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setGoalDraft(activeGoal);
                                  setGoalEditorOpen(true);
                                }}
                                className="text-[11px] text-neutral-500 hover:text-white"
                              >
                                {t("editGoal")}
                              </button>
                              <button
                                type="button"
                                onClick={() => applyGoal("")}
                                className="text-[11px] text-neutral-500 hover:text-white"
                              >
                                {t("markGoalDone")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {goalEditorOpen ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={goalDraft}
                              onChange={(event) => setGoalDraft(event.target.value)}
                              rows={2}
                              placeholder={t("goalPlaceholder")}
                              className="w-full resize-none rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={!goalDraft.trim()}
                                onClick={() => applyGoal(goalDraft, true)}
                                className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40"
                              >
                                {t("setGoal")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setGoalDraft(activeGoal);
                                  setGoalEditorOpen(false);
                                }}
                                className="h-8 rounded-lg px-3 text-[11px] text-neutral-400 hover:text-white"
                              >
                                {t("cancel")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="chat-pro-composer cowork-composer">
                      {queuedQuery !== null ? (
                        <QueuedQueryBar
                          className="mb-2"
                          value={queuedQuery}
                          onChange={setQueuedQuery}
                          onDiscard={() => setQueuedQuery(null)}
                          onSendNow={() => void sendQueuedNow()}
                        />
                      ) : null}
                      <MentionComposer
                        value={draft}
                        onChange={setDraft}
                        mentions={mentions}
                        onMentionsChange={setMentions}
                        agents={agents}
                        files={entries}
                        folderPath={folderPath}
                        textareaRef={composerRef}
                        disabled={false}
                        placeholder={
                          sending
                            ? t("chatQueueHint")
                            : folderPath
                              ? t("coworkMentionPlaceholder")
                              : t("coworkChatPlaceholder")
                        }
                        rows={2}
                        className="!min-h-[56px] border-0 bg-transparent px-1 py-0.5 text-[15px] leading-[1.55] tracking-[-0.01em] text-white shadow-none outline-none placeholder:text-neutral-600"
                        onSubmit={() => void onSend()}
                      />
                      {workspaceRules ? (
                        <p className="mt-1 px-1 text-[10px] text-neutral-600">
                          {t("coworkRulesLoaded")}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-0.5">
                          {!activeGoal && !goalEditorOpen ? (
                            <button
                              type="button"
                              disabled={!conversation}
                              onClick={() => {
                                setGoalDraft("");
                                setGoalEditorOpen(true);
                              }}
                              className="chat-pro-icon-btn"
                              title={t("setGoal")}
                              aria-label={t("setGoal")}
                            >
                              <Target className="size-4" strokeWidth={1.6} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setFocus("split");
                              setDeskOpen(true);
                            }}
                            className="chat-pro-icon-btn"
                            title={t("coworkDeskTitle")}
                            aria-label={t("coworkDeskTitle")}
                          >
                            <PanelRight className="size-4" strokeWidth={1.6} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center rounded-full bg-white/[0.04] p-0.5">
                            <button
                              type="button"
                              onClick={() => applyTerminalPolicy("ask")}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition",
                                terminalPolicy === "ask"
                                  ? "bg-white text-black"
                                  : "text-neutral-500 hover:text-neutral-300",
                              )}
                              title={t("coworkAskApproval")}
                            >
                              <ShieldQuestion className="size-3.5" strokeWidth={1.8} />
                              {t("coworkAskApproval")}
                            </button>
                            <button
                              type="button"
                              onClick={() => applyTerminalPolicy("allow")}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition",
                                terminalPolicy === "allow"
                                  ? "bg-white text-black"
                                  : "text-neutral-500 hover:text-neutral-300",
                              )}
                              title={t("coworkAllowEverything")}
                            >
                              <ShieldCheck className="size-3.5" strokeWidth={1.8} />
                              {t("coworkAllowEverything")}
                            </button>
                          </div>
                          {sending && !draft.trim() ? (
                            <PauseSendButton onPause={pauseStream} />
                          ) : (
                            <button
                              type="submit"
                              disabled={draft.trim() === "" || sessionBusy || budgetExhausted}
                              className="inline-flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200 disabled:opacity-25"
                              aria-label={sending ? t("chatQueuedLabel") : t("send")}
                              title={prefs.coworkEnterSend ? t("pressEnter") : t("shiftEnterSend")}
                            >
                              <ArrowUp className="size-3.5" strokeWidth={2.2} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
            </section>
          ) : null}

          {showDesk ? (
            <aside className="cowork-desk-panel cowork-rise cowork-rise-delay desk-panel flex w-[280px] shrink-0 flex-col xl:w-[300px]">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
                <p className="text-[13px] font-medium tracking-tight text-white">
                  {t("coworkDeskTitle")}
                </p>
                <button
                  type="button"
                  onClick={() => setDeskOpen(false)}
                  className="chat-pro-icon-btn"
                  title={t("close")}
                  aria-label={t("close")}
                >
                  <X className="size-3.5" strokeWidth={1.7} />
                </button>
              </div>
              <div className="border-b border-white/[0.06] px-3 pb-2.5 pt-2">
                <nav className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.03] p-0.5">
                  {(
                    [
                      ["run", t("runTab")],
                      ["notes", t("notesTab")],
                      ["restore", t("restoreTab")],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDeskTab(id)}
                      className={cn(
                        "h-8 rounded-lg text-[10px] font-medium transition-colors",
                        deskTab === id
                          ? "bg-white text-black"
                          : "text-neutral-500 hover:text-neutral-200",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3 no-scrollbar">
                {!folderPath && runtimeTarget !== "ssh" && deskTab !== "notes" && deskTab !== "run" ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
                    <p className="text-[12px] text-neutral-500">{t("coworkDeskNeedsFolder")}</p>
                    <button
                      type="button"
                      onClick={() => void chooseFolder()}
                      className="mt-3 home-btn-secondary h-8 px-3 text-[11px]"
                    >
                      {t("openPcFolder")}
                    </button>
                  </div>
                ) : null}
                {runtimeTarget === "ssh" && !selectedSsh && deskTab === "run" ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
                    <p className="text-[12px] text-neutral-500">{t("coworkNeedSshConnector")}</p>
                  </div>
                ) : null}
                {deskTab === "run" && (folderPath || (runtimeTarget === "ssh" && selectedSsh)) ? (
                  <div className="desk-card space-y-3 p-3.5">
                    <div>
                      <p className="text-[13px] font-medium text-white">{t("runPresets")}</p>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        {runtimeTarget === "ssh" ? t("coworkSshRunBody") : t("runPresetsBody")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {RUN_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={terminalBusy || (runtimeTarget === "pc" && !folderPath) || (runtimeTarget === "ssh" && !selectedSsh)}
                          onClick={() => void runInFolder(preset.command, t(preset.labelKey))}
                          className="home-btn-secondary inline-flex h-9 items-center gap-1.5 px-3 text-[11px] disabled:opacity-40"
                        >
                          <Play className="size-3" />
                          {t(preset.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {deskTab === "notes" ? (
                  <div className="space-y-3">
                    <label className="desk-card grid gap-2 p-3.5">
                      <span className="text-[13px] font-medium text-white">{t("sessionNotes")}</span>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={12}
                        className="min-h-[220px] w-full resize-none rounded-2xl border border-white/[0.07] bg-black/25 px-3 py-3 text-[13px] leading-relaxed text-neutral-200 outline-none focus:border-white/18"
                      />
                      <p className="text-[11px] text-neutral-600">
                        {t("linkedProject")}: {linkedProject?.name ?? t("none")}
                      </p>
                    </label>
                    <div className="desk-card p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium text-white">{t("activeGoal")}</p>
                        {activeGoal ? (
                          <button
                            type="button"
                            onClick={() => applyGoal("")}
                            className="text-[12px] text-neutral-400 hover:text-white"
                          >
                            {t("markGoalDone")}
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">
                        {activeGoal || t("goalHint")}
                      </p>
                      {!activeGoal ? (
                        <button
                          type="button"
                          disabled={!conversation}
                          onClick={() => {
                            setGoalDraft("");
                            setGoalEditorOpen(true);
                          }}
                          className="home-btn-secondary mt-3 inline-flex h-9 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"
                        >
                          <Target className="size-3.5" strokeWidth={1.8} />
                          {t("setGoal")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {deskTab === "restore" && folderPath ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                        {t("restoreTab")}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500">{t("restoreHint")}</p>
                      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                        {checkpoints.length === 0 ? (
                          <li className="text-[12px] text-neutral-600">{t("restoreEmpty")}</li>
                        ) : (
                          checkpoints.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2"
                            >
                              <p className="truncate text-[12px] text-white">{item.path}</p>
                              <p className="mt-0.5 text-[10px] text-neutral-500">
                                {item.reason} · {new Date(item.createdAt).toLocaleString()}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  void restoreEditCheckpoint(item.id).then((result) => {
                                    if (result.ok) {
                                      setCheckpoints(listEditCheckpoints(folderPath));
                                      void refreshFiles();
                                      if (openFile === item.path) {
                                        void readTextFile(folderPath!, item.path).then((file) => {
                                          setFileContent(file.content);
                                          setFileDirty(false);
                                        });
                                      }
                                      appendTerm("system", result.message);
                                    } else {
                                      setError(result.message);
                                    }
                                  });
                                }}
                                className="mt-2 rounded-full bg-white px-2.5 py-1 text-[10px] text-black"
                              >
                                {t("restoreCheckpoint")}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                    {workspaceRules ? (
                      <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                          {t("coworkRulesTitle")}
                        </p>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-neutral-400">
                          {workspaceRules.slice(0, 2000)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      </div>

      {tabMenu ? (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setTabMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setTabMenu(null);
          }}
        >
          <div
            className="absolute min-w-[168px] overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface)] py-1 shadow-2xl"
            style={{ left: tabMenu.x, top: tabMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-neutral-300 hover:bg-white/[0.05]"
              onClick={() => closeAgentTab(tabMenu.key)}
            >
              <X className="size-3.5" strokeWidth={1.7} />
              {t("coworkCloseTab")}
            </button>
            {tabMenu.agentId ? (
              tabMenu.confirmDelete ? (
                <>
                  <p className="px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
                    {t("chatKeepsInDatabase")}
                  </p>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-neutral-200 hover:bg-white/[0.05]"
                    onClick={() => void archiveAgentFromTab(tabMenu.agentId!, tabMenu.key)}
                  >
                    <Archive className="size-3.5" strokeWidth={1.7} />
                    {t("chatArchiveAgent")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-red-300 hover:bg-white/[0.05]"
                    onClick={() => void deleteAgentFromTab(tabMenu.agentId!, tabMenu.key)}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.7} />
                    {t("chatDeleteForever")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-red-300/90 hover:bg-white/[0.05]"
                  onClick={() => setTabMenu({ ...tabMenu, confirmDelete: true })}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.7} />
                  {t("chatDeleteAgent")}
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </Surface>
  );
}

function MessageBubble({
  message,
  youLabel,
  coworkerLabel,
}: {
  message: Message;
  youLabel: string;
  coworkerLabel: string;
}) {
  const isUser = message.role === "user";
  return (
    <article className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <p className="text-[11px] tracking-wide text-neutral-600">
        {isUser ? youLabel : coworkerLabel}
      </p>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed",
          isUser
            ? "rounded-br-md bg-white text-black"
            : "rounded-bl-md border border-white/10 bg-white/[0.035] text-neutral-200",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </article>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  hero = false,
  soft = false,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  hero?: boolean;
  soft?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center px-6 text-center",
        hero ? "py-20" : soft ? "py-14" : "py-16",
      )}
    >
      <div
        className={cn(
          "mb-5 flex items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]",
          hero ? "size-16" : "size-14",
        )}
      >
        <Users
          className={cn(hero ? "size-6" : "size-5", "text-neutral-300")}
          strokeWidth={1.5}
        />
      </div>
      <h2
        className={cn(
          "font-semibold tracking-[-0.035em] text-white",
          hero ? "text-[26px]" : "text-[20px]",
        )}
      >
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-neutral-500">{body}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="home-btn-primary mt-6 inline-flex h-11 items-center gap-2 px-5 text-[13px]">
          <FolderOpen className="size-4" />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
