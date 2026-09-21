import type { BoardCard, CompanionState, CompanionThread, WorkItem } from "./companions";

/** Carry the item identity and space so a board action opens the exact context. */
export function workDestination(card: Pick<BoardCard, "workId" | "threadId" | "space">): string {
  const params = new URLSearchParams({ space: card.space });
  if (card.threadId) {
    params.set("view", "threads");
    params.set("item", card.threadId);
  } else if (card.workId) {
    params.set("item", card.workId);
  }
  return `/work?${params.toString()}`;
}

type WorkTarget = { kind: "work"; item: WorkItem } | { kind: "thread"; item: CompanionThread };

/** Include completed tasks and archived threads; old links must remain usable. */
export function resolveWorkTarget(
  state: CompanionState,
  params: URLSearchParams,
): WorkTarget | null {
  const id = params.get("item");
  if (!id) return null;
  if (params.get("view") === "threads") {
    const item = state.threads.find((thread) => thread.id === id);
    return item ? { kind: "thread", item } : null;
  }
  const item = state.work.find((work) => work.id === id);
  return item ? { kind: "work", item } : null;
}
