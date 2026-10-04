import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Archive,
  BellRing,
  Brain,
  Camera,
  Check,
  ChevronDown,
  Download,
  ImageUp,
  Languages,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Volume2,
  Wand2,
  X as XIcon,
} from "lucide-react";
import {
  arabicAccentById,
  type ArabicAccentId,
} from "@/domains/companions/catalog/accent";
import {
  allocateUniquePortrait,
  catalogPortraitFiles,
  portraitFileFromUrl,
  portraitGenderForDomain,
  portraitGenderForFile,
  resolveCompanionPortraitSrc,
} from "@/domains/companions/catalog/portrait";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { arrabApi } from "@/core/api/api";
import { AvatarImageError, fileToAvatarDataUrl, videoFrameToAvatarDataUrl } from "@/domains/companions/lib/avatar-image";
import { companionDisplayName, isSecretCompanionBrief } from "@/domains/companions/catalog/catalog";
import {
  addFact,
  applyCompanionToneStyle,
  CALL_OUT_TOPICS,
  companionInstructions,
  companionsVaultReady,
  deleteFact,
  ensureCompanionsReady,
  ensureGeneralCompanion,
  exportEverything,
  factsForMePage,
  getCompanionState,
  liveCompanions,
  markCompanionInstructionsSynced,
  matchToneStyleId,
  resetCompanionTone,
  setCompanionAvatar,
  setCompanionTone,
  setFactShared,
  toggleCallOut,
  clampTone,
  tonePreviewSample,
  TONE_STYLE_CHIPS,
  updateCompanion,
  updateFact,
  useCompanionState,
  visibleFacts,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionTone,
} from "@/domains/companions/model/companions";
import { CompanionModal, PersonAvatar } from "./CompanionUI";

export async function syncCompanionMemory() {
  await ensureCompanionsReady();
  const state = getCompanionState();
  const locale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
  await Promise.all(
    liveCompanions(state)
      .filter((person) => person.agentId)
      .map(async (person) => {
        const instructions = companionInstructions(
          person,
          visibleFacts(state, person),
          locale,
        );
        await arrabApi.updateAgent(person.agentId!, {
          name: companionDisplayName(person, locale),
          instructions,
        });
        markCompanionInstructionsSynced(person.agentId!, instructions);
      }),
  );
}

export function MemoryDetails({
  person,
  space,
}: {
  person?: CompanionProfile;
  space: CompanionSpace;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const state = useCompanionState();
  const [ready, setReady] = useState(() => companionsVaultReady());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [assignId, setAssignId] = useState<string>("");
  const people = liveCompanions(state, space);

  useEffect(() => {
    let cancelled = false;
    void ensureCompanionsReady()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const facts = factsForMePage(state, space, person?.id ?? null);

  function sync() {
    void syncCompanionMemory()
      .then(() => setError(""))
      .catch(() =>
        setError(
          ar
            ? "حُفظ التغيير على الجهاز. تعذرت مزامنته مع الرفاق؛ أعد المحاولة."
            : "Saved on this device. Could not sync with companions; please retry.",
        ),
      );
  }

  async function submitFact(event: { preventDefault(): void }) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !ready) return;
    await ensureCompanionsReady();
    const targetId = person?.createdAt
      ? person.id
      : assignId || null;
    addFact({
      companionId: targetId,
      text,
      source: t("compFactExplicit"),
      kind: "explicit",
      space,
    });
    setDraft("");
    setNotice(ar ? "حُفظت المعلومة." : "Saved.");
    sync();
  }

  function companionLabel(companionId: string | null) {
    if (!companionId) return ar ? "لكل الرفاق" : "All companions";
    const match = state.companions.find((item) => item.id === companionId);
    if (!match) return ar ? "رفيق" : "Companion";
    return match.domain === "general" ? t("compGeneral") : match.name;
  }

  const briefValue = person && !isSecretCompanionBrief(person.brief) ? (person.brief ?? "") : "";
  const [briefDraft, setBriefDraft] = useState(briefValue);
  useEffect(() => {
    setBriefDraft(briefValue);
  }, [person?.id, briefValue]);

  function saveBrief() {
    if (!person) return;
    const next = briefDraft.trim();
    if (next === briefValue.trim()) return;
    const target = person.createdAt ? person : ensureGeneralCompanion(person.space);
    updateCompanion(target.id, { brief: next || null });
    setNotice(ar ? "حُفظ الغرض." : "Purpose saved.");
    sync();
  }

  return (
    <div className="cpx-panel">
      {person ? (
        <section className="cpx-card">
          <header className="cpx-card-head">
            <span className="cpx-card-icon">
              <Target size={15} strokeWidth={1.8} />
            </span>
            <div>
              <h4>{t("compBrief")}</h4>
              <p>{t("compBriefHint")}</p>
            </div>
            <span className="cpx-count">{briefDraft.length}/8000</span>
          </header>
          <textarea
            className="cp-input cpx-textarea"
            rows={5}
            maxLength={8000}
            value={briefDraft}
            disabled={!ready}
            onChange={(event) => setBriefDraft(event.target.value)}
            onBlur={saveBrief}
            placeholder={t("compBriefPlaceholder")}
          />
        </section>
      ) : null}

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <Brain size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{t("compKnows")}</h4>
            <p>
              {ar
                ? "كل معلومة ومصدرها تحت سيطرتك. اختر ما يُشارك مع الرفاق."
                : "Every fact and its source. You choose what companions can share."}
            </p>
          </div>
          <span className="cpx-count">{facts.length}</span>
        </header>

        <form className="cpx-composer" onSubmit={(event) => void submitFact(event)}>
          <label className="cp-sr-only" htmlFor="companion-memory-input">
            {t("compKnows")}
          </label>
          <textarea
            id="companion-memory-input"
            className="cp-input cpx-composer-input"
            rows={2}
            maxLength={600}
            value={draft}
            disabled={!ready}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitFact(event);
              }
            }}
            placeholder={ar ? "معلومة أحب أن تتذكرها…" : "Something I want you to remember…"}
          />
          <div className="cpx-composer-bar">
            {!person ? (
              <label className="cpx-select-wrap cpx-select-compact">
                <span className="cp-sr-only">{ar ? "تعيين لرفيق" : "Assign to companion"}</span>
                <select
                  className="cpx-select"
                  value={assignId}
                  disabled={!ready}
                  onChange={(event) => setAssignId(event.target.value)}
                >
                  <option value="">{ar ? "لكل الرفاق" : "All companions"}</option>
                  {people.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.domain === "general" ? t("compGeneral") : item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </label>
            ) : (
              <span className="cpx-hint">
                {ar ? "Enter للحفظ · Shift+Enter لسطر جديد" : "Enter to save · Shift+Enter for a new line"}
              </span>
            )}
            <button className="cp-button cp-primary cpx-add" disabled={!ready || !draft.trim()} type="submit">
              <Plus size={14} />
              {t("compAdd")}
            </button>
          </div>
        </form>

        {!ready ? (
          <p className="cp-muted" role="status">
            {ar ? "جارٍ فتح الذاكرة…" : "Opening memory…"}
          </p>
        ) : null}
        {notice ? (
          <p className="cpx-toast" role="status">
            <Check size={13} />
            {notice}
          </p>
        ) : null}
        {error ? (
          <div className="cp-notice" role="alert">
            {error}
            <button type="button" className="cp-button" onClick={sync}>
              {ar ? "إعادة المحاولة" : "Retry"}
            </button>
          </div>
        ) : null}

        {ready && facts.length === 0 ? (
          <div className="cpx-empty">
            <Sparkles size={18} strokeWidth={1.6} />
            <strong>{ar ? "لا توجد ذكريات بعد" : "No memories yet"}</strong>
            <span>{t("compKnowsEmpty")}</span>
          </div>
        ) : null}

        {facts.length > 0 ? (
          <ul className="cpx-facts">
            {facts.map((fact) => (
              <li className="cpx-fact" key={fact.id}>
                {editingId === fact.id ? (
                  <form
                    className="cp-fact-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!editText.trim()) return;
                      updateFact(fact.id, editText);
                      setEditingId(null);
                      setEditText("");
                      setNotice(ar ? "تم التعديل." : "Updated.");
                      sync();
                    }}
                  >
                    <textarea
                      className="cp-input cpx-textarea"
                      rows={3}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      autoFocus
                    />
                    <div className="cp-actions">
                      <button type="submit" className="cp-button cp-primary" disabled={!editText.trim()}>
                        {ar ? "حفظ" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="cp-button"
                        onClick={() => {
                          setEditingId(null);
                          setEditText("");
                        }}
                      >
                        {ar ? "إلغاء" : "Cancel"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="cpx-fact-text">{fact.text}</p>
                )}
                <div className="cpx-fact-foot">
                  <div className="cpx-fact-meta">
                    <span className="cpx-chip" data-kind={fact.kind}>
                      {t(fact.kind === "explicit" ? "compFactExplicit" : "compFactInferred")}
                    </span>
                    <span className="cpx-chip">{companionLabel(fact.companionId)}</span>
                    {fact.source ? <span className="cpx-meta-text">{fact.source}</span> : null}
                    <time className="cpx-meta-text" dateTime={fact.createdAt}>
                      {new Date(fact.createdAt).toLocaleDateString(locale, {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                  </div>
                  {editingId === fact.id ? null : (
                    <div className="cpx-fact-actions">
                      <button
                        type="button"
                        className="cpx-icon-btn"
                        title={ar ? "تعديل" : "Edit"}
                        aria-label={ar ? "تعديل" : "Edit"}
                        onClick={() => {
                          setEditingId(fact.id);
                          setEditText(fact.text);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="cpx-icon-btn"
                        aria-pressed={fact.shared}
                        title={t(fact.shared ? "compDontShare" : "compShared")}
                        aria-label={t(fact.shared ? "compDontShare" : "compShared")}
                        onClick={() => {
                          setFactShared(fact.id, !fact.shared);
                          sync();
                        }}
                      >
                        {fact.shared ? <Share2 size={13} /> : <Lock size={13} />}
                      </button>
                      <button
                        type="button"
                        className="cpx-icon-btn cpx-danger"
                        title={t("delete")}
                        aria-label={t("delete")}
                        onClick={() => {
                          deleteFact(fact.id);
                          setNotice(ar ? "حُذفت." : "Deleted.");
                          sync();
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

const ACCENT_GROUPS: { en: string; ar: string; ids: ArabicAccentId[] }[] = [
  { en: "General", ar: "عام", ids: ["auto", "msa"] },
  {
    en: "Saudi & Gulf",
    ar: "السعودية والخليج",
    ids: ["najdi", "hijazi", "gulf", "emirati", "kuwaiti", "qatari", "bahraini", "omani", "yemeni"],
  },
  {
    en: "Levant & Iraq",
    ar: "الشام والعراق",
    ids: ["levantine", "jordanian", "palestinian", "lebanese", "syrian", "iraqi"],
  },
  { en: "Nile Valley", ar: "وادي النيل", ids: ["egyptian", "sudanese"] },
  { en: "Maghreb", ar: "المغرب العربي", ids: ["libyan", "tunisian", "algerian", "moroccan"] },
];

function speakAccentSample(text: string, lang: string, gender: "female" | "male" = "female") {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const preferFemale = gender === "female";
  const scored = [...voices]
    .map((voice) => {
      let score = 0;
      const vl = voice.lang.toLowerCase();
      if (vl === lang.toLowerCase()) score += 100;
      else if (vl.startsWith("ar") && lang.startsWith("ar")) score += 50;
      if (/saudi|ar-sa|نورة|فاطمة|magpie/i.test(`${voice.name} ${voice.lang}`)) score += 40;
      if (preferFemale && /female|woman|sara|susan|noura|salma|laila|fatima|sofia|ava/i.test(voice.name))
        score += 30;
      if (!preferFemale && /male|man|omar|hassan|david|daniel|reed/i.test(voice.name)) score += 30;
      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);
  utterance.voice = scored[0]?.voice ?? null;
  utterance.pitch = preferFemale ? 1.1 : 0.9;
  window.speechSynthesis.speak(utterance);
}

export function ExportMemories() {
  const { t } = useLanguage();
  return (
    <button
      className="cp-button"
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([exportEverything(getCompanionState())], { type: "application/json" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "arrab-companions.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      <Download size={15} />
      {t("compExport")}
    </button>
  );
}

export function ToneDetails({ person, onFold }: { person: CompanionProfile; onFold: () => void }) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const syncTimer = useRef<number | null>(null);
  const state = useCompanionState();
  const live =
    state.companions.find((item) => item.id === person.id) ??
    (person.domain === "general"
      ? state.companions.find((item) => item.domain === "general" && item.space === person.space)
      : null) ??
    person;

  function readyPerson(): CompanionProfile {
    if (live.createdAt) return live;
    return ensureGeneralCompanion(live.space);
  }

  const sync = (immediate = false) => {
    const run = () => {
      setSyncing(true);
      void syncCompanionMemory()
        .then(() => {
          setSyncedAt(Date.now());
          setError("");
        })
        .catch(() => setError(t("apiUnavailable")))
        .finally(() => setSyncing(false));
    };
    if (syncTimer.current) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    if (immediate) {
      run();
      return;
    }
    syncTimer.current = window.setTimeout(run, 420);
  };

  useEffect(() => {
    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, []);

  const toneAxes: {
    key: keyof CompanionTone;
    label: string;
    low: string;
    high: string;
  }[] = [
    {
      key: "bluntness",
      label: t("compBluntness"),
      low: ar ? "لطيف" : "Gentle",
      high: ar ? "صارح" : "Blunt",
    },
    {
      key: "humour",
      label: t("compHumour"),
      low: ar ? "جاد" : "Serious",
      high: ar ? "مرح" : "Playful",
    },
    {
      key: "replyLength",
      label: t("compReplyLength"),
      low: ar ? "قصير" : "Short",
      high: ar ? "مطوّل" : "Long",
    },
    {
      key: "warmth",
      label: ar ? "الدفء" : "Warmth",
      low: ar ? "محايد" : "Cool",
      high: ar ? "دافئ" : "Warm",
    },
    {
      key: "formality",
      label: ar ? "الرسمية" : "Formality",
      low: ar ? "عفوي" : "Casual",
      high: ar ? "رسمي" : "Formal",
    },
    {
      key: "criticism",
      label: ar ? "النقد" : "Criticism",
      low: ar ? "داعم" : "Soft",
      high: ar ? "صريح" : "Candid",
    },
    {
      key: "pace",
      label: ar ? "الإيقاع" : "Pace",
      low: ar ? "صبور" : "Patient",
      high: ar ? "سريع" : "Brisk",
    },
  ];

  const callOutLabels: Record<(typeof CALL_OUT_TOPICS)[number], string> = {
    spending: ar ? "الإنفاق" : "Spending",
    goals: ar ? "الأهداف" : "Goals",
    habits: ar ? "العادات" : "Habits",
    sleep: ar ? "النوم" : "Sleep",
    focus: ar ? "التركيز" : "Focus",
    health: ar ? "الصحة" : "Health",
    time: ar ? "الوقت" : "Time",
    relationships: ar ? "العلاقات" : "Relationships",
  };

  const tone = clampTone(live.tone);
  const activeChip = matchToneStyleId(tone);
  const preview = tonePreviewSample(tone, ar ? "ar" : "en");
  const activeStyle = activeChip
    ? TONE_STYLE_CHIPS.find((chip) => chip.id === activeChip)
    : null;

  const accent = arabicAccentById(live.accent);

  return (
    <div className="cpx-panel">
      <div className="cpx-statusbar" aria-live="polite">
        <span className="cpx-status-label">{ar ? "الأسلوب الحالي" : "Current style"}</span>
        <strong>
          {activeStyle ? (ar ? activeStyle.labelAr : activeStyle.labelEn) : ar ? "مخصص" : "Custom"}
        </strong>
        <span className="cpx-dot" />
        <span className="cpx-status-label">{ar ? "اللهجة" : "Accent"}</span>
        <strong>{ar ? accent.labelAr : accent.labelEn}</strong>
        <span className="cpx-sync" data-state={syncing ? "saving" : syncedAt ? "saved" : "idle"}>
          {syncing ? (ar ? "يحفظ…" : "Saving…") : syncedAt ? (ar ? "محفوظ" : "Saved") : null}
        </span>
      </div>

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <Languages size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{ar ? "اللهجة العربية" : "Arabic accent"}</h4>
            <p>
              {ar
                ? "اللهجة التي يتحدث بها الرفيق عندما يرد بالعربية."
                : "The dialect this companion speaks when replying in Arabic."}
            </p>
          </div>
        </header>
        <label className="cpx-select-wrap">
          <span className="cp-sr-only">{ar ? "اختر اللهجة" : "Choose accent"}</span>
          <select
            className="cpx-select"
            value={accent.id}
            onChange={(event) => {
              const ready = readyPerson();
              const next = event.target.value as ArabicAccentId;
              updateCompanion(ready.id, { accent: next === "auto" ? null : next });
              sync(true);
            }}
          >
            {ACCENT_GROUPS.map((group) => (
              <optgroup key={group.en} label={ar ? group.ar : group.en}>
                {group.ids.map((id) => {
                  const item = arabicAccentById(id);
                  return (
                    <option key={id} value={id}>
                      {ar ? `${item.labelAr} — ${item.regionAr}` : `${item.labelEn} — ${item.regionEn}`}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden />
        </label>
        <div className="cpx-accent-sample" dir="rtl">
          <p lang="ar">“{accent.sample}”</p>
          <button
            type="button"
            className="cpx-icon-btn"
            title={ar ? "استمع للمثال" : "Hear sample"}
            aria-label={ar ? "استمع للمثال" : "Hear sample"}
            onClick={() =>
              speakAccentSample(
                accent.sample,
                accent.speechLang,
                portraitGenderForDomain(live.domain) ?? "female",
              )
            }
          >
            <Volume2 size={14} />
          </button>
        </div>
      </section>

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <Wand2 size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{ar ? "أسلوب الرد" : "Reply style"}</h4>
            <p>
              {ar
                ? "اختر أسلوبًا جاهزًا أو عدّل المحاور. يمكنك أيضًا الطلب أثناء المحادثة («كن أصرح»، «اختصر»)."
                : "Pick a preset or fine-tune below. You can also ask in chat (“be blunter”, “keep it short”)."}
            </p>
          </div>
        </header>
      <div className="cp-tone-styles" role="group" aria-label={t("compTone")}>
        {TONE_STYLE_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="cp-tone-style"
            aria-pressed={activeChip === chip.id}
            onClick={() => {
              const ready = readyPerson();
              applyCompanionToneStyle(ready.id, chip.tone, chip.toneName);
              sync(true);
            }}
          >
            <strong>{ar ? chip.labelAr : chip.labelEn}</strong>
            <span>{ar ? chip.hintAr : chip.hintEn}</span>
          </button>
        ))}
        <div
          className="cp-tone-style cp-tone-style-custom"
          aria-pressed={activeChip == null}
          data-active={activeChip == null ? "true" : "false"}
        >
          <strong>{ar ? "مخصص" : "Custom"}</strong>
          <span>
            {ar
              ? "المنزلقات أدناه — مزيجك أنت"
              : "Your mix from the sliders below"}
          </span>
        </div>
      </div>

      <div className="cpx-bubble" aria-live="polite">
        <span className="cpx-bubble-label">{ar ? "معاينة الرد" : "Reply preview"}</span>
        <p>{preview}</p>
      </div>
      </section>

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <SlidersHorizontal size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{ar ? "ضبط دقيق" : "Fine-tune"}</h4>
            <p>{ar ? "كل محور من 0 إلى 100." : "Each axis from 0 to 100."}</p>
          </div>
        </header>
        <div className="cpx-sliders">
          {toneAxes.map((axis) => (
            <label className="cpx-slider" key={axis.key}>
              <span className="cpx-slider-head">
                <span>{axis.label}</span>
                <output>{tone[axis.key]}</output>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={tone[axis.key]}
                style={{ "--cpx-fill": `${tone[axis.key]}%` } as CSSProperties}
                onChange={(event) => {
                  const ready = readyPerson();
                  setCompanionTone(ready.id, { [axis.key]: Number(event.target.value) });
                  sync();
                }}
                onPointerUp={() => sync(true)}
                onBlur={() => sync(true)}
              />
              <span className="cpx-slider-ends">
                <small>{axis.low}</small>
                <small>{axis.high}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <NotebookPen size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{ar ? "ملاحظات الأسلوب" : "Style notes"}</h4>
            <p>
              {ar
                ? "أعلى أولوية من المنزلقات — اكتب كيف تريد أن يرد."
                : "Highest priority over the sliders — write how they should sound."}
            </p>
          </div>
        </header>
        <textarea
          className="cp-input cpx-textarea"
          rows={3}
          key={live.id + String(live.toneNote ?? "")}
          defaultValue={live.toneNote ?? ""}
          placeholder={
            ar
              ? "مثال: خاطبني بالعامية، لا تمدحني كثيرًا، ابدأ بالنتيجة."
              : "e.g. Use plain language, skip praise, lead with the answer."
          }
          onBlur={(event) => {
            const next = event.target.value.trim();
            const previous = live.toneNote?.trim() ?? "";
            if (next === previous) return;
            const ready = readyPerson();
            updateCompanion(ready.id, { toneNote: next || null });
            sync(true);
          }}
        />
      </section>

      <section className="cpx-card">
        <header className="cpx-card-head">
          <span className="cpx-card-icon">
            <BellRing size={15} strokeWidth={1.8} />
          </span>
          <div>
            <h4>{t("compCallOut")}</h4>
            <p>
              {ar
                ? "مواضيع يُسمح للرفيق أن ينبّهك عليها بسبب واضح."
                : "Topics this companion may flag, always with a visible reason."}
            </p>
          </div>
        </header>
        <div className="cpx-chips">
          {CALL_OUT_TOPICS.map((topic) => (
            <button
              key={topic}
              type="button"
              className="cpx-toggle-chip"
              aria-pressed={live.callOut.includes(topic)}
              onClick={() => {
                const ready = readyPerson();
                toggleCallOut(ready.id, topic);
                sync(true);
              }}
            >
              {live.callOut.includes(topic) ? <Check size={12} /> : null}
              {callOutLabels[topic]}
            </button>
          ))}
        </div>
      </section>

      <div className="cp-actions cpx-footer">
        <button
          type="button"
          className="cp-button"
          onClick={() => {
            const ready = readyPerson();
            resetCompanionTone(ready.id);
            sync(true);
          }}
        >
          <RotateCcw size={14} />
          {t("compResetTone")}
        </button>
        {live.domain !== "general" ? (
          <button
            type="button"
            className="cp-button"
            onClick={() => {
              updateCompanion(live.id, { archivedAt: new Date().toISOString() });
              onFold();
            }}
          >
            <Archive size={14} />
            {ar ? "طيّ الرفيق" : "Fold away"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="cp-notice">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CameraCaptureDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const { locale } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            locale === "ar"
              ? "تعذّر الوصول إلى الكاميرا. تحقّق من الإذن ثم أعد المحاولة."
              : "Couldn't reach the camera. Check permission and try again.",
          );
        }
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [open, locale]);

  return (
    <CompanionModal open={open} onClose={onClose} title={locale === "ar" ? "التقاط صورة" : "Take a photo"}>
      <div className="cp-stack">
        {error ? (
          <p role="alert" className="cp-notice">
            {error}
          </p>
        ) : (
          <video ref={videoRef} className="cp-camera-preview" autoPlay playsInline muted />
        )}
        <div className="cp-actions">
          <button
            type="button"
            className="cp-button cp-primary"
            disabled={!!error}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              try {
                onCapture(videoFrameToAvatarDataUrl(video));
                onClose();
              } catch {
                setError(
                  locale === "ar"
                    ? "تعذّر التقاط الصورة، حاول مرة أخرى."
                    : "Couldn't capture that frame — try again.",
                );
              }
            }}
          >
            <Camera size={15} />
            {locale === "ar" ? "التقاط" : "Capture"}
          </button>
          <button type="button" className="cp-button" onClick={onClose}>
            {locale === "ar" ? "إلغاء" : "Cancel"}
          </button>
        </div>
      </div>
    </CompanionModal>
  );
}

/** Lets the person replace a companion's generated face with a real photo — uploaded or captured. */
export function AvatarEditor({ person }: { person: CompanionProfile }) {
  const { locale } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const state = useCompanionState();

  function generateNewFace() {
    const current = resolveCompanionPortraitSrc(person);
    const currentFile = portraitFileFromUrl(current);
    const gender =
      (currentFile ? portraitGenderForFile(currentFile) : null) ??
      portraitGenderForDomain(person.domain);
    const taken = [
      ...liveCompanions(state).map((item) => resolveCompanionPortraitSrc(item)),
      ...catalogPortraitFiles(),
    ];
    const next = allocateUniquePortrait({
      domain: `custom-${person.id}`,
      name: person.name,
      gender,
      taken,
    });
    updateCompanion(person.id, { faceSeed: next.faceSeed, avatarPhoto: next.avatarPhoto });
  }

  async function applyFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setCompanionAvatar(person.id, dataUrl);
    } catch (err) {
      setError(
        err instanceof AvatarImageError && err.message === "too-large"
          ? locale === "ar"
            ? "الصورة كبيرة جدًا. اختر صورة أصغر من 20 ميجابايت."
            : "That image is too large — pick one under 20MB."
          : locale === "ar"
            ? "تعذّرت قراءة هذه الصورة. جرّب صورة أخرى."
            : "Couldn't read that image — try a different one.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-avatar-editor">
      <PersonAvatar person={person} size="xl" />
      <div className="cp-stack">
        <div className="cp-actions">
          <button
            type="button"
            className="cp-button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageUp size={15} />
            {locale === "ar" ? "رفع صورة" : "Upload photo"}
          </button>
          <button type="button" className="cp-button" disabled={busy} onClick={() => setCameraOpen(true)}>
            <Camera size={15} />
            {locale === "ar" ? "استخدام الكاميرا" : "Use camera"}
          </button>
          {person.avatarPhoto?.startsWith("data:") ? (
            <button type="button" className="cp-text-button" onClick={() => setCompanionAvatar(person.id, null)}>
              <XIcon size={13} />
              {locale === "ar" ? "الرجوع إلى الصورة المولَّدة" : "Revert to AI portrait"}
            </button>
          ) : (
            <button type="button" className="cp-text-button" onClick={generateNewFace}>
              <RefreshCw size={13} />
              {locale === "ar" ? "توليد وجه جديد" : "Generate new face"}
            </button>
          )}
        </div>
        <p className="cp-muted">
          {locale === "ar"
            ? "الصور المرفوعة تبقى على جهازك. الوجوه الافتراضية رسوم متجهة عربية عالية الجودة."
            : "Uploads stay on this device. Default faces are premium Arabic vector portraits."}
        </p>
        {error ? (
          <p role="alert" className="cp-notice">
            {error}
          </p>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="cp-sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void applyFile(file);
        }}
      />
      <CameraCaptureDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl) => setCompanionAvatar(person.id, dataUrl)}
      />
    </div>
  );
}
