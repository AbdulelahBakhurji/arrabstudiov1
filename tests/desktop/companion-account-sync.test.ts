import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/api/api", () => ({
  arrabApi: {
    companionState: vi.fn(async () => ({ updatedAt: null, state: null })),
    putCompanionState: vi.fn(async (body: unknown) => body),
    conversations: vi.fn(async () => ({ items: [] })),
  },
}));

vi.mock("@/core/storage/local-secure", () => ({
  looksEncryptedLocal: () => false,
  openLocalJson: async (value: unknown) => value,
  sealLocalJson: async (value: unknown) => value,
}));

vi.mock("@/core/session/guest-mode", () => ({
  clearGuestLocalMode: () => undefined,
  enableGuestLocalMode: () => undefined,
}));

import { arrabApi } from "@/core/api/api";
import {
  clearAccountSession,
  writeAccountSession,
} from "@/core/session/account-session";
import { resolveAssistantChatTabs } from "@/domains/chat/assistant-chat-tabs";
import {
  addCompanion,
  forgetEverything,
  getCompanionState,
  syncCompanionsFromCloud,
} from "@/domains/companions/companions";

const TOKEN_A = "a".repeat(40);
const TOKEN_B = "b".repeat(40);
const ACCOUNT = "acc_same_user";
const OTHER_ACCOUNT = "acc_other_user";

function installStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", new EventTarget());
  return data;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  installStorage();
  vi.mocked(arrabApi.companionState).mockResolvedValue({ updatedAt: null, state: null });
  vi.mocked(arrabApi.putCompanionState).mockResolvedValue({
    updatedAt: new Date().toISOString(),
    state: {},
  } as never);
  vi.mocked(arrabApi.conversations).mockResolvedValue({ items: [] });
});

afterEach(() => {
  forgetEverything();
  vi.unstubAllGlobals();
});

describe("same-account companions and chats", () => {
  it("keeps companions after sign-out and sign-in with a new session token", async () => {
    writeAccountSession(TOKEN_A, ACCOUNT);
    await syncCompanionsFromCloud();
    const created = addCompanion({ name: "Maya", domain: "sleep", space: "personal" });
    expect(created.conversationId).toBeNull();
    await settle();

    clearAccountSession();
    await syncCompanionsFromCloud();
    expect(getCompanionState().companions).toHaveLength(0);

    writeAccountSession(TOKEN_B, ACCOUNT);
    await syncCompanionsFromCloud();
    const restored = getCompanionState().companions;
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(created.id);
    expect(restored[0]?.name).toBe("Maya");
  });

  it("does not show another account's companions", async () => {
    writeAccountSession(TOKEN_A, ACCOUNT);
    await syncCompanionsFromCloud();
    addCompanion({ name: "Maya", domain: "sleep", space: "personal" });
    await settle();

    clearAccountSession();
    writeAccountSession(TOKEN_B, OTHER_ACCOUNT);
    await syncCompanionsFromCloud();
    expect(getCompanionState().companions).toHaveLength(0);
  });

  it("pulls companions and chat pointers from the account cloud copy", async () => {
    vi.mocked(arrabApi.companionState).mockResolvedValue({
      updatedAt: "2026-09-24T10:00:00.000Z",
      state: {
        version: 2,
        companions: [
          {
            id: "maya",
            name: "Maya",
            domain: "sleep",
            purposeId: "sleep",
            space: "personal",
            agentId: "ag-maya",
            conversationId: "convo-maya",
          },
        ],
        assistantChatTabs: {
          maya: {
            chat: {
              tabs: [
                {
                  id: "tab-1",
                  title: "Sleep plan",
                  conversationId: "convo-maya",
                  createdAt: "2026-09-24T09:00:00.000Z",
                },
              ],
              activeId: "tab-1",
              railCollapsed: false,
              tabsCollapsed: false,
            },
          },
        },
      },
    });

    writeAccountSession(TOKEN_B, ACCOUNT);
    await syncCompanionsFromCloud();

    const state = getCompanionState();
    expect(state.companions).toHaveLength(1);
    expect(state.companions[0]?.name).toBe("Maya");
    expect(state.companions[0]?.conversationId).toBe("convo-maya");
    expect(state.assistantChatTabs.maya?.chat?.tabs[0]?.conversationId).toBe("convo-maya");
  });

  it("prefers account chat tabs that already have conversation details", () => {
    const accountTabs = {
      tabs: [
        {
          id: "tab-1",
          title: "Sleep plan",
          conversationId: "convo-maya",
          createdAt: "2026-09-24T09:00:00.000Z",
        },
      ],
      activeId: "tab-1",
      railCollapsed: false,
      tabsCollapsed: false,
    };
    const resolved = resolveAssistantChatTabs("maya", null, "Chat", "chat", accountTabs);
    expect(resolved.tabs[0]?.conversationId).toBe("convo-maya");
    expect(resolved.tabs[0]?.title).toBe("Sleep plan");
  });
});
