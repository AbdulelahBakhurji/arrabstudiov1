import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FamilyAgeTier, FamilyMemberPublic, FamilyMemberRole } from "@arrab/shared";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { audienceFromPlanId } from "@/roles/catalog";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { resolveMemberFaceUrl } from "@/lib/family-portraits";
import { useGuardianStore } from "@/lib/guardian-store";

function ageTierLabel(
  tier: FamilyAgeTier | null | undefined,
  t: (key: "familyAgeShort69" | "familyAgeShort1013" | "familyAgeShort1417") => string,
): string | null {
  if (tier === "tier_6_9") return t("familyAgeShort69");
  if (tier === "tier_10_13") return t("familyAgeShort1013");
  if (tier === "tier_14_17") return t("familyAgeShort1417");
  return null;
}

function roleLabel(
  role: FamilyMemberRole,
  t: (key: "familyRoleParent" | "familyRolePartner" | "familyRoleChild") => string,
): string {
  if (role === "parent") return t("familyRoleParent");
  if (role === "partner") return t("familyRolePartner");
  return t("familyRoleChild");
}

export function FamilyProfileSwitcher({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { signedIn, account, status } = useSignedInAccount();
  const { snapshot, active, switchTo, isChild, seatLocked } = useFamilyProfile();
  const familyPlan =
    signedIn &&
    audienceFromPlanId(account?.planId ?? status?.entitlements?.planId ?? null) === "family";
  useGuardianStore();
  const [open, setOpen] = useState(false);
  const activeFace = active
    ? resolveMemberFaceUrl({
        id: active.id,
        role: active.role,
        ageTier: active.ageTier,
      })
    : null;

  const members = useMemo(() => {
    const all = snapshot?.members ?? [];
    // Locked seat login (kid email/password) — only show self.
    if (seatLocked && active) return all.filter((m) => m.id === active.id);
    return all;
  }, [snapshot?.members, seatLocked, active]);
  const ageBadge = ageTierLabel(active?.ageTier, t);
  const canSwitch = !seatLocked && members.length > 1;

  if (!familyPlan || !snapshot?.available || members.length === 0) return null;

  async function pick(member: FamilyMemberPublic) {
    if (!canSwitch || member.id === active?.id) {
      setOpen(false);
      return;
    }
    const ok = await switchTo(member);
    if (ok) setOpen(false);
  }

  return (
    <div className={cn("fps-root relative", className)}>
      <button
        type="button"
        className="fps-trigger"
        onClick={() => {
          if (!canSwitch) return;
          setOpen((v) => !v);
        }}
        title={canSwitch ? t("familySwitchProfile") : active?.displayName}
        aria-expanded={canSwitch ? open : undefined}
        aria-haspopup={canSwitch ? "listbox" : undefined}
        aria-disabled={!canSwitch}
      >
        <span className="fps-avatar">
          {activeFace ? (
            <img src={activeFace} alt="" className="fps-avatar-photo" />
          ) : (
            (active?.displayName ?? "?").slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="fps-name">{active?.displayName ?? t("familyHousehold")}</span>
        {isChild ? (
          <span className={cn("fps-badge", ageBadge ? "is-age" : "is-kid")}>
            {ageBadge ?? t("familyKidMode")}
          </span>
        ) : active?.isOwner ? (
          <span className="fps-badge is-parent">{t("familyOwner")}</span>
        ) : null}
        {canSwitch ? <ChevronDown className="fps-chevron" strokeWidth={1.8} /> : null}
      </button>

      {open && canSwitch ? (
        <div className="fps-menu" role="listbox" aria-label={t("familySwitchProfile")}>
          <p className="fps-menu-label">{t("familySwitchProfile")}</p>
          <ul className="fps-menu-list">
            {members.map((member) => {
              const memberAge = ageTierLabel(member.ageTier, t);
              const meta = [
                roleLabel(member.role, t),
                memberAge,
                member.isPaused ? t("familyPaused") : null,
              ]
                .filter(Boolean)
                .join(" · ");
              const face = resolveMemberFaceUrl({
                id: member.id,
                role: member.role,
                ageTier: member.ageTier,
              });
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={member.id === active?.id}
                    disabled={member.isPaused}
                    onClick={() => void pick(member)}
                    className={cn(
                      "fps-option",
                      member.id === active?.id && "is-active",
                      member.isPaused && "is-paused",
                    )}
                  >
                    <span className="fps-option-avatar">
                      <img src={face} alt="" className="fps-avatar-photo" />
                    </span>
                    <span className="fps-option-copy">
                      <span className="fps-option-name">{member.displayName}</span>
                      <span className="fps-option-meta">{meta}</span>
                    </span>
                    {member.role === "child" && memberAge ? (
                      <span className="fps-badge is-age">{memberAge}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
