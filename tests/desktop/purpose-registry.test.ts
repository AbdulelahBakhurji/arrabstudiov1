import { describe, expect, it, beforeEach } from "vitest";
import {
  PURPOSE_REGISTRY,
  resolvePurposeIdFromDomain,
  tasksForPurpose,
  playbookText,
} from "../../apps/desktop/src/lib/purpose-registry";
import { COMPANION_PRESETS } from "../../apps/desktop/src/lib/companion-catalog";

describe("purpose registry (Master Blueprint)", () => {
  it("registers every studio and chat purpose with templates and playbook", () => {
    expect(PURPOSE_REGISTRY.length).toBeGreaterThan(10);
    for (const purpose of PURPOSE_REGISTRY) {
      expect(purpose.id).toBeTruthy();
      expect(purpose.playbookKey).toBeTruthy();
      expect(Array.isArray(purpose.taskTemplates)).toBe(true);
      expect(playbookText(purpose.playbookKey)).toBeTruthy();
    }
  });

  it("maps domains to purpose ids", () => {
    expect(resolvePurposeIdFromDomain("ui-designer")).toBe("web-design");
    expect(resolvePurposeIdFromDomain("brand")).toBe("brand-identity");
    expect(resolvePurposeIdFromDomain("arrab-assistant")).toBe("arrab-assistant");
    expect(resolvePurposeIdFromDomain("phone-design-foo")).toBe("phone-design");
    expect(resolvePurposeIdFromDomain("mystery-agent")).toBe("custom");
    expect(resolvePurposeIdFromDomain("health")).toBe("health");
    expect(resolvePurposeIdFromDomain("ivy")).toBe("health");
    expect(resolvePurposeIdFromDomain("relationships")).toBe("relationships");
    expect(resolvePurposeIdFromDomain("parents")).toBe("parents");
    expect(resolvePurposeIdFromDomain("career")).toBe("career");
    expect(resolvePurposeIdFromDomain("meetings")).toBe("meetings");
    expect(resolvePurposeIdFromDomain("decision-guard")).toBe("decision-guard");
  });

  it("binds every chat preset to a registry purpose", () => {
    for (const preset of COMPANION_PRESETS) {
      expect(preset.purposeId).toBeTruthy();
      expect(PURPOSE_REGISTRY.some((item) => item.id === preset.purposeId)).toBe(true);
      expect(tasksForPurpose(preset.purposeId).length).toBeGreaterThan(0);
    }
  });

  it("gives Arrab Assistant concrete purpose tasks", () => {
    const tasks = tasksForPurpose("arrab-assistant");
    expect(tasks.map((item) => item.id)).toContain("aa-connect-folder");
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });
});
