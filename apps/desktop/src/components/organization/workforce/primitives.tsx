import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { AgentStatus, TaskPriority } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { initialsOf, priorityLabel } from "./use-workforce-data";

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn("cc-avatar", size === "sm" && "is-sm", size === "lg" && "is-lg", className)}
      title={name}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn("cc-dot", status === "active" && "is-active", status === "paused" && "is-paused")}
      aria-hidden
    />
  );
}

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        "cc-chip",
        priority === "urgent" && "is-urgent",
        priority === "high" && "is-high",
        priority === "medium" && "is-medium",
      )}
    >
      {priorityLabel(priority, t)}
    </span>
  );
}

export function Stat({
  label,
  value,
  foot,
  alert,
  onClick,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  alert?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="cc-kicker">{label}</p>
      <p className="cc-stat-value">{value}</p>
      {foot ? <p className="cc-stat-foot">{foot}</p> : null}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn("cc-stat", alert && "is-alert")}>
      {body}
    </button>
  ) : (
    <div className={cn("cc-stat", alert && "is-alert")}>{body}</div>
  );
}

export function Card({
  title,
  sub,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("cc-card cc-rise", className)}>
      {title || action ? (
        <header className="cc-card-head">
          <div className="min-w-0">
            {title ? <h2 className="cc-card-title">{title}</h2> : null}
            {sub ? <p className="cc-card-sub">{sub}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cc-empty">
      <span className="cc-empty-icon">
        <Icon className="size-[18px]" strokeWidth={1.6} />
      </span>
      <p className="cc-empty-title">{title}</p>
      {body ? <p className="cc-empty-body">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="cc-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={cn(value === option.id && "is-active")}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cc-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Sheet({
  open,
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, dir } = useLanguage();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  if (!open) return null;
  return createPortal(
    <div dir={dir}>
      <div className="cc-backdrop" onClick={onClose} aria-hidden />
      <aside className="cc-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="cc-sheet-head">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.02em]">{title}</h2>
            {sub ? <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{sub}</p> : null}
          </div>
          <button type="button" className="cc-icon-btn" onClick={onClose} aria-label={t("close")}>
            <X className="size-4" strokeWidth={1.7} />
          </button>
        </header>
        <div className="cc-sheet-body">{children}</div>
        {footer ? <footer className="cc-sheet-foot">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}

export type MenuEntry =
  | { kind: "item"; label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: "label"; label: string }
  | { kind: "sep" };

/** Click-to-open popover menu anchored to its trigger; flips to stay on screen. */
export function Menu({
  trigger,
  entries,
  label,
}: {
  trigger: ReactNode;
  entries: MenuEntry[];
  label: string;
}) {
  const { dir } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const width = menu?.offsetWidth ?? 220;
    const height = menu?.offsetHeight ?? 260;
    const pad = 10;
    let left = dir === "rtl" ? rect.left : rect.right - width;
    left = Math.min(Math.max(pad, left), window.innerWidth - width - pad);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - pad) top = Math.max(pad, rect.top - height - 6);
    setPos({ top, left });
  }, [dir, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cc-icon-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setPos(null);
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              dir={dir}
              role="menu"
              className="cc-menu"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
            >
              {entries.map((entry, index) => {
                if (entry.kind === "sep") return <div key={`sep-${index}`} className="cc-menu-sep" />;
                if (entry.kind === "label")
                  return (
                    <p key={`label-${index}`} className="cc-menu-label">
                      {entry.label}
                    </p>
                  );
                const Icon = entry.icon;
                return (
                  <button
                    key={`${entry.label}-${index}`}
                    type="button"
                    role="menuitem"
                    disabled={entry.disabled}
                    className={cn("cc-menu-item", entry.danger && "is-danger")}
                    onClick={() => {
                      setOpen(false);
                      entry.onSelect();
                    }}
                  >
                    {Icon ? <Icon strokeWidth={1.7} /> : null}
                    <span className="truncate">{entry.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
