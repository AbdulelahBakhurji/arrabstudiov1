type RoomIdentity = { id: string; domain: string; space: string };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const DRAFT_PREFIX = "arrab.companion.draft.v1:";

/** A general room keeps its draft when its backing companion is created. */
export function companionRoomKey(room: RoomIdentity): string {
  return room.domain === "general" ? `general-${room.space}` : room.id;
}

function sessionDraftStorage(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Session-only persistence; blocked/full storage still allows editing in memory. */
export function createCompanionDraftStore(storage = sessionDraftStorage()) {
  const drafts = new Map<string, string>();
  return {
    read(roomKey: string): string {
      if (drafts.has(roomKey)) return drafts.get(roomKey)!;
      let text = "";
      try {
        text = storage?.getItem(DRAFT_PREFIX + roomKey) ?? "";
      } catch {
        // Private browsing or storage access restrictions must not block the composer.
      }
      drafts.set(roomKey, text);
      return text;
    },
    write(roomKey: string, text: string): void {
      drafts.set(roomKey, text);
      try {
        if (text) storage?.setItem(DRAFT_PREFIX + roomKey, text);
        else storage?.removeItem(DRAFT_PREFIX + roomKey);
      } catch {
        // Preserve the current draft in memory when storage is unavailable/full.
      }
    },
  };
}
