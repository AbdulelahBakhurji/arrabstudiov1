import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Bot,
  Brain,
  Code2,
  FolderOpen,
  Github,
  GraduationCap,
  MessageSquarePlus,
  NotebookPen,
  PanelLeft,
  Play,
  Settings2,
  SquareTerminal,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import type {
  Agent,
  Approval,
  ConnectorPublic,
  ConnectorResource,
  Conversation,
  Memory,
  Message,
  Project,
  ProjectRepoBinding,
  SessionUsageSnapshot,
  Skill,
  Team,
  TokenSpendTier,
  WorkspaceHint,
} from "@arrab/shared";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useStudioPrefs } from "@/hooks/useStudioPrefs";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { LAST_CHAT_AGENT_KEY } from "@/lib/prefs";
import {
  executeLocalAgentTool,
  isAutoClientTool,
  isClientExecTool,
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
} from "@/lib/agent-local-tools";
import { isTauriRuntime, pickFolder, runLocalCommand, type TerminalLine } from "@/lib/terminal";
import { loadWorkspaceRules } from "@/lib/workspace-rules";
import { cn } from "@/lib/utils";

type FocusMode = "chat" | "split" | "terminal";
type WorkspaceKind = "none" | "folder" | "github";
type DeskTab = "agent" | "overview" | "project" | "code" | "git" | "notes";
type ChatMode = "solo" | "team";
type ToolTrace = { id: string; name: string; result: string };

const SOLO_PRESETS = [
  {
    id: "coding",
    specialty: "Full-stack coding",
    role: "Software engineer",
    instructions:
      "Write clean code, propose concrete diffs, run checks before claiming done, and explain tradeoffs briefly.",
  },
  {
    id: "research",
    specialty: "Research & analysis",
    role: "Researcher",
    instructions:
      "Dig for primary facts, cite assumptions, prefer concise bullets, and flag uncertainty clearly.",
  },
  {
    id: "writing",
    specialty: "Product writing",
    role: "Writer",
    instructions:
      "Match the operator's voice, keep copy crisp, and offer 2–3 variants when useful.",
  },
  {
    id: "ops",
    specialty: "Ops & automation",
    role: "Operator",
    instructions:
      "Prefer checklists, safe rollbacks, and verifiable commands. Never invent system access.",
  },
] as const;

type WorkspaceState = {
  kind: WorkspaceKind;
  folderPath: string | null;
  repoFullName: string | null;
  connectorId: string | null;
  branch: string | null;
};

const WORKSPACE_KEY = "arrab.chat.workspace";
const OPS_KEY = "arrab.workforce.ops";
const SPEND_KEY = "arrab.chatSpend";
const GOAL_KEY_PREFIX = "arrab.chatGoal.";

const DEFAULT_SESSION_BUDGETS: Record<TokenSpendTier, number> = {
  low: 5_000,
  medium: 12_000,
  high: 40_000,
};

function readSpendPrefs(): { tier: TokenSpendTier; budgetInput: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(SPEND_KEY) ?? "null") as {
      tier?: TokenSpendTier;
      budgetInput?: string;
    } | null;
    const tier =
      saved?.tier === "medium" || saved?.tier === "high" || saved?.tier === "low"
        ? saved.tier
        : "low";
    return {
      tier,
      budgetInput:
        typeof saved?.budgetInput === "string"
          ? saved.budgetInput
          : String(DEFAULT_SESSION_BUDGETS[tier]),
    };
  } catch {
    return { tier: "low", budgetInput: String(DEFAULT_SESSION_BUDGETS.low) };
  }
}

function parseBudgetInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.min(Math.floor(n), 2_000_000);
}

function readWorkspace(): WorkspaceState {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "null") as WorkspaceState | null;
    return (
      saved ?? {
        kind: "none",
        folderPath: null,
        repoFullName: null,
        connectorId: null,
        branch: null,
      }
    );
  } catch {
    return {
      kind: "none",
      folderPath: null,
      repoFullName: null,
      connectorId: null,
      branch: null,
    };
  }
}

function highRiskEnabled(): boolean {
  try {
    const ops = JSON.parse(localStorage.getItem(OPS_KEY) ?? "null") as {
      highRiskDual?: boolean;
    } | null;
    return ops?.highRiskDual !== false;
  } catch {
    return true;
  }
}

export function ChatPage() {
  const { t } = useLanguage();
  const prefs = useStudioPrefs();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>("solo");
  const [teamId, setTeamId] = useState("");
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [repoBinding, setRepoBinding] = useState<ProjectRepoBinding | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
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
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [spendTier, setSpendTier] = useState<TokenSpendTier>(() => readSpendPrefs().tier);
  const [budgetInput, setBudgetInput] = useState(() => readSpendPrefs().budgetInput);
  const [sessionUsage, setSessionUsage] = useState<SessionUsageSnapshot | null>(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalTall, setTerminalTall] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [deskTab, setDeskTab] = useState<DeskTab>("agent");
  const [focus, setFocus] = useState<FocusMode>("chat");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [ecoMode, setEcoMode] = useState(() => readSpendPrefs().tier === "low");
  const [projectPickId, setProjectPickId] = useState("");
  const [cmdDraft, setCmdDraft] = useState("");
  const [soloDraft, setSoloDraft] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileRole, setProfileRole] = useState("");
  const [profileSpecialty, setProfileSpecialty] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileInstructions, setProfileInstructions] = useState("");
  const [agentSkills, setAgentSkills] = useState<Skill[]>([]);
  const [agentMemories, setAgentMemories] = useState<Memory[]>([]);
  const [skillTitle, setSkillTitle] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [agentSaving, setAgentSaving] = useState(false);
  const [chatMenu, setChatMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    { id: "sys-1", kind: "system", text: t("terminalReady") },
  ]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => readWorkspace());
  const [workspaceRules, setWorkspaceRules] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState("");
  const [treeSummary, setTreeSummary] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [commitPath, setCommitPath] = useState("NOTES.md");
  const [commitContent, setCommitContent] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("");
  const [gitBusy, setGitBusy] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repoOptions, setRepoOptions] = useState<ConnectorResource[]>([]);
  const [pickerConnectorId, setPickerConnectorId] = useState("");
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const termEnd = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === teamId) ?? null,
    [teamId, teams],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agentId, agents],
  );

  const linkedProject = useMemo(() => {
    const id = selectedAgent?.projectId ?? conversation?.projectId;
    return projects.find((project) => project.id === id) ?? null;
  }, [conversation?.projectId, projects, selectedAgent?.projectId]);

  const workspaceLabel = useMemo(() => {
    if (workspace.kind === "folder" && workspace.folderPath) {
      return workspace.folderPath;
    }
    if (workspace.kind === "github" && workspace.repoFullName) {
      return `${workspace.repoFullName}${workspace.branch ? `@${workspace.branch}` : ""}`;
    }
    return t("noWorkspaceYet");
  }, [t, workspace]);

  const spendPayload = useMemo(
    () => ({
      tier: spendTier,
      sessionTokenBudget: parseBudgetInput(budgetInput),
    }),
    [budgetInput, spendTier],
  );

  const budgetExhausted =
    sessionUsage?.budget !== null &&
    sessionUsage?.budget !== undefined &&
    (sessionUsage.remaining ?? 0) <= 0;

  const spendUsedRatio = useMemo(() => {
    if (!sessionUsage?.budget || sessionUsage.budget <= 0) {
      return null;
    }
    return Math.min(1, sessionUsage.totalTokens / sessionUsage.budget);
  }, [sessionUsage]);

  const quickPrompts = useMemo(
    () => [
      t("chatQuickReview"),
      t("chatQuickCommit"),
      t("chatQuickPlan"),
      t("chatQuickExplain"),
    ],
    [t],
  );

  useEffect(() => {
    localStorage.setItem(
      SPEND_KEY,
      JSON.stringify({ tier: spendTier, budgetInput }),
    );
  }, [budgetInput, spendTier]);

  const boot = useCallback(async () => {
    setError(null);
    setSessionBusy(true);
    try {
      const preferred =
        sessionStorage.getItem("arrab.chatAgent") ?? sessionStorage.getItem("arrab.coworkAgent");
      if (preferred) {
        sessionStorage.removeItem("arrab.chatAgent");
        sessionStorage.removeItem("arrab.coworkAgent");
      }
      const preferredTeam = sessionStorage.getItem("arrab.chatTeam");
      if (preferredTeam) {
        sessionStorage.removeItem("arrab.chatTeam");
      }
      const preferredFocus =
        sessionStorage.getItem("arrab.chatFocus") ?? sessionStorage.getItem("arrab.coworkFocus");
      if (preferredFocus === "terminal" || preferredFocus === "chat" || preferredFocus === "split") {
        sessionStorage.removeItem("arrab.chatFocus");
        sessionStorage.removeItem("arrab.coworkFocus");
        setFocus(preferredFocus);
      }

      const [agentList, teamList, projectList, conversationList, ai, connectorList] =
        await Promise.all([
          arrabApi.agents(),
          arrabApi.teams(),
          arrabApi.projects(),
          arrabApi.conversations(),
          arrabApi.aiStatus(),
          arrabApi.connectors(),
        ]);

      let active = agentList.items.filter((agent) => agent.status !== "archived");
      if (active.length === 0) {
        const solo = await arrabApi.createAgent({
          name: t("chatSoloDefaultName"),
          role: t("chatSoloDefaultRole"),
          specialty: "general",
          instructions: t("chatSoloDefaultInstructions"),
          status: "active",
        });
        active = [solo];
      }

      setAgents(active);
      setTeams(teamList.items);
      setProjects(projectList.items);
      const connected = connectorList.items.filter((item) => item.status === "connected");
      setConnectors(connected);
      setPickerConnectorId((current) => current || connected[0]?.id || "");
      setProviderConfigured(ai.configured);

      const threads = [...conversationList.items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setConversations(threads);

      const lastAgent = prefs.coworkAutoResume ? localStorage.getItem(LAST_CHAT_AGENT_KEY) : null;
      const preferredAgentId =
        (preferred && active.some((agent) => agent.id === preferred) && preferred) ||
        (lastAgent && active.some((agent) => agent.id === lastAgent) && lastAgent) ||
        active[0]?.id ||
        "";

      setAgentId(preferredAgentId);

      const prefsSpend = readSpendPrefs();
      const spend = {
        tier: prefsSpend.tier,
        sessionTokenBudget: parseBudgetInput(prefsSpend.budgetInput),
      };

      const teamExists =
        preferredTeam && teamList.items.some((team) => team.id === preferredTeam)
          ? preferredTeam
          : "";

      if (teamExists) {
        setChatMode("team");
        setTeamId(teamExists);
      } else if (teamList.items[0]) {
        setTeamId(teamList.items[0].id);
      }

      let target =
        (teamExists
          ? threads.find((item) => item.teamId === teamExists)
          : null) ??
        (preferred
          ? threads.find((item) => item.agentId === preferred && !item.teamId)
          : null) ??
        threads.find((item) => item.agentId === preferredAgentId) ??
        threads[0] ??
        null;

      if (!target) {
        if (teamExists) {
          target = await arrabApi.createConversation({
            teamId: teamExists,
            title: t("chatNewChat"),
            spend,
          });
        } else if (preferredAgentId) {
          target = await arrabApi.createConversation({
            agentId: preferredAgentId,
            projectId: active.find((agent) => agent.id === preferredAgentId)?.projectId ?? null,
            title: t("chatNewChat"),
            spend,
          });
        }
        if (target) {
          setConversations((current) => [
            target!,
            ...current.filter((item) => item.id !== target!.id),
          ]);
        }
      }

      if (target) {
        const detail = await arrabApi.conversation(target.id);
        setConversation(detail.conversation);
        setMessages(detail.messages);
        setSessionUsage(detail.sessionUsage);
        setSpendTier(detail.conversation.spendTier ?? "low");
        setBudgetInput(
          detail.conversation.sessionTokenBudget === null ||
            detail.conversation.sessionTokenBudget === undefined
            ? ""
            : String(detail.conversation.sessionTokenBudget),
        );
        if (detail.conversation.agentId) {
          setAgentId(detail.conversation.agentId);
        }
        if (detail.conversation.teamId) {
          setChatMode("team");
          setTeamId(detail.conversation.teamId);
        }
        setEcoMode((detail.conversation.spendTier ?? "low") === "low");
        setToolTraces([]);
        setPendingApproval(null);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSessionBusy(false);
    }
  }, [prefs.coworkAutoResume, t]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    localStorage.setItem(LAST_CHAT_AGENT_KEY, agentId);
  }, [agentId]);

  useEffect(() => {
    if (!selectedAgent) {
      setProfileName("");
      setProfileRole("");
      setProfileSpecialty("");
      setProfileBio("");
      setProfileInstructions("");
      return;
    }
    setProfileName(selectedAgent.name);
    setProfileRole(selectedAgent.role);
    setProfileSpecialty(selectedAgent.specialty ?? "");
    setProfileBio(selectedAgent.bio ?? "");
    setProfileInstructions(selectedAgent.instructions ?? "");
  }, [selectedAgent]);

  useEffect(() => {
    if (!agentId) {
      setAgentSkills([]);
      setAgentMemories([]);
      return;
    }
    let cancelled = false;
    void Promise.all([arrabApi.skills(agentId), arrabApi.memories()])
      .then(([skills, memories]) => {
        if (cancelled) return;
        setAgentSkills(skills.items);
        setAgentMemories(memories.items.filter((item) => item.agentId === agentId));
      })
      .catch(() => {
        if (!cancelled) {
          setAgentSkills([]);
          setAgentMemories([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const visibleConversations = useMemo(() => {
    if (chatMode === "team") {
      return conversations.filter((item) => item.teamId);
    }
    if (agentId) {
      return conversations.filter((item) => !item.teamId && item.agentId === agentId);
    }
    return conversations.filter((item) => !item.teamId);
  }, [agentId, chatMode, conversations]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!linkedProject) {
      setRepoBinding(null);
      return;
    }
    let cancelled = false;
    void arrabApi
      .projectRepo(linkedProject.id)
      .then((result) => {
        if (!cancelled) {
          setRepoBinding(result.item);
          if (result.item && workspace.kind === "none") {
            setWorkspace({
              kind: "github",
              folderPath: null,
              repoFullName: result.item.repoFullName,
              connectorId: result.item.connectorId,
              branch: result.item.defaultBranch,
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepoBinding(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [linkedProject, workspace.kind]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    const saved = prefs.privacyLocalNotes
      ? sessionStorage.getItem(`arrab.chatNotes.${agentId}`)
      : null;
    const taskRaw = sessionStorage.getItem("arrab.chatTask") ?? sessionStorage.getItem("arrab.coworkTask");
    if (taskRaw) {
      sessionStorage.removeItem("arrab.chatTask");
      sessionStorage.removeItem("arrab.coworkTask");
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
      sessionStorage.removeItem(`arrab.chatNotes.${agentId}`);
      return;
    }
    sessionStorage.setItem(`arrab.chatNotes.${agentId}`, notes);
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
    if (!composerMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!composerMenuRef.current?.contains(event.target as Node)) {
        setComposerMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setComposerMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [composerMenuOpen]);

  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatMenu]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, toolTraces, pendingApproval]);

  useEffect(() => {
    termEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  const refreshConversations = useCallback(async () => {
    const list = await arrabApi.conversations();
    const threads = [...list.items].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    setConversations(threads);
    return threads;
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      setSessionBusy(true);
      setError(null);
      try {
        const detail = await arrabApi.conversation(id);
        setConversation(detail.conversation);
        setMessages(detail.messages);
        setSessionUsage(detail.sessionUsage);
        setSpendTier(detail.conversation.spendTier ?? "low");
        setEcoMode((detail.conversation.spendTier ?? "low") === "low");
        setBudgetInput(
          detail.conversation.sessionTokenBudget === null ||
            detail.conversation.sessionTokenBudget === undefined
            ? ""
            : String(detail.conversation.sessionTokenBudget),
        );
        if (detail.conversation.agentId) {
          setAgentId(detail.conversation.agentId);
        }
        if (detail.conversation.teamId) {
          setChatMode("team");
          setTeamId(detail.conversation.teamId);
        } else {
          setChatMode("solo");
        }
        if (detail.conversation.projectId) {
          setProjectPickId(detail.conversation.projectId);
        }
        setToolTraces([]);
        setPendingApproval(null);
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setSessionBusy(false);
      }
    },
    [t],
  );

  const newChat = useCallback(async () => {
    setSessionBusy(true);
    setError(null);
    try {
      let created: Conversation;
      if (chatMode === "team") {
        const pick = teamId || teams[0]?.id || "";
        if (!pick) {
          setError(t("chatNeedTeamFirst"));
          return;
        }
        created = await arrabApi.createConversation({
          teamId: pick,
          title: t("chatNewChat"),
          spend: spendPayload,
        });
        setTeamId(pick);
      } else {
        let soloId = agentId || agents[0]?.id || "";
        if (!soloId) {
          const solo = await arrabApi.createAgent({
            name: soloDraft.trim() || t("chatSoloDefaultName"),
            role: t("chatSoloDefaultRole"),
            specialty: "general",
            instructions: t("chatSoloDefaultInstructions"),
            status: "active",
          });
          setAgents((current) => [solo, ...current]);
          soloId = solo.id;
          setSoloDraft("");
          created = await arrabApi.createConversation({
            agentId: soloId,
            projectId: solo.projectId,
            title: t("chatNewChat"),
            spend: spendPayload,
          });
        } else {
          created = await arrabApi.createConversation({
            agentId: soloId,
            projectId: agents.find((agent) => agent.id === soloId)?.projectId ?? null,
            title: t("chatNewChat"),
            spend: spendPayload,
          });
        }
        setAgentId(soloId);
      }
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setConversation(created);
      setMessages([]);
      setSessionUsage(null);
      setToolTraces([]);
      setPendingApproval(null);
      if (created.agentId) setAgentId(created.agentId);
      composerRef.current?.focus();
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setSessionBusy(false);
    }
  }, [agentId, agents, chatMode, soloDraft, spendPayload, t, teamId, teams]);

  const deleteChat = useCallback(
    async (id: string) => {
      setChatMenu(null);
      setSessionBusy(true);
      setError(null);
      try {
        await arrabApi.deleteConversation(id);
        const remaining = conversations.filter((item) => item.id !== id);
        setConversations(remaining);
        if (conversation?.id === id) {
          const nextVisible =
            chatMode === "team"
              ? remaining.filter((item) => item.teamId)
              : remaining.filter(
                  (item) => !item.teamId && (!agentId || item.agentId === agentId),
                );
          if (nextVisible[0]) {
            await openConversation(nextVisible[0].id);
          } else {
            setConversation(null);
            setMessages([]);
            setSessionUsage(null);
            setToolTraces([]);
            setPendingApproval(null);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setSessionBusy(false);
      }
    },
    [agentId, chatMode, conversation?.id, conversations, openConversation, t],
  );

  const saveAgentProfile = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!agentId || !profileName.trim()) return;
      setAgentSaving(true);
      setError(null);
      try {
        const updated = await arrabApi.updateAgent(agentId, {
          name: profileName.trim(),
          role: profileRole.trim() || t("chatSoloDefaultRole"),
          specialty: profileSpecialty.trim() || null,
          bio: profileBio.trim() || null,
          instructions: profileInstructions.trim() || null,
        });
        setAgents((current) =>
          current.map((agent) => (agent.id === updated.id ? updated : agent)),
        );
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setAgentSaving(false);
      }
    },
    [
      agentId,
      profileBio,
      profileInstructions,
      profileName,
      profileRole,
      profileSpecialty,
      t,
    ],
  );

  const applySoloPreset = useCallback((presetId: (typeof SOLO_PRESETS)[number]["id"]) => {
    const preset = SOLO_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setProfileRole(preset.role);
    setProfileSpecialty(preset.specialty);
    setProfileInstructions(preset.instructions);
    if (!profileName.trim() || profileName === t("chatSoloDefaultName")) {
      setProfileName(preset.specialty);
    }
  }, [profileName, t]);

  const teachSkill = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!agentId || !skillTitle.trim()) return;
      setAgentSaving(true);
      setError(null);
      try {
        const result = await arrabApi.createSkill({
          agentId,
          title: skillTitle.trim(),
          instructions: skillInstructions.trim() || skillTitle.trim(),
          createTask: false,
        });
        setAgentSkills((current) => [result.skill, ...current]);
        setSkillTitle("");
        setSkillInstructions("");
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setAgentSaving(false);
      }
    },
    [agentId, skillInstructions, skillTitle, t],
  );

  const removeSkill = useCallback(
    async (id: string) => {
      setAgentSaving(true);
      try {
        await arrabApi.deleteSkill(id);
        setAgentSkills((current) => current.filter((skill) => skill.id !== id));
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setAgentSaving(false);
      }
    },
    [t],
  );

  const saveMemory = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!agentId || !memoryDraft.trim()) return;
      setAgentSaving(true);
      setError(null);
      try {
        const memory = await arrabApi.createMemory({
          agentId,
          content: memoryDraft.trim(),
        });
        setAgentMemories((current) => [memory, ...current]);
        setMemoryDraft("");
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setAgentSaving(false);
      }
    },
    [agentId, memoryDraft, t],
  );

  const removeMemory = useCallback(
    async (id: string) => {
      setAgentSaving(true);
      try {
        await arrabApi.deleteMemory(id);
        setAgentMemories((current) => current.filter((memory) => memory.id !== id));
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setAgentSaving(false);
      }
    },
    [t],
  );

  const switchSoloAgent = useCallback(
    async (nextAgentId: string) => {
      if (!nextAgentId || nextAgentId === agentId) return;
      setAgentId(nextAgentId);
      const existing = conversations.find(
        (item) => item.agentId === nextAgentId && !item.teamId,
      );
      if (existing) {
        await openConversation(existing.id);
        return;
      }
      setSessionBusy(true);
      setError(null);
      try {
        const created = await arrabApi.createConversation({
          agentId: nextAgentId,
          projectId: agents.find((agent) => agent.id === nextAgentId)?.projectId ?? null,
          title: t("chatNewChat"),
          spend: spendPayload,
        });
        setConversations((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ]);
        setConversation(created);
        setMessages([]);
        setSessionUsage(null);
        setToolTraces([]);
        setPendingApproval(null);
      } catch (err: unknown) {
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      } finally {
        setSessionBusy(false);
      }
    },
    [agentId, agents, conversations, openConversation, spendPayload, t],
  );

  useEffect(() => {
    if (workspace.kind === "folder" && workspace.folderPath && isTauriRuntime()) {
      void loadWorkspaceRules(workspace.folderPath).then(setWorkspaceRules);
    } else {
      setWorkspaceRules(null);
    }
  }, [workspace.folderPath, workspace.kind]);

  const buildHint = useCallback((): WorkspaceHint | null => {
    let operatorDirectives: string | null = null;
    try {
      const raw = JSON.parse(localStorage.getItem("arrab.workforce.directives") ?? "[]") as Array<{
        text?: string;
      }>;
      const lines = raw.map((item) => item.text?.trim()).filter(Boolean) as string[];
      operatorDirectives = lines.length > 0 ? lines.slice(0, 8).join("\n") : null;
    } catch {
      operatorDirectives = null;
    }
    const sessionNotes = notes.trim() || null;
    const goal = activeGoal.trim() || null;
    if (
      workspace.kind === "none" &&
      !sessionNotes &&
      !operatorDirectives &&
      !goal &&
      !workspaceRules
    ) {
      return null;
    }
    return {
      kind: workspace.kind === "folder" ? "folder" : workspace.kind === "github" ? "github" : "none",
      folderPath: workspace.folderPath,
      repoFullName: workspace.repoFullName,
      branch: workspace.branch,
      gitStatus: gitStatus || null,
      treeSummary: treeSummary || null,
      sessionNotes,
      operatorDirectives,
      activeGoal: goal,
      workspaceRules,
      recentTerminal:
        lines
          .slice(-20)
          .map((line) => `${line.kind === "input" ? "$ " : ""}${line.text}`.slice(0, 400))
          .join("\n")
          .trim() || null,
    };
  }, [activeGoal, gitStatus, lines, notes, treeSummary, workspace, workspaceRules]);

  async function refreshGitStatus() {
    setGitBusy(true);
    setError(null);
    try {
      if (workspace.kind === "folder" && workspace.folderPath) {
        if (!isTauriRuntime()) {
          setError(t("folderNeedsDesktop"));
          return;
        }
        const status = await runLocalCommand("git status -sb && git diff --stat", workspace.folderPath);
        const text = [status.stdout, status.stderr].filter(Boolean).join("\n").trim();
        setGitStatus(text || t("gitClean"));
        const branch = await runLocalCommand("git rev-parse --abbrev-ref HEAD", workspace.folderPath);
        if (branch.code === 0 && branch.stdout.trim()) {
          setWorkspace((current) => ({ ...current, branch: branch.stdout.trim() }));
        }
        return;
      }
      if (workspace.kind === "github" && workspace.repoFullName && workspace.connectorId) {
        const [owner, repo] = workspace.repoFullName.split("/");
        if (!owner || !repo) {
          return;
        }
        const [meta, tree] = await Promise.all([
          arrabApi.githubRepoMeta(owner, repo, workspace.connectorId),
          arrabApi.githubTree(owner, repo, workspace.connectorId, workspace.branch ?? undefined),
        ]);
        setWorkspace((current) => ({
          ...current,
          branch: current.branch || meta.defaultBranch,
        }));
        const sample = tree.entries
          .filter((entry) => entry.type === "blob")
          .slice(0, 40)
          .map((entry) => entry.path)
          .join("\n");
        setTreeSummary(sample);
        setGitStatus(
          [
            `Remote ${meta.fullName}`,
            `Default branch: ${meta.defaultBranch}`,
            `Showing tree @ ${tree.ref}${tree.truncated ? " (truncated)" : ""}`,
            `${tree.entries.length} entries loaded`,
          ].join("\n"),
        );
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setGitBusy(false);
    }
  }

  useEffect(() => {
    if (workspace.kind === "none") {
      setGitStatus("");
      setTreeSummary("");
      return;
    }
    void refreshGitStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.kind, workspace.folderPath, workspace.repoFullName, workspace.connectorId]);

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
      setWorkspace({
        kind: "folder",
        folderPath: path,
        repoFullName: null,
        connectorId: null,
        branch: null,
      });
      setFocus("split");
      setDeskOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    }
  }

  async function openRepoPicker() {
    setError(null);
    if (connectors.length === 0) {
      setError(t("connectGithubFirst"));
      return;
    }
    setRepoPickerOpen(true);
    const connectorId = pickerConnectorId || connectors[0]?.id || "";
    setPickerConnectorId(connectorId);
    if (!connectorId) {
      return;
    }
    try {
      const resources = await arrabApi.connectorResources(connectorId, repoQuery || undefined);
      setRepoOptions(resources.items);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function searchRepos() {
    if (!pickerConnectorId) {
      return;
    }
    try {
      const resources = await arrabApi.connectorResources(pickerConnectorId, repoQuery || undefined);
      setRepoOptions(resources.items);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    }
  }

  async function selectGithubRepo(resource: ConnectorResource) {
    setBindingBusy(true);
    setError(null);
    try {
      const connectorId = pickerConnectorId || connectors[0]?.id;
      if (!connectorId) {
        return;
      }
      const [owner, repo] = resource.name.split("/");
      let defaultBranch: string | null = null;
      if (owner && repo) {
        try {
          const meta = await arrabApi.githubRepoMeta(owner, repo, connectorId);
          defaultBranch = meta.defaultBranch;
        } catch {
          defaultBranch = null;
        }
      }
      if (linkedProject) {
        const binding = await arrabApi.bindProjectRepo(linkedProject.id, {
          connectorId,
          repoFullName: resource.name,
          repoUrl: resource.url,
          defaultBranch,
        });
        setRepoBinding(binding);
      }
      setWorkspace({
        kind: "github",
        folderPath: null,
        repoFullName: resource.name,
        connectorId,
        branch: defaultBranch,
      });
      setRepoPickerOpen(false);
      setDeskOpen(true);
      setDeskTab("project");
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBindingBusy(false);
    }
  }

  async function unbindRepo() {
    if (!linkedProject) {
      return;
    }
    setBindingBusy(true);
    try {
      await arrabApi.unbindProjectRepo(linkedProject.id);
      setRepoBinding(null);
      if (workspace.kind === "github") {
        setWorkspace({
          kind: "none",
          folderPath: null,
          repoFullName: null,
          connectorId: null,
          branch: null,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBindingBusy(false);
    }
  }

  async function commitWorkspace() {
    const message = commitMessage.trim();
    if (!message) {
      setError(t("commitMessageRequired"));
      return;
    }
    setGitBusy(true);
    setError(null);
    try {
      if (workspace.kind === "folder" && workspace.folderPath) {
        if (!isTauriRuntime()) {
          setError(t("folderNeedsDesktop"));
          return;
        }
        const escaped = message.replace(/"/g, '\\"');
        const result = await runLocalCommand(
          `git add -A && git commit -m "${escaped}"`,
          workspace.folderPath,
        );
        if (result.code !== 0) {
          setError(result.stderr.trim() || result.stdout.trim() || t("commitFailed"));
          return;
        }
        setCommitMessage("");
        await refreshGitStatus();
        return;
      }
      if (workspace.kind === "github" && workspace.repoFullName && workspace.connectorId) {
        const [owner, repo] = workspace.repoFullName.split("/");
        if (!owner || !repo) {
          return;
        }
        const path = commitPath.trim() || "NOTES.md";
        const content =
          commitContent.trim() ||
          `# Arrab Studio\n\n${message}\n\nUpdated from agent workspace.\n`;
        const result = await arrabApi.githubCommit(owner, repo, {
          connectorId: workspace.connectorId,
          message,
          branch: workspace.branch ?? undefined,
          files: [{ path, content }],
          requireApproval: highRiskEnabled(),
        });
        if (result.approval) {
          setError(t("gitAwaitingApproval"));
        } else {
          setCommitMessage("");
          setCommitContent("");
        }
        await refreshGitStatus();
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setGitBusy(false);
    }
  }

  async function pushWorkspace() {
    setGitBusy(true);
    setError(null);
    try {
      if (workspace.kind === "folder" && workspace.folderPath) {
        if (!isTauriRuntime()) {
          setError(t("folderNeedsDesktop"));
          return;
        }
        if (!window.confirm(t("confirmPush"))) {
          return;
        }
        const result = await runLocalCommand("git push", workspace.folderPath);
        if (result.code !== 0) {
          setError(result.stderr.trim() || result.stdout.trim() || t("pushFailed"));
          return;
        }
        await refreshGitStatus();
        return;
      }
      setError(t("githubPushViaCommit"));
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setGitBusy(false);
    }
  }

  async function openPullRequest() {
    if (workspace.kind !== "github" || !workspace.repoFullName || !workspace.connectorId) {
      setError(t("chooseGithubFirst"));
      return;
    }
    const title = prTitle.trim() || commitMessage.trim() || "Arrab Studio changes";
    const head = prHead.trim() || workspace.branch || "";
    if (!head) {
      setError(t("prHeadRequired"));
      return;
    }
    if (!window.confirm(t("confirmPr"))) {
      return;
    }
    setGitBusy(true);
    setError(null);
    try {
      const [owner, repo] = workspace.repoFullName.split("/");
      if (!owner || !repo) {
        return;
      }
      const result = await arrabApi.githubPullRequest(owner, repo, {
        connectorId: workspace.connectorId,
        title,
        body: prBody.trim() || null,
        head,
        requireApproval: highRiskEnabled(),
      });
      if (result.approval) {
        setError(t("gitAwaitingApproval"));
      } else if (result.url) {
        window.open(result.url, "_blank", "noreferrer");
      }
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setGitBusy(false);
    }
  }

  function applyGoal(next: string, kickoff = false) {
    const trimmed = next.trim();
    setActiveGoal(trimmed);
    setGoalDraft(trimmed);
    setGoalEditorOpen(false);
    if (agentId) {
      void (async () => {
        try {
          if (!trimmed) {
            const active = await arrabApi.agentGoals(agentId);
            await Promise.all(
              active.items.map((goal) =>
                arrabApi.updateGoal(goal.id, { status: "completed" }),
              ),
            );
            return;
          }
          await arrabApi.createGoal({
            title: trimmed,
            agentId,
            conversationId: conversation?.id ?? null,
          });
        } catch {
          // local goal still applies via workspaceHint
        }
      })();
    }
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

  async function onSend(event?: FormEvent) {
    event?.preventDefault();
    if (!conversation || draft.trim() === "" || sending || budgetExhausted) {
      return;
    }
    setSending(true);
    setError(null);
    const content = draft.trim();
    setDraft("");
    const optimisticId = `local-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId as Message["id"],
        conversationId: conversation.id,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    let streamed = "";
    const assistantLocalId = `local-asst-${crypto.randomUUID()}`;
    setToolTraces([]);
    setPendingApproval(null);
    try {
      await arrabApi.sendMessageStream(
        conversation.id,
        {
          content,
          workspaceHint: buildHint(),
          spend: spendPayload,
        },
        {
          onToken: (text) => {
            streamed += text;
            setMessages((current) => {
              const without = current.filter((message) => message.id !== assistantLocalId);
              return [
                ...without,
                {
                  id: assistantLocalId as Message["id"],
                  conversationId: conversation.id,
                  role: "assistant",
                  content: streamed,
                  createdAt: new Date().toISOString(),
                },
              ];
            });
          },
          onTool: (name, result) => {
            setToolTraces((current) => [
              ...current,
              { id: `tool-${crypto.randomUUID()}`, name, result },
            ]);
          },
          onApproval: (approval) => {
            const toolName = parseToolNameFromApproval(approval.detail, approval.title);
            if (toolName && isAutoClientTool(toolName)) {
              setPendingApproval(approval);
              void (async () => {
                // Reuse resolver by temporarily setting pending then approving.
                setPendingApproval(approval);
                // Direct local resolve path for auto tools:
                try {
                  const cwd = workspace.kind === "folder" ? workspace.folderPath : null;
                  if (!cwd || !isTauriRuntime()) {
                    setPendingApproval(approval);
                    return;
                  }
                  const args = parseToolArgsFromApproval(approval.detail);
                  const executed = await executeLocalAgentTool(toolName, args, cwd);
                  setToolTraces((current) => [
                    ...current,
                    {
                      id: `tool-${crypto.randomUUID()}`,
                      name: toolName,
                      result: `${executed.ok ? "OK" : "FAILED"} — ${executed.summary}\n${executed.toolResult}`.slice(
                        0,
                        2500,
                      ),
                    },
                  ]);
                  const result = await arrabApi.resolveApproval(approval.id, {
                    status: "approved",
                    toolResult: executed.toolResult,
                  });
                  setPendingApproval(null);
                  if (result.continued?.assistantMessage) {
                    setMessages((current) => [...current, result.continued!.assistantMessage!]);
                    if (result.continued.sessionUsage) {
                      setSessionUsage(result.continued.sessionUsage);
                    }
                  }
                } catch {
                  setPendingApproval(approval);
                }
              })();
              return;
            }
            setPendingApproval(approval);
          },
          onDone: (result) => {
            setMessages((current) => {
              const cleaned = current.filter(
                (message) =>
                  message.id !== optimisticId && message.id !== assistantLocalId,
              );
              return [
                ...cleaned,
                result.userMessage,
                ...(result.assistantMessage ? [result.assistantMessage] : []),
              ];
            });
            setProviderConfigured(result.providerConfigured);
            setSessionUsage(result.sessionUsage);
            if (result.approval) {
              setPendingApproval(result.approval);
            }
            setConversation((current) =>
              current
                ? {
                    ...current,
                    spendTier: result.sessionUsage.tier,
                    sessionTokenBudget: result.sessionUsage.budget,
                    updatedAt: new Date().toISOString(),
                    title:
                      current.title && current.title !== t("chatNewChat")
                        ? current.title
                        : content.slice(0, 48),
                  }
                : current,
            );
            void refreshConversations();
            if (!result.providerConfigured) {
              setError(t("noProvider"));
            }
          },
          onError: (message) => {
            setError(message);
          },
        },
      );
      composerRef.current?.focus();
    } catch (err: unknown) {
      try {
        const result = await arrabApi.sendMessage(conversation.id, {
          content,
          workspaceHint: buildHint(),
          spend: spendPayload,
        });
        setMessages((current) => {
          const cleaned = current.filter(
            (message) => message.id !== optimisticId && message.id !== assistantLocalId,
          );
          return [
            ...cleaned,
            result.userMessage,
            ...(result.assistantMessage ? [result.assistantMessage] : []),
          ];
        });
        setProviderConfigured(result.providerConfigured);
        setSessionUsage(result.sessionUsage);
      } catch (fallbackErr: unknown) {
        setError(
          fallbackErr instanceof ApiRequestError
            ? fallbackErr.message
            : err instanceof ApiRequestError
              ? err.message
              : t("apiUnavailable"),
        );
      }
    } finally {
      setSending(false);
    }
  }

  function onComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      if (!prefs.coworkEnterSend) {
        return;
      }
      event.preventDefault();
      void onSend();
    }
  }

  async function onTerminal(event: FormEvent) {
    event.preventDefault();
    const command = terminalInput.trim();
    if (!command) {
      setLines((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "error", text: t("commandEmpty") },
      ]);
      return;
    }
    setTerminalInput("");
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), kind: "input", text: `$ ${command}` },
    ]);

    if (!isTauriRuntime()) {
      setLines((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "error", text: t("terminalUnavailable") },
      ]);
      return;
    }

    setTerminalBusy(true);
    try {
      const cwd = workspace.kind === "folder" ? workspace.folderPath : null;
      const result = await runLocalCommand(command, cwd);
      if (result.stdout.trim()) {
        setLines((current) => [
          ...current,
          { id: crypto.randomUUID(), kind: "stdout", text: result.stdout.trimEnd() },
        ]);
      }
      if (result.stderr.trim()) {
        setLines((current) => [
          ...current,
          { id: crypto.randomUUID(), kind: "stderr", text: result.stderr.trimEnd() },
        ]);
      }
      setLines((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "system", text: `exit ${result.code}` },
      ]);
    } catch (err: unknown) {
      setLines((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setTerminalBusy(false);
    }
  }


  const showChat = focus !== "terminal";
  const showDesk = deskOpen && focus !== "terminal";
  const showTerminal = terminalOpen || focus === "terminal";
  const showHistory = historyOpen && focus !== "terminal";

  const conversationTitle = useMemo(() => {
    if (conversation?.title?.trim()) {
      return conversation.title.trim();
    }
    const firstUser = messages.find((message) => message.role === "user");
    if (firstUser?.content.trim()) {
      return firstUser.content.trim().slice(0, 48);
    }
    return t("chatNewChat");
  }, [conversation?.title, messages, t]);

  function threadLabel(item: Conversation): string {
    if (item.title?.trim()) {
      return item.title.trim();
    }
    if (item.teamId) {
      const teamName = teams.find((team) => team.id === item.teamId)?.name;
      return teamName ? `${t("chatTeamBadge")} · ${teamName}` : t("chatTeamMode");
    }
    const agentName = agents.find((agent) => agent.id === item.agentId)?.name;
    return agentName ? `${agentName}` : t("chatNewChat");
  }

  async function resolveChatApproval(status: "approved" | "rejected") {
    if (!pendingApproval) return;
    setApprovalBusy(true);
    setError(null);
    try {
      let toolResult: string | undefined;
      const toolName = parseToolNameFromApproval(
        pendingApproval.detail,
        pendingApproval.title,
      );
      if (status === "approved" && toolName && isClientExecTool(toolName)) {
        const cwd = workspace.kind === "folder" ? workspace.folderPath : null;
        if (!cwd || !isTauriRuntime()) {
          throw new Error(t("folderNeedsDesktop"));
        }
        const args = parseToolArgsFromApproval(pendingApproval.detail);
        if (toolName === "run_terminal") {
          setTerminalOpen(true);
        }
        const executed = await executeLocalAgentTool(toolName, args, cwd, {
          onTerminal: (kind, text) => {
            if (kind === "input") {
              setLines((current) => [
                ...current,
                { id: crypto.randomUUID(), kind: "input", text: `$ ${text}` },
              ]);
            } else {
              setLines((current) => [
                ...current,
                { id: crypto.randomUUID(), kind, text },
              ]);
            }
          },
        });
        toolResult = executed.toolResult;
        setToolTraces((current) => [
          ...current,
          {
            id: `tool-${crypto.randomUUID()}`,
            name: toolName,
            result: `${executed.ok ? "OK" : "FAILED"} — ${executed.summary}\n${executed.toolResult}`.slice(
              0,
              2500,
            ),
          },
        ]);
      }
      const result = await arrabApi.resolveApproval(pendingApproval.id, {
        status,
        toolResult: toolResult ?? null,
      });
      setPendingApproval(null);
      if (status === "approved" && result.continued?.assistantMessage) {
        setMessages((current) => [...current, result.continued!.assistantMessage!]);
        if (result.continued.sessionUsage) {
          setSessionUsage(result.continued.sessionUsage);
        }
        if (result.continued.toolsUsed?.length) {
          setToolTraces((current) => [
            ...current,
            ...result.continued!.toolsUsed!
              .filter((name) => !isClientExecTool(name))
              .map((name) => ({
                id: `tool-${crypto.randomUUID()}`,
                name,
                result: t("approvalGranted"),
              })),
          ]);
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

  const codingPresets = [
    { id: "status", labelKey: "chatCodeStatus" as const, command: "git status -sb", prompt: t("chatPromptStatus") },
    { id: "diff", labelKey: "chatCodeDiff" as const, command: "git diff --stat", prompt: t("chatPromptDiff") },
    { id: "test", labelKey: "chatCodeTest" as const, command: "npm test --silent", prompt: t("chatPromptTest") },
    { id: "lint", labelKey: "chatCodeLint" as const, command: "npm run lint", prompt: t("chatPromptLint") },
    { id: "build", labelKey: "chatCodeBuild" as const, command: "npm run build", prompt: t("chatPromptBuild") },
  ];

  async function runCodingCommand(command: string) {
    setTerminalOpen(true);
    setTerminalInput(command);
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), kind: "input", text: `$ ${command}` },
    ]);
    if (!isTauriRuntime()) {
      setLines((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "error", text: t("terminalUnavailable") },
      ]);
      return;
    }
    setTerminalBusy(true);
    try {
      const cwd = workspace.kind === "folder" ? workspace.folderPath : null;
      const result = await runLocalCommand(command, cwd);
      if (result.stdout.trim()) {
        setLines((current) => [
          ...current,
          { id: crypto.randomUUID(), kind: "stdout", text: result.stdout.trimEnd() },
        ]);
      }
      if (result.stderr.trim()) {
        setLines((current) => [
          ...current,
          { id: crypto.randomUUID(), kind: "stderr", text: result.stderr.trimEnd() },
        ]);
      }
      setLines((current) => [
        ...current,
        { id: crypto.randomUUID(), kind: "system", text: `exit ${result.code}` },
      ]);
    } catch (err: unknown) {
      setLines((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setTerminalBusy(false);
    }
  }

  function askAboutCommand(prompt: string) {
    setDraft((current) => (current.trim() ? current : prompt));
    composerRef.current?.focus();
  }

  function selectProject(id: string) {
    setProjectPickId(id);
    const project = projects.find((item) => item.id === id) ?? null;
    if (!project) return;
    void arrabApi
      .projectRepo(project.id)
      .then((result) => {
        if (result.item?.repoFullName) {
          setWorkspace({
            kind: "github",
            folderPath: null,
            repoFullName: result.item.repoFullName,
            connectorId: result.item.connectorId,
            branch: result.item.defaultBranch,
          });
        }
        setDeskTab("project");
      })
      .catch(() => setDeskTab("project"));
  }

  function clearWorkspace() {
    setWorkspace({
      kind: "none",
      folderPath: null,
      repoFullName: null,
      connectorId: null,
      branch: null,
    });
    setGitStatus("");
    setTreeSummary("");
  }

  function useQuickPrompt(prompt: string) {
    setDraft(prompt);
    composerRef.current?.focus();
  }




  return (
    <Surface className="cowork-shell chat-comfy chat-pro flex h-full flex-col overflow-hidden">
      <div className="cowork-atmosphere pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-0 flex-1">
        {showHistory ? (
          <aside className="cowork-rise flex w-[240px] shrink-0 flex-col border-e border-white/[0.06] bg-[#050505] xl:w-[260px]">
            <div className="space-y-2 border-b border-white/[0.06] p-3">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-black/40 p-1">
                <button
                  type="button"
                  onClick={() => setChatMode("solo")}
                  className={cn(
                    "h-8 rounded-lg text-[11px] transition-colors",
                    chatMode === "solo"
                      ? "bg-white text-black"
                      : "text-neutral-400 hover:text-white",
                  )}
                >
                  {t("chatSoloMode")}
                </button>
                <button
                  type="button"
                  onClick={() => setChatMode("team")}
                  className={cn(
                    "h-8 rounded-lg text-[11px] transition-colors",
                    chatMode === "team"
                      ? "bg-white text-black"
                      : "text-neutral-400 hover:text-white",
                  )}
                >
                  {t("chatTeamMode")}
                </button>
              </div>
              {chatMode === "team" ? (
                <select
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value)}
                  className="h-9 w-full rounded-xl border border-white/[0.1] bg-black/50 px-2.5 text-[12px] text-neutral-200 outline-none"
                >
                  <option value="">{t("chatPickTeam")}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <select
                    value={agentId}
                    onChange={(event) => void switchSoloAgent(event.target.value)}
                    className="h-9 w-full rounded-xl border border-white/[0.1] bg-black/50 px-2.5 text-[12px] text-neutral-200 outline-none"
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.specialty ? ` · ${agent.specialty}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setDeskTab("agent");
                      setDeskOpen(true);
                    }}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] text-[11px] text-neutral-400 hover:bg-white/[0.04] hover:text-white"
                  >
                    <UserRound className="size-3.5" strokeWidth={1.7} />
                    {t("chatConfigureAgent")}
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={sessionBusy}
                onClick={() => void newChat()}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
              >
                <MessageSquarePlus className="size-4" strokeWidth={1.7} />
                {t("chatNewChat")}
              </button>
            </div>

            <div className="px-3 pt-3">
              <p className="chat-pro-kicker">{t("chatHistory")}</p>
            </div>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
              {visibleConversations.map((item) => {
                const active = item.id === conversation?.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openConversation(item.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setChatMenu({ id: item.id, x: event.clientX, y: event.clientY });
                      }}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-start transition-colors",
                        active
                          ? "bg-white/[0.08] text-white"
                          : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300",
                      )}
                    >
                      <span className="truncate text-[12px]">{threadLabel(item)}</span>
                      <span className="truncate text-[10px] text-neutral-600">
                        {item.teamId
                          ? teams.find((team) => team.id === item.teamId)?.name ??
                            t("chatTeamBadge")
                          : agents.find((agent) => agent.id === item.agentId)?.name ??
                            t("chatSoloDefaultName")}
                      </span>
                    </button>
                  </li>
                );
              })}
              {visibleConversations.length === 0 ? (
                <li className="px-2 py-8 text-center text-[12px] text-neutral-600">{t("chatNoChats")}</li>
              ) : null}
            </ul>
          </aside>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 lg:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                className={cn("chat-pro-icon", historyOpen && "is-on")}
                aria-label={t("chatHistory")}
              >
                <PanelLeft className="size-3.5" strokeWidth={1.7} />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-medium tracking-[-0.02em] text-white">
                  {conversationTitle}
                </h1>
                <p className="truncate text-[11px] text-neutral-500">
                  {[
                    conversation?.teamId
                      ? `${t("chatTeamBadge")}: ${selectedTeam?.name ?? teams.find((team) => team.id === conversation.teamId)?.name ?? "—"}`
                      : null,
                    selectedAgent?.name ?? t("chatSoloDefaultName"),
                    selectedAgent?.specialty || null,
                    ecoMode ? t("chatEcoOn") : null,
                    workspace.kind !== "none" ? workspaceLabel : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {activeGoal ? (
                <span className="hidden max-w-[180px] truncate rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] text-neutral-400 lg:inline">
                  {activeGoal}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setDeskOpen((open) => !open)}
                className={cn("chat-pro-icon", deskOpen && "is-on")}
                aria-label={t("chatAdvanced")}
                title={t("chatAdvanced")}
              >
                <Sparkles className="size-3.5" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTerminalOpen((open) => !open);
                  if (!terminalOpen) setFocus("chat");
                }}
                className={cn("chat-pro-icon", terminalOpen && "is-on")}
                aria-label={t("terminal")}
              >
                <SquareTerminal className="size-3.5" strokeWidth={1.7} />
              </button>
            </div>
          </header>

          {error || budgetExhausted ? (
            <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs text-neutral-400 lg:px-6">
              {budgetExhausted ? t("spendBudgetExhausted") : error}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            {showChat ? (
              <section className="cowork-rise flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-10">
                  {!conversation && !sessionBusy ? (
                    <EmptyState
                      title={t("chatReadyTitle")}
                      body={t("chatGptReadyBody")}
                      action={
                        <button type="button" onClick={() => void newChat()} className="chat-pro-cta mt-6">
                          {t("chatNewChat")}
                        </button>
                      }
                    />
                  ) : null}

                  {conversation && messages.length === 0 && !sending ? (
                    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
                      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                        <Bot className="size-5 text-neutral-400" strokeWidth={1.6} />
                      </div>
                      <h2 className="text-[22px] font-medium tracking-[-0.03em] text-white">
                        {selectedAgent?.name ?? t("chatSoloDefaultName")}
                      </h2>
                      <p className="mt-1 text-[12px] text-neutral-500">
                        {[
                          selectedAgent?.specialty || selectedAgent?.role,
                          agentSkills.length
                            ? `${agentSkills.length} ${t("chatSkillsLabel")}`
                            : null,
                          agentMemories.length
                            ? `${agentMemories.length} ${t("chatMemoriesLabel")}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-3 max-w-md text-[13px] leading-relaxed text-neutral-500">
                        {selectedAgent?.bio?.trim() || t("chatGptTips")}
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {SOLO_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              applySoloPreset(preset.id);
                              setDeskTab("agent");
                              setDeskOpen(true);
                            }}
                            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-neutral-400 hover:border-white/25 hover:text-white"
                          >
                            {preset.specialty}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDeskTab("agent");
                          setDeskOpen(true);
                        }}
                        className="mt-4 text-[12px] text-neutral-400 underline-offset-2 hover:text-white hover:underline"
                      >
                        {t("chatConfigureAgent")}
                      </button>
                      <div className="mt-7 flex flex-wrap justify-center gap-2">
                        {quickPrompts.map((prompt) => (
                          <button key={prompt} type="button" onClick={() => useQuickPrompt(prompt)} className="chat-pro-suggestion">
                            {prompt}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {codingPresets.slice(0, 3).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => askAboutCommand(preset.prompt)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-neutral-500 hover:text-white"
                          >
                            <Play className="size-3" />
                            {t(preset.labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>
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
                    {toolTraces.length > 0 ? (
                      <ul className="space-y-2">
                        {toolTraces.map((trace) => (
                          <li
                            key={trace.id}
                            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                          >
                            <p className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                              <Wrench className="size-3" strokeWidth={1.7} />
                              {t("chatToolUsed").replace("{name}", trace.name)}
                            </p>
                            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-500">
                              {trace.result}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {pendingApproval ? (
                      <div className="rounded-2xl border border-white/[0.12] bg-[#0c0c0c] p-4">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                          {t("chatApprovalTitle")}
                        </p>
                        <h3 className="mt-1.5 text-[15px] font-medium text-white">
                          {pendingApproval.title}
                        </h3>
                        <p className="mt-1 text-[12px] text-neutral-500">{t("chatApprovalBody")}</p>
                        {pendingApproval.detail ? (
                          <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/40 px-3 py-2 text-[12px] text-neutral-400">
                            {(() => {
                              try {
                                const parsed = JSON.parse(pendingApproval.detail) as {
                                  arguments?: { detail?: string; title?: string };
                                };
                                return (
                                  parsed.arguments?.detail ||
                                  parsed.arguments?.title ||
                                  pendingApproval.detail
                                );
                              } catch {
                                return pendingApproval.detail;
                              }
                            })()}
                          </p>
                        ) : null}
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            disabled={approvalBusy}
                            onClick={() => void resolveChatApproval("approved")}
                            className="h-9 rounded-full bg-white px-4 text-[12px] font-medium text-black disabled:opacity-40"
                          >
                            {approvalBusy ? t("chatApprovalResolving") : t("approve")}
                          </button>
                          <button
                            type="button"
                            disabled={approvalBusy}
                            onClick={() => void resolveChatApproval("rejected")}
                            className="h-9 rounded-full border border-white/15 px-4 text-[12px] text-neutral-300 disabled:opacity-40"
                          >
                            {t("reject")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {sending ? (
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <span className="cowork-thinking inline-flex gap-1">
                          <i />
                          <i />
                          <i />
                        </span>
                        {t("thinking")}
                      </div>
                    ) : null}
                    <div ref={chatEnd} />
                  </div>
                </div>

                <form
                  onSubmit={(event) => void onSend(event)}
                  className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 py-4 lg:px-10"
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
                                <p className="mt-1 text-[13px] leading-relaxed text-neutral-200">{activeGoal}</p>
                              ) : null}
                            </div>
                          </div>
                          {!goalEditorOpen ? (
                            <div className="flex shrink-0 gap-3">
                              <button type="button" onClick={() => { setGoalDraft(activeGoal); setGoalEditorOpen(true); }} className="text-[11px] text-neutral-500 hover:text-white">{t("editGoal")}</button>
                              <button type="button" onClick={() => applyGoal("")} className="text-[11px] text-neutral-500 hover:text-white">{t("markGoalDone")}</button>
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
                              <button type="button" disabled={!goalDraft.trim()} onClick={() => applyGoal(goalDraft, true)} className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40">{t("setGoal")}</button>
                              <button type="button" onClick={() => { setGoalDraft(activeGoal); setGoalEditorOpen(false); }} className="h-8 rounded-lg px-3 text-[11px] text-neutral-400 hover:text-white">{t("cancel")}</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="chat-pro-composer">
                      <textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onComposerKey}
                        rows={2}
                        disabled={!conversation || sending || budgetExhausted}
                        placeholder={
                          selectedAgent?.name
                            ? t("chatMessageAgent").replace("{name}", selectedAgent.name)
                            : t("chatGptPlaceholder")
                        }
                        className="w-full resize-none bg-transparent px-1 py-0.5 text-[15px] leading-[1.55] tracking-[-0.01em] text-white outline-none placeholder:text-neutral-600 disabled:opacity-40"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="relative flex items-center gap-0.5" ref={composerMenuRef}>
                          <button
                            type="button"
                            onClick={() => {
                              setDeskTab("project");
                              setDeskOpen(true);
                              setComposerMenuOpen(false);
                            }}
                            className="chat-pro-icon-btn"
                            title={t("workspace")}
                            aria-label={t("workspace")}
                          >
                            <FolderOpen className="size-4" strokeWidth={1.6} />
                          </button>
                          {!activeGoal && !goalEditorOpen ? (
                            <button
                              type="button"
                              disabled={!conversation}
                              onClick={() => {
                                setGoalDraft("");
                                setGoalEditorOpen(true);
                                setComposerMenuOpen(false);
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
                            onClick={() => setComposerMenuOpen((open) => !open)}
                            className={cn("chat-pro-icon-btn", composerMenuOpen && "is-on")}
                            title={t("chatComposerMore")}
                            aria-label={t("chatComposerMore")}
                            aria-expanded={composerMenuOpen}
                          >
                            <Settings2 className="size-4" strokeWidth={1.6} />
                          </button>

                          {composerMenuOpen ? (
                            <div className="chat-pro-composer-menu absolute bottom-[calc(100%+0.5rem)] start-0 z-30 min-w-[200px] overflow-hidden rounded-xl border border-white/10 bg-[#111] py-1 shadow-2xl">
                              <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-neutral-600">
                                {t("chatComposerMore")}
                              </p>
                              {(
                                [
                                  {
                                    id: "agent",
                                    label: t("chatTabAgent"),
                                    icon: UserRound,
                                    action: () => {
                                      setDeskTab("agent");
                                      setDeskOpen(true);
                                    },
                                  },
                                  {
                                    id: "goal",
                                    label: t("setGoal"),
                                    icon: Target,
                                    action: () => {
                                      setGoalDraft(activeGoal);
                                      setGoalEditorOpen(true);
                                    },
                                  },
                                  {
                                    id: "project",
                                    label: t("workspace"),
                                    icon: FolderOpen,
                                    action: () => {
                                      setDeskTab("project");
                                      setDeskOpen(true);
                                    },
                                  },
                                  {
                                    id: "code",
                                    label: t("chatCode"),
                                    icon: Code2,
                                    action: () => {
                                      setDeskTab("code");
                                      setDeskOpen(true);
                                    },
                                  },
                                  {
                                    id: "git",
                                    label: t("chatTabGit"),
                                    icon: Github,
                                    action: () => {
                                      setDeskTab("git");
                                      setDeskOpen(true);
                                    },
                                  },
                                  {
                                    id: "notes",
                                    label: t("sessionNotes"),
                                    icon: NotebookPen,
                                    action: () => {
                                      setDeskTab("notes");
                                      setDeskOpen(true);
                                    },
                                  },
                                  {
                                    id: "terminal",
                                    label: t("terminal"),
                                    icon: SquareTerminal,
                                    action: () => {
                                      setTerminalOpen(true);
                                      setFocus("chat");
                                    },
                                  },
                                  {
                                    id: "tools",
                                    label: t("chatAdvanced"),
                                    icon: Sparkles,
                                    action: () => setDeskOpen(true),
                                  },
                                ] as const
                              ).map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-[12px] text-neutral-300 hover:bg-white/[0.05] hover:text-white"
                                  onClick={() => {
                                    item.action();
                                    setComposerMenuOpen(false);
                                  }}
                                >
                                  <item.icon className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <button
                          type="submit"
                          disabled={!conversation || sending || draft.trim() === "" || budgetExhausted}
                          className="inline-flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200 disabled:opacity-25"
                          aria-label={t("send")}
                          title={prefs.coworkEnterSend ? t("pressEnter") : t("shiftEnterSend")}
                        >
                          <ArrowUp className="size-3.5" strokeWidth={2.2} />
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </section>
            ) : null}

            {showDesk ? (
              <aside className="cowork-rise cowork-rise-delay flex w-[300px] shrink-0 flex-col border-s border-white/[0.06] bg-[#060606] xl:w-[320px]">
                <div className="border-b border-white/[0.06] px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="chat-pro-kicker">{t("chatAdvanced")}</p>
                    <button type="button" onClick={() => setDeskOpen(false)} className="text-neutral-600 hover:text-white" aria-label={t("close")}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex flex-1 rounded-lg border border-white/[0.08] bg-black/40 p-0.5">
                      {(
                        [
                          ["low", t("chatSpendEco")],
                          ["medium", t("spendMedium")],
                          ["high", t("spendHigh")],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setSpendTier(id);
                            setEcoMode(id === "low");
                            setBudgetInput(id === "low" ? "2500" : String(DEFAULT_SESSION_BUDGETS[id]));
                          }}
                          className={cn(
                            "flex-1 rounded-md py-1.5 text-[11px] transition-colors",
                            spendTier === id ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-300",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={budgetInput}
                      onChange={(event) => setBudgetInput(event.target.value)}
                      placeholder="∞"
                      title={t("spendBudgetHint")}
                      className="h-8 w-[72px] rounded-lg border border-white/[0.08] bg-black/40 px-2 text-center text-[11px] tabular-nums text-neutral-300 outline-none focus:border-white/20"
                    />
                  </div>
                  {sessionUsage ? (
                    <div className="mt-2.5">
                      <div className="mb-1 flex justify-between text-[10px] text-neutral-600">
                        <span>{sessionUsage.totalTokens.toLocaleString()}</span>
                        <span>
                          {sessionUsage.budget === null ? "∞" : sessionUsage.budget.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-[2px] overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-white/55"
                          style={{ width: `${Math.round((spendUsedRatio ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <nav className="flex gap-0 overflow-x-auto border-b border-white/[0.06] px-1">
                  {(
                    [
                      ["agent", t("chatTabAgent")],
                      ["overview", t("chatTabOverview")],
                      ["project", t("chatTabProject")],
                      ["code", t("chatTabCode")],
                      ["git", t("chatTabGit")],
                      ["notes", t("chatTabNotes")],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDeskTab(id)}
                      className={cn(
                        "relative shrink-0 px-2 py-3 text-[11px] transition-colors",
                        deskTab === id ? "text-white" : "text-neutral-600 hover:text-neutral-300",
                      )}
                    >
                      {label}
                      {deskTab === id ? <span className="absolute inset-x-2 bottom-0 h-px bg-white" /> : null}
                    </button>
                  ))}
                </nav>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  {deskTab === "agent" ? (
                    <div className="space-y-5">
                      <form onSubmit={(event) => void saveAgentProfile(event)} className="space-y-3">
                        <p className="chat-pro-kicker">{t("editProfile")}</p>
                        <p className="text-[12px] leading-relaxed text-neutral-500">{t("editProfileBody")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {SOLO_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => applySoloPreset(preset.id)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[10px] transition-colors",
                                profileSpecialty === preset.specialty
                                  ? "border-white/30 bg-white/10 text-white"
                                  : "border-white/10 text-neutral-500 hover:text-neutral-300",
                              )}
                            >
                              {preset.specialty}
                            </button>
                          ))}
                        </div>
                        <label className="grid gap-1">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t("chatSoloNamePlaceholder")}</span>
                          <input
                            value={profileName}
                            onChange={(event) => setProfileName(event.target.value)}
                            className="h-9 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white outline-none focus:border-white/20"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t("employeeRole")}</span>
                          <input
                            value={profileRole}
                            onChange={(event) => setProfileRole(event.target.value)}
                            placeholder={t("hireRolePlaceholder")}
                            className="h-9 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white outline-none focus:border-white/20"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t("employeeSpecialty")}</span>
                          <input
                            value={profileSpecialty}
                            onChange={(event) => setProfileSpecialty(event.target.value)}
                            placeholder={t("hireSpecialtyPlaceholder")}
                            className="h-9 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white outline-none focus:border-white/20"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t("employeeBio")}</span>
                          <textarea
                            value={profileBio}
                            onChange={(event) => setProfileBio(event.target.value)}
                            rows={2}
                            placeholder={t("hireBioPlaceholder")}
                            className="resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] text-white outline-none focus:border-white/20"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{t("employeeInstructions")}</span>
                          <textarea
                            value={profileInstructions}
                            onChange={(event) => setProfileInstructions(event.target.value)}
                            rows={3}
                            placeholder={t("hireInstructionsPlaceholder")}
                            className="resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] text-white outline-none focus:border-white/20"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={agentSaving || !agentId || !profileName.trim()}
                          className="h-9 w-full rounded-lg bg-white text-[12px] font-medium text-black disabled:opacity-40"
                        >
                          {agentSaving ? t("connecting") : t("saveProfile")}
                        </button>
                      </form>

                      <section className="border-t border-white/[0.06] pt-4">
                        <div className="flex items-center gap-2">
                          <GraduationCap className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                          <p className="chat-pro-kicker">{t("chatSkillsLabel")}</p>
                        </div>
                        <form onSubmit={(event) => void teachSkill(event)} className="mt-3 space-y-2">
                          <input
                            value={skillTitle}
                            onChange={(event) => setSkillTitle(event.target.value)}
                            placeholder={t("skillTitle")}
                            className="h-8 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-white outline-none focus:border-white/20"
                          />
                          <textarea
                            value={skillInstructions}
                            onChange={(event) => setSkillInstructions(event.target.value)}
                            rows={2}
                            placeholder={t("teachTaskPlaceholder")}
                            className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] text-white outline-none focus:border-white/20"
                          />
                          <button
                            type="submit"
                            disabled={agentSaving || !agentId || !skillTitle.trim()}
                            className="h-8 rounded-lg border border-white/15 px-3 text-[11px] text-neutral-200 disabled:opacity-40"
                          >
                            {t("saveTaughtSkill")}
                          </button>
                        </form>
                        <ul className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                          {agentSkills.map((skill) => (
                            <li
                              key={skill.id}
                              className="rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[12px] text-white">{skill.title}</p>
                                <button
                                  type="button"
                                  onClick={() => void removeSkill(skill.id)}
                                  className="text-neutral-600 hover:text-red-300"
                                  aria-label={t("chatDeleteChat")}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500">
                                {skill.instructions}
                              </p>
                            </li>
                          ))}
                          {agentSkills.length === 0 ? (
                            <li className="text-[11px] text-neutral-600">{t("chatNoSkillsYet")}</li>
                          ) : null}
                        </ul>
                      </section>

                      <section className="border-t border-white/[0.06] pt-4">
                        <div className="flex items-center gap-2">
                          <Brain className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                          <p className="chat-pro-kicker">{t("chatMemoriesLabel")}</p>
                        </div>
                        <form onSubmit={(event) => void saveMemory(event)} className="mt-3 space-y-2">
                          <textarea
                            value={memoryDraft}
                            onChange={(event) => setMemoryDraft(event.target.value)}
                            rows={2}
                            placeholder={t("tellAgentPlaceholder")}
                            className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] text-white outline-none focus:border-white/20"
                          />
                          <button
                            type="submit"
                            disabled={agentSaving || !agentId || !memoryDraft.trim()}
                            className="h-8 rounded-lg border border-white/15 px-3 text-[11px] text-neutral-200 disabled:opacity-40"
                          >
                            {t("saveToMemory")}
                          </button>
                        </form>
                        <ul className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                          {agentMemories.map((memory) => (
                            <li
                              key={memory.id}
                              className="rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] leading-relaxed text-neutral-300">
                                  {memory.content}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void removeMemory(memory.id)}
                                  className="shrink-0 text-neutral-600 hover:text-red-300"
                                  aria-label={t("chatDeleteChat")}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            </li>
                          ))}
                          {agentMemories.length === 0 ? (
                            <li className="text-[11px] text-neutral-600">{t("chatNoMemoriesYet")}</li>
                          ) : null}
                        </ul>
                      </section>
                    </div>
                  ) : null}

                  {deskTab === "overview" ? (
                    <>
                      <section>
                        <p className="chat-pro-kicker">{t("activeGoal")}</p>
                        <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">{activeGoal || t("goalHint")}</p>
                        <button
                          type="button"
                          disabled={!conversation}
                          onClick={() => { setGoalDraft(activeGoal); setGoalEditorOpen(true); }}
                          className="mt-3 text-[12px] text-neutral-400 underline-offset-2 hover:text-white hover:underline disabled:opacity-40"
                        >
                          {activeGoal ? t("editGoal") : t("setGoal")}
                        </button>
                      </section>
                      <section className="border-t border-white/[0.06] pt-4">
                        <p className="chat-pro-kicker">{t("chatSessionMeta")}</p>
                        <dl className="mt-3 space-y-2.5 text-[12px]">
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("messages")}</dt><dd className="tabular-nums text-neutral-300">{messages.length}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("chatSoloDefaultName")}</dt><dd className="truncate text-neutral-300">{selectedAgent?.name ?? "—"}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("employeeSpecialty")}</dt><dd className="truncate text-neutral-300">{selectedAgent?.specialty || selectedAgent?.role || "—"}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("chatSkillsLabel")}</dt><dd className="tabular-nums text-neutral-300">{agentSkills.length}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("chatMemoriesLabel")}</dt><dd className="tabular-nums text-neutral-300">{agentMemories.length}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-neutral-600">{t("providerStatus")}</dt><dd className="text-neutral-300">{providerConfigured === null ? "…" : providerConfigured ? t("providerLive") : t("providerOffline")}</dd></div>
                        </dl>
                        <button
                          type="button"
                          onClick={() => setDeskTab("agent")}
                          className="mt-3 text-[12px] text-neutral-400 underline-offset-2 hover:text-white hover:underline"
                        >
                          {t("chatConfigureAgent")}
                        </button>
                      </section>
                    </>
                  ) : null}

                  {deskTab === "project" ? (
                    <div className="space-y-4">
                      <section>
                        <p className="chat-pro-kicker">{t("chatPickProject")}</p>
                        <select
                          value={projectPickId}
                          onChange={(event) => selectProject(event.target.value)}
                          className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] text-neutral-200 outline-none focus:border-white/20"
                        >
                          <option value="">{t("none")}</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                      </section>
                      <section className="border-t border-white/[0.06] pt-4">
                        <p className="chat-pro-kicker">{t("workspace")}</p>
                        <p className="mt-2 truncate text-[13px] text-white">{workspaceLabel}</p>
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => void chooseFolder()} className="chat-pro-ghost-wide">
                            <FolderOpen className="size-3.5" />
                            {t("chooseFolder")}
                          </button>
                          <button type="button" onClick={() => void openRepoPicker()} className="chat-pro-ghost-wide">
                            <Github className="size-3.5" />
                            GitHub
                          </button>
                        </div>
                        {workspace.kind !== "none" ? (
                          <button type="button" onClick={clearWorkspace} className="mt-2 text-[11px] text-neutral-600 hover:text-white">{t("clear")}</button>
                        ) : null}
                      </section>
                      {linkedProject && repoBinding ? (
                        <button type="button" disabled={bindingBusy} onClick={() => void unbindRepo()} className="text-[11px] text-neutral-600 hover:text-white disabled:opacity-40">
                          {t("clear")} · {t("linkedRepo")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {deskTab === "code" ? (
                    <div className="space-y-4">
                      <section>
                        <p className="chat-pro-kicker">{t("chatCodeActions")}</p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">{t("chatCodeActionsBody")}</p>
                        <ul className="mt-3 divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.07]">
                          {codingPresets.map((preset) => (
                            <li key={preset.id} className="flex items-center gap-2 bg-white/[0.015] px-3 py-2.5">
                              <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-300">{t(preset.labelKey)}</span>
                              <button type="button" onClick={() => askAboutCommand(preset.prompt)} className="text-[11px] text-neutral-500 hover:text-white">{t("chatAsk")}</button>
                              <button type="button" disabled={terminalBusy} onClick={() => void runCodingCommand(preset.command)} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-medium text-black disabled:opacity-40">
                                <Play className="size-2.5" />
                                {t("run")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                      <section className="border-t border-white/[0.06] pt-4">
                        <p className="chat-pro-kicker">{t("chatRunCustom")}</p>
                        <div className="mt-2 flex gap-2">
                          <input value={cmdDraft} onChange={(event) => setCmdDraft(event.target.value)} placeholder="npm run typecheck" className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 font-mono text-[11px] text-neutral-200 outline-none focus:border-white/20" />
                          <button
                            type="button"
                            disabled={!cmdDraft.trim() || terminalBusy}
                            onClick={() => { void runCodingCommand(cmdDraft.trim()); setCmdDraft(""); }}
                            className="inline-flex h-9 items-center gap-1 rounded-lg bg-white px-3 text-[11px] font-medium text-black disabled:opacity-40"
                          >
                            <Play className="size-3" />
                            {t("run")}
                          </button>
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {deskTab === "git" ? (
                    <div className="space-y-4">
                      <section>
                        <div className="flex items-center justify-between">
                          <p className="chat-pro-kicker">{t("gitStatus")}</p>
                          <button type="button" disabled={gitBusy || workspace.kind === "none"} onClick={() => void refreshGitStatus()} className="text-[11px] text-neutral-500 hover:text-white disabled:opacity-40">{t("refresh")}</button>
                        </div>
                        <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-500">{gitStatus || t("noWorkspaceYet")}</pre>
                      </section>
                      <section className="border-t border-white/[0.06] pt-4">
                        <p className="chat-pro-kicker">{t("commitPush")}</p>
                        <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder={t("commitMessagePlaceholder")} className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] outline-none focus:border-white/20" />
                        {workspace.kind === "github" ? (
                          <>
                            <input value={commitPath} onChange={(event) => setCommitPath(event.target.value)} placeholder="NOTES.md" className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] outline-none focus:border-white/20" />
                            <textarea value={commitContent} onChange={(event) => setCommitContent(event.target.value)} rows={3} placeholder={t("commitContentPlaceholder")} className="mt-2 w-full resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] outline-none focus:border-white/20" />
                          </>
                        ) : null}
                        <div className="mt-3 flex gap-2">
                          <button type="button" disabled={gitBusy || workspace.kind === "none"} onClick={() => void commitWorkspace()} className="chat-pro-cta !h-8 !px-3 !text-[11px] disabled:opacity-40">{t("commit")}</button>
                          <button type="button" disabled={gitBusy || workspace.kind !== "folder"} onClick={() => void pushWorkspace()} className="h-8 rounded-lg border border-white/[0.1] px-3 text-[11px] text-neutral-300 disabled:opacity-40">{t("push")}</button>
                        </div>
                      </section>
                      {workspace.kind === "github" ? (
                        <section className="border-t border-white/[0.06] pt-4">
                          <p className="chat-pro-kicker">{t("openPullRequest")}</p>
                          <input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder={t("prTitle")} className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] outline-none focus:border-white/20" />
                          <input value={prHead} onChange={(event) => setPrHead(event.target.value)} placeholder={t("prHead")} className="mt-2 h-9 w-full rounded-lg border border-white/[0.08] bg-black/40 px-2.5 text-[12px] outline-none focus:border-white/20" />
                          <textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} rows={3} placeholder={t("prBody")} className="mt-2 w-full resize-none rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[12px] outline-none focus:border-white/20" />
                          <button type="button" disabled={gitBusy} onClick={() => void openPullRequest()} className="mt-3 h-8 rounded-lg border border-white/[0.1] px-3 text-[11px] text-neutral-300 disabled:opacity-40">{t("createPr")}</button>
                        </section>
                      ) : null}
                    </div>
                  ) : null}

                  {deskTab === "notes" ? (
                    <label className="grid gap-2">
                      <span className="chat-pro-kicker">{t("sessionNotes")}</span>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={16}
                        placeholder={t("chatNotesPlaceholder")}
                        className="min-h-[280px] w-full resize-none rounded-xl border border-white/[0.07] bg-black/30 px-3 py-3 text-[13px] leading-relaxed text-neutral-200 outline-none focus:border-white/18"
                      />
                    </label>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>

          {showTerminal ? (
            <section
              className={cn(
                "cowork-rise cowork-rise-delay-2 flex shrink-0 flex-col border-t border-white/[0.06] bg-[#030303]",
                focus === "terminal" ? "min-h-0 flex-1" : terminalTall ? "h-[38vh]" : "h-[148px]",
              )}
            >
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <SquareTerminal className="size-3.5 text-neutral-500" />
                  <p className="chat-pro-kicker">{t("terminal")}</p>
                  <span className="truncate text-[11px] text-neutral-600">
                    {workspace.kind === "folder" && workspace.folderPath ? workspace.folderPath : t("chatTerminalOptional")}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setTerminalTall((value) => !value)} className="text-[11px] text-neutral-500 hover:text-white">
                    {terminalTall ? t("terminalCollapse") : t("terminalExpand")}
                  </button>
                  <button type="button" onClick={() => setTerminalOpen(false)} className="text-[11px] text-neutral-500 hover:text-white">{t("close")}</button>
                  <button type="button" onClick={() => setLines([{ id: crypto.randomUUID(), kind: "system", text: t("terminalReady") }])} className="text-[11px] text-neutral-500 hover:text-white">{t("clear")}</button>
                </div>
              </header>
              <div className="arrab-terminal min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed">
                {lines.map((line) => (
                  <pre
                    key={line.id}
                    className={cn(
                      "whitespace-pre-wrap",
                      line.kind === "input" && "text-white",
                      line.kind === "stdout" && "text-neutral-300",
                      line.kind === "stderr" && "text-neutral-400",
                      line.kind === "system" && "text-neutral-600",
                      line.kind === "error" && "text-neutral-200",
                    )}
                  >
                    {line.text}
                  </pre>
                ))}
                <div ref={termEnd} />
              </div>
              <form onSubmit={onTerminal} className="flex gap-2 border-t border-white/[0.06] p-3">
                <span className="arrab-terminal flex h-9 items-center text-neutral-600">$</span>
                <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder={t("terminalPlaceholder")} disabled={terminalBusy} className="arrab-terminal field flex-1 !rounded-lg border-white/10" />
                <button type="submit" disabled={terminalBusy} className="h-9 rounded-lg border border-white/10 px-3 text-xs text-white hover:bg-white/5 disabled:opacity-40">{t("run")}</button>
              </form>
            </section>
          ) : null}
        </div>
      </div>

      {chatMenu ? (
        <div
          className="fixed z-[60] min-w-[160px] overflow-hidden rounded-xl border border-white/10 bg-[#111] py-1 shadow-2xl"
          style={{ left: chatMenu.x, top: chatMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
            onClick={() => {
              const id = chatMenu.id;
              setChatMenu(null);
              void openConversation(id);
            }}
          >
            <MessageSquarePlus className="size-3.5 text-neutral-500" strokeWidth={1.7} />
            {t("chatOpenChat")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-red-300 hover:bg-white/[0.06]"
            onClick={() => void deleteChat(chatMenu.id)}
          >
            <Trash2 className="size-3.5" strokeWidth={1.7} />
            {t("chatDeleteChat")}
          </button>
        </div>
      ) : null}

      {repoPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[16px] font-medium text-white">{t("chooseGithubRepo")}</h2>
              <button type="button" onClick={() => setRepoPickerOpen(false)} className="text-sm text-neutral-500 hover:text-white">{t("close")}</button>
            </div>
            <p className="mt-1 text-[13px] text-neutral-500">{t("chooseGithubRepoBody")}</p>
            <div className="mt-4 flex gap-2">
              <select value={pickerConnectorId} onChange={(event) => setPickerConnectorId(event.target.value)} className="field !rounded-lg">
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>{connector.accountLabel ?? connector.id}</option>
                ))}
              </select>
              <input value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder={t("searchRepos")} className="field flex-1 !rounded-lg" />
              <button type="button" onClick={() => void searchRepos()} className="chat-pro-cta !h-9 !px-3">{t("search")}</button>
            </div>
            <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto">
              {repoOptions.map((repo) => (
                <li key={repo.id}>
                  <button type="button" disabled={bindingBusy} onClick={() => void selectGithubRepo(repo)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-start hover:bg-white/[0.04]">
                    <span className="text-[13px] text-white">{repo.name}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-600">{repo.kind}</span>
                  </button>
                </li>
              ))}
              {repoOptions.length === 0 ? <li className="px-3 py-6 text-center text-[13px] text-neutral-600">{t("noReposFound")}</li> : null}
            </ul>
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
      <p className="text-[10px] tracking-[0.1em] text-neutral-600">
        {isUser ? youLabel : coworkerLabel}
      </p>
      <div
        className={cn(
          "max-w-[88%] px-4 py-3 text-[14px] leading-[1.55]",
          isUser
            ? "rounded-[1.15rem] rounded-br-md bg-white text-black"
            : "rounded-[1.15rem] rounded-bl-md border border-white/[0.08] bg-white/[0.035] text-neutral-200",
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
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
        <Sparkles className="size-5 text-neutral-400" strokeWidth={1.6} />
      </div>
      <h2 className="text-lg text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-500">{body}</p>
      {action}
    </div>
  );
}
