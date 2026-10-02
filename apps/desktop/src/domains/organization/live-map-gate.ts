import { entitlementsForPlan, isKnownPlanId } from "@arrab/shared";

/**
 * Today the Live Map tab hosts the Agents Office, a development tool that needs `node serve.mjs`
 * from a source checkout (the Rust side refuses to start it in a shipped build). The in-app
 * `LiveOfficeMap` component exists but is not wired yet. Until a production implementation is
 * mounted, a shipped build must not show a tab that can only fail. Flip this when it is wired.
 */
export const LIVE_MAP_PRODUCTION_READY = false;

/**
 * Whether to offer the Live Map tab: the seat's role allows it, the *plan* includes it (Business and
 * Enterprise), and a working implementation exists in this build. The plan comes from the server's
 * account status; hiding the tab is a courtesy — there is no Live-Map-only API to protect.
 */
export function canShowLiveMap(input: {
  seatAllows: boolean;
  planId: string | null | undefined;
  development?: boolean;
}): boolean {
  if (!input.seatAllows) return false;
  if (!input.development && !LIVE_MAP_PRODUCTION_READY) return false;
  if (!isKnownPlanId(input.planId)) return Boolean(input.development); // no account: only in development
  return entitlementsForPlan(input.planId).liveMap;
}
