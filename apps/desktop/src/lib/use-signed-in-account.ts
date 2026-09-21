/**
 * Signed-in Arrab account — shared across the app (one verify, instant cache).
 * A verified device session (or freshly connected workspace account) is required.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AccountPublic, AccountStatusResponse } from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  clearAccountSessionIfCurrent,
  readAccountSessionToken,
  subscribeAccountSession,
} from "@/lib/account-session";
import {
  applySessionFromDeepLink,
  resumePendingWebAuth,
  subscribeAuthDeepLink,
} from "@/lib/web-auth";
import { isTauriRuntime } from "@/lib/terminal";

/** Fail fast — never stall boot on a slow/dead API. */
const AUTH_CHECK_BUDGET_MS = 2_500;
const AUTH_REQUEST_TIMEOUT_MS = 2_000;
const ACCOUNT_CACHE_KEY = "arrab.account.status.cache";

type AccountCache = {
  token: string;
  status: AccountStatusResponse;
  savedAt: number;
};

type AccountState = {
  account: AccountPublic | null;
  status: AccountStatusResponse | null;
  /** True only while the first verify for a token is in flight (cache miss). */
  loading: boolean;
};

const listeners = new Set<() => void>();
let state: AccountState = hydrateInitialState();
let gen = 0;
let bootstrapped = false;
let inFlight: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  emit();
}

function readCache(token: string): AccountCache | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccountCache;
    if (!parsed?.token || parsed.token !== token || !parsed.status) return null;
    // Keep cache for 7 days — verify still runs in background.
    if (Date.now() - (parsed.savedAt || 0) > 7 * 24 * 60 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(token: string, status: AccountStatusResponse): void {
  try {
    const value: AccountCache = { token, status, savedAt: Date.now() };
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    // ignore
  }
}

function hydrateInitialState(): AccountState {
  const token = readAccountSessionToken();
  if (!token) {
    return { account: null, status: null, loading: false };
  }
  const cached = readCache(token);
  if (cached?.status?.connected && cached.status.account) {
    return {
      account: cached.status.account,
      status: cached.status,
      loading: false,
    };
  }
  // Token present but no cache — enter app immediately; verify in background.
  return { account: null, status: null, loading: false };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AccountState {
  return state;
}

async function refreshAccount(opts?: { silent?: boolean }): Promise<void> {
  const silent = Boolean(opts?.silent);
  const myGen = ++gen;

  if (inFlight && silent) {
    return inFlight;
  }

  const run = (async () => {
    const token = readAccountSessionToken();
    if (!token) {
      clearCache();
      if (myGen === gen) {
        setState({ account: null, status: null, loading: false });
      }
      return;
    }

    // Instant path: keep cached account; only show loading on cold token with no cache.
    const cached = readCache(token);
    if (cached?.status?.connected && cached.status.account) {
      if (myGen === gen) {
        setState({
          account: cached.status.account,
          status: cached.status,
          loading: false,
        });
      }
    } else if (!silent && !state.account) {
      if (myGen === gen) setState({ loading: false });
    }

    const budget = window.setTimeout(() => {
      if (myGen === gen) setState({ loading: false });
    }, AUTH_CHECK_BUDGET_MS);

    try {
      try {
        const verified = await arrabApi.verifyAccountSession(
          { sessionToken: token },
          AUTH_REQUEST_TIMEOUT_MS,
        );
        if (myGen !== gen) return;
        if (readAccountSessionToken() !== token) return;
        if (verified.connected && verified.account) {
          writeCache(token, verified);
          setState({
            account: verified.account,
            status: verified,
            loading: false,
          });
        } else {
          clearCache();
          clearAccountSessionIfCurrent(token);
          setState({ account: null, status: verified, loading: false });
        }
        return;
      } catch (err: unknown) {
        if (myGen !== gen) return;
        if (readAccountSessionToken() !== token) return;
        const unauthorized =
          err instanceof ApiRequestError && (err.status === 401 || err.status === 403);
        if (unauthorized) {
          clearCache();
          clearAccountSessionIfCurrent(token);
          setState({ account: null, status: null, loading: false });
          return;
        }
        // Network/API blip — keep cached session; don't bounce to sign-in.
        if (myGen === gen) setState({ loading: false });
        return;
      }
    } finally {
      window.clearTimeout(budget);
      if (myGen === gen) setState({ loading: false });
    }
  })();

  inFlight = run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return inFlight;
}

function ensureBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  void refreshAccount({ silent: true });
  subscribeAccountSession(() => {
    void refreshAccount({ silent: false });
  });
  subscribeAuthDeepLink(() => {
    void refreshAccount({ silent: false });
  });

  if (isTauriRuntime()) {
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<string>("arrab:deep-link", (event) => {
        const url = event.payload ?? "";
        const applied = applySessionFromDeepLink(url);
        if (!applied) {
          void resumePendingWebAuth().then((result) => {
            if (result?.kind === "completed") void refreshAccount({ silent: false });
          });
        } else {
          void refreshAccount({ silent: false });
        }
      });
    });
  }

  void resumePendingWebAuth().then((result) => {
    if (result?.kind === "completed") void refreshAccount({ silent: false });
  });
}

export function useSignedInAccount(): {
  account: AccountPublic | null;
  status: AccountStatusResponse | null;
  loading: boolean;
  signedIn: boolean;
  refresh: () => void;
} {
  ensureBootstrapped();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => {
    void refreshAccount({ silent: Boolean(state.account) });
  }, []);

  useEffect(() => {
    ensureBootstrapped();
  }, []);

  const token = readAccountSessionToken();
  return {
    account: snap.account,
    status: snap.status,
    loading: snap.loading,
    // Optimistic: a device token means signed-in until verify proves otherwise.
    signedIn: Boolean(snap.account) || Boolean(token),
    refresh,
  };
}
