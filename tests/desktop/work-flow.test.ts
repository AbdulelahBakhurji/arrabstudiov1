import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptedWork,
  addWorkTask,
  captureWork,
  forgetEverything,
  getCompanionState,
  setThreadArchived,
  setWorkState,
  suggestedWork,
  touchThread,
} from "../../apps/desktop/src/lib/companions";
import { resolveWorkTarget, workDestination } from "../../apps/desktop/src/lib/work-navigation";

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

const input = { companionId: null, text: "Review proposal", capturedFrom: "You", space: "work" as const };

describe("adding tasks and saving ideas", () => {
  it("adds an explicit task immediately without an invented schedule", () => {
    const item = addWorkTask(input);
    expect(item).toMatchObject({ text: input.text, state: "accepted", suggestedTime: null });
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(1);
    expect(suggestedWork(getCompanionState(), "work")).toHaveLength(0);
  });

  it("leaves automatic captures and saved ideas pending a decision", () => {
    const item = captureWork(input);
    expect(item?.state).toBe("suggested");
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(0);
    expect(suggestedWork(getCompanionState(), "work")).toHaveLength(1);
  });

  it("accepts a matching suggestion on explicit add without creating a duplicate", () => {
    const idea = captureWork(input)!;
    const task = addWorkTask({ ...input, text: "  REVIEW PROPOSAL  " })!;
    expect(task.id).toBe(idea.id);
    expect(task.state).toBe("accepted");
    expect(getCompanionState().work).toHaveLength(1);
    expect(suggestedWork(getCompanionState(), "work")).toHaveLength(0);
  });

  it("keeps identical items independent across Personal and Work", () => {
    const personal = captureWork({ ...input, space: "personal" })!;
    const work = captureWork(input)!;
    addWorkTask(input);
    expect(personal.id).not.toBe(work.id);
    expect(suggestedWork(getCompanionState(), "personal")[0]?.id).toBe(personal.id);
    expect(acceptedWork(getCompanionState(), "work")[0]?.id).toBe(work.id);
  });

  it("reuses an active task and allows a completed task to be added again", () => {
    const first = addWorkTask(input)!;
    expect(addWorkTask(input)?.id).toBe(first.id);
    expect(captureWork(input)?.state).toBe("accepted");
    setWorkState(first.id, "done");
    const repeated = addWorkTask(input)!;
    expect(repeated.id).not.toBe(first.id);
    expect(getCompanionState().work.find((item) => item.id === first.id)?.state).toBe("done");
    expect(acceptedWork(getCompanionState(), "work")).toHaveLength(1);
  });

  it("does not save empty tasks or ideas", () => {
    expect(addWorkTask({ ...input, text: "  " })).toBeNull();
    expect(captureWork({ ...input, text: "\n" })).toBeNull();
    expect(getCompanionState().work).toHaveLength(0);
  });
});

describe("exact board destinations", () => {
  it("retains the task identity and space after completion", () => {
    const task = addWorkTask(input)!;
    setWorkState(task.id, "done");
    const destination = new URL(workDestination({ workId: task.id, threadId: null, space: "work" }), "https://example.test");
    expect(destination.pathname).toBe("/work");
    expect(destination.searchParams.get("space")).toBe("work");
    expect(resolveWorkTarget(getCompanionState(), destination.searchParams)).toMatchObject({
      kind: "work", item: { id: task.id, state: "done", space: "work" },
    });
  });

  it("resolves an archived thread and preserves same-title threads in each space", () => {
    touchThread({ ...input, title: "Website launch", summary: "Work context" });
    const workThread = getCompanionState().threads[0]!;
    touchThread({ companionId: null, title: "Website launch", summary: "Personal context", space: "personal" });
    setThreadArchived(workThread.id, true);
    const state = getCompanionState();
    expect(state.threads).toHaveLength(2);
    expect(state.threads.find((thread) => thread.id === workThread.id)?.summary).toBe("Work context");
    const destination = new URL(workDestination({ workId: null, threadId: workThread.id, space: "work" }), "https://example.test");
    expect(destination.searchParams.get("view")).toBe("threads");
    expect(resolveWorkTarget(state, destination.searchParams)).toMatchObject({
      kind: "thread", item: { id: workThread.id, archived: true, space: "work" },
    });
  });

  it("reports a missing target without selecting an unrelated item", () => {
    addWorkTask(input);
    expect(resolveWorkTarget(getCompanionState(), new URLSearchParams("item=removed"))).toBeNull();
    expect(resolveWorkTarget(getCompanionState(), new URLSearchParams())).toBeNull();
  });
});
