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
import { COMPANION_FOCUS_KEY } from "@/lib/companions";
import { LAST_CHAT_AGENT_KEY, LAST_COWORK_AGENT_KEY } from "@/lib/prefs";

/** Clear seat-local focus so the next profile never inherits another seat's room. */
function clearSeatFocusArtifacts() {
  try {
    sessionStorage.removeItem(COMPANION_FOCUS_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(LAST_CHAT_AGENT_KEY);
    localStorage.removeItem(LAST_COWORK_AGENT_KEY);
  } catch {
    // ignore
  }
}

export function useFamilyProfile(): {
  snapshot: FamilyHouseholdSnapshot | null;
  active: FamilyMemberPublic | null;
  loading: boolean;
  isManager: boolean;
  isChild: boolean;
  isPaused: boolean;
  /** Member email/password session — cannot switch profiles. */
  seatLocked: boolean;
  refresh: () => void;
  switchTo: (member: FamilyMemberPublic) => Promise<boolean>;
} {
  ensureFamilyBootstrapped();
  const snap = useSyncExternalStore(subscribeFamilyProfile, getFamilyState, getFamilyState);
  const { t } = useLanguage();
  const seatLocked = Boolean(snap.snapshot?.seatLocked);

  const refresh = useCallback(() => {
    void refreshFamilyProfile({ silent: Boolean(snap.snapshot) });
  }, [snap.snapshot]);

  const switchTo = useCallback(
    async (member: FamilyMemberPublic) => {
      if (seatLocked && snap.active && member.id !== snap.active.id) {
        pushToast({ title: t("familySwitchLocked"), tone: "warn" });
        return false;
      }
      if (member.isPaused) {
        pushToast({ title: t("familyProfilePaused"), tone: "warn" });
        return false;
      }
      try {
        const result = await arrabApi.switchFamilyProfile({
          memberId: member.id,
        });
        clearSeatFocusArtifacts();
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
    [t, seatLocked, snap.active],
  );

  return {
    snapshot: snap.snapshot,
    active: snap.active,
    loading: snap.loading,
    isManager: Boolean(snap.active?.isManager),
    isChild: snap.active?.role === "child",
    isPaused: Boolean(snap.active?.isPaused),
    seatLocked,
    refresh,
    switchTo,
  };
}
