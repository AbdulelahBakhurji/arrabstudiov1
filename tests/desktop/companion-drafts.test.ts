import { describe, expect, it } from "vitest";
import {
  companionRoomKey,
  createCompanionDraftStore,
} from "../../apps/desktop/src/lib/companion-drafts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("companion drafts", () => {
  it("keeps personal, work and individual drafts separate across remount/reload", () => {
    const storage = memoryStorage();
    const drafts = createCompanionDraftStore(storage);
    drafts.write("general-personal", "  شخصي لم يكتمل\n");
    drafts.write("general-work", "تقرير العمل");
    drafts.write("companion-1", "سؤال خاص");
    const reloaded = createCompanionDraftStore(storage);
    expect(reloaded.read("general-personal")).toBe("  شخصي لم يكتمل\n");
    expect(reloaded.read("general-work")).toBe("تقرير العمل");
    expect(reloaded.read("companion-1")).toBe("سؤال خاص");
    expect(reloaded.read("companion-2")).toBe("");
  });

  it("preserves a general-room draft when the real companion id appears", () => {
    const before = companionRoomKey({ id: "placeholder", domain: "general", space: "personal" });
    const after = companionRoomKey({ id: "created-123", domain: "general", space: "personal" });
    expect(before).toBe(after);
    expect(companionRoomKey({ id: "created-123", domain: "sleep", space: "personal" })).toBe(
      "created-123",
    );
  });

  it("removes the consumed draft without removing a later draft or another room", () => {
    const storage = memoryStorage();
    const drafts = createCompanionDraftStore(storage);
    drafts.write("general-personal", "sent text");
    drafts.write("general-work", "keep this");
    drafts.write("general-personal", "");
    expect(createCompanionDraftStore(storage).read("general-personal")).toBe("");
    drafts.write("general-personal", "next message while waiting");
    expect(createCompanionDraftStore(storage).read("general-personal")).toBe(
      "next message while waiting",
    );
    expect(drafts.read("general-work")).toBe("keep this");
  });

  it("keeps editing possible when sessionStorage is blocked or full", () => {
    const unavailable = () => {
      throw new Error("Storage blocked");
    };
    const drafts = createCompanionDraftStore({
      getItem: unavailable,
      setItem: unavailable,
      removeItem: unavailable,
    });
    expect(drafts.read("room")).toBe("");
    expect(() => drafts.write("room", "saved in memory")).not.toThrow();
    expect(drafts.read("room")).toBe("saved in memory");
    drafts.write("room", "");
    expect(drafts.read("room")).toBe("");
  });
});
