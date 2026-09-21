import { useEffect, useRef, useState } from "react";
import {
  Bug,
  Check,
  ChevronDown,
  Infinity as InfinityIcon,
  Layers2,
  ListTree,
  MessageCircle,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  readSessionMode,
  SESSION_MODE_META,
  SESSION_MODES,
  subscribeSessionMode,
  writeSessionMode,
  type SessionMode,
} from "@/lib/session-mode";
import { cn } from "@/lib/utils";

const MODE_ICON: Record<SessionMode, typeof InfinityIcon> = {
  agent: InfinityIcon,
  plan: ListTree,
  debug: Bug,
  multitask: Layers2,
  ask: MessageCircle,
};

export function SessionModeMenu({
  disabled,
  className,
}: {
  disabled?: boolean;
  className?: string;
}) {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SessionMode>(() => readSessionMode());

  useEffect(() => subscribeSessionMode(setMode), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const meta = SESSION_MODE_META[mode];
  const ActiveIcon = MODE_ICON[mode];

  return (
    <div className={cn("session-mode", className)} ref={ref}>
      <button
        type="button"
        className={cn("session-mode-btn", open && "is-on")}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ar ? "وضع الجلسة" : "Session mode"}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon size={15} strokeWidth={1.8} />
        <span>{ar ? meta.labelAr : meta.labelEn}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open ? (
        <div className="session-mode-menu" role="menu">
          {SESSION_MODES.map((id) => {
            const item = SESSION_MODE_META[id];
            const Icon = MODE_ICON[id];
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={cn(active && "is-active")}
                onClick={() => {
                  writeSessionMode(id);
                  setMode(id);
                  setOpen(false);
                }}
              >
                <Icon size={15} strokeWidth={1.7} />
                <span>
                  <strong>{ar ? item.labelAr : item.labelEn}</strong>
                  <em>{ar ? item.hintAr : item.hintEn}</em>
                </span>
                {active ? <Check size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SessionModeApproveBar({
  suggested,
  pendingSend = false,
  onApprove,
  onDismiss,
}: {
  suggested: SessionMode;
  /** True when switching before the current draft is sent. */
  pendingSend?: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const meta = SESSION_MODE_META[suggested];
  const Icon = MODE_ICON[suggested];
  const label = ar ? meta.labelAr : meta.labelEn;

  return (
    <div className="session-mode-approve" role="status">
      <Icon size={16} strokeWidth={1.7} />
      <p>
        {pendingSend
          ? ar
            ? `يبدو أن وضع «${label}» أنسب لهذه الرسالة. هل توافق على التحويل؟`
            : `This looks like a job for ${label} mode. Switch before sending?`
          : ar
            ? `الرد يقترح التحويل إلى وضع «${label}». هل توافق؟`
            : `The reply suggests switching to ${label} mode. Approve?`}
      </p>
      <div className="session-mode-approve-actions">
        <button type="button" className="session-mode-approve-go" onClick={onApprove}>
          {ar ? `نعم · ${label}` : `Switch to ${label}`}
        </button>
        <button type="button" className="session-mode-approve-stay" onClick={onDismiss}>
          {ar ? (pendingSend ? "إرسال بدون تغيير" : "لا") : pendingSend ? "Send as-is" : "Not now"}
        </button>
      </div>
    </div>
  );
}
