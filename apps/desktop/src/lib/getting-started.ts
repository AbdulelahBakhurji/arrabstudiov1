import { hasLocalModelSelected } from "./ai-prefs";
import { readPrefs, updatePrefs, subscribePrefs } from "./prefs";
import { getCompanionState, liveCompanions } from "./companions";
import { ensureNotificationPermission } from "./notify";

export const GETTING_STARTED_KEY = "arrab.gettingStarted";
export const GETTING_STARTED_EVENT = "arrab:getting-started";
export const OPEN_ADD_COMPANION_KEY = "arrab.companions.openAdd";
/** Prefill catalog “Add for” seat when opening add-companion from Board. */
export const OPEN_ASSIGN_MEMBER_KEY = "arrab.companions.assignMemberId";

export type GettingStartedStepId =
  | "notifications"
  | "first_person"
  | "gmail"
  | "linear"
  | "local_model"
  | "goal";

export type GettingStartedAudience = "individual" | "organization";

export type GettingStartedState = {
  /** Legacy flag — also treated as collapsed. */
  dismissed: boolean;
  /** When true, only the Help button shows; yellow box is tucked away. */
  collapsed: boolean;
  completed: Partial<Record<GettingStartedStepId, boolean>>;
};

type ConnectorLike = { provider: string; status: string };

const defaultState = (): GettingStartedState => ({
  dismissed: false,
  collapsed: false,
  completed: {},
});

export function readGettingStarted(): GettingStartedState {
  try {
    const raw = JSON.parse(localStorage.getItem(GETTING_STARTED_KEY) ?? "{}") as Partial<GettingStartedState>;
    const dismissed = Boolean(raw.dismissed);
    return {
      dismissed,
      collapsed: raw.collapsed != null ? Boolean(raw.collapsed) : dismissed,
      completed: raw.completed ?? {},
    };
  } catch {
    return defaultState();
  }
}

export function writeGettingStarted(next: GettingStartedState): void {
  localStorage.setItem(GETTING_STARTED_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(GETTING_STARTED_EVENT, { detail: next }));
}

export function dismissGettingStarted(): void {
  writeGettingStarted({ ...readGettingStarted(), dismissed: true, collapsed: true });
}

export function setGettingStartedCollapsed(collapsed: boolean): void {
  const current = readGettingStarted();
  writeGettingStarted({
    ...current,
    collapsed,
    dismissed: collapsed ? current.dismissed : false,
  });
}

export function openGettingStarted(): void {
  writeGettingStarted({ ...readGettingStarted(), collapsed: false, dismissed: false });
}

export function isGettingStartedCollapsed(): boolean {
  return readGettingStarted().collapsed;
}

export function markGettingStartedStep(id: GettingStartedStepId, done = true): void {
  const current = readGettingStarted();
  writeGettingStarted({
    ...current,
    completed: { ...current.completed, [id]: done },
  });
}

export function subscribeGettingStarted(listener: (state: GettingStartedState) => void): () => void {
  const onCustom = (event: Event) => {
    listener((event as CustomEvent<GettingStartedState>).detail ?? readGettingStarted());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === GETTING_STARTED_KEY) listener(readGettingStarted());
  };
  window.addEventListener(GETTING_STARTED_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  const unsubPrefs = subscribePrefs(() => listener(readGettingStarted()));
  return () => {
    window.removeEventListener(GETTING_STARTED_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
    unsubPrefs();
  };
}

export function hasSpecialistCompanion(): boolean {
  const state = getCompanionState();
  return (
    liveCompanions(state, "personal").some((person) => person.domain !== "general") ||
    liveCompanions(state, "work").some((person) => person.domain !== "general")
  );
}

export function hasCompanionPurpose(): boolean {
  const state = getCompanionState();
  return [...liveCompanions(state, "personal"), ...liveCompanions(state, "work")].some(
    (person) => person.domain !== "general" && Boolean(person.brief?.trim()),
  );
}

export function hasStudioGoal(): boolean {
  try {
    return Boolean(localStorage.getItem("arrab.studioGoal")?.trim());
  } catch {
    return false;
  }
}

export function resolveGettingStartedDone(input: {
  stepId: GettingStartedStepId;
  audience: GettingStartedAudience;
  connectors?: ConnectorLike[];
  agentCount?: number;
}): boolean {
  const manual = readGettingStarted().completed[input.stepId];
  if (manual) return true;

  switch (input.stepId) {
    case "notifications":
      return (
        readPrefs().notifyApprovals &&
        (typeof Notification === "undefined" || Notification.permission === "granted")
      );
    case "first_person":
      return input.audience === "individual"
        ? hasSpecialistCompanion()
        : (input.agentCount ?? 0) > 0;
    case "gmail":
      return (input.connectors ?? []).some(
        (item) =>
          (item.provider === "gmail" ||
            item.provider === "outlook" ||
            item.provider === "email") &&
          item.status === "connected",
      );
    case "linear":
      return (input.connectors ?? []).some(
        (item) =>
          (item.provider === "linear" || item.provider === "github") &&
          item.status === "connected",
      );
    case "local_model":
      return hasLocalModelSelected();
    case "goal":
      return input.audience === "individual" ? hasCompanionPurpose() || hasStudioGoal() : hasStudioGoal();
    default:
      return false;
  }
}

export async function enableGettingStartedNotifications(): Promise<void> {
  updatePrefs({
    notifyApprovals: true,
    notifyTeamLaunch: true,
    notifyConnector: true,
  });
  await ensureNotificationPermission();
  markGettingStartedStep("notifications", true);
}
