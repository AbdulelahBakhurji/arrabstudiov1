import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/shared/i18n/LanguageProvider";
import { ConnectivityBanner } from "@/app/shell/ConnectivityBanner";
import { reportTransportFailure, reportTransportSuccess } from "@/core/platform/network";
import { messages } from "@/shared/i18n/messages";

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
  reportTransportSuccess();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = (locale: "en" | "ar" = "en") => {
  localStorage.setItem("arrab.locale", locale);
  act(() => root.render(createElement(LanguageProvider, null, createElement(ConnectivityBanner))));
};

describe("ConnectivityBanner", () => {
  it("renders nothing while online", () => {
    mount();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("tells the user they are offline and that their work is safe, as a polite live region", () => {
    mount();
    act(() => reportTransportFailure());
    const banner = host.querySelector('[role="status"]')!;
    expect(banner).not.toBeNull();
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toBe(messages.en.connectivityOffline);
    expect(banner.textContent).toMatch(/saved on this device/i);
  });

  it("confirms the connection came back, then goes away by itself", () => {
    vi.useFakeTimers();
    mount();
    act(() => reportTransportFailure());
    act(() => reportTransportSuccess());
    expect(host.querySelector('[role="status"]')!.textContent).toBe(messages.en.connectivityBack);
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("speaks Arabic when the app is in Arabic", () => {
    mount("ar");
    act(() => reportTransportFailure());
    expect(host.querySelector('[role="status"]')!.textContent).toBe(
      messages.ar.connectivityOffline,
    );
    expect(messages.ar.connectivityOffline).not.toBe(messages.en.connectivityOffline);
  });
});
