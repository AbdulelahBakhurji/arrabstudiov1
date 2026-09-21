import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { RoleProvider } from "@/roles/RoleProvider";
import { CompanionsPage } from "@/pages/CompanionsPage";
import {
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  ensureGeneralCompanion,
  forgetEverything,
} from "@/lib/companions";
import { createCompanionDraftStore } from "@/lib/companion-drafts";

// Install a DOM before React DOM is imported. Explicit setup also works when
// this isolated project uses a Vitest runtime from a parent workspace.
const testDom = await vi.hoisted(async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://arrab.test/", pretendToBeVisual: true,
  });
  for (const key of [
    "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLTextAreaElement",
    "HTMLInputElement", "HTMLButtonElement", "HTMLDialogElement", "Event", "MouseEvent", "KeyboardEvent",
    "localStorage", "sessionStorage",
  ]) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  return dom;
});
afterAll(() => testDom.window.close());

const mocked = vi.hoisted(() => ({
  streams: [] as Array<{
    callbacks: { onToken: (text: string) => void; onDone: (result: { assistantMessage: { content: string } }) => void };
    signal: AbortSignal;
    resolve: () => void;
  }>,
}));
vi.mock("@/lib/api", () => ({
  arrabApi: {
    aiStatus: vi.fn(async () => ({ configured: true })),
    createAgent: vi.fn(async () => ({ id: "mock-agent" })),
    updateAgent: vi.fn(async () => ({ id: "mock-agent" })),
    createConversation: vi.fn(async () => ({ id: "mock-conversation" })),
    conversation: vi.fn(async () => ({ messages: [] })),
    sendMessageStream: vi.fn((_id, _input, callbacks, signal) => new Promise<void>((resolve) => {
      mocked.streams.push({ callbacks, signal, resolve });
    })),
  },
}));
vi.mock("@/lib/use-signed-in-account", () => ({
  useSignedInAccount: () => ({ signedIn: true }),
}));

let root: Root | null;
let host: HTMLDivElement;

async function mount(strict = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page = createElement(MemoryRouter, { initialEntries: ["/individuals"] },
    createElement(LanguageProvider, { children:
      createElement(RoleProvider, { role: "individual" }, createElement(CompanionsPage)),
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
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer(), value);
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}

beforeEach(() => {
  root = null;
  localStorage.clear();
  sessionStorage.clear();
  forgetEverything();
  mocked.streams.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Live network is forbidden in UI tests"))));
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
    await click(".cp-stop");
    expect(mocked.streams[0]!.signal.aborted).toBe(true);
    expect(composer().value).toBe("Second question waiting");
    expect(host.querySelector(".cp-stop")).toBeNull();

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
    expect(host.querySelector(".cp-stop")).not.toBeNull();
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
    drafts.write("general-personal", "Personal stays untouched");
    drafts.write("general-work", "Existing work draft");
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
});
