import { Square } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/** Next message waiting while a reply streams — edit it, send now, or discard. */
export function QueuedQueryBar({
  value,
  onChange,
  onSendNow,
  onDiscard,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onSendNow: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";

  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5",
        className,
      )}
      role="region"
      aria-label={t("chatQueuedLabel")}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-200/80">
          {t("chatQueuedLabel")}
        </p>
        <button
          type="button"
          onClick={onDiscard}
          className="text-[11px] text-neutral-500 transition hover:text-neutral-300"
        >
          {t("chatDiscardQueue")}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-neutral-600 focus:border-white/20"
        placeholder={ar ? "عدّل الاستعلام…" : "Edit your query…"}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!value.trim()}
          onClick={onSendNow}
          className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[12px] font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40"
        >
          {t("chatSendNow")}
        </button>
      </div>
    </div>
  );
}

export function PauseSendButton({
  onPause,
  className,
  label,
}: {
  onPause: () => void;
  className?: string;
  label?: string;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onPause}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-neutral-200",
        className,
      )}
      aria-label={label ?? t("chatPause")}
      title={label ?? t("chatPause")}
    >
      <Square className="size-3" fill="currentColor" strokeWidth={0} />
    </button>
  );
}
