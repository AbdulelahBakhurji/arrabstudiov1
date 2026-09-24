import type { PollWebAuthResponse } from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  AUTH_DEEP_LINK_EVENT,
  clearPendingWebAuth,
  readPendingWebAuth,
  writeAccountSession,
  writePendingWebAuth,
} from "@/lib/account-session";
import { focusMainWindow } from "@/lib/desktop";
import { markPostAuthPlanSetup } from "@/lib/post-auth-setup";

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
        writeAccountSession(polled.sessionToken);
        clearPendingWebAuth();
        if (polled.accountCreated) {
          markPostAuthPlanSetup();
        }
        await focusMainWindow();
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

/** Apply a session token delivered via `arrab://auth/complete?session=…&state=…`. */
export function applySessionFromDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "arrab:") return false;
    const host = parsed.hostname || parsed.host || "";
    const path = `${host}${parsed.pathname}`.replace(/^\/*/, "");
    if (!path.startsWith("auth/complete") && path !== "auth/complete") {
      // Also accept arrab://auth/complete
      if (!url.includes("auth/complete")) return false;
    }
    const session =
      parsed.searchParams.get("session")?.trim() ||
      parsed.searchParams.get("token")?.trim() ||
      "";
    const state = parsed.searchParams.get("state")?.trim() || "";
    const pending = readPendingWebAuth();
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
      if (parsed.searchParams.get("setup") === "plan") {
        markPostAuthPlanSetup();
      }
      window.dispatchEvent(
        new CustomEvent(AUTH_DEEP_LINK_EVENT, { detail: { url, applied: true } }),
      );
      return true;
    }
    if (parsed.searchParams.get("setup") === "plan") {
      markPostAuthPlanSetup();
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
