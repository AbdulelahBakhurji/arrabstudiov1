/**
 * Signed-in Arrab account — required before an admin may change the companion list.
 */
import { useEffect, useState } from "react";
import type { AccountPublic } from "@arrab/shared";
import { arrabApi } from "@/lib/api";
import { subscribeAccountSession } from "@/lib/account-session";

export function useSignedInAccount(): {
  account: AccountPublic | null;
  loading: boolean;
  signedIn: boolean;
  refresh: () => void;
} {
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    void arrabApi
      .account()
      .then((status) => {
        setAccount(status.connected ? status.account : null);
      })
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    return subscribeAccountSession(refresh);
  }, []);

  return {
    account,
    loading,
    signedIn: Boolean(account),
    refresh,
  };
}
