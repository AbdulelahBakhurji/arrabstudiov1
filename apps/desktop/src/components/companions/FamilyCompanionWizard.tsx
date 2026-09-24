import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  HeartHandshake,
  Home,
  MessageSquare,
  Moon,
  Sparkles,
  UserRound,
  UsersRound,
  Volume2,
  X,
} from "lucide-react";
import type { FamilyMemberPublic } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { COMPANION_PRESETS } from "@/lib/companion-catalog";
import {
  addCompanion,
  addParentGuidanceFact,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionToneName,
} from "@/lib/companions";
import { arrabApi } from "@/lib/api";
import { companionPortraitUrl, presetPortraitSeed } from "@/lib/companion-portrait";
import { getChildSeatPrefs } from "@/lib/guardian-store";
import { PhotoAvatar } from "./CompanionFace";
import { cn } from "@/lib/utils";

type WizardStep =
  | "audience"
  | "template"
  | "look"
  | "personality"
  | "voice"
  | "context"
  | "review"
  | "guardian";

type AudienceKind = "me" | "child" | "family";

type TemplateId =
  | "study"
  | "bedtime"
  | "curiosity"
  | "life"
  | "organizer"
  | "scratch";

const PORTRAIT_SEEDS = [11, 29, 47, 83, 101, 137, 163, 199] as const;

const TEMPLATES: {
  id: TemplateId;
  presetId: string | null;
  titleKey:
    | "fcwTplStudy"
    | "fcwTplBedtime"
    | "fcwTplCuriosity"
    | "fcwTplLife"
    | "fcwTplOrganizer"
    | "fcwTplScratch";
  hintKey:
    | "fcwTplStudyHint"
    | "fcwTplBedtimeHint"
    | "fcwTplCuriosityHint"
    | "fcwTplLifeHint"
    | "fcwTplOrganizerHint"
    | "fcwTplScratchHint";
  kidSafe: boolean;
  Icon: typeof BookOpen;
}[] = [
  {
    id: "study",
    presetId: "study",
    titleKey: "fcwTplStudy",
    hintKey: "fcwTplStudyHint",
    kidSafe: true,
    Icon: BookOpen,
  },
  {
    id: "bedtime",
    presetId: "sleep",
    titleKey: "fcwTplBedtime",
    hintKey: "fcwTplBedtimeHint",
    kidSafe: true,
    Icon: Moon,
  },
  {
    id: "curiosity",
    presetId: "focus",
    titleKey: "fcwTplCuriosity",
    hintKey: "fcwTplCuriosityHint",
    kidSafe: true,
    Icon: Compass,
  },
  {
    id: "life",
    presetId: "training",
    titleKey: "fcwTplLife",
    hintKey: "fcwTplLifeHint",
    kidSafe: false,
    Icon: HeartHandshake,
  },
  {
    id: "organizer",
    presetId: "inbox",
    titleKey: "fcwTplOrganizer",
    hintKey: "fcwTplOrganizerHint",
    kidSafe: false,
    Icon: Home,
  },
  {
    id: "scratch",
    presetId: null,
    titleKey: "fcwTplScratch",
    hintKey: "fcwTplScratchHint",
    kidSafe: true,
    Icon: Sparkles,
  },
];

function stepsFor(isChildAudience: boolean): WizardStep[] {
  const base: WizardStep[] = [
    "audience",
    "template",
    "look",
    "personality",
    "voice",
    "context",
    "review",
  ];
  if (isChildAudience) base.push("guardian");
  return base;
}

function deriveTone(playful: number, curious: number, gentle: number): CompanionToneName {
  // playful 0=playful 100=calm; curious 0=curious 100=focused; gentle 0=gentle 100=direct
  const directScore = gentle + (100 - playful) * 0.35 + curious * 0.25;
  return directScore >= 140 ? "direct" : "measured";
}

function sampleReply(
  playful: number,
  curious: number,
  gentle: number,
  name: string,
  ar: boolean,
): string {
  const calm = playful > 55;
  const focused = curious > 55;
  const direct = gentle > 55;
  if (ar) {
    if (calm && focused) return `${name}: خلّنا نجزّئها — خطوة واحدة واضحة الآن.`;
    if (direct) return `${name}: الفكرة واضحة. هذا ما نفعله تالياً.`;
    if (!calm) return `${name}: أحب هذا السؤال! خلّنا نستكشفه معاً بلطف.`;
    return `${name}: معنا الوقت. أخبرني أكثر وسنبني الإجابة معاً.`;
  }
  if (calm && focused) return `${name}: Let’s split it — one clear next step.`;
  if (direct) return `${name}: Got it. Here’s what we do next.`;
  if (!calm) return `${name}: Love that question! Let’s explore it together.`;
  return `${name}: No rush. Tell me a bit more and we’ll shape the answer.`;
}

function voiceSampleLine(name: string, ar: boolean): string {
  return ar
    ? `مرحباً، أنا ${name}. سعيد بلقائك.`
    : `Hi, I’m ${name}. Glad to meet you.`;
}

export function FamilyCompanionWizard({
  space,
  members,
  defaultMemberId = null,
  onClose,
  onCreated,
}: {
  space: CompanionSpace;
  members: FamilyMemberPublic[];
  defaultMemberId?: string | null;
  onClose: () => void;
  onCreated: (person: CompanionProfile) => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";

  const children = useMemo(() => members.filter((m) => m.role === "child"), [members]);
  const owner =
    members.find((m) => m.isOwner) ??
    members.find((m) => m.role === "parent" || m.role === "partner") ??
    null;
  const defaultChild =
    children.find((m) => m.id === defaultMemberId) ?? children[0] ?? null;

  const [step, setStep] = useState<WizardStep>("audience");
  const [audience, setAudience] = useState<AudienceKind>(
    defaultChild && defaultMemberId === defaultChild.id ? "child" : "me",
  );
  const [childId, setChildId] = useState(defaultChild?.id ?? "");
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [name, setName] = useState("");
  const [portraitSeed, setPortraitSeed] = useState<number>(PORTRAIT_SEEDS[0]!);
  const [playful, setPlayful] = useState(40);
  const [curious, setCurious] = useState(35);
  const [gentle, setGentle] = useState(30);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);

  const child = children.find((m) => m.id === childId) ?? defaultChild;
  const isChildAudience = audience === "child" && Boolean(child);
  const kidSafeOnly =
    isChildAudience && child
      ? getChildSeatPrefs(child.id).companionAccess === "kid_safe"
      : false;

  const flow = stepsFor(isChildAudience);
  const stepIndex = Math.max(0, flow.indexOf(step));
  const progress = ((stepIndex + 1) / flow.length) * 100;

  const template = TEMPLATES.find((item) => item.id === templateId) ?? null;
  const preset =
    template?.presetId != null
      ? (COMPANION_PRESETS.find((p) => p.id === template.presetId) ?? null)
      : null;

  const visibleTemplates = useMemo(
    () => (kidSafeOnly ? TEMPLATES.filter((item) => item.kidSafe) : TEMPLATES),
    [kidSafeOnly],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      const preferred = list.filter((v) =>
        ar ? v.lang.toLowerCase().startsWith("ar") : v.lang.toLowerCase().startsWith("en"),
      );
      const pick = (preferred.length ? preferred : list).slice(0, 4);
      setVoices(pick);
      if (!voiceUri && pick[0]) setVoiceUri(pick[0].voiceURI);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [ar, voiceUri]);

  useEffect(() => {
    if (kidSafeOnly && templateId && !visibleTemplates.some((item) => item.id === templateId)) {
      setTemplateId(null);
    }
  }, [kidSafeOnly, templateId, visibleTemplates]);

  useEffect(() => {
    if (!isChildAudience && step === "guardian") setStep("review");
  }, [isChildAudience, step]);

  const previewName = useMemo(() => {
    if (name.trim()) return name.trim();
    if (template && template.id !== "scratch") return t(template.titleKey);
    if (preset) return ar ? preset.nameAr : preset.name;
    return t("familyWizardUntitled");
  }, [name, template, preset, ar, t]);

  const toneName = deriveTone(playful, curious, gentle);
  const previewBrief = useMemo(() => {
    const bits: string[] = [];
    if (preset) bits.push(ar ? preset.briefAr : preset.brief);
    else if (template && template.id !== "scratch") bits.push(t(template.hintKey));
    const vibe =
      toneName === "direct"
        ? ar
          ? "أسلوب مباشر وواضح."
          : "Direct and clear tone."
        : ar
          ? "أسلوب هادئ ومتوازن."
          : "Calm, measured tone.";
    bits.push(vibe);
    if (context.trim()) bits.push(context.trim());
    return bits.filter(Boolean).join(" ");
  }, [preset, template, toneName, context, ar, t]);

  const sample = sampleReply(playful, curious, gentle, previewName, ar);

  const portraitUrl = companionPortraitUrl({
    seed: preset ? presetPortraitSeed(preset.id) + portraitSeed : portraitSeed,
    domain: preset?.domain ?? "general",
    name: previewName,
    size: 256,
  });

  function goNext() {
    const idx = flow.indexOf(step);
    const next = flow[idx + 1];
    if (!next) return;
    if (step === "template" && template && template.id !== "scratch" && !name.trim()) {
      setName(t(template.titleKey));
    }
    setStep(next);
  }

  function goBack() {
    const idx = flow.indexOf(step);
    const prev = flow[idx - 1];
    if (prev) setStep(prev);
  }

  const canNext =
    (step === "audience" &&
      (audience === "me" || audience === "family" || (audience === "child" && Boolean(child)))) ||
    (step === "template" && Boolean(templateId)) ||
    (step === "look" && Boolean(previewName.trim())) ||
    step === "personality" ||
    step === "voice" ||
    step === "context" ||
    step === "review" ||
    step === "guardian";

  function playVoicePreview() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(voiceSampleLine(previewName, ar));
    const match = voices.find((v) => v.voiceURI === voiceUri);
    if (match) utter.voice = match;
    utter.rate = 1;
    window.speechSynthesis.speak(utter);
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      const familyMemberId =
        audience === "family" ? null : audience === "child" ? (child?.id ?? null) : (owner?.id ?? null);

      const person = addCompanion({
        name: previewName,
        domain: (preset?.domain || previewName).toLowerCase().replace(/\s+/g, "-"),
        purposeId: preset?.purposeId ?? previewName.toLowerCase().replace(/\s+/g, "-"),
        brief: previewBrief,
        connectors: preset?.connectors ?? [],
        space,
        toneName,
        faceSeed: preset ? presetPortraitSeed(preset.id) + portraitSeed : portraitSeed,
        familyMemberId,
      });

      if (isChildAudience && child && context.trim()) {
        addParentGuidanceFact({
          companionId: person.id,
          text: context.trim(),
          authorName: owner?.displayName ?? "Parent",
        });
        try {
          await arrabApi.addFamilyGuidance({
            companionId: person.id,
            childMemberId: child.id,
            authorMemberId: owner?.id ?? child.id,
            content: context.trim(),
          });
        } catch {
          /* local guidance kept */
        }
      }

      onCreated(person);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const stepTitle =
    step === "audience"
      ? t("fcwAudienceTitle")
      : step === "template"
        ? t("fcwTemplateTitle")
        : step === "look"
          ? t("fcwLookTitle")
          : step === "personality"
            ? t("fcwPersonalityTitle")
            : step === "voice"
              ? t("fcwVoiceTitle")
              : step === "context"
                ? t("fcwContextTitle")
                : step === "review"
                  ? t("fcwReviewTitle")
                  : t("fcwGuardianTitle");

  const stepBody =
    step === "audience"
      ? t("fcwAudienceBody")
      : step === "template"
        ? t("fcwTemplateBody")
        : step === "look"
          ? t("fcwLookBody")
          : step === "personality"
            ? t("fcwPersonalityBody")
            : step === "voice"
              ? t("fcwVoiceBody")
              : step === "context"
                ? t("fcwContextBody")
                : step === "review"
                  ? t("fcwReviewBody")
                  : t("fcwGuardianBody").replace("{name}", child?.displayName ?? "");

  return createPortal(
    <div
      className="fcw"
      dir={ar ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={t("familyWizardTitle")}
    >
      <div className="fcw-atmosphere" aria-hidden>
        <span className="fcw-glow fcw-glow-a" />
        <span className="fcw-glow fcw-glow-b" />
        <span className="fcw-grid" />
      </div>
      <div className="fcw-shell">
        <header className="fcw-top">
          <button type="button" className="fcw-back" onClick={onClose}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            <span>{t("familyWizardKicker")}</span>
          </button>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("cancel")}>
            <X size={18} />
          </button>
        </header>

        <div className="fcw-hero">
          <p className="fcw-eyebrow">ARRAB · {t("familyWizardKicker").toUpperCase()}</p>
          <h1>{t("familyWizardTitle")}</h1>
          <div className="fcw-rail" aria-hidden>
            <p className="fcw-stage-index" style={{ marginBottom: 0 }}>
              {t("afmStepOf")
                .replace("{current}", String(stepIndex + 1))
                .replace("{total}", String(flow.length))}
            </p>
            <div className="fcw-progress">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <section className="fcw-stage" key={step}>
          <header className="fcw-stage-intro">
            <p className="fcw-stage-kicker">{stepTitle}</p>
            <p className="fcw-stage-lead">{stepBody}</p>
          </header>

          <div className="fcw-body">
            {step === "audience" ? (
              <div className="afm-choice-grid afm-choice-grid-auto">
                <button
                  type="button"
                  className={cn("afm-choice-card", audience === "me" && "is-on")}
                  aria-pressed={audience === "me"}
                  onClick={() => setAudience("me")}
                >
                  <span className="afm-choice-orb" aria-hidden>
                    <UserRound size={22} strokeWidth={1.5} />
                  </span>
                  <strong>{t("fcwForMe")}</strong>
                  <small>{t("fcwForMeHint")}</small>
                  {audience === "me" ? (
                    <Check size={15} className="afm-choice-check" strokeWidth={2.2} />
                  ) : null}
                </button>
                {children.map((item) => {
                  const on = audience === "child" && childId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn("afm-choice-card", on && "is-on")}
                      aria-pressed={on}
                      onClick={() => {
                        setAudience("child");
                        setChildId(item.id);
                      }}
                    >
                      <span
                        className="afm-choice-orb is-face"
                        style={{ background: item.color }}
                        aria-hidden
                      >
                        {item.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <strong>{t("fcwForChild").replace("{name}", item.displayName)}</strong>
                      <small>{t("familyRoleChild")}</small>
                      {on ? <Check size={15} className="afm-choice-check" strokeWidth={2.2} /> : null}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={cn("afm-choice-card", audience === "family" && "is-on")}
                  aria-pressed={audience === "family"}
                  onClick={() => setAudience("family")}
                >
                  <span className="afm-choice-orb is-soft" aria-hidden>
                    <UsersRound size={22} strokeWidth={1.5} />
                  </span>
                  <strong>{t("fcwForFamily")}</strong>
                  <small>{t("fcwForFamilyHint")}</small>
                  {audience === "family" ? (
                    <Check size={15} className="afm-choice-check" strokeWidth={2.2} />
                  ) : null}
                </button>
              </div>
            ) : null}

            {step === "template" ? (
              <div className="fcw-pick-grid">
                {visibleTemplates.map((item) => {
                  const on = templateId === item.id;
                  const Icon = item.Icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn("fcw-pick-card", on && "is-on")}
                      aria-pressed={on}
                      onClick={() => setTemplateId(item.id)}
                    >
                      <span className="fcw-pick-face fcw-pick-add">
                        <Icon size={20} strokeWidth={1.6} />
                      </span>
                      <strong>{t(item.titleKey)}</strong>
                      <small>{t(item.hintKey)}</small>
                      {on ? <Check size={14} className="fcw-pick-check" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === "look" ? (
              <div className="fcw-form">
                <div className="fcw-breath" style={{ width: "fit-content", margin: "0 auto 12px" }}>
                  <PhotoAvatar src={portraitUrl} name={previewName} size="lg" />
                </div>
                <label className="fcw-field">
                  <span>{t("familyBoardCompanionName")}</span>
                  <input
                    className="sf-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      template && template.id !== "scratch"
                        ? t(template.titleKey)
                        : t("familyBoardCompanionName")
                    }
                    autoFocus
                  />
                </label>
                <p className="afm-avatars-label">{t("afmPickAvatar")}</p>
                <div className="afm-avatar-row">
                  {PORTRAIT_SEEDS.map((seed) => {
                    const src = companionPortraitUrl({
                      seed: preset ? presetPortraitSeed(preset.id) + seed : seed,
                      domain: preset?.domain ?? "general",
                      name: `face-${seed}`,
                      size: 128,
                    });
                    const on = portraitSeed === seed;
                    return (
                      <button
                        key={seed}
                        type="button"
                        className={cn("afm-avatar", on && "is-on")}
                        aria-pressed={on}
                        onClick={() => setPortraitSeed(seed)}
                        style={{ padding: 0, overflow: "hidden", background: "transparent" }}
                      >
                        <img src={src} alt="" width={40} height={40} style={{ display: "block" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {step === "personality" ? (
              <div className="fcw-slider-block">
                <div className="fcw-slider-row">
                  <div className="fcw-slider-labels">
                    <span>{t("fcwPlayful")}</span>
                    <span>{t("fcwCalm")}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={playful}
                    onChange={(e) => setPlayful(Number(e.target.value))}
                  />
                </div>
                <div className="fcw-slider-row">
                  <div className="fcw-slider-labels">
                    <span>{t("fcwCurious")}</span>
                    <span>{t("fcwFocused")}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={curious}
                    onChange={(e) => setCurious(Number(e.target.value))}
                  />
                </div>
                <div className="fcw-slider-row">
                  <div className="fcw-slider-labels">
                    <span>{t("fcwGentle")}</span>
                    <span>{t("fcwDirect")}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={gentle}
                    onChange={(e) => setGentle(Number(e.target.value))}
                  />
                </div>
                <p className="afm-avatars-label">{t("fcwSampleLabel")}</p>
                <p className="fcw-sample">{sample}</p>
              </div>
            ) : null}

            {step === "voice" ? (
              <div className="fcw-form">
                {voices.length > 0 ? (
                  <div className="fcw-voice-row">
                    {voices.map((v, index) => {
                      const on = voiceUri === v.voiceURI;
                      return (
                        <button
                          key={v.voiceURI}
                          type="button"
                          className={cn("fcw-voice-chip", on && "is-on")}
                          aria-pressed={on}
                          onClick={() => setVoiceUri(v.voiceURI)}
                        >
                          {v.name.split(" ")[0] || `Voice ${index + 1}`}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="cp-muted">{t("fcwVoiceSkip")}</p>
                )}
                <button
                  type="button"
                  className="cp-button"
                  style={{ marginTop: 12 }}
                  onClick={playVoicePreview}
                  disabled={!voices.length}
                >
                  <Volume2 size={14} />
                  {t("fcwVoicePreview")}
                </button>
              </div>
            ) : null}

            {step === "context" ? (
              <div className="fcw-form">
                <label className="fcw-field">
                  <span>{t("fcwContextTitle")}</span>
                  <textarea
                    className="sf-input sf-textarea"
                    rows={4}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder={t("fcwContextPh")}
                    autoFocus
                  />
                </label>
              </div>
            ) : null}

            {step === "review" ? (
              <div className="cp-chat-welcome fcw-ready">
                <span className="cp-welcome-icon fcw-breath" aria-hidden>
                  <PhotoAvatar src={portraitUrl} name={previewName} size="lg" />
                </span>
                <h2>{previewName}</h2>
                <p className="cp-muted">{previewBrief.slice(0, 180)}</p>
                <p className="fcw-ready-note">{t("familyWizardAccountNote")}</p>
              </div>
            ) : null}

            {step === "guardian" ? (
              <div className="cp-chat-welcome fcw-ready">
                <span className="cp-welcome-icon" aria-hidden>
                  <HeartHandshake size={28} strokeWidth={1.35} />
                </span>
                <h2>{t("fcwGuardianTitle")}</h2>
                <p className="cp-muted">
                  {t("fcwGuardianBody").replace("{name}", child?.displayName ?? "")}
                </p>
              </div>
            ) : null}
          </div>

          <footer className="fcw-footer">
            {step !== "audience" ? (
              <button type="button" className="cp-text-button" onClick={goBack} disabled={busy}>
                <ArrowLeft size={15} />
                {t("back")}
              </button>
            ) : (
              <button type="button" className="cp-text-button" onClick={onClose}>
                {t("cancel")}
              </button>
            )}
            {step === "review" && !isChildAudience ? (
              <button
                type="button"
                className="cp-button cp-primary"
                disabled={busy || !canNext}
                onClick={() => void finish()}
              >
                <MessageSquare size={14} strokeWidth={1.8} />
                {t("fcwCreateMeet")}
                <ArrowRight size={14} />
              </button>
            ) : step === "guardian" ? (
              <button
                type="button"
                className="cp-button cp-primary"
                disabled={busy || !canNext}
                onClick={() => void finish()}
              >
                <MessageSquare size={14} strokeWidth={1.8} />
                {t("fcwGuardianConfirm")}
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={cn("cp-button", canNext && "cp-primary")}
                disabled={!canNext}
                onClick={goNext}
              >
                {step === "voice" ? t("fcwVoiceSkip") : t("afmContinue")}
                <ArrowRight size={14} />
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
