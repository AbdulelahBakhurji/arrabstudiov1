import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  addCompanion,
  addFact,
  boardCards,
  captureWork,
  companionInstructions,
  deleteFact,
  ensureGeneralCompanion,
  forgetEverything,
  generalCompanion,
  getCompanionState,
  setFactShared,
  setWorkState,
  suggestedWork,
  acceptedWork,
  touchThread,
  visibleFacts,
} from "../../apps/desktop/src/lib/companions";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
  forgetEverything();
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop companion flows", () => {
  it("offers General on day one without creating profiles or memories", () => {
    const initial = getCompanionState();
    expect(generalCompanion(initial, "personal")).toMatchObject({
      domain: "general",
      conversationId: null,
    });
    expect(getCompanionState().companions).toHaveLength(0);
    expect(getCompanionState().facts).toHaveLength(0);
  });
  it("reuses the General room and keeps Personal and Work separate", () => {
    const personal = ensureGeneralCompanion("personal");
    expect(ensureGeneralCompanion("personal").id).toBe(personal.id);
    expect(ensureGeneralCompanion("work").id).not.toBe(personal.id);
    expect(getCompanionState().companions).toHaveLength(2);
  });
  it("preserves an existing General conversation when upgrading the layout", () => {
    const existing = addCompanion({ name: "General", domain: "general", space: "personal" });
    expect(ensureGeneralCompanion("personal").id).toBe(existing.id);
    expect(getCompanionState().companions).toHaveLength(1);
  });
  it("shows at most one card per companion and three cards overall", () => {
    for (let personIndex = 0; personIndex < 4; personIndex++) {
      const person = addCompanion({ name: `Person ${personIndex}`, domain: "work" });
      for (let threadIndex = 0; threadIndex < 2; threadIndex++)
        touchThread({
          companionId: person.id,
          title: `${personIndex}-${threadIndex}`,
          summary: "Context",
          open: "A real open question",
          space: "personal",
        });
    }
    const cards = boardCards(getCompanionState(), "personal");
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((card) => card.companionId)).size).toBe(3);
    expect(boardCards(getCompanionState(), "work")).toHaveLength(0);
  });
  it("keeps captured ideas as suggestions until the user accepts them", () => {
    captureWork({
      companionId: null,
      text: "Review the draft",
      capturedFrom: "You",
      space: "work",
    });
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(0);
    const item = suggestedWork(getCompanionState(), "work")[0]!;
    setWorkState(item.id, "accepted");
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(1);
    expect(suggestedWork(getCompanionState(), "work")).toHaveLength(0);
    setWorkState(item.id, "done");
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(0);
  });
  it("updates the remembered fact beneath a face and clears it on deletion", () => {
    const person = addCompanion({ name: "Ivy", domain: "sleep" });
    addFact({ companionId: person.id, text: "Prefers short replies", source: "You" });
    expect(getCompanionState().companions[0]!.lastMemory).toBe("Prefers short replies");
    deleteFact(getCompanionState().facts[0]!.id);
    expect(getCompanionState().companions[0]!.lastMemory).toBeNull();
  });
  it("keeps an unshared memory available only to its owner", () => {
    const owner = addCompanion({ name: "Ivy", domain: "sleep", brief: "Protect sleep and wind-down." });
    const other = addCompanion({ name: "Sam", domain: "money", space: "work" });
    addFact({ companionId: owner.id, text: "Private remembered fact", source: "You" });
    setFactShared(getCompanionState().facts[0]!.id, false);
    const state = getCompanionState();
    expect(visibleFacts(state, other)).toHaveLength(0);
    expect(companionInstructions(owner, visibleFacts(state, owner))).toContain(
      "Private remembered fact",
    );
    expect(companionInstructions(owner, visibleFacts(state, owner))).toContain(
      "Protect sleep and wind-down.",
    );
    expect(companionInstructions(owner, visibleFacts(state, owner))).toContain(
      "WATCHES (your only remit): sleep",
    );
    expect(companionInstructions(other, visibleFacts(state, other))).not.toContain(
      "Private remembered fact",
    );
  });

  it("binds agent instructions to watches, purpose, and connectors", () => {
    const person = addCompanion({
      name: "Mail",
      domain: "inbox",
      brief: "Triage mail and draft replies.",
      connectors: ["gmail", "outlook"],
    });
    const text = companionInstructions(person, []);
    expect(text).toContain("WATCHES (your only remit): inbox");
    expect(text).toContain("PURPOSE (non-negotiable standing brief");
    expect(text).toContain("Triage mail and draft replies.");
    expect(text).toContain("CONNECTORS this companion is configured to use: gmail, outlook");
    expect(text).toContain("Base every answer on WATCHES + PURPOSE");
  });
});
