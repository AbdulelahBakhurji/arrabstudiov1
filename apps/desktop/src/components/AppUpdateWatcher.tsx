import { useEffect } from "react";
import { useRole } from "@/roles/RoleProvider";
import { maybeNotifyAppUpdate } from "@/lib/app-updates";
import { readPrefs, subscribePrefs } from "@/lib/prefs";

/**
 * Quietly checks for desktop updates after launch and shows a toast when one is available.
 */
export function AppUpdateWatcher() {
  const { href } = useRole();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      if (cancelled) return;
      if (!readPrefs().autoCheckUpdates) return;
      void maybeNotifyAppUpdate({
        settingsHref: href("/settings?tab=about"),
      });
    };

    // Defer so shell chrome / auth settle first.
    timer = setTimeout(run, 4_000);

    const unsub = subscribePrefs((prefs) => {
      if (prefs.autoCheckUpdates) {
        void maybeNotifyAppUpdate({
          settingsHref: href("/settings?tab=about"),
        });
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [href]);

  return null;
}
