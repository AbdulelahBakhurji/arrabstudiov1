import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Check,
  Clock,
  Lightbulb,
  ListTodo,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import {
  acceptedWork,
  addWorkTask,
  captureWork,
  COMPANION_DRAFT_KEY,
  COMPANION_FOCUS_KEY,
  findCompanion,
  formatSlot,
  liveCompanions,
  needsTaskOrThought,
  postponeWork,
  relativeTime,
  setThreadArchived,
  setWorkState,
  suggestedWork,
  useCompanionState,
  type WorkItem,
} from "@/lib/companions";
import { resolveWorkTarget } from "@/lib/work-navigation";
import {
  CompanionEmpty,
  CompanionPageHeader,
  PersonAvatar,
  SpaceSwitch,
  useCompanionSpace,
} from "@/components/companions/CompanionUI";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { audienceFromPlanId } from "@/roles/catalog";
import { cn } from "@/lib/utils";

export function CompanionWorkPage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href, isFamily } = useRole();
  const { signedIn, account, status } = useSignedInAccount();
  const familyPlan =
    signedIn &&
    audienceFromPlanId(account?.planId ?? status?.entitlements?.planId ?? null) === "family";
  const familyLive = Boolean(isFamily && familyPlan);
  const { active: familyActive, isChild: isFamilyChildSeat } = useFamilyProfile();
  const isFamilyChild = familyLive && isFamilyChildSeat;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const threadsView = params.get("view") === "threads";
  const state = useCompanionState();
  const [savedSpace, setSpace] = useCompanionSpace();
  const target = resolveWorkTarget(state, params);
  const requestedSpace = params.get("space");
  const space =
    target?.item.space ??
    (requestedSpace === "personal" || requestedSpace === "work" ? requestedSpace : savedSpace);
  const [drafts, setDrafts] = useState({ personal: "", work: "" });
  const draft = drafts[space];
  const [feedback, setFeedback] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const archived = target?.kind === "thread" ? target.item.archived : showArchived;
  const selectedRef = useRef<HTMLElement | null>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const keepCaptureFocus = useRef(false);
  const selectedId = target?.item.id;
  const selectedState = target?.kind === "work" ? target.item.state : null;

  const kidCompanionIds = useMemo(() => {
    if (!familyLive || !isFamilyChild || !familyActive) return null;
    return new Set(
      liveCompanions(state)
        .filter((c) => c.familyMemberId === familyActive.id)
        .map((c) => c.id),
    );
  }, [familyLive, isFamilyChild, familyActive, state]);

  function forKid(items: WorkItem[]) {
    if (!kidCompanionIds) return items;
    return items.filter(
      (item) => !item.companionId || kidCompanionIds.has(item.companionId),
    );
  }

  useEffect(() => {
    if (space !== savedSpace) setSpace(space);
  }, [space, savedSpace, setSpace]);

  useEffect(() => {
    const preserveFocus = keepCaptureFocus.current;
    keepCaptureFocus.current = false;
    const selected = selectedRef.current;
    if (!selected) return;
    const completed = selected.closest("details");
    if (completed) completed.open = true;
    if (preserveFocus) return;
    selected.focus({ preventScroll: true });
    selected.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
  }, [selectedId, selectedState, archived, space, threadsView]);

  const accepted = forKid(acceptedWork(state, space));
  const suggested = forKid(suggestedWork(state, space));
  const done = forKid(
    state.work.filter((item) => item.space === space && item.state === "done"),
  );
  const threads = state.threads.filter(
    (thread) =>
      thread.space === space &&
      thread.archived === archived &&
      (!kidCompanionIds || !thread.companionId || kidCompanionIds.has(thread.companionId)),
  );

  const totalOpen = accepted.length + suggested.length;
  const progress =
    totalOpen + done.length === 0
      ? 0
      : Math.round((done.length / (totalOpen + done.length)) * 100);

  function saveDraft(asIdea: boolean) {
    const input = {
      text: draft.trim(),
      companionId: null,
      capturedFrom: ar ? "أضفتها بنفسك" : "Added by you",
      space,
    };
    const item = asIdea ? captureWork(input) : addWorkTask(input);
    if (!item) return;
    keepCaptureFocus.current = item.id !== selectedId || item.state !== selectedState;
    setDrafts((current) => ({ ...current, [space]: "" }));
    setFeedback(
      item.state === "suggested"
        ? ar
          ? "حُفظت الفكرة في المقترحات."
          : "Idea saved in suggestions."
        : item.state === "accepted"
          ? ar
            ? "المهمة جاهزة في قائمتك."
            : "The task is ready in your list."
          : ar
            ? "هذه الفكرة محفوظة سابقًا."
            : "This idea was already saved.",
    );
    setParams({ space, item: item.id });
    captureInput.current?.focus();
  }

  function workRow(item: WorkItem, suggestion: boolean) {
    const person = findCompanion(state, item.companionId);
    return (
      <li
        className={cn(
          "cw-item",
          suggestion && "is-suggest",
          selectedId === item.id && "is-on",
        )}
        key={item.id}
        tabIndex={selectedId === item.id ? -1 : undefined}
        ref={(node) => {
          if (selectedId === item.id) selectedRef.current = node;
        }}
      >
        <div className="cw-item-line">
          {!suggestion ? (
            <button
              className="cp-task-check"
              aria-label={`${t("compDone")}: ${item.text}`}
              onClick={() => setWorkState(item.id, "done")}
            >
              <Check size={13} />
            </button>
          ) : (
            <span className="cw-suggest-mark" aria-hidden>
              <Sparkles size={13} strokeWidth={1.8} />
            </span>
          )}
          <p>{item.text}</p>
        </div>
        <div className="cw-item-meta">
          {person ? <PersonAvatar person={person} size="sm" /> : null}
          <span>{item.capturedFrom}</span>
          {item.suggestedTime ? (
            <>
              <Clock size={13} />
              <span>
                {t("compSuggestedTime")}: {formatSlot(item.suggestedTime, locale)}
              </span>
            </>
          ) : null}
        </div>
        {needsTaskOrThought(item) ? <p className="cp-notice">{t("compTaskOrThought")}</p> : null}
        <div className="cw-item-actions">
          {suggestion ? (
            <>
              <button
                className="cp-button cp-primary"
                onClick={() => setWorkState(item.id, "accepted")}
              >
                <Plus size={14} />
                {t("compAddIt")}
              </button>
              <button className="cp-text-button" onClick={() => setWorkState(item.id, "declined")}>
                {t("compNotTask")}
              </button>
            </>
          ) : (
            <>
              <button className="cp-text-button" onClick={() => postponeWork(item.id)}>
                {t(needsTaskOrThought(item) ? "compStillTask" : "compPostpone")}
              </button>
              {needsTaskOrThought(item) ? (
                <button
                  className="cp-text-button"
                  onClick={() => setWorkState(item.id, "declined")}
                >
                  {t("compJustThought")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className={cn("cp-ui cp-page cw-page", isFamilyChild && "is-kid")}>
      <CompanionPageHeader
        title={t("compWork")}
        subtitle={
          isFamilyChild
            ? t("compWorkKidBody")
            : ar
              ? "التزاماتك، والأفكار التي تنتظر قرارك."
              : "Your commitments, and the ideas waiting for a decision."
        }
      >
        <SpaceSwitch
          value={space}
          onChange={(next) => {
            setSpace(next);
            setFeedback("");
            setParams(threadsView ? { view: "threads", space: next } : { space: next });
          }}
        />
      </CompanionPageHeader>

      <div className="cw-overview" aria-label={t("compWork")}>
        <div className="cw-stat">
          <ListTodo className="size-3.5" strokeWidth={1.8} />
          <div>
            <strong>{accepted.length}</strong>
            <span>{t("compWorkReady")}</span>
          </div>
        </div>
        <div className="cw-stat">
          <Sparkles className="size-3.5" strokeWidth={1.8} />
          <div>
            <strong>{suggested.length}</strong>
            <span>{t("compWorkInbox")}</span>
          </div>
        </div>
        <div className="cw-stat">
          <Check className="size-3.5" strokeWidth={1.8} />
          <div>
            <strong>{done.length}</strong>
            <span>{t("compDone")}</span>
          </div>
        </div>
        <div className="cw-progress">
          <div className="cw-progress-labels">
            <span>{t("compWorkProgress")}</span>
            <strong>{progress}%</strong>
          </div>
          <div className="cw-progress-track" aria-hidden>
            <div className="cw-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="cp-section-tabs cw-tabs">
        <button aria-pressed={!threadsView} onClick={() => setParams({ space })}>
          {ar ? "المهام" : "Tasks"}
        </button>
        <button aria-pressed={threadsView} onClick={() => setParams({ view: "threads", space })}>
          {t("compThreads")}
        </button>
      </div>

      {params.has("item") && !target ? (
        <p className="cp-target-notice" role="status">
          {ar
            ? "لم يعد هذا العنصر موجودًا. يمكنك متابعة مهامك هنا."
            : "This item is no longer available. Your other tasks are below."}
        </p>
      ) : null}

      {threadsView ? (
        <>
          <div className="cp-section-heading">
            <h2>{archived ? t("compArchived") : t("compThreads")}</h2>
            <button
              className="cp-button"
              aria-pressed={archived}
              onClick={() => {
                setShowArchived(!archived);
                setParams({ view: "threads", space });
              }}
            >
              <Archive size={14} />
              {archived ? (ar ? "المواضيع النشطة" : "Active topics") : t("compArchived")}
            </button>
          </div>
          {!threads.length ? (
            <CompanionEmpty title={t("compThreadsEmpty")}>
              {ar
                ? "تظهر هنا المواضيع المستمرة من محادثاتك، مع ملخص وما بقي مفتوحًا."
                : "Ongoing topics from your chats appear here, with a summary and what's still open."}
            </CompanionEmpty>
          ) : (
            <div className="cp-thread-grid cw-thread-grid">
              {threads.map((thread) => (
                <article
                  className={cn(
                    "cp-card cp-thread cw-thread",
                    selectedId === thread.id && "cp-item-highlight",
                  )}
                  key={thread.id}
                  tabIndex={selectedId === thread.id ? -1 : undefined}
                  ref={(node) => {
                    if (selectedId === thread.id) selectedRef.current = node;
                  }}
                >
                  <h2>{thread.title}</h2>
                  <p className="cp-muted">{thread.summary}</p>
                  {thread.open ? (
                    <p className="cp-open-loop">
                      <span>{t("compOpenLoop")}</span>
                      {thread.open}
                    </p>
                  ) : null}
                  <div className="cp-meta">{relativeTime(thread.touchedAt, locale)}</div>
                  <div className="cp-actions">
                    <button
                      className="cp-button"
                      onClick={() => {
                        if (thread.companionId)
                          sessionStorage.setItem(COMPANION_FOCUS_KEY, thread.companionId);
                        sessionStorage.setItem(
                          COMPANION_DRAFT_KEY,
                          `${thread.title}\n${thread.summary}${thread.open ? `\n${t("compOpenLoop")}: ${thread.open}` : ""}`,
                        );
                        navigate(href("/"));
                      }}
                    >
                      {ar ? "أكمل المحادثة" : "Continue conversation"}
                      <ArrowUpRight size={14} />
                    </button>
                    <button
                      className="cp-text-button"
                      onClick={() => {
                        setShowArchived(archived);
                        setThreadArchived(thread.id, !archived);
                        setParams({ view: "threads", space });
                      }}
                    >
                      {t(archived ? "compUnarchive" : "compArchive")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <form
            className="cw-capture"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft(false);
            }}
          >
            <div className="cw-capture-field">
              <Plus size={18} strokeWidth={1.8} />
              <input
                ref={captureInput}
                value={draft}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [space]: event.target.value }))
                }
                aria-label={ar ? "اكتب مهمة أو فكرة" : "Write a task or idea"}
                placeholder={
                  isFamilyChild
                    ? t("compWorkKidPh")
                    : ar
                      ? "ما الذي تريد إنجازه؟"
                      : "What would you like to get done?"
                }
              />
            </div>
            <div className="cw-capture-actions">
              <button type="submit" className="cp-button cp-primary" disabled={!draft.trim()}>
                <Plus size={15} />
                {ar ? "إضافة مهمة" : "Add task"}
              </button>
              <button
                type="button"
                className="cp-button cp-capture-secondary"
                disabled={!draft.trim()}
                onClick={() => saveDraft(true)}
              >
                <Lightbulb size={15} />
                {ar ? "حفظ فكرة" : "Save idea"}
              </button>
            </div>
          </form>
          <p className="cp-capture-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
          {target?.kind === "work" && target.item.state === "declined" ? (
            <div
              className="cp-target-notice cp-item-highlight"
              tabIndex={-1}
              ref={(node) => {
                selectedRef.current = node;
              }}
            >
              <p>{target.item.text}</p>
              <span>{ar ? "سبق استبعاد هذه الفكرة." : "This idea was previously dismissed."}</span>
              <button
                className="cp-button"
                onClick={() => setWorkState(target.item.id, "accepted")}
              >
                <RotateCcw size={14} />
                {ar ? "استعادة كمهمة" : "Restore as task"}
              </button>
            </div>
          ) : null}

          <div className="cw-board">
            <section className="cw-col">
              <header className="cw-col-head">
                <div>
                  <h2>
                    {ar ? "مهامك" : "Your tasks"}
                    <span>{accepted.length}</span>
                  </h2>
                  <small>{ar ? "جاهزة للإنجاز" : "Ready to do"}</small>
                </div>
              </header>
              {accepted.length ? (
                <ul className="cw-list">{accepted.map((item) => workRow(item, false))}</ul>
              ) : (
                <div className="cw-empty">
                  <CompanionEmpty title={ar ? "مساحة ليوم أخف" : "Room for a lighter day"}>
                    {ar
                      ? "أضف مهمة من الأعلى، أو اقبل أحد المقترحات."
                      : "Add a task above, or accept a suggestion."}
                  </CompanionEmpty>
                </div>
              )}
              {done.length ? (
                <details className="cp-completed cw-done">
                  <summary>
                    {t("compDone")} · {done.length}
                  </summary>
                  <ul>
                    {done.map((item) => (
                      <li
                        key={item.id}
                        className={selectedId === item.id ? "cp-item-highlight" : undefined}
                        tabIndex={selectedId === item.id ? -1 : undefined}
                        ref={(node) => {
                          if (selectedId === item.id) selectedRef.current = node;
                        }}
                      >
                        <s>{item.text}</s>
                        <button
                          className="cp-text-button"
                          aria-label={`${ar ? "استعادة" : "Restore"}: ${item.text}`}
                          onClick={() => setWorkState(item.id, "accepted")}
                        >
                          <RotateCcw size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>

            <section className="cw-col">
              <header className="cw-col-head">
                <div>
                  <h2>
                    {t("compWorkSuggested")}
                    <span>{suggested.length}</span>
                  </h2>
                  <small>
                    {ar
                      ? "اقتراحات فقط — لن تصبح التزامًا حتى توافق."
                      : "Suggestions only — nothing sticks until you say so."}
                  </small>
                </div>
              </header>
              {suggested.length ? (
                <ul className="cw-list is-suggest">
                  {suggested.map((item) => workRow(item, true))}
                </ul>
              ) : (
                <div className="cw-quiet">{t("compWorkEmpty")}</div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
