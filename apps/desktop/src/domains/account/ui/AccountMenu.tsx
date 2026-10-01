import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Command,
  CreditCard,
  Gauge,
  LifeBuoy,
  LogIn,
  LogOut,
  Moon,
  Plug,
  Settings,
  Sun,
  User,
  UserRound,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { useTheme } from "@/app/theme/ThemeProvider";
import { arrabApi } from "@/core/api/api";
import { clearAccountSession, initialsFromName } from "@/domains/account/account-session";
import { openExternalUrl } from "@/core/platform/desktop";
import { useProfilePhoto } from "@/domains/companions/profile-photo";
import { pushToast } from "@/shared/lib/notify";
import { useSignedInAccount } from "@/domains/account/use-signed-in-account";
import { clearGuestLocalMode, isGuestLocalMode } from "@/domains/account/guest-mode";
import { useRole } from "@/app/roles/RoleProvider";
import { cn } from "@/shared/lib/utils";

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

export function AccountMenu({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { t, locale, setLocale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { href, isOrganization } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { account, status, signedIn } = useSignedInAccount();
  const photo = useProfilePhoto();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const user = signedIn && !isGuestLocalMode() ? account : null;
  const rawEntitlements = user ? status?.entitlements : null;
  const entitlements =
    rawEntitlements?.connected && !rawEntitlements.planName.trim().toLowerCase().startsWith("local")
      ? rawEntitlements
      : null;
  const used = entitlements?.tokensUsed ?? 0;
  const limit = entitlements?.tokenLimit ?? null;
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const daysLeft = daysUntil(user?.periodEnd);
  const initials = user ? initialsFromName(user.displayName, user.email) : "";

  useEffect(() => setOpen(false), [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    const first = panelRef.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(href(path));
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []),
    ];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await arrabApi.logoutAccount().catch(() => undefined);
      clearAccountSession();
      pushToast({ title: t("accountLoggedOut"), tone: "info" });
      setOpen(false);
    } finally {
      setSigningOut(false);
    }
  }

  const avatar = (size: "sm" | "lg") => (
    <span className={cn("acm-avatar", size === "lg" && "is-lg", user && "is-signed")}>
      {photo ? (
        <img src={photo} alt="" />
      ) : user ? (
        <span className="acm-initials">{initials}</span>
      ) : (
        <User size={size === "lg" ? 20 : 15} strokeWidth={1.7} />
      )}
      {size === "lg" && user ? <span className="acm-presence" aria-hidden /> : null}
    </span>
  );

  return (
    <div className="acm" ref={rootRef}>
      <button
        type="button"
        className={cn("acm-trigger", open && "is-open")}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("amTitle")}
        title={t("amTitle")}
      >
        {avatar("sm")}
      </button>

      {open && anchor
        ? createPortal(
            <div
              id={menuId}
              ref={panelRef}
              className="acm-panel"
              style={{ top: anchor.top, right: anchor.right }}
              role="menu"
              aria-label={t("amTitle")}
              onKeyDown={onMenuKey}
              dir={locale === "ar" ? "rtl" : "ltr"}
            >
              <div className="acm-head">
                {avatar("lg")}
                <div className="acm-id">
                  {user ? (
                    <>
                      <p className="acm-name">{user.displayName || user.email}</p>
                      <p className="acm-email">{user.email}</p>
                    </>
                  ) : (
                    <>
                      <p className="acm-name">{t("acmGuest")}</p>
                      <p className="acm-email">{t("acmGuestBody")}</p>
                    </>
                  )}
                </div>
                {user ? (
                  <span className={cn("acm-plan", entitlements?.overLimit && "is-warn")}>
                    {entitlements?.planName || user.planName}
                  </span>
                ) : null}
              </div>

              {user ? (
                <button
                  type="button"
                  role="menuitem"
                  className="acm-usage"
                  onClick={() => go("/account?section=usage")}
                >
                  <span className="acm-usage-row">
                    <span className="acm-usage-label">
                      <Gauge size={13} strokeWidth={1.8} />
                      {t("amUsage")}
                    </span>
                    <span className="acm-usage-value">
                      {limit ? `${pct}%` : t("unlimitedTokens")}
                    </span>
                  </span>
                  {limit ? (
                    <span className="acm-meter" aria-hidden>
                      <span
                        className={cn("acm-meter-fill", pct >= 90 && "is-warn")}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </span>
                  ) : null}
                  <span className="acm-usage-foot">
                    {entitlements?.overLimit
                      ? t("acmOverLimit")
                      : daysLeft !== null
                        ? t("acmResetsIn").replace("{days}", String(daysLeft))
                        : null}
                    <ArrowUpRight size={12} strokeWidth={1.8} />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="acm-signin"
                  onClick={() => {
                    clearGuestLocalMode();
                    go("/settings?tab=account");
                  }}
                >
                  <LogIn size={15} strokeWidth={1.8} />
                  {t("signInWithBrowser")}
                </button>
              )}

              <div className="acm-group">
                <MenuItem
                  icon={<UserRound size={15} strokeWidth={1.7} />}
                  label={t("amTitle")}
                  hint={`${MOD}U`}
                  onClick={() => go("/account")}
                />
                {user ? (
                  <MenuItem
                    icon={<CreditCard size={15} strokeWidth={1.7} />}
                    label={t("amPlanBilling")}
                    onClick={() => go("/account?section=plan")}
                  />
                ) : null}
                <MenuItem
                  icon={<Settings size={15} strokeWidth={1.7} />}
                  label={t("settings")}
                  hint={`${MOD},`}
                  onClick={() => go("/settings")}
                />
                {user ? (
                  <MenuItem
                    icon={<Plug size={15} strokeWidth={1.7} />}
                    label={t("connectors")}
                    onClick={() => go("/connectors")}
                  />
                ) : null}
                <MenuItem
                  icon={<Command size={15} strokeWidth={1.7} />}
                  label={t("acmCommandPalette")}
                  hint={`${MOD}K`}
                  onClick={() => {
                    setOpen(false);
                    onOpenPalette();
                  }}
                />
              </div>

              <div className="acm-prefs">
                <Segmented
                  label={t("acmTheme")}
                  value={theme}
                  options={[
                    {
                      value: "dark",
                      label: t("acmDark"),
                      icon: <Moon size={13} strokeWidth={1.8} />,
                    },
                    {
                      value: "light",
                      label: t("acmLight"),
                      icon: <Sun size={13} strokeWidth={1.8} />,
                    },
                  ]}
                  onChange={(value) => setTheme(value as typeof theme)}
                />
                <Segmented
                  label={t("acmLanguage")}
                  value={locale}
                  options={[
                    { value: "en", label: "English" },
                    { value: "ar", label: "العربية" },
                  ]}
                  onChange={(value) => setLocale(value as typeof locale)}
                />
              </div>

              <div className="acm-group">
                <MenuItem
                  icon={<LifeBuoy size={15} strokeWidth={1.7} />}
                  label={t("acmHelp")}
                  trailing={<ArrowUpRight size={13} strokeWidth={1.7} />}
                  onClick={() => {
                    setOpen(false);
                    void openExternalUrl("https://arrabai.com");
                  }}
                />
                {user ? (
                  <MenuItem
                    icon={<LogOut size={15} strokeWidth={1.7} />}
                    label={t("amSignOut")}
                    tone="danger"
                    disabled={signingOut}
                    onClick={() => void signOut()}
                  />
                ) : null}
              </div>
              <p className="acm-foot">
                {isOrganization ? t("acmWorkspaceOrg") : t("acmWorkspaceIndividual")} · Arrab Studio
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  trailing,
  tone,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  trailing?: ReactNode;
  tone?: "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn("acm-item", tone === "danger" && "is-danger")}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="acm-item-icon">{icon}</span>
      <span className="acm-item-label">{label}</span>
      {hint ? <kbd className="acm-kbd">{hint}</kbd> : null}
      {trailing ? <span className="acm-item-trail">{trailing}</span> : null}
    </button>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="acm-seg-row">
      <span className="acm-seg-label">{label}</span>
      <div className="acm-seg" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={cn("acm-seg-btn", value === option.value && "is-on")}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
