import { useCallback, useSyncExternalStore } from "react";
import type { FamilyHouseholdSnapshot, FamilyMemberPublic } from "@arrab/shared";
import {
  ensureFamilyBootstrapped,
  getFamilyState,
  refreshFamilyProfile,
  subscribeFamilyProfile,
  writeActiveFamilyMemberId,
} from "@/lib/family-session";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { pushToast } from "@/lib/notify";
import { useLanguage } from "@/i18n/LanguageProvider";

export function useFamilyProfile(): {
  snapshot: FamilyHouseholdSnapshot | null;
  active: FamilyMemberPublic | null;
  loading: boolean;
  isManager: boolean;
  isChild: boolean;
  isPaused: boolean;
  refresh: () => void;
  switchTo: (member: FamilyMemberPublic, pin?: string) => Promise<boolean>;
} {
  ensureFamilyBootstrapped();
  const snap = useSyncExternalStore(subscribeFamilyProfile, getFamilyState, getFamilyState);
  const { t } = useLanguage();

  const refresh = useCallback(() => {
    void refreshFamilyProfile({ silent: Boolean(snap.snapshot) });
  }, [snap.snapshot]);

  const switchTo = useCallback(
    async (member: FamilyMemberPublic, pin?: string) => {
      if (member.isPaused) {
        pushToast({ title: t("familyProfilePaused"), tone: "warn" });
        return false;
      }
      try {
        const result = await arrabApi.switchFamilyProfile({
          memberId: member.id,
          pin: pin || undefined,
        });
        writeActiveFamilyMemberId(result.member.id);
        await refreshFamilyProfile({ silent: true });
        pushToast({
          title: t("familySwitched"),
          body: result.member.displayName,
          tone: "success",
        });
        return true;
      } catch (err: unknown) {
        pushToast({
          title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
          tone: "warn",
        });
        return false;
      }
    },
    [t],
  );

  return {
    snapshot: snap.snapshot,
    active: snap.active,
    loading: snap.loading,
    isManager: Boolean(snap.active?.isManager),
    isChild: snap.active?.role === "child",
    isPaused: Boolean(snap.active?.isPaused),
    refresh,
    switchTo,
  };
}
