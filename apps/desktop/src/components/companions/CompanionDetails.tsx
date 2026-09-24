import { useEffect, useRef, useState } from "react";
import { Archive, Camera, Download, ImageUp, RotateCcw, Trash2, X as XIcon } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi } from "@/lib/api";
import { AvatarImageError, fileToAvatarDataUrl, videoFrameToAvatarDataUrl } from "@/lib/avatar-image";
import { companionDisplayName, isSecretCompanionBrief } from "@/lib/companion-catalog";
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
} from "@/lib/companions";
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

  return (
    <div className="cp-stack">
      <p className="cp-muted">
        {ar
          ? "كل معلومة ومصدرها تحت سيطرتك. اختر ما يُشارك مع الرفاق."
          : "Every fact and its source. You choose what companions can share."}
      </p>
      {person ? (
        <label className="cp-label">
          {t("compBrief")}
          <textarea
            className="cp-input cp-catalog-purpose"
            rows={6}
            defaultValue={isSecretCompanionBrief(person.brief) ? "" : (person.brief ?? "")}
            key={person.id + String(person.brief ?? "")}
            disabled={!ready}
            onBlur={(event) => {
              const next = event.target.value.trim();
              const previous = isSecretCompanionBrief(person.brief) ? "" : (person.brief ?? "");
              if (next === previous) return;
              const target = person.createdAt ? person : ensureGeneralCompanion(person.space);
              updateCompanion(target.id, { brief: next || null });
              sync();
            }}
            placeholder={t("compBriefPlaceholder")}
          />
          <span className="cp-field-hint">{t("compBriefHint")}</span>
        </label>
      ) : null}
      <form className="cp-memory-form" onSubmit={(event) => void submitFact(event)}>
        <label className="cp-sr-only" htmlFor="companion-memory-input">
          {t("compKnows")}
        </label>
        <input
          id="companion-memory-input"
          className="cp-input"
          value={draft}
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            ar ? "معلومة أحب أن تتذكرها…" : "Something I want you to remember…"
          }
        />
        {!person ? (
          <label className="cp-memory-assign">
            <span className="cp-sr-only">{ar ? "تعيين لرفيق" : "Assign to companion"}</span>
            <select
              className="cp-input"
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
          </label>
        ) : null}
        <button className="cp-button cp-primary" disabled={!ready || !draft.trim()} type="submit">
          {t("compAdd")}
        </button>
      </form>
      {!ready ? (
        <p className="cp-muted" role="status">
          {ar ? "جارٍ فتح الذاكرة…" : "Opening memory…"}
        </p>
      ) : null}
      {notice ? (
        <p className="cp-memory-notice" role="status">
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
        <div className="cp-quiet-box">{t("compKnowsEmpty")}</div>
      ) : null}
      {facts.length > 0 ? (
        <ul className="cp-stack">
          {facts.map((fact) => (
            <li className="cp-fact" key={fact.id}>
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
                    className="cp-input"
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
                <p>{fact.text}</p>
              )}
              <div className="cp-meta">
                <span className="cp-tag">
                  {t(fact.kind === "explicit" ? "compFactExplicit" : "compFactInferred")}
                </span>
                <span>{fact.source}</span>
                <span className="cp-tag">{companionLabel(fact.companionId)}</span>
                <time dateTime={fact.createdAt}>
                  {new Date(fact.createdAt).toLocaleDateString(locale, {
                    day: "numeric",
                    month: "short",
                  })}
                </time>
              </div>
              <div className="cp-actions">
                {editingId === fact.id ? null : (
                  <button
                    type="button"
                    className="cp-text-button"
                    onClick={() => {
                      setEditingId(fact.id);
                      setEditText(fact.text);
                    }}
                  >
                    {ar ? "تعديل" : "Edit"}
                  </button>
                )}
                <button
                  type="button"
                  className="cp-text-button"
                  aria-pressed={fact.shared}
                  onClick={() => {
                    setFactShared(fact.id, !fact.shared);
                    sync();
                  }}
                >
                  {t(fact.shared ? "compDontShare" : "compShared")}
                </button>
                <button
                  type="button"
                  className="cp-text-button cp-delete"
                  onClick={() => {
                    deleteFact(fact.id);
                    if (editingId === fact.id) {
                      setEditingId(null);
                      setEditText("");
                    }
                    setNotice(ar ? "حُذفت." : "Deleted.");
                    sync();
                  }}
                >
                  <Trash2 size={13} />
                  {t("delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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

  return (
    <div className="cp-stack cp-tone-panel">
      <p className="cp-muted">
        {ar
          ? "اختر أسلوبًا جاهزًا أو عدّل كل محور. يمكنك أيضًا طلب تغيير الأسلوب أثناء المحادثة («كن أصرح»، «اختصر»)."
          : "Pick a style or fine-tune each axis. You can also ask in chat (“be blunter”, “keep it short”)."}
      </p>

      <div className="cp-tone-active" aria-live="polite">
        <span className="cp-tone-active-label">
          {ar ? "الأسلوب الحالي" : "Current style"}
        </span>
        <strong className="cp-tone-active-value">
          {activeStyle
            ? ar
              ? activeStyle.labelAr
              : activeStyle.labelEn
            : ar
              ? "مخصص"
              : "Custom"}
        </strong>
        <span className="cp-tone-sync">
          {syncing
            ? ar
              ? "يحفظ…"
              : "Saving…"
            : syncedAt
              ? ar
                ? "محفوظ"
                : "Saved"
              : null}
        </span>
      </div>

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

      <div className="cp-tone-preview" aria-live="polite">
        <span className="cp-tone-preview-label">
          {ar ? "معاينة الرد" : "Reply preview"}
        </span>
        <p className="cp-tone-preview-sample">“{preview}”</p>
      </div>

      {toneAxes.map((axis) => (
        <label className="cp-tone-range" key={axis.key}>
          <span>
            {axis.label}
            <output>{tone[axis.key]}</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={tone[axis.key]}
            onChange={(event) => {
              const ready = readyPerson();
              setCompanionTone(ready.id, { [axis.key]: Number(event.target.value) });
              sync();
            }}
            onPointerUp={() => sync(true)}
            onBlur={() => sync(true)}
          />
          <span className="cp-tone-ends">
            <small>{axis.low}</small>
            <small>{axis.high}</small>
          </span>
        </label>
      ))}

      <label className="cp-label">
        {ar ? "ملاحظات الأسلوب" : "Style notes"}
        <textarea
          className="cp-input"
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
        <span className="cp-field-hint">
          {ar
            ? "أعلى أولوية من المنزلقات — اكتب كيف تريد أن يرد."
            : "Highest priority over the sliders — write how they should sound."}
        </span>
      </label>

      <fieldset className="cp-tone-callouts">
        <legend>{t("compCallOut")}</legend>
        <div className="cp-actions cp-tone-callout-chips">
          {CALL_OUT_TOPICS.map((topic) => (
            <button
              key={topic}
              type="button"
              className="cp-button"
              aria-pressed={live.callOut.includes(topic)}
              onClick={() => {
                const ready = readyPerson();
                toggleCallOut(ready.id, topic);
                sync(true);
              }}
            >
              {callOutLabels[topic]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="cp-actions">
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
          {person.avatarPhoto ? (
            <button type="button" className="cp-text-button" onClick={() => setCompanionAvatar(person.id, null)}>
              <XIcon size={13} />
              {locale === "ar" ? "الرجوع إلى الصورة المولَّدة" : "Revert to AI portrait"}
            </button>
          ) : (
            <button
              type="button"
              className="cp-text-button"
              onClick={() => {
                updateCompanion(person.id, {
                  faceSeed: Math.floor(Math.random() * 4096),
                  avatarPhoto: null,
                });
              }}
            >
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
