import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { RoleProvider } from "@/domains/account/roles/RoleProvider";
import { CompanionsPage } from "@/domains/companions/pages/CompanionsPage";
import {
  ensureCompanionsReady,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  ensureGeneralCompanion,
  forgetEverything,
} from "@/domains/companions/model/companions";
import {
  resolveAssistantChatTabs,
  writeAssistantChatTabs,
} from "@/domains/chat/model/assistant-chat-tabs";
import { writeAccountSession, clearAccountSession } from "@/core/session/account-session";
import { createCompanionDraftStore } from "@/domains/companions/model/drafts";

// Install a DOM before React DOM is imported. Explicit setup also works when
// this isolated project uses a Vitest runtime from a parent workspace.
const testDom = await vi.hoisted(async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://arrab.test/",
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLTextAreaElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLDialogElement",
    "Event",
    "CustomEvent",
    "StorageEvent",
    "MouseEvent",
    "KeyboardEvent",
    "localStorage",
    "sessionStorage",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  return dom;
});
afterAll(() => testDom.window.close());

const mocked = vi.hoisted(() => ({
  streams: [] as Array<{
    callbacks: {
      onToken: (text: string) => void;
      onDone: (result: { assistantMessage: { content: string } }) => void;
    };
    signal: AbortSignal;
    resolve: () => void;
  }>,
}));
vi.mock("@/core/api/api", () => ({
  arrabApi: {
    aiStatus: vi.fn(async () => ({ configured: true })),
    professionalWorkspace: vi.fn(async () => {
      throw new Error("offline in UI tests");
    }),
    companionDesk: vi.fn(async () => {
      throw new Error("offline in UI tests");
    }),
    setProfessionalCompanionStatus: vi.fn(async () => ({})),
    unfurlUrl: vi.fn(async () => ({ error: "offline in UI tests" })),
    familyGuidanceForCompanion: vi.fn(async () => ({ items: [] })),
    createAgent: vi.fn(async () => ({ id: "mock-agent" })),
    updateAgent: vi.fn(async () => ({ id: "mock-agent" })),
    createConversation: vi.fn(async () => ({ id: "mock-conversation" })),
    conversation: vi.fn(async (id: string) => ({
      conversation: { id, title: "Chat" },
      messages: [],
    })),
    sendMessageStream: vi.fn(
      (_id, _input, callbacks, signal) =>
        new Promise<void>((resolve) => {
          mocked.streams.push({ callbacks, signal, resolve });
        }),
    ),
  },
}));
vi.mock("@/domains/account/use-signed-in-account", () => ({
  useSignedInAccount: () => ({ signedIn: true }),
}));

let root: Root | null;
let host: HTMLDivElement;

async function mount(strict = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page = createElement(
    MemoryRouter,
    { initialEntries: ["/individuals"] },
    createElement(LanguageProvider, {
      children: createElement(RoleProvider, { role: "individual" }, createElement(CompanionsPage)),
    }),
  );
  await act(async () => root!.render(strict ? createElement(StrictMode, null, page) : page));
}

async function unmount() {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
}

function composer() {
  return host.querySelector<HTMLTextAreaElement>(".cp-composer textarea")!;
}

async function typeDraft(value: string) {
  await act(async () => {
    // Use the native setter so React receives an actual input change.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      composer(),
      value,
    );
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}

beforeEach(async () => {
  root = null;
  localStorage.clear();
  sessionStorage.clear();
  clearAccountSession();
  writeAccountSession("t".repeat(40), "acc_ui_test");
  forgetEverything();
  await ensureCompanionsReady();
  mocked.streams.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Live network is forbidden in UI tests"))),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterEach(async () => {
  await unmount();
  await act(async () => mocked.streams.forEach((stream) => stream.resolve()));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("real companion chat interactions", () => {
  it("preserves separate Personal and Work drafts through switching and remounting", async () => {
    await mount();
    await typeDraft("Personal draft\nwith another line");
    await click(".cp-chat-heading .cp-segment button:nth-child(2)");
    expect(composer().value).toBe("");
    await typeDraft("Work draft");
    await click(".cp-chat-heading .cp-segment button:nth-child(1)");
    expect(composer().value).toBe("Personal draft\nwith another line");
    await unmount();
    await mount();
    expect(composer().value).toBe("Personal draft\nwith another line");
    await click(".cp-chat-heading .cp-segment button:nth-child(2)");
    expect(composer().value).toBe("Work draft");
  });

  it("allows typing during a reply, preserves that draft on Stop, and rejects stale callbacks", async () => {
    await mount();
    await typeDraft("First question");
    await click(".cp-send");
    expect(mocked.streams).toHaveLength(1);
    expect(composer().disabled).toBe(false);
    expect(composer().value).toBe("");
    await typeDraft("Second question waiting");
    // With a draft typed, the action becomes "queue", not Stop.
    expect(host.querySelector(".cp-stop")).toBeNull();
    await typeDraft("");
    await click(".cp-stop");
    expect(mocked.streams[0]!.signal.aborted).toBe(true);
    expect(host.querySelector(".cp-stop")).toBeNull();
    await typeDraft("Second question waiting");

    await click(".cp-send");
    expect(mocked.streams).toHaveLength(2);
    await typeDraft("Third draft to keep");
    await act(async () => {
      const stale = mocked.streams[0]!;
      stale.callbacks.onToken("STALE REPLY MUST NOT APPEAR");
      stale.callbacks.onDone({ assistantMessage: { content: "STALE FINAL" } });
      stale.resolve();
    });
    expect(composer().value).toBe("Third draft to keep");
    expect(host.textContent).not.toContain("STALE");
    // Still replying, but a typed draft turns Stop into a queued send.
    expect(composer().disabled).toBe(false);
    await act(async () => {
      mocked.streams[1]!.callbacks.onToken("Fresh response");
      mocked.streams[1]!.resolve();
    });
    expect(host.querySelector(".cp-stop")).toBeNull();
    expect(host.textContent).toContain("Fresh response");
    expect(composer().value).toBe("Third draft to keep");
  });

  it("appends a carried board draft to its destination exactly once in StrictMode", async () => {
    const person = ensureGeneralCompanion("work");
    const drafts = createCompanionDraftStore();
    // Drafts are keyed per chat tab, so pin each room's tab first.
    const roomKey = (id: string, key: string) => {
      const tabs = resolveAssistantChatTabs(id, null, "Chat", "chat", null);
      writeAssistantChatTabs(id, tabs, "chat");
      return `${key}:${tabs.activeId}:chat`;
    };
    drafts.write(roomKey("general-personal", "general-personal"), "Personal stays untouched");
    drafts.write(roomKey(person.id, "general-work"), "Existing work draft");
    sessionStorage.setItem(COMPANION_FOCUS_KEY, person.id);
    sessionStorage.setItem(COMPANION_DRAFT_KEY, "Topic from the board");
    await mount(true);
    expect(composer().value).toBe("Existing work draft\n\nTopic from the board");
    expect(sessionStorage.getItem(COMPANION_DRAFT_KEY)).toBeNull();
    expect(sessionStorage.getItem(COMPANION_FOCUS_KEY)).toBeNull();
    await click(".cp-chat-heading .cp-segment button:nth-child(1)");
    expect(composer().value).toBe("Personal stays untouched");
    await click(".cp-chat-heading .cp-segment button:nth-child(2)");
    expect(composer().value).toBe("Existing work draft\n\nTopic from the board");
  });

  it("professional chat page: no 24/7 Stay toggle, assistant + chat list, Esc stops, new chat", async () => {
    localStorage.removeItem("arrab.proRoster.view");
    await mount();
    await click(".cp-chat-heading .cp-segment button:nth-child(2)");
    expect(host.querySelector(".pro-stay-toggle")).toBeNull();
    expect(host.textContent).not.toContain("24/7");
    const assistant = host.querySelector<HTMLButtonElement>(".pro-row-assistant");
    expect(assistant).not.toBeNull();
    expect(assistant!.getAttribute("aria-pressed")).toBe("true");
    // The sidebar leads with companions; saved chats live in their own tab.
    expect(host.querySelectorAll(".pro-roster-tab")).toHaveLength(2);
    expect(host.querySelector(".pro-chats")).toBeNull();
    expect(host.querySelector(".pro-empty")).toBeNull();
    expect(host.querySelectorAll(".pro-add-row")).toHaveLength(2);
    await click(".pro-roster-tab:nth-child(2)");
    expect(host.querySelector(".pro-row-assistant")).toBeNull();
    expect(host.querySelectorAll(".pro-chats .pro-chat-row")).toHaveLength(1);
    expect(host.querySelector(".cp-chat-rail")).toBeNull();
    expect(host.querySelector('.pro-room-dot[data-state="ready"]')).not.toBeNull();

    await typeDraft("Hello there");
    await click(".cp-send");
    expect(mocked.streams).toHaveLength(1);
    expect(host.querySelector('.pro-room-dot[data-state="working"]')).not.toBeNull();
    await act(async () => {
      composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(mocked.streams[0]!.signal.aborted).toBe(true);
    await act(async () => mocked.streams[0]!.resolve());

    await click(".cp-room-actions .pro-room-action");
    expect(host.querySelectorAll(".pro-chats .pro-chat-row")).toHaveLength(2);
    await click(".pro-roster-tab:nth-child(1)");
    expect(host.querySelector(".pro-row-assistant")).not.toBeNull();
  });

  it("professional chat page: links under messages open the preview panel", async () => {
    await mount();
    await click(".cp-chat-heading .cp-segment button:nth-child(2)");
    expect(host.querySelector(".cp-preview-panel")).toBeNull();
    await typeDraft("Screenshot and preview this page for me: https://example.com/docs");
    await click(".cp-send");
    // A "preview this site" request opens the page right away.
    let panel = host.querySelector(".cp-preview-panel");
    expect(panel?.getAttribute("data-preview-kind")).toBe("link");
    expect(panel?.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups");
    await act(async () => {
      const stream = mocked.streams.at(-1)!;
      stream.callbacks.onToken("Here is the page.");
      stream.callbacks.onDone({ assistantMessage: { content: "Here is the page." } });
      stream.resolve();
    });
    await click('.cp-preview-panel [aria-label="Close preview"]');
    expect(host.querySelector(".cp-preview-panel")).toBeNull();
    await click('.cp-message-me .cp-source-chip[data-source-kind="link"]');
    panel = host.querySelector(".cp-preview-panel");
    expect(panel?.querySelector("iframe")?.getAttribute("src")).toBe("https://example.com/docs");
    // Header toggle closes it again.
    await click(".pro-preview-toggle");
    expect(host.querySelector(".cp-preview-panel")).toBeNull();
  }, 20_000);
});
