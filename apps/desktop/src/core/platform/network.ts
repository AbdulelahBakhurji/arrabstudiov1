/**
 * Connectivity as the UI should understand it. This module owns only what the device can know
 * (`online` / `offline`); the sync engine layers `connecting`, `syncing` and `sync-error` on top
 * (see `@arrab/shared` sync status).
 */
export type NetworkState = "online" | "offline";

type Listener = (state: NetworkState) => void;

const listeners = new Set<Listener>();
let state: NetworkState =
  typeof navigator === "undefined" || navigator.onLine !== false ? "online" : "offline";
let attached = false;

function set(next: NetworkState): void {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener(state);
}

function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("online", () => set("online"));
  window.addEventListener("offline", () => set("offline"));
}

export function networkState(): NetworkState {
  attach();
  return state;
}

export function subscribeNetwork(listener: Listener): () => void {
  attach();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A request that failed at the transport layer is stronger evidence than `navigator.onLine`. */
export function reportTransportFailure(): void {
  set("offline");
}

export function reportTransportSuccess(): void {
  set("online");
}
