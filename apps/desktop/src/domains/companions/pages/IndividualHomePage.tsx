import { useEffect, useMemo, useState } from "react";
import { applyCompanionPolicy } from "@/domains/managed/client/companions";
import { useCompanionPolicies } from "@/domains/managed/client/hooks";
import { ArrowUpRight, MessageSquare, Plus, Sparkles, UsersRound, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { useRole } from "@/domains/account/roles/RoleProvider";
import { workDestination } from "@/domains/chat/lib/work-navigation";
import {
  boardCards,
  boardDueWork,
  boardOpenThreads,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  dismissCard,
  findCompanion,
  generalCompanion,
  liveCompanions,
  markOpened,
  nudgeBudgetLeft,
  isSensitiveNow,
  returningAfterAbsence,
  runSignals,
  silentCompanions,
  useCompanionState,
  WEEKLY_NUDGE_CEILING,
  type CompanionProfile,
} from "@/domains/companions/model/companions";
import { kidBoardSuggestions } from "@/domains/companions/catalog/suggestions";
import {
  CompanionEmpty,
  CompanionPageHeader,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/domains/companions/ui/CompanionUI";
import { arrabApi, ApiRequestError } from "@/core/api/api";
import { pushToast } from "@/domains/notifications/notify";
import { useFamilyProfile } from "@/domains/family/use-family-profile";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { audienceFromPlanId } from "@/domains/account/roles/catalog";
import type { FamilyMemberPublic, FamilyMemberRole } from "@arrab/shared";
import { cn } from "@/shared/lib/utils";
import { FamilyCompanionWizard } from "@/domains/companions/ui/FamilyCompanionWizard";
import { AddFamilyMemberWizard } from "@/domains/family/ui/AddFamilyMemberWizard";
import { ensureCompanionCloudRoom } from "@/domains/companions/ui/hooks/useCompanionRoom";
import { resolveMemberFaceUrl } from "@/domains/family/family-portraits";
import { AudiencePulse, FaceStatusDot } from "@/shared/ui/AudiencePulse";
import {
  getDowntime,
  isWithinDowntime,
  useGuardianStore,
} from "@/domains/family/guardian-store";

function roleLabel(
  role: FamilyMemberRole,
  t: (key: "familyRoleParent" | "familyRolePartner" | "familyRoleChild") => string,
): string {
  if (role === "parent") return t("familyRoleParent");
  if (role === "partner") return t("familyRolePartner");
  return t("familyRoleChild");
}

function memberFaceLabel(
  member: FamilyMemberPublic,
  t: (
    key:
      | "familyRoleParent"
      | "familyRolePartner"
      | "familyRoleChild"
      | "familyAgeShort69"
      | "familyAgeShort1013"
      | "familyAgeShort1417",
  ) => string,
): string {
  if (member.role !== "child") return roleLabel(member.role, t);
  if (member.ageTier === "tier_6_9") return t("familyAgeShort69");
  if (member.ageTier === "tier_10_13") return t("familyAgeShort1013");
  if (member.ageTier === "tier_14_17") return t("familyAgeShort1417");
  return roleLabel(member.role, t);
}

export function IndividualHomePage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href, isFamily } = useRole();
  const { signedIn, account, status } = useSignedInAccount();
  const familyPlan =
    signedIn &&
    audienceFromPlanId(account?.planId ?? status?.entitlements?.planId ?? null) === "family";
  const familyLive = Boolean(isFamily && familyPlan);
  const {
    active: familyActive,
    isChild: isFamilyChildSeat,
    isManager,
    refresh: refreshFamily,
  } = useFamilyProfile();
  const isFamilyChild = familyLive && isFamilyChildSeat;
  const navigate = useNavigate();
  const state = useCompanionState();
  const [space, setSpace] = useCompanionSpace();
  const [returning] = useState(returningAfterAbsence);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberPublic[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCompanionId, setFocusCompanionId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMemberId, setWizardMemberId] = useState<string | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [seatLimit, setSeatLimit] = useState(0);
  const [seatsUsed, setSeatsUsed] = useState(0);

  useEffect(() => {
    runSignals();
    markOpened();
  }, [space]);

  useEffect(() => {
    if (!familyLive) {
      setFamilyMembers([]);
      return;
    }
    void arrabApi
      .familyHousehold()
      .then((snap) => {
        if (snap.available) {
          setFamilyMembers(snap.members);
          setSeatLimit(snap.seatLimit);
          setSeatsUsed(snap.seatsUsed);
          setSelectedId((current) => {
            if (current && snap.members.some((m) => m.id === current)) return current;
            return (
              snap.members.find((m) => m.id === familyActive?.id)?.id ??
              snap.members.find((m) => m.isOwner)?.id ??
              snap.members[0]?.id ??
              null
            );
          });
        }
      })
      .catch(() => setFamilyMembers([]));
  }, [familyLive, familyActive?.id]);

  const reloadHousehold = () => {
    void arrabApi
      .familyHousehold()
      .then((snap) => {
        if (snap.available) {
          setFamilyMembers(snap.members);
          setSeatLimit(snap.seatLimit);
          setSeatsUsed(snap.seatsUsed);
        }
      })
      .catch(() => undefined);
  };

  /** Household companions for a seat — across personal/work so kids always see parent-added ones. */
  const householdCompanions = useMemo(() => {
    return liveCompanions(state).filter((c) => !c.archivedAt && c.domain !== "general");
  }, [state]);

  const companionPolicies = useCompanionPolicies();
  const companions = useMemo(() => {
    const pool = (() => {
      if (!familyLive || !familyActive) {
        return liveCompanions(state, space).filter((c) => c.domain !== "general");
      }
      if (isFamilyChild) {
        return householdCompanions.filter((c) => c.familyMemberId === familyActive.id);
      }
      return householdCompanions;
    })();
    return applyCompanionPolicy(pool, companionPolicies);
  }, [state, space, familyLive, familyActive, isFamilyChild, householdCompanions, companionPolicies]);

  const boardAllowedIds = useMemo(() => {
    if (!familyLive || !familyActive) return null;
    const ids = new Set(companions.map((c) => c.id));
    const general = generalCompanion(state, space, familyActive.id);
    ids.add(general.id);
    return ids;
  }, [familyLive, familyActive, companions, state, space]);

  const cards = boardCards(state, space, boardAllowedIds).slice(0, returning ? 1 : 3);
  const quiet = silentCompanions(state, space, cards).filter(
    (person) =>
      person.domain !== "general" &&
      (!boardAllowedIds || boardAllowedIds.has(person.id)),
  );
  const roster = useMemo(() => {
    const people = liveCompanions(state, space).filter((person) => !person.archivedAt);
    return people;
  }, [state, space]);
  const dueWork = useMemo(() => boardDueWork(state, space), [state, space]);
  const openThreads = useMemo(() => boardOpenThreads(state, space), [state, space]);
  const nudgeLeft = nudgeBudgetLeft(state);
  const general = generalCompanion(state, space, familyLive ? familyActive?.id : null);

  const visibleMembers = useMemo(() => {
    if (!isFamilyChild || isManager) return familyMembers;
    return familyMembers.filter((m) => m.id === familyActive?.id);
  }, [familyMembers, isFamilyChild, isManager, familyActive?.id]);

  const childMembers = useMemo(
    () => visibleMembers.filter((m) => m.role === "child"),
    [visibleMembers],
  );

  const selected = useMemo(
    () => visibleMembers.find((m) => m.id === selectedId) ?? visibleMembers[0] ?? null,
    [visibleMembers, selectedId],
  );

  const selectedCompanions = useMemo(() => {
    if (!selected) return [];
    return companions.filter((c) => c.familyMemberId === selected.id);
  }, [companions, selected]);

  const kidCompanions = companions;

  const activeCompanion = useMemo(() => {
    const list = isFamilyChild ? kidCompanions : selectedCompanions;
    if (!list.length) return null;
    return list.find((c) => c.id === focusCompanionId) ?? list[0] ?? null;
  }, [isFamilyChild, kidCompanions, selectedCompanions, focusCompanionId]);

  useEffect(() => {
    const list = isFamilyChild ? kidCompanions : selectedCompanions;
    if (!list.length) {
      setFocusCompanionId(null);
      return;
    }
    if (!focusCompanionId || !list.some((c) => c.id === focusCompanionId)) {
      setFocusCompanionId(list[0]!.id);
    }
  }, [isFamilyChild, kidCompanions, selectedCompanions, focusCompanionId, selected?.id]);

  const seatsAvailable = seatLimit <= 0 || seatsUsed < seatLimit;
  const guardianStore = useGuardianStore();
  const pausedKids = childMembers.filter((m) => m.isPaused).length;
  const quietNow = childMembers.filter((m) => isWithinDowntime(getDowntime(m.id))).length;
  const pendingApprovals = guardianStore.approvals.filter((a) => a.status === "pending").length;

  const urgent = cards.find(
    (card) =>
      state.nudges.some((nudge) => nudge.id === card.nudgeId && nudge.level === "critical") ||
      state.work.some(
        (work) =>
          work.id === card.workId &&
          work.suggestedTime &&
          new Date(work.suggestedTime).getTime() <= Date.now(),
      ),
  );

  function selectMember(member: FamilyMemberPublic) {
    setSelectedId(member.id);
    setFocusCompanionId(null);
  }

  function openCompanionChat(person: CompanionProfile, draft?: string) {
    try {
      localStorage.setItem(COMPANION_FOCUS_KEY, person.id);
      if (draft?.trim()) {
        sessionStorage.setItem(COMPANION_DRAFT_KEY, draft.trim());
      }
    } catch {
      /* ignore */
    }
    navigate(href("/"));
  }

  function openCompanionWizard(memberId: string) {
    setWizardMemberId(memberId);
    setWizardOpen(true);
  }

  function onWizardCreated(person: CompanionProfile) {
    void ensureCompanionCloudRoom(person).catch(() => undefined);
    pushToast({
      title: t("familyBoardCompanionCreated"),
      body: person.name,
      tone: "success",
    });
    setFocusCompanionId(person.id);
    openCompanionChat(person);
  }

  const seatCompanionLabel = (count: number) =>
    count === 1
      ? t("familyBoardSeatCountOne")
      : t("familyBoardSeatCount").replace("{count}", String(count));

  const memberPct = selected
    ? Math.min(100, Math.max(0, Math.round(selected.usagePercent)))
    : 0;

  const showFamilyBoard = familyLive && visibleMembers.length > 0;
  const showAttention = !isFamilyChild;

  return (
    <div className={cn("cp-ui cp-page", showFamilyBoard && "fb-chat-board")}>
      {!isFamilyChild && !showFamilyBoard ? (
        <>
          <CompanionPageHeader title={t("compBoard")} subtitle={t("compBoardSubtitle")}>
            <SpaceSwitch value={space} onChange={setSpace} />
          </CompanionPageHeader>
          <AudiencePulse
            className="is-wide"
            items={[
              {
                id: "companions",
                label: t("pulseCompanions"),
                value: roster.length,
                tone: roster.length ? "live" : "default",
              },
              {
                id: "attention",
                label: t("pulseAttention"),
                value: cards.length,
                tone: cards.length ? "ok" : "default",
              },
              {
                id: "due",
                label: t("compBoardDue"),
                value: dueWork.length,
                tone: dueWork.length ? "warn" : "default",
              },
              {
                id: "quiet",
                label: t("pulseQuiet"),
                value: quiet.length,
              },
            ]}
          />
          <div className="cp-board-top">
            <p className="cp-muted cp-board-budget">
              {isSensitiveNow(state)
                ? t("compNudgeSilenced")
                : t("compNudgeBudget")
                    .replace("{left}", String(nudgeLeft))
                    .replace("{total}", String(WEEKLY_NUDGE_CEILING))}
            </p>
            <div className="cp-board-top-actions">
              <Link className="cp-button" to={href("/studio")}>
                <Sparkles size={15} />
                {t("studio")}
              </Link>
              <Link className="cp-button" to={href("/")}>
                <MessageSquare size={15} />
                {t("chat")}
              </Link>
            </div>
          </div>

          {roster.length > 0 ? (
            <div className="cp-face-bar cp-board-roster" aria-label={t("pulseCompanions")}>
              <div className="cp-face-list">
                {roster.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="cp-face-choice"
                    onClick={() => openCompanionChat(person)}
                  >
                    <PersonAvatar person={person} size="lg" />
                    <strong>
                      {person.domain === "general" ? t("compGeneral") : person.name}
                    </strong>
                    <small>
                      {person.resume?.trim()
                        ? person.resume.trim().slice(0, 28)
                        : person.lastLine?.trim()
                          ? person.lastLine.trim().slice(0, 28)
                          : person.domain === "general"
                            ? t("compBoardReady")
                            : person.domain}
                    </small>
                  </button>
                ))}
                <button
                  type="button"
                  className="cp-face-choice"
                  onClick={() => navigate(href("/studio"))}
                >
                  <span className="cp-add-face">
                    <Plus size={21} strokeWidth={1.5} />
                  </span>
                  <strong>{t("compBoardAdd")}</strong>
                  <small>{t("compBoardAddHint")}</small>
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showFamilyBoard && isFamilyChild ? (
        <section className="fb-chat-shell" aria-label={t("familyBoardKidTitle")}>
          <header className="cp-chat-heading fb-chat-heading">
            <div>
              <p className="cp-eyebrow">ARRAB / {t("chat").toUpperCase()}</p>
              <h1>{t("familyBoardKidTitle")}</h1>
              <p className="fb-chat-lead">{t("familyBoardKidBody")}</p>
              <AudiencePulse
                items={[
                  {
                    id: "companions",
                    label: t("pulseCompanions"),
                    value: kidCompanions.length,
                    tone: kidCompanions.length ? "live" : "default",
                  },
                ]}
              />
            </div>
            <Link className="cp-button" to={href("/")}>
              <MessageSquare size={15} />
              {t("chat")}
            </Link>
          </header>

          {kidCompanions.length > 0 ? (
            <>
              <div className="cp-face-bar fb-chat-faces">
                <div className="cp-face-list" aria-label={t("familyBoardKidTitle")}>
                  {kidCompanions.map((person) => {
                    const pressed = activeCompanion?.id === person.id;
                    return (
                      <button
                        key={person.id}
                        type="button"
                        className="cp-face-choice fb-seat-face"
                        aria-pressed={pressed}
                        onClick={() => setFocusCompanionId(person.id)}
                      >
                        <PersonAvatar person={person} active={pressed} size="lg" />
                        <strong>{person.name}</strong>
                        <small>{person.domain}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeCompanion ? (
                <div className="cp-room fb-chat-room">
                  <header className="cp-room-header">
                    <div className="cp-room-person">
                      <PersonAvatar person={activeCompanion} size="sm" />
                      <strong>{activeCompanion.name}</strong>
                      <span className="cp-muted">
                        {activeCompanion.brief?.slice(0, 72) ||
                          activeCompanion.domain ||
                          t("familyBoardKidTalk")}
                      </span>
                    </div>
                    <div className="cp-room-actions">
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() => openCompanionChat(activeCompanion)}
                      >
                        <MessageSquare size={14} strokeWidth={1.8} />
                        {t("familyBoardKidTalk")}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </header>
                  <div className="cp-room-body fb-chat-room-body fb-chat-stage">
                    <div className="cp-chat-welcome fb-stage-welcome">
                      <span className="cp-welcome-icon" aria-hidden>
                        <Sparkles size={28} strokeWidth={1.35} />
                      </span>
                      <p className="cp-eyebrow">{t("familyBoardKidStarters")}</p>
                      <h2>
                        {ar ? `مرحباً — ${activeCompanion.name} هنا` : `Hi — ${activeCompanion.name} is here`}
                      </h2>
                      <div className="cp-starters fb-kid-starter-row">
                        {kidBoardSuggestions(activeCompanion).map((starter) => (
                          <button
                            key={starter.id}
                            type="button"
                            className="fb-chat-chip"
                            onClick={() =>
                              openCompanionChat(
                                activeCompanion,
                                ar ? starter.promptAr : starter.promptEn,
                              )
                            }
                          >
                            {ar ? starter.labelAr : starter.labelEn}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="cp-room fb-chat-room fb-chat-empty">
              <div className="cp-chat-welcome fb-stage-welcome">
                <span className="cp-welcome-icon" aria-hidden>
                  <UsersRound size={28} strokeWidth={1.35} />
                </span>
                <p className="cp-eyebrow">ARRAB</p>
                <h2>{t("familyNoCompanionsYet")}</h2>
                <p className="cp-muted">{t("familyBoardKidWaitBody")}</p>
                <Link className="cp-button" to={href("/")}>
                  <Plus size={14} strokeWidth={1.8} />
                  {t("guardianAskShort")}
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {showFamilyBoard && !isFamilyChild ? (
        <section className="fb-chat-shell" aria-label={t("familyBoardTitle")}>
          <header className="cp-chat-heading fb-chat-heading">
            <div>
              <p className="cp-eyebrow">ARRAB / {t("compBoard").toUpperCase()}</p>
              <h1>{t("familyBoardTitle")}</h1>
              <p className="fb-chat-lead">{t("familyBoardFamilyLead")}</p>
              <AudiencePulse
                items={[
                  {
                    id: "seats",
                    label: t("pulseSeats"),
                    value: `${seatsUsed}/${seatLimit || "—"}`,
                  },
                  {
                    id: "paused",
                    label: t("pulsePaused"),
                    value: pausedKids,
                    tone: pausedKids > 0 ? "warn" : "default",
                  },
                  {
                    id: "quiet",
                    label: t("pulseQuietNow"),
                    value: quietNow,
                    tone: quietNow > 0 ? "live" : "default",
                  },
                  {
                    id: "approvals",
                    label: t("pulseApprovals"),
                    value: pendingApprovals,
                    tone: pendingApprovals > 0 ? "warn" : "ok",
                  },
                ]}
              />
            </div>
            <div className="fb-chat-heading-actions">
              <div className="sf-seat-pill" title={`${seatsUsed}/${seatLimit || "—"}`}>
                <UsersRound className="size-3.5" strokeWidth={1.8} />
                {seatsUsed}/{seatLimit || "—"}
              </div>
              <Link className="cp-button" to={href("/")}>
                <MessageSquare size={15} />
                {t("chat")}
              </Link>
            </div>
          </header>

          <div className="cp-face-bar fb-chat-faces">
            <div className="cp-face-list" aria-label={t("familyBoardTitle")}>
              {visibleMembers.map((member) => {
                const count = companions.filter((c) => c.familyMemberId === member.id).length;
                const pressed = selected?.id === member.id;
                const photoUrl = resolveMemberFaceUrl({
                  id: member.id,
                  role: member.role,
                  ageTier: member.ageTier,
                });
                return (
                  <button
                    key={member.id}
                    type="button"
                    className="cp-face-choice fb-seat-face"
                    aria-pressed={pressed}
                    onClick={() => selectMember(member)}
                  >
                    <span className="aud-face-wrap">
                      <span className={cn("sf-face-disc", pressed && "is-on")}>
                        <img src={photoUrl} alt="" className="sf-face-photo" />
                      </span>
                      {member.isPaused ? (
                        <FaceStatusDot tone="warn" label={t("familyPaused")} />
                      ) : member.role === "child" && isWithinDowntime(getDowntime(member.id)) ? (
                        <FaceStatusDot tone="quiet" label={t("familyFaceQuiet")} />
                      ) : null}
                    </span>
                    <strong title={member.displayName}>{member.displayName}</strong>
                    <small>
                      {memberFaceLabel(member, t)}
                      {count ? ` · ${count}` : ""}
                    </small>
                  </button>
                );
              })}
              {isManager && seatsAvailable ? (
                <button
                  type="button"
                  className="cp-face-choice fb-seat-face"
                  aria-pressed={addMemberOpen}
                  onClick={() => setAddMemberOpen(true)}
                >
                  <span className={cn("cp-add-face cp-add-face-lg", addMemberOpen && "is-active")}>
                    <Plus size={22} strokeWidth={1.5} />
                  </span>
                  <strong>{t("afmTitle")}</strong>
                  <small>
                    {seatsUsed}/{seatLimit || "—"}
                  </small>
                </button>
              ) : null}
            </div>
          </div>

          {selected ? (
            <div className="cp-room fb-chat-room fb-stage-room">
              <header className="cp-room-header fb-stage-header">
                <div className="cp-room-person">
                  <span className="sf-face-disc is-sm" style={{ background: selected.color }}>
                    {selected.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <strong title={selected.displayName}>
                    {selected.displayName}
                    {selected.isOwner ? ` · ${t("familyOwner")}` : ""}
                  </strong>
                  <span className="cp-muted">
                    {memberFaceLabel(selected, t)}
                    {selected.isPaused ? ` · ${t("familyPaused")}` : ""}
                    {` · ${seatCompanionLabel(selectedCompanions.length)}`}
                  </span>
                </div>
                <div className="cp-room-actions">
                  {memberPct > 0 ? (
                    <span className="fb-usage-chip">
                      {t("familyBoardUsageChip").replace("{pct}", String(memberPct))}
                    </span>
                  ) : null}
                  {isManager && selected.role === "child" ? (
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() => openCompanionWizard(selected.id)}
                    >
                      <Plus className="size-3.5" strokeWidth={1.8} />
                      {t("familyWizardTitle")}
                    </button>
                  ) : null}
                  {isManager && childMembers.length === 0 ? (
                    <Link className="cp-button" to={href("/settings?tab=family")}>
                      {t("familyBoardManageSeats")}
                    </Link>
                  ) : null}
                </div>
              </header>

              <div className="cp-messages fb-chat-stage">
                {selectedCompanions.length > 0 ? (
                  <>
                    <div className="cp-face-bar fb-chat-faces is-nested">
                      <div className="cp-face-list" aria-label={t("familyAssignCompanion")}>
                        {selectedCompanions.map((person) => {
                          const pressed = activeCompanion?.id === person.id;
                          return (
                            <button
                              key={person.id}
                              type="button"
                              className="cp-face-choice fb-seat-face"
                              aria-pressed={pressed}
                              onClick={() => setFocusCompanionId(person.id)}
                            >
                              <PersonAvatar person={person} active={pressed} size="lg" />
                              <strong>{person.name}</strong>
                              <small>{person.domain}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeCompanion ? (
                      <div className="cp-chat-welcome fb-stage-welcome is-compact">
                        <div className="fb-chat-welcome-row">
                          <PersonAvatar person={activeCompanion} size="md" />
                          <div>
                            <p className="cp-eyebrow">{activeCompanion.domain}</p>
                            <h2>{activeCompanion.name}</h2>
                            <p className="cp-muted">
                              {activeCompanion.brief?.slice(0, 120) || activeCompanion.domain}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="cp-button"
                            onClick={() => openCompanionChat(activeCompanion)}
                          >
                            <MessageSquare size={14} strokeWidth={1.8} />
                            {t("familyBoardKidTalk")}
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {selected.role === "child" ? (
                          <div className="cp-starters fb-kid-starter-row">
                            {kidBoardSuggestions(activeCompanion).map((starter) => (
                              <button
                                key={starter.id}
                                type="button"
                                className="fb-chat-chip"
                                onClick={() =>
                                  openCompanionChat(
                                    activeCompanion,
                                    ar ? starter.promptAr : starter.promptEn,
                                  )
                                }
                              >
                                {ar ? starter.labelAr : starter.labelEn}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="cp-chat-welcome fb-stage-welcome">
                    <span
                      className="cp-welcome-icon fb-seat-orb"
                      style={{ background: selected.color }}
                      aria-hidden
                    >
                      {selected.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <p className="cp-eyebrow">
                      {selected.role === "child"
                        ? memberFaceLabel(selected, t).toUpperCase()
                        : t("familyBoardParentHint").toUpperCase()}
                    </p>
                    <h2 title={selected.displayName}>
                      {selected.role === "child"
                        ? t("familyBoardEmptyChildTitle")
                        : selected.displayName}
                    </h2>
                    <p className="cp-muted">
                      {selected.role === "child"
                        ? t("familyBoardAddCompanionHint")
                        : t("familyBoardEmptyParent")}
                    </p>

                    {selected.role !== "child" && childMembers.length > 0 ? (
                      <div className="fb-stage-kids" role="group" aria-label={t("familyBoardActionKids")}>
                        {childMembers.map((kid) => {
                          const kidCount = companions.filter((c) => c.familyMemberId === kid.id).length;
                          return (
                            <button
                              key={kid.id}
                              type="button"
                              className="fb-stage-kid"
                              onClick={() => openCompanionWizard(kid.id)}
                            >
                              <span className="sf-face-disc is-sm" style={{ background: kid.color }}>
                                {kid.displayName.slice(0, 1).toUpperCase()}
                              </span>
                              <span className="fb-stage-kid-copy">
                                <strong>{kid.displayName}</strong>
                                <small>
                                  {memberFaceLabel(kid, t)}
                                  {` · ${seatCompanionLabel(kidCount)}`}
                                </small>
                              </span>
                              <span className="fb-stage-kid-cta">
                                {t("familyBoardForKid").replace("{name}", kid.displayName)}
                                <ArrowUpRight size={14} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="fb-stage-actions">
                      {isManager && selected.role === "child" ? (
                        <button
                          type="button"
                          className="cp-button"
                          onClick={() => openCompanionWizard(selected.id)}
                        >
                          <Plus size={14} strokeWidth={1.8} />
                          {t("familyWizardTitle")}
                        </button>
                      ) : (
                        <>
                          <Link className="cp-button" to={href("/")}>
                            <MessageSquare size={14} strokeWidth={1.8} />
                            {t("familyBoardActionChat")}
                          </Link>
                          {isManager ? (
                            <button
                              type="button"
                              className="cp-text-button"
                              onClick={() => openCompanionWizard(selected.id)}
                            >
                              <Plus size={14} strokeWidth={1.8} />
                              {t("familyWizardTitle")}
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {showAttention ? (
        <div className={cn("fb-attention", showFamilyBoard && "is-docked")}>
          {returning && cards.length ? <p className="cp-quiet-box">{t("compBoardBack")}</p> : null}
          {!cards.length ? (
            showFamilyBoard ? (
              <div className="fb-attention-quiet">
                <span className="fb-attention-orb" aria-hidden>
                  <Sparkles size={16} strokeWidth={1.6} />
                </span>
                <div>
                  <strong>{t("familyBoardAttentionQuiet")}</strong>
                  <p>{t("compQuietHint")}</p>
                </div>
              </div>
            ) : (
              <div className="cp-board-empty">
                <CompanionEmpty title={t("compBoardEmpty")}>{t("compQuietHint")}</CompanionEmpty>
                <div className="cp-board-empty-actions">
                  <button
                    type="button"
                    className="cp-button"
                    onClick={() => openCompanionChat(general, undefined)}
                  >
                    <MessageSquare size={15} />
                    {t("compBoardTalkGeneral")}
                    <ArrowUpRight size={14} />
                  </button>
                  <Link className="cp-button" to={href("/studio")}>
                    <Plus size={15} />
                    {t("compBoardAdd")}
                  </Link>
                  <Link className="cp-button" to={href(`/work?space=${space}`)}>
                    {t("compCapture")}
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            )
          ) : (
            <div className="cp-board-grid">
              {cards.map((card) => {
                const person = findCompanion(state, card.companionId);
                const isUrgent =
                  card.level === "critical" ||
                  card.id === urgent?.id;
                return (
                  <article
                    key={card.id}
                    className={cn("cp-board-card", isUrgent && "cp-urgent")}
                  >
                    <header>
                      {person ? <PersonAvatar person={person} size="md" /> : null}
                      <div>
                        <strong>
                          {person?.domain === "general" ? t("compGeneral") : person?.name}
                        </strong>
                        <small>
                          {card.kind === "work"
                            ? t("compBoardKindWork")
                            : card.kind === "thread"
                              ? t("compBoardKindThread")
                              : card.kind === "birth"
                                ? t("compBoardKindBirth")
                                : card.source}
                        </small>
                      </div>
                      <button
                        className="cp-icon"
                        aria-label={t("compDismiss")}
                        onClick={() => dismissCard(card)}
                      >
                        <X size={16} />
                      </button>
                    </header>
                    <p>{card.line}</p>
                    <button
                      className="cp-button"
                      onClick={() => {
                        if (card.birthDomain) {
                          navigate(href(`/studio?birth=${encodeURIComponent(card.birthDomain)}`));
                          return;
                        }
                        if (card.workId || card.threadId) {
                          navigate(href(workDestination(card)));
                          return;
                        }
                        sessionStorage.setItem(COMPANION_FOCUS_KEY, card.companionId);
                        sessionStorage.setItem(COMPANION_DRAFT_KEY, card.line);
                        navigate(href("/"));
                      }}
                    >
                      {card.birthDomain
                        ? t("compBoardMeet")
                        : card.workId
                          ? ar
                            ? "راجع المهمة"
                            : "Review task"
                          : card.threadId
                            ? ar
                              ? "افتح الموضوع"
                              : "Open topic"
                            : ar
                              ? "نتكلم عنها"
                              : "Let's talk"}
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {!showFamilyBoard && (dueWork.length > 0 || openThreads.length > 0) ? (
            <div className="cp-board-rails">
              {dueWork.length > 0 ? (
                <section className="cp-board-rail" aria-label={t("compBoardDue")}>
                  <header>
                    <strong>{t("compBoardDue")}</strong>
                    <span>{dueWork.length}</span>
                  </header>
                  <ul>
                    {dueWork.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              href(
                                workDestination({
                                  workId: item.id,
                                  threadId: null,
                                  space,
                                }),
                              ),
                            )
                          }
                        >
                          <span>{item.text}</span>
                          <small>{item.state === "suggested" ? t("compBoardSuggested") : item.capturedFrom}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {openThreads.length > 0 ? (
                <section className="cp-board-rail" aria-label={t("compBoardThreads")}>
                  <header>
                    <strong>{t("compBoardThreads")}</strong>
                    <span>{openThreads.length}</span>
                  </header>
                  <ul>
                    {openThreads.slice(0, 5).map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              href(
                                workDestination({
                                  workId: null,
                                  threadId: thread.id,
                                  space,
                                }),
                              ),
                            )
                          }
                        >
                          <span>{thread.title}</span>
                          <small>{thread.open}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {quiet.length ? (
            <div className="cp-quiet-people">
              <div>
                {quiet.slice(0, 4).map((person) => (
                  <PersonAvatar person={person} key={person.id} size="sm" />
                ))}
              </div>
              <p>
                {(quiet.length === 1 ? t("compBoardSilenceOne") : t("compBoardSilence")).replace(
                  "{names}",
                  quiet.map((person) => person.name).join(ar ? " و" : " and "),
                )}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {addMemberOpen ? (
        <AddFamilyMemberWizard
          onClose={() => setAddMemberOpen(false)}
          onCreated={(member, opts) => {
            setFamilyMembers((prev) =>
              prev.some((m) => m.id === member.id) ? prev : [...prev, member],
            );
            reloadHousehold();
            refreshFamily();
            setSelectedId(member.id);
            if (opts.openCompanionWizard) {
              setWizardMemberId(member.id);
              setWizardOpen(true);
            }
          }}
        />
      ) : null}

      {wizardOpen && familyMembers.length > 0 ? (
        <FamilyCompanionWizard
          space={space}
          members={familyMembers}
          defaultMemberId={wizardMemberId}
          onClose={() => setWizardOpen(false)}
          onCreated={onWizardCreated}
        />
      ) : null}
    </div>
  );
}
