import type { FormEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8",
        className,
      )}
    >
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-neutral-500">{description}</p>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[1.65rem] font-medium tracking-tight text-white">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ApiErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-white/15 bg-black px-5 py-6">
      <p className="text-sm font-medium text-white">Arrab API unavailable</p>
      <p className="mt-1.5 text-sm text-neutral-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-8 rounded-md border border-white/20 px-3 text-xs text-white hover:bg-white/5"
      >
        Retry
      </button>
    </div>
  );
}

export function CreateForm({
  onSubmit,
  submitting,
  error,
  children,
  submitLabel,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  error: string | null;
  children: ReactNode;
  submitLabel: string;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="h-9 rounded-md bg-white px-3.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-40"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
        {error ? <p className="text-sm text-neutral-400">{error}</p> : null}
      </div>
    </form>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

export const fieldControlClassName =
  "h-9 w-full rounded-md border border-white/15 bg-black px-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/35";

export function EntityList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-white/8 border-y border-white/8">{children}</ul>;
}

export function EntityRow({
  title,
  meta,
  action,
}: {
  title: string;
  meta: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs text-neutral-500">{meta}</p>
      </div>
      {action}
    </li>
  );
}
