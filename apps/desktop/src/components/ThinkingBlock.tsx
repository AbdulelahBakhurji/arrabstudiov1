import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export type ThoughtTrace = {
  text: string;
  startedAt: number;
  endedAt: number | null;
};

/** Per-reply reasoning traces, keyed by the assistant message id. Session only. */
export function useThoughtTraces() {
  const [traces, setTraces] = useState<Record<string, ThoughtTrace>>({});

  const append = useCallback((key: string, text: string) => {
    if (!text) return;
    setTraces((current) => {
      const prev = current[key];
      return {
        ...current,
        [key]: {
          text: (prev?.text ?? "") + text,
          startedAt: prev?.startedAt ?? Date.now(),
          endedAt: null,
        },
      };
    });
  }, []);

  const finish = useCallback((key: string) => {
    setTraces((current) => {
      const prev = current[key];
      if (!prev || prev.endedAt) return current;
      return { ...current, [key]: { ...prev, endedAt: Date.now() } };
    });
  }, []);

  const rekey = useCallback((from: string, to: string) => {
    if (from === to) return;
    setTraces((current) => {
      const prev = current[from];
      if (!prev) return current;
      const next = { ...current, [to]: { ...prev, endedAt: prev.endedAt ?? Date.now() } };
      delete next[from];
      return next;
    });
  }, []);

  const drop = useCallback((key: string) => {
    setTraces((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  return { traces, append, finish, rekey, drop };
}

function useElapsed(startedAt: number, endedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  return Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 1000));
}

export function ThinkingBlock({ trace, className }: { trace: ThoughtTrace; className?: string }) {
  const { t } = useLanguage();
  const live = trace.endedAt === null;
  const [open, setOpen] = useState(live);
  const bodyRef = useRef<HTMLDivElement>(null);
  const seconds = useElapsed(trace.startedAt, trace.endedAt);

  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  useEffect(() => {
    if (!live || !open) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [trace.text, live, open]);

  const label = live
    ? t("thinkingLive")
    : seconds < 1
      ? t("thoughtBriefly")
      : t("thoughtForSeconds").replace("{s}", String(seconds));

  return (
    <div className={cn("thk", live && "is-live", open && "is-open", className)}>
      <button
        type="button"
        className="thk-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Sparkles className="thk-icon" size={13} strokeWidth={1.8} />
        <span className="thk-label">{label}</span>
        {live && seconds > 0 ? <span className="thk-timer">{seconds}s</span> : null}
        <ChevronDown className="thk-chevron" size={13} strokeWidth={1.8} />
      </button>
      {open ? (
        <div ref={bodyRef} className="thk-body" dir="auto">
          {trace.text.trim()}
          {live ? <span className="thk-caret" aria-hidden /> : null}
        </div>
      ) : null}
    </div>
  );
}
