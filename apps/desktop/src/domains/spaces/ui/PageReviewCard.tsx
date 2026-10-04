import { useEffect, useState } from "react";
import { Check, FilePlus2, Loader2, X } from "lucide-react";
import type { DocumentSpace } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { pushToast } from "@/domains/notifications/notify";
import { localSpaces } from "@/domains/spaces/local-spaces";
import { parseSpaceDraft, type SpaceDraft } from "../space-draft";

export function PageReviewCard({
  text,
  companionId,
  onSaved,
}: {
  text: string;
  companionId?: string | null;
  onSaved?: (pageId: string, spaceId: string) => void;
}) {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const draft = parseSpaceDraft(text);
  const [manual, setManual] = useState<SpaceDraft | null>(null);
  const [spaces, setSpaces] = useState<DocumentSpace[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [declined, setDeclined] = useState(false);

  const active = manual ?? draft;

  useEffect(() => {
    if (!active || done || declined) return;
    void localSpaces
      .get()
      .then((view) => {
        setSpaces(view.spaces);
        setSpaceId((current) => current || view.spaces[0]?.id || "");
      })
      .catch(() => undefined);
  }, [active, done, declined]);

  if (declined || done) {
    return (
      <div className="sp-review is-done">
        <Check size={14} />
        <span>
          {done
            ? ar
              ? "حُفظت الصفحة في المساحة."
              : "Page saved to Space."
            : ar
              ? "رُفض المسودة."
              : "Draft declined."}
        </span>
      </div>
    );
  }

  if (!active) {
    return (
      <button
        type="button"
        className="cp-text-button sp-review-trigger"
        onClick={() =>
          setManual({
            title: text.trim().split("\n")[0]?.replace(/^#\s*/, "").slice(0, 80) || (ar ? "من المحادثة" : "From chat"),
            markdown: text.trim(),
          })
        }
      >
        <FilePlus2 size={13} />
        {ar ? "حفظ كصفحة" : "Save as page"}
      </button>
    );
  }

  return (
    <div className="sp-review" role="group" aria-label={ar ? "مراجعة الصفحة" : "Page review"}>
      <header>
        <FilePlus2 size={15} />
        <div>
          <strong>{ar ? "مراجعة قبل الحفظ" : "Review before saving"}</strong>
          <p>{ar ? "وافق لحفظ هذه المسودة كمساحة صفحة." : "Approve to save this draft as a Space page."}</p>
        </div>
      </header>
      <div className="sp-review-body">
        <label>
          {ar ? "العنوان" : "Title"}
          <input
            className="cp-input"
            value={active.title}
            onChange={(event) => setManual({ ...active, title: event.target.value })}
          />
        </label>
        <label>
          {ar ? "المساحة" : "Space"}
          <select
            className="cp-input"
            value={spaceId}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            <option value="">{ar ? "إنشاء مساحة البريد الوارد" : "Create Inbox Space"}</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <pre>{active.markdown.slice(0, 800)}</pre>
      </div>
      <div className="sp-review-actions">
        <button
          type="button"
          className="cp-button cp-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void localSpaces
              .approveDraft({
                spaceId,
                title: active.title,
                markdown: active.markdown,
                companionId: companionId ?? null,
              })
              .then((result) => {
                setDone(true);
                onSaved?.(result.page.id, result.page.spaceId);
                pushToast({
                  title: ar ? "حُفظت الصفحة" : "Page saved",
                  body: result.page.title,
                  tone: "success",
                });
              })
              .catch(() =>
                pushToast({
                  title: ar ? "تعذّر الحفظ" : "Could not save page",
                  tone: "warn",
                }),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {ar ? "موافقة وحفظ" : "Approve & save"}
        </button>
        <button type="button" className="cp-button" disabled={busy} onClick={() => setDeclined(true)}>
          <X size={14} />
          {ar ? "رفض" : "Decline"}
        </button>
      </div>
    </div>
  );
}
