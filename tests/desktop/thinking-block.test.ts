import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { ThinkingBlock, useThoughtTraces, type ThoughtTrace } from "@/domains/chat/ui/ThinkingBlock";

const testDom = await vi.hoisted(async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://arrab.test/",
    pretendToBeVisual: true,
  });
  for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "MouseEvent", "localStorage"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  return dom;
});
afterAll(() => testDom.window.close());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
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

describe("ThinkingBlock", () => {
  it("streams open while live, then collapses to a duration summary", () => {
    const started = Date.now() - 4_000;
    const live: ThoughtTrace = { text: "Checking the calendar", startedAt: started, endedAt: null };
    render(createElement(ThinkingBlock, { trace: live }));
    expect(host.textContent).toContain("Thinking…");
    expect(host.textContent).toContain("Checking the calendar");

    render(createElement(ThinkingBlock, { trace: { ...live, endedAt: started + 4_000 } }));
    expect(host.textContent).toContain("Thought for 4s");
    expect(host.textContent).not.toContain("Checking the calendar");

    act(() => host.querySelector<HTMLButtonElement>(".thk-head")!.click());
    expect(host.textContent).toContain("Checking the calendar");
  });

  it("tracks, finishes and re-keys traces", () => {
    let api: ReturnType<typeof useThoughtTraces> | null = null;
    function Probe() {
      api = useThoughtTraces();
      return null;
    }
    render(createElement(Probe));
    act(() => {
      api!.append("local", "a");
      api!.append("local", "b");
    });
    expect(api!.traces.local?.text).toBe("ab");
    expect(api!.traces.local?.endedAt).toBeNull();
    act(() => api!.rekey("local", "msg_1"));
    expect(api!.traces.local).toBeUndefined();
    expect(api!.traces.msg_1?.text).toBe("ab");
    expect(api!.traces.msg_1?.endedAt).not.toBeNull();
  });
});
