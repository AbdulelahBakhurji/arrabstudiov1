import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Coins,
  KeyRound,
  MessageSquareHeart,
  Pause,
  Play,
  Plus,
  ShoppingBag,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import type {
  FamilyAgeTier,
  FamilyHouseholdSnapshot,
  FamilyMemberPublic,
  FamilyMemberRole,
} from "@arrab/shared";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { pushToast } from "@/lib/notify";
import {
  addParentGuidanceFact,
  liveCompanions,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
} from "@/lib/companions";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import {
  refreshFamilyProfile,
  writeActiveFamilyMemberId,
} from "@/lib/family-session";
import { ACCOUNT_EVENT } from "@/lib/account-session";
import { cn } from "@/lib/utils";
import { GuardianHub } from "@/components/GuardianHub";
import { AddFamilyMemberWizard } from "@/components/family/AddFamilyMemberWizard";
import { resolveMemberFaceUrl } from "@/lib/family-portraits";
import { useGuardianStore } from "@/lib/guardian-store";

type RoomTab = "overview" | "companions" | "guide" | "tokens" | "login" | "guardian";

let faceTick = 0;
function subscribeMemberFaces(listener: () => void): () => void {
  const on = () => {
    faceTick += 1;
    listener();
  };
  window.addEventListener("arrab:profile-photo", on);
  window.addEventListener("arrab:guardian-store", on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener("arrab:profile-photo", on);
    window.removeEventListener("arrab:guardian-store", on);
    window.removeEventListener("storage", on);
  };
}

function MemberFaceDisc({
  member,
  size = "md",
  on,
}: {
  member: FamilyMemberPublic;
  size?: "md" | "sm" | "lg";
  on?: boolean;
}) {
  useGuardianStore();
  useSyncExternalStore(subscribeMemberFaces, () => faceTick, () => 0);
  const photoUrl = resolveMemberFaceUrl({
    id: member.id,
    role: member.role,
    ageTier: member.ageTier,
  });
  return (
    <span
      className={cn(
        "sf-face-disc",
        size === "sm" && "is-sm",
        size === "lg" && "is-lg",
        on && "is-on",
      )}
    >
      <img src={photoUrl} alt="" className="sf-face-photo" />
    </span>
  );
}

const AGE_TIERS: {
  id: FamilyAgeTier;
  labelKey: "familyAge69" | "familyAge1013" | "familyAge1417";
}[] = [
  { id: "tier_6_9", labelKey: "familyAge69" },
  { id: "tier_10_13", labelKey: "familyAge1013" },
  { id: "tier_14_17", labelKey: "familyAge1417" },
];

type FaceMenuState = {
  memberId: string;
  /** Horizontal center of the name label (viewport). */
  centerX: number;
  /** Top of the menu — just below the name (viewport). */
  top: number;
  /** Face top — flip above if the menu would overflow the viewport. */
  faceTop: number;
};

function roleLabel(
  role: FamilyMemberRole,
  t: (key: "familyRoleParent" | "familyRolePartner" | "familyRoleChild") => string,
): string {
  if (role === "parent") return t("familyRoleParent");
  if (role === "partner") return t("familyRolePartner");
  return t("familyRoleChild");
}

export function FamilyHouseholdPanel({
  className,
  variant = "full",
}: {
  className?: string;
  variant?: "full" | "compact";
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const companionState = useCompanionState();
  const [snapshot, setSnapshot] = useState<FamilyHouseholdSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [roomTab, setRoomTab] = useState<RoomTab>("overview");
  const [grantAmount, setGrantAmount] = useState("50000");
  const [guideCompanionId, setGuideCompanionId] = useState("");
  const [guideText, setGuideText] = useState("");
  const [seatCode, setSeatCode] = useState("");
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [faceMenu, setFaceMenu] = useState<FaceMenuState | null>(null);
  const faceMenuRef = useRef<HTMLDivElement | null>(null);
  const trialAttempted = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    void arrabApi
      .familyHousehold()
      .then((next) => {
        setSnapshot(next);
        setError(null);
        void refreshFamilyProfile({ silent: true }).then((state) => {
          const nextActive = state.active?.id ?? next.activeMemberId;
          setActiveId(nextActive);
          setSelectedId((current) => {
            if (current && next.members.some((m) => m.id === current)) return current;
            return (
              next.members.find((m) => m.id === nextActive)?.id ??
              next.members.find((m) => m.isOwner)?.id ??
              next.members[0]?.id ??
              null
            );
          });
        });
      })
      .catch((err: unknown) => {
        setSnapshot(null);
        setError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function startFamilyFreeTrial() {
    setBusy(true);
    setError(null);
    try {
      await arrabApi.activateSubscription({ code: "FAMILY-FREE-ARRAB" });
      window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT));
      pushToast({ title: t("familyFreeTrialStarted"), tone: "success" });
      await refreshFamilyProfile({ silent: true });
      load();
    } catch (err: unknown) {
      const message = err instanceof ApiRequestError ? err.message : t("apiUnavailable");
      setError(message);
      pushToast({ title: message, tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || busy || error || !snapshot || snapshot.available || trialAttempted.current) {
      return;
    }
    trialAttempted.current = true;
    void startFamilyFreeTrial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when locked household appears
  }, [loading, snapshot?.available, error]);

  const managers = useMemo(
    () => snapshot?.members.filter((m) => m.isManager) ?? [],
    [snapshot?.members],
  );
  const activeManager = useMemo(
    () =>
      managers.find((m) => m.id === activeId) ??
      managers.find((m) => m.isOwner) ??
      managers[0] ??
      null,
    [managers, activeId],
  );

  const selected = useMemo(
    () => snapshot?.members.find((m) => m.id === selectedId) ?? snapshot?.members[0] ?? null,
    [snapshot?.members, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    if (selected.role !== "child" && (roomTab === "guide" || roomTab === "guardian")) {
      setRoomTab("overview");
    }
  }, [selected, roomTab]);

  useEffect(() => {
    if (!selected) return;
    setCredEmail(selected.email ?? "");
    setCredPassword("");
  }, [selected?.id]);

  const selectedCompanions = useMemo(() => {
    if (!selected) return [] as CompanionProfile[];
    return liveCompanions(companionState).filter((c) => c.familyMemberId === selected.id);
  }, [companionState, selected]);

  const guideCompanions = useMemo(() => {
    if (!selected) return liveCompanions(companionState);
    return liveCompanions(companionState).filter(
      (c) => !c.familyMemberId || c.familyMemberId === selected.id,
    );
  }, [companionState, selected]);

  const usagePct = useMemo(() => {
    const usage = snapshot?.usage;
    if (!usage || usage.tokenLimit == null || usage.tokenLimit <= 0) return null;
    return Math.min(100, Math.round((usage.tokensUsed / usage.tokenLimit) * 100));
  }, [snapshot?.usage]);

  const poolFreePct = useMemo(() => {
    const usage = snapshot?.usage;
    if (!usage || usage.tokenLimit == null || usage.tokenLimit <= 0) return null;
    return Math.min(100, Math.round((usage.unallocatedTokens / usage.tokenLimit) * 100));
  }, [snapshot?.usage]);

  function focusMember(member: FamilyMemberPublic) {
    setSelectedId(member.id);
    setAddingMember(false);
    setFaceMenu(null);
    setCredEmail(member.email ?? "");
    setCredPassword("");
  }

  function selectMember(member: FamilyMemberPublic) {
    focusMember(member);
    setRoomTab("overview");
  }

  function openRoomTab(member: FamilyMemberPublic, tab: RoomTab) {
    focusMember(member);
    if (tab === "guide") {
      const options = liveCompanions(companionState).filter(
        (c) => !c.familyMemberId || c.familyMemberId === member.id,
      );
      setGuideCompanionId(options[0]?.id ?? "");
    }
    if (tab === "tokens") setGrantAmount("50000");
    setRoomTab(tab);
  }

  function openCredentials(member: FamilyMemberPublic) {
    openRoomTab(member, "login");
  }

  function openGrant(member: FamilyMemberPublic) {
    openRoomTab(member, "tokens");
  }

  function openGuide(member: FamilyMemberPublic) {
    openRoomTab(member, "guide");
  }

  function openAssign(member: FamilyMemberPublic) {
    openRoomTab(member, "companions");
  }

  useEffect(() => {
    if (!faceMenu) return;
    const onPointer = (event: MouseEvent) => {
      if (faceMenuRef.current?.contains(event.target as Node)) return;
      setFaceMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFaceMenu(null);
    };
    const onScroll = () => setFaceMenu(null);
    // Defer so the opening contextmenu gesture cannot instantly dismiss.
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [faceMenu]);

  useLayoutEffect(() => {
    if (!faceMenu || !faceMenuRef.current) return;
    const el = faceMenuRef.current;
    const menuRect = el.getBoundingClientRect();
    const pad = 10;
    let centerX = faceMenu.centerX;
    let top = faceMenu.top;
    const half = menuRect.width / 2;
    if (centerX - half < pad) centerX = half + pad;
    if (centerX + half > window.innerWidth - pad) {
      centerX = window.innerWidth - pad - half;
    }
    if (top + menuRect.height > window.innerHeight - pad) {
      top = Math.max(pad, faceMenu.faceTop - menuRect.height - 8);
    }
    el.style.left = `${Math.round(centerX)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [faceMenu]);

  async function saveCredentials() {
    if (!selected) return;
    const member = selected;
    const needsLogin = member.role === "child";
    if (needsLogin && !credEmail.trim()) {
      pushToast({ title: t("familyEmailRequired"), tone: "warn" });
      return;
    }
    if (credPassword && credPassword.length < 8) {
      pushToast({ title: t("familyPasswordMin"), tone: "warn" });
      return;
    }
    if (needsLogin && !member.hasPassword && !credPassword) {
      pushToast({ title: t("familyPasswordRequired"), tone: "warn" });
      return;
    }
    setBusy(true);
    try {
      await arrabApi.updateFamilyMember(member.id, {
        email: credEmail.trim() || null,
        ...(credPassword ? { password: credPassword } : {}),
      });
      setCredPassword("");
      pushToast({ title: t("familyCredentialsSaved"), tone: "success" });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(member: FamilyMemberPublic) {
    if (member.isOwner) return;
    setBusy(true);
    try {
      await arrabApi.updateFamilyMember(member.id, { isPaused: !member.isPaused });
      pushToast({
        title: member.isPaused ? t("familyMemberResumed") : t("familyMemberPaused"),
        tone: "info",
      });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: FamilyMemberPublic) {
    if (member.isOwner) return;
    setBusy(true);
    try {
      await arrabApi.deleteFamilyMember(member.id);
      if (activeId === member.id) {
        writeActiveFamilyMemberId(null);
        setActiveId(null);
        void refreshFamilyProfile({ silent: true });
      }
      if (selectedId === member.id) setSelectedId(null);
      pushToast({ title: t("familyMemberRemoved"), tone: "info" });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function grantTokens(member: FamilyMemberPublic) {
    const tokens = Number.parseInt(grantAmount.replace(/\D/g, ""), 10);
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    setBusy(true);
    try {
      const next = await arrabApi.grantFamilyTokens({ memberId: member.id, tokens });
      setSnapshot(next);
      setRoomTab("overview");
      pushToast({ title: t("familyTokensGranted"), tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function buySeats(seats: 1 | 2 | 5) {
    setBusy(true);
    try {
      const next = await arrabApi.purchaseFamilySeats({
        seats,
        code: seatCode.trim() || undefined,
      });
      setSnapshot(next);
      setSeatCode("");
      pushToast({ title: t("familySeatsPurchased"), tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendGuidance() {
    if (!selected || !guideCompanionId || !guideText.trim() || !activeManager) return;
    setBusy(true);
    try {
      const note = await arrabApi.addFamilyGuidance({
        companionId: guideCompanionId,
        childMemberId: selected.id,
        authorMemberId: activeManager.id,
        content: guideText.trim(),
      });
      addParentGuidanceFact({
        companionId: guideCompanionId,
        text: guideText.trim(),
        authorName: activeManager.displayName,
      });
      setGuideText("");
      setRoomTab("overview");
      pushToast({
        title: t("familyGuidanceSaved"),
        body: note.authorName,
        tone: "success",
      });
      load();
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <section className={cn("cp-ui sf-shell", className)}>
        <p className="sf-muted">{t("loading")}</p>
      </section>
    );
  }

  if (error && !snapshot?.available) {
    return (
      <section className={cn("cp-ui sf-shell", className)}>
        <h3 className="sf-title">{t("familyHousehold")}</h3>
        <p className="sf-body">{t("familyApiUnreachableBody")}</p>
        <p className="sf-error">{error}</p>
        <button
          type="button"
          className="sf-btn sf-btn-ghost"
          disabled={busy}
          onClick={() => {
            trialAttempted.current = false;
            load();
          }}
        >
          {t("retry")}
        </button>
      </section>
    );
  }

  if (!snapshot?.available) {
    return (
      <section className={cn("cp-ui sf-shell", className)}>
        <h3 className="sf-title">{t("familyHousehold")}</h3>
        <p className="sf-body">{t("familyFreeTrialBody")}</p>
        <button
          type="button"
          className="sf-btn sf-btn-solid"
          disabled={busy}
          onClick={() => void startFamilyFreeTrial()}
        >
          {busy ? t("loading") : t("familyStartFreeTrial")}
        </button>
      </section>
    );
  }

  const memberPct = selected
    ? Math.min(100, Math.max(0, Math.round(selected.usagePercent)))
    : 0;
  const seatsOpen = snapshot.seatsUsed < snapshot.seatLimit;

  return (
    <section className={cn("cp-ui sf-shell", className)}>
      <div className="sf-face-bar">
        <div className="sf-face-list" aria-label={t("familyManagement")}>
          {snapshot.members.map((member) => {
            const count = liveCompanions(companionState).filter(
              (c) => c.familyMemberId === member.id,
            ).length;
            const pressed = !addingMember && selected?.id === member.id;
            return (
              <button
                key={member.id}
                type="button"
                className="sf-face-choice"
                aria-pressed={pressed}
                disabled={busy}
                onClick={() => selectMember(member)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const button = event.currentTarget as HTMLButtonElement;
                  const rect = button.getBoundingClientRect();
                  setFaceMenu({
                    memberId: member.id,
                    centerX: rect.left + rect.width / 2,
                    top: rect.bottom + 6,
                    faceTop: rect.top,
                  });
                }}
              >
                <MemberFaceDisc member={member} on={pressed} />
                <strong className="sf-face-name">{member.displayName}</strong>
                <small>
                  {roleLabel(member.role, t)}
                  {count ? ` · ${count}` : ""}
                </small>
              </button>
            );
          })}
          {seatsOpen ? (
            <button
              type="button"
              className="sf-face-choice"
              aria-pressed={addingMember}
              disabled={busy}
              onClick={() => {
                setAddingMember(true);
                setRoomTab("overview");
              }}
            >
              <span className={cn("sf-face-add", addingMember && "is-on")}>
                <Plus size={22} strokeWidth={1.5} />
              </span>
              <strong>{t("familyAddMember")}</strong>
              <small>
                {snapshot.seatsUsed}/{snapshot.seatLimit} {t("familySeats")}
              </small>
            </button>
          ) : null}
        </div>
        <div className="sf-seat-pill">
          <UsersRound className="size-3.5" strokeWidth={1.8} />
          {snapshot.seatsUsed}/{snapshot.seatLimit}
        </div>
      </div>

      {addingMember ? (
        <AddFamilyMemberWizard
          onClose={() => setAddingMember(false)}
          onCreated={(member, _opts) => {
            setSelectedId(member.id);
            setCredEmail(member.email ?? "");
            setCredPassword("");
            setRoomTab("overview");
            setAddingMember(false);
            load();
          }}
        />
      ) : selected ? (
        <div className="sf-room">
          <header className="sf-room-hero">
            <div className="sf-room-person">
              <MemberFaceDisc member={selected} size="lg" />
              <div className="sf-room-person-copy">
                <strong>
                  {selected.displayName}
                  {selected.isOwner ? (
                    <span className="sf-owner-pill">{t("familyOwner")}</span>
                  ) : null}
                </strong>
                <span className="sf-muted">
                  {roleLabel(selected.role, t)}
                  {selected.ageTier
                    ? ` · ${t(AGE_TIERS.find((a) => a.id === selected.ageTier)?.labelKey ?? "familyAge1013")}`
                    : ""}
                  {selected.isPaused ? ` · ${t("familyPaused")}` : ""}
                </span>
              </div>
            </div>
            {!selected.isOwner ? (
              <div className="sf-room-tools">
                <button
                  type="button"
                  className={cn("sf-tool", selected.isPaused && "is-warn")}
                  disabled={busy}
                  title={selected.isPaused ? t("familyResume") : t("familyPause")}
                  onClick={() => void togglePause(selected)}
                >
                  {selected.isPaused ? (
                    <Play className="size-3.5" strokeWidth={1.8} />
                  ) : (
                    <Pause className="size-3.5" strokeWidth={1.8} />
                  )}
                  <span>{selected.isPaused ? t("familyResume") : t("familyPause")}</span>
                </button>
                <button
                  type="button"
                  className="sf-tool is-danger"
                  disabled={busy}
                  title={t("familyRemove")}
                  onClick={() => void removeMember(selected)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ) : null}
          </header>

          <div className="sf-tabs" role="tablist" aria-label={t("familyManagement")}>
            {(
              [
                { id: "overview" as const, label: t("familyTabOverview") },
                { id: "companions" as const, label: t("familyTabCompanions") },
                ...(selected.role === "child"
                  ? [
                      { id: "guide" as const, label: t("familyTabGuide") },
                      { id: "guardian" as const, label: t("familyTabGuardian") },
                    ]
                  : []),
                { id: "tokens" as const, label: t("familyTabTokens") },
                { id: "login" as const, label: t("familyTabLogin") },
              ] as Array<{ id: RoomTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={roomTab === tab.id}
                className={cn("sf-tab", roomTab === tab.id && "is-on")}
                onClick={() => openRoomTab(selected, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="sf-room-body" role="tabpanel">
            {error ? <p className="sf-error">{error}</p> : null}

            {roomTab === "overview" ? (
              <div className="sf-tab-pane">
                <p className="sf-lead">{t("familyOverviewLead")}</p>
                {snapshot.usage ? (
                  <div className="sf-meter">
                    <div className="sf-meter-labels">
                      <span>{t("familyUsageOverview")}</span>
                      <strong>{usagePct == null ? t("unlimitedTokens") : `${usagePct}%`}</strong>
                    </div>
                    <div className="sf-meter-track" aria-hidden>
                      <div
                        className={cn("sf-meter-fill", snapshot.usage.overLimit && "is-over")}
                        style={{
                          width: `${usagePct == null ? 100 : Math.max(usagePct > 0 ? 4 : 0, usagePct)}%`,
                        }}
                      />
                    </div>
                    <div className="sf-meter-foot">
                      <span>
                        {usagePct == null
                          ? t("unlimitedTokens")
                          : `${usagePct}% ${t("familyUsageUsed")}`}
                      </span>
                      {usagePct != null ? (
                        <span>
                          {Math.max(0, 100 - usagePct)}% {t("usageRemaining")}
                        </span>
                      ) : null}
                    </div>
                    <div className="sf-meter-meta">
                      {poolFreePct != null ? (
                        <span>
                          {poolFreePct}% {t("familyPoolAvailable")}
                        </span>
                      ) : null}
                      <span>
                        {t("familyUsagePeriod")}:{" "}
                        {new Date(snapshot.usage.periodStart).toLocaleDateString()} →{" "}
                        {new Date(snapshot.usage.periodEnd).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="sf-member-meter">
                  <div className="sf-member-meter-labels">
                    <span>{t("familyMemberUsage")}</span>
                    <strong>{memberPct}%</strong>
                  </div>
                  <div className="sf-member-track" aria-hidden>
                    <div
                      className="sf-member-fill"
                      style={{ width: `${Math.max(memberPct > 0 ? 3 : 0, memberPct)}%` }}
                    />
                  </div>
                </div>

                <div className="sf-comp-block">
                  <div className="sf-section-head">
                    <p className="sf-kicker">{t("familyTabCompanions")}</p>
                    <button
                      type="button"
                      className="sf-link"
                      onClick={() => openRoomTab(selected, "companions")}
                    >
                      {t("familyManageCompanions")}
                    </button>
                  </div>
                  {selectedCompanions.length === 0 ? (
                    <p className="sf-muted">{t("familyNoCompanionsYet")}</p>
                  ) : (
                    <div className="sf-comp-faces">
                      {selectedCompanions.map((person) => (
                        <div key={person.id} className="sf-comp-face">
                          <PersonAvatar person={person} size="md" />
                          <strong>{person.name}</strong>
                          <small>{person.domain}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {variant === "full" && snapshot.recentGuidance.length > 0 ? (
                  <div className="sf-guidance">
                    <p className="sf-kicker">{t("familyRecentGuidance")}</p>
                    <ul>
                      {snapshot.recentGuidance.slice(0, 5).map((g) => (
                        <li key={g.id}>
                          <strong>{g.authorName}</strong>
                          <span> · </span>
                          {g.content.slice(0, 160)}
                          {g.content.length > 160 ? "…" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {roomTab === "companions" ? (
              <div className="sf-tab-pane">
                <p className="sf-lead">{t("familyAssignCompanionBody")}</p>
                <div className="sf-comp-faces">
                  {liveCompanions(companionState).map((c) => {
                    const assignedHere = c.familyMemberId === selected.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={cn("sf-comp-face is-btn", assignedHere && "is-on")}
                        onClick={() => {
                          updateCompanion(c.id, {
                            familyMemberId: assignedHere ? null : selected.id,
                          });
                          pushToast({
                            title: assignedHere
                              ? t("familyCompanionUnassigned")
                              : t("familyCompanionAssigned"),
                            body: c.name,
                            tone: "success",
                          });
                        }}
                      >
                        <PersonAvatar person={c} size="md" active={assignedHere} />
                        <strong>{c.name}</strong>
                        <small>{assignedHere ? "✓" : c.domain}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {roomTab === "guide" && selected.role === "child" ? (
              <div className="sf-tab-pane sf-guide">
                <header className="sf-guide-head">
                  <p className="sf-guide-eyebrow">{t("familyGuideEyebrow")}</p>
                  <h3 className="sf-guide-title">{t("familyGuideTitle")}</h3>
                  <p className="sf-lead">{t("familyGuideBody")}</p>
                </header>

                <section className="sf-guide-pick" aria-label={t("familyGuidePickLabel")}>
                  <div className="sf-section-head">
                    <p className="sf-kicker">{t("familyGuidePickLabel")}</p>
                    <span className="sf-guide-count">
                      {guideCompanions.length} {t("familyCompanionsShort")}
                    </span>
                  </div>
                  {guideCompanions.length === 0 ? (
                    <p className="sf-muted">{t("familyGuideNoCompanions")}</p>
                  ) : (
                    <div className="sf-guide-faces">
                      {guideCompanions.map((c) => {
                        const on = guideCompanionId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={cn("sf-guide-face", on && "is-on")}
                            aria-pressed={on}
                            onClick={() => setGuideCompanionId(c.id)}
                          >
                            <PersonAvatar person={c} size="md" active={on} />
                            <span className="sf-guide-face-copy">
                              <strong>{c.name}</strong>
                              <small>{c.domain}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="sf-guide-compose">
                  <div className="sf-guide-compose-top">
                    <label className="sf-kicker" htmlFor="sf-guide-note">
                      {t("familyGuideNoteLabel")}
                    </label>
                    {guideCompanionId ? (
                      <span className="sf-guide-target">
                        {t("familyGuideFor")}{" "}
                        <strong>
                          {guideCompanions.find((c) => c.id === guideCompanionId)?.name ?? "—"}
                        </strong>
                      </span>
                    ) : (
                      <span className="sf-guide-target is-warn">{t("familyPickCompanion")}</span>
                    )}
                  </div>
                  <textarea
                    id="sf-guide-note"
                    value={guideText}
                    onChange={(e) => setGuideText(e.target.value)}
                    rows={6}
                    placeholder={t("familyGuidePlaceholder")}
                    className="sf-guide-editor"
                  />
                  <div className="sf-guide-foot">
                    <p className="sf-guide-privacy">{t("familyGuidePrivacy")}</p>
                    <button
                      type="button"
                      disabled={busy || !guideCompanionId || !guideText.trim() || !activeManager}
                      onClick={() => void sendGuidance()}
                      className="sf-btn sf-btn-solid sf-guide-save"
                    >
                      <MessageSquareHeart className="size-3.5" strokeWidth={1.9} />
                      {t("familySendGuidance")}
                    </button>
                  </div>
                </section>

                {variant === "full" ? (
                  <section className="sf-guide-feed">
                    <p className="sf-kicker">{t("familyRecentGuidance")}</p>
                    {(() => {
                      const notes = snapshot.recentGuidance
                        .filter((g) => g.childMemberId === selected.id)
                        .slice(0, 6);
                      if (notes.length === 0) {
                        return <p className="sf-muted">{t("familyGuideEmpty")}</p>;
                      }
                      return (
                        <ul className="sf-guide-notes">
                          {notes.map((g) => {
                            const author =
                              snapshot.members.find((m) => m.id === g.authorMemberId) ?? null;
                            const companion =
                              liveCompanions(companionState).find((c) => c.id === g.companionId) ??
                              null;
                            const authorFace = author
                              ? resolveMemberFaceUrl({
                                  id: author.id,
                                  role: author.role,
                                  ageTier: author.ageTier,
                                })
                              : null;
                            return (
                              <li key={g.id} className="sf-guide-note">
                                <span
                                  className="sf-face-disc is-sm"
                                  style={authorFace ? undefined : { background: author?.color }}
                                >
                                  {authorFace ? (
                                    <img src={authorFace} alt="" className="sf-face-photo" />
                                  ) : (
                                    (g.authorName || "?").slice(0, 1).toUpperCase()
                                  )}
                                </span>
                                <div className="sf-guide-note-body">
                                  <div className="sf-guide-note-meta">
                                    <strong>{g.authorName}</strong>
                                    {companion ? (
                                      <span className="sf-guide-note-to">
                                        → {companion.name}
                                      </span>
                                    ) : null}
                                    <time dateTime={g.createdAt}>
                                      {new Date(g.createdAt).toLocaleDateString()}
                                    </time>
                                  </div>
                                  <p>{g.content}</p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      );
                    })()}
                  </section>
                ) : null}
              </div>
            ) : null}

            {roomTab === "guardian" && selected.role === "child" ? (
              <div className="sf-tab-pane">
                <GuardianHub
                  child={selected}
                  busy={busy}
                  onTogglePause={(member) => void togglePause(member)}
                />
              </div>
            ) : null}

            {roomTab === "tokens" ? (
              <div className="sf-tab-pane">
                <p className="sf-lead">{t("familyTokensLead")}</p>
                <div className="sf-member-meter">
                  <div className="sf-member-meter-labels">
                    <span>{t("familyMemberUsage")}</span>
                    <strong>{memberPct}%</strong>
                  </div>
                  <div className="sf-member-track" aria-hidden>
                    <div
                      className="sf-member-fill"
                      style={{ width: `${Math.max(memberPct > 0 ? 3 : 0, memberPct)}%` }}
                    />
                  </div>
                </div>
                <div className="sf-inline-form">
                  <input
                    inputMode="numeric"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value.replace(/\D/g, ""))}
                    className="sf-input"
                    placeholder={t("familyTokenAmount")}
                  />
                  <button
                    type="button"
                    className="sf-btn sf-btn-solid"
                    disabled={busy}
                    onClick={() => void grantTokens(selected)}
                  >
                    <Coins className="size-3.5" strokeWidth={1.8} />
                    {t("familyGiveTokens")}
                  </button>
                </div>
              </div>
            ) : null}

            {roomTab === "login" ? (
              <div className="sf-tab-pane">
                <p className="sf-lead">{t("familyCredentialsBody")}</p>
                <p className="sf-muted">
                  {selected.hasPassword ? t("familyHasLogin") : t("familyNoLoginYet")}
                </p>
                <div className="sf-form-grid">
                  <input
                    type="email"
                    autoComplete="off"
                    value={credEmail}
                    onChange={(e) => setCredEmail(e.target.value)}
                    placeholder={t("familyEmailRequired")}
                    className="sf-input"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={credPassword}
                    onChange={(e) => setCredPassword(e.target.value)}
                    placeholder={
                      selected.hasPassword
                        ? t("familyPasswordChangeOptional")
                        : t("familyPasswordRequired")
                    }
                    className="sf-input"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveCredentials()}
                  className="sf-btn sf-btn-solid"
                >
                  <KeyRound className="size-3.5" strokeWidth={1.9} />
                  {t("familySaveCredentials")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="sf-room">
          <div className="sf-room-empty">
            <UserRound className="size-8 opacity-40" strokeWidth={1.4} />
            <p>{ar ? "اختر فرداً من العائلة" : "Pick a family member"}</p>
          </div>
        </div>
      )}

      {variant === "full" ? (
        <div className="sf-panel sf-panel-soft">
          <div className="sf-panel-title-row">
            <ShoppingBag className="size-4" strokeWidth={1.8} />
            {t("familyBuySeats")}
          </div>
          <p className="sf-muted">{t("familyBuySeatsBody")}</p>
          <div className="sf-packs">
            {snapshot.seatPacks.map((pack) => (
              <button
                key={pack.seats}
                type="button"
                disabled={busy}
                onClick={() => void buySeats(pack.seats)}
                className="sf-chip is-pack"
              >
                {pack.label} · {(pack.priceHalalas / 100).toFixed(0)} {t("plansSar")}
              </button>
            ))}
          </div>
          <div className="sf-inline-form">
            <input
              value={seatCode}
              onChange={(e) => setSeatCode(e.target.value.toUpperCase())}
              placeholder={t("familySeatCode")}
              className="sf-input"
            />
            <button
              type="button"
              disabled={busy || !seatCode.trim()}
              onClick={() => void buySeats(1)}
              className="sf-btn sf-btn-solid"
            >
              {t("familyRedeemSeats")}
            </button>
          </div>
        </div>
      ) : null}

      {!seatsOpen ? <p className="sf-muted">{t("familySeatsFull")}</p> : null}

      {faceMenu
        ? (() => {
            const menuMember =
              snapshot.members.find((m) => m.id === faceMenu.memberId) ?? null;
            if (!menuMember || typeof document === "undefined") return null;
            const items: Array<{
              id: string;
              label: string;
              danger?: boolean;
              run: () => void;
            }> = [
              {
                id: "open",
                label: t("familyCtxOpen"),
                run: () => selectMember(menuMember),
              },
              {
                id: "credentials",
                label: t("familyManageCredentials"),
                run: () => openCredentials(menuMember),
              },
              {
                id: "assign",
                label: t("familyAssignTokens"),
                run: () => openGrant(menuMember),
              },
            ];
            if (menuMember.role === "child") {
              items.push({
                id: "guide",
                label: t("familyGuideCompanion"),
                run: () => openGuide(menuMember),
              });
              items.push({
                id: "guardian",
                label: t("familyTabGuardian"),
                run: () => openRoomTab(menuMember, "guardian"),
              });
            }
            items.push({
              id: "companions",
              label: t("familyAssignCompanion"),
              run: () => openAssign(menuMember),
            });
            if (!menuMember.isOwner) {
              items.push({
                id: "pause",
                label: menuMember.isPaused ? t("familyResume") : t("familyPause"),
                run: () => {
                  setFaceMenu(null);
                  void togglePause(menuMember);
                },
              });
              items.push({
                id: "remove",
                label: t("familyRemove"),
                danger: true,
                run: () => {
                  setFaceMenu(null);
                  void removeMember(menuMember);
                },
              });
            }
            return createPortal(
              <div
                ref={faceMenuRef}
                className="sf-face-menu"
                style={{
                  position: "fixed",
                  left: faceMenu.centerX,
                  top: faceMenu.top,
                  transform: "translateX(-50%)",
                  zIndex: 10000,
                }}
                role="menu"
                onContextMenu={(event) => event.preventDefault()}
              >
                <p className="sf-face-menu-head">{menuMember.displayName}</p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={cn("sf-face-menu-item", item.danger && "is-danger")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setFaceMenu(null);
                      item.run();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>,
              document.body,
            );
          })()
        : null}
    </section>
  );
}
