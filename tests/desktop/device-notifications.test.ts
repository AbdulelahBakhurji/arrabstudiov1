import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ title: string; body?: string }> = [];

beforeEach(() => {
  created.length = 0;
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  class FakeNotification {
    static permission = "granted";
    constructor(title: string, options?: { body?: string }) {
      created.push({ title, body: options?.body });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
  const notify = await import("../../apps/desktop/src/domains/notifications/notify");
  const prefs = await import("../../apps/desktop/src/shared/lib/prefs");
  return { ...notify, ...prefs };
}

describe("device-only notifications", () => {
  it("sends feedback as a device notification, not an in-app toast", async () => {
    const { pushToast } = await load();
    pushToast({ title: "Saved", body: "Your changes are stored", tone: "success" });
    await Promise.resolve();
    await Promise.resolve();
    expect(created).toEqual([{ title: "Saved", body: "Your changes are stored" }]);
  });

  it("does not expose an in-app toast or inbox API any more", async () => {
    const mod = (await load()) as Record<string, unknown>;
    for (const name of [
      "subscribeToasts",
      "getNotificationInbox",
      "subscribeNotificationInbox",
      "setUnreadBadge",
    ]) {
      expect(mod[name]).toBeUndefined();
    }
  });

  it("holds non-urgent notifications during Do Not Disturb but lets warnings and approvals through", async () => {
    const { pushToast, updatePrefs } = await load();
    updatePrefs({ dndUntil: Date.now() + 3_600_000 });
    pushToast({ title: "Saved", tone: "success" });
    pushToast({ title: "Could not save", tone: "warn" });
    pushToast({ title: "Approve send", tone: "approval", sticky: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(created.map((item) => item.title)).toEqual(["Could not save", "Approve send"]);
  });

  it("drops an immediate repeat of the same notification", async () => {
    const { pushToast } = await load();
    pushToast({ title: "Connector synced", id: "sync" });
    pushToast({ title: "Connector synced", id: "sync" });
    await Promise.resolve();
    await Promise.resolve();
    expect(created).toHaveLength(1);
  });

  it("notifyStudio respects per-kind switches and quiet hours", async () => {
    const { notifyStudio, updatePrefs } = await load();
    updatePrefs({ notifyConnector: false });
    await notifyStudio({ kind: "connector", title: "Slack connected" });
    expect(created).toHaveLength(0);

    updatePrefs({
      notifyConnector: true,
      dndUntil: Date.now() + 3_600_000,
      quietAllowApprovals: false,
    });
    await notifyStudio({ kind: "connector", title: "Slack connected" });
    await notifyStudio({ kind: "approvals", title: "Approve email", approvalId: "a1" });
    expect(created).toHaveLength(0);

    updatePrefs({ quietAllowApprovals: true });
    await notifyStudio({ kind: "approvals", title: "Approve calendar", approvalId: "a2" });
    expect(created.map((item) => item.title)).toEqual(["Approve calendar"]);
  });

  it("remembers where the last notification pointed, once", async () => {
    const { pushToast, takePendingOsLink } = await load();
    pushToast({ title: "Approve send", href: "/approvals", tone: "approval" });
    await Promise.resolve();
    await Promise.resolve();
    expect(takePendingOsLink()).toBe("/approvals");
    expect(takePendingOsLink()).toBeNull();
  });
});
