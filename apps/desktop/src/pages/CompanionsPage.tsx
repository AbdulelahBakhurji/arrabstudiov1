import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Ellipsis,
  EyeOff,
  Plus,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { QueuedQueryBar } from "@/components/QueuedQueryBar";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ComposerPlusMenu } from "@/components/ComposerPlusMenu";
import {
  SessionModeApproveBar,
  SessionModeMenu,
} from "@/components/SessionModeMenu";
import { filesToDraftParts } from "@/lib/composer-attachments";
import {
  detectSuggestedMode,
  readSessionMode,
  writeSessionMode,
  type SessionMode,
} from "@/lib/session-mode";

import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { openExternalUrl } from "@/lib/desktop";
import {
  companionComposerSuggestions,
  companionWelcomeSuggestions,
  detectConnectFamily,
  detectConnectProvider,
  type CompanionSuggestion,
  type ConnectFamily,
  type ConnectProviderOption,
} from "@/lib/companion-suggestions";
import {
  addFact,
  answerNudge,
  birthSuggestion,
  captureWork,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  detectSensitive,
  dismissBirth,
  findCompanion,
  generalCompanion,
  getCompanionState,
  ignoreNudge,
  isSensitiveNow,
  liveCompanions,
  liveNudges,
  relativeTime,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
} from "@/lib/companions";
import {
  CompanionModal,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/components/companions/CompanionUI";
import {
  AvatarEditor,
  MemoryDetails,
  syncCompanionMemory,
  ToneDetails,
} from "@/components/companions/CompanionDetails";
import { CompanionCatalog } from "@/components/companions/CompanionCatalog";
import { CompanionConnectSheet } from "@/components/companions/CompanionConnectSheet";
import {
  CompanionChatRail,
  type ChatRailMenuAction,
} from "@/components/companions/CompanionChatRail";
import { IncognitoRoom } from "@/components/companions/IncognitoRoom";
import { useCompanionRoom } from "@/components/companions/useCompanionRoom";
import { companionRoomKey } from "@/lib/companion-drafts";
import {
  createAssistantChatTab,
  readAssistantChatTabs,
  titleFromMessage,
  writeAssistantChatTabs,
} from "@/lib/assistant-chat-tabs";
import { stashIncognitoImport } from "@/lib/incognito-import";
import {
  isIncognitoUnlocked,
  lockIncognitoVault,
  newIncognitoSessionId,
  saveIncognitoSession,
  type IncognitoSession,
} from "@/lib/incognito-vault";
import { OPEN_ADD_COMPANION_KEY } from "@/lib/getting-started";
import {
  filesFromDesignerReply,
  localDesignFromPrompt,
  mergeStudioProject,
  studioKindForCompanion,
  writeStudioActive,
} from "@/lib/studio-catalog";
import { notifyStudio } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { useEnsureRealisticPortraits } from "@/lib/ensure-companion-portraits";
export function CompanionsPage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href, isFamily } = useRole();
  const { active: familyActive, isChild: isFamilyChild } = useFamilyProfile();
  const navigate = useNavigate();
  const { signedIn } = useSignedInAccount();
  const state = useCompanionState();
  useEnsureRealisticPortraits();
  const [space, setSpace] = useCompanionSpace();
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
  const [incognitoOpen, setIncognitoOpen] = useState(false);
  const [birthDomain, setBirthDomain] = useState("");
  const [details, setDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<"memory" | "tone">("memory");
  const [connectFamily, setConnectFamily] = useState<ConnectFamily | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [queuedQuery, setQueuedQuery] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeApprove, setModeApprove] = useState<{
    mode: SessionMode;
    pendingText: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titledTabRef = useRef<string | null>(null);
  const general = generalCompanion(state, space);
  const people = liveCompanions(state, space)
    .filter((person) => person.domain !== "general")
    .filter((person) => {
      if (!isFamily || !isFamilyChild || !familyActive) return true;
      return !person.familyMemberId || person.familyMemberId === familyActive.id;
    });
  const selected = findCompanion(state, activeId);
  const active = selected && selected.space === space && !selected.archivedAt ? selected : general;
  const defaultChatTitle = ar ? "محادثة" : "Chat";
  const [chatTabs, setChatTabs] = useState(() =>
    readAssistantChatTabs(active.id, active.conversationId, defaultChatTitle),
  );
  const [tabsCompanionId, setTabsCompanionId] = useState(active.id);
  if (tabsCompanionId !== active.id) {
    setTabsCompanionId(active.id);
    titledTabRef.current = null;
    setChatTabs(readAssistantChatTabs(active.id, active.conversationId, defaultChatTitle));
  }
  const activeTab =
    chatTabs.tabs.find((tab) => tab.id === chatTabs.activeId) ?? chatTabs.tabs[0]!;
  const roomCompanion = useMemo(
    () => ({ ...active, conversationId: activeTab.conversationId }),
    [active, activeTab.conversationId],
  );
  const room = useCompanionRoom(roomCompanion, activeTab.id);
  const { lines, draft, setDraft, mode, setMode, busy, loading } = room;
  const studioKind = studioKindForCompanion(active, state);
  const nameOf = (person: CompanionProfile) =>
    person.domain === "general" ? t("compGeneral") : person.name;
  const birth = birthSuggestion(state);
  const nudge = liveNudges(state, space).find((item) => item.companionId === active.id);
  const sensitive = isSensitiveNow(state) || detectSensitive(draft);
  const composerSuggestions = companionComposerSuggestions(active);
  const welcomeSuggestions = companionWelcomeSuggestions(active);
  const facePeople =
    active.domain !== "general" && !people.slice(0, 4).some((person) => person.id === active.id)
      ? [...people.slice(0, 3), active]
      : people.slice(0, 4);
  const matchingPeople = [general, ...people].filter((person) =>
    `${nameOf(person)} ${person.domain}`.toLowerCase().includes(search.toLowerCase()),
  );

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
        companionRoomKey(person ?? active),
      );
    }
    sessionStorage.removeItem(COMPANION_DRAFT_KEY);
    // Consume the board handoff only on entry.
  }, []);
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
    writeAssistantChatTabs(active.id, chatTabs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTabs]);

  useEffect(() => {
    updateCompanion(active.id, { conversationId: activeTab.conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id]);

  useEffect(() => {
    const conversationId = active.conversationId;
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
  }, [active.conversationId]);

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
    setActiveId(person.domain === "general" ? null : person.id);
    setAllOpen(false);
    setSearch("");
    setQueuedQuery(null);
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
        : /design|website|web|site|page|ui|layout|screen|mobile|phone|app|صم[مّ]|موقع|واجهة|شاشة|جوال/i.test(
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

  const send = async (overrideText?: string, opts?: { skipModeCheck?: boolean }) => {
    const text = (overrideText ?? draft).trim();
    if (!text) return;
    if (modeApprove && !opts?.skipModeCheck) return;

    if (busy) {
      setQueuedQuery(text);
      setDraft("");
      composerRef.current?.focus({ preventScroll: true });
      return;
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

    followReplyRef.current = true;
    const prompt = text;
    const kind = studioKind;
    const companionId = active.id;
    const response = room.send(overrideText ? text : undefined);
    composerRef.current?.focus({ preventScroll: true });
    const reply = await response;
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
    const reply = await room.send(text);
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

  return (
    <>
      {adding ? (
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
      ) : (
    <div className="cp-ui cp-chat">
      <header className="cp-chat-heading">
        <div>
          <p className="cp-eyebrow">ARRAB / COMPANIONS</p>
          <h1>{t("chat")}</h1>
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
              <PersonAvatar person={person} active={!incognitoOpen && active.id === person.id} size="lg" />
              <strong>{nameOf(person)}</strong>
              <small>
                {person.lastMemory ||
                  (person.domain === "general"
                    ? ar
                      ? "مساحة لكل شيء"
                      : "A little of everything"
                    : person.domain)}
              </small>
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
            <strong>{t("compAdd")}</strong>
            <small>{ar ? "رفيق جديد" : "A new companion"}</small>
          </button>
        </div>
        <button className="cp-button cp-all" disabled={busy} onClick={() => setAllOpen(true)}>
          <Ellipsis size={19} />
          {ar ? "كل الرفاق" : "All companions"}
        </button>
      </div>
      {incognitoOpen && space === "personal" ? (
        <IncognitoRoom onExit={closeIncognito} />
      ) : (
      <section className="cp-room" aria-label={nameOf(active)}>
        <header className="cp-room-header">
          <div className="cp-room-person">
            <PersonAvatar person={active} size="sm" />
            <strong>{nameOf(active)}</strong>
            <span className="cp-muted">
              {studioKind
                ? ar
                  ? "وكيل استوديو — بعد الانتهاء نفتح صفحته"
                  : "Studio agent — opens their page when done"
                : active.domain === "general"
                  ? ar
                    ? "ابدأ من حيث أنت"
                    : "Start wherever you are"
                  : active.domain}
            </span>
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
          </div>
        </header>
        {studioKind && !busy ? (
          <p className="cp-studio-handoff">
            {ar
              ? "اطلب منه العمل — عند انتهاء الرد ننقلك تلقائياً إلى صفحته في الاستوديو."
              : "Tell them what to build — when they finish, we’ll take you to their Studio page."}
          </p>
        ) : null}
        {active.resume && !loading ? (
          <details className="cp-recall">
            <summary>
              {t("compResume")}
              <span>{relativeTime(active.lastAt, locale)}</span>
            </summary>
            <p>{active.resume}</p>
          </details>
        ) : null}
        <div className="cp-room-body">
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
              <span className="cp-welcome-icon">
                <Sparkles size={30} strokeWidth={1.25} />
              </span>
              <p className="cp-eyebrow">{ar ? "مساحتك، على راحتك" : "YOUR SPACE. YOUR PACE."}</p>
              <h2>
                {active.domain === "general"
                  ? ar
                    ? "وش في بالك اليوم؟"
                    : "What's on your mind?"
                  : ar
                    ? `أنا ${active.name}، أسمعك.`
                    : `I'm ${active.name}. I'm listening.`}
              </h2>
              <p className="cp-muted">
                {ar
                  ? "ابدأ بفكرة، سؤال، أو حتى يوم طويل."
                  : "A thought, a question, or just a long day."}
              </p>
              <div className="cp-starters">
                {welcomeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {ar ? suggestion.labelAr : suggestion.labelEn}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {lines.map((line) => {
            const speaker = findCompanion(state, line.companionId) ?? active;
            return (
              <article
                key={line.id}
                className={`cp-message ${line.who === "me" ? "cp-message-me" : ""}`}
              >
                {line.who === "companion" ? <PersonAvatar person={speaker} size="sm" /> : null}
                <div>
                  <p className="cp-message-author">
                    {line.who === "me" ? (ar ? "أنت" : "You") : nameOf(speaker)}
                    <time dateTime={line.at}>
                      {new Date(line.at).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </p>
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
            );
          })}
          {busy && !(lines.at(-1)?.who === "companion" && lines.at(-1)?.text.trim()) ? (
            <p className="cp-typing" role="status">
              <PersonAvatar person={active} size="sm" state="speaking" />
              <span />
              <span />
              <span />
              {ar ? `${nameOf(active)} يردّ…` : `${nameOf(active)} is replying…`}
            </p>
          ) : null}
          </div>
          <div className="cp-composer-area">
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
          {nudge && !draft.trim() && !busy && !sensitive ? (
            <div className={`cp-nudge cp-nudge-${nudge.level}`}>
              <div className="cp-meta">
                {nameOf(active)} · {nudge.source}
              </div>
              <p>{nudge.text}</p>
              <div className="cp-actions">
                {nudge.answers?.map((answer) => (
                  <button
                    key={answer}
                    className="cp-button"
                    onClick={() => {
                      answerNudge(nudge.id);
                      setDraft(answer);
                      composerRef.current?.focus();
                    }}
                  >
                    {answer}
                  </button>
                ))}
                <button className="cp-text-button" onClick={() => ignoreNudge(nudge.id)}>
                  {t("compDismiss")}
                </button>
              </div>
            </div>
          ) : null}
          {room.notice ? (
            <div className="cp-inline-notice" role="status">
              <Check size={14} />
              {room.notice}
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
          <div className="cp-composer">
            <ComposerPlusMenu
              open={plusOpen}
              onOpenChange={setPlusOpen}
              onUploadImages={() => imageInputRef.current?.click()}
              onUploadFiles={() => fileInputRef.current?.click()}
              onWebSearch={() =>
                setDraft((current) =>
                  current.trim().startsWith("/web")
                    ? current
                    : `/web ${current.trim()}`.trim() + " ",
                )
              }
              features={{ folder: false }}
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
            <button
              className="cp-composer-person"
              disabled={busy}
              onClick={() => setAllOpen(true)}
              aria-label={t("compTapToChange")}
            >
              <PersonAvatar person={active} size="sm" />
              <ChevronDown size={12} />
            </button>
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
                disabled={!draft.trim() || loading || Boolean(modeApprove)}
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
              {draft.trim()
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
              aria-pressed={active.id === person.id}
            >
              <PersonAvatar person={person} size="md" />
              <span>
                <strong>{nameOf(person)}</strong>
                <small>
                  {person.lastLine ||
                    person.lastMemory ||
                    (person.domain === "general"
                      ? ar
                        ? "بداية لكل موضوع"
                        : "A starting point for anything"
                      : person.domain)}
                </small>
              </span>
              <time>{relativeTime(person.lastAt, locale)}</time>
              {active.id === person.id ? <Check size={16} /> : null}
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
          {t("compAddCompanion")}
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
