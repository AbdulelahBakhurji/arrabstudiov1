import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  Cable,
  ChevronsDownUp,
  ChevronsUpDown,
  Cpu,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Square,
  WifiOff,
  X,
} from "lucide-react";
import type { ConnectorPublic } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { useCompanionRoom } from "@/components/companions/useCompanionRoom";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import { ComposerPlusMenu } from "@/components/ComposerPlusMenu";
import type { LocalToolArtifact } from "@/lib/agent-local-tools";
import { filesToDraftParts } from "@/lib/composer-attachments";
import { arrabApi } from "@/lib/api";
import { hasLocalModelSelected } from "@/lib/ai-prefs";
import { companionPortraitUrl } from "@/lib/companion-portrait";
import {
  createAssistantChatTab,
  readAssistantChatTabs,
  titleFromMessage,
  writeAssistantChatTabs,
  type AssistantChatTab,
} from "@/lib/assistant-chat-tabs";
import {
  ARRAB_ASSISTANT_CONNECTORS,
  connectorIcon,
  connectorLabel,
} from "@/lib/connector-catalog";
import { listDir, openPath, type FsEntry } from "@/lib/fs";
import { readPrefs, subscribePrefs } from "@/lib/prefs";
import { isTauriRuntime, pickFolder } from "@/lib/terminal";
import {
  addWorkTask,
  purposeWorkForCompanion,
  setWorkState,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
  type StudioCatalogEntry,
} from "@/lib/companions";
import { purposeRegistryById } from "@/lib/purpose-registry";
import { WORKPLACE_TASK_KEY } from "@/lib/workplace-handoff";
import { cn } from "@/lib/utils";

const FOLDER_KEY = "arrab.assistantFolder";

function folderName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function readSavedFolder() {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

export function ArrabAssistantWorkspace({
  companion,
  kind,
}: {
  companion: CompanionProfile;
  kind: StudioCatalogEntry;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href } = useRole();
  const state = useCompanionState();
  const purpose = purposeRegistryById(companion.purposeId || "arrab-assistant");
  const purposeTasks = purposeWorkForCompanion(state, companion.id);
  const defaultChatTitle = ar ? "محادثة" : "Chat";
  const [chatTabs, setChatTabs] = useState(() =>
    readAssistantChatTabs(companion.id, companion.conversationId, defaultChatTitle),
  );
  const activeTab =
    chatTabs.tabs.find((tab) => tab.id === chatTabs.activeId) ?? chatTabs.tabs[0]!;
  const roomCompanion = useMemo(
    () => ({ ...companion, conversationId: activeTab.conversationId }),
    [companion, activeTab.conversationId],
  );
  const room = useCompanionRoom(roomCompanion, activeTab.id);
  const [folderPath, setFolderPath] = useState<string | null>(readSavedFolder);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [dirRel, setDirRel] = useState("");
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [hqTaskNote, setHqTaskNote] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => readPrefs());
  const [pendingAttach, setPendingAttach] = useState<string[]>([]);
  const [preview, setPreview] = useState<LocalToolArtifact | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);
  const titledTabRef = useRef<string | null>(null);

  const connectedProviders = useMemo(
    () => new Set(connectors.map((item) => item.provider)),
    [connectors],
  );
  const localOn = hasLocalModelSelected(prefs);

  useEffect(() => subscribePrefs(setPrefs), []);

  useEffect(() => {
    writeAssistantChatTabs(companion.id, chatTabs);
  }, [companion.id, chatTabs]);

  // Bind the active tab’s conversation when switching tabs (not on every conversationId write).
  useEffect(() => {
    updateCompanion(companion.id, { conversationId: activeTab.conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id]);

  useEffect(() => {
    const conversationId = companion.conversationId;
    if (!conversationId) return;
    setChatTabs((current) => {
      const active = current.tabs.find((tab) => tab.id === current.activeId);
      if (!active || active.conversationId === conversationId) return current;
      return {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === active.id ? { ...tab, conversationId } : tab,
        ),
      };
    });
  }, [companion.conversationId]);

  useEffect(() => {
    const firstMine = room.lines.find((line) => line.who === "me");
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
  }, [activeTab.id, activeTab.title, defaultChatTitle, room.lines]);

  useEffect(() => {
    if (!preview?.previewHtml) {
      setPreviewUrl(null);
      return;
    }
    const blob = new Blob([preview.previewHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  useEffect(() => {
    const raw = sessionStorage.getItem(WORKPLACE_TASK_KEY);
    if (!raw) return;
    sessionStorage.removeItem(WORKPLACE_TASK_KEY);
    try {
      const task = JSON.parse(raw) as { title?: string; brief?: string | null };
      const block = [
        `HQ task: ${task.title ?? "Untitled"}`,
        task.brief ? `Brief: ${task.brief}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      setHqTaskNote(block);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (companion.connectors.length < ARRAB_ASSISTANT_CONNECTORS.length) {
      updateCompanion(companion.id, {
        connectors: [...ARRAB_ASSISTANT_CONNECTORS],
        brief: kind.brief,
      });
    }
  }, [companion.id, companion.connectors.length, kind.brief]);

  useEffect(() => {
    let cancelled = false;
    void arrabApi
      .connectors()
      .then((response) => {
        if (!cancelled) setConnectors(response.items);
      })
      .catch(() => {
        if (!cancelled) setConnectors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (folderPath) localStorage.setItem(FOLDER_KEY, folderPath);
    else localStorage.removeItem(FOLDER_KEY);
  }, [folderPath]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.lines.length, room.busy]);

  useEffect(() => {
    const onConnect = () => {
      void connectFolder();
    };
    window.addEventListener("arrab:connect-folder", onConnect);
    return () => window.removeEventListener("arrab:connect-folder", onConnect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFiles = async (rel = dirRel) => {
    if (!folderPath || !isTauriRuntime()) {
      setEntries([]);
      return;
    }
    try {
      const result = await listDir(folderPath, rel);
      setEntries(result.entries);
      setFolderError(null);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : t("studioAssistantFolderError"));
      setEntries([]);
    }
  };

  useEffect(() => {
    void refreshFiles(dirRel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath, dirRel]);

  const treeSummary = useMemo(() => {
    if (!folderPath) return null;
    const lines = entries.slice(0, 40).map((entry) => `${entry.kind === "dir" ? "dir" : "file"} ${entry.path}`);
    return [
      `PC folder: ${folderPath}`,
      dirRel ? `Viewing: ${dirRel}` : "Viewing: /",
      ...lines,
      entries.length > 40 ? `… +${entries.length - 40} more` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }, [dirRel, entries, folderPath]);

  const connectFolder = async () => {
    if (!isTauriRuntime()) {
      setFolderError(t("studioAssistantNeedsDesktop"));
      return;
    }
    const selected = await pickFolder();
    if (!selected) return;
    setFolderPath(selected);
    setDirRel("");
  };

  const selectChatTab = (tabId: string) => {
    titledTabRef.current = null;
    setChatTabs((current) =>
      current.activeId === tabId ? current : { ...current, activeId: tabId },
    );
  };

  const addChatTab = () => {
    const tab = createAssistantChatTab(
      `${defaultChatTitle} ${chatTabs.tabs.length + 1}`,
      null,
    );
    titledTabRef.current = null;
    setChatTabs((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeId: tab.id,
      tabsCollapsed: false,
    }));
  };

  const closeChatTab = (tabId: string) => {
    setChatTabs((current) => {
      if (current.tabs.length <= 1) {
        const fresh = createAssistantChatTab(defaultChatTitle, null);
        titledTabRef.current = null;
        return {
          ...current,
          tabs: [fresh],
          activeId: fresh.id,
        };
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
  };

  const toggleRail = () => {
    setChatTabs((current) => ({ ...current, railCollapsed: !current.railCollapsed }));
  };

  const toggleTabsBar = () => {
    setChatTabs((current) => ({ ...current, tabsCollapsed: !current.tabsCollapsed }));
  };

  const ingestUploads = async (list: FileList | null) => {
    const parts = await filesToDraftParts(list);
    if (!parts.length) return;
    setPendingAttach((current) => [...current, ...parts.map((part) => part.split("\n")[0] ?? part)]);
    room.setDraft((current) => (current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n")));
  };

  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? room.draft).trim();
    if (!text || room.busy) return;
    setPendingAttach([]);
    await room.send(text, {
      onArtifact: (artifact) => setPreview(artifact),
      workspaceHint: {
        kind: folderPath ? "folder" : "none",
        folderPath,
        treeSummary,
        sessionNotes: [
          hqTaskNote,
          localOn
            ? `Local model active: ${prefs.aiLocalModel} (offline-capable).`
            : null,
          ar
            ? "مساعد عراب: نفّذ العمل بالكامل — بحث ويب وتفريغ صفحات و PDF وملفات الجهاز والموصلات."
            : "Arrab Assistant: finish the job — web search, scrape pages, PDF, PC files, and connectors.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        operatorDirectives: [
          folderPath
            ? "A PC folder is attached. Prefer list_files/read_file/write_file/run_terminal when useful."
            : "No PC folder yet — use Arrab desk for generate_pdf/preview_html; ask to attach a folder for project files.",
          "Use web_search then scrape_page for live research. Use generate_pdf for reports (shows in-app preview).",
        ].join(" "),
      },
    });
  };

  const suggestions = ar
    ? [
        "ابحث في الويب عن آخر أخبار الذكاء الاصطناعي",
        "افرّغ هذه الصفحة ولخّصها",
        "أنشئ تقرير PDF قصير معاينة",
        "رتّب مجلد التنزيلات",
      ]
    : [
        "Search the web for the latest AI news",
        "Scrape a page and summarize it",
        "Generate a short PDF report with preview",
        "Arrange my Downloads folder",
      ];

  const displayName = ar ? kind.nameAr || companion.name : kind.name || companion.name;
  const displayBlurb = ar ? kind.blurbAr : kind.blurb;
  const photo =
    companion.avatarPhoto ||
    kind.avatarPhoto ||
    companionPortraitUrl({
      seed: companion.faceSeed || kind.faceSeed,
      name: displayName,
      domain: companion.domain || kind.domain || kind.id,
      size: 256,
    });
  const railPortrait = (
    <PhotoAvatar
      src={photo}
      name={displayName}
      size="lg"
      state="lit"
      fallbackHue={kind.hue}
      fallbackSeed={kind.faceSeed}
    />
  );
  const welcomePortrait = (
    <PhotoAvatar
      src={photo}
      name={displayName}
      size="xl"
      state="lit"
      fallbackHue={kind.hue}
      fallbackSeed={kind.faceSeed}
    />
  );
  const chatPortrait = (
    <PhotoAvatar
      src={photo}
      name={displayName}
      size="sm"
      fallbackHue={kind.hue}
      fallbackSeed={kind.faceSeed}
    />
  );

  const connectedCount = ARRAB_ASSISTANT_CONNECTORS.filter((provider) =>
    connectedProviders.has(provider),
  ).length;

  return (
    <div
      className={cn(
        "st-work st-work-assistant st-assist-air",
        preview && "has-preview",
        chatTabs.railCollapsed && "is-rail-collapsed",
        chatTabs.tabsCollapsed && "is-tabs-collapsed",
      )}
    >
      <aside className="st-assist-rail">
        {chatTabs.railCollapsed ? (
          <button
            type="button"
            className="st-assist-rail-expand"
            onClick={toggleRail}
            aria-label={t("studioAssistantExpandPanels")}
            title={t("studioAssistantExpandPanels")}
          >
            <PanelLeft size={16} strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="st-assist-identity">
          <div className="st-assist-identity-face">{railPortrait}</div>
          <div className="st-assist-identity-copy">
            <p className="st-assist-kicker">{t("studioAssistantMain")}</p>
            <strong>{displayName}</strong>
            <p>{displayBlurb}</p>
          </div>
        </div>

        <div className="st-assist-pills">
          <span className={cn("st-assist-pill", folderPath && "is-on")}>
            <FolderOpen size={12} strokeWidth={1.8} />
            {folderPath ? folderName(folderPath) : ar ? "مجلد" : "Folder"}
          </span>
          <span className={cn("st-assist-pill", connectedCount > 0 && "is-on")}>
            <Cable size={12} strokeWidth={1.8} />
            {ar ? `${connectedCount} موصل` : `${connectedCount} linked`}
          </span>
          <span className={cn("st-assist-pill", localOn && "is-on is-local")}>
            {localOn ? <Cpu size={12} strokeWidth={1.8} /> : <WifiOff size={12} strokeWidth={1.8} />}
            {localOn ? prefs.aiLocalModel : ar ? "سحابي" : "Cloud"}
          </span>
        </div>

        {hqTaskNote ? (
          <div className="st-assist-note">
            <span>{ar ? "مهمة المقر" : "HQ task"}</span>
            <p>{hqTaskNote}</p>
          </div>
        ) : null}

        <div className="st-assist-block">
          <div className="st-assist-block-head">
            <span>{t("studioAssistantPcFiles")}</span>
            {folderPath ? (
              <button type="button" className="st-assist-text-btn" onClick={() => void connectFolder()}>
                {t("studioAssistantChangeFolder")}
              </button>
            ) : null}
          </div>
          {folderPath ? (
            <div className="st-assist-folder">
              <div className="st-assist-files">
                {dirRel ? (
                  <button
                    type="button"
                    className="st-assist-file"
                    onClick={() =>
                      setDirRel((current) => current.split("/").slice(0, -1).join("/"))
                    }
                  >
                    ↑ ..
                  </button>
                ) : null}
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="st-assist-file"
                    onClick={() => {
                      if (entry.kind === "dir") setDirRel(entry.path);
                    }}
                    disabled={entry.kind !== "dir"}
                  >
                    {entry.kind === "dir" ? (
                      <Folder size={13} strokeWidth={1.7} />
                    ) : (
                      <FileText size={13} strokeWidth={1.7} />
                    )}
                    <span>{entry.name}</span>
                  </button>
                ))}
                {!entries.length ? (
                  <p className="st-assist-empty">{t("studioAssistantEmptyFolder")}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="st-assist-text-btn"
                onClick={() => {
                  setFolderPath(null);
                  setDirRel("");
                  setEntries([]);
                }}
              >
                <X size={12} />
                {t("studioAssistantDisconnect")}
              </button>
            </div>
          ) : (
            <div className="st-assist-empty-folder">
              <p>{t("studioAssistantPcHint")}</p>
              <button type="button" className="st-assist-soft-btn" onClick={() => void connectFolder()}>
                <FolderOpen size={14} strokeWidth={1.7} />
                {t("studioAssistantConnectFolder")}
              </button>
            </div>
          )}
          {folderError ? <p className="st-chat-error">{folderError}</p> : null}
        </div>

        <div className="st-assist-block">
          <div className="st-assist-block-head">
            <span>{t("studioAssistantConnectors")}</span>
            <Link className="st-assist-text-btn" to={href("/connectors")}>
              {t("studioAssistantManageConnectors")}
            </Link>
          </div>
          <div className="st-assist-connectors">
            {ARRAB_ASSISTANT_CONNECTORS.map((provider) => {
              const Icon = connectorIcon(provider);
              const on = connectedProviders.has(provider);
              return (
                <span
                  key={provider}
                  className={cn("st-assist-chip", on && "is-on")}
                  title={connectorLabel(provider, ar)}
                >
                  <Icon size={12} strokeWidth={1.7} />
                  <span>{connectorLabel(provider, ar)}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="st-assist-block is-quiet">
          <div className="st-assist-block-head">
            <span>
              {ar ? purpose?.nameAr ?? t("studioPurposeTasks") : purpose?.name ?? t("studioPurposeTasks")}
            </span>
          </div>
          <div className="st-assist-tasks">
            {purposeTasks.length === 0 ? (
              <p className="st-assist-empty">{t("studioPurposeTasksEmpty")}</p>
            ) : (
              purposeTasks.map((item) => {
                const checked = item.state === "accepted" || item.state === "done";
                return (
                  <label key={item.id} className="st-assist-task">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setWorkState(item.id, checked ? "suggested" : "done")}
                    />
                    <span className={item.state === "done" ? "is-done" : undefined}>{item.text}</span>
                  </label>
                );
              })
            )}
            {addingTask ? (
              <form
                className="st-assist-task-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = taskDraft.trim();
                  if (!text) return;
                  addWorkTask({
                    companionId: companion.id,
                    text,
                    capturedFrom: ar ? "أضفتها بنفسك" : "Added by you",
                    space: companion.space,
                    purposeId: companion.purposeId || purpose?.id || "arrab-assistant",
                  });
                  setTaskDraft("");
                  setAddingTask(false);
                }}
              >
                <input
                  ref={taskInputRef}
                  value={taskDraft}
                  onChange={(event) => setTaskDraft(event.target.value)}
                  placeholder={t("studioPurposeTasksAddPlaceholder")}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setAddingTask(false);
                      setTaskDraft("");
                    }
                  }}
                />
                <button type="submit" disabled={!taskDraft.trim()}>
                  {t("compAdd")}
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="st-assist-task-more"
                onClick={() => {
                  setAddingTask(true);
                  queueMicrotask(() => taskInputRef.current?.focus());
                }}
              >
                {t("studioPurposeTasksAdd")}
              </button>
            )}
          </div>
        </div>
      </aside>

      <section className="st-assist-chat">
        <header className="st-assist-chat-head">
          <div className="st-assist-chat-who">
            {chatPortrait}
            <div>
              <strong>{displayName}</strong>
              <p>
                {localOn
                  ? ar
                    ? `محلي · ${prefs.aiLocalModel}`
                    : `Local · ${prefs.aiLocalModel}`
                  : t("studioAssistantChatTitle")}
              </p>
            </div>
          </div>
          <div className="st-assist-chat-tools">
            <button
              type="button"
              className="st-assist-tool-btn"
              onClick={toggleRail}
              aria-label={
                chatTabs.railCollapsed
                  ? t("studioAssistantExpandPanels")
                  : t("studioAssistantCollapsePanels")
              }
              title={
                chatTabs.railCollapsed
                  ? t("studioAssistantExpandPanels")
                  : t("studioAssistantCollapsePanels")
              }
            >
              {chatTabs.railCollapsed ? (
                <PanelLeft size={15} strokeWidth={1.8} />
              ) : (
                <PanelLeftClose size={15} strokeWidth={1.8} />
              )}
            </button>
            <button
              type="button"
              className="st-assist-tool-btn"
              onClick={toggleTabsBar}
              aria-label={
                chatTabs.tabsCollapsed
                  ? t("studioAssistantShowTabs")
                  : t("studioAssistantHideTabs")
              }
              title={
                chatTabs.tabsCollapsed
                  ? t("studioAssistantShowTabs")
                  : t("studioAssistantHideTabs")
              }
            >
              {chatTabs.tabsCollapsed ? (
                <ChevronsUpDown size={15} strokeWidth={1.8} />
              ) : (
                <ChevronsDownUp size={15} strokeWidth={1.8} />
              )}
            </button>
            {chatTabs.tabsCollapsed ? (
              <button
                type="button"
                className="st-assist-tool-btn"
                onClick={addChatTab}
                aria-label={t("studioAssistantNewTab")}
                title={t("studioAssistantNewTab")}
              >
                <Plus size={15} strokeWidth={1.8} />
              </button>
            ) : null}
            <span className={cn("st-assist-live", localOn && "is-local")}>
              {localOn ? (ar ? "بلا إنترنت" : "Offline ready") : ar ? "جاهز" : "Ready"}
            </span>
          </div>
        </header>

        {!chatTabs.tabsCollapsed ? (
          <div className="st-assist-chat-tabs" role="tablist" aria-label={t("studioAssistantChatTabs")}>
            <div className="st-assist-chat-tabs-scroll">
              {chatTabs.tabs.map((tab: AssistantChatTab) => (
                <div
                  key={tab.id}
                  className={cn("st-assist-chat-tab", tab.id === activeTab.id && "is-on")}
                  role="tab"
                  aria-selected={tab.id === activeTab.id}
                >
                  <button
                    type="button"
                    className="st-assist-chat-tab-label"
                    onClick={() => selectChatTab(tab.id)}
                  >
                    {tab.title}
                  </button>
                  <button
                    type="button"
                    className="st-assist-chat-tab-close"
                    aria-label={t("studioAssistantCloseTab")}
                    title={t("studioAssistantCloseTab")}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeChatTab(tab.id);
                    }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="st-assist-chat-tab-add"
              onClick={addChatTab}
              aria-label={t("studioAssistantNewTab")}
              title={t("studioAssistantNewTab")}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          </div>
        ) : null}

        <div className="st-chat-log st-assist-log">
          {room.lines.length === 0 ? (
            <div className="st-assist-welcome">
              <div className="st-assist-welcome-face">{welcomePortrait}</div>
              <h3>{t("studioAssistantWelcome")}</h3>
              <p>{t("studioAssistantWelcomeHint")}</p>
              <div className="st-suggest-row is-welcome-grid">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="st-suggest-chip"
                    disabled={room.busy}
                    onClick={() => void send(undefined, item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            room.lines.map((line) => (
              <div
                key={line.id}
                className={cn("st-bubble st-assist-bubble", line.who === "me" ? "is-me" : "is-them")}
              >
                {line.text}
              </div>
            ))
          )}
          {room.error ? <p className="st-chat-error">{room.error}</p> : null}
          {room.busy ? <div className="st-bubble st-assist-bubble is-them is-busy">…</div> : null}
          <div ref={chatEnd} />
        </div>

        <form className="st-assist-composer" onSubmit={(event) => void send(event)}>
          {pendingAttach.length > 0 ? (
            <div className="st-assist-attach-row">
              {pendingAttach.map((label) => (
                <span key={label} className="st-assist-attach-chip">
                  {label.replace(/^\[Attached (?:image|file): /, "").replace(/\]$/, "").slice(0, 42)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="st-assist-composer-shell">
            <ComposerPlusMenu
              open={plusOpen}
              onOpenChange={setPlusOpen}
              onUploadImages={() => imageInputRef.current?.click()}
              onUploadFiles={() => fileInputRef.current?.click()}
              onConnectFolder={() => void connectFolder()}
              onWebSearch={() =>
                room.setDraft((current) =>
                  current.trim().startsWith("/web")
                    ? current
                    : `/web ${current.trim()}`.trim() + " ",
                )
              }
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
              multiple
              hidden
              onChange={(event) => {
                void ingestUploads(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void ingestUploads(event.target.files);
                event.target.value = "";
              }}
            />
            <textarea
              value={room.draft}
              onChange={(event) => room.setDraft(event.target.value)}
              placeholder={t("studioAssistantPlaceholder")}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {room.busy ? (
              <button
                type="button"
                className="st-assist-send is-stop"
                onClick={() => room.stop()}
                aria-label={ar ? "إيقاف" : "Stop"}
              >
                <Square size={14} strokeWidth={2.2} />
              </button>
            ) : (
              <button
                type="submit"
                className="st-assist-send"
                disabled={!room.draft.trim()}
                aria-label={t("send")}
              >
                <ArrowUp size={18} strokeWidth={2.2} />
              </button>
            )}
          </div>
          <p className="st-assist-composer-hint">
            {ar
              ? "+ للموصلات والنموذج المحلي والملفات · Enter للإرسال"
              : "+ for connectors, local model, files · Enter to send"}
          </p>
        </form>
      </section>

      {preview ? (
        <section className="st-assist-preview" aria-label={ar ? "معاينة" : "Preview"}>
          <header className="st-assist-preview-head">
            <div>
              <FileText size={14} strokeWidth={1.8} />
              <strong>
                {preview.kind === "pdf"
                  ? ar
                    ? "معاينة PDF"
                    : "PDF preview"
                  : preview.kind === "csv"
                    ? ar
                      ? "ملف CSV"
                      : "CSV export"
                    : ar
                      ? "معاينة HTML"
                      : "HTML preview"}
              </strong>
              <span>{preview.title || preview.relativePath}</span>
            </div>
            <div className="st-assist-preview-actions">
              {isTauriRuntime() ? (
                <button
                  type="button"
                  className="st-assist-text-btn"
                  onClick={() =>
                    void openPath(preview.folderPath, preview.relativePath).catch(() => undefined)
                  }
                >
                  <ExternalLink size={13} />
                  {ar ? "فتح" : "Open"}
                </button>
              ) : null}
              <button
                type="button"
                className="st-assist-text-btn"
                onClick={() => setPreview(null)}
                aria-label={ar ? "إغلاق" : "Close"}
              >
                <X size={14} />
              </button>
            </div>
          </header>
          {previewUrl ? (
            <iframe title={preview.title || "preview"} src={previewUrl} className="st-assist-preview-frame" />
          ) : (
            <p className="st-assist-empty">
              {ar ? "لا معاينة متاحة لهذا الملف." : "No in-app preview for this file."}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
