import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Ellipsis,
  EyeOff,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Shield,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { QueuedQueryBar } from "@/domains/chat/ui/QueuedQueryBar";
import { ChatMarkdown } from "@/domains/chat/ui/ChatMarkdown";
import {
  ComposerPlusMenu,
  composerCreatePrompt,
  type ComposerCreateKind,
} from "@/domains/chat/ui/ComposerPlusMenu";
import {
  SessionModeApproveBar,
  SessionModeMenu,
} from "@/domains/chat/ui/SessionModeMenu";
import { filesToDraftParts } from "@/domains/chat/lib/composer-attachments";
import { listDir } from "@/core/platform/fs";
import { isTauriRuntime, pickFolder } from "@/core/platform/terminal";
import {
  detectSuggestedMode,
  readSessionMode,
  writeSessionMode,
  type SessionMode,
} from "@/domains/chat/model/session-mode";

import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { userAskedForComputer } from "@/domains/companions/model/professional";
import { companionDisplayName } from "@/domains/companions/catalog/catalog";
import { useRole } from "@/domains/account/roles/RoleProvider";
import { audienceFromPlanId } from "@/domains/account/roles/catalog";
import { useFamilyProfile } from "@/domains/family/use-family-profile";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { arrabApi, ApiRequestError } from "@/core/api/api";
import { openExternalUrl } from "@/core/platform/desktop";
import {
  companionComposerSuggestions,
  companionWelcomeSuggestions,
  detectConnectFamily,
  detectConnectProvider,
  type CompanionSuggestion,
  type ConnectFamily,
  type ConnectProviderOption,
} from "@/domains/companions/catalog/suggestions";
import {
  addFact,
  addCompanion,
  canAddCompanion,
  clearProfessionalCompanions,
  birthSuggestion,
  clearLiveNudges,
  captureWork,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  detectSensitive,
  dismissBirth,
  findCompanion,
  generalCompanion,
  getCompanionState,
  isSensitiveNow,
  liveCompanions,
  relativeTime,
  updateCompanion,
  addParentGuidanceFact,
  useCompanionState,
  claimParentCoachConversation,
  companionRoomForSeat,
  readCompanionChatTabs,
  writeCompanionChatTabs,
  type CompanionProfile,
} from "@/domains/companions/model/companions";
import {
  CompanionModal,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/domains/companions/ui/CompanionUI";
import {
  AvatarEditor,
  MemoryDetails,
  syncCompanionMemory,
  ToneDetails,
} from "@/domains/companions/ui/CompanionDetails";
import { CompanionCatalog } from "@/domains/companions/ui/CompanionCatalog";
import { ProfessionalRoster, ProfessionalScreen, professionalLabel, useProfessionalDesk } from "@/domains/companions/ui/ProfessionalWorkspace";
import { MuseQuietRail } from "@/domains/companions/ui/MuseQuietRail";
import {
  clearProfessionalGroups,
  findProfessionalGroup,
  touchProfessionalGroup,
  type ProfessionalGroup,
} from "@/domains/companions/model/groups";
import { FamilyCompanionWizard } from "@/domains/companions/ui/FamilyCompanionWizard";
import { AskParentCompanionSheet } from "@/domains/family/ui/AskParentCompanionSheet";
import { ensureCompanionCloudRoom } from "@/domains/companions/ui/hooks/useCompanionRoom";
import { CompanionConnectSheet } from "@/domains/companions/ui/CompanionConnectSheet";
import {
  CompanionChatRail,
  type ChatRailMenuAction,
} from "@/domains/companions/ui/CompanionChatRail";
import { IncognitoRoom } from "@/domains/encryption/ui/IncognitoRoom";
import { useCompanionRoom } from "@/domains/companions/ui/hooks/useCompanionRoom";
import { purposeLine } from "@/domains/companions/catalog/purpose-registry";
import { AgentSteps } from "@/domains/chat/ui/AgentSteps";
import { ThinkingBlock } from "@/domains/chat/ui/ThinkingBlock";
import { companionRoomKey } from "@/domains/companions/model/drafts";
import {
  createAssistantChatTab,
  resolveAssistantChatTabs,
  titleFromMessage,
  writeAssistantChatTabs,
} from "@/domains/chat/model/assistant-chat-tabs";
import { stashIncognitoImport } from "@/domains/encryption/incognito-import";
import {
  isIncognitoUnlocked,
  lockIncognitoVault,
  newIncognitoSessionId,
  saveIncognitoSession,
  type IncognitoSession,
} from "@/domains/encryption/incognito-vault";
import { OPEN_ADD_COMPANION_KEY, OPEN_ASSIGN_MEMBER_KEY } from "@/domains/account/getting-started";
import {
  filesFromDesignerReply,
  localDesignFromPrompt,
  mergeStudioProject,
  studioKindForCompanion,
  writeStudioActive,
} from "@/domains/studio/studio-catalog";
import { notifyStudio, pushToast } from "@/domains/notifications/notify";
import { cn } from "@/shared/lib/utils";
import { useEnsureRealisticPortraits } from "@/domains/companions/lib/ensure-portraits";
import { useCompanionPolicies, useManagedCompanions, useSendGate } from "@/domains/managed/client/hooks";
import { companionAvailability } from "@/domains/managed/client/companions";
import { setManagedPresence } from "@/domains/managed/client/store";
import { FOCUS_COMPANION_EVENT } from "@/domains/managed/ui/ManagedClientHost";
import { CompanionBadge, CompanionNotice } from "@/domains/managed/ui/MaintenanceBanner";
import { UsageMeter } from "@/domains/managed/ui/UsageMeter";
import { AudiencePulse, FaceStatusDot } from "@/shared/ui/AudiencePulse";
import {
  getDowntime,
  isWithinDowntime,
  useGuardianStore,
} from "@/domains/family/guardian-store";
export function CompanionsPage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href, isFamily } = useRole();
  const { signedIn, account, status } = useSignedInAccount();
  const familyPlan =
    signedIn &&
    audienceFromPlanId(account?.planId ?? status?.entitlements?.planId ?? null) === "family";
  const familyLive = Boolean(isFamily && familyPlan);
  const {
    snapshot: familySnapshot,
    active: familyActive,
    isChild: isFamilyChildSeat,
    isManager: isFamilyManagerSeat,
    refresh: refreshFamily,
  } = useFamilyProfile();
  const isFamilyChild = familyLive && isFamilyChildSeat;
  const isFamilyManager = familyLive && isFamilyManagerSeat;
  const guardianStore = useGuardianStore();

  useEffect(() => {
    if (familyLive) refreshFamily();
  }, [familyLive, refreshFamily]);
  const navigate = useNavigate();
  const state = useCompanionState();
  useEnsureRealisticPortraits();
  const [space, setSpace] = useCompanionSpace();
  const showProfessionalDesk = space === "work" && !isFamilyChild;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(() => {
    try {
      if (sessionStorage.getItem(OPEN_ADD_COMPANION_KEY) === "1") {
        sessionStorage.removeItem(OPEN_ADD_COMPANION_KEY);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const [catalogAssignMemberId] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(OPEN_ASSIGN_MEMBER_KEY);
      if (id) {
        sessionStorage.removeItem(OPEN_ASSIGN_MEMBER_KEY);
        return id;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [incognitoOpen, setIncognitoOpen] = useState(false);
  const [birthDomain, setBirthDomain] = useState("");
  const [details, setDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<"memory" | "tone">("memory");
  const [roomFullscreen, setRoomFullscreen] = useState(false);
  const [connectFamily, setConnectFamily] = useState<ConnectFamily | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [queuedQuery, setQueuedQuery] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(() => {
    try {
      return localStorage.getItem("arrab.companion.workspaceFolder");
    } catch {
      return null;
    }
  });
  const [folderTree, setFolderTree] = useState("");
  const [modeApprove, setModeApprove] = useState<{
    mode: SessionMode;
    pendingText: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titledTabRef = useRef<string | null>(null);
  const general = generalCompanion(state, space, familyLive ? familyActive?.id : null);
  const kidByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of familySnapshot?.members ?? []) {
      if (member.role === "child") map.set(String(member.id), member.displayName);
    }
    return map;
  }, [familySnapshot?.members]);
  const householdMemberIds = useMemo(
    () => new Set((familySnapshot?.members ?? []).map((m) => String(m.id))),
    [familySnapshot?.members],
  );
  const people = useMemo(() => {
    // Family seats: list household-stamped companions across personal/work so
    // kids always see companions a parent added on the Board.
    const pool =
      familyLive && familyActive
        ? liveCompanions(state).filter((person) => !person.archivedAt)
        : liveCompanions(state, space);
    return pool
      .filter((person) => person.domain !== "general")
      .filter((person) => {
        if (!familyLive || !familyActive) return person.space === space;
        if (isFamilyChild) {
          return person.familyMemberId === familyActive.id;
        }
        if (isFamilyManager && familySnapshot) {
          return Boolean(
            person.familyMemberId && householdMemberIds.has(String(person.familyMemberId)),
          );
        }
        return person.familyMemberId === familyActive.id;
      });
  }, [
    state,
    space,
    familyLive,
    familyActive,
    isFamilyChild,
    isFamilyManager,
    familySnapshot,
    householdMemberIds,
  ]);
  const selected = findCompanion(state, activeId);
  const selectedAllowed = Boolean(
    selected &&
      !selected.archivedAt &&
      (selected.domain === "general" ||
        !familyLive ||
        people.some((person) => person.id === selected.id)) &&
      (familyLive || selected.space === space),
  );
  const active = selectedAllowed && selected ? selected : general;
  useEffect(() => {
    clearLiveNudges();
  }, [space, active.id]);
  const coachingKidName =
    familyLive && isFamilyManager && active.familyMemberId
      ? kidByMemberId.get(String(active.familyMemberId)) ?? null
      : null;
  const parentCoachMode = Boolean(coachingKidName);
  const chatTabLane = parentCoachMode ? "parent" : "chat";
  const coachSeed = parentCoachMode
    ? active.parentConversationId ?? active.conversationId
    : active.conversationId;
  const defaultChatTitle = ar ? "محادثة" : "Chat";
  const [chatTabs, setChatTabs] = useState(() =>
    resolveAssistantChatTabs(
      active.id,
      coachSeed,
      defaultChatTitle,
      chatTabLane,
      readCompanionChatTabs(active.id, chatTabLane),
    ),
  );
  const [tabsCompanionId, setTabsCompanionId] = useState(active.id);
  const [tabsLane, setTabsLane] = useState(chatTabLane);
  useEffect(() => {
    if (tabsCompanionId === active.id && tabsLane === chatTabLane) return;
    // The first message creates the real General profile from its placeholder. Keep the
    // open chat tab — re-resolving would change the room key and abort that very send.
    if (
      tabsLane === chatTabLane &&
      active.domain === "general" &&
      tabsCompanionId.startsWith(`general-${active.space}`) &&
      !active.id.startsWith("general-")
    ) {
      setTabsCompanionId(active.id);
      return;
    }
    setTabsCompanionId(active.id);
    setTabsLane(chatTabLane);
    titledTabRef.current = null;
    setChatTabs(
      resolveAssistantChatTabs(
        active.id,
        coachSeed,
        defaultChatTitle,
        chatTabLane,
        readCompanionChatTabs(active.id, chatTabLane),
      ),
    );
  }, [active.id, chatTabLane, tabsCompanionId, tabsLane, coachSeed, defaultChatTitle]);
  const activeTab =
    chatTabs.tabs.find((tab) => tab.id === chatTabs.activeId) ?? chatTabs.tabs[0]!;
  const roomCompanion = useMemo(
    () =>
      companionRoomForSeat(active, {
        parentCoach: parentCoachMode,
        tabConversationId: activeTab.conversationId,
        claimSharedForChild: isFamilyChild,
      }),
    [active, parentCoachMode, activeTab.conversationId, isFamilyChild],
  );
  const room = useCompanionRoom(roomCompanion, activeTab.id);
  const { lines, draft, setDraft, mode, setMode, busy, loading, agentSteps, thinkingLabel } =
    room;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const studioKind = studioKindForCompanion(active, state);
  const nameOf = (person: CompanionProfile) => {
    const custom = professionalLabel(person.domain);
    if (custom) return custom;
    return person.domain === "general" ? t("compGeneral") : companionDisplayName(person, locale);
  };
  const birth = birthSuggestion(state);
  const sensitive = isSensitiveNow(state) || detectSensitive(draft);
  const composerSuggestions = companionComposerSuggestions(
    space === "work" ? { ...active, space: "work" } : active,
  );
  const welcomeSuggestions = companionWelcomeSuggestions(
    space === "work" ? { ...active, space: "work" } : active,
  );
  // Arrab Control decides which companions are listed and in what order.
  const listedPeople = useManagedCompanions(people);
  const companionPolicies = useCompanionPolicies();
  const sendGate = useSendGate(active);
  const facePeople =
    active.domain !== "general" &&
    !listedPeople.slice(0, 8).some((person) => person.id === active.id)
      ? [...listedPeople.slice(0, 7), active]
      : listedPeople.slice(0, 8);
  const matchingPeople = [general, ...listedPeople].filter((person) =>
    `${nameOf(person)} ${person.domain}`.toLowerCase().includes(search.toLowerCase()),
  );

  /** Rooms key drafts by chat tab; pin the destination's tab so the handed-off draft is found. */
  function handoffRoomKey(person: CompanionProfile): string {
    const tabs = resolveAssistantChatTabs(
      person.id,
      person.conversationId,
      defaultChatTitle,
      "chat",
      readCompanionChatTabs(person.id, "chat"),
    );
    writeCompanionChatTabs(person.id, tabs, "chat");
    const tab = tabs.tabs.find((item) => item.id === tabs.activeId) ?? tabs.tabs[0]!;
    return `${companionRoomKey(person)}:${tab.id}:chat`;
  }

  useEffect(() => {
    const person = findCompanion(getCompanionState(), sessionStorage.getItem(COMPANION_FOCUS_KEY));
    if (person) {
      setSpace(person.space);
      setActiveId(person.id);
    }
    sessionStorage.removeItem(COMPANION_FOCUS_KEY);
    const carried = sessionStorage.getItem(COMPANION_DRAFT_KEY);
    if (carried) {
      setDraft(
        (current) => (current.trim() ? `${current}\n\n${carried}` : carried),
        person ? handoffRoomKey(person) : undefined,
      );
    }
    sessionStorage.removeItem(COMPANION_DRAFT_KEY);
    // Consume the board handoff only on entry.
  }, []);

  useEffect(() => {
    setManagedPresence({ activeCompanionId: active.agentId ?? active.id });
  }, [active.agentId, active.id]);

  useEffect(() => () => setManagedPresence({ activeCompanionId: null }), []);

  useEffect(() => {
    const onFocusCompanion = (event: Event) => {
      const person = findCompanion(getCompanionState(), (event as CustomEvent<string>).detail);
      if (!person) return;
      sessionStorage.removeItem(COMPANION_FOCUS_KEY);
      setSpace(person.space);
      setActiveId(person.id);
    };
    window.addEventListener(FOCUS_COMPANION_EVENT, onFocusCompanion);
    return () => window.removeEventListener(FOCUS_COMPANION_EVENT, onFocusCompanion);
  }, [setSpace]);

  useEffect(() => {
    if (!roomFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoomFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomFullscreen]);

  const followReplyRef = useRef(true);
  useEffect(() => {
    if (followReplyRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "instant" });
    }
  }, [lines, busy]);
  useEffect(() => {
    const input = composerRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }
  }, [draft]);

  useEffect(() => {
    if (!isFamilyChild || !active.parentConversationId) return;
    const parentId = active.parentConversationId;
    setChatTabs((current) => {
      let changed = false;
      const tabs = current.tabs.map((tab) => {
        if (tab.conversationId !== parentId) return tab;
        changed = true;
        return { ...tab, conversationId: null };
      });
      return changed ? { ...current, tabs } : current;
    });
  }, [isFamilyChild, active.id, active.parentConversationId]);

  useEffect(() => {
    writeAssistantChatTabs(active.id, chatTabs, chatTabLane);
    if (chatTabs.tabs.some((tab) => tab.conversationId) || chatTabs.tabs.length > 1) {
      writeCompanionChatTabs(active.id, chatTabs, chatTabLane);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTabs, chatTabLane]);

  useEffect(() => {
    const accountTabs = readCompanionChatTabs(active.id, chatTabLane);
    if (!accountTabs?.tabs.some((tab) => tab.conversationId)) return;
    setChatTabs((current) =>
      current.tabs.some((tab) => tab.conversationId) ? current : accountTabs,
    );
  }, [state.assistantChatTabs, active.id, chatTabLane]);

  useEffect(() => {
    if (workspaceFolder) {
      localStorage.setItem("arrab.companion.workspaceFolder", workspaceFolder);
    } else {
      localStorage.removeItem("arrab.companion.workspaceFolder");
    }
  }, [workspaceFolder]);

  useEffect(() => {
    if (!workspaceFolder || !isTauriRuntime()) {
      setFolderTree("");
      return;
    }
    let cancelled = false;
    void listDir(workspaceFolder, "")
      .then((listed) => {
        if (cancelled) return;
        const names = listed.entries
          .slice(0, 40)
          .map((entry) => `${entry.kind === "dir" ? "dir" : "file"} ${entry.path}`)
          .join("\n");
        setFolderTree(names ? `PC folder: ${workspaceFolder}\n${names}` : `PC folder: ${workspaceFolder}`);
      })
      .catch(() => {
        if (!cancelled) setFolderTree(`PC folder: ${workspaceFolder}`);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceFolder]);

  useEffect(() => {
    if (parentCoachMode) {
      updateCompanion(active.id, { parentConversationId: activeTab.conversationId });
    } else {
      const parentId = active.parentConversationId;
      // Never write the parent coach thread back onto the child’s conversation pointer.
      if (parentId && activeTab.conversationId === parentId) return;
      updateCompanion(active.id, { conversationId: activeTab.conversationId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id, parentCoachMode]);

  useEffect(() => {
    const conversationId = parentCoachMode
      ? active.parentConversationId
      : active.conversationId;
    if (!conversationId) return;
    setChatTabs((current) => {
      const tab = current.tabs.find((item) => item.id === current.activeId);
      if (!tab || tab.conversationId === conversationId) return current;
      return {
        ...current,
        tabs: current.tabs.map((item) =>
          item.id === tab.id ? { ...item, conversationId } : item,
        ),
      };
    });
  }, [active.conversationId, active.parentConversationId, parentCoachMode]);

  useEffect(() => {
    const firstMine = lines.find((line) => line.who === "me");
    if (!firstMine || titledTabRef.current === activeTab.id) return;
    const nextTitle = titleFromMessage(firstMine.text, defaultChatTitle);
    if (activeTab.title === nextTitle || activeTab.title !== defaultChatTitle) {
      titledTabRef.current = activeTab.id;
      return;
    }
    titledTabRef.current = activeTab.id;
    setChatTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === activeTab.id ? { ...tab, title: nextTitle } : tab,
      ),
    }));
  }, [activeTab.id, activeTab.title, defaultChatTitle, lines]);

  function closeIncognito() {
    lockIncognitoVault();
    setIncognitoOpen(false);
  }

  function choose(person: CompanionProfile) {
    if (busy) return;
    followReplyRef.current = true;
    closeIncognito();
    if (person.space && person.space !== space) {
      setSpace(person.space);
    }
    setActiveGroupId(null);
    setActiveId(person.domain === "general" ? null : person.id);
    setAllOpen(false);
    setSearch("");
    setQueuedQuery(null);
    try {
      const raw = localStorage.getItem("arrab.slack.pendingMention");
      if (raw) {
        const pending = JSON.parse(raw) as { companionId?: string; text?: string; at?: number };
        if (
          pending.companionId === person.id &&
          pending.text &&
          typeof pending.at === "number" &&
          Date.now() - pending.at < 30 * 60_000
        ) {
          setDraft(
            ar
              ? `إشارة من Slack:\n${pending.text}`
              : `Slack mention:\n${pending.text}`,
          );
          localStorage.removeItem("arrab.slack.pendingMention");
        }
      }
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function openIncognito() {
    if (busy) return;
    setIncognitoOpen(true);
    setAllOpen(false);
    followReplyRef.current = true;
  }

  function selectChatTab(tabId: string) {
    if (busy) return;
    titledTabRef.current = null;
    followReplyRef.current = true;
    setChatTabs((current) =>
      current.activeId === tabId ? current : { ...current, activeId: tabId },
    );
  }

  function addChatTab() {
    if (busy) return;
    const tab = createAssistantChatTab(
      `${defaultChatTitle} ${chatTabs.tabs.length + 1}`,
      null,
    );
    titledTabRef.current = null;
    followReplyRef.current = true;
    setChatTabs((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeId: tab.id,
      tabsCollapsed: false,
    }));
  }

  function closeChatTab(tabId: string) {
    setChatTabs((current) => {
      if (current.tabs.length <= 1) {
        const fresh = createAssistantChatTab(defaultChatTitle, null);
        titledTabRef.current = null;
        return { ...current, tabs: [fresh], activeId: fresh.id };
      }
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      const activeId =
        current.activeId === tabId
          ? (tabs[Math.max(0, current.tabs.findIndex((tab) => tab.id === tabId) - 1)]?.id ??
            tabs[0]!.id)
          : current.activeId;
      if (activeId !== current.activeId) titledTabRef.current = null;
      return { ...current, tabs, activeId };
    });
  }

  function duplicateChatTab(tabId: string) {
    const source = chatTabs.tabs.find((tab) => tab.id === tabId);
    if (!source) return;
    const tab = createAssistantChatTab(
      `${source.title || defaultChatTitle} · ${ar ? "نسخة" : "copy"}`,
      null,
    );
    titledTabRef.current = null;
    followReplyRef.current = true;
    setChatTabs((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeId: tab.id,
    }));
  }

  function renameChatTab(tabId: string, title: string) {
    const next = title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!next) return;
    titledTabRef.current = tabId;
    setChatTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? { ...tab, title: next } : tab)),
    }));
  }

  async function sendChatToIncognito(tabId: string) {
    const tab = chatTabs.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const sourceLines =
      tab.id === activeTab.id
        ? lines
        : tab.conversationId
          ? await arrabApi
              .conversation(tab.conversationId)
              .then((conversation) =>
                conversation.messages
                  .filter((message) => message.role === "user" || message.role === "assistant")
                  .map((message) => ({
                    id: message.id,
                    who: (message.role === "user" ? "me" : "companion") as "me" | "companion",
                    text: message.content,
                    at: message.createdAt,
                  })),
              )
              .catch(() => [])
          : [];
    if (!sourceLines.length) {
      room.setNotice(ar ? "لا رسائل لإرسالها." : "Nothing to send yet.");
      return;
    }
    const payload = {
      title: tab.title || nameOf(active),
      messages: sourceLines.map((line) => ({
        id: line.id,
        role: (line.who === "me" ? "user" : "assistant") as "user" | "assistant",
        content: line.text,
        createdAt: line.at,
      })),
    };
    if (!isIncognitoUnlocked()) {
      stashIncognitoImport(payload);
      openIncognito();
      room.setNotice(
        ar ? "افتح الخفاء بكلمة المرور لإكمال النقل." : "Unlock Incognito to finish the transfer.",
      );
      return;
    }
    const now = new Date().toISOString();
    const session: IncognitoSession = {
      id: newIncognitoSessionId(),
      title: payload.title,
      agentId: null,
      apiConversationId: null,
      messages: payload.messages,
      createdAt: now,
      updatedAt: now,
    };
    await saveIncognitoSession(session);
    openIncognito();
    room.setNotice(ar ? "أُرسلت المحادثة إلى الخفاء." : "Chat sent to Incognito.");
  }

  function onChatRailAction(action: ChatRailMenuAction, tabId: string) {
    if (action === "open") {
      selectChatTab(tabId);
      return;
    }
    if (action === "new") {
      addChatTab();
      return;
    }
    if (action === "duplicate") {
      duplicateChatTab(tabId);
      return;
    }
    if (action === "delete") {
      closeChatTab(tabId);
      return;
    }
    if (action === "sendIncognito") {
      void sendChatToIncognito(tabId);
    }
  }
  const openStudioWorkspace = (kindId: string) => {
    writeStudioActive(kindId);
    navigate(href("/studio"));
  };

  const handoffToStudio = (
    kind: NonNullable<typeof studioKind>,
    companionId: string,
    reply: string | null | undefined,
    prompt: string,
  ) => {
    const harvested = reply ? filesFromDesignerReply(reply) : [];
    const files =
      harvested.length > 0
        ? mergeStudioProject(companionId, harvested)
        : /design|website|web|site|page|ui|layout|screen|mobile|phone|app|صم(?:م|ّ)|موقع|واجهة|شاشة|جوال/i.test(
              prompt,
            )
          ? mergeStudioProject(companionId, localDesignFromPrompt(prompt))
          : null;
    void notifyStudio({
      kind: "cowork",
      title: ar ? `فتح ${kind.nameAr}` : `Opening ${kind.name}`,
      body: ar
        ? files?.length
          ? "انتهى العمل — نفتح مساحة الاستوديو."
          : "ننقلك إلى صفحة الوكيل في الاستوديو."
        : files?.length
          ? "Work finished — opening their Studio workspace."
          : "Taking you to their Studio page.",
      href: "/studio",
    });
    openStudioWorkspace(kind.id);
  };

  const send = async (
    overrideText?: string,
    opts?: { skipModeCheck?: boolean; model?: string },
  ) => {
    const text = (overrideText ?? draft).trim();
    if (!text) return;
    // The current reply always finishes; a new send waits for maintenance, updates and limits.
    if (sendGate.blocked) return;
    if (modeApprove && !opts?.skipModeCheck) return;

    if (busy && !opts?.skipModeCheck) {
      setQueuedQuery(text);
      setDraft("");
      composerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (opts?.skipModeCheck && busyRef.current) {
      // Call turns wait for the in-flight reply instead of silently queuing.
      for (let i = 0; i < 80 && busyRef.current; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (busyRef.current) return;
    }

    if (!opts?.skipModeCheck) {
      const suggested = detectSuggestedMode(text, readSessionMode());
      if (suggested) {
        setModeApprove({ mode: suggested, pendingText: text });
        setDraft(text);
        return;
      }
    }

    const family = detectConnectFamily(text, active);
    if (family) {
      const provider = detectConnectProvider(text, family);
      followReplyRef.current = true;
      setDraft("");
      if (provider) {
        await startConnector(provider, family);
      } else {
        setConnectError(null);
        setConnectFamily(family);
        room.setNotice(
          ar
            ? family === "email"
              ? "اختر نوع البريد للربط."
              : "اختر مصدر البرمجة للربط."
            : family === "email"
              ? "Pick which email to connect."
              : "Pick which coding source to connect.",
        );
      }
      composerRef.current?.focus({ preventScroll: true });
      return;
    }

    if (showProfessionalDesk && signedIn) {
      const watchMatch = text.match(
        /(?:watch|track|راقب|تتبع)[^\n]*(https?:\/\/\S+)/i,
      );
      if (watchMatch?.[1]) {
        followReplyRef.current = true;
        setDraft("");
        try {
          await arrabApi.upsertMuseWatch({
            url: watchMatch[1],
            label: watchMatch[1].replace(/^https?:\/\//, "").slice(0, 60),
            kind: "change",
          });
          room.setNotice(ar ? "تمت إضافة المراقبة." : "Watch added.");
        } catch {
          room.setNotice(ar ? "تعذر حفظ المراقبة." : "Could not save that watch.");
        }
        composerRef.current?.focus({ preventScroll: true });
        return;
      }
      const csvBlock = text.match(
        /(?:csv|spending|إنفاق|transactions?)[\s\S]*?\n([\s\S]{20,})/i,
      );
      if (csvBlock?.[1] && /,/.test(csvBlock[1]) && csvBlock[1].split("\n").length >= 2) {
        followReplyRef.current = true;
        setDraft("");
        try {
          await arrabApi.importMuseFinance({ csv: csvBlock[1].trim() });
          room.setNotice(ar ? "تم تلخيص الإنفاق." : "Spending summarised.");
        } catch {
          room.setNotice(ar ? "تعذر استيراد CSV." : "Could not import that CSV.");
        }
        composerRef.current?.focus({ preventScroll: true });
        return;
      }
      const goalMatch = text.match(/^(?:goal|هدف)[:\s]+(.+)$/i);
      if (goalMatch?.[1]) {
        followReplyRef.current = true;
        setDraft("");
        try {
          await arrabApi.upsertMuseGoal({ title: goalMatch[1].trim() });
          room.setNotice(ar ? "تم حفظ الهدف." : "Goal saved.");
        } catch {
          room.setNotice(ar ? "تعذر حفظ الهدف." : "Could not save that goal.");
        }
        composerRef.current?.focus({ preventScroll: true });
        return;
      }
      const ideaMatch = text.match(/^(?:idea|فكرة)[:\s]+(.+)$/i);
      if (ideaMatch?.[1]) {
        followReplyRef.current = true;
        setDraft("");
        try {
          await arrabApi.upsertMuseIdea({
            title: ideaMatch[1].trim().slice(0, 160),
            source: "chat",
          });
          room.setNotice(ar ? "تم حفظ الفكرة." : "Idea saved.");
        } catch {
          room.setNotice(ar ? "تعذر حفظ الفكرة." : "Could not save that idea.");
        }
        composerRef.current?.focus({ preventScroll: true });
        return;
      }
    }

    followReplyRef.current = true;
    const prompt = text;
    const kind = studioKind;
    const companionId = active.id;
    const coachKid = coachingKidName;
    const coachAuthor = familyActive?.displayName ?? "Parent";
    const coachMemberId = active.familyMemberId;
    const folderHint = workspaceFolder
      ? {
          kind: "folder" as const,
          folderPath: workspaceFolder,
          treeSummary: folderTree || `PC folder: ${workspaceFolder}`,
        }
      : null;
    const wantsComputer =
      showProfessionalDesk && signedIn && userAskedForComputer(text);
    if (wantsComputer) powerComputerOn();
    const groupMembers =
      activeGroup?.memberIds
        .map((id) => findCompanion(getCompanionState(), id))
        .filter((person): person is CompanionProfile => Boolean(person)) ?? [];
    const groupDirective =
      showProfessionalDesk && activeGroup && groupMembers.length >= 2
        ? [
            `GROUP DESK CHAT "${activeGroup.title}".`,
            `Members present: ${groupMembers.map((person) => `${person.name} (${person.domain})`).join("; ")}.`,
            "Coordinate a useful reply for the user. When several members should speak, attribute short lines with their names.",
            "Do not invent actions outside this group. Drafts only until the user approves.",
          ].join(" ")
        : null;
    const desktopDirective =
      showProfessionalDesk && signedIn && (computerPowered || wantsComputer)
        ? "You have a sealed computer available on this desk. When they ask you to browse, open files, notes, terminal, or use the computer, add one hidden line: [[desktop: open chrome https://example.com]] or [[desktop: open finder]] or [[desktop: open notes]] or [[desktop: open terminal]] or [[desktop: ls]]. It runs on that sealed desktop and is removed from the chat. Never invent that you used the computer without that line. If the computer is off, still emit the line so it can wake."
        : showProfessionalDesk && signedIn
          ? "Their sealed computer is OFF unless they turn it on or clearly ask you to use Chrome, Finder, Terminal, Notes, or the computer. If they ask, emit [[desktop: …]] so it wakes. Do not pretend you used the computer otherwise."
          : null;
    const response = room.send(overrideText ? text : undefined, {
      model: opts?.model?.trim() || undefined,
      workspaceHint: {
        ...folderHint,
        ...((desktopDirective || groupDirective || coachKid) && !coachKid
          ? {
              operatorDirectives: [groupDirective, desktopDirective].filter(Boolean).join(" "),
            }
          : {}),
        ...(coachKid
          ? {
              operatorDirectives: [
                `PARENT COACHING SESSION: The speaker is a parent, not the child.`,
                `Child's name: ${coachKid}.`,
                `Listen, ask clarifying questions, and remember guidance about how ${coachKid} feels, what helps, and what to avoid.`,
                `When ${coachKid} chats later, apply this coaching gently — never quote parent notes verbatim to the child.`,
                `Speak as ${active.name}, the companion helping the parent support ${coachKid}.`,
              ]
                .filter(Boolean)
                .join(" "),
              sessionNotes: `Parent coaching about ${coachKid}. Capture feelings, habits, and what the companion should do.`,
            }
          : {}),
      },
    });
    if (showProfessionalDesk) {
      void arrabApi
        .setProfessionalCompanionStatus({
          companionId: active.domain || active.id,
          companionName: active.name,
          status: "working",
        })
        .catch(() => undefined);
    }
    composerRef.current?.focus({ preventScroll: true });
    const reply = await response;
    if (coachKid && coachMemberId && familyActive?.id) {
      addParentGuidanceFact({
        companionId,
        text: prompt,
        authorName: coachAuthor,
      });
      void arrabApi
        .addFamilyGuidance({
          companionId,
          childMemberId: coachMemberId,
          authorMemberId: familyActive.id,
          content: prompt,
        })
        .then(() => {
          pushToast({ title: t("familyChatCoachSaved"), tone: "success" });
        })
        .catch(() => undefined);
    }
    if (kind && reply) {
      handoffToStudio(kind, companionId, reply, prompt);
      return;
    }
  };

  async function sendQueuedNow() {
    const text = queuedQuery?.trim();
    if (!text) return;
    setQueuedQuery(null);
    room.stop();
    followReplyRef.current = true;
    const kind = studioKind;
    const companionId = active.id;
    const reply = await room.send(text, {
      workspaceHint: workspaceFolder
        ? {
            kind: "folder",
            folderPath: workspaceFolder,
            treeSummary: folderTree || `PC folder: ${workspaceFolder}`,
          }
        : undefined,
    });
    if (kind && reply) {
      handoffToStudio(kind, companionId, reply, text);
      return;
    }
    composerRef.current?.focus({ preventScroll: true });
  }

  async function startConnector(option: ConnectProviderOption, family: ConnectFamily) {
    setConnectBusy(true);
    setConnectError(null);
    try {
      if (option.oauth === "gmail") {
        const started = await arrabApi.startGmailOAuth();
        await openExternalUrl(started.url);
        room.setNotice(
          ar ? "افتحنا المتصفح لربط Gmail. ارجع هنا بعد التأكيد." : "Opened the browser to connect Gmail. Come back after you approve.",
        );
        void notifyStudio({
          kind: "connector",
          title: ar ? "ربط Gmail" : "Connect Gmail",
          body: ar ? "أكمل التوثيق في المتصفح" : "Finish authorizing in the browser",
          href: "/connectors",
        });
      } else if (option.oauth === "github") {
        const started = await arrabApi.startGithubOAuth();
        await openExternalUrl(started.url);
        room.setNotice(
          ar
            ? "افتحنا المتصفح لربط GitHub. ارجع هنا بعد التأكيد."
            : "Opened the browser to connect GitHub. Come back after you approve.",
        );
        void notifyStudio({
          kind: "connector",
          title: ar ? "ربط GitHub" : "Connect GitHub",
          body: ar ? "أكمل التوثيق في المتصفح" : "Finish authorizing in the browser",
          href: "/connectors",
        });
      } else if (option.oauth === "outlook") {
        const started = await arrabApi.startOutlookOAuth();
        await openExternalUrl(started.url);
        room.setNotice(
          ar
            ? "افتحنا المتصفح لربط Outlook. ارجع هنا بعد التأكيد."
            : "Opened the browser to connect Outlook. Come back after you approve.",
        );
        void notifyStudio({
          kind: "connector",
          title: ar ? "ربط Outlook" : "Connect Outlook",
          body: ar ? "أكمل التوثيق في المتصفح" : "Finish authorizing in the browser",
          href: "/connectors",
        });
      } else if (
        option.oauth === "gitlab" ||
        option.oauth === "bitbucket" ||
        option.oauth === "linear" ||
        option.oauth === "slack" ||
        option.oauth === "notion"
      ) {
        const started = await arrabApi.startGenericOAuth(option.oauth);
        await openExternalUrl(started.url);
        const label = option.labelEn;
        room.setNotice(
          ar
            ? `افتحنا المتصفح لربط ${option.labelAr}. ارجع هنا بعد التأكيد.`
            : `Opened the browser to connect ${label}. Come back after you approve.`,
        );
        void notifyStudio({
          kind: "connector",
          title: ar ? `ربط ${option.labelAr}` : `Connect ${label}`,
          body: ar ? "أكمل التوثيق في المتصفح" : "Finish authorizing in the browser",
          href: "/connectors",
        });
      } else if (option.connectorsProvider) {
        navigate(`${href("/connectors")}?provider=${encodeURIComponent(option.connectorsProvider)}`);
        room.setNotice(
          ar
            ? `افتحنا الموصلات لإكمال ربط ${option.labelAr}.`
            : `Opened Connectors to finish linking ${option.labelEn}.`,
        );
      }
      setConnectFamily(null);
    } catch (err: unknown) {
      setConnectError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      setConnectFamily(family);
    } finally {
      setConnectBusy(false);
    }
  }

  function applySuggestion(suggestion: CompanionSuggestion) {
    if (busy || connectBusy) return;
    if (suggestion.connect) {
      setConnectError(null);
      setConnectFamily(suggestion.connect);
      return;
    }
    if (suggestion.mode) {
      setMode(mode === suggestion.mode ? "open" : suggestion.mode);
      return;
    }
    const prompt = ar ? suggestion.promptAr : suggestion.promptEn;
    if (prompt) {
      setDraft(prompt);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  const { desk: proDesk, reload: reloadProDesk } = useProfessionalDesk(showProfessionalDesk);
  const [agentPanel, setAgentPanel] = useState(false);
  const [sandboxMaximized, setSandboxMaximized] = useState(false);
  const [computerPowered, setComputerPowered] = useState(() => {
    try {
      return localStorage.getItem("arrab.pro.computerStay") === "1";
    } catch {
      return false;
    }
  });
  const activeGroup = findProfessionalGroup(activeGroupId);

  // Professional desk starts empty — wipe leftover work companions once.
  useEffect(() => {
    if (!showProfessionalDesk) return;
    try {
      if (localStorage.getItem("arrab.pro.clearedRoster.v2") === "1") return;
      localStorage.setItem("arrab.pro.clearedRoster.v2", "1");
    } catch {
      return;
    }
    clearProfessionalCompanions();
    clearProfessionalGroups();
    setActiveGroupId(null);
    setActiveId(null);
    setAgentPanel(false);
    setSandboxMaximized(false);
  }, [showProfessionalDesk]);

  function powerComputerOn() {
    if (!signedIn) return;
    setComputerPowered(true);
    setAgentPanel(true);
    try {
      localStorage.setItem("arrab.pro.computerStay", "1");
    } catch {
      /* ignore */
    }
  }

  function powerComputerOff() {
    setComputerPowered(false);
    setSandboxMaximized(false);
    try {
      localStorage.removeItem("arrab.pro.computerStay");
    } catch {
      /* ignore */
    }
  }

  function openProfessionalCompanion(person: CompanionProfile) {
    setActiveGroupId(null);
    if (busy) return;
    followReplyRef.current = true;
    closeIncognito();
    if (person.space && person.space !== space) {
      setSpace(person.space);
    }
    setActiveId(person.domain === "general" ? null : person.id);
    setAllOpen(false);
    setSearch("");
    setQueuedQuery(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function openProfessionalGroup(group: ProfessionalGroup) {
    const host =
      group.memberIds.map((id) => findCompanion(getCompanionState(), id)).find(Boolean) ?? null;
    if (!host || busy) return;
    followReplyRef.current = true;
    closeIncognito();
    setActiveGroupId(group.id);
    touchProfessionalGroup(group.id);
    if (host.space && host.space !== space) {
      setSpace(host.space);
    }
    setActiveId(host.id);
    setAgentPanel(false);
    setAllOpen(false);
    setSearch("");
    setQueuedQuery(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  useEffect(() => {
    if (!showProfessionalDesk) {
      setAgentPanel(false);
      setComputerPowered(false);
      setSandboxMaximized(false);
      setActiveGroupId(null);
    }
  }, [showProfessionalDesk]);

  useEffect(() => {
    setComputerPowered(false);
    setSandboxMaximized(false);
  }, [active.id]);

  useEffect(() => {
    if (!activeGroupId) return;
    const group = findProfessionalGroup(activeGroupId);
    if (!group || !group.memberIds.includes(active.id)) {
      setActiveGroupId(null);
    }
  }, [activeGroupId, active.id]);

  // Companion [[desktop:]] lines wake the computer for signed-in users.
  useEffect(() => {
    if (!showProfessionalDesk || !signedIn) return;
    const onDrive = (event: Event) => {
      const detail = (event as CustomEvent<{ companionId?: string; profileId?: string }>).detail;
      const hit =
        detail?.companionId === active.domain ||
        detail?.companionId === active.id ||
        detail?.profileId === active.id;
      if (!hit) return;
      powerComputerOn();
    };
    window.addEventListener("arrab:companion-computer", onDrive);
    return () => window.removeEventListener("arrab:companion-computer", onDrive);
  }, [showProfessionalDesk, signedIn, active.id, active.domain]);

  const liveScreen =
    [...lines].reverse().find(
      (line) => line.who === "companion" && line.text.trim() && (!line.companionId || line.companionId === active.id),
    )?.text ?? null;

  return (
    <>
      {adding ? (
        isFamilyChild && familyActive ? (
          <AskParentCompanionSheet
            childMemberId={familyActive.id}
            childName={familyActive.displayName}
            space={space}
            onClose={() => {
              setAdding(false);
              setBirthDomain("");
            }}
          />
        ) : familyLive && isFamilyManager && (familySnapshot?.members?.length ?? 0) > 0 ? (
          <FamilyCompanionWizard
            space={space}
            members={familySnapshot!.members}
            defaultMemberId={
              catalogAssignMemberId ??
              familySnapshot?.members.find((m) => m.role === "child")?.id ??
              familyActive?.id ??
              null
            }
            onClose={() => {
              setAdding(false);
              setBirthDomain("");
            }}
            onCreated={(person) => {
              void ensureCompanionCloudRoom(person).catch(() => undefined);
              choose(person);
            }}
          />
        ) : (
          <CompanionCatalog
            space={space}
            signedIn={signedIn}
            initialDomain={birthDomain}
            onClose={() => {
              setAdding(false);
              setBirthDomain("");
            }}
            onCreated={choose}
          />
        )
      ) : (
    <div
      className={cn(
        "cp-ui cp-chat",
        showProfessionalDesk && "is-professional",
        showProfessionalDesk && agentPanel && "is-agent-panel",
        showProfessionalDesk && agentPanel && computerPowered && sandboxMaximized && "is-sandbox-maximized",
        roomFullscreen && !showProfessionalDesk && "chat-org-fullscreen cp-chat-fullscreen",
      )}
    >
      {!roomFullscreen || showProfessionalDesk ? (
      <header className="cp-chat-heading">
        <div>
          <p className="cp-eyebrow">
            {familyLive
              ? `ARRAB / ${t("familyChatEyebrow").toUpperCase()}`
              : "ARRAB / COMPANIONS"}
          </p>
          <h1>{t("chat")}</h1>
          {familyLive ? (
            <p className="fb-chat-lead">
              {isFamilyChild ? t("familyChatLeadKid") : t("familyChatLeadManager")}
            </p>
          ) : null}
          {familyLive && isFamilyManager && familySnapshot ? (
            <AudiencePulse
              items={[
                {
                  id: "companions",
                  label: t("pulseCompanions"),
                  value: people.length,
                  tone: "live",
                },
                {
                  id: "paused",
                  label: t("pulsePaused"),
                  value: familySnapshot.members.filter((m) => m.role === "child" && m.isPaused).length,
                  tone: familySnapshot.members.some((m) => m.role === "child" && m.isPaused)
                    ? "warn"
                    : "default",
                },
                {
                  id: "quiet",
                  label: t("pulseQuietNow"),
                  value: familySnapshot.members.filter(
                    (m) => m.role === "child" && isWithinDowntime(getDowntime(m.id)),
                  ).length,
                  tone: familySnapshot.members.some(
                    (m) => m.role === "child" && isWithinDowntime(getDowntime(m.id)),
                  )
                    ? "live"
                    : "default",
                },
                {
                  id: "approvals",
                  label: t("pulseApprovals"),
                  value: guardianStore.approvals.filter((a) => a.status === "pending").length,
                  tone: guardianStore.approvals.some((a) => a.status === "pending") ? "warn" : "ok",
                },
              ]}
            />
          ) : null}
        </div>
        <SpaceSwitch
          value={space}
          disabled={busy}
          onChange={(next) => {
            setSpace(next);
            setActiveId(null);
            closeIncognito();
            setAdding(false);
            setBirthDomain("");
            followReplyRef.current = true;
          }}
        />
      </header>
      ) : (
        <div className="cp-chat-fs-exit">
          <p className="cp-chat-fs-title">{nameOf(active)}</p>
          <button
            type="button"
            className="cp-button"
            onClick={() => setRoomFullscreen(false)}
          >
            <Minimize2 size={15} strokeWidth={1.7} />
            {t("chatExitFullscreen")}
          </button>
        </div>
      )}
      {showProfessionalDesk ? (
        <ProfessionalRoster
          activeId={activeGroupId ? null : active.id === general.id ? null : active.id}
          activeGroupId={activeGroupId}
          people={people}
          desk={proDesk}
          onOpenCompanion={openProfessionalCompanion}
          onOpenGroup={openProfessionalGroup}
          onCreateCompanion={() => {
            setActiveGroupId(null);
            setBirthDomain("");
            setAdding(true);
          }}
          onInspect={() => setAgentPanel(true)}
        />
      ) : !roomFullscreen ? (
      <div className="cp-face-bar">
        <div className="cp-face-list" aria-label={t("companions")}>
          {[general, ...facePeople].map((person) => (
            <button
              key={person.id}
              className="cp-face-choice"
              disabled={busy}
              aria-pressed={!incognitoOpen && active.id === person.id}
              onClick={() => choose(person)}
            >
              <span className="aud-face-wrap">
                <PersonAvatar person={person} active={!incognitoOpen && active.id === person.id} size="lg" />
                {(() => {
                  const seat = familySnapshot?.members.find((m) => m.id === person.familyMemberId);
                  if (!seat || seat.role !== "child") return null;
                  if (seat.isPaused) return <FaceStatusDot tone="warn" label={t("familyPaused")} />;
                  if (isWithinDowntime(getDowntime(seat.id))) {
                    return <FaceStatusDot tone="quiet" label={t("familyFaceQuiet")} />;
                  }
                  return null;
                })()}
              </span>
              <strong>
                {nameOf(person)}{" "}
                <CompanionBadge badge={companionAvailability(person, companionPolicies).badge} />
              </strong>
            </button>
          ))}
          {space === "personal" ? (
            <button
              className="cp-face-choice"
              disabled={busy}
              aria-pressed={incognitoOpen}
              onClick={openIncognito}
              aria-label={t("chatIncognitoMode")}
            >
              <span className={`cp-incognito-face cp-incognito-face-lg ${incognitoOpen ? "is-active" : ""}`}>
                <EyeOff size={22} strokeWidth={1.5} />
              </span>
              <strong>{t("chatIncognitoMode")}</strong>
              <small>
                {isIncognitoUnlocked()
                  ? t("chatIncognitoBadge")
                  : ar
                    ? "محمي بكلمة مرور"
                    : "Password protected"}
              </small>
            </button>
          ) : null}
          {!isFamilyChild ? (
          <button
            className="cp-face-choice"
            disabled={busy || !signedIn}
            onClick={() => {
              closeIncognito();
              setBirthDomain("");
              setAdding(true);
            }}
            aria-label={t("compAddCompanion")}
          >
            <span className="cp-add-face">
              <Plus size={21} strokeWidth={1.5} />
            </span>
            <strong>{familyLive && isFamilyManager ? t("familyCatalogAdd") : t("compAdd")}</strong>
            <small>
              {familyLive && isFamilyManager
                ? t("familyCatalogAddHint")
                : ar
                  ? "رفيق جديد"
                  : "A new companion"}
            </small>
          </button>
          ) : (
          <button
            className="cp-face-choice"
            disabled={busy || !signedIn}
            onClick={() => {
              closeIncognito();
              setBirthDomain("");
              setAdding(true);
            }}
            aria-label={t("guardianAskTitle")}
          >
            <span className="cp-add-face">
              <Plus size={21} strokeWidth={1.5} />
            </span>
            <strong>{t("guardianAskShort")}</strong>
            <small>{t("guardianAskFaceHint")}</small>
          </button>
          )}
        </div>
        <button className="cp-button cp-all" disabled={busy} onClick={() => { setSearch(""); setAllOpen(true); }}>
          <Ellipsis size={19} />
          {ar ? "كل الرفاق" : "All companions"}
        </button>
      </div>
      ) : null}
      {incognitoOpen && space === "personal" ? (
        <IncognitoRoom onExit={closeIncognito} />
      ) : (
      <section className="cp-room" aria-label={activeGroup?.title ?? nameOf(active)}>
        <header className="cp-room-header">
          <div className="cp-room-person">
            <span className="aud-face-wrap">
              <PersonAvatar person={active} size="sm" state={busy ? "speaking" : undefined} />
              {busy ? <em className="aud-face-dot is-ok" aria-hidden /> : null}
            </span>
            <div className="cp-room-person-copy">
              {showProfessionalDesk && activeGroup ? (
                <strong>{activeGroup.title}</strong>
              ) : showProfessionalDesk && active.domain !== "general" ? (
                <button
                  type="button"
                  className="pro-name-btn"
                  aria-expanded={agentPanel}
                  onClick={() => setAgentPanel((open) => !open)}
                >
                  <strong>{nameOf(active)}</strong>
                </button>
              ) : (
                <strong>{nameOf(active)}</strong>
              )}
              {showProfessionalDesk ? null : (
              <span className="cp-muted">
                {studioKind
                  ? ar
                    ? "وكيل استوديو — بعد الانتهاء نفتح صفحته"
                    : "Studio agent — opens their page when done"
                  : parentCoachMode
                    ? `${t("familyChatCoachEyebrow")} · ${coachingKidName}`
                    : active.domain === "general"
                      ? ar
                        ? "ابدأ من حيث أنت"
                        : "Start wherever you are"
                      : purposeLine(active.domain, ar)}
              </span>
              )}
            </div>
          </div>
          <div className="cp-room-actions">
            {studioKind ? (
              <button
                type="button"
                className="cp-button"
                disabled={busy}
                onClick={() => openStudioWorkspace(studioKind.id)}
              >
                {ar ? "فتح الاستوديو" : "Open Studio"}
                <ArrowUpRight size={15} />
              </button>
            ) : null}
            {showProfessionalDesk ? null : (
            <button
              className="cp-button"
              disabled={busy}
              onClick={() => {
                setDetailTab("memory");
                setDetails(true);
              }}
            >
              {ar ? "الذاكرة والأسلوب" : "Memory & tone"}
              <ArrowUpRight size={15} />
            </button>
            )}
            <button
              type="button"
              className="cp-button"
              onClick={() => setRoomFullscreen((open) => !open)}
              aria-label={roomFullscreen ? t("chatExitFullscreen") : t("chatEnterFullscreen")}
              title={roomFullscreen ? t("chatExitFullscreen") : t("chatEnterFullscreen")}
            >
              {roomFullscreen ? (
                <Minimize2 size={15} strokeWidth={1.7} />
              ) : (
                <Maximize2 size={15} strokeWidth={1.7} />
              )}
            </button>
          </div>
        </header>
        {(() => {
          const roomSeat =
            familySnapshot?.members.find((m) => m.id === active.familyMemberId) ?? familyActive;
          if (!familyLive || !roomSeat) return null;
          if (roomSeat.isPaused) {
            return (
              <p className="aud-notice is-warn">
                {t("familyChatPausedNotice").replace("{name}", roomSeat.displayName)}
              </p>
            );
          }
          if (roomSeat.role === "child" && isWithinDowntime(getDowntime(roomSeat.id))) {
            return <p className="aud-notice is-quiet">{t("familyChatQuietNotice")}</p>;
          }
          return null;
        })()}
        {studioKind && !busy ? (
          <p className="cp-studio-handoff">
            {ar
              ? "اطلب منه العمل — عند انتهاء الرد ننقلك تلقائياً إلى صفحته في الاستوديو."
              : "Tell them what to build — when they finish, we’ll take you to their Studio page."}
          </p>
        ) : null}
        <div className={cn("cp-room-body", showProfessionalDesk && agentPanel && "is-agent-chat")}>
          {showProfessionalDesk && agentPanel ? null : (
            <CompanionChatRail
              tabs={chatTabs.tabs}
              activeId={activeTab.id}
              companionHue={active.hue}
              companionName={nameOf(active)}
              ar={ar}
              disabled={busy}
              onSelect={selectChatTab}
              onNew={addChatTab}
              onAction={onChatRailAction}
              onRename={renameChatTab}
            />
          )}
          <div className="cp-room-main">
          <div
            ref={scrollRef}
            className="cp-messages"
            role="log"
            aria-label={ar ? "رسائل المحادثة" : "Conversation messages"}
            aria-busy={busy || loading}
            onScroll={(event) => {
              const element = event.currentTarget;
              followReplyRef.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
          >
          {loading ? <p className="cp-muted">{t("loading")}</p> : null}
          {!lines.length && !loading && !draft.trim() ? (
            <div className="cp-chat-welcome">
              <span
                className={cn("cp-welcome-icon", active.domain !== "general" && "is-face")}
                aria-hidden
              >
                {active.domain === "general" ? (
                  <Sparkles size={30} strokeWidth={1.25} />
                ) : (
                  <PersonAvatar person={active} size="lg" />
                )}
              </span>
              <p className="cp-eyebrow">
                {parentCoachMode
                  ? t("familyChatCoachEyebrow").toUpperCase()
                  : showProfessionalDesk
                    ? ar
                      ? "مكتبك"
                      : "PROFESSIONAL"
                    : ar
                      ? "مساحتك، على راحتك"
                      : "YOUR SPACE. YOUR PACE."}
              </p>
              <h2>
                {parentCoachMode
                  ? t("familyChatCoachPrompt")
                  : showProfessionalDesk
                    ? active.domain === "general"
                      ? ar
                        ? "وش تشتغل عليه؟"
                        : "What are you working on?"
                      : ar
                        ? `${active.name} جاهز.`
                        : `${active.name} is ready.`
                    : active.domain === "general"
                      ? ar
                        ? "وش في بالك اليوم؟"
                        : "What's on your mind?"
                      : ar
                        ? `أنا ${active.name}، أسمعك.`
                        : `I'm ${active.name}. I'm listening.`}
              </h2>
              <p className="cp-muted">
                {parentCoachMode
                  ? t("familyChatCoachBody")
                  : showProfessionalDesk
                    ? ar
                      ? "اطلب نتيجة. راقب الخطة. خذ المقود عند الحاجة."
                      : "Ask for an outcome. Watch the plan. Take the wheel when needed."
                    : ar
                      ? "ابدأ بفكرة، سؤال، أو حتى يوم طويل."
                      : "A thought, a question, or just a long day."}
              </p>
              <div className="cp-starters">
                {(parentCoachMode
                  ? [
                      {
                        id: "coach-feel",
                        labelEn: `${coachingKidName} felt anxious today`,
                        labelAr: `${coachingKidName} كان قلقاً اليوم`,
                        draftEn: `${coachingKidName} felt anxious today. Help gently — never shame them.`,
                        draftAr: `${coachingKidName} كان قلقاً اليوم. ساعده بلطف — دون توبيخ.`,
                      },
                      {
                        id: "coach-focus",
                        labelEn: `Help ${coachingKidName} focus`,
                        labelAr: `ساعد ${coachingKidName} على التركيز`,
                        draftEn: `Help ${coachingKidName} focus on homework with short steps and calm encouragement.`,
                        draftAr: `ساعد ${coachingKidName} على التركيز في الواجبات بخطوات قصيرة وتشجيع هادئ.`,
                      },
                    ]
                  : welcomeSuggestions
                ).map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => {
                      if ("draftEn" in suggestion) {
                        setDraft(ar ? suggestion.draftAr : suggestion.draftEn);
                        composerRef.current?.focus({ preventScroll: true });
                        return;
                      }
                      applySuggestion(suggestion);
                    }}
                  >
                    {ar ? suggestion.labelAr : suggestion.labelEn}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {lines.map((line, index) => {
            const speaker = findCompanion(state, line.companionId) ?? active;
            const isLastCompanion =
              line.who === "companion" &&
              index === lines.length - 1 &&
              agentSteps.length > 0;
            return (
              <Fragment key={line.id}>
                {isLastCompanion ? (
                  <div
                    className={cn("cp-agent-activity", busy && "is-streaming")}
                    role="status"
                    aria-live="polite"
                  >
                    <AgentSteps
                      steps={agentSteps}
                      thinkingLabel={thinkingLabel || `${t("thinking")}…`}
                    />
                  </div>
                ) : null}
              <article
                className={`cp-message ${line.who === "me" ? "cp-message-me" : ""}`}
              >
                {line.who === "companion" ? <PersonAvatar person={speaker} size="sm" /> : null}
                <div>
                  <div className="cp-message-top">
                    <p className="cp-message-author">
                      {line.who === "me" ? (ar ? "أنت" : "You") : nameOf(speaker)}
                      <time dateTime={line.at}>
                        {new Date(line.at).toLocaleTimeString(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </p>
                    {line.who === "companion" && room.thoughts[line.id] ? (
                      <ThinkingBlock trace={room.thoughts[line.id]!} className="cp-message-thought" />
                    ) : null}
                  </div>
                  <div className="cp-message-text">
                    {line.who === "companion" ? <ChatMarkdown content={line.text} /> : line.text}
                  </div>
                  {line.who === "companion" && !busy ? (
                    <div className="cp-message-actions">
                      <button
                        onClick={() => {
                          addFact({
                            companionId: speaker.id,
                            text: line.text.slice(0, 500),
                            source: ar
                              ? `حفظت من رد ${nameOf(speaker)}`
                              : `Saved from ${nameOf(speaker)}'s reply`,
                            kind: "inferred",
                            space,
                          });
                          void syncCompanionMemory().catch(() =>
                            room.setError(t("apiUnavailable")),
                          );
                          room.setNotice(ar ? "حُفظت في الذاكرة." : "Saved to memory.");
                        }}
                      >
                        {t("compRemember")}
                      </button>
                      <button
                        onClick={() => {
                          captureWork({
                            companionId: speaker.id,
                            text: line.text.slice(0, 160),
                            capturedFrom: nameOf(speaker),
                            space,
                          });
                          room.setNotice(
                            ar
                              ? "أُرسلت إلى مقترحات العمل للمراجعة."
                              : "Sent to Work suggestions for review.",
                          );
                        }}
                      >
                        {t("compCapture")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
              </Fragment>
            );
          })}
          {(busy || agentSteps.length > 0) && lines.at(-1)?.who !== "companion" ? (
            <div className="cp-agent-activity" role="status" aria-live="polite">
              <div className="cp-think-row">
                <PersonAvatar person={active} size="sm" state="speaking" />
                <div className="cp-think-beside">
                  <span className="cp-agent-activity-name">{nameOf(active)}</span>
                  {room.liveThought ? (
                    <ThinkingBlock trace={room.liveThought} />
                  ) : (
                    <AgentSteps
                      steps={
                        agentSteps.length > 0
                          ? agentSteps
                          : [{ id: "thinking", title: "thinking", status: "running" }]
                      }
                      thinkingLabel={thinkingLabel || `${t("thinking")}…`}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : null}
          </div>
          <div className="cp-composer-area">
          <MuseQuietRail enabled={showProfessionalDesk && signedIn} arabic={ar} />
          {!room.providerReady ? (
            <div className="cp-provider-setup" role="status">
              <span>
                {ar
                  ? "فعّل المحادثة للبدء باستقبال الردود."
                  : "Set up chat to start receiving replies."}
              </span>
              <Link to={href("/settings")}>{ar ? "تفعيل المحادثة" : "Set up chat"}</Link>
            </div>
          ) : null}
          {birth && signedIn && !draft.trim() && !busy && !sensitive ? (
            <div className="cp-birth">
              <span>{t("compBornTitle").replace("{topic}", birth.domain)}</span>
              <button
                className="cp-text-button"
                onClick={() => {
                  closeIncognito();
                  setBirthDomain(birth.domain);
                  setAdding(true);
                }}
              >
                {ar ? "تعرّف عليه" : "Meet them"}
              </button>
              <button
                className="cp-icon"
                onClick={() => dismissBirth(birth.domain)}
                aria-label={t("compDismiss")}
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
          {room.notice ? (
            <div className="cp-inline-notice" role="status">
              <Check size={14} />
              {room.notice}
            </div>
          ) : null}
          {room.lastGuardianDecision &&
          room.lastGuardianDecision.verdict !== "allow" &&
          !(
            isFamilyChild &&
            (room.lastGuardianDecision.verdict === "model_boundary" ||
              room.lastGuardianDecision.verdict === "coach_parent")
          ) ? (
            <div
              className={cn(
                "gh-boundary-chip",
                room.lastGuardianDecision.verdict === "pause_with_care" && "is-pause",
                room.lastGuardianDecision.verdict === "coach_parent" && "is-coach",
                room.lastGuardianDecision.verdict === "scaffold" && "is-scaffold",
              )}
              role="status"
            >
              <Shield size={14} strokeWidth={1.8} className="shrink-0" />
              <p className="gh-boundary-chip-line">
                <strong>
                  {room.lastGuardianDecision.verdict === "pause_with_care"
                    ? t("guardianChipPause")
                    : room.lastGuardianDecision.verdict === "model_boundary"
                      ? t("guardianChipBoundary")
                      : room.lastGuardianDecision.verdict === "scaffold"
                        ? t("guardianChipScaffold")
                        : t("guardianChipCoach")}
                </strong>
                <span className="gh-boundary-chip-sep" aria-hidden>
                  ·
                </span>
                <span className="gh-boundary-chip-reason">
                  {(() => {
                    const raw = ar
                      ? room.lastGuardianDecision.reasonAr
                      : room.lastGuardianDecision.reason;
                    return raw
                      .replace(/^Named family rule openly:\s*/i, "")
                      .replace(/^سمّيت قاعدة العائلة بوضوح:\s*/i, "")
                      .trim();
                  })()}
                </span>
              </p>
              <button
                type="button"
                className="cp-text-button shrink-0"
                onClick={() => room.clearGuardianDecision()}
              >
                {t("compDismiss")}
              </button>
            </div>
          ) : null}
          {room.error ? (
            <div className="cp-notice" role="alert">
              {room.error}
              {room.failedDraft ? (
                <button
                  className="cp-text-button"
                  onClick={() => {
                    setDraft(draft.trim() ? `${draft}\n\n${room.failedDraft}` : room.failedDraft);
                    room.setError(null);
                    composerRef.current?.focus();
                  }}
                >
                  {draft.trim()
                    ? ar
                      ? "إضافة الرسالة السابقة إلى المسودة"
                      : "Add previous message to draft"
                    : ar
                      ? "استرجاع الرسالة"
                      : "Restore message"}
                </button>
              ) : null}
            </div>
          ) : null}
          <CompanionNotice availability={sendGate.availability} />
          <div className="cp-composer-toolbar">
            <div className="cp-actions">
              {composerSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className={cn(
                    "cp-mode",
                    suggestion.connect ? "is-connect" : undefined,
                  )}
                  disabled={busy || connectBusy}
                  aria-pressed={
                    suggestion.mode ? mode === suggestion.mode : suggestion.connect === connectFamily
                  }
                  onClick={() => applySuggestion(suggestion)}
                >
                  {ar ? suggestion.labelAr : suggestion.labelEn}
                </button>
              ))}
            </div>
            <span className="cp-sender-label">
              {ar ? `${nameOf(active)} سيردّ عليك` : `${nameOf(active)} will answer`}
            </span>
          </div>
          {queuedQuery !== null ? (
            <QueuedQueryBar
              className="mb-2"
              value={queuedQuery}
              onChange={setQueuedQuery}
              onDiscard={() => setQueuedQuery(null)}
              onSendNow={() => void sendQueuedNow()}
            />
          ) : null}
          {modeApprove ? (
            <SessionModeApproveBar
              suggested={modeApprove.mode}
              pendingSend
              onApprove={() => {
                const pending = modeApprove.pendingText;
                writeSessionMode(modeApprove.mode);
                setModeApprove(null);
                void send(pending, { skipModeCheck: true });
              }}
              onDismiss={() => {
                const pending = modeApprove.pendingText;
                setModeApprove(null);
                void send(pending, { skipModeCheck: true });
              }}
            />
          ) : room.suggestedSessionMode ? (
            <SessionModeApproveBar
              suggested={room.suggestedSessionMode}
              onApprove={() => {
                writeSessionMode(room.suggestedSessionMode!);
                room.clearSuggestedSessionMode();
              }}
              onDismiss={() => room.clearSuggestedSessionMode()}
            />
          ) : null}
          <UsageMeter status={sendGate.limits} />
          {workspaceFolder ? (
            <div className="cp-folder-chip">
              <span title={workspaceFolder}>
                {ar ? "المجلد" : "Folder"} · {workspaceFolder.split(/[/\\]/).pop()}
              </span>
              <button type="button" onClick={() => setWorkspaceFolder(null)} aria-label={ar ? "إزالة المجلد" : "Remove folder"}>
                <X size={12} />
              </button>
            </div>
          ) : null}
          <div className="cp-composer">
            <ComposerPlusMenu
              open={plusOpen}
              onOpenChange={setPlusOpen}
              onUploadImages={() => {
                if (!sendGate.uploadsBlocked) imageInputRef.current?.click();
              }}
              onUploadFiles={() => {
                if (!sendGate.uploadsBlocked) fileInputRef.current?.click();
              }}
              onWebSearch={() =>
                setDraft((current) =>
                  current.trim().startsWith("/web")
                    ? current
                    : `/web ${current.trim()}`.trim() + " ",
                )
              }
              onConnectFolder={() => {
                if (!isTauriRuntime()) return;
                void pickFolder().then((path) => {
                  if (path) setWorkspaceFolder(path);
                });
              }}
              features={{ folder: true, create: true }}
              onCreate={(kind: ComposerCreateKind) => {
                const prompt = composerCreatePrompt(kind, ar ? "ar" : "en");
                setDraft((current) => {
                  const trimmed = current.trim();
                  if (!trimmed) return prompt;
                  if (trimmed.endsWith(prompt.trim()) || trimmed.includes(prompt.trim())) {
                    return trimmed;
                  }
                  return `${prompt}${trimmed}`;
                });
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
            />
            <SessionModeMenu disabled={busy || loading} />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
              multiple
              hidden
              onChange={(event) => {
                void filesToDraftParts(event.target.files).then((parts) => {
                  if (!parts.length) return;
                  setDraft((current) =>
                    current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n"),
                  );
                });
                event.target.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv,.json,.html,.svg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*,image/*"
              multiple
              hidden
              onChange={(event) => {
                void filesToDraftParts(event.target.files).then((parts) => {
                  if (!parts.length) return;
                  setDraft((current) =>
                    current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n"),
                  );
                });
                event.target.value = "";
              }}
            />
            <textarea
              ref={composerRef}
              rows={1}
              value={draft}
              disabled={loading}
              aria-label={ar ? "رسالتك" : "Your message"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                busy
                  ? ar
                    ? "اكتب رسالتك التالية…"
                    : "Write your next message…"
                  : parentCoachMode
                    ? ar
                      ? `أخبر ${active.name} عن ${coachingKidName}…`
                      : `Tell ${active.name} about ${coachingKidName}…`
                    : showProfessionalDesk
                      ? ar
                        ? "اطلب نتيجة…"
                        : "Ask for an outcome…"
                      : ar
                        ? "اكتب اللي في بالك…"
                        : "Say what's on your mind…"
              }
            />
            {busy && !draft.trim() ? (
              <button
                className="cp-button cp-stop"
                onClick={() => room.stop()}
                aria-label={t("chatPause")}
              >
                <Square size={14} fill="currentColor" />
                {t("chatPause")}
              </button>
            ) : (
              <button
                className="cp-send"
                onClick={() => void send()}
                disabled={!draft.trim() || loading || Boolean(modeApprove) || sendGate.blocked}
                aria-label={busy ? t("chatQueuedLabel") : t("compSend")}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
          <div className="cp-composer-foot">
            <span>
              {busy
                ? ar
                  ? "يمكنك الكتابة الآن والإرسال بعد الرد أو إيقافه."
                  : "Write now. Send when the reply ends or you stop it."
                : mode === "vent"
                  ? t("compVentReply")
                  : ar
                    ? "Enter للإرسال · Shift + Enter لسطر جديد"
                    : "Enter to send · Shift + Enter for a new line"}
            </span>
            <span>
              {lines.length === 1
                ? t("chatMessageCountOne")
                : lines.length > 1
                  ? t("chatMessageCount").replace("{n}", String(lines.length))
                  : draft.trim()
                    ? ar
                      ? "المسودة محفوظة في هذه الجلسة"
                      : "Draft saved in this session"
                    : ar
                      ? "على راحتك."
                      : "At your pace."}
            </span>
          </div>
        </div>
        </div>
        </div>
      </section>
      )}
      {showProfessionalDesk && agentPanel && !activeGroup && active.domain !== "general" ? (
        <ProfessionalScreen
          person={active}
          desk={proDesk}
          liveText={liveScreen}
          speaking={busy}
          onChanged={() => void reloadProDesk()}
          onClose={() => {
            setSandboxMaximized(false);
            setAgentPanel(false);
          }}
          sandboxMaximized={sandboxMaximized}
          onToggleSandboxMaximize={() => setSandboxMaximized((open) => !open)}
          computerPowered={computerPowered}
          signedIn={signedIn}
          onPowerComputer={powerComputerOn}
          onPowerOffComputer={powerComputerOff}
          onQuickAction={(prompt, needsComputer) => {
            if (needsComputer) powerComputerOn();
            setDraft(prompt);
            setAgentPanel(true);
            requestAnimationFrame(() => composerRef.current?.focus());
          }}
        />
      ) : null}

      <CompanionModal
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={ar ? "اختر من يردّ عليك" : "Choose who answers"}
      >
        <label className="cp-search">
          <Search size={17} />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={ar ? "ابحث بالاسم أو الاهتمام" : "Search by name or interest"}
            aria-label={ar ? "بحث الرفاق" : "Search companions"}
          />
        </label>
        <div className="cp-people-picker">
          {matchingPeople.map((person) => (
            <button
              key={person.id}
              onClick={() => choose(person)}
            >
              <PersonAvatar person={person} size="md" />
              <span>
                <strong>
                  {nameOf(person)}{" "}
                  <CompanionBadge badge={companionAvailability(person, companionPolicies).badge} />
                </strong>
                <small>
                  {person.lastLine ||
                    person.lastMemory ||
                    (person.domain === "general"
                      ? ar
                        ? "بداية لكل موضوع"
                        : "A starting point for anything"
                      : purposeLine(person.domain, ar))}
                </small>
              </span>
              <time>{relativeTime(person.lastAt, locale)}</time>
            </button>
          ))}
        </div>
        {!matchingPeople.length ? (
          <p className="cp-muted">{ar ? "لا توجد نتائج." : "No companions found."}</p>
        ) : null}
        <button
          className="cp-button cp-primary"
          onClick={() => {
            setAllOpen(false);
            setBirthDomain("");
            closeIncognito();
            setAdding(true);
          }}
          disabled={!signedIn}
        >
          <Plus size={15} />
          {isFamilyChild
            ? t("guardianAskTitle")
            : familyLive && isFamilyManager
              ? t("familyCatalogTitle")
              : t("compAddCompanion")}
        </button>
      </CompanionModal>
      <CompanionModal open={details} onClose={() => setDetails(false)} title={nameOf(active)} wide>
        {active.domain !== "general" ? <AvatarEditor person={active} /> : null}
        <div className="cp-section-tabs">
          <button aria-pressed={detailTab === "memory"} onClick={() => setDetailTab("memory")}>
            {t("compKnows")}
          </button>
          <button
            aria-pressed={detailTab === "tone"}
            onClick={() => setDetailTab("tone")}
          >
            {t("compTone")}
          </button>
        </div>
        {detailTab === "memory" ? (
          <MemoryDetails person={active} space={space} />
        ) : (
          <ToneDetails
            person={active}
            onFold={() => {
              setDetails(false);
              setActiveId(null);
            }}
          />
        )}
      </CompanionModal>
    </div>
      )}
      {connectFamily ? (
        <CompanionConnectSheet
          family={connectFamily}
          arabic={ar}
          busy={connectBusy}
          error={connectError}
          onClose={() => {
            setConnectFamily(null);
            setConnectError(null);
          }}
          onPick={(option) => void startConnector(option, connectFamily)}
        />
      ) : null}
    </>
  );
}
