import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  ShieldCheck,
  Sparkles,
  UserRound,
  AlertTriangle,
  Info,
  X,
  CheckCheck,
  Bot,
  Plug,
  Users,
  Trash2,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { dismissManagedNotification, openManagedNotification } from "@/domains/managed/client/client";
import { markInboxRead, removeInboxItem, useManagedState, type ManagedInboxItem } from "@/domains/managed/client/store";
import { localized, type NotificationKind } from "@/domains/managed/client/types";
import {
  clearNotificationInbox,
  getNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
  ensureStudioInboxSeeded,
  removeNotification,
  subscribeNotificationInbox,
  type NotificationInboxItem,
} from "@/domains/notifications/notify";
import { cn } from "@/shared/lib/utils";

type BellItem = {
  id: string;
  source: "local" | "managed";
  title: string;
  body?: string;
  kind: string;
  receivedAt: number;
  read: boolean;
  href?: string;
  managed?: ManagedInboxItem;
};

type FilterTab = "all" | "unread";

function KindIcon({ kind }: { kind: string }) {
  const props = { size: 15, strokeWidth: 1.8 };
  if (kind === "security") return <ShieldCheck {...props} />;
  if (kind === "update") return <Sparkles {...props} />;
  if (kind === "companion" || kind === "teamLaunch") return <UserRound {...props} />;
  if (kind === "warning" || kind === "approvals") return <AlertTriangle {...props} />;
  if (kind === "connector") return <Plug {...props} />;
  if (kind === "cowork") return <Users {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  return <Info {...props} />;
}

function kindLabel(kind: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    security: ["Security", "أمان"],
    update: ["Update", "تحديث"],
    companion: ["Companion", "رفيق"],
    agent: ["Agent", "وكيل"],
    teamLaunch: ["Team", "فريق"],
    warning: ["Warning", "تنبيه"],
    approvals: ["Approval", "موافقة"],
    connector: ["Connector", "موصّل"],
    cowork: ["Cowork", "عمل مشترك"],
    success: ["Success", "نجاح"],
    info: ["Info", "معلومة"],
    system: ["Studio", "استوديو"],
  };
  const pair = map[kind] ?? map.system!;
  return ar ? pair[1] : pair[0];
}

function relativeWhen(at: number, locale: string): string {
  const ar = locale === "ar";
  const delta = Date.now() - at;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return ar ? "الآن" : "Just now";
  if (mins < 60) return ar ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ar ? `منذ ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return ar ? `منذ ${days} ي` : `${days}d ago`;
  try {
    return new Intl.DateTimeFormat(ar ? "ar-SA" : "en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

function managedKind(kind: NotificationKind | string): string {
  return kind || "info";
}

/** Bell in the title bar: local Studio toasts + Arrab Control notices. */
export function NotificationCenter() {
  const { t, locale, dir } = useLanguage();
  const ar = locale === "ar";
  const navigate = useNavigate();
  const { inbox: managedInbox } = useManagedState();
  const [localInbox, setLocalInbox] = useState<NotificationInboxItem[]>(() => getNotificationInbox());
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const now = Date.now();

  useEffect(() => subscribeNotificationInbox(setLocalInbox), []);

  useEffect(() => {
    ensureStudioInboxSeeded(locale === "ar" ? "ar" : "en");
  }, [locale]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = useMemo(() => {
    const managed: BellItem[] = managedInbox
      .filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now)
      .map((item) => ({
        id: `m:${item.id}`,
        source: "managed" as const,
        title: localized(item.title, locale),
        body: item.body ? localized(item.body, locale) : undefined,
        kind: managedKind(item.kind),
        receivedAt: item.receivedAt,
        read: item.read,
        managed: item,
      }));

    const local: BellItem[] = localInbox.map((item) => ({
      id: `l:${item.id}`,
      source: "local" as const,
      title: item.title,
      body: item.body,
      kind: item.kind ?? item.tone ?? "system",
      receivedAt: item.createdAt,
      read: item.read,
      href: item.href,
    }));

    return [...managed, ...local].sort((a, b) => b.receivedAt - a.receivedAt);
  }, [localInbox, locale, managedInbox, now]);

  const unread = items.filter((item) => !item.read).length;
  const visible = filter === "unread" ? items.filter((item) => !item.read) : items;

  const openItem = (item: BellItem) => {
    if (item.source === "managed" && item.managed) {
      markInboxRead(item.managed.id);
      setOpen(false);
      openManagedNotification(item.managed);
      return;
    }
    markNotificationRead(item.id.replace(/^l:/, ""));
    setOpen(false);
    if (item.href) navigate(item.href);
  };

  const dismissItem = (item: BellItem) => {
    if (item.source === "managed" && item.managed) {
      removeInboxItem(item.managed.id);
      dismissManagedNotification(item.managed.id);
      return;
    }
    removeNotification(item.id.replace(/^l:/, ""));
  };

  const markAll = () => {
    markInboxRead("all");
    markAllNotificationsRead();
  };

  const clearAll = () => {
    for (const item of managedInbox) {
      removeInboxItem(item.id);
      dismissManagedNotification(item.id);
    }
    clearNotificationInbox();
  };

  return (
    <div className="mc-bell-wrap" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("mcNotifications")}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn("mc-bell-trigger", open && "is-open", unread > 0 && "has-unread")}
      >
        <span className="relative inline-flex">
          <Bell className="size-4" strokeWidth={1.7} />
          {unread > 0 ? (
            <span className="mc-bell-dot" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      </button>
      {open && anchor
        ? createPortal(
            <div
              ref={panelRef}
              id={menuId}
              className="mc-bell-panel"
              dir={dir}
              role="dialog"
              aria-label={t("mcNotifications")}
              style={{ top: anchor.top, right: anchor.right }}
            >
              <header className="mc-bell-head">
                <div className="mc-bell-title">
                  <span className="mc-bell-title-icon" aria-hidden>
                    <Bell size={15} strokeWidth={1.8} />
                  </span>
                  <div className="mc-bell-title-copy">
                    <strong>{t("mcNotifications")}</strong>
                    <span>
                      {unread > 0
                        ? t("mcUnreadCount").replace("{n}", String(unread))
                        : t("mcNotificationsEmpty")}
                    </span>
                  </div>
                </div>
                <div className="mc-bell-head-actions">
                  {unread > 0 ? (
                    <button type="button" className="mc-bell-action" onClick={markAll} title={t("mcMarkAllRead")}>
                      <CheckCheck size={14} strokeWidth={1.9} />
                      <span>{t("mcMarkAllRead")}</span>
                    </button>
                  ) : null}
                  {items.length > 0 ? (
                    <button type="button" className="mc-bell-action is-quiet" onClick={clearAll} title={t("mcClearAll")}>
                      <Trash2 size={13} strokeWidth={1.9} />
                    </button>
                  ) : null}
                </div>
              </header>

              <div className="mc-bell-tabs" role="tablist" aria-label={t("mcNotifications")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "all"}
                  className={cn("mc-bell-tab", filter === "all" && "is-on")}
                  onClick={() => setFilter("all")}
                >
                  {t("mcFilterAll")}
                  <em>{items.length}</em>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "unread"}
                  className={cn("mc-bell-tab", filter === "unread" && "is-on")}
                  onClick={() => setFilter("unread")}
                >
                  {t("mcFilterUnread")}
                  <em>{unread}</em>
                </button>
              </div>

              {visible.length === 0 ? (
                <div className="mc-bell-empty">
                  <span className="mc-bell-empty-icon" aria-hidden>
                    <Bell size={22} strokeWidth={1.6} />
                  </span>
                  <strong>{t("mcNotificationsEmpty")}</strong>
                  <p>{t("mcNotificationsEmptyHint")}</p>
                </div>
              ) : (
                <ul className="mc-bell-list">
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className={cn("mc-bell-item", !item.read && "is-unread")}
                      data-kind={item.kind}
                    >
                      <button type="button" className="mc-bell-open" onClick={() => openItem(item)}>
                        <span className="mc-bell-kind" aria-hidden>
                          <KindIcon kind={item.kind} />
                        </span>
                        <span className="mc-bell-copy">
                          <span className="mc-bell-meta">
                            <em>{kindLabel(item.kind, ar)}</em>
                            <small>{relativeWhen(item.receivedAt, locale)}</small>
                          </span>
                          <strong>{item.title}</strong>
                          {item.body ? <span className="mc-bell-body">{item.body}</span> : null}
                        </span>
                        {!item.read ? <span className="mc-bell-unread-dot" aria-hidden /> : null}
                      </button>
                      <button
                        type="button"
                        className="mc-bell-x"
                        aria-label={t("mcDismiss")}
                        onClick={() => dismissItem(item)}
                      >
                        <X size={13} strokeWidth={1.9} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
