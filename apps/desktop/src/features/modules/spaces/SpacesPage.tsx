import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Check,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import type { DocumentSpace, SpacePage, SpacesView } from "@arrab/shared";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { pushToast } from "@/domains/notifications/notify";
import { localSpaces } from "@/domains/spaces/local-spaces";
import { companionDisplayName } from "@/domains/companions/catalog/catalog";
import {
  liveCompanions,
  useCompanionState,
  type CompanionProfile,
} from "@/domains/companions/model/companions";
import { PersonAvatar } from "@/domains/companions/ui/CompanionUI";
import { SpaceChatPanel } from "./SpaceChatPanel";
import { SpaceEditor } from "./SpaceEditor";

type ViewMode = "grid" | "list";
type SaveState = "idle" | "saving" | "saved" | "error";

const WIDTHS_KEY = "arrab.spaces.paneWidths.v1";

function readWidths(): { rail: number; companion: number } {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return { rail: 220, companion: 340 };
    const parsed = JSON.parse(raw) as { rail?: number; companion?: number };
    return {
      rail: Math.min(360, Math.max(180, Number(parsed.rail) || 220)),
      companion: Math.min(480, Math.max(280, Number(parsed.companion) || 340)),
    };
  } catch {
    return { rail: 220, companion: 340 };
  }
}

export function SpacesPage() {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const companionState = useCompanionState();
  const companions = useMemo(
    () => liveCompanions(companionState).filter((person) => !person.archivedAt),
    [companionState],
  );

  const [view, setView] = useState<SpacesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [sourceMode, setSourceMode] = useState(false);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [revision, setRevision] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [naming, setNaming] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [companionQuery, setCompanionQuery] = useState("");
  const [companionOpen, setCompanionOpen] = useState(true);
  const [words, setWords] = useState(0);
  const [chars, setChars] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [widths, setWidths] = useState(readWidths);
  const saveTimer = useRef<number | null>(null);
  const dragRef = useRef<{ side: "rail" | "companion"; startX: number; startW: number } | null>(null);

  const refresh = useCallback(async () => {
    const next = await localSpaces.get();
    setView(next);
    setSpaceId((current) => current ?? next.spaces[0]?.id ?? null);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch(() => {
        if (!cancelled) {
          pushToast({
            title: ar ? "تعذّر فتح المساحات" : "Could not open Spaces",
            tone: "warn",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, ar]);

  useEffect(() => {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  }, [widths]);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      if (drag.side === "rail") {
        const next = Math.min(360, Math.max(180, drag.startW + (ar ? -delta : delta)));
        setWidths((current) => ({ ...current, rail: next }));
      } else {
        const next = Math.min(480, Math.max(280, drag.startW - (ar ? -delta : delta)));
        setWidths((current) => ({ ...current, companion: next }));
      }
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [ar]);

  const space = view?.spaces.find((item) => item.id === spaceId) ?? null;
  const pages = useMemo(() => {
    if (!view || !spaceId) return [] as SpacePage[];
    const inSpace = view.pages.filter((page) => page.spaceId === spaceId);
    const q = query.trim().toLowerCase();
    if (!q) return inSpace;
    return inSpace.filter(
      (page) => page.title.toLowerCase().includes(q) || page.markdown.toLowerCase().includes(q),
    );
  }, [view, spaceId, query]);

  const activePage = view?.pages.find((page) => page.id === pageId) ?? null;
  const filteredCompanions = useMemo(() => {
    const q = companionQuery.trim().toLowerCase();
    if (!q) return companions;
    return companions.filter((person) => {
      const name = companionDisplayName(person, locale).toLowerCase();
      return name.includes(q) || person.domain.toLowerCase().includes(q);
    });
  }, [companions, companionQuery, locale]);

  const defaultCompanion =
    companions.find((person) => person.id === space?.defaultCompanionId) ?? null;

  useEffect(() => {
    if (!activePage) {
      setTitle("");
      setMarkdown("");
      setRevision(1);
      setWords(0);
      setChars(0);
      setConfirmDelete(false);
      return;
    }
    setTitle(activePage.title);
    setMarkdown(activePage.markdown);
    setRevision(activePage.revision);
    setSaveState("idle");
    setConfirmDelete(false);
  }, [activePage?.id, activePage?.revision]);

  function scheduleSave(nextTitle: string, nextMarkdown: string, nextRevision: number) {
    if (!pageId) return;
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void localSpaces
        .updatePage(pageId, {
          title: nextTitle,
          markdown: nextMarkdown,
          revision: nextRevision,
        })
        .then((result) => {
          setView(result.view);
          setRevision(result.page.revision);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 550);
  }

  function startCreateSpace() {
    setNewSpaceName(ar ? "مساحة جديدة" : "New Space");
    setNaming(true);
  }

  async function confirmCreateSpace() {
    const name = newSpaceName.trim();
    if (!name) return;
    try {
      const first = companions[0];
      const next = await localSpaces.createSpace({
        name,
        companionIds: first ? [first.id] : [],
      });
      const created = next.spaces[0];
      if (created && first) {
        const linked = await localSpaces.updateSpace(created.id, {
          defaultCompanionId: first.id,
          companionIds: [first.id],
        });
        setView(linked);
        setSpaceId(created.id);
      } else {
        setView(next);
        setSpaceId(created?.id ?? null);
      }
      setPageId(null);
      setNaming(false);
      setNewSpaceName("");
    } catch {
      pushToast({ title: ar ? "تعذّر إنشاء المساحة" : "Could not create Space", tone: "warn" });
    }
  }

  async function createPage() {
    if (!spaceId) return;
    try {
      const result = await localSpaces.createPage({
        spaceId,
        title: ar ? "صفحة جديدة" : "Untitled",
        markdown: "",
      });
      setView(result.view);
      setPageId(result.page.id);
      setCompanionOpen(true);
    } catch {
      pushToast({ title: ar ? "تعذّر إنشاء الصفحة" : "Could not create page", tone: "warn" });
    }
  }

  async function removePage() {
    if (!pageId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const next = await localSpaces.deletePage(pageId);
    setView(next);
    setPageId(null);
    setConfirmDelete(false);
  }

  async function setDefaultCompanion(person: CompanionProfile) {
    if (!space) return;
    const ids = new Set(space.companionIds);
    ids.add(person.id);
    try {
      const next = await localSpaces.updateSpace(space.id, {
        companionIds: [...ids],
        defaultCompanionId: person.id,
      });
      setView(next);
    } catch {
      pushToast({
        title: ar ? "تعذّر تعيين الرفيق" : "Could not set companion",
        tone: "warn",
      });
    }
  }

  function beginResize(side: "rail" | "companion", event: ReactMouseEvent) {
    event.preventDefault();
    dragRef.current = {
      side,
      startX: event.clientX,
      startW: side === "rail" ? widths.rail : widths.companion,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  if (loading) {
    return (
      <div className="sp-shell sp-loading">
        <Loader2 className="animate-spin" size={22} />
        <span>{ar ? "جارٍ فتح المساحات…" : "Opening Spaces…"}</span>
      </div>
    );
  }

  const showPageChat = Boolean(activePage && defaultCompanion);
  const companionPane = companionOpen ? (
    <aside className={`sp-companions${showPageChat ? " has-chat" : ""}`} style={{ width: widths.companion }}>
      <header className="sp-companions-head">
        <div>
          <p className="cp-eyebrow">{ar ? "رفقاء" : "Companions"}</p>
          <h2>{showPageChat ? (ar ? "محادثة الصفحة" : "Page chat") : ar ? "اختر رفيقاً" : "Choose companion"}</h2>
        </div>
        <button
          type="button"
          className="cp-button"
          aria-label={ar ? "إخفاء" : "Hide"}
          onClick={() => setCompanionOpen(false)}
        >
          <PanelRightClose size={14} />
        </button>
      </header>

      <div className="sp-companions-picker">
        <label className="sp-search">
          <Search size={14} />
          <input
            value={companionQuery}
            onChange={(event) => setCompanionQuery(event.target.value)}
            placeholder={ar ? "ابحث عن رفيق…" : "Search companions…"}
          />
        </label>
        <ul className="sp-companions-list">
          {filteredCompanions.map((person) => {
            const isDefault = space?.defaultCompanionId === person.id;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  className={isDefault ? "is-on" : undefined}
                  onClick={() => void setDefaultCompanion(person)}
                >
                  <PersonAvatar person={person} size="sm" />
                  <span>
                    <strong>{companionDisplayName(person, locale)}</strong>
                    <small>{person.domain}</small>
                  </span>
                  {isDefault ? <Check size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {showPageChat && defaultCompanion && activePage && space ? (
        <SpaceChatPanel
          key={`${defaultCompanion.id}:${activePage.id}`}
          person={defaultCompanion}
          spaceName={space.name}
          pageTitle={title}
          pageMarkdown={markdown}
          sessionKey={`${space.id}:${activePage.id}:${defaultCompanion.id}`}
        />
      ) : (
        <p className="sp-companions-hint">
          {defaultCompanion
            ? ar
              ? "افتح صفحة للدردشة مع الرفيق حول المستند."
              : "Open a page to chat with the companion about the document."
            : ar
              ? "اختر رفيقاً من القائمة، ثم افتح صفحة للدردشة."
              : "Choose a companion, then open a page to chat."}
        </p>
      )}
    </aside>
  ) : null;

  return (
    <div
      className="sp-shell"
      style={
        {
          "--sp-rail": `${widths.rail}px`,
          "--sp-companion": companionOpen ? `${widths.companion}px` : "0px",
        } as CSSProperties
      }
    >
      <aside className="sp-rail" style={{ width: widths.rail }}>
        <header className="sp-rail-head">
          <div>
            <p className="cp-eyebrow">ARRAB</p>
            <h1>{t("spacesTitle")}</h1>
            <p>{t("spacesBody")}</p>
          </div>
          <button type="button" className="cp-button cp-primary" onClick={startCreateSpace}>
            <FolderPlus size={14} />
            {ar ? "مساحة" : "Space"}
          </button>
        </header>
        {naming ? (
          <form
            className="sp-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmCreateSpace();
            }}
          >
            <input
              className="cp-input"
              autoFocus
              value={newSpaceName}
              onChange={(event) => setNewSpaceName(event.target.value)}
              placeholder={ar ? "اسم المساحة" : "Space name"}
            />
            <div className="sp-name-actions">
              <button type="submit" className="cp-button cp-primary" disabled={!newSpaceName.trim()}>
                {ar ? "إنشاء" : "Create"}
              </button>
              <button
                type="button"
                className="cp-button"
                onClick={() => {
                  setNaming(false);
                  setNewSpaceName("");
                }}
              >
                {ar ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </form>
        ) : null}
        <ul className="sp-space-list">
          {(view?.spaces ?? []).map((item: DocumentSpace) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === spaceId ? "is-on" : undefined}
                onClick={() => {
                  setSpaceId(item.id);
                  setPageId(null);
                }}
              >
                <strong>{item.name}</strong>
                <small>
                  {(view?.pages.filter((page) => page.spaceId === item.id).length ?? 0)}{" "}
                  {ar ? "صفحة" : "pages"}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div
        className="sp-split"
        role="separator"
        aria-orientation="vertical"
        aria-label={ar ? "تغيير عرض المساحات" : "Resize spaces pane"}
        onMouseDown={(event) => beginResize("rail", event)}
      />

      <section className="sp-main">
        {!space ? (
          <div className="sp-empty">
            <h2>{ar ? "أنشئ مساحة للعمل" : "Create a Space to start"}</h2>
            <p>{t("spacesBody")}</p>
            <button type="button" className="cp-button cp-primary" onClick={startCreateSpace}>
              <FolderPlus size={15} />
              {ar ? "مساحة جديدة" : "New Space"}
            </button>
          </div>
        ) : activePage ? (
          <div className="sp-word">
            <header className="sp-word-head">
              <div className="sp-word-head-main">
                <button type="button" className="cp-text-button" onClick={() => setPageId(null)}>
                  ← {space.name}
                </button>
                <input
                  className="sp-title"
                  value={title}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTitle(next);
                    scheduleSave(next, markdown, revision);
                  }}
                  placeholder={ar ? "عنوان المستند" : "Document title"}
                />
              </div>
              <div className="sp-word-head-actions">
                <span className="sp-save" data-state={saveState}>
                  {saveState === "saving"
                    ? ar
                      ? "يحفظ…"
                      : "Saving…"
                    : saveState === "saved"
                      ? ar
                        ? "محفوظ"
                        : "Saved"
                      : saveState === "error"
                        ? ar
                          ? "فشل الحفظ"
                          : "Save failed"
                        : ar
                          ? "جاهز"
                          : "Ready"}
                </span>
                {defaultCompanion ? (
                  <span className="sp-word-companion">
                    <PersonAvatar person={defaultCompanion} size="sm" />
                    {companionDisplayName(defaultCompanion, locale)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="cp-button"
                  aria-pressed={sourceMode}
                  onClick={() => setSourceMode((value) => !value)}
                >
                  {sourceMode ? (ar ? "محرر" : "Editor") : ar ? "مصدر" : "Markdown"}
                </button>
                <button
                  type="button"
                  className="cp-button"
                  aria-pressed={companionOpen}
                  onClick={() => setCompanionOpen((value) => !value)}
                >
                  {companionOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                  <Users size={14} />
                </button>
                <button
                  type="button"
                  className={`cp-button${confirmDelete ? " cp-primary" : ""}`}
                  onClick={() => void removePage()}
                >
                  {confirmDelete ? <Check size={14} /> : <Trash2 size={14} />}
                  {confirmDelete ? (ar ? "تأكيد" : "Confirm") : null}
                </button>
              </div>
            </header>

            <SpaceEditor
              markdown={markdown}
              sourceMode={sourceMode}
              placeholder={ar ? "ابدأ الكتابة…" : "Start writing…"}
              onChange={(next) => {
                setMarkdown(next);
                scheduleSave(title, next, revision);
              }}
              onStats={({ words: w, chars: c }) => {
                setWords(w);
                setChars(c);
              }}
            />

            <footer className="sp-statusbar">
              <span>
                {ar ? "كلمات" : "Words"} {words}
              </span>
              <span>
                {ar ? "أحرف" : "Chars"} {chars}
              </span>
              <span>
                {ar ? "مراجعة" : "Rev"} {revision}
              </span>
              <span className="sp-statusbar-end">
                {ar ? "مستند Arrab" : "Arrab document"}
              </span>
            </footer>
          </div>
        ) : (
          <div className="sp-library">
            <header className="sp-lib-head">
              <div>
                <h2>{space.name}</h2>
                <p>{space.description || t("spacesBody")}</p>
              </div>
              <div className="sp-lib-tools">
                <label className="sp-search">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={ar ? "بحث في الصفحات…" : "Search pages…"}
                  />
                </label>
                <button
                  type="button"
                  className="cp-button"
                  aria-pressed={mode === "grid"}
                  onClick={() => setMode("grid")}
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  type="button"
                  className="cp-button"
                  aria-pressed={mode === "list"}
                  onClick={() => setMode("list")}
                >
                  <ListIcon size={14} />
                </button>
                <button
                  type="button"
                  className="cp-button"
                  aria-pressed={companionOpen}
                  onClick={() => setCompanionOpen((value) => !value)}
                >
                  <Users size={14} />
                </button>
                <button type="button" className="cp-button cp-primary" onClick={() => void createPage()}>
                  <FilePlus2 size={14} />
                  {ar ? "صفحة" : "Page"}
                </button>
              </div>
            </header>
            {pages.length === 0 ? (
              <div className="sp-empty">
                <h2>{ar ? "لا صفحات بعد" : "No pages yet"}</h2>
                <p>{ar ? "أنشئ صفحة وافتح محرر المستندات." : "Create a page to open the document editor."}</p>
                <button type="button" className="cp-button cp-primary" onClick={() => void createPage()}>
                  <FilePlus2 size={15} />
                  {ar ? "أنشئ صفحة" : "Create a page"}
                </button>
              </div>
            ) : (
              <div className={mode === "grid" ? "sp-grid" : "sp-list"}>
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className="sp-card"
                    onClick={() => {
                      setPageId(page.id);
                      setCompanionOpen(true);
                    }}
                  >
                    <strong>{page.title}</strong>
                    <p>{page.markdown.slice(0, 140) || (ar ? "فارغة" : "Empty")}</p>
                    <time dateTime={page.updatedAt}>
                      {new Date(page.updatedAt).toLocaleString(locale)}
                    </time>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {companionOpen ? (
        <div
          className="sp-split"
          role="separator"
          aria-orientation="vertical"
          aria-label={ar ? "تغيير عرض الرفقاء" : "Resize companions pane"}
          onMouseDown={(event) => beginResize("companion", event)}
        />
      ) : null}

      {companionPane}
    </div>
  );
}
