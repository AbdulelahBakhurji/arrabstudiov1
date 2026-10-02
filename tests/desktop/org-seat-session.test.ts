import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOrgEmployeeSession,
  readOrgEmployeeSession,
  writeOrgEmployeeSession,
} from "@/domains/organization/org-employee-session";
import { useOrgSeatCapabilities } from "@/domains/organization/org-seat";

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

const session = (
  role: "admin" | "manager" | "member",
  expiresAt = new Date(Date.now() + 3_600_000).toISOString(),
) => ({
  sessionToken: "t".repeat(40),
  expiresAt,
  employee: {
    id: "emp_1",
    email: "a@b.test",
    displayName: "A",
    title: null,
    role,
    departmentId: null,
    mustChangePassword: false,
  },
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("org seat session store", () => {
  it("returns the SAME object until the stored value changes (required by useSyncExternalStore)", () => {
    writeOrgEmployeeSession(session("member"));
    const a = readOrgEmployeeSession();
    expect(a).not.toBeNull();
    expect(readOrgEmployeeSession()).toBe(a);
    writeOrgEmployeeSession(session("manager"));
    const b = readOrgEmployeeSession();
    expect(b).not.toBe(a);
    expect(b!.employee.role).toBe("manager");
    expect(readOrgEmployeeSession()).toBe(b);
  });

  it("an expired, malformed or incomplete session reads as signed out and is cleaned up", () => {
    for (const raw of [
      JSON.stringify(session("member", "2000-01-01T00:00:00.000Z")),
      "{not json",
      JSON.stringify({ sessionToken: "x" }),
      "null",
    ]) {
      localStorage.setItem("arrab.org.employee.session", raw);
      expect(readOrgEmployeeSession(), raw.slice(0, 30)).toBeNull();
    }
    writeOrgEmployeeSession(session("member"));
    clearOrgEmployeeSession();
    expect(readOrgEmployeeSession()).toBeNull();
  });

  it.each([
    ["member", { canAdminister: false, canAssignWork: false, canHireAgents: false }],
    ["manager", { canAdminister: false, canAssignWork: true, canHireAgents: false }],
    ["admin", { canAdminister: false, canAssignWork: true, canHireAgents: false }],
  ] as const)(
    "a component using useOrgSeatCapabilities renders (no render loop) for a signed-in %s",
    (role, expected) => {
      writeOrgEmployeeSession(session(role));
      const seen: Array<ReturnType<typeof useOrgSeatCapabilities>> = [];
      const Probe = () => {
        seen.push(useOrgSeatCapabilities());
        return null;
      };
      const errors: unknown[] = [];
      const spy = vi
        .spyOn(console, "error")
        .mockImplementation((...args) => void errors.push(args));
      act(() => root.render(createElement(Probe)));
      spy.mockRestore();
      expect(errors, "React must not report an infinite loop").toEqual([]);
      expect(seen.length).toBeLessThan(5);
      expect(seen.at(-1)).toMatchObject(expected);
    },
  );

  it("the owner (no seat session) gets full capabilities", () => {
    const seen: Array<ReturnType<typeof useOrgSeatCapabilities>> = [];
    const Probe = () => {
      seen.push(useOrgSeatCapabilities());
      return null;
    };
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toMatchObject({
      canAdminister: true,
      canAssignWork: true,
      canHireAgents: true,
    });
  });
});
