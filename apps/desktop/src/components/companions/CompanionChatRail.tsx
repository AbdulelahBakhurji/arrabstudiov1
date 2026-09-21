/**
 * Vertical rail of stored chats for a companion — circles with right-click menu.
 */
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { AssistantChatTab } from "@/lib/assistant-chat-tabs";
import { cn } from "@/lib/utils";

export type ChatRailMenuAction =
  | "new"
  | "open"
  | "rename"
  | "sendIncognito"
  | "delete"
  | "duplicate";

type MenuState = {
  x: number;
  y: number;
  tabId: string;
};

type RenameState = {
  x: number;
  y: number;
  tabId: string;
  title: string;
};

export function CompanionChatRail({
  tabs,
  activeId,
  companionHue,
  companionName,
  ar,
  disabled,
  onSelect,
  onNew,
  onAction,
  onRename,
}: {
  tabs: AssistantChatTab[];
  activeId: string;
  companionHue: number;
  companionName: string;
  ar: boolean;
  disabled?: boolean;
  onSelect: (tabId: string) => void;
  onNew: () => void;
  onAction: (action: ChatRailMenuAction, tabId: string) => void;
  onRename: (tabId: string, title: string) => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLFormElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
    const close = (event: MouseEvent) => {
      if (renameRef.current?.contains(event.target as Node)) return;
      setRenaming(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRenaming(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [renaming]);

  function commitRename() {
    if (!renaming) return;
    const next = renaming.title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (next) onRename(renaming.tabId, next);
    setRenaming(null);
  }

  return (
    <aside className="cp-chat-rail" aria-label={ar ? "المحادثات المحفوظة" : "Saved chats"}>
      <button
        type="button"
        className="cp-chat-rail-new"
        disabled={disabled}
        title={ar ? "محادثة جديدة" : "New chat"}
        aria-label={ar ? "محادثة جديدة" : "New chat"}
        onClick={onNew}
      >
        <Plus size={16} strokeWidth={1.8} />
      </button>
      <div className="cp-chat-rail-list">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const label = tab.title || (ar ? "محادثة" : "Chat");
          const initial = label.trim().charAt(0).toUpperCase() || String(index + 1);
          return (
            <button
              key={tab.id}
              type="button"
              className={cn("cp-chat-rail-dot", active && "is-active")}
              style={{ ["--cp-hue" as string]: companionHue }}
              disabled={disabled}
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={(event) => {
                event.preventDefault();
                if (disabled) return;
                const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setMenu(null);
                setRenaming({
                  x: rect.right + 8,
                  y: rect.top,
                  tabId: tab.id,
                  title: tab.title || label,
                });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setRenaming(null);
                setMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
              }}
            >
              <span className="cp-chat-rail-initial">{initial}</span>
              <span className="cp-chat-rail-tip">{label}</span>
            </button>
          );
        })}
      </div>
      {menu ? (
        <div
          ref={menuRef}
          className="cp-chat-rail-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
        >
          <p className="cp-chat-rail-menu-head">
            {tabs.find((tab) => tab.id === menu.tabId)?.title || companionName}
          </p>
          {(
            [
              { id: "open" as const, label: ar ? "فتح" : "Open" },
              { id: "rename" as const, label: ar ? "إعادة تسمية" : "Rename" },
              { id: "new" as const, label: ar ? "محادثة جديدة" : "New chat" },
              { id: "duplicate" as const, label: ar ? "نسخ المحادثة" : "Duplicate" },
              {
                id: "sendIncognito" as const,
                label: ar ? "إرسال إلى الخفاء" : "Send to Incognito",
              },
              { id: "delete" as const, label: ar ? "حذف" : "Delete", danger: true },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cn("cp-chat-rail-menu-item", "danger" in item && item.danger && "is-danger")}
              onClick={() => {
                const tabId = menu.tabId;
                const tab = tabs.find((item) => item.id === tabId);
                setMenu(null);
                if (item.id === "rename") {
                  setRenaming({
                    x: menu.x,
                    y: menu.y,
                    tabId,
                    title: tab?.title || (ar ? "محادثة" : "Chat"),
                  });
                  return;
                }
                onAction(item.id, tabId);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {renaming ? (
        <form
          ref={renameRef}
          className="cp-chat-rail-rename"
          style={{ left: renaming.x, top: renaming.y }}
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <label className="cp-chat-rail-rename-label" htmlFor="cp-chat-rename">
            {ar ? "اسم المحادثة" : "Chat name"}
          </label>
          <input
            ref={renameInputRef}
            id="cp-chat-rename"
            className="cp-chat-rail-rename-input"
            value={renaming.title}
            maxLength={80}
            onChange={(event) =>
              setRenaming((current) =>
                current ? { ...current, title: event.target.value } : current,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(null);
              }
            }}
          />
          <div className="cp-chat-rail-rename-actions">
            <button type="button" className="cp-chat-rail-rename-cancel" onClick={() => setRenaming(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </button>
            <button type="submit" className="cp-chat-rail-rename-save">
              {ar ? "حفظ" : "Save"}
            </button>
          </div>
        </form>
      ) : null}
    </aside>
  );
}
