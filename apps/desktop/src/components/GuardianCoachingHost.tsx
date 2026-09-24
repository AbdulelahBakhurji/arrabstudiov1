import { useEffect, useRef } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { pushToast } from "@/lib/notify";
import {
  GUARDIAN_STORE_EVENT,
  markCoachingAlertRead,
  unreadCoachingAlerts,
  useGuardianStore,
} from "@/lib/guardian-store";

/**
 * When a manager is signed into a parent/partner seat, surface live
 * coaching alerts as toasts (kid escalations → how to show up).
 */
export function GuardianCoachingHost() {
  const { isFamily, href } = useRole();
  const { isManager, isChild } = useFamilyProfile();
  const { t } = useLanguage();
  const store = useGuardianStore();
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isFamily || !isManager || isChild) return;

    const flush = () => {
      const unread = unreadCoachingAlerts();
      for (const alert of unread) {
        if (seenRef.current.has(alert.id)) continue;
        seenRef.current.add(alert.id);
        pushToast({
          id: `guardian-coach-${alert.id}`,
          title: t("guardianAlertTitle").replace("{name}", alert.childName),
          body: `${alert.companionName}: ${alert.coaching}`,
          tone: "warn",
          href: href("/settings"),
          kind: "system",
          durationMs: 12_000,
        });
        markCoachingAlertRead(alert.id);
      }
    };

    flush();
    const onStore = () => flush();
    window.addEventListener(GUARDIAN_STORE_EVENT, onStore);
    return () => window.removeEventListener(GUARDIAN_STORE_EVENT, onStore);
  }, [isFamily, isManager, isChild, store.alerts.length, store.alerts[0]?.id, t, href]);

  return null;
}
