import { entitlementsForPlan, isKnownPlanId } from "@arrab/shared";

/**
 * Live Map mounts the in-app `LiveOfficeMap` (workforce departments + agents). The separate
 * Agents Office host (`node serve.mjs`) remains a development-only tool.
 */
export const LIVE_MAP_PRODUCTION_READY = true;

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
