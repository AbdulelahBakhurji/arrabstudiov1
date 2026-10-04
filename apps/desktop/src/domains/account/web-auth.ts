import type { PollWebAuthResponse } from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/core/api/api";
import {
  AUTH_DEEP_LINK_EVENT,
  clearPendingWebAuth,
  readPendingWebAuth,
  writeAccountSession,
  writePendingWebAuth,
} from "@/core/session/account-session";
import { focusMainWindow } from "@/core/platform/desktop";
import {
  markPostAuthPlanSetup,
  type PlanHandoff,
} from "@/domains/account/post-auth-setup";
import { refreshAccountStatus } from "@/domains/account/use-signed-in-account";

export type WebAuthPollResult =
  | { kind: "completed"; response: PollWebAuthResponse }
  | { kind: "expired"; message: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type PollHandle = {
  cancelled: boolean;
  timer?: number;
};

const activePolls = new Set<PollHandle>();

export function cancelAllWebAuthPolls(): void {
  for (const handle of activePolls) {
    handle.cancelled = true;
    if (handle.timer) window.clearTimeout(handle.timer);
  }
  activePolls.clear();
  clearPendingWebAuth();
}

function handoffFromSearchParams(params: URLSearchParams): PlanHandoff | undefined {
  const planId = params.get("planId")?.trim() || params.get("plan")?.trim() || undefined;
  const planName = params.get("planName")?.trim() || undefined;
  const tokenLimitRaw = params.get("tokenLimit")?.trim();
  const deepseekRaw = params.get("deepseekCredit")?.trim();
  const otherRaw = params.get("otherCredit")?.trim();
  const tokenLimit = tokenLimitRaw ? Number(tokenLimitRaw) : undefined;
  const deepseekCredit = deepseekRaw ? Number(deepseekRaw) : undefined;
  const otherCredit = otherRaw ? Number(otherRaw) : undefined;
  const setup = params.get("setup")?.trim();
  const registered = params.get("registered")?.trim();
  if (!planId && !planName && tokenLimit == null && setup !== "plan" && registered !== "1") {
    return undefined;
  }
  return {
    planId,
    planName,
    tokenLimit: Number.isFinite(tokenLimit) ? tokenLimit : undefined,
    deepseekCredit: Number.isFinite(deepseekCredit) ? deepseekCredit : undefined,
    otherCredit: Number.isFinite(otherCredit) ? otherCredit : undefined,
    section: setup === "plan" || registered === "1" ? "plan" : "usage",
  };
}

async function afterSessionSaved(opts?: {
  accountCreated?: boolean;
  handoff?: PlanHandoff;
  forcePlanSetup?: boolean;
}): Promise<void> {
  if (opts?.forcePlanSetup || opts?.accountCreated || opts?.handoff) {
    markPostAuthPlanSetup(opts.handoff);
  }
  await refreshAccountStatus({ silent: true }).catch(() => undefined);
  await focusMainWindow();
}

/**
 * Poll until browser auth completes. Persists pending credentials so a deep-link
 * return (or remount) can resume without signing the user out.
 */
export async function pollWebAuthUntilDone(input: {
  state: string;
  pollSecret: string;
  pollIntervalMs?: number;
  onPending?: () => void;
  signal?: { cancelled: boolean; timer?: number };
}): Promise<WebAuthPollResult> {
  const handle: PollHandle = input.signal ?? { cancelled: false };
  activePolls.add(handle);
  writePendingWebAuth({ state: input.state, pollSecret: input.pollSecret });
  input.onPending?.();

  const interval = Math.max(800, input.pollIntervalMs ?? 1500);

  try {
    while (!handle.cancelled) {
      const polled = await arrabApi.pollWebAuth(input.state, input.pollSecret);
      if (handle.cancelled) {
        return { kind: "cancelled" };
      }
      if (polled.status === "completed" && polled.sessionToken) {
        writeAccountSession(polled.sessionToken, polled.account?.id);
        clearPendingWebAuth();
        await afterSessionSaved({
          accountCreated: polled.accountCreated,
          handoff: polled.account
            ? {
                planId: polled.account.planId,
                planName: polled.account.planName,
                section: polled.accountCreated ? "plan" : undefined,
              }
            : undefined,
          forcePlanSetup: Boolean(polled.accountCreated),
        });
        return { kind: "completed", response: polled };
      }
      if (polled.status === "expired") {
        clearPendingWebAuth();
        return { kind: "expired", message: polled.message ?? "Sign-in session expired" };
      }
      await new Promise<void>((resolve) => {
        handle.timer = window.setTimeout(resolve, interval);
      });
    }
    return { kind: "cancelled" };
  } catch (err: unknown) {
    if (handle.cancelled) return { kind: "cancelled" };
    return {
      kind: "error",
      message: err instanceof ApiRequestError ? err.message : "API unavailable",
    };
  } finally {
    activePolls.delete(handle);
    if (handle.timer) window.clearTimeout(handle.timer);
  }
}

/** Resume a pending browser sign-in after app focus / remount. */
export async function resumePendingWebAuth(opts?: {
  onPending?: () => void;
}): Promise<WebAuthPollResult | null> {
  const pending = readPendingWebAuth();
  if (!pending) return null;
  return pollWebAuthUntilDone({
    state: pending.state,
    pollSecret: pending.pollSecret,
    onPending: opts?.onPending,
  });
}

/**
 * Apply a session token delivered via
 * `arrab://auth/complete?session=…&state=…&setup=plan&planId=…&tokenLimit=…`.
 */
export function applySessionFromDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "arrab:") return false;
    const host = parsed.hostname || parsed.host || "";
    const path = `${host}${parsed.pathname}`.replace(/^\/*/, "");
    if (!path.startsWith("auth/complete") && path !== "auth/complete") {
      if (!url.includes("auth/complete")) return false;
    }
    const session =
      parsed.searchParams.get("session")?.trim() ||
      parsed.searchParams.get("token")?.trim() ||
      "";
    const state = parsed.searchParams.get("state")?.trim() || "";
    const pending = readPendingWebAuth();
    const handoff = handoffFromSearchParams(parsed.searchParams);
    // Reject unbound session plants from other local apps — require matching pending web-auth.
    if (!pending || !state || state !== pending.state) {
      window.dispatchEvent(
        new CustomEvent(AUTH_DEEP_LINK_EVENT, { detail: { url, applied: false } }),
      );
      return false;
    }
    if (session.length >= 20) {
      writeAccountSession(session);
      clearPendingWebAuth();
      void afterSessionSaved({
        handoff,
        forcePlanSetup: parsed.searchParams.get("setup") === "plan" || Boolean(handoff),
      });
      window.dispatchEvent(
        new CustomEvent(AUTH_DEEP_LINK_EVENT, { detail: { url, applied: true } }),
      );
      return true;
    }
    if (parsed.searchParams.get("setup") === "plan" || handoff) {
      markPostAuthPlanSetup(handoff);
    }
    window.dispatchEvent(
      new CustomEvent(AUTH_DEEP_LINK_EVENT, { detail: { url, applied: false } }),
    );
    return false;
  } catch {
    return false;
  }
}

export function subscribeAuthDeepLink(
  onEvent: (detail: { url: string; applied: boolean }) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ url: string; applied: boolean }>).detail;
    if (detail) onEvent(detail);
  };
  window.addEventListener(AUTH_DEEP_LINK_EVENT, handler);
  return () => window.removeEventListener(AUTH_DEEP_LINK_EVENT, handler);
}
