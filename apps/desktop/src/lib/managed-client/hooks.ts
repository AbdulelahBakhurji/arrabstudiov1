import { useMemo } from "react";
import { APP_VERSION } from "./app-version";
import { applyCompanionPolicy, companionAvailability, type CompanionAvailability } from "./companions";
import { limitStatus, type LimitStatus } from "./limits";
import { useManagedState } from "./store";
import type { CompanionPolicy } from "./types";
import { maintenanceView, type MaintenanceView } from "./updates";

const EMPTY: CompanionPolicy[] = [];

export function useCompanionPolicies(): CompanionPolicy[] {
  return useManagedState().config?.companions ?? EMPTY;
}

/** The companion list as Arrab Control wants it shown. */
export function useManagedCompanions<T extends { id: string; agentId?: string | null }>(
  people: readonly T[],
): T[] {
  const policies = useCompanionPolicies();
  return useMemo(() => applyCompanionPolicy(people, policies), [people, policies]);
}

export type SendBlockReason = "update" | "readOnly" | "limit" | "companion";

export type SendGate = {
  blocked: boolean;
  reason: SendBlockReason | null;
  uploadsBlocked: boolean;
  availability: CompanionAvailability;
  limits: LimitStatus;
  view: MaintenanceView;
};

/** One place that decides whether the composer may send. The server still enforces. */
export function useSendGate(companion?: { id: string; agentId?: string | null } | null): SendGate {
  const state = useManagedState();
  return useMemo(() => {
    const view = maintenanceView(
      APP_VERSION,
      state.maintenance,
      Boolean(state.forcedUpdate?.blocking),
    );
    const availability = companionAvailability(companion, state.config?.companions ?? EMPTY);
    const limits = limitStatus(state.config?.limits);
    const reason: SendBlockReason | null =
      view.updateMode === "blocking"
        ? "update"
        : view.readOnly
          ? "readOnly"
          : !availability.enabled
            ? "companion"
            : limits.level === "blocked"
              ? "limit"
              : null;
    return {
      blocked: reason !== null,
      reason,
      uploadsBlocked: view.uploadsBlocked,
      availability,
      limits,
      view,
    };
  }, [state.maintenance, state.forcedUpdate, state.config, companion]);
}
