import type { Task } from "@arrab/shared";

export const WORKPLACE_TASK_KEY = "arrab.workplace.task";
export const WORKPLACE_OPEN_KIND_KEY = "arrab.workplace.openKind";

/** Prefer Arrab Assistant when opening Workplace from HQ / Workforce. */
export const WORKPLACE_DEFAULT_KIND = "arrab-assistant";

/** Open Organization Workplace (Studios) with an optional companion + HQ task. */
export function prepareWorkplaceStudio(input?: {
  kindId?: string;
  agentId?: string;
  task?: Pick<Task, "id" | "title" | "brief"> | null;
}) {
  const kindId = input?.kindId?.trim() || WORKPLACE_DEFAULT_KIND;
  sessionStorage.setItem(WORKPLACE_OPEN_KIND_KEY, kindId);
  if (input?.agentId) {
    sessionStorage.setItem("arrab.chatAgent", input.agentId);
  }
  if (input?.task) {
    const payload = JSON.stringify({
      id: input.task.id,
      title: input.task.title,
      brief: input.task.brief,
    });
    sessionStorage.setItem(WORKPLACE_TASK_KEY, payload);
    sessionStorage.setItem("arrab.chatTask", payload);
  }
}

/** @deprecated use prepareWorkplaceStudio */
export function prepareWorkplaceDesk(
  agentId: string,
  task?: Pick<Task, "id" | "title" | "brief"> | null,
) {
  prepareWorkplaceStudio({ agentId, task, kindId: WORKPLACE_DEFAULT_KIND });
}
