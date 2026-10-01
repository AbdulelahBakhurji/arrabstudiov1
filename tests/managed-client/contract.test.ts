import { describe, expect, it } from "vitest";
import {
  localized,
  parseSyncResponse,
  parseSyncResponseText,
  type SyncRequest,
} from "../../apps/desktop/src/lib/managed-client/types";
import { createSseParser, toLiveEvent } from "../../apps/desktop/src/lib/managed-client/events";

const exampleResponse = {
  serverTime: "2026-09-24T15:00:00Z",
  pollAfterSec: 60,
  maintenance: {
    message: { en: "Please update Arrab Studio", ar: "يرجى تحديث عرب ستوديو" },
    severity: "info",
    requireUpdate: true,
    minVersion: "0.12.1",
    latestVersion: "0.12.2",
    downloadUrl: "https://studio.arrabai.com/releases/arrab.dmg",
    readOnly: false,
    until: null,
  },
  config: {
    version: "etag",
    companions: [
      { id: "agt_1", enabled: true, visible: true, pinned: false, order: 10, badge: "new", maintenance: null },
    ],
    limits: {
      plan: "pro",
      messagesPerDay: 500,
      messagesUsedToday: 42,
      tokensPerMonth: 2000000,
      tokensUsedThisMonth: 150000,
      maxAttachmentsMb: 20,
      maxCompanions: 10,
      resetsAt: "2026-09-25T00:00:00Z",
    },
    features: { voice: true, family: true, work: false, menuBarAsk: true },
  },
  notifications: [
    {
      id: "ntf_1",
      title: { en: "Hello", ar: "مرحبا" },
      body: { en: "Body", ar: "نص" },
      kind: "info",
      deepLink: "arrab://companions/agt_1",
      native: true,
      inApp: true,
      expiresAt: "2026-10-01T00:00:00Z",
    },
  ],
  commands: [
    { id: "cmd_1", type: "refresh_config", payload: {}, issuedAt: "2026-09-24T15:00:00Z", expiresAt: "2026-09-24T16:00:00Z" },
  ],
};

describe("managed-client contract", () => {
  it("parses the example response exactly", () => {
    const parsed = parseSyncResponse(exampleResponse);
    expect(parsed.pollAfterSec).toBe(60);
    expect(parsed.maintenance).toEqual(exampleResponse.maintenance);
    expect(parsed.config?.version).toBe("etag");
    expect(parsed.config?.companions[0]).toEqual(exampleResponse.config.companions[0]);
    expect(parsed.config?.limits).toEqual(exampleResponse.config.limits);
    expect(parsed.config?.features).toEqual(exampleResponse.config.features);
    expect(parsed.notifications[0]).toEqual(exampleResponse.notifications[0]);
    expect(parsed.commands[0]).toEqual(exampleResponse.commands[0]);
  });

  it("treats every top-level field as optional", () => {
    const parsed = parseSyncResponse({});
    expect(parsed).toEqual({
      serverTime: null,
      pollAfterSec: null,
      maintenance: null,
      config: null,
      notifications: [],
      commands: [],
    });
    expect(parseSyncResponseText("not json").config).toBeNull();
    expect(parseSyncResponseText("").commands).toEqual([]);
  });

  it("ignores unknown fields and skips malformed items", () => {
    const parsed = parseSyncResponse({
      ...exampleResponse,
      somethingNew: { nested: true },
      maintenance: { ...exampleResponse.maintenance, extra: 1, severity: "apocalyptic" },
      notifications: [{ id: "ntf_bad" }, exampleResponse.notifications[0], "junk"],
      commands: [{ type: "sign_out" }, { id: "cmd_2", type: "brand_new_type", payload: "x" }],
      config: { companions: [{ enabled: false }, { id: "agt_2", unknown: "x" }] },
    });
    expect(parsed.maintenance?.severity).toBe("info");
    expect(parsed.maintenance).not.toHaveProperty("extra");
    expect(parsed.notifications.map((n) => n.id)).toEqual(["ntf_1"]);
    expect(parsed.commands).toEqual([
      { id: "cmd_2", type: "brand_new_type", payload: {}, issuedAt: null, expiresAt: null },
    ]);
    expect(parsed.config?.companions).toEqual([
      { id: "agt_2", enabled: true, visible: true, pinned: false, order: null, badge: null, maintenance: null },
    ]);
    expect(parsed.config?.limits).toBeNull();
  });

  it("serialises the example request with the contract field names", () => {
    const request: SyncRequest = {
      deviceId: "3f0f6a7e-8b1d-4c1e-9a55-2d1f5b7c9e10",
      platform: "macos",
      vendor: "apple",
      osVersion: "15.1",
      appVersion: "0.12.1",
      build: "1201",
      channel: "stable",
      locale: "ar-SA",
      timezone: "Asia/Riyadh",
      pushProvider: "none",
      pushToken: null,
      capabilities: ["local_notifications", "auto_update", "menu_bar"],
      state: "foreground",
      activeScreen: "chat",
      activeCompanionId: "agt_1",
      configVersion: null,
      ackedCommandIds: ["cmd_1"],
      ackedNotificationIds: ["ntf_1"],
    };
    expect(Object.keys(JSON.parse(JSON.stringify(request))).sort()).toEqual(
      [
        "deviceId", "platform", "vendor", "osVersion", "appVersion", "build", "channel", "locale",
        "timezone", "pushProvider", "pushToken", "capabilities", "state", "activeScreen",
        "activeCompanionId", "configVersion", "ackedCommandIds", "ackedNotificationIds",
      ].sort(),
    );
  });

  it("picks the language and falls back when one side is missing", () => {
    const parsed = parseSyncResponse({
      notifications: [{ id: "n", title: { en: "Only English" } }],
    });
    expect(localized(parsed.notifications[0]!.title, "ar")).toBe("Only English");
    expect(localized({ en: "Hi", ar: "أهلا" }, "ar-SA")).toBe("أهلا");
  });

  it("parses split SSE chunks into live events", () => {
    const events: Array<string> = [];
    const parser = createSseParser((event, data) => {
      const live = toLiveEvent(event, data);
      if (live) events.push(live.type);
    });
    parser.push("event: ping\ndata: {}\n\nevent: comm");
    parser.push('and\r\ndata: {"id":"cmd_9","type":"refresh_config"}\r\n\r\n');
    parser.push(": keep-alive\n\nevent: config\ndata: not-json\n\n");
    expect(events).toEqual(["ping", "command"]);
  });
});
