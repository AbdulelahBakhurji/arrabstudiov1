/**
 * Active family profile on this device — drives companion ownership,
 * kid-mode gating, and API usage attribution.
 */
import type { FamilyMemberPublic, FamilyHouseholdSnapshot } from "@arrab/shared";
import { arrabApi } from "@/lib/api";
import { readAccountSessionToken } from "@/lib/account-session";

export const FAMILY_ACTIVE_KEY = "arrab.family.activeMemberId";
export const FAMILY_EVENT = "arrab:family-profile";

type FamilyState = {
  snapshot: FamilyHouseholdSnapshot | null;
  active: FamilyMemberPublic | null;
  loading: boolean;
};

const listeners = new Set<() => void>();
let state: FamilyState = { snapshot: null, active: null, loading: false };
let bootstrapped = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<FamilyState>): void {
  state = { ...state, ...patch };
  emit();
}

export function readActiveFamilyMemberId(): string | null {
  try {
    return localStorage.getItem(FAMILY_ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** Wipe household seats so a signed-out or other-account session never shows Family. */
export function clearFamilySession(): void {
  try {
    localStorage.removeItem(FAMILY_ACTIVE_KEY);
  } catch {
    // ignore
  }
  setState({ snapshot: null, active: null, loading: false });
}

export function writeActiveFamilyMemberId(id: string | null): void {
  const previous = readActiveFamilyMemberId();
  try {
    if (id) localStorage.setItem(FAMILY_ACTIVE_KEY, id);
    else localStorage.removeItem(FAMILY_ACTIVE_KEY);
  } catch {
    // ignore
  }
  if (previous === id) return;
  try {
    sessionStorage.removeItem("arrab.companionFocus");
    localStorage.removeItem("arrab.chat.lastAgent");
    localStorage.removeItem("arrab.cowork.lastAgent");
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(FAMILY_EVENT));
}

export function getFamilySnapshot(): FamilyHouseholdSnapshot | null {
  return state.snapshot;
}

export function getActiveFamilyMember(): FamilyMemberPublic | null {
  return state.active;
}

export function isFamilyManager(): boolean {
  return Boolean(state.active?.isManager);
}

export function isFamilyChild(): boolean {
  return state.active?.role === "child";
}

export function isFamilyPaused(): boolean {
  return Boolean(state.active?.isPaused);
}

export function subscribeFamilyProfile(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = () => {
    void refreshFamilyProfile({ silent: true });
  };
  window.addEventListener(FAMILY_EVENT, onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener(FAMILY_EVENT, onStorage);
  };
}

export function getFamilyState(): FamilyState {
  return state;
}

export async function refreshFamilyProfile(opts?: { silent?: boolean }): Promise<FamilyState> {
  if (!readAccountSessionToken()) {
    if (state.snapshot || state.active) clearFamilySession();
    else setState({ snapshot: null, active: null, loading: false });
    return state;
  }
  if (!opts?.silent) setState({ loading: true });
  try {
    const snapshot = await arrabApi.familyHousehold();
    if (!snapshot.available) {
      writeActiveFamilyMemberId(null);
      setState({ snapshot: null, active: null, loading: false });
      return state;
    }
    const savedId = readActiveFamilyMemberId();
    const active =
      snapshot.members.find((m) => m.id === savedId) ??
      snapshot.members.find((m) => m.id === snapshot.activeMemberId) ??
      snapshot.members.find((m) => m.isOwner) ??
      snapshot.members[0] ??
      null;
    if (active && active.id !== savedId) {
      writeActiveFamilyMemberId(active.id);
    }
    setState({ snapshot, active, loading: false });
    return state;
  } catch {
    writeActiveFamilyMemberId(null);
    setState({ snapshot: null, active: null, loading: false });
    return state;
  }
}

export function ensureFamilyBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  void refreshFamilyProfile({ silent: true });
}

/** React-friendly hook via useSyncExternalStore pattern helpers. */
export function useFamilyProfileSubscribe(cb: () => void): () => void {
  ensureFamilyBootstrapped();
  return subscribeFamilyProfile(cb);
}
