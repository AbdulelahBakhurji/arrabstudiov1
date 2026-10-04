import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe2,
  ImageUp,
  Loader2,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import {
  addCompanion,
  addFact,
  canAddCompanion,
  liveCompanions,
  TONE_PRESETS,
  useCompanionState,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionToneName,
} from "@/domains/companions/model/companions";
import {
  PORTRAIT_COUNTRIES,
  catalogPortraitFiles,
  createPrivatePortrait,
  resolveCompanionPortraitSrc,
  type PortraitCountryId,
  type PortraitGender,
} from "@/domains/companions/catalog/portrait";
import { AvatarImageError, fileToAvatarDataUrl } from "@/domains/companions/lib/avatar-image";
import { GUEST_COMPANION_LIMIT } from "@/core/session/guest-mode";
import { pushToast } from "@/domains/notifications/notify";
import { syncCompanionMemory } from "@/domains/companions/ui/CompanionDetails";
import { PhotoAvatar } from "./CompanionFace";
import { cn } from "@/shared/lib/utils";

type WizardStep = "country" | "gender" | "purpose" | "review";

const STEPS: WizardStep[] = ["country", "gender", "purpose", "review"];

export function CreateCompanionWizard({
  space,
  familyMemberId,
  onCancel,
  onCreated,
}: {
  space: CompanionSpace;
  familyMemberId?: string | null;
  onCancel: () => void;
  onCreated: (person: CompanionProfile) => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const state = useCompanionState();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<WizardStep>("country");
  const [country, setCountry] = useState<PortraitCountryId>("sa");
  const [gender, setGender] = useState<PortraitGender | null>(null);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [purpose, setPurpose] = useState("");
  const [memory, setMemory] = useState("");
  const [tone, setTone] = useState<CompanionToneName>("measured");
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [faceSeed, setFaceSeed] = useState(0);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const taken = useMemo(() => {
    const live = liveCompanions(state)
      .filter((person) => person.domain !== "general")
      .map((person) => resolveCompanionPortraitSrc(person));
    const studio = state.studioCatalog
      .filter((entry) => !entry.archivedAt)
      .map((entry) => entry.avatarPhoto)
      .filter((url): url is string => Boolean(url?.trim()));
    // Catalog presets + your companions — no duplicate faces.
    return [...live, ...studio, ...catalogPortraitFiles()];
  }, [state]);

  const stepIndex = STEPS.indexOf(step);

  async function mintPortrait(
    nextGender: PortraitGender,
    nextCountry = country,
    forceNew = false,
  ) {
    setPortraitBusy(true);
    try {
      const minted = await createPrivatePortrait({
        country: nextCountry,
        gender: nextGender,
        name: name.trim() || task.trim() || "companion",
        domain: task.trim() || `custom-${nextCountry}`,
        purposeId: task.trim().toLowerCase() || undefined,
        taken: portraitUrl ? [...taken, portraitUrl] : taken,
        forceNew,
      });
      setPortraitUrl(minted.avatarPhoto);
      setFaceSeed(minted.faceSeed);
    } catch {
      pushToast({
        title: t("ccwPhotoFailed"),
        tone: "warn",
      });
    } finally {
      setPortraitBusy(false);
    }
  }

  useEffect(() => {
    // Country/gender clicks clear portraitUrl — remint so the face matches the look.
    if (step === "purpose" && gender && !portraitUrl && !portraitBusy) {
      void mintPortrait(gender, country, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remint when purpose opens or look changes
  }, [step, gender, country, portraitUrl]);

  async function onUpload(file: File | null | undefined) {
    if (!file) return;
    setPortraitBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file, 256);
      setPortraitUrl(dataUrl);
      setFaceSeed(Date.now() % 4096);
      pushToast({ title: t("ccwPhotoUploaded"), tone: "success" });
    } catch (err) {
      const code = err instanceof AvatarImageError ? err.message : "failed";
      pushToast({
        title:
          code === "too-large"
            ? t("ccwPhotoTooLarge")
            : code === "not-an-image"
              ? t("ccwPhotoNotImage")
              : t("ccwPhotoFailed"),
        tone: "warn",
      });
    } finally {
      setPortraitBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function goNext() {
    if (step === "country") setStep("gender");
    else if (step === "gender" && gender) setStep("purpose");
    else if (step === "purpose" && task.trim() && purpose.trim() && portraitUrl) {
      setStep("review");
    }
  }

  function goBack() {
    if (step === "gender") setStep("country");
    else if (step === "purpose") setStep("gender");
    else if (step === "review") setStep("purpose");
    else onCancel();
  }

  async function finish() {
    if (!gender || !portraitUrl || !task.trim() || !purpose.trim()) return;
    if (!canAddCompanion()) {
      pushToast({
        title: t("guestCompanionLimit").replace("{limit}", String(GUEST_COMPANION_LIMIT)),
        tone: "warn",
      });
      return;
    }
    setSaving(true);
    try {
      const person = addCompanion({
        name: name.trim() || task.trim(),
        domain: task.trim(),
        purposeId: task.trim().toLowerCase(),
        brief: purpose.trim(),
        space,
        toneName: tone,
        tone: { ...TONE_PRESETS[tone] },
        gender,
        faceSeed,
        avatarPhoto: portraitUrl,
        familyMemberId: familyMemberId ?? undefined,
      });
      const memoryText = memory.trim();
      if (memoryText) {
        addFact({
          companionId: person.id,
          text: memoryText,
          source: ar ? "عند الإنشاء" : "On create",
          kind: "explicit",
          space,
        });
      }
      // Seed purpose as standing memory so tone + purpose shape replies immediately.
      addFact({
        companionId: person.id,
        text: ar
          ? `الغرض: ${purpose.trim()}`
          : `Purpose: ${purpose.trim()}`,
        source: ar ? "الغرض" : "Purpose",
        kind: "explicit",
        space,
      });
      void syncCompanionMemory().catch(() => undefined);
      pushToast({
        title: t("ccwCreatedToast"),
        body: person.name,
        tone: "success",
      });
      onCreated(person);
    } catch (err) {
      if (err instanceof Error && err.message === "guest_companion_limit") {
        pushToast({
          title: t("guestCompanionLimit").replace("{limit}", String(GUEST_COMPANION_LIMIT)),
          tone: "warn",
        });
        return;
      }
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const canContinue =
    (step === "country" && Boolean(country)) ||
    (step === "gender" && Boolean(gender)) ||
    (step === "purpose" && Boolean(task.trim() && purpose.trim() && portraitUrl)) ||
    (step === "review" && Boolean(portraitUrl && task.trim() && purpose.trim()));

  return (
    <div className="ccw">
      <header className="ccw-hero">
        <div className="ccw-hero-copy">
          <p className="ccw-kicker">
            <Sparkles className="size-3.5" strokeWidth={1.8} />
            {t("ccwKicker")}
          </p>
          <h2>{t("ccwTitle")}</h2>
          <p>{t("ccwSubtitle")}</p>
        </div>
        <ol className="ccw-steps" aria-label={t("ccwStepsLabel")}>
          {STEPS.map((id, index) => (
            <li
              key={id}
              className={cn(
                "ccw-step",
                index === stepIndex && "is-current",
                index < stepIndex && "is-done",
              )}
            >
              <span>{index + 1}</span>
              <small>
                {id === "country"
                  ? t("ccwStepCountry")
                  : id === "gender"
                    ? t("ccwStepGender")
                    : id === "purpose"
                      ? t("ccwStepPurpose")
                      : t("ccwStepReview")}
              </small>
            </li>
          ))}
        </ol>
      </header>

      <div className="ccw-body">
        {step === "country" ? (
          <section className="ccw-panel">
            <div className="ccw-panel-head">
              <Globe2 className="size-4" strokeWidth={1.8} />
              <div>
                <h3>{t("ccwCountryTitle")}</h3>
                <p>{t("ccwCountryBody")}</p>
              </div>
            </div>
            <div className="ccw-country-grid" role="listbox" aria-label={t("ccwCountryTitle")}>
              {PORTRAIT_COUNTRIES.map((item) => {
                const selected = country === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn("ccw-country", selected && "is-on")}
                    onClick={() => {
                      setCountry(item.id);
                      setPortraitUrl(null);
                    }}
                  >
                    <strong>{ar ? item.nameAr : item.nameEn}</strong>
                    {selected ? <Check className="size-3.5" strokeWidth={2} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step === "gender" ? (
          <section className="ccw-panel">
            <div className="ccw-panel-head">
              <UserRound className="size-4" strokeWidth={1.8} />
              <div>
                <h3>{t("ccwGenderTitle")}</h3>
                <p>{t("ccwGenderBody")}</p>
              </div>
            </div>
            <div className="ccw-gender-row">
              {(
                [
                  { id: "female" as const, label: t("ccwGenderFemale") },
                  { id: "male" as const, label: t("ccwGenderMale") },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn("ccw-gender", gender === option.id && "is-on")}
                  aria-pressed={gender === option.id}
                  onClick={() => {
                    setGender(option.id);
                    setPortraitUrl(null);
                  }}
                >
                  <span className="ccw-gender-orb" data-gender={option.id} />
                  <strong>{option.label}</strong>
                  <small>{t("ccwGenderHint")}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === "purpose" ? (
          <section className="ccw-panel ccw-purpose">
            <div className="ccw-portrait-card">
              <div className="ccw-portrait-frame">
                {portraitBusy || !portraitUrl ? (
                  <span className="ccw-portrait-loading">
                    <Loader2 className="size-6 animate-spin" strokeWidth={1.8} />
                  </span>
                ) : (
                  <PhotoAvatar
                    src={portraitUrl}
                    name={name || task || "Companion"}
                    size="xl"
                    state="lit"
                  />
                )}
              </div>
              <div className="ccw-photo-actions">
                <button
                  type="button"
                  className="ccw-refresh"
                  disabled={portraitBusy || !gender}
                  onClick={() => gender && void mintPortrait(gender, country, true)}
                >
                  <RefreshCw
                    className={cn("size-3.5", portraitBusy && "animate-spin")}
                    strokeWidth={1.8}
                  />
                  {t("ccwNewPicture")}
                </button>
                <button
                  type="button"
                  className="ccw-refresh"
                  disabled={portraitBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageUp className="size-3.5" strokeWidth={1.8} />
                  {t("ccwUploadPicture")}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => void onUpload(event.target.files?.[0])}
                />
              </div>
              <p className="ccw-portrait-note">{t("ccwPrivatePicture")}</p>
            </div>

            <div className="ccw-fields">
              <label className="cp-label">
                {t("ccwName")}
                <input
                  className="cp-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("ccwNamePlaceholder")}
                />
              </label>
              <label className="cp-label">
                {t("ccwTask")}
                <input
                  className="cp-input"
                  required
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  placeholder={t("ccwTaskPlaceholder")}
                />
              </label>
              <label className="cp-label">
                {t("ccwPurpose")}
                <textarea
                  className="cp-input ccw-purpose-area"
                  required
                  rows={4}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder={t("ccwPurposePlaceholder")}
                />
                <span className="cp-field-hint">{t("compBriefHint")}</span>
              </label>
              <label className="cp-label">
                {t("ccwMemory")}
                <textarea
                  className="cp-input ccw-purpose-area"
                  rows={3}
                  value={memory}
                  onChange={(event) => setMemory(event.target.value)}
                  placeholder={t("ccwMemoryPlaceholder")}
                />
                <span className="cp-field-hint">{t("ccwMemoryHint")}</span>
              </label>
              <div className="cp-tone-options" role="group" aria-label={t("ccwToneLabel")}>
                {(["direct", "measured"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={tone === option}
                    onClick={() => setTone(option)}
                  >
                    <strong>
                      {t(option === "direct" ? "compBornDirect" : "compBornMeasured")}
                    </strong>
                    <p>
                      {t(
                        option === "direct"
                          ? "compBornDirectExample"
                          : "compBornMeasuredExample",
                      )}
                    </p>
                    {tone === option ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {step === "review" ? (
          <section className="ccw-panel ccw-review">
            <div className="ccw-review-card">
              <PhotoAvatar
                src={portraitUrl || ""}
                name={name || task}
                size="xl"
                state="lit"
              />
              <div>
                <p className="ccw-kicker">{t("ccwReviewReady")}</p>
                <h3>{name.trim() || task.trim()}</h3>
                <p className="ccw-review-task">{task.trim()}</p>
                <p className="ccw-review-purpose">{purpose.trim()}</p>
                {memory.trim() ? (
                  <p className="ccw-review-purpose">
                    <strong>{t("ccwMemory")}: </strong>
                    {memory.trim()}
                  </p>
                ) : null}
                <div className="ccw-review-meta">
                  <span>
                    {ar
                      ? PORTRAIT_COUNTRIES.find((item) => item.id === country)?.nameAr
                      : PORTRAIT_COUNTRIES.find((item) => item.id === country)?.nameEn}
                  </span>
                  <span>
                    {gender === "female" ? t("ccwGenderFemale") : t("ccwGenderMale")}
                  </span>
                  <span>
                    {tone === "direct" ? t("compBornDirect") : t("compBornMeasured")}
                  </span>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <footer className="ccw-footer">
        <button type="button" className="cp-button" onClick={goBack} disabled={saving}>
          <ArrowLeft className="size-3.5" strokeWidth={1.8} />
          {step === "country" ? t("cancel") : t("ccwBack")}
        </button>
        {step === "review" ? (
          <button
            type="button"
            className="cp-button cp-primary"
            disabled={!canContinue || saving || portraitBusy}
            onClick={() => void finish()}
          >
            {saving ? t("loading") : t("ccwCreate")}
            <Sparkles className="size-3.5" strokeWidth={1.8} />
          </button>
        ) : (
          <button
            type="button"
            className="cp-button cp-primary"
            disabled={!canContinue || portraitBusy}
            onClick={goNext}
          >
            {t("ccwContinue")}
            <ArrowRight className="size-3.5" strokeWidth={1.8} />
          </button>
        )}
      </footer>
    </div>
  );
}
