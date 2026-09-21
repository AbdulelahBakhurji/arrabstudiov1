import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Brain,
  Code2,
  Copy,
  EyeOff,
  FolderOpen,
  Github,
  GraduationCap,
  MessageSquarePlus,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  Pause,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  SquareTerminal,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Globe,
  X,
} from "lucide-react";
import { PauseSendButton, QueuedQueryBar } from "@/components/QueuedQueryBar";
import { ComposerPlusMenu } from "@/components/ComposerPlusMenu";
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
import { ChatMarkdown, copyChatText } from "@/components/ChatMarkdown";
import { Surface } from "@/components/StudioFrame";
import { CompanionCatalog } from "@/components/companions/CompanionCatalog";
import { IncognitoRoom } from "@/components/companions/IncognitoRoom";
import {
  OrgChatFullscreenExit,
  OrgChatTopBar,
  type OrgChatLane,
  type OrgChatPrivacy,
} from "@/components/OrgChatTopBar";
import {
  attachEmployeesToCompanion,
  ensureOrgCompanionAgent,
  isCompanionAgent,
  resolveCompanionAgentId,
  splitOrgAgents,
  syncWorkProfilesFromAgents,
} from "@/lib/org-chat";
import {
  birthSuggestion,
  dismissBirth,
  findCompanion,
  liveCompanions,
  noteTopics,
  useCompanionState,
  type CompanionProfile,
} from "@/lib/companions";
import {
  companionDisplayBlurb,
  companionDisplayName,
} from "@/lib/companion-catalog";
import {
  clientSearchWeb,
  formatWebSearchForModel,
  formatWebSearchForUser,
  parseWebSearchCommand,
} from "@/lib/web-search";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { resolvePreferredModel } from "@/lib/ai-prefs";

import { AgentSteps, friendlyToolTitle, type AgentStep } from "@/components/AgentSteps";
import { humanizeApprovalCopy } from "@/lib/approval-copy";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useStudioPrefs } from "@/hooks/useStudioPrefs";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import {
  filterLiveWorkforceAgents,
  readAgentSessionPolicy,
  writeAgentSessionPolicy,
} from "@/lib/agent-session-policy";
import {
  defaultSoloAgentBody,
  ensureDefaultSoloAgent,
} from "@/lib/agents-bootstrap";
import { LAST_CHAT_AGENT_KEY, readPrefs } from "@/lib/prefs";
import {
  executeLocalAgentTool,
  isAutoClientTool,
  isClientExecTool,
  isEmailPolicyTool,
  isPolicyClientTool,
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
} from "@/lib/agent-local-tools";
import { isTauriRuntime, pickFolder, runLocalCommand, type TerminalLine } from "@/lib/terminal";
import { loadWorkspaceRules } from "@/lib/workspace-rules";
import {
  deleteChatHistory,
  listCachedChats,
  loadBestMessages,
  loadChatHistory,
  mergeRemoteConversations,
  usePersistedChat,
} from "@/lib/chat-history";
import { ingestBrainMessages, brainContextSnippet } from "@/lib/second-brain";
import {
  createIncognitoVault,
  deleteIncognitoSession,
  incognitoVaultExists,
  isIncognitoUnlocked,
  listIncognitoSessions,
  loadIncognitoSession,
  lockIncognitoVault,
  newIncognitoSessionId,
  saveIncognitoSession,
  unlockIncognitoVault,
  wipeIncognitoVault,
  rememberIncognitoApiId,
  forgetIncognitoApiId,
  listIncognitoApiIds,
  type IncognitoSession,
} from "@/lib/incognito-vault";
import { cn } from "@/lib/utils";
import {
  hideAgentPresence,
  showAgentPresence,
  subscribePresenceResolve,
  updateAgentPresence,
} from "@/lib/agent-presence";

type FocusMode = "chat" | "split" | "terminal";
type WorkspaceKind = "none" | "folder" | "github";
type DeskTab = "agent" | "overview" | "project" | "code" | "git" | "notes";
type ChatMode = "solo" | "team" | "incognito";
type SidebarView = "people" | "chats";
type DeskPolicy = "ask" | "allow";

const DESK_POLICY_KEY = "arrab.chat.deskPolicy";
const SOLO_PRESETS = [
  {
    id: "coding",
    specialty: "Coding",
    role: "Software engineer",
    instructions:
      "Write clean code, propose concrete diffs, run checks before claiming done, and explain tradeoffs briefly.",
    titleKey: "chatStarterCode" as const,
    bodyKey: "chatStarterCodeBody" as const,
    promptKey: "chatStarterCodePrompt" as const,
  },
  {
    id: "research",
    specialty: "Research",
    role: "Researcher",
    instructions:
      "Dig for primary facts, cite assumptions, prefer concise bullets, and flag uncertainty clearly.",
    titleKey: "chatStarterResearch" as const,
    bodyKey: "chatStarterResearchBody" as const,
    promptKey: "chatStarterResearchPrompt" as const,
  },
  {
    id: "writing",
    specialty: "Writing",
    role: "Writer",
    instructions:
      "Match the operator's voice, keep copy crisp, and offer 2–3 variants when useful.",
    titleKey: "chatStarterWrite" as const,
    bodyKey: "chatStarterWriteBody" as const,
    promptKey: "chatStarterWritePrompt" as const,
  },
  {
    id: "ops",
    specialty: "Ops",
    role: "Operator",
    instructions:
      "Prefer checklists, safe rollbacks, and verifiable commands. Never invent system access.",
    titleKey: "chatStarterOps" as const,
    bodyKey: "chatStarterOpsBody" as const,
    promptKey: "chatStarterOpsPrompt" as const,
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
      budgetInput: "",
    };
  } catch {
    return { tier: "low", budgetInput: "" };
  }
}

function clampMenuPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  menuWidth: number,
  menuHeight: number,
): { x: number; y: number } {
  const pad = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = Math.min(anchor.right - menuWidth, vw - menuWidth - pad);
  x = Math.max(pad, x);
  const below = anchor.bottom + 6;
  const above = anchor.top - menuHeight - 6;
  const y =
    below + menuHeight <= vh - pad
      ? below
      : above >= pad
        ? above
        : Math.max(pad, Math.min(below, vh - menuHeight - pad));
  return { x, y };
}

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
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
  const { t, locale } = useLanguage();
  const { signedIn } = useSignedInAccount();
  const prefs = useStudioPrefs();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>("solo");
  const [incognitoUnlocked, setIncognitoUnlocked] = useState(() => isIncognitoUnlocked());
  const [incognitoHasVault, setIncognitoHasVault] = useState(false);
  const [incognitoSessions, setIncognitoSessions] = useState<
    Array<{ id: string; title: string; updatedAt: string; messageCount: number }>
  >([]);
  const [incognitoSessionId, setIncognitoSessionId] = useState<string | null>(null);
  const [incognitoPassword, setIncognitoPassword] = useState("");
  const [incognitoPassword2, setIncognitoPassword2] = useState("");
  const [incognitoBusy, setIncognitoBusy] = useState(false);
  const [incognitoError, setIncognitoError] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>("people");
  const [hireOpen, setHireOpen] = useState(false);
  const [hireName, setHireName] = useState("");
  const [hireRole, setHireRole] = useState("");
  const [hirePreset, setHirePreset] = useState<(typeof SOLO_PRESETS)[number]["id"] | "">("");
  const [agentMenu, setAgentMenu] = useState<{
    id: string;
    x: number;
    y: number;
    confirmDelete?: boolean;
  } | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
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
  const [queuedQuery, setQueuedQuery] = useState<string | null>(null);
  const queuedQueryRef = useRef<string | null>(null);
  queuedQueryRef.current = queuedQuery;
  const streamAbortRef = useRef<AbortController | null>(null);
  const pauseRequestedRef = useRef(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState<import("@arrab/shared").AiGatewayStatusResponse | null>(null);
  const [spendTier, setSpendTier] = useState<TokenSpendTier>(() => readSpendPrefs().tier);
  const [budgetInput, setBudgetInput] = useState(() => readSpendPrefs().budgetInput);
  const [sessionUsage, setSessionUsage] = useState<SessionUsageSnapshot | null>(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalTall, setTerminalTall] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [, setHistoryOpen] = useState(false);
  const [deskTab, setDeskTab] = useState<DeskTab>("agent");
  const [profileMoreOpen, setProfileMoreOpen] = useState(false);
  const [focus, setFocus] = useState<FocusMode>("chat");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [, setEcoMode] = useState(() => readSpendPrefs().tier === "low");
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
  const [plusOpen, setPlusOpen] = useState(false);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    { id: "sys-1", kind: "system", text: t("terminalReady") },
  ]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => readWorkspace());
  const [workspaceRules, setWorkspaceRules] = useState<string | null>(null);
  const [deskPolicy, setDeskPolicy] = useState<DeskPolicy>(() => {
    try {
      const saved = localStorage.getItem(DESK_POLICY_KEY);
      return saved === "allow" ? "allow" : "ask";
    } catch {
      return "ask";
    }
  });
  const deskPolicyRef = useRef(deskPolicy);
  deskPolicyRef.current = deskPolicy;
  const handledChatApprovals = useRef(new Set<string>());
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadRef = useRef<HTMLInputElement | null>(null);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === teamId) ?? null,
    [teamId, teams],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agentId, agents],
  );

  const { companions, employees } = useMemo(() => splitOrgAgents(agents), [agents]);
  const companionState = useCompanionState();
  const workPeople = useMemo(
    () => liveCompanions(companionState, "work").filter((person) => person.domain !== "general"),
    [companionState],
  );
  useEffect(() => {
    syncWorkProfilesFromAgents(agents);
  }, [agents]);
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  const activePerson = useMemo(() => {
    const byId = findCompanion(companionState, activePersonId);
    if (byId && byId.space === "work" && !byId.archivedAt) return byId;
    return (
      workPeople.find((person) => person.agentId === agentId) ??
      workPeople[0] ??
      null
    );
  }, [activePersonId, agentId, companionState, workPeople]);

  // When UI language flips, refresh companion agent names + language instructions.
  useEffect(() => {
    if (!activePerson?.agentId) return;
    const uiLocale = locale === "ar" ? "ar" : "en";
    void ensureOrgCompanionAgent(activePerson, {
      syncProfile: true,
      knownAgents: agents,
      locale: uiLocale,
    })
      .then((agent) => {
        setAgents((current) => [agent, ...current.filter((item) => item.id !== agent.id)]);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, activePerson?.id, activePerson?.agentId]);

  const birth = useMemo(() => birthSuggestion(companionState), [companionState]);
  const [orgLane, setOrgLane] = useState<OrgChatLane>("companions");
  const [chatPrivacy, setChatPrivacy] = useState<OrgChatPrivacy>("chat");
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [birthDomain, setBirthDomain] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachPicks, setAttachPicks] = useState<string[]>([]);
  const [allPeopleOpen, setAllPeopleOpen] = useState(false);
  const [memberships, setMemberships] = useState<import("@arrab/shared").TeamMembership[]>([]);

  const activeCompanionLabel = useMemo(() => {
    if (orgLane === "companions" && activePerson) {
      return companionDisplayName(activePerson, locale);
    }
    return selectedAgent?.name ?? t("chatSoloDefaultName");
  }, [activePerson, locale, orgLane, selectedAgent?.name, t]);

  const activeCompanionSub = useMemo(() => {
    if (orgLane === "companions" && activePerson) {
      return (
        companionDisplayBlurb(activePerson, locale) ||
        activePerson.lastMemory ||
        t("chatCompanionSolo")
      );
    }
    if (selectedAgent) {
      return isCompanionAgent(selectedAgent) ? t("chatCompanionSolo") : selectedAgent.role;
    }
    return t("chatOrgEmptyBody");
  }, [activePerson, locale, orgLane, selectedAgent, t]);

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
      // No per-session token cap — avoid blocking chats mid-thread.
      sessionTokenBudget: null as number | null,
    }),
    [spendTier],
  );

  const reportError = useCallback(
    (err: unknown) => {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (isTransientApiError(message)) {
        return;
      }
      setError(message);
    },
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

      const [agentList, teamList, projectList, conversationList, ai, connectorList, membershipList] =
        await Promise.all([
          arrabApi.agents(),
          arrabApi.teams(),
          arrabApi.projects(),
          arrabApi.conversations(),
          arrabApi.aiStatus(),
          arrabApi.connectors(),
          arrabApi.memberships().catch(() => ({ items: [] as import("@arrab/shared").TeamMembership[] })),
        ]);

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
      setTeams(teamList.items);
      setMemberships(membershipList.items);
      setProjects(projectList.items);
      const connected = connectorList.items.filter((item) => item.status === "connected");
      setConnectors(connected);
      setPickerConnectorId((current) => current || connected[0]?.id || "");
      setProviderConfigured(ai.configured);
      setAiStatus(ai);

      const threads = await mergeRemoteConversations(conversationList.items);
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
        sessionTokenBudget: null as number | null,
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
        const history = await loadBestMessages(target.id, detail.messages);
        setConversation(detail.conversation);
        setMessages(history);
        setSessionUsage(
          detail.sessionUsage
            ? { ...detail.sessionUsage, budget: null, remaining: null }
            : null,
        );
        setSpendTier(detail.conversation.spendTier ?? "low");
        setBudgetInput("");
        if (detail.conversation.agentId) {
          setAgentId(detail.conversation.agentId);
        }
        if (detail.conversation.teamId) {
          setChatMode("team");
          setTeamId(detail.conversation.teamId);
        }
        setEcoMode((detail.conversation.spendTier ?? "low") === "low");
        setAgentSteps([]);
        setPendingApproval(null);
      }
    } catch (err: unknown) {
      const cached = await listCachedChats();
      if (cached.length > 0) {
        const threads = cached.map((item) => item.conversation);
        setConversations(threads);
        const first = cached[0]!;
        setConversation(first.conversation);
        setMessages(first.messages);
        if (first.conversation.agentId) {
          setAgentId(first.conversation.agentId);
        }
      }
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) {
        setError(message);
      }
    } finally {
      setSessionBusy(false);
    }
  }, [prefs.coworkAutoResume, t]);

  useEffect(() => {
    void boot();
    // Boot once per Chat mount. Re-running on `t`/prefs identity churn spawned extra agents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePersistedChat(
    chatMode === "incognito" ? null : conversation,
    chatMode === "incognito" ? [] : messages,
  );

  // Solo chats grow the second-brain map (decisions, files, sessions).
  useEffect(() => {
    if (chatMode !== "solo" || !conversation || messages.length < 2) return;
    const agentName =
      agents.find((item) => item.id === (conversation.agentId || agentId))?.name ||
      conversation.title ||
      "Agent";
    const timer = window.setTimeout(() => {
      ingestBrainMessages({
        scope: "solo",
        space: "org",
        companionId: conversation.agentId || agentId || null,
        companionName: agentName,
        conversationId: conversation.id,
        messages,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [chatMode, conversation, messages, agents, agentId]);

  useEffect(() => {
    void incognitoVaultExists().then(setIncognitoHasVault);
  }, []);

  useEffect(() => {
    if (chatMode !== "incognito" || !incognitoUnlocked || !incognitoSessionId) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const existing = await loadIncognitoSession(incognitoSessionId);
          const title =
            messages.find((m) => m.role === "user")?.content.trim().slice(0, 48) ||
            existing?.title ||
            t("chatIncognitoBadge");
          const payload: IncognitoSession = {
            id: incognitoSessionId,
            title,
            agentId: agentId || null,
            apiConversationId: conversation?.id ?? existing?.apiConversationId ?? null,
            messages: messages.map((m) => ({
              id: String(m.id),
              role: m.role === "assistant" || m.role === "system" ? m.role : "user",
              content: m.content,
              createdAt: m.createdAt,
            })),
            updatedAt: new Date().toISOString(),
            createdAt: existing?.createdAt ?? new Date().toISOString(),
          };
          await saveIncognitoSession(payload);
          const listed = await listIncognitoSessions();
          setIncognitoSessions(listed);
        } catch {
          // ignore save errors while typing
        }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [chatMode, incognitoUnlocked, incognitoSessionId, messages, conversation, agentId, t]);

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
    const hidden = listIncognitoApiIds();
    const base =
      chatMode === "team"
        ? conversations.filter((item) => Boolean(item.teamId))
        : !agentId
          ? []
          : conversations.filter((item) => item.agentId === agentId && !item.teamId);
    return base.filter((item) => !hidden.has(item.id));
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
    if (!chatMenu && !agentMenu) return;
    const close = () => {
      setChatMenu(null);
      setAgentMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatMenu, agentMenu]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, agentSteps, pendingApproval]);

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
      setError(null);
      // Paint cached thread immediately so companion switches feel instant.
      const cached = await loadChatHistory(id);
      if (cached) {
        startTransition(() => {
          setConversation(cached.conversation);
          setMessages(cached.messages);
          if (cached.conversation.agentId) setAgentId(cached.conversation.agentId);
          if (cached.conversation.teamId) {
            setChatMode("team");
            setTeamId(cached.conversation.teamId);
          } else {
            setChatMode("solo");
          }
          setAgentSteps([]);
          setPendingApproval(null);
        });
      } else {
        setSessionBusy(true);
      }
      try {
        const detail = await arrabApi.conversation(id);
        const history = await loadBestMessages(id, detail.messages);
        setConversation(detail.conversation);
        setMessages(history);
        setSessionUsage(
          detail.sessionUsage
            ? { ...detail.sessionUsage, budget: null, remaining: null }
            : null,
        );
        setSpendTier(detail.conversation.spendTier ?? "low");
        setEcoMode((detail.conversation.spendTier ?? "low") === "low");
        setBudgetInput("");
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
        setAgentSteps([]);
        setPendingApproval(null);
      } catch (err: unknown) {
        if (!cached) {
          reportError(err);
        }
      } finally {
        setSessionBusy(false);
      }
    },
    [reportError],
  );


  const refreshIncognitoSessions = useCallback(async () => {
    if (!isIncognitoUnlocked()) {
      setIncognitoSessions([]);
      return;
    }
    try {
      setIncognitoSessions(await listIncognitoSessions());
    } catch {
      setIncognitoSessions([]);
    }
  }, []);

  const enterIncognitoMode = useCallback(async () => {
    setChatPrivacy("private");
    setChatMode("incognito");
    setSidebarView("chats");
    setHistoryOpen(true);
    setIncognitoError(null);
    const exists = await incognitoVaultExists();
    setIncognitoHasVault(exists);
    setIncognitoUnlocked(isIncognitoUnlocked());
    if (isIncognitoUnlocked()) {
      await refreshIncognitoSessions();
    } else {
      setConversation(null);
      setMessages([]);
      setIncognitoSessionId(null);
    }
  }, [refreshIncognitoSessions]);

  const setupIncognitoVault = useCallback(async () => {
    setIncognitoError(null);
    if (incognitoPassword.trim().length < 6) {
      setIncognitoError(t("chatIncognitoTooShort"));
      return;
    }
    if (incognitoPassword !== incognitoPassword2) {
      setIncognitoError(t("chatIncognitoMismatch"));
      return;
    }
    setIncognitoBusy(true);
    try {
      await createIncognitoVault(incognitoPassword);
      setIncognitoHasVault(true);
      setIncognitoUnlocked(true);
      setIncognitoPassword("");
      setIncognitoPassword2("");
      await refreshIncognitoSessions();
    } catch (err: unknown) {
      setIncognitoError(err instanceof Error ? err.message : t("chatIncognitoWrongPassword"));
    } finally {
      setIncognitoBusy(false);
    }
  }, [incognitoPassword, incognitoPassword2, refreshIncognitoSessions, t]);

  const unlockIncognito = useCallback(async () => {
    setIncognitoError(null);
    setIncognitoBusy(true);
    try {
      await unlockIncognitoVault(incognitoPassword);
      setIncognitoUnlocked(true);
      setIncognitoPassword("");
      await refreshIncognitoSessions();
    } catch {
      setIncognitoError(t("chatIncognitoWrongPassword"));
    } finally {
      setIncognitoBusy(false);
    }
  }, [incognitoPassword, refreshIncognitoSessions, t]);

  const lockIncognito = useCallback(() => {
    lockIncognitoVault();
    setIncognitoUnlocked(false);
    setIncognitoSessions([]);
    setIncognitoSessionId(null);
    setConversation(null);
    setMessages([]);
    setPendingApproval(null);
    setAgentSteps([]);
  }, []);

  const wipeIncognito = useCallback(async () => {
    if (!window.confirm(t("chatIncognitoWipeConfirm"))) return;
    setIncognitoBusy(true);
    try {
      const apiIds = new Set<string>();
      if (isIncognitoUnlocked()) {
        for (const item of await listIncognitoSessions()) {
          const full = await loadIncognitoSession(item.id);
          if (full?.apiConversationId) apiIds.add(full.apiConversationId);
        }
      }
      for (const id of apiIds) {
        try {
          await arrabApi.deleteConversation(id);
        } catch {
          // best-effort
        }
      }
      await wipeIncognitoVault();
      setIncognitoHasVault(false);
      setIncognitoUnlocked(false);
      setIncognitoSessions([]);
      setIncognitoSessionId(null);
      setConversation(null);
      setMessages([]);
    } finally {
      setIncognitoBusy(false);
    }
  }, [t]);

  const openIncognitoSession = useCallback(async (id: string) => {
    setSessionBusy(true);
    setError(null);
    try {
      const session = await loadIncognitoSession(id);
      if (!session) return;
      setIncognitoSessionId(session.id);
      setAgentId(session.agentId ?? agentId);
      setMessages(
        session.messages.map((m) => ({
          id: m.id as Message["id"],
          conversationId: (session.apiConversationId ?? id) as Conversation["id"],
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      );
      if (session.apiConversationId) {
        try {
          const detail = await arrabApi.conversation(session.apiConversationId);
          setConversation(detail.conversation);
        } catch {
          setConversation(null);
        }
      } else {
        setConversation(null);
      }
    } catch (err: unknown) {
      reportError(err);
    } finally {
      setSessionBusy(false);
    }
  }, [agentId]);

  const newIncognitoChat = useCallback(async () => {
    if (!isIncognitoUnlocked()) return;
    setSessionBusy(true);
    setError(null);
    try {
      let soloId = agentId || agents[0]?.id || "";
      if (!soloId) {
        const ensured = await ensureDefaultSoloAgent(
          agents,
          defaultSoloAgentBody(
            t("chatSoloDefaultName"),
            t("chatSoloDefaultRole"),
            t("chatSoloDefaultInstructions"),
          ),
        );
        setAgents(ensured);
        soloId = ensured[0]?.id || "";
      }
      setAgentId(soloId);
      const created = await arrabApi.createConversation({
        agentId: soloId,
        projectId: agents.find((a) => a.id === soloId)?.projectId ?? null,
        title: t("chatIncognitoBadge"),
        spend: spendPayload,
      });
      const id = newIncognitoSessionId();
      const session: IncognitoSession = {
        id,
        title: t("chatIncognitoBadge"),
        agentId: soloId,
        apiConversationId: created.id,
        messages: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      await saveIncognitoSession(session);
      rememberIncognitoApiId(created.id);
      setIncognitoSessionId(id);
      setConversation(created);
      setMessages([]);
      setPendingApproval(null);
      setAgentSteps([]);
      await refreshIncognitoSessions();
    } catch (err: unknown) {
      reportError(err);
    } finally {
      setSessionBusy(false);
    }
  }, [agentId, agents, refreshIncognitoSessions, spendPayload, t]);

  const deleteIncognitoChat = useCallback(async (id: string) => {
    try {
      const session = await loadIncognitoSession(id);
      if (session?.apiConversationId) {
        forgetIncognitoApiId(session.apiConversationId);
        try {
          await arrabApi.deleteConversation(session.apiConversationId);
        } catch {
          // ignore
        }
      }
      await deleteIncognitoSession(id);
      if (incognitoSessionId === id) {
        setIncognitoSessionId(null);
        setConversation(null);
        setMessages([]);
      }
      await refreshIncognitoSessions();
    } catch (err: unknown) {
      reportError(err);
    }
  }, [incognitoSessionId, refreshIncognitoSessions]);

  const newChat = useCallback(async (): Promise<Conversation | null> => {
    if (chatMode === "incognito") {
      await newIncognitoChat();
      return null;
    }
    setSessionBusy(true);
    setError(null);
    try {
      let created: Conversation;
      if (chatMode === "team") {
        const pick = teamId || teams[0]?.id || "";
        if (!pick) {
          setError(t("chatNeedTeamFirst"));
          return null;
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
          const ensured = await ensureDefaultSoloAgent(
            agents,
            defaultSoloAgentBody(
              soloDraft.trim() || t("chatSoloDefaultName"),
              t("chatSoloDefaultRole"),
              t("chatSoloDefaultInstructions"),
            ),
          );
          setAgents(ensured);
          soloId = ensured[0]?.id || "";
          setSoloDraft("");
          if (!soloId) {
            setError(t("chatNeedSoloFirst"));
            return null;
          }
          created = await arrabApi.createConversation({
            agentId: soloId,
            projectId: ensured[0]?.projectId ?? null,
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
      setAgentSteps([]);
      setPendingApproval(null);
      if (created.agentId) setAgentId(created.agentId);
      composerRef.current?.focus();
      return created;
    } catch (err: unknown) {
      reportError(err);
      return null;
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
        await deleteChatHistory(id);
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
            setAgentSteps([]);
            setPendingApproval(null);
          }
        }
      } catch (err: unknown) {
        reportError(err);
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
        reportError(err);
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
        reportError(err);
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
        reportError(err);
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
        reportError(err);
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
        reportError(err);
      } finally {
        setAgentSaving(false);
      }
    },
    [t],
  );

  const switchSoloAgent = useCallback(
    async (nextAgentId: string) => {
      if (!nextAgentId || nextAgentId === agentId) return;
      // Swap selection immediately — don't wait for network.
      startTransition(() => {
        setAgentId(nextAgentId);
        setChatMode("solo");
        setMessages([]);
        setConversation(null);
        setSessionUsage(null);
        setAgentSteps([]);
        setPendingApproval(null);
      });
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
        setAgentSteps([]);
        setPendingApproval(null);
      } catch (err: unknown) {
        reportError(err);
      } finally {
        setSessionBusy(false);
      }
    },
    [agentId, agents, conversations, openConversation, reportError, spendPayload, t],
  );

  /** Instant companion switch — local resolve first, network only if agent missing. */
  const selectCompanionFast = useCallback(
    async (person: CompanionProfile) => {
      startTransition(() => {
        setActivePersonId(person.id);
        setOrgLane("companions");
        setChatPrivacy("chat");
        setChatMode("solo");
        setCatalogOpen(false);
      });
      const localId = resolveCompanionAgentId(person, agents);
      if (localId) {
        if (person.agentId !== localId) {
          // keep profile linked without blocking UI
          void ensureOrgCompanionAgent(person, {
            syncProfile: false,
            knownAgents: agents,
            locale: locale === "ar" ? "ar" : "en",
          }).catch(() => undefined);
        }
        await switchSoloAgent(localId);
        return;
      }
      setAgentBusy(true);
      setError(null);
      try {
        const agent = await ensureOrgCompanionAgent(person, {
          syncProfile: true,
          knownAgents: agents,
          locale: locale === "ar" ? "ar" : "en",
        });
        setAgents((current) => [agent, ...current.filter((item) => item.id !== agent.id)]);
        await switchSoloAgent(agent.id);
      } catch (err: unknown) {
        reportError(err);
      } finally {
        setAgentBusy(false);
      }
    },
    [agents, locale, reportError, switchSoloAgent],
  );

  const hireAgent = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const preset = hirePreset ? SOLO_PRESETS.find((item) => item.id === hirePreset) : null;
      const name = hireName.trim() || preset?.specialty || t("chatSoloDefaultName");
      const role = hireRole.trim() || preset?.role || t("chatSoloDefaultRole");
      setAgentBusy(true);
      setError(null);
      try {
        const created = await arrabApi.createAgent({
          name,
          role,
          specialty: preset?.specialty ?? "general",
          instructions: preset?.instructions ?? t("chatSoloDefaultInstructions"),
          status: "active",
        });
        setAgents((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setHireName("");
        setHireRole("");
        setHirePreset("");
        setHireOpen(false);
        setSidebarView("people");
        setChatMode("solo");
        await switchSoloAgent(created.id);
        setDeskTab("agent");
        setDeskOpen(true);
      } catch (err: unknown) {
        reportError(err);
      } finally {
        setAgentBusy(false);
      }
    },
    [hireName, hirePreset, hireRole, switchSoloAgent, t],
  );


  const saveCompanionAttachments = useCallback(async () => {
    if (!selectedAgent || !isCompanionAgent(selectedAgent)) return;
    setAgentBusy(true);
    setError(null);
    try {
      const result = await attachEmployeesToCompanion({
        companion: selectedAgent,
        employeeIds: attachPicks,
        teams,
        memberships,
      });
      setTeams(result.teams);
      setMemberships(result.memberships);
      setAttachOpen(false);
      setAttachPicks([]);
    } catch (err: unknown) {
      reportError(err);
    } finally {
      setAgentBusy(false);
    }
  }, [attachPicks, memberships, selectedAgent, teams]);

  const duplicateAgent = useCallback(
    async (id: string) => {
      const source = agents.find((agent) => agent.id === id);
      if (!source) return;
      setAgentMenu(null);
      setAgentBusy(true);
      setError(null);
      try {
        const created = await arrabApi.createAgent({
          name: `${source.name} ${t("chatAgentCopySuffix")}`,
          role: source.role,
          specialty: source.specialty,
          bio: source.bio,
          instructions: source.instructions,
          projectId: source.projectId,
          status: "active",
        });
        setAgents((current) => [created, ...current]);
        await switchSoloAgent(created.id);
      } catch (err: unknown) {
        reportError(err);
      } finally {
        setAgentBusy(false);
      }
    },
    [agents, switchSoloAgent, t],
  );

  const setAgentStatus = useCallback(
    async (
      id: string,
      status: "active" | "paused" | "archived",
      mode: "archive" | "delete" = "archive",
    ) => {
      setAgentMenu(null);
      const previous = agents;
      setAgentBusy(true);
      setError(null);
      const removing = status === "archived" || mode === "delete";
      if (removing) {
        const remaining = agents.filter((agent) => agent.id !== id);
        setAgents(remaining);
        if (agentId === id) {
          if (remaining[0]) {
            void switchSoloAgent(remaining[0].id);
          } else {
            setAgentId("");
            setConversation(null);
            setMessages([]);
          }
        }
      } else {
        setAgents((current) =>
          current.map((agent) => (agent.id === id ? { ...agent, status } : agent)),
        );
      }
      try {
        if (mode === "delete") {
          // Hard delete — conversations + messages stay in the database.
          try {
            await arrabApi.removeAgent(id);
          } catch {
            try {
              await arrabApi.deleteAgent(id);
            } catch {
              try {
                await arrabApi.archiveAgent(id);
              } catch {
                await arrabApi.updateAgent(id, { status: "archived" });
              }
            }
          }
        } else if (status === "archived") {
          // Soft archive — agent row + chats remain in the database.
          try {
            await arrabApi.archiveAgent(id);
          } catch {
            await arrabApi.updateAgent(id, { status: "archived" });
          }
        } else {
          const updated = await arrabApi.updateAgent(id, { status });
          setAgents((current) =>
            current.map((agent) => (agent.id === updated.id ? updated : agent)),
          );
        }
      } catch (err: unknown) {
        // Keep the optimistic removal — never bounce the agent back with a failed banner.
        if (!(status === "archived" || mode === "delete")) {
          setAgents(previous);
          reportError(err);
          setError(t("chatDeleteFailed"));
        }
      } finally {
        setAgentBusy(false);
      }
    },
    [agentId, agents, reportError, switchSoloAgent, t],
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
    const languageRule =
      locale === "ar"
        ? [
            "LANGUAGE: Match the operator's latest message.",
            "English message → reply in English. Arabic message → reply in Arabic.",
            "UI locale is Arabic — use Arabic companion/product names when referring to the UI.",
          ].join(" ")
        : [
            "LANGUAGE: Match the operator's latest message.",
            "English message → reply in English. Arabic message → reply in Arabic.",
            "UI locale is English — use English companion/product names when referring to the UI.",
          ].join(" ");
    const webRule =
      "You may use web_search and fetch_url for live research when it helps answer accurately.";
    const brainRule =
      chatMode === "solo"
        ? brainContextSnippet("solo", agentId || conversation?.agentId || null, locale === "ar" ? "ar" : "en", 6)
        : "";
    const directives = [languageRule, webRule, brainRule || null, operatorDirectives]
      .filter(Boolean)
      .join("\n");
    const sessionNotes = notes.trim() || null;
    const goal = activeGoal.trim() || null;
    if (
      workspace.kind === "none" &&
      !sessionNotes &&
      !directives &&
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
      operatorDirectives: directives,
      activeGoal: goal,
      workspaceRules,
      recentTerminal:
        lines
          .slice(-20)
          .map((line) => `${line.kind === "input" ? "$ " : ""}${line.text}`.slice(0, 400))
          .join("\n")
          .trim() || null,
    };
  }, [
    activeGoal,
    agentId,
    chatMode,
    conversation?.agentId,
    gitStatus,
    lines,
    locale,
    notes,
    treeSummary,
    workspace,
    workspaceRules,
  ]);

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
      reportError(err);
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
      const message = err instanceof Error ? err.message : t("apiUnavailable");
      if (!isTransientApiError(message)) {
        setError(message);
      }
    }
  }

  async function onUploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const { notifyUploadAttached } = await import("@/lib/composer-attachments");
    const parts: string[] = [];
    const attachedNames: string[] = [];
    const skippedNames: string[] = [];
    for (const file of Array.from(fileList).slice(0, 6)) {
      if (file.size > 800_000) {
        parts.push(`[Attached: ${file.name} — skipped, file too large (>800KB)]`);
        skippedNames.push(file.name);
        continue;
      }
      const isText =
        file.type.startsWith("text/") ||
        /\.(md|txt|json|csv|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|css|html|xml|yml|yaml|toml|sh|sql|log)$/i.test(
          file.name,
        );
      if (isText) {
        try {
          const text = await file.text();
          parts.push(`[Attached file: ${file.name}]\n${text.slice(0, 24_000)}`);
          attachedNames.push(file.name);
        } catch {
          parts.push(`[Attached file: ${file.name} — could not read]`);
          skippedNames.push(file.name);
        }
      } else if (file.type.startsWith("image/")) {
        parts.push(
          `[Attached image: ${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB). Use the filename/context; binary not inlined.]`,
        );
        attachedNames.push(file.name);
      } else {
        parts.push(
          `[Attached file: ${file.name} (${file.type || "binary"}, ${Math.round(file.size / 1024)}KB)]`,
        );
        attachedNames.push(file.name);
      }
    }
    if (parts.length === 0) return;
    const block = parts.join("\n\n");
    setDraft((current) => (current.trim() ? `${current.trim()}\n\n${block}` : block));
    notifyUploadAttached({ attachedNames, skippedNames });
    composerRef.current?.focus();
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
      reportError(err);
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
      reportError(err);
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
      reportError(err);
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
      reportError(err);
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
      reportError(err);
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
      reportError(err);
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
      reportError(err);
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

  function pauseStream() {
    pauseRequestedRef.current = true;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setSending(false);
    setError(null);
    setAgentSteps((current) =>
      current.map((step) =>
        step.status === "running" || step.status === "pending"
          ? { ...step, status: "failed" as const, title: t("chatPaused"), detail: t("chatPaused") }
          : step,
      ),
    );
  }

  async function flushQueuedQuery() {
    const next = queuedQueryRef.current?.trim();
    if (!next) return;
    queuedQueryRef.current = null;
    setQueuedQuery(null);
    await onSend(undefined, next);
  }

  async function onSend(event?: FormEvent, overrideContent?: string) {
    event?.preventDefault();
    if (chatMode === "incognito" && (!incognitoUnlocked || !incognitoSessionId)) {
      setError(t("chatIncognitoLockedTitle"));
      return;
    }
    const content = (overrideContent ?? draft).trim();
    if (!content) {
      return;
    }
    if (sending && !overrideContent) {
      setQueuedQuery(content);
      queuedQueryRef.current = content;
      setDraft("");
      return;
    }
    let activeConversation = conversation;
    if (!activeConversation) {
      if (!agentId && companions.length === 0 && employees.length === 0 && agents.length === 0) {
        setError(t("chatNeedCompanionFirst"));
        return;
      }
      activeConversation = await newChat();
      if (!activeConversation) return;
    }
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    pauseRequestedRef.current = false;
    setSending(true);
    setError(null);
    if (!overrideContent) setDraft("");
    if (orgLane === "companions") noteTopics(content);
    const optimisticId = `local-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId as Message["id"],
        conversationId: activeConversation!.id,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    let streamed = "";
    const assistantLocalId = `local-asst-${crypto.randomUUID()}`;
    setAgentSteps([{ id: "thinking", title: "thinking", status: "running" }]);
    setPendingApproval(null);
    let completedOk = false;
    let webUserFallback: string | null = null;

    if (readPrefs().notifyAgentPresence) {
      void showAgentPresence({
        agentName: activeCompanionLabel || selectedAgent?.name || "Arrab",
        agentPhoto: activePerson?.avatarPhoto ?? null,
        hue: activePerson?.hue ?? 210,
        faceSeed: activePerson?.faceSeed ?? 17,
        title: locale === "ar" ? "يفكر…" : "Thinking…",
        body: content.slice(0, 72),
        progress: 0.12,
        state: "thinking",
        href: "/chat",
      });
    }

    // Client-side web search so replies work even when the API has no web tools.
    const searchQuery = parseWebSearchCommand(content);
    let workspaceHint = buildHint();
    if (searchQuery) {
      setAgentSteps([
        {
          id: "web-search",
          title: friendlyToolTitle("web_search", searchQuery),
          detail: t("chatWebSearching"),
          status: "running",
        },
      ]);
      try {
        const result = await clientSearchWeb(searchQuery);
        controller.signal.throwIfAborted();
        const modelBlock = formatWebSearchForModel(result);
        webUserFallback = formatWebSearchForUser(result, locale);
        const base = workspaceHint ?? { kind: "none" as const };
        workspaceHint = {
          ...base,
          sessionNotes: [base.sessionNotes, modelBlock].filter(Boolean).join("\n\n"),
          operatorDirectives: [
            base.operatorDirectives,
            "LIVE WEB RESULTS are already in session notes. Answer from them immediately with a clear summary and URLs. Never say you cannot search the web.",
          ]
            .filter(Boolean)
            .join("\n"),
        };
        setAgentSteps([
          {
            id: "web-search",
            title: friendlyToolTitle("web_search", searchQuery),
            detail: result.summary.slice(0, 600),
            status: "done",
          },
          { id: "thinking", title: "thinking", status: "running" },
        ]);
      } catch (searchErr: unknown) {
        if (controller.signal.aborted) {
          setSending(false);
          return;
        }
        setAgentSteps([
          {
            id: "web-search",
            title: friendlyToolTitle("web_search", searchQuery),
            detail: searchErr instanceof Error ? searchErr.message : t("apiUnavailable"),
            status: "failed",
          },
          { id: "thinking", title: "thinking", status: "running" },
        ]);
      }
    }

    const applyLocalAssistant = (text: string) => {
      setMessages((current) => {
        const cleaned = current.filter(
          (message) => message.id !== optimisticId && message.id !== assistantLocalId,
        );
        return [
          ...cleaned,
          {
            id: optimisticId as Message["id"],
            conversationId: activeConversation.id,
            role: "user",
            content,
            createdAt: new Date().toISOString(),
          },
          {
            id: assistantLocalId as Message["id"],
            conversationId: activeConversation.id,
            role: "assistant",
            content: text,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      setAgentSteps([]);
      completedOk = true;
      void updateAgentPresence({
        title: locale === "ar" ? "جاهز" : "Ready",
        progress: 1,
        state: "done",
      });
      void hideAgentPresence(2200);
    };

    try {
      await arrabApi.sendMessageStream(
        activeConversation.id,
        {
          content: searchQuery
            ? `Web search request: ${searchQuery}\n\nUser message: ${content}`
            : content,
          workspaceHint,
          spend: spendPayload,
          model: resolvePreferredModel(aiStatus, prefs),
        },
        {
          onToken: (text) => {
            if (controller.signal.aborted) return;
            streamed += text;
            if (streamed.length < 40 || streamed.length % 120 < text.length) {
              void updateAgentPresence({
                title: locale === "ar" ? "يكتب…" : "Writing…",
                progress: Math.min(0.88, 0.35 + streamed.length / 4000),
                state: "working",
              });
            }
            setAgentSteps((current) =>
              current.map((step) =>
                step.id === "thinking" && step.status === "running"
                  ? { ...step, status: "done" as const }
                  : step,
              ),
            );
            setMessages((current) => {
              const without = current.filter((message) => message.id !== assistantLocalId);
              return [
                ...without,
                {
                  id: assistantLocalId as Message["id"],
                  conversationId: activeConversation.id,
                  role: "assistant",
                  content: streamed,
                  createdAt: new Date().toISOString(),
                },
              ];
            });
          },
          onToolStart: (name, detail) => {
            if (controller.signal.aborted) return;
            void updateAgentPresence({
              title: friendlyToolTitle(name, detail),
              body: detail?.slice(0, 80) || undefined,
              progress: 0.55,
              state: "working",
            });
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
                .find(({ step }) => step.status === "running")?.index;
              const done: AgentStep = {
                id: `tool-${crypto.randomUUID()}`,
                title: friendlyToolTitle(name, detail),
                detail,
                status: detail.toLowerCase().includes("fail") ? "failed" : "done",
              };
              if (runningIdx == null) return [...current, done];
              const copy = [...current];
              copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
              return copy;
            });
          },
          onApproval: (approval) => {
            const copy = humanizeApprovalCopy({
              title: approval.title,
              detail: approval.detail,
            });
            void updateAgentPresence({
              title: copy.title,
              body: copy.body,
              preview: copy.preview,
              progress: 0.78,
              state: "needs_you",
              approvalId: approval.id,
            });
            void handleChatIncomingApproval(approval);
          },
          onDone: (result) => {
            if (controller.signal.aborted) return;
            const reply =
              result.assistantMessage?.content?.trim() ||
              streamed.trim() ||
              webUserFallback ||
              "";
            if (!reply && webUserFallback) {
              applyLocalAssistant(webUserFallback);
              return;
            }
            if (!reply) {
              setError(t("apiUnavailable"));
              setAgentSteps((current) =>
                current.map((step) =>
                  step.status === "running" || step.status === "pending"
                    ? { ...step, status: "failed" as const }
                    : step,
                ),
              );
              void updateAgentPresence({
                title: locale === "ar" ? "تعذّر الإكمال" : "Couldn’t finish",
                state: "error",
                progress: 1,
              });
              void hideAgentPresence(3200);
              return;
            }
            completedOk = true;
            void updateAgentPresence({
              title: locale === "ar" ? "جاهز" : "Ready",
              body: reply.slice(0, 72),
              progress: 1,
              state: result.approval ? "needs_you" : "done",
            });
            if (!result.approval) {
              void hideAgentPresence(2600);
            }
            setMessages((current) => {
              const cleaned = current.filter(
                (message) =>
                  message.id !== optimisticId && message.id !== assistantLocalId,
              );
              return [
                ...cleaned,
                result.userMessage,
                result.assistantMessage?.content?.trim()
                  ? result.assistantMessage
                  : {
                      id: assistantLocalId as Message["id"],
                      conversationId: activeConversation.id,
                      role: "assistant" as const,
                      content: reply,
                      createdAt: new Date().toISOString(),
                    },
              ];
            });
            setProviderConfigured(result.providerConfigured);
            setSessionUsage(
              result.sessionUsage
                ? { ...result.sessionUsage, budget: null, remaining: null }
                : null,
            );
            if (result.approval) {
              void handleChatIncomingApproval(result.approval);
            }
            setConversation((current) =>
              current
                ? {
                    ...current,
                    spendTier: result.sessionUsage?.tier ?? current.spendTier,
                    sessionTokenBudget: null,
                    updatedAt: new Date().toISOString(),
                    title:
                      current.title && current.title !== t("chatNewChat")
                        ? current.title
                        : content.slice(0, 48),
                  }
                : current,
            );
            setAgentSteps([]);
            void refreshConversations();
            if (!result.providerConfigured) {
              setError(t("noProvider"));
            }
          },
          onError: (message) => {
            if (controller.signal.aborted) return;
            if (webUserFallback) {
              applyLocalAssistant(webUserFallback);
              setError(null);
              void updateAgentPresence({
                title: locale === "ar" ? "جاهز" : "Ready",
                progress: 1,
                state: "done",
              });
              void hideAgentPresence(2200);
              return;
            }
            setError(message);
            setAgentSteps((current) =>
              current.map((step) =>
                step.status === "running" || step.status === "pending"
                  ? { ...step, status: "failed" as const }
                  : step,
              ),
            );
            void updateAgentPresence({
              title: locale === "ar" ? "تعذّر الإكمال" : "Couldn’t finish",
              body: message.slice(0, 80),
              state: "error",
              progress: 1,
            });
            void hideAgentPresence(3200);
          },
        },
        controller.signal,
      );
      if (!completedOk && !controller.signal.aborted && webUserFallback && !streamed.trim()) {
        applyLocalAssistant(webUserFallback);
      }
      composerRef.current?.focus();
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        // paused — keep messages; next query can go out
      } else if (webUserFallback) {
        applyLocalAssistant(webUserFallback);
        setError(null);
      } else {
        reportError(err);
        setAgentSteps((current) =>
          current.map((step) =>
            step.status === "running" || step.status === "pending"
              ? { ...step, status: "failed" as const }
              : step,
          ),
        );
      }
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
      setSending(false);
      const shouldFlushQueue = Boolean(queuedQueryRef.current?.trim());
      pauseRequestedRef.current = false;
      if (shouldFlushQueue) {
        queueMicrotask(() => {
          void flushQueuedQuery();
        });
      }
    }
  }

  async function sendQueuedNow() {
    const text = queuedQuery?.trim();
    if (!text) return;
    setQueuedQuery(null);
    queuedQueryRef.current = null;
    if (sending) {
      pauseStream();
      queueMicrotask(() => {
        void onSend(undefined, text);
      });
      return;
    }
    await onSend(undefined, text);
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
  useEffect(() => {
    if (!chatFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatFullscreen]);


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

  function applyDeskPolicy(next: DeskPolicy) {
    setDeskPolicy(next);
    try {
      localStorage.setItem(DESK_POLICY_KEY, next);
    } catch {
      // ignore
    }
    if (agentId) writeAgentSessionPolicy(agentId, next);
  }

  useEffect(() => {
    if (!agentId) return;
    const next = readAgentSessionPolicy(agentId);
    setDeskPolicy(next);
  }, [agentId]);

  async function handleChatIncomingApproval(approval: Approval) {
    if (handledChatApprovals.current.has(approval.id)) return;
    handledChatApprovals.current.add(approval.id);
    const toolName = parseToolNameFromApproval(approval.detail, approval.title);
    const allowAll = deskPolicyRef.current === "allow";
    const auto =
      (toolName && isAutoClientTool(toolName)) ||
      (toolName && isPolicyClientTool(toolName) && allowAll) ||
      (toolName && isEmailPolicyTool(toolName) && allowAll);

    // Email send/arrange runs on the API after resolve — no local desk exec.
    if (auto && toolName && isEmailPolicyTool(toolName)) {
      setAgentSteps((current) => [
        ...current.map((step) =>
          step.id === "thinking" && step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
        ),
        {
          id: `tool-${crypto.randomUUID()}`,
          title: friendlyToolTitle(toolName, approval.detail ?? undefined),
          detail: approval.detail ?? undefined,
          status: "running",
        },
      ]);
      try {
        const result = await arrabApi.resolveApproval(approval.id, { status: "approved" });
        setPendingApproval(null);
        setAgentSteps((current) => {
          const runningIdx = [...current]
            .map((step, index) => ({ step, index }))
            .reverse()
            .find(({ step }) => step.status === "running")?.index;
          const done = {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, approval.detail ?? undefined),
            detail: approval.detail ?? t("approvalGranted"),
            status: "done" as const,
          };
          if (runningIdx == null) return [...current, done];
          const copy = [...current];
          copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
          return copy;
        });
        if (result.continued?.assistantMessage) {
          setMessages((current) => [...current, result.continued!.assistantMessage!]);
          if (result.continued.sessionUsage) {
            setSessionUsage(result.continued.sessionUsage);
          }
        }
        if (result.continued?.approval) {
          void handleChatIncomingApproval(result.continued.approval);
        }
      } catch {
        setPendingApproval(approval);
      }
      return;
    }

    if (auto && toolName && isClientExecTool(toolName)) {
      const cwd = workspace.kind === "folder" ? workspace.folderPath : null;
      if (!cwd || !isTauriRuntime()) {
        setPendingApproval(approval);
        return;
      }
      setAgentSteps((current) => [
        ...current.map((step) =>
          step.id === "thinking" && step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
        ),
        {
          id: `tool-${crypto.randomUUID()}`,
          title: friendlyToolTitle(toolName, approval.detail ?? undefined),
          detail: approval.detail ?? undefined,
          status: "running",
        },
      ]);
      try {
        if (toolName === "run_terminal") setTerminalOpen(true);
        const args = parseToolArgsFromApproval(approval.detail);
        const executed = await executeLocalAgentTool(toolName, args, cwd, {
          onTerminal: (kind, text) => {
            if (kind === "input") {
              setLines((current) => [
                ...current,
                { id: crypto.randomUUID(), kind: "input", text: `$ ${text}` },
              ]);
            } else {
              setLines((current) => [...current, { id: crypto.randomUUID(), kind, text }]);
            }
          },
        });
        const detail = `${executed.ok ? "OK" : "FAILED"} — ${executed.summary}\n${executed.toolResult}`.slice(
          0,
          2500,
        );
        setAgentSteps((current) => {
          const runningIdx = [...current]
            .map((step, index) => ({ step, index }))
            .reverse()
            .find(({ step }) => step.status === "running")?.index;
          const done = {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, detail),
            detail,
            status: (executed.ok ? "done" : "failed") as "done" | "failed",
          };
          if (runningIdx == null) return [...current, done];
          const copy = [...current];
          copy[runningIdx] = { ...copy[runningIdx]!, ...done, id: copy[runningIdx]!.id };
          return copy;
        });
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
        if (result.continued?.approval) {
          void handleChatIncomingApproval(result.continued.approval);
        }
      } catch {
        setPendingApproval(approval);
      }
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
        const detail = `${executed.ok ? "OK" : "FAILED"} — ${executed.summary}\n${executed.toolResult}`.slice(
          0,
          2500,
        );
        setAgentSteps((current) => [
          ...current,
          {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, detail),
            detail,
            status: executed.ok ? "done" : "failed",
          },
        ]);
      } else if (status === "approved" && toolName && isEmailPolicyTool(toolName)) {
        setAgentSteps((current) => [
          ...current.map((step) =>
            step.id === `approval-${pendingApproval.id}` || step.status === "pending"
              ? { ...step, status: "running" as const }
              : step,
          ),
          {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, pendingApproval.detail ?? undefined),
            detail: pendingApproval.detail ?? undefined,
            status: "running",
          },
        ]);
      }
      const approvalId = pendingApproval.id;
      const approvalDetail = pendingApproval.detail;
      const result = await arrabApi.resolveApproval(approvalId, {
        status,
        toolResult: toolResult ?? null,
      });
      setPendingApproval(null);
      if (status === "approved" && toolName && isEmailPolicyTool(toolName)) {
        setAgentSteps((current) => {
          const runningIdx = [...current]
            .map((step, index) => ({ step, index }))
            .reverse()
            .find(({ step }) => step.status === "running")?.index;
          const done = {
            id: `tool-${crypto.randomUUID()}`,
            title: friendlyToolTitle(toolName, approvalDetail ?? undefined),
            detail: approvalDetail ?? t("approvalGranted"),
            status: "done" as const,
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
          setAgentSteps((current) => [
            ...current,
            ...result.continued!.toolsUsed!
              .filter((name) => !isClientExecTool(name))
              .map((name) => ({
                id: `tool-${crypto.randomUUID()}`,
                title: friendlyToolTitle(name),
                detail: t("approvalGranted"),
                status: "done" as const,
              })),
          ]);
        }
        if (result.continued.approval) {
          void handleChatIncomingApproval(result.continued.approval);
        }
      } else if (status === "rejected") {
        setError(t("chatApprovalRejected"));
      }
    } catch (err: unknown) {
      reportError(err);
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
      void resolveChatApproval(request.status);
      return true;
    });
  }, [pendingApproval]);

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

  async function adoptCatalogCompanion(person: CompanionProfile) {
    await selectCompanionFast(person);
  }

  if (catalogOpen) {
    return (
      <Surface className="cp-ui h-full overflow-hidden">
        <CompanionCatalog
          space="work"
          signedIn={signedIn}
          initialDomain={birthDomain}
          onClose={() => {
            setCatalogOpen(false);
            setBirthDomain("");
          }}
          onCreated={(person) => {
            void adoptCatalogCompanion(person);
          }}
        />
      </Surface>
    );
  }


  return (
    <Surface
      className={cn(
        "cp-ui cp-chat h-full overflow-hidden px-3 pb-3 pt-1 sm:px-5",
        chatFullscreen && "chat-org-fullscreen !px-3",
      )}
    >
      {!chatFullscreen ? (
        <OrgChatTopBar
          lane={orgLane === "employees" ? "employees" : "companions"}
          privacy={chatPrivacy}
          people={workPeople}
          employees={employees}
          activeAgentId={agentId || null}
          activePersonId={activePerson?.id ?? null}
          busy={sessionBusy || agentBusy}
          fullscreen={false}
          onLaneChange={(lane) => {
            setOrgLane(lane);
            setChatPrivacy("chat");
            setChatMode("solo");
            if (lane === "companions") {
              const next = workPeople[0];
              if (next) void selectCompanionFast(next);
            } else {
              const next = employees[0];
              setActivePersonId(null);
              if (next) void switchSoloAgent(next.id);
            }
          }}
          onPrivacyChange={(privacy) => {
            setChatPrivacy(privacy);
            setChatFullscreen(false);
            if (privacy === "private") {
              setChatMode("incognito");
            } else {
              setChatMode("solo");
              if (orgLane === "companions") {
                const next = activePerson ?? workPeople[0];
                if (next) void selectCompanionFast(next);
              } else {
                const next = employees[0] ?? agents[0];
                if (next) void switchSoloAgent(next.id);
              }
            }
          }}
          onSelectPerson={(personId) => {
            const person = findCompanion(companionState, personId);
            if (person) void selectCompanionFast(person);
          }}
          onSelectEmployee={(id) => {
            setActivePersonId(null);
            setOrgLane("employees");
            setChatPrivacy("chat");
            setChatMode("solo");
            void switchSoloAgent(id);
          }}
          onCreateCompanion={() => {
            setBirthDomain("");
            setCatalogOpen(true);
            setAttachOpen(false);
          }}
          onAddPeople={() => {
            setAttachOpen(true);
            if (selectedAgent) setAttachPicks([]);
          }}
          onOpenAll={() => {
            if (orgLane === "employees") {
              setAllPeopleOpen(true);
            } else {
              setCatalogOpen(true);
            }
          }}
          onToggleFullscreen={() => setChatFullscreen(true)}
        />
      ) : (
        <OrgChatFullscreenExit
          title={selectedAgent?.name ?? conversationTitle}
          onExit={() => setChatFullscreen(false)}
        />
      )}

      {chatPrivacy === "private" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <IncognitoRoom
            onExit={() => {
              setChatPrivacy("chat");
              setChatMode("solo");
              const next =
                (orgLane === "employees" ? employees[0] : companions[0]) ?? agents[0];
              if (next) void switchSoloAgent(next.id);
            }}
          />
        </div>
      ) : (
      <>
          {error && !isTransientApiError(error) ? (
            <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs text-neutral-400 lg:px-6">
              {error}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            {showChat ? (
              <section className="cp-room flex min-h-0 min-w-0 flex-1 flex-col" aria-label={selectedAgent?.name ?? t("chat")}>
                <header className="cp-room-header">
                  <div className="cp-room-person">
                    {activePerson && orgLane === "companions" ? (
                      <PersonAvatar person={activePerson} active size="sm" />
                    ) : (
                      <span className="home-avatar flex size-9 items-center justify-center text-[11px] font-medium">
                        {(selectedAgent?.name ?? "?").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <strong>{activeCompanionLabel}</strong>
                    <span className="cp-muted">{activeCompanionSub}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedAgent && isCompanionAgent(selectedAgent) ? (
                      <button type="button" className="cp-button" disabled={sessionBusy || agentBusy} onClick={() => setAttachOpen(true)}>
                        {t("chatAddPeople")}
                        <ArrowUpRight size={15} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="cp-button"
                      disabled={sessionBusy}
                      onClick={() => void newChat()}
                    >
                      {t("chatNewChat")}
                    </button>
                  </div>
                </header>
                <div className="cp-messages min-h-0 flex-1 overflow-y-auto" role="log">
                  {(!conversation && !sessionBusy) || (conversation && messages.length === 0 && !sending) ? (
                    <div className="cp-chat-welcome">
                      <span className="cp-welcome-icon">
                        <Sparkles size={30} strokeWidth={1.25} />
                      </span>
                      <p className="cp-eyebrow">{t("chatOrgEmptyTitle")}</p>
                      <h2>
                        {orgLane === "companions" && activePerson
                          ? companionDisplayName(activePerson, locale)
                          : selectedAgent
                            ? selectedAgent.name
                            : t("chatReadyTitle")}
                      </h2>
                      <p className="cp-muted">{t("chatOrgEmptyBody")}</p>
                      <div className="cp-starters">
                        {!conversation ? (
                          <button type="button" onClick={() => void newChat()}>
                            {t("chatNewChat")}
                            <ArrowUpRight size={15} />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setDraft(t("compExampleSummarise"));
                                composerRef.current?.focus();
                              }}
                            >
                              {t("compExampleSummarise")}
                              <ArrowUpRight size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDraft(t("compExampleLongDay"));
                                composerRef.current?.focus();
                              }}
                            >
                              {t("compExampleLongDay")}
                              <ArrowUpRight size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-1 pb-4">
                    {messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        youLabel={t("you")}
                        coworkerLabel={activeCompanionLabel}
                        copyLabel={t("copy")}
                        copiedLabel={t("copied")}
                      />
                    ))}
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
                    {sending || agentSteps.some((step) => step.status === "running") ? (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {agentSteps.length > 0 ? (
                            <AgentSteps steps={agentSteps} thinkingLabel={`${t("thinking")}…`} />
                          ) : (
                            <AgentSteps
                              steps={[{ id: "thinking", title: "thinking", status: "running" }]}
                              thinkingLabel={`${t("thinking")}…`}
                            />
                          )}
                        </div>
                        {sending ? (
                          <button
                            type="button"
                            onClick={pauseStream}
                            className="mt-1 shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-medium text-neutral-200 transition hover:border-white/30 hover:text-white"
                          >
                            {t("chatPause")}
                          </button>
                        ) : null}
                      </div>
                    ) : agentSteps.length > 0 ? (
                      <AgentSteps steps={agentSteps} thinkingLabel={`${t("thinking")}…`} />
                    ) : null}
                    <div ref={chatEnd} />
                  </div>
                </div>

                <div className="cp-composer-area">
                  {birth && orgLane === "companions" && chatPrivacy === "chat" && !draft.trim() && !sending ? (
                    <div className="cp-birth mx-auto mb-2 max-w-3xl">
                      <span>{t("compBornTitle").replace("{topic}", birth.domain)}</span>
                      <button
                        type="button"
                        className="cp-text-button"
                        onClick={() => {
                          setBirthDomain(birth.domain);
                          setCatalogOpen(true);
                        }}
                      >
                        {t("compAddCompanion")}
                      </button>
                      <button
                        type="button"
                        className="cp-icon"
                        onClick={() => dismissBirth(birth.domain)}
                        aria-label={t("compDismiss")}
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                <form
                  onSubmit={(event) => void onSend(event)}
                  className="mx-auto w-full max-w-3xl space-y-3"
                >
                  <div className="space-y-3">
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

                    <div className="cp-composer-wrap space-y-2">
                      {queuedQuery !== null ? (
                        <QueuedQueryBar
                          value={queuedQuery}
                          onChange={setQueuedQuery}
                          onDiscard={() => setQueuedQuery(null)}
                          onSendNow={() => void sendQueuedNow()}
                        />
                      ) : null}
                    <div className="cp-composer">
                      <textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onComposerKey}
                        rows={2}
                        disabled={!conversation && !selectedAgent}
                        placeholder={
                          sending
                            ? t("chatQueueHint")
                            : activeCompanionLabel
                              ? t("chatMessageAgent").replace("{name}", activeCompanionLabel)
                              : t("messagePlaceholder")
                        }
                      />
                      <div className="cp-composer-actions">
                        <div className="relative flex items-center gap-0.5" ref={composerMenuRef}>
                          <ComposerPlusMenu
                            open={plusOpen}
                            onOpenChange={(open) => {
                              setPlusOpen(open);
                              if (open) setComposerMenuOpen(false);
                            }}
                            onUploadImages={() => imageUploadRef.current?.click()}
                            onUploadFiles={() => uploadInputRef.current?.click()}
                            onConnectFolder={() => void chooseFolder()}
                            onWebSearch={() => {
                              const next = draft.trim().startsWith("/web ")
                                ? draft
                                : `/web ${draft.trim()}`.trim();
                              setDraft(next === "/web" ? "/web " : `${next}${next.endsWith(" ") ? "" : " "}`);
                              composerRef.current?.focus();
                            }}
                          />
                          <input
                            ref={imageUploadRef}
                            type="file"
                            accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              void onUploadFiles(event.target.files);
                              event.target.value = "";
                            }}
                          />
                          <input
                            ref={uploadInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              void onUploadFiles(event.target.files);
                              event.target.value = "";
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void chooseFolder()}
                            className={cn(
                              "chat-pro-icon-btn",
                              workspace.kind === "folder" && workspace.folderPath && "is-on",
                            )}
                            title={
                              workspace.kind === "folder" && workspace.folderPath
                                ? workspace.folderPath
                                : t("chooseFolder")
                            }
                            aria-label={t("chooseFolder")}
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
                            onClick={() => uploadInputRef.current?.click()}
                            className="chat-pro-icon-btn"
                            title={t("chatUpload")}
                            aria-label={t("chatUpload")}
                          >
                            <Paperclip className="size-4" strokeWidth={1.6} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = draft.trim().startsWith("/web ")
                                ? draft
                                : `/web ${draft.trim()}`.trim();
                              setDraft(next === "/web" ? "/web " : `${next}${next.endsWith(" ") ? "" : " "}`);
                              composerRef.current?.focus();
                            }}
                            className="chat-pro-icon-btn"
                            title={t("chatWebSearchHint")}
                            aria-label={t("chatWebSearch")}
                          >
                            <Globe className="size-4" strokeWidth={1.6} />
                          </button>
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
                                    label: t("chooseFolder"),
                                    icon: FolderOpen,
                                    action: () => {
                                      void chooseFolder();
                                    },
                                  },
                                  {
                                    id: "upload",
                                    label: t("chatUpload"),
                                    icon: Paperclip,
                                    action: () => {
                                      uploadInputRef.current?.click();
                                    },
                                  },
                                  {
                                    id: "web",
                                    label: t("chatWebSearch"),
                                    icon: Globe,
                                    action: () => {
                                      setDraft((current) =>
                                        current.trim().startsWith("/web")
                                          ? current
                                          : `/web ${current.trim()}`.trim() + " ",
                                      );
                                      composerRef.current?.focus();
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

                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center rounded-full bg-white/[0.04] p-0.5">
                            <button
                              type="button"
                              onClick={() => applyDeskPolicy("ask")}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition",
                                deskPolicy === "ask"
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
                              onClick={() => applyDeskPolicy("allow")}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition",
                                deskPolicy === "allow"
                                  ? "bg-white text-black"
                                  : "text-neutral-500 hover:text-neutral-300",
                              )}
                              title={t("coworkAllowEverything")}
                            >
                              <ShieldCheck className="size-3.5" strokeWidth={1.8} />
                              {t("coworkAllowEverything")}
                            </button>
                          </div>
                          {sending ? (
                            <div className="flex items-center gap-1.5">
                              <PauseSendButton onPause={pauseStream} />
                              {draft.trim() ? (
                                <button
                                  type="submit"
                                  className="inline-flex size-8 items-center justify-center rounded-full bg-white/90 text-black transition hover:bg-white"
                                  aria-label={t("chatQueueSendHint")}
                                  title={t("chatQueueSendHint")}
                                >
                                  <ArrowUp className="size-3.5" strokeWidth={2.2} />
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <button
                              type="submit"
                              disabled={
                                (!conversation && !selectedAgent) ||
                                draft.trim() === ""
                              }
                              className="inline-flex size-8 items-center justify-center rounded-full bg-white/90 text-black transition hover:bg-white disabled:opacity-25"
                              aria-label={t("send")}
                              title={prefs.coworkEnterSend ? t("pressEnter") : t("shiftEnterSend")}
                            >
                              <ArrowUp className="size-3.5" strokeWidth={2.2} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>
                </form>
                <p className="cp-composer-foot mx-auto max-w-3xl">
                  <span>{t("pressEnter")} · {t("shiftEnterSend")}</span>
                </p>
                </div>
              </section>
            ) : null}

        </div>
      </>
      )}


      {agentMenu ? (
        <div
          className="fixed z-[60] max-h-[min(320px,calc(100vh-24px))] min-w-[190px] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#111] py-1 shadow-2xl"
          style={{ left: agentMenu.x, top: agentMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const target = agents.find((agent) => agent.id === agentMenu.id);
            const paused = target?.status === "paused";
            if (agentMenu.confirmDelete) {
              return (
                <>
                  <p className="px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
                    {t("chatKeepsInDatabase")}
                  </p>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                    onClick={() => void setAgentStatus(agentMenu.id, "archived", "archive")}
                  >
                    <Archive className="size-3.5" strokeWidth={1.7} />
                    {t("chatArchiveAgent")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-red-300 hover:bg-white/[0.06]"
                    onClick={() => void setAgentStatus(agentMenu.id, "archived", "delete")}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.7} />
                    {t("chatDeleteForever")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-300 hover:bg-white/[0.06]"
                    onClick={() => setAgentMenu(null)}
                  >
                    {t("cancel")}
                  </button>
                </>
              );
            }
            return (
              <>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                  onClick={() => {
                    const id = agentMenu.id;
                    setAgentMenu(null);
                    void switchSoloAgent(id);
                    setSidebarView("chats");
                  }}
                >
                  <MessageSquarePlus className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("chatOpenChat")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                  onClick={() => {
                    const id = agentMenu.id;
                    setAgentMenu(null);
                    void switchSoloAgent(id);
                    setDeskTab("agent");
                    setDeskOpen(true);
                  }}
                >
                  <UserRound className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("chatConfigureAgent")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                  onClick={() => void duplicateAgent(agentMenu.id)}
                >
                  <Copy className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  {t("chatDuplicateAgent")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-neutral-200 hover:bg-white/[0.06]"
                  onClick={() =>
                    void setAgentStatus(agentMenu.id, paused ? "active" : "paused")
                  }
                >
                  {paused ? (
                    <Play className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  ) : (
                    <Pause className="size-3.5 text-neutral-500" strokeWidth={1.7} />
                  )}
                  {paused ? t("chatResumeAgent") : t("chatPauseAgent")}
                </button>
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[12px] text-red-300 hover:bg-white/[0.06]"
                  onClick={() =>
                    setAgentMenu((current) =>
                      current ? { ...current, confirmDelete: true } : current,
                    )
                  }
                >
                  <Trash2 className="size-3.5" strokeWidth={1.7} />
                  {t("chatDeleteAgent")}
                </button>
              </>
            );
          })()}
        </div>
      ) : null}

      {chatMenu ? (
        <div
          className="fixed z-[60] max-h-[min(200px,calc(100vh-24px))] min-w-[160px] overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-[#111] py-1 shadow-2xl"
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


      {attachOpen && selectedAgent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setAttachOpen(false)}>
          <div
            className="w-full max-w-md space-y-3 rounded-[24px] border border-white/10 bg-[var(--color-surface)] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-[16px] font-medium text-white">{t("chatAddPeople")}</h2>
            <p className="text-[13px] text-neutral-500">
              {t("chatAddEmployeesHint").replace("{name}", selectedAgent.name)}
            </p>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {employees.map((agent) => {
                const on = attachPicks.includes(agent.id);
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachPicks((current) =>
                          on ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                        )
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-[13px]",
                        on ? "bg-white/[0.1] text-white" : "text-neutral-400 hover:bg-white/[0.04]",
                      )}
                    >
                      <span className="home-avatar flex size-8 items-center justify-center text-[10px]">
                        {agentInitials(agent.name)}
                      </span>
                      {agent.name}
                    </button>
                  </li>
                );
              })}
              {employees.length === 0 ? (
                <li className="py-6 text-center text-[13px] text-neutral-600">{t("chatNoEmployeesYet")}</li>
              ) : null}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={agentBusy || attachPicks.length === 0}
                onClick={() => void saveCompanionAttachments()}
                className="home-btn-primary h-10 flex-1 disabled:opacity-40"
              >
                {agentBusy ? t("saving") : t("chatAddEmployees")}
              </button>
              <button type="button" className="home-btn-secondary h-10 px-4" onClick={() => setAttachOpen(false)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {allPeopleOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setAllPeopleOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[var(--color-surface)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="text-[16px] font-medium text-white">
                {orgLane === "employees" ? t("chatEmployeesMode") : t("chatCompanionsMode")}
              </h2>
              <button type="button" className="text-sm text-neutral-500 hover:text-white" onClick={() => setAllPeopleOpen(false)}>
                {t("close")}
              </button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
              {(orgLane === "employees" ? employees : companions).map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start",
                      agent.id === agentId ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                    )}
                    onClick={() => {
                      void switchSoloAgent(agent.id);
                      setAllPeopleOpen(false);
                    }}
                  >
                    <span className="home-avatar flex size-10 items-center justify-center text-[11px]">
                      {agentInitials(agent.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-white">{agent.name}</span>
                      <span className="block truncate text-[12px] text-neutral-500">{agent.role}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
  copyLabel,
  copiedLabel,
}: {
  message: Message;
  youLabel: string;
  coworkerLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyChatText(message.content);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <article className={cn("group/msg flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <p className="text-[10px] tracking-[0.1em] text-neutral-600">
        {isUser ? youLabel : coworkerLabel}
      </p>
      <div
        className={cn(
          "relative max-w-[min(88%,42rem)] px-4 py-3 text-[14px] leading-[1.55]",
          isUser
            ? "rounded-[1.15rem] rounded-br-md bg-white text-black"
            : "rounded-[1.15rem] rounded-bl-md border border-white/[0.08] bg-white/[0.035] text-neutral-200",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <ChatMarkdown content={message.content} />
        )}
        <button
          type="button"
          onClick={() => void onCopy()}
          className={cn(
            "absolute -bottom-2 end-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[10px] text-neutral-300 opacity-0 transition group-hover/msg:opacity-100",
            isUser && "border-black/10 bg-white/90 text-neutral-600",
          )}
          aria-label={copyLabel}
        >
          <Copy size={10} strokeWidth={1.8} />
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </article>
  );
}

