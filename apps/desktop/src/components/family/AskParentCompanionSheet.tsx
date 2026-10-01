import { useState } from "react";
import { ShieldPlus } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { pushToast } from "@/lib/notify";
import { requestCompanionApproval } from "@/lib/guardian-store";
import type { CompanionSpace } from "@/lib/companions";

/** Kid asks a parent to approve a new companion — no silent create. */
export function AskParentCompanionSheet({
  childMemberId,
  childName,
  space,
  onClose,
}: {
  childMemberId: string;
  childName: string;
  space: CompanionSpace;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [focus, setFocus] = useState("");
  const [details, setDetails] = useState("");

  function submit() {
    if (!focus.trim()) return;
    requestCompanionApproval({
      childMemberId,
      childName,
      name: name.trim() || focus.trim(),
      domain: focus.trim(),
      purposeId: focus.trim().toLowerCase().replace(/\s+/g, "-"),
      brief: details.trim(),
      space,
    });
    pushToast({
      title: t("guardianAskSent"),
      body: t("guardianAskSentBody"),
      tone: "success",
    });
    onClose();
  }

  return (
    <div className="gh-ask-sheet" role="dialog" aria-labelledby="gh-ask-title">
      <div className="gh-ask-card">
        <header className="gh-ask-head">
          <ShieldPlus className="size-5" strokeWidth={1.7} />
          <div>
            <h2 id="gh-ask-title">{t("guardianAskTitle")}</h2>
            <p>{t("guardianAskBody")}</p>
          </div>
        </header>
        <label className="gh-label">
          {t("guardianAskName")}
          <input
            className="gh-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("guardianAskNamePh")}
          />
        </label>
        <label className="gh-label">
          {t("guardianAskFocus")}
          <input
            className="gh-input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder={t("guardianAskFocusPh")}
            autoFocus
          />
        </label>
        <label className="gh-label">
          {t("guardianAskDetails")}
          <textarea
            className="gh-input"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t("guardianAskDetailsPh")}
          />
        </label>
        <div className="gh-ask-actions">
          <button type="button" className="gh-btn is-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="gh-btn"
            disabled={focus.trim().length < 2}
            onClick={submit}
          >
            {t("guardianAskSend")}
          </button>
        </div>
      </div>
    </div>
  );
}
