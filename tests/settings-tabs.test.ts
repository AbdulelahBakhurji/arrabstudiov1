import { describe, expect, it } from "vitest";
import { settingsTabsFor, SETTINGS_TAB_IDS, isSettingsTabId } from "../apps/desktop/src/features/settings-tabs.ts";

describe("settings tabs registry", () => {
  it("exposes stable tab ids", () => {
    expect(SETTINGS_TAB_IDS).toContain("usage");
    expect(SETTINGS_TAB_IDS).toContain("family");
    expect(SETTINGS_TAB_IDS).toContain("connection");
    expect(isSettingsTabId("usage")).toBe(true);
    expect(isSettingsTabId("connection")).toBe(true);
    expect(isSettingsTabId("nope")).toBe(false);
  });

  it("hides family tab from individuals and org", () => {
    expect(settingsTabsFor({ audience: "individual" }).map((t) => t.id)).not.toContain("family");
    expect(settingsTabsFor({ audience: "organization" }).map((t) => t.id)).not.toContain("family");
    expect(settingsTabsFor({ audience: "family" }).map((t) => t.id)).toContain("family");
  });

  it("hides family tab from family children", () => {
    expect(
      settingsTabsFor({ audience: "family", isFamilyChild: true }).map((t) => t.id),
    ).not.toContain("family");
  });

  it("hides cowork from individuals", () => {
    expect(settingsTabsFor({ audience: "individual" }).map((t) => t.id)).not.toContain("cowork");
    expect(settingsTabsFor({ audience: "organization" }).map((t) => t.id)).toContain("cowork");
  });
});
