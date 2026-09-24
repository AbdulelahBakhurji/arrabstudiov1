import { dismissGettingStarted, markGettingStartedStep } from "./getting-started";

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

/** First open always runs the wizard until the user finishes it, then sign-in. */
export function shouldShowFirstLaunchSetup(): boolean {
  return !readFirstLaunchSetup().completed;
}

export function resetFirstLaunchSetup(): void {
  writeFirstLaunchSetup(defaultState());
}
