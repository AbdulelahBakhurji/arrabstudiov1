import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { PhotoAvatar, type FaceState } from "./CompanionFace";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { CompanionProfile, CompanionSpace } from "@/lib/companions";
import { resolveCompanionPortraitSrc } from "@/lib/companion-portrait";

export function useCompanionSpace() {
  const [space, setSpaceState] = useState<CompanionSpace>(() =>
    sessionStorage.getItem("arrab.companionSpace") === "work" ? "work" : "personal",
  );
  const setSpace = (next: CompanionSpace) => {
    sessionStorage.setItem("arrab.companionSpace", next);
    setSpaceState(next);
  };
  return [space, setSpace] as const;
}

export function SpaceSwitch({
  value,
  onChange,
  disabled,
}: {
  value: CompanionSpace;
  onChange: (space: CompanionSpace) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLanguage();
  return (
    <div className="cp-segment" role="group" aria-label={locale === "ar" ? "المساحة" : "Space"}>
      {(["personal", "work"] as const).map((space) => (
        <button
          key={space}
          type="button"
          aria-pressed={value === space}
          disabled={disabled}
          onClick={() => onChange(space)}
        >
          {t(space === "personal" ? "compSpacePersonal" : "compSpaceWork")}
        </button>
      ))}
    </div>
  );
}

export function PersonAvatar({
  person,
  active = false,
  size = "md",
  state,
}: {
  person: CompanionProfile;
  active?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  /** Overrides the active-derived state — e.g. "speaking" while a reply streams in. */
  state?: FaceState;
}) {
  const faceState: FaceState = state ?? (active ? "lit" : "quiet");
  if (person.domain === "general") {
    return (
      <span
        className={`cp-general cp-general-${size}`}
        data-active={active}
        data-state={faceState === "quiet" || faceState === "lit" ? undefined : faceState}
      >
        <Sparkles aria-hidden="true" size={size === "sm" ? 16 : 22} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <PhotoAvatar
      src={resolveCompanionPortraitSrc(person)}
      name={person.name}
      size={size}
      state={faceState}
      fallbackHue={person.hue}
      fallbackSeed={person.faceSeed}
    />
  );
}

export function CompanionModal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t, dir } = useLanguage();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      dialog
        .querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input:not([disabled]), textarea:not([disabled])",
        )
        ?.focus();
    }
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`cp-ui cp-dialog ${wide ? "cp-dialog-wide" : ""}`}
      dir={dir}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="cp-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="cp-icon" onClick={onClose} aria-label={t("close")}>
          <X size={18} />
        </button>
      </header>
      {open ? <div className="cp-dialog-body">{children}</div> : null}
    </dialog>
  );
}

export function CompanionEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cp-empty">
      <span className="cp-empty-orb" aria-hidden="true">
        <Sparkles size={24} strokeWidth={1.25} />
      </span>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function CompanionPageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="cp-page-header">
      <div>
        <p className="cp-eyebrow">ARRAB / COMPANIONS</p>
        <h1>{title}</h1>
        <p className="cp-muted">{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
