import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";

export function WhatsAppConnectSheet({
  companionId,
  companionName,
  onClose,
  onConnected,
}: {
  companionId?: string;
  companionName?: string;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const { t } = useLanguage();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("starting");
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const connectedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const view = await arrabApi.openWaLinkStatus();
      setStatus(view.status);
      setPhone(view.phone);
      if (view.qrCode) setQrCode(view.qrCode);
      if (view.connected) {
        connectedRef.current = true;
        onConnected?.();
        return true;
      }
      return false;
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : t("whatsappConnectError");
      setError(message);
      return false;
    }
  }, [onConnected, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const start = await arrabApi.openWaLinkStart({
          companionId,
          companionName,
        });
        if (cancelled) return;
        setQrCode(start.qrCode);
        setStatus(start.status);
        setPhone(start.phone);
        if (start.phone) {
          connectedRef.current = true;
          onConnected?.();
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiRequestError ? err.message : t("whatsappConnectError"),
        );
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companionId, companionName, onConnected, t]);

  useEffect(() => {
    if (connectedRef.current || error) return;
    const id = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => window.clearInterval(id);
  }, [error, poll]);

  const linked = Boolean(phone) || status === "connected" || status === "authenticated";

  return (
    <div className="cp-connect-sheet" role="dialog" aria-modal="true" aria-label={t("whatsappConnectTitle")}>
      <div className="cp-connect-sheet-card">
        <header>
          <div>
            <p className="cp-eyebrow">{t("whatsappConnectEyebrow")}</p>
            <h3>{t("whatsappConnectTitle")}</h3>
            <p className="cp-muted">{t("whatsappConnectBody")}</p>
          </div>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("close")}>
            <X size={18} />
          </button>
        </header>
        {error ? (
          <p className="cp-notice" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cp-wa-link-body">
          {linked ? (
            <p className="cp-notice is-ok">
              <MessageCircle size={18} aria-hidden />
              {t("whatsappConnectConnected")}
              {phone ? ` · ${phone}` : ""}
            </p>
          ) : busy && !qrCode ? (
            <p className="cp-muted cp-wa-link-wait">
              <Loader2 size={20} className="fls-spin" aria-hidden />
              {t("whatsappConnectWorking")}
            </p>
          ) : qrCode ? (
            <>
              <p className="cp-muted">{t("whatsappConnectScan")}</p>
              <img className="cp-wa-qr" src={qrCode} alt="" width={280} height={280} />
            </>
          ) : (
            <p className="cp-muted">{t("whatsappConnectWaitQr")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
