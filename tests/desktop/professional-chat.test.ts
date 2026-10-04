import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { ChatMarkdown } from "@/domains/chat/ui/ChatMarkdown";
import { orderChatTabs, type AssistantChatTab } from "@/domains/chat/model/assistant-chat-tabs";

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
    "Event",
    "MouseEvent",
    "localStorage",
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
  }
  return dom;
});
afterAll(() => testDom.window.close());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.setItem("arrab.locale", "en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(LanguageProvider, null, node)));
}

function tab(id: string, createdAt: string, pinned = false): AssistantChatTab {
  return { id, title: id, conversationId: null, createdAt, ...(pinned ? { pinned: true } : {}) };
}

describe("professional chat list ordering", () => {
  it("puts pinned chats first and sorts each group newest first", () => {
    const ordered = orderChatTabs([
      tab("old", "2026-10-01T10:00:00.000Z"),
      tab("pinned-old", "2026-09-01T10:00:00.000Z", true),
      tab("new", "2026-10-04T10:00:00.000Z"),
      tab("pinned-new", "2026-10-03T10:00:00.000Z", true),
    ]);
    expect(ordered.pinned.map((item) => item.id)).toEqual(["pinned-new", "pinned-old"]);
    expect(ordered.recent.map((item) => item.id)).toEqual(["new", "old"]);
  });
});

describe("ChatMarkdown", () => {
  it("renders headings, quotes, rules, and code blocks with a copy button", () => {
    render(
      createElement(ChatMarkdown, {
        content: [
          "## Plan",
          "> Keep it short",
          "",
          "---",
          "```ts",
          "const x = 1;",
          "```",
          "Done.",
        ].join("\n"),
      }),
    );
    expect(host.querySelector(".chat-md-heading.is-h2")?.textContent).toBe("Plan");
    expect(host.querySelector(".chat-md-quote")?.textContent).toBe("Keep it short");
    expect(host.querySelector(".chat-md-rule")).not.toBeNull();
    expect(host.querySelector(".chat-md-codelang")?.textContent).toBe("ts");
    expect(host.querySelector(".chat-md-pre code")?.textContent).toBe("const x = 1;");
    expect(host.querySelector<HTMLButtonElement>(".chat-md-codecopy")?.getAttribute("aria-label")).toBe(
      "Copy code",
    );
    expect(host.querySelector(".chat-md-p")?.textContent).toBe("Done.");
  });

  it("keeps plain paragraphs and lists unchanged", () => {
    render(createElement(ChatMarkdown, { content: "Hello **there**\n\n- one\n- two" }));
    expect(host.querySelector(".chat-md-p strong")?.textContent).toBe("there");
    expect(host.querySelectorAll(".chat-md-ul li")).toHaveLength(2);
    expect(host.querySelector(".chat-md-codeblock")).toBeNull();
  });
});
