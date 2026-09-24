import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  addCompanion,
  type CompanionProfile,
  type CompanionSpace,
  type CompanionToneName,
} from "@/lib/companions";
import { CompanionModal } from "./CompanionUI";

export function AddCompanionDialog({
  open,
  onClose,
  onCreated,
  space,
  domain = "",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (person: CompanionProfile) => void;
  space: CompanionSpace;
  domain?: string;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  return (
    <CompanionModal open={open} onClose={onClose} title={t("compAddCompanion")}>
      <AddForm
        key={String(open) + domain}
        initialDomain={domain}
        space={space}
        onClose={onClose}
        onCreated={onCreated}
        ar={ar}
      />
    </CompanionModal>
  );
}
function AddForm({
  initialDomain,
  space,
  onClose,
  onCreated,
  ar,
}: {
  initialDomain: string;
  space: CompanionSpace;
  onClose: () => void;
  onCreated: (person: CompanionProfile) => void;
  ar: boolean;
}) {
  const { t } = useLanguage();
  const [domain, setDomain] = useState(initialDomain);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<CompanionToneName>("measured");
  return (
    <form
      className="cp-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!domain.trim() || !brief.trim()) return;
        const person = addCompanion({
          name: name.trim() || domain.trim(),
          domain: domain.trim(),
          purposeId: domain.trim().toLowerCase(),
          brief: brief.trim(),
          space,
          toneName: tone,
        });
        onCreated(person);
        onClose();
      }}
    >
      <p className="cp-muted">
        {ar
          ? "حدّد ما يتابعه، وما المطلوب منه، ثم اختر الأسلوب الأقرب لك."
          : "Define what they watch, what they are responsible for, then choose a voice that fits."}
      </p>
      <label className="cp-label">
        {t("compWatches")}
        <input
          autoFocus
          required
          className="cp-input"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder={ar ? "مثل: العمل، الدراسة، النوم" : "e.g. work, study, sleep"}
        />
      </label>
      <label className="cp-label">
        {t("compNameOptional")}
        <input
          className="cp-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="cp-label">
        {t("compBrief")}
        <textarea
          required
          className="cp-input"
          rows={3}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder={t("compBriefPlaceholder")}
        />
        <span className="cp-field-hint">{t("compBriefHint")}</span>
      </label>
      <div className="cp-tone-options">
        {(["direct", "measured"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={tone === option}
            onClick={() => setTone(option)}
          >
            <strong>{t(option === "direct" ? "compBornDirect" : "compBornMeasured")}</strong>
            <p>{t(option === "direct" ? "compBornDirectExample" : "compBornMeasuredExample")}</p>
            {tone === option ? <Check size={15} /> : null}
          </button>
        ))}
      </div>
      <div className="cp-actions cp-end">
        <button className="cp-button" type="button" onClick={onClose}>
          {t("cancel")}
        </button>
        <button className="cp-button cp-primary" disabled={!domain.trim() || !brief.trim()}>
          {t("compAddCompanion")}
          <Plus size={15} />
        </button>
      </div>
    </form>
  );
}
