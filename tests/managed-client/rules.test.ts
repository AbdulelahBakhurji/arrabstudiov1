import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  maintenanceView,
  resolveUpdateMode,
  shouldShowSoftBanner,
  SOFT_REMIND_MS,
  storeUrlFor,
  buildNumberFor,
  formatBackAt,
} from "../../apps/desktop/src/domains/managed/client/updates";
import {
  createCommandRouter,
  createHandledIds,
  type CommandEffects,
} from "../../apps/desktop/src/domains/managed/client/commands";
import { isAllowlistedUrl, parseDeepLink } from "../../apps/desktop/src/domains/managed/client/allowlist";
import {
  applyCompanionPolicy,
  canStartChatWith,
  companionAvailability,
} from "../../apps/desktop/src/domains/managed/client/companions";
import { levelForRatio, limitStatus, serverLimitMessage } from "../../apps/desktop/src/domains/managed/client/limits";
import { createNotificationHandler } from "../../apps/desktop/src/domains/managed/client/notifications";
import {
  parseCompanionPolicy,
  parseMaintenance,
  parseNotification,
  type CompanionPolicy,
} from "../../apps/desktop/src/domains/managed/client/types";

describe("version compare", () => {
  it("uses semver, not string order", () => {
    expect(compareSemver("0.12.10", "0.12.9")).toBe(1);
    expect(compareSemver("0.12.9", "0.12.10")).toBe(-1);
    expect(compareSemver("0.12.1-beta", "0.12.1")).toBe(-1);
    expect(compareSemver("0.12.1", "0.12.1-beta")).toBe(1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    expect(compareSemver("1.0.0+build.5", "1.0.0")).toBe(0);
  });

  it("derives the build number", () => {
    expect(buildNumberFor("0.12.1")).toBe("1201");
    expect(buildNumberFor("0.13.0")).toBe("1300");
  });
});

describe("maintenance modes", () => {
  const base = parseMaintenance({})!;

  it("blocks below minVersion", () => {
    const m = { ...base, minVersion: "0.13.0" };
    expect(resolveUpdateMode("0.12.9", m)).toBe("blocking");
    const view = maintenanceView("0.12.9", m);
    expect(view.sendBlocked).toBe(true);
    expect(view.uploadsBlocked).toBe(true);
  });

  it("is soft when requireUpdate is set at or above the minimum", () => {
    expect(resolveUpdateMode("0.13.0", { ...base, minVersion: "0.13.0", requireUpdate: true })).toBe("soft");
    expect(resolveUpdateMode("0.13.0", { ...base, requireUpdate: true, latestVersion: "0.13.1" })).toBe("soft");
    expect(maintenanceView("0.13.0", { ...base, requireUpdate: true }).sendBlocked).toBe(false);
  });

  it("is soft when only latestVersion is newer, and none when current", () => {
    expect(resolveUpdateMode("0.13.0", { ...base, latestVersion: "0.13.1" })).toBe("soft");
    expect(resolveUpdateMode("0.13.1", { ...base, latestVersion: "0.13.1" })).toBe("none");
    expect(resolveUpdateMode("0.13.1", { ...base, requireUpdate: true, latestVersion: "0.13.1" })).toBe("none");
    expect(resolveUpdateMode("0.13.1", null)).toBe("none");
  });

  it("readOnly disables send and uploads but is not an update", () => {
    const view = maintenanceView("0.13.0", { ...base, readOnly: true });
    expect(view.updateMode).toBe("none");
    expect(view).toMatchObject({ readOnly: true, showMessage: true, sendBlocked: true, uploadsBlocked: true });
  });

  it("force_update with blocking overrides the version check", () => {
    expect(maintenanceView("9.9.9", null, true).updateMode).toBe("blocking");
  });

  it("reminds about a dismissed soft update after 24 h", () => {
    expect(shouldShowSoftBanner(null, 0)).toBe(true);
    expect(shouldShowSoftBanner(1000, 1000 + SOFT_REMIND_MS - 1)).toBe(false);
    expect(shouldShowSoftBanner(1000, 1000 + SOFT_REMIND_MS)).toBe(true);
  });

  it("formats 'Back at' only for a future time", () => {
    const now = Date.parse("2026-09-24T15:00:00Z");
    expect(formatBackAt("2026-09-24T18:30:00Z", "en-GB", now, "Asia/Riyadh")).toBe("21:30");
    expect(formatBackAt("2026-09-24T14:00:00Z", "en-GB", now)).toBeNull();
    expect(formatBackAt(null, "en", now)).toBeNull();
  });

  it("picks the store for the vendor unless downloadUrl is allowlisted", () => {
    expect(storeUrlFor("android", "samsung", null, isAllowlistedUrl)).toContain("galaxystore.samsung.com");
    expect(storeUrlFor("android", "huawei", null, isAllowlistedUrl)).toContain("appgallery.huawei.com");
    expect(storeUrlFor("android", "xiaomi", null, isAllowlistedUrl)).toContain("play.google.com");
    expect(storeUrlFor("ios", "apple", "https://apps.apple.com/app/id1", isAllowlistedUrl)).toBe(
      "https://apps.apple.com/app/id1",
    );
    expect(storeUrlFor("android", "google", "https://evil.example/app.apk", isAllowlistedUrl)).toContain(
      "play.google.com",
    );
  });
});

function effects(overrides: Partial<CommandEffects> = {}): CommandEffects {
  return {
    refreshConfig: vi.fn(),
    showMessage: vi.fn(),
    forceUpdate: vi.fn(),
    openCompanion: vi.fn(() => true),
    openUrl: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    resetDevice: vi.fn(async () => undefined),
    requestLogs: vi.fn(async () => "uploaded" as const),
    ...overrides,
  };
}

const now = Date.parse("2026-09-24T15:00:00Z");
const command = (type: string, payload: Record<string, unknown> = {}, id = `cmd_${type}`) => ({
  id,
  type,
  payload,
  issuedAt: null,
  expiresAt: null,
});

describe("remote commands", () => {
  it("acks an unknown type as ignored and runs nothing", async () => {
    const fx = effects();
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    expect(await route(command("run_shell", { cmd: "rm -rf /" }))).toEqual({
      status: "ignored",
      error: "unknown command",
    });
    for (const fn of Object.values(fx)) expect(fn).not.toHaveBeenCalled();
  });

  it("ignores expired commands", async () => {
    const fx = effects();
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    const result = await route({ ...command("sign_out"), expiresAt: "2026-09-24T14:59:59Z" });
    expect(result?.status).toBe("ignored");
    expect(fx.signOut).not.toHaveBeenCalled();
  });

  it("handles the same id only once", async () => {
    const fx = effects();
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    expect(await route(command("refresh_config"))).toEqual({ status: "done" });
    expect(await route(command("refresh_config"))).toBeNull();
    expect(fx.refreshConfig).toHaveBeenCalledTimes(1);
  });

  it("refuses open_url outside the allowlist", async () => {
    const fx = effects();
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    for (const [i, url] of [
      "https://evil.example.com",
      "http://arrabai.com/plans",
      "https://arrabai.com.evil.io/",
      "javascript:alert(1)",
      "https://user:pw@studio.arrabai.com/",
    ].entries()) {
      expect((await route(command("open_url", { url }, `u${i}`)))?.status).toBe("failed");
    }
    expect(fx.openUrl).not.toHaveBeenCalled();
    expect(await route(command("open_url", { url: "https://studio.arrabai.com/plans" }, "ok"))).toEqual({
      status: "done",
    });
    expect(fx.openUrl).toHaveBeenCalledWith("https://studio.arrabai.com/plans");
  });

  it("only opens enabled companions and asks before uploading logs", async () => {
    const fx = effects({
      openCompanion: vi.fn(() => false),
      requestLogs: vi.fn(async () => "declined" as const),
    });
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    expect((await route(command("open_companion", { companionId: "agt_off" })))?.status).toBe("failed");
    expect(await route(command("request_logs"))).toEqual({ status: "ignored", error: "user declined" });
  });

  it("passes force_update blocking and show_message text through as data", async () => {
    const fx = effects();
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    await route(command("force_update", { blocking: true }));
    await route(command("show_message", { title: { en: "Hi", ar: "أهلا" }, severity: "critical" }));
    expect(fx.forceUpdate).toHaveBeenCalledWith({ blocking: true });
    expect(fx.showMessage).toHaveBeenCalledWith({
      title: { en: "Hi", ar: "أهلا" },
      body: null,
      severity: "critical",
    });
  });

  it("reports an effect failure as failed without throwing", async () => {
    const fx = effects({ clearCache: vi.fn(async () => Promise.reject(new Error("disk"))) });
    const route = createCommandRouter({ effects: fx, handled: createHandledIds(), now: () => now });
    expect(await route(command("clear_cache"))).toEqual({ status: "failed", error: "disk" });
  });

  it("bounds the handled-id memory", () => {
    const ids = createHandledIds([], 2);
    ids.add("a");
    ids.add("b");
    ids.add("c");
    expect(ids.has("a")).toBe(false);
    expect(ids.list()).toEqual(["b", "c"]);
  });
});

describe("deep links", () => {
  it("accepts only the four routes", () => {
    expect(parseDeepLink("arrab://companions/agt_1")).toEqual({ kind: "companion", id: "agt_1" });
    expect(parseDeepLink("arrab://chat/conv_9")).toEqual({ kind: "chat", conversationId: "conv_9" });
    expect(parseDeepLink("arrab://settings/usage")).toEqual({ kind: "usage" });
    expect(parseDeepLink("arrab://update")).toEqual({ kind: "update" });
    expect(parseDeepLink("arrab://settings/account")).toBeNull();
    expect(parseDeepLink("arrab://companions/../../etc")).toBeNull();
    expect(parseDeepLink("https://arrabai.com")).toBeNull();
    expect(parseDeepLink("arrab://link?api=http://evil")).toBeNull();
  });
});

const policy = (value: Record<string, unknown>) => parseCompanionPolicy(value)!;

describe("companion merge", () => {
  const people = [
    { id: "a", agentId: null },
    { id: "b", agentId: "agt_b" },
    { id: "c", agentId: null },
    { id: "d", agentId: null },
    { id: "e", agentId: null },
  ];

  it("hides disabled and invisible companions", () => {
    const policies: CompanionPolicy[] = [
      policy({ id: "a", enabled: false }),
      policy({ id: "agt_b", visible: false }),
    ];
    expect(applyCompanionPolicy(people, policies).map((p) => p.id)).toEqual(["c", "d", "e"]);
  });

  it("sorts pinned first, then by order, then keeps the original order", () => {
    const policies: CompanionPolicy[] = [
      policy({ id: "e", order: 1 }),
      policy({ id: "c", order: 5 }),
      policy({ id: "d", pinned: true, order: 99 }),
    ];
    expect(applyCompanionPolicy(people, policies).map((p) => p.id)).toEqual(["d", "e", "c", "a", "b"]);
  });

  it("returns the list unchanged without policies", () => {
    expect(applyCompanionPolicy(people, []).map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("disabling mid-chat blocks new sends but keeps the conversation readable", () => {
    const active = { id: "b", agentId: "agt_b" };
    const before = companionAvailability(active, []);
    expect(before.enabled).toBe(true);
    const after = companionAvailability(active, [policy({ id: "agt_b", enabled: false, maintenance: "Back soon" })]);
    expect(after).toMatchObject({ enabled: false, maintenance: "Back soon" });
    expect(canStartChatWith(active, [policy({ id: "agt_b", enabled: false })])).toBe(false);
    // Hidden only: still allowed to chat in the open conversation.
    expect(canStartChatWith(active, [policy({ id: "b", visible: false })])).toBe(true);
    expect(companionAvailability(null, [])).toMatchObject({ enabled: true });
  });

  it("carries badges", () => {
    expect(companionAvailability({ id: "a" }, [policy({ id: "a", badge: "beta" })]).badge).toBe("beta");
    expect(parseCompanionPolicy({ id: "a", badge: "hot" })?.badge).toBeNull();
  });
});

describe("limits", () => {
  const limits = (messagesUsedToday: number, tokensUsedThisMonth = 0) => ({
    plan: "pro",
    messagesPerDay: 100,
    messagesUsedToday,
    tokensPerMonth: 1000,
    tokensUsedThisMonth,
    maxAttachmentsMb: 20,
    maxCompanions: 10,
    resetsAt: "2026-09-25T00:00:00Z",
  });

  it("warns at 80% and 95%, blocks at 100%", () => {
    expect(limitStatus(limits(79)).level).toBe("ok");
    expect(limitStatus(limits(80)).level).toBe("warn80");
    expect(limitStatus(limits(95)).level).toBe("warn95");
    expect(limitStatus(limits(100)).level).toBe("blocked");
    expect(limitStatus(limits(10, 1000)).level).toBe("blocked");
    expect(limitStatus(limits(10, 1000)).worst?.key).toBe("tokens");
    expect(levelForRatio(0.949)).toBe("warn80");
  });

  it("is ok without limits or with unlimited fields", () => {
    expect(limitStatus(null).level).toBe("ok");
    expect(limitStatus({ ...limits(0), messagesPerDay: null, tokensPerMonth: null }).meters).toEqual([]);
  });

  it("shows the server's own 402/429 message", () => {
    expect(serverLimitMessage({ status: 402, message: "Daily limit reached. Resets at midnight." })).toBe(
      "Daily limit reached. Resets at midnight.",
    );
    expect(serverLimitMessage({ status: 429, message: "Slow down" })).toBe("Slow down");
    expect(serverLimitMessage({ status: 500, message: "boom" })).toBeNull();
    expect(serverLimitMessage(new Error("x"))).toBeNull();
  });
});

describe("notifications", () => {
  it("delivers once, respects channels, skips expired, and acks delivered", async () => {
    const inApp: string[] = [];
    const native: string[] = [];
    const acks: string[] = [];
    const handle = createNotificationHandler({
      handled: createHandledIds(),
      channelPrefs: () => ({ general: true, updates: false, security: true, companions: true }),
      deliverInApp: (n) => inApp.push(n.id),
      deliverNative: (n) => {
        native.push(n.id);
      },
      ack: (id, action) => acks.push(`${id}:${action}`),
      now: () => now,
    });
    const notice = (id: string, extra: Record<string, unknown> = {}) =>
      parseNotification({ id, title: { en: "t", ar: "ع" }, native: true, ...extra })!;

    expect(await handle(notice("n1"))).toBe(true);
    expect(await handle(notice("n1"))).toBe(false);
    await handle(notice("n2", { kind: "update" }));
    await handle(notice("n3", { expiresAt: "2026-09-24T14:00:00Z" }));
    await handle(notice("n4", { inApp: false, native: false }));
    expect(inApp).toEqual(["n1", "n2"]);
    expect(native).toEqual(["n1"]);
    expect(acks).toEqual(["n1:delivered", "n2:delivered", "n4:delivered"]);
  });
});

describe("allowlist", () => {
  it("allows arrabai.com subdomains and the stores only, over https", () => {
    for (const url of [
      "https://arrabai.com",
      "https://studio.arrabai.com/plans",
      "https://apps.apple.com/app/id1",
      "https://play.google.com/store",
      "https://appgallery.huawei.com/app/C1",
      "https://galaxystore.samsung.com/detail/x",
    ]) {
      expect(isAllowlistedUrl(url)).toBe(true);
    }
    for (const url of ["https://notarrabai.com", "https://arrabai.com.evil.io", "http://arrabai.com", 42, "ftp://arrabai.com"]) {
      expect(isAllowlistedUrl(url)).toBe(false);
    }
  });
});
