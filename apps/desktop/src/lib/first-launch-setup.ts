import { hasSpecialistCompanion, dismissGettingStarted, markGettingStartedStep } from "./getting-started";

export const FIRST_LAUNCH_KEY = "arrab.firstLaunchSetup";
export const FIRST_LAUNCH_EVENT = "arrab:first-launch-setup";

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

export function readFirstLaunchSetup(): FirstLaunchSetupState {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRST_LAUNCH_KEY) ?? "{}") as Partial<FirstLaunchSetupState>;
    return {
      ...defaultState(),
      ...raw,
      step: raw.step ?? "welcome",
    };
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

/** Existing users who already have a companion skip the wizard once. */
export function shouldShowFirstLaunchSetup(hasConnectedConnector: boolean): boolean {
  const state = readFirstLaunchSetup();
  if (state.completed) return false;

  const hasCompanion = hasSpecialistCompanion();
  if (hasCompanion && (hasConnectedConnector || state.connectorDone)) {
    completeFirstLaunchSetup();
    return false;
  }
  if (hasCompanion && !state.companionDone) {
    updateFirstLaunchSetup({ companionDone: true });
  }
  return true;
}

export function resetFirstLaunchSetup(): void {
  writeFirstLaunchSetup(defaultState());
}
