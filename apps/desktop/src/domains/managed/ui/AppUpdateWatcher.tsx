import { useEffect } from "react";
import { useRole } from "@/app/roles/RoleProvider";
import { maybeNotifyAppUpdate } from "@/domains/managed/app-updates";
import { publishUpdateCheckResult } from "@/domains/managed/ui/UpdateAvailableBanner";
import { readPrefs, subscribePrefs } from "@/shared/lib/prefs";

const PERIODIC_CHECK_MS = 60 * 60_000;
const FOCUS_CHECK_MIN_GAP_MS = 15 * 60_000;

/**
 * Checks for desktop updates after launch, hourly, and when the window regains focus.
 * Shows a toast plus an OS notification (Notification Center / Action Center) once per version.
 */
export function AppUpdateWatcher() {
  const { href } = useRole();

  useEffect(() => {
    let cancelled = false;
    let lastRunAt = 0;
    let inFlight = false;

    const run = () => {
      if (cancelled || inFlight) return;
      if (!readPrefs().autoCheckUpdates) return;
      inFlight = true;
      lastRunAt = Date.now();
      void maybeNotifyAppUpdate({ settingsHref: href("/settings?tab=about") })
        .then((info) => {
          if (!cancelled) publishUpdateCheckResult(info);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    // Defer so shell chrome / auth settle first.
    const startup = setTimeout(run, 4_000);
    const periodic = setInterval(run, PERIODIC_CHECK_MS);
    const onFocus = () => {
      if (Date.now() - lastRunAt >= FOCUS_CHECK_MIN_GAP_MS) run();
    };
    window.addEventListener("focus", onFocus);

    const unsub = subscribePrefs((prefs) => {
      if (prefs.autoCheckUpdates) run();
    });

    return () => {
      cancelled = true;
      clearTimeout(startup);
      clearInterval(periodic);
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [href]);

  return null;
}
