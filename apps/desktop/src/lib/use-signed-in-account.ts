/**
 * Signed-in Arrab account — required to use the studio.
 * A verified device session (or freshly connected workspace account) is required.
 */
import { useCallback, useEffect, useState } from "react";
import type { AccountPublic, AccountStatusResponse } from "@arrab/shared";
import { arrabApi } from "@/lib/api";
import {
  clearAccountSession,
  readAccountSessionToken,
  subscribeAccountSession,
} from "@/lib/account-session";

export function useSignedInAccount(): {
  account: AccountPublic | null;
  status: AccountStatusResponse | null;
  loading: boolean;
  signedIn: boolean;
  refresh: () => void;
} {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [status, setStatus] = useState<AccountStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void (async () => {
      try {
        const token = readAccountSessionToken();
        if (token) {
          try {
            const verified = await arrabApi.verifyAccountSession({ sessionToken: token });
            setStatus(verified);
            setAccount(verified.connected ? verified.account : null);
            return;
          } catch {
            clearAccountSession();
          }
        }

        // No valid device session — require explicit sign-in even if a workspace
        // account record still exists on the API.
        const next = await arrabApi.account();
        setStatus(next);
        setAccount(null);
      } catch {
        setStatus(null);
        setAccount(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    return subscribeAccountSession(refresh);
  }, [refresh]);

  return {
    account,
    status,
    loading,
    signedIn: Boolean(account),
    refresh,
  };
}
