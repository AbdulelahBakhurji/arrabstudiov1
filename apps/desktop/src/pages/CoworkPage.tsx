import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Columns2,
  FileCode2,
  FolderOpen,
  GitBranch,
  HardDrive,
  Laptop,
  MessagesSquare,
  PanelRight,
  Play,
  Plus,
  Save,
  ShieldCheck,
  ShieldQuestion,
  SquareTerminal,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  Agent,
  Approval,
  Conversation,
  Message,
  Project,
  SessionUsageSnapshot,
  Team,
  TokenSpendTier,
  WorkspaceMention,
} from "@arrab/shared";
import { ArtifactsPanel, extractArtifacts } from "@/components/ArtifactsPanel";
import { AgentSteps, friendlyToolTitle, type AgentStep } from "@/components/AgentSteps";
import { MentionComposer } from "@/components/MentionComposer";
import { Surface } from "@/components/StudioFrame";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useStudioPrefs } from "@/hooks/useStudioPrefs";
import { LAST_COWORK_AGENT_KEY } from "@/lib/prefs";
import { notifyStudio } from "@/lib/notify";
import { arrabApi, ApiRequestError, isTransientApiError } from "@/lib/api";
import {
  defaultSoloAgentBody,
  ensureDefaultSoloAgent,
} from "@/lib/agents-bootstrap";
import {
  executeLocalAgentTool,
  formatToolDiffPreview,
  isAutoClientTool,
  isClientExecTool,
  isPolicyClientTool,
  listEditCheckpoints,
  parseToolArgsFromApproval,
  parseToolNameFromApproval,
  restoreEditCheckpoint,
  type EditCheckpoint,
} from "@/lib/agent-local-tools";
import { listDir, readTextFile, writeTextFile, type FsEntry } from "@/lib/fs";
import { isTauriRuntime, pickFolder, runLocalCommand, type TerminalLine } from "@/lib/terminal";
import { loadWorkspaceRules } from "@/lib/workspace-rules";
import { loadBestMessages, listCachedChats, usePersistedChat } from "@/lib/chat-history";
import { cn } from "@/lib/utils";

type FocusMode = "chat" | "split" | "terminal";
type DeskTab = "git" | "run" | "notes" | "restore";
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
  low: 2_500,
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentRel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function CoworkPage() {
  const { t } = useLanguage();
  const prefs = useStudioPrefs();
  const [agents, setAgents] = useState<Agent[]>([]);
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
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [streamDraft, setStreamDraft] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMention[]>([]);
  const [workspaceRules, setWorkspaceRules] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<EditCheckpoint[]>([]);
  const [spendTier, setSpendTier] = useState<TokenSpendTier>(() => readSpendPrefs().tier);
  const [budgetInput, setBudgetInput] = useState(() => readSpendPrefs().budgetInput);
  const [sessionUsage, setSessionUsage] = useState<SessionUsageSnapshot | null>(null);
  const [ecoMode, setEcoMode] = useState(() => readSpendPrefs().tier === "low");
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
  const [terminalTall, setTerminalTall] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [focus, setFocus] = useState<FocusMode>("chat");
  const [filesRailOpen, setFilesRailOpen] = useState(false);
  const [deskTab, setDeskTab] = useState<DeskTab>("notes");
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
  const [branch, setBranch] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState("");
  const [gitDiff, setGitDiff] = useState("");
  const [gitLog, setGitLog] = useState("");
  const [machineBusy, setMachineBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchInput, setBranchInput] = useState("");
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

  const linkedProject = useMemo(() => {
    const id = selectedAgent?.projectId ?? conversation?.projectId;
    return projects.find((project) => project.id === id) ?? null;
  }, [conversation?.projectId, projects, selectedAgent?.projectId]);

  const spendPayload = useMemo(() => {
    const trimmed = budgetInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    return {
      tier: spendTier,
      sessionTokenBudget:
        parsed !== null && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null,
    };
  }, [budgetInput, spendTier]);

  const budgetExhausted =
    sessionUsage?.budget !== null &&
    sessionUsage?.budget !== undefined &&
    (sessionUsage.remaining ?? 0) <= 0;

  const activeAgentTab = useMemo(
    () => agentTabs.find((tab) => tab.key === activeTabKey) ?? null,
    [activeTabKey, agentTabs],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        SPEND_KEY,
        JSON.stringify({ tier: spendTier, budgetInput }),
      );
    } catch {
      // ignore
    }
  }, [budgetInput, spendTier]);

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
      if (preferredFocus === "terminal" || preferredFocus === "chat" || preferredFocus === "split") {
        sessionStorage.removeItem("arrab.coworkFocus");
        setFocus(preferredFocus);
      } else if (prefs.coworkTerminalDock) {
        setFocus("split");
        setFilesRailOpen(true);
        setDeskOpen(true);
      } else {
        setFocus("chat");
      }
      const [agentList, projectList, ai, teamList] = await Promise.all([
        arrabApi.agents(),
        arrabApi.projects(),
        arrabApi.aiStatus(),
        arrabApi.teams().catch(() => ({ items: [] as Team[] })),
      ]);
      let active = agentList.items.filter((agent) => agent.status !== "archived");
      active = await ensureDefaultSoloAgent(
        active,
        defaultSoloAgentBody(
          t("chatSoloDefaultName"),
          t("chatSoloDefaultRole"),
          t("chatSoloDefaultInstructions"),
        ),
      );
      setAgents(active);
      setProjects(projectList.items);
      setProviderConfigured(ai.configured);

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
          href: "/cowork",
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
  }, [prefs.coworkAutoResume, prefs.coworkTerminalDock, prefs.notifyCowork, t]);

  useEffect(() => {
    void boot();
    // Boot once per Cowork mount. Pref/`t` identity churn used to spawn extra Solo agents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const taskRaw = sessionStorage.getItem("arrab.coworkTask");
    if (taskRaw) {
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
      setGitDiff("");
      setGitLog("");
      setBranch(null);
      return;
    }
    setMachineBusy(true);
    try {
      const [status, diff, log, branchResult] = await Promise.all([
        runLocalCommand("git status -sb", folderPath),
        runLocalCommand("git diff --stat && git diff --cached --stat", folderPath),
        runLocalCommand("git log -6 --oneline --decorate", folderPath),
        runLocalCommand("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo", folderPath),
      ]);
      setGitStatus([status.stdout, status.stderr].filter(Boolean).join("\n").trim() || t("gitClean"));
      setGitDiff([diff.stdout, diff.stderr].filter(Boolean).join("\n").trim());
      setGitLog([log.stdout, log.stderr].filter(Boolean).join("\n").trim());
      const nextBranch = branchResult.stdout.trim();
      setBranch(nextBranch && !nextBranch.includes("fatal") ? nextBranch : null);
      setBranchInput((current) => current || (nextBranch.includes("fatal") ? "" : nextBranch));
      // Soften raw git fatals for humans
      if (/fatal: not a git repository/i.test(status.stderr + status.stdout)) {
        setGitStatus(t("coworkNotGitRepo"));
        setGitDiff(t("coworkNotGitRepoHint"));
        setGitLog("—");
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
      setFilesRailOpen(false);
      setDeskOpen(false);
      appendTerm("system", `${t("openedFolder")}: ${path}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    }
  }

  async function openEntry(entry: FsEntry) {
    if (!folderPath) {
      return;
    }
    if (entry.kind === "dir") {
      setDirRel(entry.path);
      return;
    }
    setMachineBusy(true);
    setError(null);
    try {
      const file = await readTextFile(folderPath, entry.path);
      setOpenFile(file.path);
      setFileContent(file.content);
      setFileDirty(false);
      setFileTabs((current) => {
        const existing = current.find((tab) => tab.path === file.path);
        if (existing) {
          return current.map((tab) =>
            tab.path === file.path ? { ...tab, content: file.content, dirty: false } : tab,
          );
        }
        return [...current, { path: file.path, content: file.content, dirty: false }].slice(-8);
      });
      setFocus((current) => (current === "terminal" ? "split" : current));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("folderNeedsDesktop"));
    } finally {
      setMachineBusy(false);
    }
  }

  function selectFileTab(path: string) {
    const tab = fileTabs.find((item) => item.path === path);
    if (!tab) return;
    setOpenFile(tab.path);
    setFileContent(tab.content);
    setFileDirty(tab.dirty);
  }

  function closeFileTab(path: string) {
    setFileTabs((current) => {
      const next = current.filter((tab) => tab.path !== path);
      if (openFile === path) {
        const fallback = next[next.length - 1] ?? null;
        setOpenFile(fallback?.path ?? null);
        setFileContent(fallback?.content ?? "");
        setFileDirty(fallback?.dirty ?? false);
      }
      return next;
    });
  }

  async function saveOpenFile() {
    if (!folderPath || !openFile) {
      return;
    }
    setMachineBusy(true);
    setError(null);
    try {
      await writeTextFile(folderPath, openFile, fileContent);
      setFileDirty(false);
      setFileTabs((current) =>
        current.map((tab) =>
          tab.path === openFile ? { ...tab, content: fileContent, dirty: false } : tab,
        ),
      );
      appendTerm("system", `${t("savedFile")}: ${openFile}`);
      await refreshGit();
      await refreshFiles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("folderNeedsDesktop"));
    } finally {
      setMachineBusy(false);
    }
  }

  function attachFileToChat() {
    if (!openFile) {
      return;
    }
    const snippet = fileContent.slice(0, 3500);
    const block = [
      `File on this PC: ${openFile}`,
      "```",
      snippet,
      fileContent.length > 3500 ? "\n…(truncated)" : "",
      "```",
    ].join("\n");
    setDraft((current) => (current.trim() ? `${current.trim()}\n\n${block}` : block));
    setFocus("chat");
  }

  async function runInFolder(command: string, label?: string) {
    if (!folderPath) {
      setError(t("openFolderFirst"));
      return;
    }
    if (!isTauriRuntime()) {
      setError(t("folderNeedsDesktop"));
      return;
    }
    setFocus("terminal");
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

  async function commitLocal() {
    const message = commitMessage.trim();
    if (!message) {
      setError(t("commitMessageRequired"));
      return;
    }
    const escaped = message.replace(/"/g, '\\"');
    await runInFolder(`git add -A && git commit -m "${escaped}"`, t("commit"));
    setCommitMessage("");
    await refreshGit();
  }

  async function pushLocal() {
    if (!window.confirm(t("confirmPush"))) {
      return;
    }
    await runInFolder("git push", t("push"));
    await refreshGit();
  }

  async function pullLocal() {
    await runInFolder("git pull --ff-only", t("pull"));
    await refreshGit();
  }

  async function checkoutBranch() {
    const name = branchInput.trim();
    if (!name) {
      setError(t("branchRequired"));
      return;
    }
    await runInFolder(`git checkout "${name.replace(/"/g, "")}"`, `${t("checkout")} ${name}`);
    await refreshGit();
  }

  async function createBranch() {
    const name = branchInput.trim();
    if (!name) {
      setError(t("branchRequired"));
      return;
    }
    await runInFolder(
      `git checkout -b "${name.replace(/"/g, "")}"`,
      `${t("createBranch")} ${name}`,
    );
    await refreshGit();
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
      if (detail.conversation.spendTier) {
        setSpendTier(detail.conversation.spendTier);
        setEcoMode(detail.conversation.spendTier === "low");
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
              latest.items.filter((agent) => agent.status !== "archived"),
              defaultSoloAgentBody(
                t("chatSoloDefaultName"),
                t("chatSoloDefaultRole"),
                t("chatSoloDefaultInstructions"),
              ),
            );
            setAgents(ensured);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (next === "allow" && pendingApproval && isLocalToolApproval(pendingApproval)) {
      void resolveCoworkApproval(pendingApproval, "approved");
    }
  }

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
      const result = await arrabApi.resolveApproval(approval.id, {
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

  async function handleIncomingApproval(approval: Approval) {
    if (handledApprovalsRef.current.has(approval.id)) {
      return;
    }
    handledApprovalsRef.current.add(approval.id);
    const toolName = parseToolNameFromApproval(approval.detail, approval.title);
    const auto =
      (toolName && isAutoClientTool(toolName)) ||
      (toolName &&
        isPolicyClientTool(toolName) &&
        terminalPolicyRef.current === "allow");
    if (auto && toolName && isClientExecTool(toolName)) {
      setAgentSteps((current) => [
        ...current.map((step) =>
          step.id === "thinking" && step.status === "running"
            ? { ...step, status: "done" as const }
            : step,
        ),
        {
          id: `tool-${crypto.randomUUID()}`,
          title: friendlyToolTitle(toolName, approval.detail ?? undefined),
          detail: t("coworkTerminalAutoRunning"),
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
  }

  function buildWorkspaceHint() {
    const low = ecoMode || spendTier === "low";
    const treeLimit = low ? 25 : 60;
    const fileCap = low ? 2500 : 8000;
    const termLines = low ? 10 : 24;
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
        directiveLines.length > 0 ? directiveLines.slice(0, low ? 4 : 8).join("\n") : null;
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
        return `${prefix}${line.text}`.slice(0, low ? 180 : 400);
      })
      .join("\n");
    const roster = agents
      .slice(0, 12)
      .map((agent) => `- ${agent.name} (${agent.role})`)
      .join("\n");
    return {
      kind: (folderPath ? "folder" : "none") as "folder" | "none",
      folderPath,
      branch,
      gitStatus: low
        ? gitStatus.slice(0, 600) || null
        : [gitStatus, gitDiff].filter(Boolean).join("\n\n") || null,
      treeSummary: folderPath
        ? [dirRel ? `cwd: ${dirRel}` : "cwd: .", treeSummary].filter(Boolean).join("\n") || null
        : null,
      repoFullName: null,
      operatorDirectives,
      activeGoal: activeGoal.trim() || null,
      openFilePath: openFile,
      openFileContent: openFile
        ? fileContent.slice(0, fileCap) + (fileContent.length > fileCap ? "\n…(truncated)" : "")
        : null,
      recentTerminal: recentTerminal.trim() || null,
      workspaceRules: workspaceRules
        ? workspaceRules.slice(0, low ? 2000 : 6000)
        : null,
      mentions: mentions.length > 0 ? mentions : null,
      sessionNotes: [
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
          ? low
            ? "Desk: use list_files/search_code/read_file then apply_patch/write_file/run_terminal. Be brief. Prefer mv over delete."
            : [
                "Cowork desk policy:",
                "- You have real local file + terminal tools in this folder.",
                "- Use list_files/search_code/read_file first, then apply_patch/write_file/run_terminal.",
                "- For Desktop organization: create clear folders, move files with `mv`, avoid deleting unless asked.",
                "- After changes, summarize what you did and what remains.",
              ].join("\n")
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

  async function onSend(event?: FormEvent) {
    event?.preventDefault();
    if (draft.trim() === "" || sending || budgetExhausted) {
      return;
    }
    let activeConversation = conversation;
    if (!activeConversation) {
      activeConversation = await startSession("resume");
      if (!activeConversation) return;
    }
    const content = draft.trim();
    const attachedMentions = mentions;
    setSending(true);
    setError(null);
    setAgentSteps([
      { id: "thinking", title: "thinking", status: "running" },
    ]);
    setPendingApproval(null);
    setStreamDraft("");
    setDraft("");
    setMentions([]);
    const streamOnce = async (conversationId: string) => {
      let finalAssistant: Message | null = null;
      await arrabApi.sendMessageStream(
        conversationId,
        {
          content,
          spend: spendPayload,
          workspaceHint: {
            ...buildWorkspaceHint(),
            mentions: attachedMentions.length > 0 ? attachedMentions : null,
          },
        },
        {
          onToken: (text) => {
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
      );
      return finalAssistant;
    };

    try {
      await streamOnce(activeConversation.id);
      composerRef.current?.focus();
    } catch (err: unknown) {
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
      setSending(false);
      setStreamDraft("");
    }
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

  const showChat = focus !== "terminal" || !folderPath;
  const showFilesRail = Boolean(folderPath) && filesRailOpen;
  const showDesk = deskOpen;
  const showTerminal = Boolean(folderPath) && focus === "terminal";

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

  async function deleteAgentFromTab(agentId: string, tabKey: string) {
    setTabMenu(null);
    setSessionBusy(true);
    try {
      try {
        await arrabApi.deleteAgent(agentId);
      } catch {
        await arrabApi.updateAgent(agentId, { status: "archived" });
      }
      setAgents((current) => current.filter((agent) => agent.id !== agentId));
      closeAgentTab(tabKey);
    } catch (err: unknown) {
      setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
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

      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3.5 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={cn(
              "home-avatar flex size-11 shrink-0 items-center justify-center text-[12px] font-medium",
              !folderPath && "opacity-70",
            )}
          >
            {selectedAgent ? initials(selectedAgent.name) : <Laptop className="size-4" strokeWidth={1.6} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-medium tracking-[-0.02em] text-white">
                {activeAgentTab?.kind === "team"
                  ? t("coworkTeamTab")
                  : selectedAgent?.name ?? t("coworkTitle")}
              </h1>
              {conversation ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-neutral-400">
                  <span className="cowork-pulse size-1.5 rounded-full bg-emerald-400/90" />
                  {t("sessionLive")}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">
              {folderPath
                ? [folderName(folderPath), branch ? branch : null]
                    .filter(Boolean)
                    .join(" · ")
                : t("coworkNoFolderHint")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 rounded-2xl bg-white/[0.04] p-1 sm:flex" title={t("coworkTokenUsage")}>
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
                  setBudgetInput(String(DEFAULT_SESSION_BUDGETS[id]));
                }}
                className={cn(
                  "h-8 rounded-xl px-2.5 text-[11px] font-medium transition-colors",
                  spendTier === id ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {folderPath ? (
            <>
              <div className="hidden items-center rounded-2xl bg-white/[0.04] p-1 md:flex">
                {(
                  [
                    ["chat", t("coworkFocusChat"), MessagesSquare],
                    ["split", t("coworkFocusSplit"), Columns2],
                    ["terminal", t("coworkFocusTerminal"), SquareTerminal],
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
                        setFilesRailOpen(false);
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
              <button
                type="button"
                onClick={() => void chooseFolder()}
                className="home-btn-secondary hidden h-9 items-center gap-1.5 px-3 text-[12px] lg:inline-flex"
                title={t("changeFolder")}
              >
                <FolderOpen className="size-3.5" strokeWidth={1.6} />
                {t("changeFolder")}
              </button>
              <button
                type="button"
                onClick={() => void chooseFolder()}
                className="chat-pro-icon-btn lg:hidden"
                title={t("changeFolder")}
                aria-label={t("changeFolder")}
              >
                <FolderOpen className="size-4" strokeWidth={1.6} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="home-btn-secondary h-9 items-center gap-1.5 px-3 text-[12px] inline-flex"
              title={t("openPcFolder")}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.6} />
              {t("openPcFolder")}
            </button>
          )}

          <button
            type="button"
            onClick={() => void startSession(conversation ? "fresh" : "resume")}
            disabled={sessionBusy}
            className="home-btn-primary hidden h-9 px-4 text-[12px] disabled:opacity-40 sm:inline-flex sm:items-center"
          >
            {sessionBusy ? t("connecting") : conversation ? t("newSession") : t("startSession")}
          </button>

          {folderPath ? (
            <button
              type="button"
              onClick={() => setFilesRailOpen((open) => !open)}
              className={cn("chat-pro-icon-btn", filesRailOpen && "is-on")}
              title={t("coworkFilesRail")}
              aria-label={t("coworkFilesRail")}
            >
              <HardDrive className="size-4" strokeWidth={1.6} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setDeskOpen((open) => !open)}
            className={cn("chat-pro-icon-btn", deskOpen && "is-on")}
            title={t("coworkDeskTitle")}
            aria-label={t("coworkDeskTitle")}
          >
            <PanelRight className="size-4" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      <div className="cowork-agent-tabs relative z-10">
        {agentTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => switchAgentTab(tab)}
            className={cn("cowork-agent-tab", activeTabKey === tab.key && "is-on")}
          >
            {tab.kind === "team" ? <Users className="size-3.5" strokeWidth={1.8} /> : null}
            {tab.label}
          </button>
        ))}
        <div className="ms-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-neutral-600 lg:inline">{t("coworkAgentsTogether")}</span>
          <div className="relative">
            <details className="group">
              <summary className="cowork-agent-tab list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                <Plus className="size-3.5" strokeWidth={2} />
                {t("coworkOpenAgent")}
              </summary>
              <div className="absolute end-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0c] py-1 shadow-xl">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => openAgentTab(agent)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-[12px] text-neutral-300 hover:bg-white/[0.05]"
                  >
                    <span className="home-avatar flex size-6 items-center justify-center text-[9px]">
                      {initials(agent.name)}
                    </span>
                    {agent.name}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>
      </div>

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

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {showFilesRail ? (
            <aside className="cowork-file-rail cowork-rise hidden md:flex">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-white">{t("coworkFilesRail")}</p>
                  <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                    {folderName(folderPath!)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!dirRel}
                    onClick={() => setDirRel(parentRel(dirRel))}
                    className="home-btn-secondary h-8 px-2.5 text-[11px] disabled:opacity-30"
                    title={t("coworkGoUp")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilesRailOpen(false)}
                    className="chat-pro-icon-btn"
                    title={t("close")}
                    aria-label={t("close")}
                  >
                    <X className="size-3.5" strokeWidth={1.7} />
                  </button>
                </div>
              </div>
              <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => void openEntry(entry)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-[12px] transition",
                        openFile === entry.path
                          ? "bg-white/[0.08] text-white"
                          : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200",
                      )}
                    >
                      {entry.kind === "dir" ? (
                        <FolderOpen className="size-3.5 shrink-0 text-neutral-500" />
                      ) : (
                        <FileCode2 className="size-3.5 shrink-0 text-neutral-600" />
                      )}
                      <span className="truncate">{entry.name}</span>
                    </button>
                  </li>
                ))}
                {entries.length === 0 ? (
                  <li className="px-2.5 py-4 text-[12px] text-neutral-600">{t("openFolderToList")}</li>
                ) : null}
              </ul>
              {fileTabs.length > 0 ? (
                <div className="border-t border-white/[0.06]">
                  <div className="cowork-file-tabs">
                    {fileTabs.map((tab) => (
                      <button
                        key={tab.path}
                        type="button"
                        onClick={() => selectFileTab(tab.path)}
                        className={cn("cowork-file-tab inline-flex items-center gap-1", openFile === tab.path && "is-on")}
                      >
                        <span className="truncate">{tab.path.split("/").pop()}</span>
                        {tab.dirty ? "*" : ""}
                        <span
                          role="presentation"
                          onClick={(event) => {
                            event.stopPropagation();
                            closeFileTab(tab.path);
                          }}
                          className="text-neutral-600 hover:text-white"
                        >
                          <X className="size-2.5" />
                        </span>
                      </button>
                    ))}
                  </div>
                  {openFile ? (
                    <div className="flex flex-col gap-2 p-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={machineBusy}
                          onClick={() => void saveOpenFile()}
                          className="inline-flex items-center gap-1 text-[10px] text-neutral-300"
                        >
                          <Save className="size-3" />
                          {t("save")}
                          {fileDirty ? "*" : ""}
                        </button>
                        <button
                          type="button"
                          onClick={attachFileToChat}
                          className="text-[10px] text-neutral-500 hover:text-white"
                        >
                          {t("attachToChat")}
                        </button>
                      </div>
                      <textarea
                        value={fileContent}
                        onChange={(event) => {
                          const next = event.target.value;
                          setFileContent(next);
                          setFileDirty(true);
                          setFileTabs((current) =>
                            current.map((tab) =>
                              tab.path === openFile ? { ...tab, content: next, dirty: true } : tab,
                            ),
                          );
                        }}
                        rows={10}
                        className="w-full resize-none rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-neutral-300 outline-none"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </aside>
          ) : null}

          {showChat ? (
            <section
              className={cn(
                "cowork-rise flex min-h-0 min-w-0 flex-col",
                showDesk ? "flex-[1.2]" : "flex-1",
              )}
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
                {!folderPath ? (
                  <EmptyState
                    title={t("coworkOpenFolderTitle")}
                    body={t("coworkOpenFolderBody")}
                    actionLabel={t("openPcFolder")}
                    onAction={() => void chooseFolder()}
                    hero
                  />
                ) : null}
                {folderPath && !conversation && agents.length === 0 ? (
                  <EmptyState
                    title={t("coworkHireTitle")}
                    body={t("coworkHireBody")}
                    actionLabel={t("coworkHireCta")}
                    onAction={() => void hireCoworker()}
                    hero
                  />
                ) : null}
                {folderPath && !conversation && agents.length > 0 ? (
                  <EmptyState
                    title={t("coworkEmptyTitle")}
                    body={t("coworkPcEmpty").replace(
                      "{folder}",
                      folderName(folderPath),
                    )}
                    actionLabel={t("startSession")}
                    onAction={() => void startSession("resume")}
                    hero
                  />
                ) : null}
                {folderPath && conversation && messages.length === 0 && !sending ? (
                  <EmptyState
                    title={selectedAgent?.name ?? t("coworker")}
                    body={t("coworkPcReady").replace("{folder}", folderName(folderPath))}
                    soft
                  />
                ) : null}

                {folderPath && focus === "chat" && !filesRailOpen ? (
                  <div className="mx-auto mb-4 flex max-w-2xl justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setFilesRailOpen(true);
                        setFocus("split");
                        setDeskOpen(true);
                      }}
                      className="cowork-folder-chip inline-flex items-center gap-2"
                    >
                      <FolderOpen className="size-3.5" strokeWidth={1.7} />
                      <span className="truncate max-w-[220px]">{folderName(folderPath)}</span>
                      <span className="text-neutral-500">{t("coworkShowWorkspace")}</span>
                    </button>
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
                    <div className="rounded-2xl border border-white/[0.12] bg-[#0c0c0c] p-4">
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

                    <div className="chat-pro-composer">
                      <MentionComposer
                        value={draft}
                        onChange={setDraft}
                        mentions={mentions}
                        onMentionsChange={setMentions}
                        agents={agents}
                        files={entries}
                        folderPath={folderPath}
                        textareaRef={composerRef}
                        disabled={sending}
                        placeholder={
                          folderPath ? t("coworkMentionPlaceholder") : t("coworkChatPlaceholder")
                        }
                        rows={2}
                        className="!min-h-[56px] border-0 bg-transparent px-1 py-0.5 text-[15px] leading-[1.55] tracking-[-0.01em] text-white shadow-none outline-none placeholder:text-neutral-600 disabled:opacity-40"
                        onSubmit={() => void onSend()}
                      />
                      {workspaceRules ? (
                        <p className="mt-1 px-1 text-[10px] text-neutral-600">
                          {t("coworkRulesLoaded")}
                        </p>
                      ) : null}
                      {budgetExhausted ? (
                        <p className="mt-1 px-1 text-[10px] text-neutral-500">{t("spendBudgetExhausted")}</p>
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
                              setFilesRailOpen(true);
                              setDeskOpen(true);
                            }}
                            className="chat-pro-icon-btn"
                            title={t("filesTab")}
                            aria-label={t("filesTab")}
                          >
                            <HardDrive className="size-4" strokeWidth={1.6} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeskTab("git");
                              setFocus("split");
                              setFilesRailOpen(true);
                              setDeskOpen(true);
                            }}
                            className="chat-pro-icon-btn"
                            title={t("gitTab")}
                            aria-label={t("gitTab")}
                          >
                            <GitBranch className="size-4" strokeWidth={1.6} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFocus("terminal")}
                            className="chat-pro-icon-btn"
                            title={t("terminal")}
                            aria-label={t("terminal")}
                          >
                            <SquareTerminal className="size-4" strokeWidth={1.6} />
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
                          <button
                            type="submit"
                            disabled={sending || draft.trim() === "" || sessionBusy || budgetExhausted}
                            className="inline-flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200 disabled:opacity-25"
                            aria-label={t("send")}
                            title={prefs.coworkEnterSend ? t("pressEnter") : t("shiftEnterSend")}
                          >
                            <ArrowUp className="size-3.5" strokeWidth={2.2} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
            </section>
          ) : null}

          {showDesk ? (
            <aside className="cowork-rise cowork-rise-delay desk-panel flex w-[280px] shrink-0 flex-col border-s border-white/[0.06] bg-transparent xl:w-[300px]">
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
                <nav className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.03] p-0.5">
                  {(
                    [
                      ["git", t("gitTab")],
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

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
                {!folderPath && deskTab !== "notes" ? (
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
                {deskTab === "git" && folderPath ? (
                  <>
                    <div className="desk-card space-y-2 p-3.5">
                      <p className="text-[13px] font-medium text-white">{t("gitStatus")}</p>
                      <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400">
                        {gitStatus || t("openFolderFirst")}
                      </pre>
                    </div>
                    <div className="desk-card space-y-2 p-3.5">
                      <p className="text-[13px] font-medium text-white">{t("gitDiff")}</p>
                      <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400">
                        {gitDiff || t("noDiff")}
                      </pre>
                    </div>
                    <div className="desk-card space-y-2 p-3.5">
                      <p className="text-[13px] font-medium text-white">{t("gitLog")}</p>
                      <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400">
                        {gitLog || "—"}
                      </pre>
                    </div>
                    <div className="desk-card space-y-2 p-3.5">
                      <p className="text-[13px] font-medium text-white">{t("branches")}</p>
                      <input
                        value={branchInput}
                        onChange={(event) => setBranchInput(event.target.value)}
                        placeholder={t("branchPlaceholder")}
                        className="desk-input"
                        disabled={!folderPath}
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={!folderPath || terminalBusy}
                          onClick={() => void checkoutBranch()}
                          className="home-btn-secondary h-8 px-3 text-[11px] disabled:opacity-40"
                        >
                          {t("checkout")}
                        </button>
                        <button
                          type="button"
                          disabled={!folderPath || terminalBusy}
                          onClick={() => void createBranch()}
                          className="home-btn-secondary h-8 px-3 text-[11px] disabled:opacity-40"
                        >
                          {t("createBranch")}
                        </button>
                        <button
                          type="button"
                          disabled={!folderPath || terminalBusy}
                          onClick={() => void pullLocal()}
                          className="home-btn-secondary h-8 px-3 text-[11px] disabled:opacity-40"
                        >
                          {t("pull")}
                        </button>
                      </div>
                    </div>
                    <div className="desk-card space-y-2 p-3.5">
                      <p className="text-[13px] font-medium text-white">{t("commitPush")}</p>
                      <input
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        placeholder={t("commitMessagePlaceholder")}
                        className="desk-input"
                        disabled={!folderPath}
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={!folderPath || terminalBusy}
                          onClick={() => void commitLocal()}
                          className="home-btn-primary h-8 px-3 text-[11px] disabled:opacity-40"
                        >
                          {t("commit")}
                        </button>
                        <button
                          type="button"
                          disabled={!folderPath || terminalBusy}
                          onClick={() => void pushLocal()}
                          className="home-btn-secondary h-8 px-3 text-[11px] disabled:opacity-40"
                        >
                          {t("push")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {deskTab === "run" && folderPath ? (
                  <div className="desk-card space-y-3 p-3.5">
                    <div>
                      <p className="text-[13px] font-medium text-white">{t("runPresets")}</p>
                      <p className="mt-1 text-[12px] text-neutral-500">{t("runPresetsBody")}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {RUN_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={!folderPath || terminalBusy}
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

        {showTerminal ? (
          <section
            className={cn(
              "cowork-rise cowork-rise-delay-2 flex shrink-0 flex-col border-t border-white/[0.06] bg-[#040404]",
              focus === "terminal" ? "min-h-0 flex-1" : terminalTall ? "h-[40vh]" : "h-[152px]",
            )}
          >
            <header className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <SquareTerminal className="size-3.5 shrink-0 text-neutral-500" strokeWidth={1.7} />
                <p className="text-[11px] text-neutral-500">{t("terminal")}</p>
                <span className="truncate text-[11px] text-neutral-600">
                  {folderPath ? folderName(folderPath) : t("terminalHint")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {focus !== "terminal" ? (
                  <button
                    type="button"
                    onClick={() => setTerminalTall((value) => !value)}
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-white"
                  >
                    {terminalTall ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronUp className="size-3.5" />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setLines([{ id: crypto.randomUUID(), kind: "system", text: t("terminalReady") }])
                  }
                  className="text-[11px] text-neutral-500 hover:text-white"
                >
                  {t("clear")}
                </button>
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
            <form onSubmit={onTerminal} className="flex gap-2 border-t border-white/8 p-3">
              <span className="arrab-terminal flex h-9 items-center text-neutral-600">$</span>
              <input
                value={terminalInput}
                onChange={(event) => setTerminalInput(event.target.value)}
                placeholder={folderPath ? t("terminalInFolder") : t("terminalPlaceholder")}
                disabled={terminalBusy}
                className="arrab-terminal field flex-1 border-white/10"
              />
              <button
                type="submit"
                disabled={terminalBusy}
                className="h-9 rounded-md border border-white/15 px-3 text-xs text-white disabled:opacity-40"
              >
                {t("run")}
              </button>
            </form>
          </section>
        ) : null}
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
            className="absolute min-w-[168px] overflow-hidden rounded-2xl border border-white/10 bg-[#111] py-1 shadow-2xl"
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
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] text-red-300 hover:bg-white/[0.05]"
                  onClick={() => void deleteAgentFromTab(tabMenu.agentId!, tabMenu.key)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.7} />
                  {t("chatDeleteForever")}
                </button>
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
        <HardDrive
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
