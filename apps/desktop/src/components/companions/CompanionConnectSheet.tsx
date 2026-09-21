import { Cable, Mail, X } from "lucide-react";
import {
  connectProvidersFor,
  type ConnectFamily,
  type ConnectProviderOption,
} from "@/lib/companion-suggestions";
import { connectorIcon } from "@/lib/connector-catalog";

export function CompanionConnectSheet({
  family,
  arabic,
  busy,
  error,
  onPick,
  onClose,
}: {
  family: ConnectFamily;
  arabic: boolean;
  busy?: boolean;
  error?: string | null;
  onPick: (option: ConnectProviderOption) => void;
  onClose: () => void;
}) {
  const options = connectProvidersFor(family);
  const title =
    family === "email"
      ? arabic
        ? "أي بريد نربط؟"
        : "Which email should we connect?"
      : arabic
        ? "أي مصدر برمجة نربط؟"
        : "Which coding source should we connect?";
  const body =
    family === "email"
      ? arabic
        ? "اختر Gmail أو Outlook لفتح المتصفح، أو IMAP لإعداد بريد آخر."
        : "Pick Gmail or Outlook to open the browser, or IMAP for another mailbox."
      : arabic
        ? "اختر GitHub أو GitLab أو SSH لإكمال الربط من الموصلات."
        : "Pick GitHub, GitLab, or SSH to finish linking in Connectors.";

  return (
    <div className="cp-connect-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cp-connect-sheet-card">
        <header>
          <div>
            <p className="cp-eyebrow">{arabic ? "موصلات" : "CONNECTORS"}</p>
            <h3>{title}</h3>
            <p className="cp-muted">{body}</p>
          </div>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={arabic ? "إغلاق" : "Close"}>
            <X size={18} />
          </button>
        </header>
        {error ? (
          <p className="cp-notice" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cp-connect-options">
          {options.map((option) => {
            const Icon = connectorIcon(option.id) ?? (family === "email" ? Mail : Cable);
            return (
              <button
                key={option.id}
                type="button"
                className="cp-connect-option"
                disabled={busy}
                onClick={() => onPick(option)}
              >
                <span className="cp-connect-option-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{arabic ? option.labelAr : option.labelEn}</strong>
                  <small>
                    {option.oauth
                      ? arabic
                        ? "يفتح المتصفح للتوثيق"
                        : "Opens browser to authorize"
                      : arabic
                        ? "يكمل من صفحة الموصلات"
                        : "Continues in Connectors"}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
