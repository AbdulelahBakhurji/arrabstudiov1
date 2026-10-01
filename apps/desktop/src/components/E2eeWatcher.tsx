import { useEffect, useState } from "react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { syncEncryptedChats } from "@/lib/chat-history";
import { unlockE2ee } from "@/lib/e2ee";
import { pushToast } from "@/lib/notify";
import { useE2eeState } from "@/components/EncryptionPanel";

const SYNC_MS = 45_000;

/**
 * Keeps encrypted chats in sync while unlocked, and asks for the passphrase on a
 * device where encryption is set up but not yet unlocked (e.g. a new device).
 */
export function E2eeWatcher({ signedIn }: { signedIn: boolean }) {
  const { t } = useLanguage();
  const { state, refresh } = useE2eeState();
  const [dismissed, setDismissed] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn || state !== "unlocked") return;
    const tick = () => void syncEncryptedChats().catch(() => undefined);
    tick();
    const id = window.setInterval(tick, SYNC_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [signedIn, state]);

  if (!signedIn || state !== "locked" || dismissed) return null;

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await unlockE2ee(passphrase);
      await syncEncryptedChats().catch(() => undefined);
      setPassphrase("");
      refresh();
      pushToast({ title: t("e2eeUnlockedToast"), tone: "success" });
    } catch (err) {
      setError(err instanceof Error && err.message === "Wrong passphrase" ? t("e2eeWrong") : t("e2eeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-connect-sheet" role="dialog" aria-modal="true" aria-label={t("e2eeUnlockPromptTitle")}>
      <form
        className="cp-connect-sheet-card"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <header>
          <div>
            <h3>{t("e2eeUnlockPromptTitle")}</h3>
            <p className="cp-muted">{t("e2eeUnlockPromptBody")}</p>
          </div>
        </header>
        <input
          type="password"
          className="st-input"
          autoFocus
          autoComplete="current-password"
          placeholder={t("e2eePassphrase")}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          disabled={busy}
        />
        {error ? (
          <p className="cp-notice" role="alert">
            {error}
          </p>
        ) : null}
        <div className="st-actions">
          <button type="button" className="st-btn" onClick={() => setDismissed(true)} disabled={busy}>
            {t("e2eeLater")}
          </button>
          <button type="submit" className="st-btn is-primary" disabled={busy || passphrase.length === 0}>
            {t("e2eeUnlock")}
          </button>
        </div>
      </form>
    </div>
  );
}
