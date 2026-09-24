import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Moon,
  QrCode,
  Smartphone,
  X,
} from "lucide-react";
import type { FamilyAgeTier, FamilyMemberPublic, FamilyMemberRole } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import {
  applyChildDayOneGuardrails,
  defaultBedtimeForAgeTier,
  setChildSeatPrefs,
  type CompanionAccessMode,
  type OversightMode,
} from "@/lib/guardian-store";
import {
  colorForPortraitId,
  defaultGenderForKind,
  defaultPortraitId,
  FAMILY_KIND_PREVIEW,
  familyPortraitUrl,
  findFamilyPortrait,
  listFamilyPortraits,
  type FamilyPortraitGender,
} from "@/lib/family-portraits";
import { pushToast } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Kind = "adult" | "child";
type JoinMode = "invite" | "device";
type Step = "who" | "info" | "join" | "guardrails" | "celebrate";

const AGE_TIERS: { id: FamilyAgeTier; labelKey: "familyAge69" | "familyAge1013" | "familyAge1417" }[] =
  [
    { id: "tier_6_9", labelKey: "familyAge69" },
    { id: "tier_10_13", labelKey: "familyAge1013" },
    { id: "tier_14_17", labelKey: "familyAge1417" },
  ];

function stepsFor(kind: Kind | null): Step[] {
  if (kind === "child") return ["who", "info", "join", "guardrails", "celebrate"];
  return ["who", "info", "join", "celebrate"];
}

function invitePayload(email: string, password: string, name: string): string {
  return [
    `Arrab Studio — family seat`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Password: ${password}`,
  ].join("\n");
}

export function AddFamilyMemberWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (member: FamilyMemberPublic, opts: { openCompanionWizard: boolean }) => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";

  const [kind, setKind] = useState<Kind | null>(null);
  const [step, setStep] = useState<Step>("who");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<FamilyPortraitGender>("boy");
  const [portraitId, setPortraitId] = useState<string>("");
  const [ageTier, setAgeTier] = useState<FamilyAgeTier>("tier_10_13");
  const [joinMode, setJoinMode] = useState<JoinMode>("device");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bedtime, setBedtime] = useState(defaultBedtimeForAgeTier("tier_10_13"));
  const [companionAccess, setCompanionAccess] = useState<CompanionAccessMode>("kid_safe");
  const [oversightMode, setOversightMode] = useState<OversightMode>("coach");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<FamilyMemberPublic | null>(null);
  const [copied, setCopied] = useState(false);

  const flow = stepsFor(kind);
  const railSteps = flow.filter((s) => s !== "celebrate");
  const stepIndex = Math.max(0, flow.indexOf(step));
  const railIndex = Math.max(0, railSteps.indexOf(step === "celebrate" ? "join" : step));
  const progress = ((Math.min(stepIndex, railSteps.length - 1) + 1) / railSteps.length) * 100;

  const portraitOptions = useMemo(() => {
    if (!kind) return [];
    return listFamilyPortraits({
      kind,
      gender,
      ageTier: kind === "child" ? ageTier : null,
    });
  }, [kind, gender, ageTier]);

  const selectedPortrait = findFamilyPortrait(portraitId) ?? portraitOptions[0] ?? null;
  const selectedPortraitUrl = familyPortraitUrl(selectedPortrait);

  useEffect(() => {
    if (!kind) return;
    if (!portraitOptions.some((p) => p.id === portraitId)) {
      setPortraitId(portraitOptions[0]?.id ?? defaultPortraitId({ kind, gender, ageTier }));
    }
  }, [kind, gender, ageTier, portraitOptions, portraitId]);

  function pickKind(next: Kind) {
    const nextGender = defaultGenderForKind(next);
    setKind(next);
    setGender(nextGender);
    setPortraitId(defaultPortraitId({ kind: next, gender: nextGender, ageTier }));
    if (next === "child") setBedtime(defaultBedtimeForAgeTier(ageTier));
  }

  const canNext = useMemo(() => {
    if (step === "who") return Boolean(kind);
    if (step === "info") {
      if (!name.trim() || !portraitId) return false;
      if (kind === "child" && !ageTier) return false;
      return true;
    }
    if (step === "join") {
      return Boolean(email.trim() && password.length >= 8 && joinMode);
    }
    if (step === "guardrails") return true;
    return false;
  }, [step, kind, name, ageTier, email, password, joinMode, portraitId]);

  function goNext() {
    if (step === "who" && kind) setStep("info");
    else if (step === "info") setStep("join");
    else if (step === "join") {
      if (kind === "child") setStep("guardrails");
      else void submit();
    } else if (step === "guardrails") void submit();
  }

  function goBack() {
    if (step === "info") {
      setStep("who");
      return;
    }
    if (step === "join") {
      setStep("info");
      return;
    }
    if (step === "guardrails") setStep("join");
  }

  async function submit() {
    if (busy || !kind) return;
    setBusy(true);
    try {
      const role: FamilyMemberRole = kind === "child" ? "child" : "partner";
      const member = await arrabApi.createFamilyMember({
        displayName: name.trim(),
        role,
        ageTier: kind === "child" ? ageTier : null,
        email: email.trim(),
        password,
        color: colorForPortraitId(portraitId || name),
      });
      if (kind === "child") {
        applyChildDayOneGuardrails({
          childMemberId: member.id,
          ageTier,
          bedtimeStart: bedtime,
          companionAccess,
          oversightMode,
          avatarKey: portraitId,
        });
      } else {
        setChildSeatPrefs({
          childMemberId: member.id,
          companionAccess: "all",
          oversightMode: "coach",
          avatarKey: portraitId,
        });
      }
      setCreated(member);
      setStep("celebrate");
      pushToast({ title: t("familyMemberAdded"), tone: "success" });
    } catch (err: unknown) {
      pushToast({
        title: err instanceof ApiRequestError ? err.message : t("apiUnavailable"),
        tone: "warn",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(invitePayload(email.trim(), password, name.trim()));
      setCopied(true);
      pushToast({ title: t("afmCopied"), tone: "success" });
    } catch {
      pushToast({ title: t("apiUnavailable"), tone: "warn" });
    }
  }

  const stepTitle =
    step === "who"
      ? t("afmWhoTitle")
      : step === "info"
        ? t("afmInfoTitle")
        : step === "join"
          ? t("afmJoinTitle")
          : step === "guardrails"
            ? t("afmGuardTitle")
            : t("afmCelebrateTitle").replace("{name}", name.trim() || "—");

  const stepBody =
    step === "who"
      ? t("afmWhoBody")
      : step === "info"
        ? t("afmInfoBody")
        : step === "join"
          ? t("afmJoinBody")
          : step === "guardrails"
            ? t("afmGuardBody")
            : t("afmCelebrateBody");

  return createPortal(
    <div className="fcw afm" dir={ar ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={t("afmTitle")}>
      <div className="fcw-atmosphere" aria-hidden>
        <span className="fcw-glow fcw-glow-a" />
        <span className="fcw-glow fcw-glow-b" />
        <span className="fcw-grid" />
      </div>
      <div className="fcw-shell">
        <header className="fcw-top">
          <button type="button" className="fcw-back" onClick={onClose}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            <span>{t("afmKicker")}</span>
          </button>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("cancel")}>
            <X size={18} />
          </button>
        </header>

        <div className="fcw-hero">
          <p className="fcw-eyebrow">ARRAB · {t("afmKicker").toUpperCase()}</p>
          <h1>{t("afmTitle")}</h1>
          {step !== "celebrate" ? (
            <div className="fcw-rail" aria-hidden>
              <ol className="fcw-steps">
                {railSteps.map((id, index) => (
                  <li
                    key={id}
                    className={cn(
                      index === railIndex && "is-active",
                      index < railIndex && "is-done",
                    )}
                  >
                    <span className="fcw-steps-dot" />
                    <span className="fcw-steps-label">
                      {id === "who"
                        ? t("afmWhoTitle")
                        : id === "info"
                          ? t("afmInfoTitle")
                          : id === "join"
                            ? t("afmJoinTitle")
                            : t("afmGuardTitle")}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="fcw-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}
        </div>

        <section className="fcw-stage" key={step}>
          <header className="fcw-stage-intro">
            <p className="fcw-stage-index">
              {t("afmStepOf")
                .replace("{current}", String(Math.min(stepIndex, railSteps.length - 1) + 1))
                .replace("{total}", String(railSteps.length))}
            </p>
            <p className="fcw-stage-kicker">{stepTitle}</p>
            <p className="fcw-stage-lead">{stepBody}</p>
          </header>

          <div className="fcw-body">
            {step === "who" ? (
              <div className="afm-choice-grid">
                <button
                  type="button"
                  className={cn("afm-choice-card", kind === "adult" && "is-on")}
                  aria-pressed={kind === "adult"}
                  onClick={() => pickKind("adult")}
                >
                  <span className="afm-choice-photo" aria-hidden>
                    <img src={FAMILY_KIND_PREVIEW.adult} alt="" />
                  </span>
                  <div className="afm-choice-copy">
                    <strong>{t("afmAdult")}</strong>
                    <small>{t("afmAdultHint")}</small>
                  </div>
                  <span className="afm-choice-meta">{t("familyRolePartner")}</span>
                  {kind === "adult" ? (
                    <span className="afm-choice-check" aria-hidden>
                      <Check size={15} strokeWidth={2.4} />
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={cn("afm-choice-card is-child", kind === "child" && "is-on")}
                  aria-pressed={kind === "child"}
                  onClick={() => pickKind("child")}
                >
                  <span className="afm-choice-photo" aria-hidden>
                    <img src={FAMILY_KIND_PREVIEW.child} alt="" />
                  </span>
                  <div className="afm-choice-copy">
                    <strong>{t("afmChild")}</strong>
                    <small>{t("afmChildHint")}</small>
                  </div>
                  <span className="afm-choice-meta">{t("familyRoleChild")}</span>
                  {kind === "child" ? (
                    <span className="afm-choice-check" aria-hidden>
                      <Check size={15} strokeWidth={2.4} />
                    </span>
                  ) : null}
                </button>
              </div>
            ) : null}

            {step === "info" ? (
              <div className="afm-info">
                <label className="fcw-field">
                  <span>{t("afmNamePh")}</span>
                  <input
                    className="sf-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("afmNamePh")}
                    autoFocus
                  />
                </label>

                {kind === "child" ? (
                  <div className="afm-ages">
                    <span className="afm-avatars-label">{t("afmAgeTitle")}</span>
                    <p className="cp-muted afm-age-hint">{t("afmAgeHint")}</p>
                    <div className="afm-age-row">
                      {AGE_TIERS.map((tier) => (
                        <button
                          key={tier.id}
                          type="button"
                          className={cn("afm-age-chip", ageTier === tier.id && "is-on")}
                          onClick={() => {
                            setAgeTier(tier.id);
                            setBedtime(defaultBedtimeForAgeTier(tier.id));
                          }}
                        >
                          {t(tier.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="afm-gender">
                  <span className="afm-avatars-label">{t("afmGenderTitle")}</span>
                  <div className="afm-age-row">
                    {(kind === "child"
                      ? (["boy", "girl"] as const)
                      : (["man", "woman"] as const)
                    ).map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={cn("afm-age-chip", gender === g && "is-on")}
                        onClick={() => setGender(g)}
                      >
                        {t(
                          g === "boy"
                            ? "afmGenderBoy"
                            : g === "girl"
                              ? "afmGenderGirl"
                              : g === "man"
                                ? "afmGenderMan"
                                : "afmGenderWoman",
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="afm-avatars">
                  <span className="afm-avatars-label">{t("afmPickAvatar")}</span>
                  <p className="cp-muted afm-age-hint">{t("afmPickAvatarHint")}</p>
                  <div className="afm-photo-grid">
                    {portraitOptions.map((item) => {
                      const src = familyPortraitUrl(item)!;
                      const on = portraitId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={cn("afm-photo-pick", on && "is-on")}
                          aria-pressed={on}
                          onClick={() => setPortraitId(item.id)}
                        >
                          <img src={src} alt="" />
                          {on ? (
                            <span className="afm-photo-check" aria-hidden>
                              <Check size={12} strokeWidth={2.6} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {selectedPortraitUrl ? (
                    <div className="afm-photo-preview">
                      <img src={selectedPortraitUrl} alt="" />
                      <span>{name.trim() || t("afmNamePh")}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === "join" ? (
              <div className="afm-join">
                <div className="afm-choice-grid">
                  <button
                    type="button"
                    className={cn("afm-choice-card is-compact", joinMode === "invite" && "is-on")}
                    aria-pressed={joinMode === "invite"}
                    onClick={() => setJoinMode("invite")}
                  >
                    <span className="afm-choice-orb is-sm" aria-hidden>
                      <QrCode size={18} strokeWidth={1.5} />
                    </span>
                    <div className="afm-choice-copy">
                      <strong>{t("afmJoinInvite")}</strong>
                      <small>{t("afmJoinInviteHint")}</small>
                    </div>
                    {joinMode === "invite" ? (
                      <span className="afm-choice-check" aria-hidden>
                        <Check size={14} strokeWidth={2.4} />
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={cn("afm-choice-card is-compact", joinMode === "device" && "is-on")}
                    aria-pressed={joinMode === "device"}
                    onClick={() => setJoinMode("device")}
                  >
                    <span className="afm-choice-orb is-sm is-soft" aria-hidden>
                      <Smartphone size={18} strokeWidth={1.5} />
                    </span>
                    <div className="afm-choice-copy">
                      <strong>{t("afmJoinDevice")}</strong>
                      <small>{t("afmJoinDeviceHint")}</small>
                    </div>
                    {joinMode === "device" ? (
                      <span className="afm-choice-check" aria-hidden>
                        <Check size={14} strokeWidth={2.4} />
                      </span>
                    ) : null}
                  </button>
                </div>
                <div className="fcw-form">
                  <label className="fcw-field">
                    <span>{t("afmEmailPh")}</span>
                    <input
                      className="sf-input"
                      type="email"
                      autoComplete="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("afmEmailPh")}
                    />
                  </label>
                  <label className="fcw-field">
                    <span>{t("afmPasswordPh")}</span>
                    <input
                      className="sf-input"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("afmPasswordPh")}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {step === "guardrails" ? (
              <div className="afm-guard">
                <label className="fcw-field">
                  <span>
                    <Moon size={14} className="inline" /> {t("afmBedtime")}
                  </span>
                  <input
                    className="sf-input"
                    type="time"
                    value={bedtime}
                    onChange={(e) => setBedtime(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={cn("afm-toggle-card", companionAccess === "kid_safe" && "is-on")}
                  onClick={() =>
                    setCompanionAccess((v) => (v === "kid_safe" ? "all" : "kid_safe"))
                  }
                >
                  <div>
                    <strong>{t("afmKidSafe")}</strong>
                    <small>{t("afmKidSafeHint")}</small>
                  </div>
                  {companionAccess === "kid_safe" ? <Check size={16} /> : null}
                </button>
                <div className="afm-oversight">
                  <span className="afm-avatars-label">{t("afmOversight")}</span>
                  <button
                    type="button"
                    className={cn("afm-toggle-card", oversightMode === "coach" && "is-on")}
                    onClick={() => setOversightMode("coach")}
                  >
                    <div>
                      <strong>{t("afmOversightCoach")}</strong>
                      <small>{t("afmOversightCoachHint")}</small>
                    </div>
                    {oversightMode === "coach" ? <Check size={16} /> : null}
                  </button>
                  <button
                    type="button"
                    className={cn("afm-toggle-card", oversightMode === "full" && "is-on")}
                    onClick={() => setOversightMode("full")}
                  >
                    <div>
                      <strong>{t("afmOversightFull")}</strong>
                      <small>{t("afmOversightFullHint")}</small>
                    </div>
                    {oversightMode === "full" ? <Check size={16} /> : null}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "celebrate" && created ? (
              <div className="afm-celebrate">
                <div
                  className="afm-celebrate-orb is-photo"
                  style={
                    selectedPortraitUrl
                      ? undefined
                      : { background: created.color || colorForPortraitId(portraitId) }
                  }
                >
                  {selectedPortraitUrl ? (
                    <img src={selectedPortraitUrl} alt="" />
                  ) : (
                    created.displayName.slice(0, 1).toUpperCase()
                  )}
                </div>
                <h2 className="afm-celebrate-title">
                  {t("afmCelebrateTitle").replace("{name}", created.displayName)}
                </h2>
                <p className="cp-muted">{t("afmCelebrateBody")}</p>
                {joinMode === "invite" ? (
                  <div className="afm-invite-card">
                    <strong>{t("afmInviteReady")}</strong>
                    <p className="cp-muted">{t("afmInviteReadyBody")}</p>
                    <code className="afm-invite-code">{email.trim()}</code>
                    <button type="button" className="cp-button" onClick={() => void copyInvite()}>
                      <Copy size={14} />
                      {copied ? t("afmCopied") : t("afmCopyInvite")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="fcw-footer">
            {step === "celebrate" ? (
              <>
                <button
                  type="button"
                  className="cp-text-button"
                  onClick={() => {
                    if (created) onCreated(created, { openCompanionWizard: false });
                    onClose();
                  }}
                >
                  {t("afmDone")}
                </button>
                {kind === "child" && created ? (
                  <button
                    type="button"
                    className="cp-button cp-primary"
                    onClick={() => {
                      onCreated(created, { openCompanionWizard: true });
                      onClose();
                    }}
                  >
                    {t("afmAddCompanion")}
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cp-button cp-primary"
                    onClick={() => {
                      if (created) onCreated(created, { openCompanionWizard: false });
                      onClose();
                    }}
                  >
                    {t("afmDone")}
                  </button>
                )}
              </>
            ) : (
              <>
                {step !== "who" ? (
                  <button type="button" className="cp-text-button" onClick={goBack} disabled={busy}>
                    <ArrowLeft size={15} />
                    {t("back")}
                  </button>
                ) : (
                  <button type="button" className="cp-text-button" onClick={onClose}>
                    {t("cancel")}
                  </button>
                )}
                <button
                  type="button"
                  className={cn("cp-button fcw-cta", canNext && !busy && "cp-primary")}
                  disabled={!canNext || busy}
                  onClick={goNext}
                >
                  {busy ? t("afmCreating") : t("afmContinue")}
                  <ArrowRight size={14} />
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
