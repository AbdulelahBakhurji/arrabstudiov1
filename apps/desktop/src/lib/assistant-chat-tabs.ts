/** Persisted Arrab Assistant chat tabs — stay until the user deletes them. */

export type AssistantChatTab = {
  id: string;
  title: string;
  conversationId: string | null;
  createdAt: string;
};

type AssistantChatTabsState = {
  tabs: AssistantChatTab[];
  activeId: string;
  railCollapsed: boolean;
  tabsCollapsed: boolean;
};

const STORAGE_PREFIX = "arrab.assistant.chatTabs.v1:";

/** `chat` = kid/self room; `parent` = parent coaching — never share storage. */
export type AssistantChatTabLane = "chat" | "parent";

function storageKey(companionId: string, lane: AssistantChatTabLane = "chat") {
  return lane === "parent"
    ? `${STORAGE_PREFIX}${companionId}:parent`
    : `${STORAGE_PREFIX}${companionId}`;
}

function newTab(title: string, conversationId: string | null = null): AssistantChatTab {
  return {
    id: crypto.randomUUID(),
    title,
    conversationId,
    createdAt: new Date().toISOString(),
  };
}

function defaultState(seedConversationId: string | null, title: string): AssistantChatTabsState {
  const tab = newTab(title, seedConversationId);
  return {
    tabs: [tab],
    activeId: tab.id,
    railCollapsed: false,
    tabsCollapsed: false,
  };
}

function readRaw(
  companionId: string,
  lane: AssistantChatTabLane = "chat",
): AssistantChatTabsState | null {
  try {
    const raw = localStorage.getItem(storageKey(companionId, lane));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssistantChatTabsState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs
      .filter((item): item is AssistantChatTab => Boolean(item?.id))
      .map((item) => ({
        id: String(item.id),
        title: String(item.title || "Chat").slice(0, 80),
        conversationId: item.conversationId ? String(item.conversationId) : null,
        createdAt: String(item.createdAt || new Date().toISOString()),
      }));
    if (!tabs.length) return null;
    const activeId =
      typeof parsed.activeId === "string" && tabs.some((tab) => tab.id === parsed.activeId)
        ? parsed.activeId
        : tabs[0]!.id;
    return {
      tabs,
      activeId,
      railCollapsed: Boolean(parsed.railCollapsed),
      tabsCollapsed: Boolean(parsed.tabsCollapsed),
    };
  } catch {
    return null;
  }
}

function writeRaw(
  companionId: string,
  state: AssistantChatTabsState,
  lane: AssistantChatTabLane = "chat",
) {
  try {
    localStorage.setItem(storageKey(companionId, lane), JSON.stringify(state));
  } catch {
    // Private browsing / quota — keep in-memory only.
  }
}

export function readAssistantChatTabs(
  companionId: string,
  seedConversationId: string | null,
  defaultTitle: string,
  lane: AssistantChatTabLane = "chat",
): AssistantChatTabsState {
  return readRaw(companionId, lane) ?? defaultState(seedConversationId, defaultTitle);
}

export function writeAssistantChatTabs(
  companionId: string,
  state: AssistantChatTabsState,
  lane: AssistantChatTabLane = "chat",
) {
  writeRaw(companionId, state, lane);
}

/** Drop a conversation from the kid/self tab lane so children never reopen it. */
export function scrubConversationFromChatTabs(companionId: string, conversationId: string) {
  if (!conversationId) return;
  const state = readRaw(companionId, "chat");
  if (!state) return;
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.conversationId !== conversationId) return tab;
    changed = true;
    return { ...tab, conversationId: null };
  });
  if (changed) writeRaw(companionId, { ...state, tabs }, "chat");
}

export function createAssistantChatTab(title: string, conversationId: string | null = null) {
  return newTab(title, conversationId);
}

export function titleFromMessage(text: string, fallback: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
}
