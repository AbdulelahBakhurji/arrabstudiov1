import { dismissGettingStarted, markGettingStartedStep } from "./getting-started";

export const FIRST_LAUNCH_KEY = "arrab.firstLaunchSetup.v3";
export const FIRST_LAUNCH_EVENT = "arrab:first-launch-setup";

/** Older keys — if any were already completed, skip the wizard forever. */
const LEGACY_FIRST_LAUNCH_KEYS = [
  "arrab.firstLaunchSetup.v2",
  "arrab.firstLaunchSetup",
] as const;

export type FirstLaunchStep = "welcome" | "connector" | "companion" | "ready";

export type FirstLaunchSetupState = {
  /** User finished the wizard (or was grandfathered). */
  completed: boolean;
  /** Current step while the wizard is open. */
  step: FirstLaunchStep;
  /** Connector step finished (connected or skipped). */
  connectorDone: boolean;
  /** Companion step finished. */
  companionDone: boolean;
};

const defaultState = (): FirstLaunchSetupState => ({
  completed: false,
  step: "welcome",
  connectorDone: false,
  companionDone: false,
});

const completedState = (): FirstLaunchSetupState => ({
  completed: true,
  step: "ready",
  connectorDone: true,
  companionDone: true,
});

function parseSetup(raw: string | null): Partial<FirstLaunchSetupState> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<FirstLaunchSetupState>;
  } catch {
    return null;
  }
}

export function readFirstLaunchSetup(): FirstLaunchSetupState {
  try {
    const current = parseSetup(localStorage.getItem(FIRST_LAUNCH_KEY));
    if (current && Object.keys(current).length > 0) {
      return {
        ...defaultState(),
        ...current,
        step: current.step ?? "welcome",
      };
    }
    // First install only — honor setup already finished under an older key.
    for (const key of LEGACY_FIRST_LAUNCH_KEYS) {
      const legacy = parseSetup(localStorage.getItem(key));
      if (legacy?.completed) {
        const next = completedState();
        localStorage.setItem(FIRST_LAUNCH_KEY, JSON.stringify(next));
        return next;
      }
    }
    return defaultState();
  } catch {
    return defaultState();
  }
}

export function writeFirstLaunchSetup(next: FirstLaunchSetupState): void {
  localStorage.setItem(FIRST_LAUNCH_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(FIRST_LAUNCH_EVENT, { detail: next }));
}

export function updateFirstLaunchSetup(patch: Partial<FirstLaunchSetupState>): FirstLaunchSetupState {
  const next = { ...readFirstLaunchSetup(), ...patch };
  writeFirstLaunchSetup(next);
  return next;
}

export function subscribeFirstLaunchSetup(listener: (state: FirstLaunchSetupState) => void): () => void {
  const onCustom = (event: Event) => {
    listener((event as CustomEvent<FirstLaunchSetupState>).detail ?? readFirstLaunchSetup());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === FIRST_LAUNCH_KEY) listener(readFirstLaunchSetup());
  };
  window.addEventListener(FIRST_LAUNCH_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(FIRST_LAUNCH_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function completeFirstLaunchSetup(): void {
  writeFirstLaunchSetup({
    completed: true,
    step: "ready",
    connectorDone: true,
    companionDone: true,
  });
  markGettingStartedStep("first_person", true);
  markGettingStartedStep("gmail", true);
  dismissGettingStarted();
}

/** True only until the user finishes the first-install wizard once. */
export function shouldShowFirstLaunchSetup(): boolean {
  return !readFirstLaunchSetup().completed;
}

export function resetFirstLaunchSetup(): void {
  writeFirstLaunchSetup(defaultState());
}
