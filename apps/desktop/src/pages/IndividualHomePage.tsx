import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, MessageSquare, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { workDestination } from "@/lib/work-navigation";
import {
  boardCards,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  dismissCard,
  findCompanion,
  liveCompanions,
  markOpened,
  returningAfterAbsence,
  runSignals,
  silentCompanions,
  useCompanionState,
} from "@/lib/companions";
import {
  CompanionEmpty,
  CompanionPageHeader,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/components/companions/CompanionUI";
import { arrabApi } from "@/lib/api";
import { useFamilyProfile } from "@/lib/use-family-profile";
import type { FamilyMemberPublic } from "@arrab/shared";

export function IndividualHomePage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href, isFamily } = useRole();
  const { active: familyActive, isChild: isFamilyChild, isManager } = useFamilyProfile();
  const navigate = useNavigate();
  const state = useCompanionState();
  const [space, setSpace] = useCompanionSpace();
  const [returning] = useState(returningAfterAbsence);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberPublic[]>([]);
  useEffect(() => {
    runSignals();
    markOpened();
  }, []);
  useEffect(() => {
    if (!isFamily) {
      setFamilyMembers([]);
      return;
    }
    void arrabApi
      .familyHousehold()
      .then((snap) => {
        if (snap.available) setFamilyMembers(snap.members);
      })
      .catch(() => setFamilyMembers([]));
  }, [isFamily]);
  const cards = boardCards(state, space).slice(0, returning ? 1 : 3);
  const quiet = silentCompanions(state, space, cards).filter(
    (person) => person.domain !== "general",
  );
  const companions = useMemo(() => {
    const all = liveCompanions(state, space);
    if (!isFamily || !familyActive) return all;
    if (isFamilyChild) {
      return all.filter(
        (c) => !c.familyMemberId || c.familyMemberId === familyActive.id,
      );
    }
    return all;
  }, [state, space, isFamily, familyActive, isFamilyChild]);
  const visibleMembers = useMemo(() => {
    if (!isFamilyChild || isManager) return familyMembers;
    return familyMembers.filter((m) => m.id === familyActive?.id);
  }, [familyMembers, isFamilyChild, isManager, familyActive?.id]);
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
  return (
    <div className="cp-ui cp-page">
      <CompanionPageHeader
        title={t("compBoard")}
        subtitle={
          ar
            ? "ما يستحق انتباهك فقط. والباقي ينتظر."
            : "Only what deserves your attention. The rest can wait."
        }
      >
        <SpaceSwitch value={space} onChange={setSpace} />
      </CompanionPageHeader>
      <div className="cp-board-top">
        <span>
          {new Date().toLocaleDateString(locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
        <Link className="cp-button" to={href("/")}>
          <MessageSquare size={15} />
          {t("chat")}
        </Link>
      </div>

      {isFamily && visibleMembers.length > 0 ? (
        <section className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold tracking-tight text-neutral-800">
            {t("familyBoardTitle")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleMembers.map((member) => {
              const theirs = companions.filter((c) => c.familyMemberId === member.id);
              return (
                <article
                  key={member.id}
                  className="rounded-2xl border border-black/8 bg-white/80 p-4 shadow-sm"
                >
                  <header className="mb-3 flex items-center gap-3">
                    <span
                      className="grid size-9 place-items-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: member.color }}
                    >
                      {member.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{member.displayName}</strong>
                      <small className="text-neutral-500">
                        {member.role}
                        {member.isPaused ? ` · ${t("familyPaused")}` : ""}
                        {` · ${theirs.length} ${t("familyCompanionsShort")}`}
                      </small>
                    </div>
                  </header>
                  {theirs.length === 0 ? (
                    <p className="text-xs text-neutral-500">{t("familyNoCompanionsYet")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {theirs.slice(0, 4).map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-start hover:bg-neutral-100"
                            onClick={() => {
                              try {
                                localStorage.setItem(COMPANION_FOCUS_KEY, person.id);
                              } catch {
                                // ignore
                              }
                              navigate(href("/"));
                            }}
                          >
                            <PersonAvatar person={person} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {person.name}
                            </span>
                            <ArrowUpRight size={14} className="opacity-50" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-neutral-800"
                      style={{
                        width: `${Math.max(member.usagePercent > 0 ? 3 : 0, member.usagePercent)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-neutral-500">
                    {member.tokensUsed.toLocaleString()} / {member.tokenAllowance.toLocaleString()}{" "}
                    {t("usageTokensUsed").toLowerCase()}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {returning && cards.length ? <p className="cp-quiet-box">{t("compBoardBack")}</p> : null}
      {!cards.length ? (
        <CompanionEmpty title={t("compBoardEmpty")}>{t("compQuietHint")}</CompanionEmpty>
      ) : (
        <div className="cp-board-grid">
          {cards.map((card) => {
            const person = findCompanion(state, card.companionId);
            return (
              <article
                key={card.id}
                className={`cp-board-card ${card.id === urgent?.id ? "cp-urgent" : ""}`}
              >
                <header>
                  {person ? <PersonAvatar person={person} size="md" /> : null}
                  <div>
                    <strong>
                      {person?.domain === "general" ? t("compGeneral") : person?.name}
                    </strong>
                    <small>{card.source}</small>
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
                    if (card.workId || card.threadId) {
                      navigate(href(workDestination(card)));
                      return;
                    }
                    sessionStorage.setItem(COMPANION_FOCUS_KEY, card.companionId);
                    sessionStorage.setItem(COMPANION_DRAFT_KEY, card.line);
                    navigate(href("/"));
                  }}
                >
                  {card.workId
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
  );
}
