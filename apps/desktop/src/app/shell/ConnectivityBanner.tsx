import { useEffect, useRef, useState } from "react";
import { networkState, subscribeNetwork, type NetworkState } from "@/core/platform/network";
import { useLanguage } from "@/shared/i18n/LanguageProvider";

/** The device's connectivity as a React value. */
export function useNetworkState(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => networkState());
  useEffect(() => subscribeNetwork(setState), []);
  return state;
}

/**
 * Tells the user — in words, for screen readers too — when the device is offline and that their
 * work is safe, then confirms when the connection returns. Renders nothing while online.
 */
export function ConnectivityBanner() {
  const { t } = useLanguage();
  const state = useNetworkState();
  const [showBack, setShowBack] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (state === "offline") {
      wasOffline.current = true;
      setShowBack(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setShowBack(true);
    const timer = window.setTimeout(() => setShowBack(false), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === "online" && !showBack) return null;
  const offline = state === "offline";
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        offline
          ? "mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-50"
          : "mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-50"
      }
    >
      {offline ? t("connectivityOffline") : t("connectivityBack")}
    </div>
  );
}
