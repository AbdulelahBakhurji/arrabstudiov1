/**
 * Studio — the individual dashboard.
 *
 * This is the board from the spec: three cards at most, one of them lit, and
 * silence announced out loud rather than hidden. Everything here is a real
 * consequence of local state — nothing is decorative.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUp, Check, Clock, Plus } from "lucide-react";
import symbol from "@/assets/symbol.png";
import { Surface } from "@/components/StudioFrame";
import { CompanionFace } from "@/components/companions/CompanionFace";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import {
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  MAX_BOARD_CARDS,
  WEEKLY_NUDGE_CEILING,
  acceptedWork,
  addCompanion,
  boardCards,
  dismissCard,
  findCompanion,
  formatSlot,
  liveCompanions,
  markOpened,
  nudgeBudgetLeft,
  postponeWork,
  relativeTime,
  returningAfterAbsence,
  runSignals,
  setWorkState,
  silentCompanions,
  suggestedWork,
  useCompanionState,
  type CompanionSpace,
} from "@/lib/companions";
import { cn } from "@/lib/utils";

export function IndividualHomePage() {
  const { t, locale } = useLanguage();
  const { href } = useRole();
  const navigate = useNavigate();
  const state = useCompanionState();
  const [space, setSpace] = useState<CompanionSpace>("personal");
  const [draft, setDraft] = useState("");
  const [returning, setReturning] = useState(false);

  // Signals run once when the studio opens. Never on a timer.
  useEffect(() => {
    setReturning(returningAfterAbsence());
    runSignals();
    markOpened();
  }, []);

  const people = useMemo(() => liveCompanions(state, space), [state, space]);
  const allPeople = useMemo(() => liveCompanions(state), [state]);
  const cards = useMemo(() => boardCards(state, space), [state, space]);
  const visibleCards = returning ? cards.slice(0, 1) : cards;
  const quiet = useMemo(
    () => silentCompanions(state, space, visibleCards),
    [state, space, visibleCards],
  );
  const suggested = suggestedWork(state, space);
  const accepted = acceptedWork(state, space);
  const openLoops = state.threads.filter((thread) => !thread.archived && thread.open).length;
  const isAr = locale === "ar";

  const today = new Date().toLocaleDateString(isAr ? "ar" : "en", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  /** Carry the line into the room instead of answering it here. */
  function openRoom(companionId?: string | null, carry?: string) {
    if (companionId) sessionStorage.setItem(COMPANION_FOCUS_KEY, companionId);
    if (carry?.trim()) sessionStorage.setItem(COMPANION_DRAFT_KEY, carry.trim());
    navigate(href("/companions"));
  }

  /** Day one: the first thing you say creates the first face. */
  function startFirst(carry: string) {
    const person =
      allPeople[0] ??
      addCompanion({ name: t("compGeneral"), domain: "general", space, toneName: "measured" });
    openRoom(person.id, carry);
  }

  if (allPeople.length === 0) {
    return (
      <Surface className="companion-shell">
        <div className="companion-atmosphere absolute inset-0 -z-10 rounded-[28px]" />
        <div className="mx-auto flex h-full max-w-[720px] flex-col justify-center px-8">
          <div className="companion-rise">
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{today}</p>
            <h1 className="mt-5 text-[clamp(2rem,4vw,2.9rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-white">
              {t("compDayOneTitle")}
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-400">
              {t("compDayOneBody")}
            </p>
          </div>

          <div className="companion-rise companion-rise-1 mt-9">
            <div className="companion-composer flex items-end gap-2 p-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[11px] text-neutral-500">
                {t("compGeneral").slice(0, 1)}
              </span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    startFirst(draft);
                  }
                }}
                rows={1}
                placeholder={t("compAskPlaceholder")}
                className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] text-white outline-none placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={() => startFirst(draft)}
                disabled={!draft.trim()}
                className="home-btn-primary inline-flex size-9 shrink-0 items-center justify-center !rounded-full disabled:opacity-35"
                aria-label={t("compSend")}
              >
                <ArrowUp className="size-4" strokeWidth={2} />
              </button>
            </div>

            {/* Examples, not onboarding — they vanish the moment you type. */}
            {!draft.trim() ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {[t("compExampleSummarise"), t("compExampleLongDay")].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setDraft(example)}
                    className="companion-chip"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : null}

            <p className="mt-6 text-[11px] text-neutral-600">{t("compQuietHint")}</p>
          </div>
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="companion-shell">
      <div className="companion-atmosphere absolute inset-0 -z-10 rounded-[28px]" />
      <img
        src={symbol}
        alt=""
        className="brand-mark pointer-events-none absolute end-[-4%] top-[-8%] h-[70%] max-w-[38%] object-contain opacity-[0.06]"
      />

      <div className="relative mx-auto w-full max-w-[1080px] px-6 py-8 lg:px-8">
        <header className="companion-rise flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">{today}</p>
            <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-tight tracking-[-0.035em] text-white">
              {t("compHomeTitle")}
            </h1>
            <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-neutral-500">
              {t("compHomeBody")}
            </p>
          </div>

          <div className="flex gap-1 rounded-2xl bg-white/[0.04] p-1">
            {(["personal", "work"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSpace(key)}
                className={cn(
                  "rounded-xl px-4 py-1.5 text-[12.5px] transition-colors",
                  space === key ? "bg-white text-black" : "text-neutral-400 hover:text-neutral-200",
                )}
              >
                {key === "personal" ? t("compSpacePersonal") : t("compSpaceWork")}
              </button>
            ))}
          </div>
        </header>

        {/* Faces, with the last thing each of them remembers. */}
        <section className="companion-rise companion-rise-1 mt-8 flex flex-wrap items-start gap-6">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => openRoom(person.id)}
              className="flex w-[76px] flex-col items-center gap-2"
            >
              <CompanionFace
                name={person.name}
                hue={person.hue}
                seed={person.faceSeed}
                size="xl"
                state={visibleCards.some((card) => card.companionId === person.id) ? "lit" : "quiet"}
              />
              <span className="w-full truncate text-center text-[12px] text-neutral-200">
                {person.name}
              </span>
              <span className="w-full truncate text-center text-[10.5px] text-neutral-600">
                {person.lastMemory ?? (relativeTime(person.lastAt, locale) || person.domain)}
              </span>
            </button>
          ))}
          <Link
            to={href("/companions")}
            className="flex size-[76px] items-center justify-center rounded-full border border-dashed border-white/15 text-neutral-500 hover:border-white/30 hover:text-white"
            aria-label={t("compAddCompanion")}
          >
            <Plus className="size-5" strokeWidth={1.7} />
          </Link>
        </section>

        <div className="mt-9 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          {/* -------------------------------------------------------------- */}
          {/* The board                                                       */}
          {/* -------------------------------------------------------------- */}
          <section className="companion-rise companion-rise-2 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-medium text-white">{t("compBoard")}</h2>
              <span className="text-[11px] text-neutral-600">
                {visibleCards.length}/{MAX_BOARD_CARDS}
              </span>
            </div>

            {returning && visibleCards.length > 0 ? (
              <p className="mt-2 text-[12.5px] text-neutral-500">{t("compBoardBack")}</p>
            ) : null}

            {visibleCards.length === 0 ? (
              <div className="companion-panel mt-3 px-6 py-10 text-center">
                <p className="text-[15px] text-neutral-300">{t("compBoardEmpty")}</p>
                <p className="mt-2 text-[12px] text-neutral-600">{t("compQuietHint")}</p>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {visibleCards.map((card, index) => {
                  const person = findCompanion(state, card.companionId);
                  const lit = index === 0;
                  return (
                    <li
                      key={card.id}
                      className={cn(
                        "rounded-[24px] px-5 py-4",
                        lit ? "companion-card-gold" : "companion-panel",
                      )}
                    >
                      <div className="flex items-start gap-3.5">
                        {person ? (
                          <CompanionFace
                            name={person.name}
                            hue={person.hue}
                            seed={person.faceSeed}
                            size="md"
                            state={lit ? "speaking" : "quiet"}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-[14.5px] leading-snug",
                              lit ? "text-amber-50" : "text-neutral-200",
                            )}
                          >
                            {card.line}
                          </p>
                          <p className="mt-1.5 text-[10.5px] text-neutral-500">
                            {person?.name}
                            {" · "}
                            {t("compNudgeFrom").replace("{source}", card.source)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => openRoom(card.companionId, card.line)}
                            className={cn(
                              "h-8 rounded-full px-4 text-[12px]",
                              lit
                                ? "bg-amber-100 text-black"
                                : "border border-white/12 text-neutral-200 hover:bg-white/5",
                            )}
                          >
                            {card.action}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissCard(card)}
                            className="text-[11px] text-neutral-600 hover:text-neutral-300"
                          >
                            {t("compDismiss")}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Silence is stated, not implied. */}
            {quiet.length > 0 ? (
              <p className="mt-3 text-[12.5px] text-neutral-600">
                {(quiet.length === 1 ? t("compBoardSilenceOne") : t("compBoardSilence")).replace(
                  "{names}",
                  quiet.map((person) => person.name).join(isAr ? " و" : " and "),
                )}
              </p>
            ) : null}

            {/* Captured, not added. */}
            {suggested.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-[13px] font-medium text-white">{t("compWorkSuggested")}</h3>
                <ul className="mt-3 space-y-2">
                  {suggested.map((item) => (
                    <li
                      key={item.id}
                      className="companion-panel flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] text-neutral-200">{item.text}</p>
                        <p className="mt-0.5 text-[10.5px] text-neutral-600">
                          {t("compSuggestedTime")} · {formatSlot(item.suggestedTime, locale)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWorkState(item.id, "accepted")}
                        className="companion-chip"
                      >
                        {t("compAddIt")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkState(item.id, "declined")}
                        className="companion-chip"
                      >
                        {t("compNotTask")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {accepted.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-[13px] font-medium text-white">{t("compWorkAccepted")}</h3>
                <ul className="mt-3 space-y-2">
                  {accepted.map((item) => (
                    <li
                      key={item.id}
                      className="companion-panel flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] text-neutral-200">{item.text}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-neutral-600">
                          <Clock className="size-3" strokeWidth={1.8} />
                          {formatSlot(item.suggestedTime, locale)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWorkState(item.id, "done")}
                        className="companion-chip"
                      >
                        <Check className="size-3" strokeWidth={2} />
                        {t("compDone")}
                      </button>
                      <button
                        type="button"
                        onClick={() => postponeWork(item.id)}
                        className="companion-chip"
                      >
                        {t("compPostpone")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* -------------------------------------------------------------- */}
          {/* Quiet by design                                                 */}
          {/* -------------------------------------------------------------- */}
          <aside className="companion-rise companion-rise-3 space-y-4">
            <div className="companion-panel px-5 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                {t("compYourDay")}
              </p>
              <dl className="mt-3 space-y-2.5">
                {(
                  [
                    [t("companions"), String(allPeople.length)],
                    [t("compStatFacts"), String(state.facts.length)],
                    [t("compStatOpen"), String(openLoops)],
                    [
                      t("compStatNudges"),
                      `${nudgeBudgetLeft(state)}/${WEEKLY_NUDGE_CEILING}`,
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[12.5px] text-neutral-500">{label}</dt>
                    <dd className="text-[14px] text-white">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">
                {t("compQuietHint")}
              </p>
            </div>

            <div className="companion-panel px-5 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                {t("compThreads")}
              </p>
              {openLoops === 0 ? (
                <p className="mt-2 text-[12.5px] text-neutral-600">{t("compThreadsEmpty")}</p>
              ) : (
                <ul className="mt-2.5 space-y-2.5">
                  {state.threads
                    .filter((thread) => !thread.archived && thread.open)
                    .slice(0, 4)
                    .map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => openRoom(thread.companionId, thread.open ?? "")}
                          className="w-full text-start"
                        >
                          <p className="truncate text-[12.5px] text-neutral-200">{thread.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-600">
                            {t("compOpenLoop")}: {thread.open}
                          </p>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <Link
                to={href("/companions")}
                className="mt-4 inline-block text-[11.5px] text-neutral-500 hover:text-white"
              >
                {t("companions")}
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </Surface>
  );
}
