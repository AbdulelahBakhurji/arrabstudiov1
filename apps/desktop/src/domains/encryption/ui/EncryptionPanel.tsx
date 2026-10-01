import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import {
  changeE2eePassphrase,
  e2eeState,
  lockE2ee,
  resetE2ee,
  setupE2ee,
  subscribeE2ee,
  unlockE2ee,
  type E2eeState,
} from "@/domains/encryption/e2ee";
import { syncEncryptedChats } from "@/domains/chat/chat-history";
import { pushToast } from "@/domains/notifications/notify";
import { cn } from "@/shared/lib/utils";

/** Current encryption state for this device, kept live across lock/unlock. */
export function useE2eeState(): { state: E2eeState; refresh: () => void } {
  const [state, setState] = useState<E2eeState>("unknown");
  const refresh = useCallback(() => {
    void e2eeState().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    return subscribeE2ee(refresh);
  }, [refresh]);
  return { state, refresh };
}

type Mode = "idle" | "change" | "reset";

/** Settings card: turn on, unlock, lock, change passphrase, or reset chat encryption. */
export function EncryptionPanel() {
  const { t } = useLanguage();
  const { state, refresh } = useE2eeState();
  const [mode, setMode] = useState<Mode>("idle");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = () => {
    setPassphrase("");
    setConfirm("");
    setCurrent("");
    setError(null);
    setMode("idle");
  };

  async function run(task: () => Promise<void>, done?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await task();
      clear();
      refresh();
      done?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === "Wrong passphrase" ? t("e2eeWrong") : t("e2eeFailed"));
    } finally {
      setBusy(false);
    }
  }

  function validateNew(): boolean {
    if (passphrase.length < 10) {
      setError(t("e2eeTooShort"));
      return false;
    }
    if (state === "needs-setup" || mode === "change") {
      if (passphrase !== confirm) {
        setError(t("e2eeMismatch"));
        return false;
      }
    }
    return true;
  }

  const badge =
    state === "unlocked"
      ? t("e2eeStatusOn")
      : state === "locked"
        ? t("e2eeStatusLocked")
        : state === "needs-setup"
          ? t("e2eeStatusOff")
          : t("e2eeStatusUnknown");

  const field = (label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <label className="st-field">
      <span>{label}</span>
      <input
        type="password"
        className="st-input"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => set(event.target.value)}
        disabled={busy}
      />
    </label>
  );

  return (
    <article className="st-card">
      <header className="st-card-head">
        <div>
          <h3>{t("e2eeTitle")}</h3>
          <p>{t("e2eeBody")}</p>
        </div>
        <span className={cn("st-badge", state === "unlocked" && "is-ok")}>{badge}</span>
      </header>
      <div className="st-rows">
        {state === "needs-setup" ? (
          <div className="st-rows" style={{ gap: 10, paddingBlock: 4 }}>
            {field(t("e2eePassphrase"), passphrase, setPassphrase, "new-password")}
            {field(t("e2eePassphraseConfirm"), confirm, setConfirm, "new-password")}
            <p className="st-row-desc">{t("e2eePassphraseHint")}</p>
            <div className="st-actions">
              <button
                type="button"
                className="st-btn is-primary"
                disabled={busy}
                onClick={() => {
                  if (!validateNew()) return;
                  void run(
                    () => setupE2ee(passphrase),
                    () => pushToast({ title: t("e2eeEnabledToast"), tone: "success" }),
                  );
                }}
              >
                {t("e2eeEnable")}
              </button>
            </div>
          </div>
        ) : null}

        {state === "locked" ? (
          <div className="st-rows" style={{ gap: 10, paddingBlock: 4 }}>
            {field(t("e2eePassphrase"), passphrase, setPassphrase, "current-password")}
            <div className="st-actions">
              <button
                type="button"
                className="st-btn is-primary"
                disabled={busy || passphrase.length === 0}
                onClick={() =>
                  void run(
                    async () => {
                      await unlockE2ee(passphrase);
                      await syncEncryptedChats();
                    },
                    () => pushToast({ title: t("e2eeUnlockedToast"), tone: "success" }),
                  )
                }
              >
                {t("e2eeUnlock")}
              </button>
            </div>
          </div>
        ) : null}

        {state === "unlocked" && mode === "change" ? (
          <div className="st-rows" style={{ gap: 10, paddingBlock: 4 }}>
            {field(t("e2eeCurrentPassphrase"), current, setCurrent, "current-password")}
            {field(t("e2eeNewPassphrase"), passphrase, setPassphrase, "new-password")}
            {field(t("e2eePassphraseConfirm"), confirm, setConfirm, "new-password")}
            <div className="st-actions">
              <button type="button" className="st-btn" disabled={busy} onClick={clear}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="st-btn is-primary"
                disabled={busy || current.length === 0}
                onClick={() => {
                  if (!validateNew()) return;
                  void run(
                    () => changeE2eePassphrase(current, passphrase),
                    () => pushToast({ title: t("e2eeChangedToast"), tone: "success" }),
                  );
                }}
              >
                {t("e2eeChange")}
              </button>
            </div>
          </div>
        ) : null}

        {state === "unlocked" && mode === "idle" ? (
          <div className="st-actions">
            <button type="button" className="st-btn" onClick={() => setMode("change")}>
              {t("e2eeChange")}
            </button>
            <button type="button" className="st-btn" onClick={() => void lockE2ee()}>
              {t("e2eeLock")}
            </button>
          </div>
        ) : null}

        {(state === "locked" || state === "unlocked") && mode !== "reset" ? (
          <div className="st-row">
            <div className="st-row-copy">
              <span className="st-row-title">{t("e2eeReset")}</span>
              <span className="st-row-desc">{t("e2eeResetBody")}</span>
            </div>
            <div className="st-row-control">
              <button type="button" className="st-btn is-danger" onClick={() => setMode("reset")}>
                {t("e2eeReset")}
              </button>
            </div>
          </div>
        ) : null}
        {mode === "reset" ? (
          <div className="st-actions">
            <span className="st-row-desc">{t("e2eeResetConfirm")}</span>
            <button type="button" className="st-btn" disabled={busy} onClick={clear}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="st-btn is-danger"
              disabled={busy}
              onClick={() => void run(() => resetE2ee())}
            >
              {t("e2eeReset")}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="st-row-desc" role="alert">
            {error}
          </p>
        ) : null}
        <p className="st-row-desc">{t("e2eeServerNote")}</p>
      </div>
    </article>
  );
}
