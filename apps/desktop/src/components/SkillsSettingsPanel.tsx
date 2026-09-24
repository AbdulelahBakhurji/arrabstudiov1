import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Check,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  FileText,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  Languages,
  Link2,
  Loader2,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  NotebookPen,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { pushToast } from "@/lib/notify";
import { downloadBlob } from "@/lib/studio-catalog";
import { cn } from "@/lib/utils";
import {
  SKILL_LIMITS,
  STARTER_SKILLS,
  addStarterSkill,
  armSkill,
  buildSkillContext,
  createSkill,
  fetchClaudeSkillCatalog,
  installClaudeSkill,
  installedSkillPath,
  skillHasScripts,
  deleteSkill,
  duplicateSkill,
  exportSkillMarkdown,
  exportSkillsBundle,
  filesFromDataTransfer,
  importSkillFiles,
  importSkillText,
  importSkillsFromUrl,
  setSkillEnabled,
  slugifySkill,
  toggleArmedSkill,
  updateSkill,
  useArmedSkillIds,
  useSkills,
  type ClaudeCatalogSkill,
  type PickedFile,
  type SkillImportResult,
  type SkillMode,
  type SkillResource,
  type UserSkill,
} from "@/lib/user-skills";

type Filter = "all" | SkillMode | "off";
type Dialog =
  | { kind: "editor"; skill: UserSkill | null }
  | { kind: "url" }
  | { kind: "paste" }
  | null;

const STARTER_ICONS: Record<string, LucideIcon> = {
  pen: PenLine,
  code: Code2,
  notes: NotebookPen,
  mail: Mail,
  study: GraduationCap,
  translate: Languages,
  research: FlaskConical,
  spec: FileText,
};

const approxTokens = (chars: number) => Math.max(1, Math.round(chars / 4));
const LIBRARY_ORIGIN = /github\.com\/anthropics\/skills/i;
const VENDOR_BRANDED = /\b(claude|anthropic)\b/i;

export function SkillsSettingsPanel() {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const navigate = useNavigate();
  const { href } = useRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const skills = useSkills();
  const armedIds = useArmedSkillIds();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setDialog({ kind: "editor", skill: null });
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.(".sk-menu-wrap")) setMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuId]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteId]);

  const counts = useMemo(
    () => ({
      all: skills.length,
      always: skills.filter((skill) => skill.enabled && skill.mode === "always").length,
      auto: skills.filter((skill) => skill.enabled && skill.mode === "auto").length,
      manual: skills.filter((skill) => skill.enabled && skill.mode === "manual").length,
      off: skills.filter((skill) => !skill.enabled).length,
    }),
    [skills],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (filter === "off" && skill.enabled) return false;
      if (filter !== "all" && filter !== "off" && (!skill.enabled || skill.mode !== filter)) {
        return false;
      }
      if (!needle) return true;
      return `${skill.name} ${skill.slug} ${skill.description} ${skill.tags.join(" ")}`
        .toLowerCase()
        .includes(needle);
    });
  }, [skills, query, filter]);

  const installedSlugs = useMemo(() => new Set(skills.map((skill) => skill.slug)), [skills]);

  const reportImport = (result: SkillImportResult) => {
    const count = result.added.length + result.updated.length;
    if (count > 0) {
      const names = [...result.added, ...result.updated].slice(0, 3).map((skill) => skill.name);
      pushToast({
        title:
          result.updated.length && !result.added.length
            ? tx(`Updated ${count} skill${count === 1 ? "" : "s"}`, `تم تحديث ${count} مهارة`)
            : tx(`Imported ${count} skill${count === 1 ? "" : "s"}`, `تم استيراد ${count} مهارة`),
        body:
          names.join(" · ") +
          (result.errors.length ? tx(` · ${result.errors.length} skipped`, ` · تم تخطي ${result.errors.length}`) : ""),
        tone: "success",
      });
      setFilter("all");
      setQuery("");
    } else {
      pushToast({
        title: tx("Nothing imported", "لم يتم استيراد شيء"),
        body: result.errors[0] ?? tx("No skills found.", "لم يتم العثور على مهارات."),
        tone: "warn",
      });
    }
    return count > 0;
  };

  const runFileImport = async (items: PickedFile[]) => {
    if (!items.length) return;
    setImporting(true);
    try {
      reportImport(await importSkillFiles(items));
    } catch (error: unknown) {
      pushToast({
        title: tx("Import failed", "فشل الاستيراد"),
        body: error instanceof Error ? error.message : undefined,
        tone: "warn",
      });
    } finally {
      setImporting(false);
    }
  };

  const onPicked = (list: FileList | null, input: HTMLInputElement | null) => {
    const files = list ? [...list] : [];
    void runFileImport(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    if (input) input.value = "";
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const items = await filesFromDataTransfer(event.dataTransfer);
    void runFileImport(items);
  };

  const dropHandlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => void onDrop(event),
  };

  const safely = (action: () => void, success?: string) => {
    try {
      action();
      if (success) pushToast({ title: success, tone: "success" });
    } catch (error: unknown) {
      pushToast({
        title: tx("Something went wrong", "حدث خطأ"),
        body: error instanceof Error ? error.message : undefined,
        tone: "warn",
      });
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ title: label, tone: "success" });
    } catch {
      pushToast({ title: tx("Couldn't copy", "تعذر النسخ"), tone: "warn" });
    }
  };

  const tryInChat = (skill: UserSkill) => {
    if (!skill.enabled) setSkillEnabled(skill.id, true);
    if (skill.mode !== "always") armSkill(skill.id);
    navigate(href("/chat"));
  };

  const modeLabel = (mode: SkillMode) =>
    mode === "always"
      ? tx("Always on", "دائمًا")
      : mode === "auto"
        ? tx("Auto", "تلقائي")
        : tx("Manual", "يدوي");

  const sourceLabel = (skill: UserSkill) =>
    skill.source === "starter"
      ? tx("Starter", "جاهزة")
      : skill.source === "imported"
        ? skill.origin && LIBRARY_ORIGIN.test(skill.origin)
          ? tx("Skill library", "مكتبة المهارات")
          : skill.origin
          ? tx(`From ${skill.origin}`, `من ${skill.origin}`)
          : tx("Imported", "مستوردة")
        : tx("Custom", "مخصصة");

  return (
    <section className="settings-rise st-page sk-page" {...dropHandlers}>
      <header className="st-head">
        <div>
          <h2>{tx("Skills", "المهارات")}</h2>
          <p>
            {tx(
              "Teach Arrab reusable know-how — writing styles, review checklists, workflows. Skills work in every chat, on local and cloud models.",
              "علّم عرّاب خبرات قابلة لإعادة الاستخدام — أساليب كتابة وقوائم مراجعة وسير عمل. تعمل المهارات في كل محادثة، على النماذج المحلية والسحابية.",
            )}
          </p>
        </div>
        <div className="st-head-aside">
          <button
            type="button"
            className="st-btn is-primary"
            onClick={() => setDialog({ kind: "editor", skill: null })}
          >
            <Plus size={14} strokeWidth={2} />
            {tx("New skill", "مهارة جديدة")}
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept=".md,.markdown,.txt,.json,.zip,.skill"
        onChange={(event) => onPicked(event.target.files, event.currentTarget)}
      />
      <input
        ref={folderRef}
        type="file"
        hidden
        multiple
        onChange={(event) => onPicked(event.target.files, event.currentTarget)}
      />

      <article className={cn("st-card sk-import", dragging && "is-dragging")}>
        <header className="st-card-head">
          <div>
            <h3>{tx("Add skills", "أضف مهارات")}</h3>
            <p>
              {tx(
                "Import SKILL.md folders, .zip bundles, Markdown, or an Arrab export. Drop files anywhere on this page.",
                "استورد مجلدات SKILL.md أو ملفات .zip أو Markdown أو ملف تصدير عرّاب. أسقط الملفات في أي مكان بهذه الصفحة.",
              )}
            </p>
          </div>
          {importing ? (
            <span className="st-badge">
              <Loader2 size={12} className="sk-spin" />
              &nbsp;{tx("Importing…", "جارٍ الاستيراد…")}
            </span>
          ) : null}
        </header>
        <div className="sk-import-grid">
          <ImportTile
            icon={Upload}
            title={tx("Upload files", "رفع ملفات")}
            body="SKILL.md · .zip · .json"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          />
          <ImportTile
            icon={FolderOpen}
            title={tx("Import folder", "استيراد مجلد")}
            body={tx("Finds every SKILL.md", "يجد كل ملفات SKILL.md")}
            disabled={importing}
            onClick={() => folderRef.current?.click()}
          />
          <ImportTile
            icon={Link2}
            title={tx("GitHub or URL", "GitHub أو رابط")}
            body={tx("Repo, folder, or file link", "رابط مستودع أو مجلد أو ملف")}
            disabled={importing}
            onClick={() => setDialog({ kind: "url" })}
          />
          <ImportTile
            icon={ClipboardPaste}
            title={tx("Paste", "لصق")}
            body={tx("SKILL.md or plain text", "SKILL.md أو نص عادي")}
            disabled={importing}
            onClick={() => setDialog({ kind: "paste" })}
          />
        </div>
        {dragging ? (
          <div className="sk-drop-hint">
            <Upload size={18} />
            {tx("Drop to import skills", "أفلت الملفات لاستيراد المهارات")}
          </div>
        ) : null}
      </article>

      <ClaudeCatalogCard ar={ar} installedSlugs={installedSlugs} onResult={reportImport} />

      <article className="st-card">
        <header className="st-card-head">
          <div>
            <h3>
              {tx("Your skills", "مهاراتك")}
              {skills.length ? <span className="sk-count">{skills.length}</span> : null}
            </h3>
            <p>
              {tx(
                "Always on: every message. Auto: loaded when relevant — cloud models decide from the description. Manual: pick it from + in chat or type /name.",
                "دائمًا: كل رسالة. تلقائي: تُحمّل عند الحاجة — النماذج السحابية تقرر من الوصف. يدوي: اخترها من + في المحادثة أو اكتب /الاسم.",
              )}
            </p>
          </div>
          {skills.length ? (
            <button
              type="button"
              className="st-btn is-sm"
              onClick={() =>
                downloadBlob(
                  new Blob([exportSkillsBundle(skills)], { type: "application/json" }),
                  "arrab-skills.json",
                )
              }
            >
              <Download size={13} />
              {tx("Export all", "تصدير الكل")}
            </button>
          ) : null}
        </header>

        {skills.length ? (
          <div className="sk-toolbar">
            <label className="sk-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx("Search skills", "ابحث في المهارات")}
                aria-label={tx("Search skills", "ابحث في المهارات")}
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label={tx("Clear", "مسح")}>
                  <X size={12} />
                </button>
              ) : null}
            </label>
            <div className="st-segmented sk-filter" role="tablist">
              {(
                [
                  ["all", tx("All", "الكل")],
                  ["always", tx("Always", "دائمًا")],
                  ["auto", tx("Auto", "تلقائي")],
                  ["manual", tx("Manual", "يدوي")],
                  ["off", tx("Off", "متوقفة")],
                ] as Array<[Filter, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  className={cn(filter === id && "is-active")}
                  onClick={() => setFilter(id)}
                >
                  {label}
                  {counts[id] ? <em>{counts[id]}</em> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="st-rows sk-list">
          {skills.length === 0 ? (
            <div className="sk-empty">
              <span className="sk-empty-icon">
                <Wand2 size={20} />
              </span>
              <strong>{tx("No skills yet", "لا توجد مهارات بعد")}</strong>
              <p>
                {tx(
                  "Create one, import a SKILL.md, or add a starter below.",
                  "أنشئ مهارة، أو استورد SKILL.md، أو أضف مهارة جاهزة من الأسفل.",
                )}
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="st-empty">{tx("No skills match.", "لا توجد مهارات مطابقة.")}</p>
          ) : (
            visible.map((skill) => {
              const armed = armedIds.includes(skill.id);
              const refsChars = skill.resources.reduce((sum, item) => sum + item.content.length, 0);
              return (
                <div key={skill.id} className={cn("sk-item", !skill.enabled && "is-off")}>
                  <button
                    type="button"
                    className="sk-item-main"
                    onClick={() => setDialog({ kind: "editor", skill })}
                  >
                    <span className="sk-item-icon">
                      <Wand2 size={16} />
                    </span>
                    <span className="sk-item-copy">
                      <span className="sk-item-title">
                        <strong>{skill.name}</strong>
                        <code>/{skill.slug}</code>
                      </span>
                      {skill.description ? (
                        <span className="sk-item-desc">{skill.description}</span>
                      ) : null}
                      <span className="sk-item-meta">
                        <span className={cn("sk-mode", `is-${skill.mode}`)}>{modeLabel(skill.mode)}</span>
                        {armed ? (
                          <span className="sk-mode is-armed">{tx("On in chat", "مفعّلة في المحادثة")}</span>
                        ) : null}
                        <span>{sourceLabel(skill)}</span>
                        {skillHasScripts(skill) ? (
                          <span className="sk-mode is-script">
                            <Terminal size={10} />
                            &nbsp;{tx("Scripts", "سكربتات")}
                          </span>
                        ) : null}
                        {skill.resources.length ? (
                          <span title={tx(`${refsChars.toLocaleString()} characters`, `${refsChars.toLocaleString()} حرف`)}>
                            {tx(
                              `${skill.resources.length} reference${skill.resources.length === 1 ? "" : "s"}`,
                              `${skill.resources.length} مرجع`,
                            )}
                          </span>
                        ) : null}
                        {skill.uses ? (
                          <span>{tx(`Used ${skill.uses}×`, `استُخدمت ${skill.uses} مرة`)}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <div className="sk-item-controls">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={skill.enabled}
                      aria-label={skill.enabled ? tx("Disable", "إيقاف") : tx("Enable", "تفعيل")}
                      className={cn("st-switch", skill.enabled && "is-on")}
                      onClick={() => safely(() => setSkillEnabled(skill.id, !skill.enabled))}
                    >
                      <span className="st-switch-knob" />
                    </button>
                    <div className="sk-menu-wrap">
                      <button
                        type="button"
                        className="sk-icon-btn"
                        aria-label={tx("More actions", "إجراءات أخرى")}
                        aria-expanded={menuId === skill.id}
                        onClick={() => setMenuId(menuId === skill.id ? null : skill.id)}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuId === skill.id ? (
                        <div className="sk-menu" role="menu">
                          <MenuItem
                            icon={MessageSquareText}
                            label={tx("Try in chat", "جرّبها في المحادثة")}
                            onClick={() => tryInChat(skill)}
                          />
                          {skill.mode !== "always" && skill.enabled ? (
                            <MenuItem
                              icon={armed ? X : Check}
                              label={armed ? tx("Turn off in chat", "إيقاف في المحادثة") : tx("Turn on in chat", "تفعيل في المحادثة")}
                              onClick={() => {
                                toggleArmedSkill(skill.id);
                                setMenuId(null);
                              }}
                            />
                          ) : null}
                          <MenuItem
                            icon={PenLine}
                            label={tx("Edit", "تعديل")}
                            onClick={() => {
                              setMenuId(null);
                              setDialog({ kind: "editor", skill });
                            }}
                          />
                          <MenuItem
                            icon={Copy}
                            label={tx("Duplicate", "نسخة مكررة")}
                            onClick={() => {
                              setMenuId(null);
                              safely(() => duplicateSkill(skill.id), tx("Skill duplicated", "تم نسخ المهارة"));
                            }}
                          />
                          <MenuItem
                            icon={BookOpen}
                            label={tx("Copy as SKILL.md", "نسخ كـ SKILL.md")}
                            onClick={() => {
                              setMenuId(null);
                              void copyText(exportSkillMarkdown(skill), tx("Copied SKILL.md", "تم نسخ SKILL.md"));
                            }}
                          />
                          <MenuItem
                            icon={Download}
                            label={tx("Download .md", "تنزيل .md")}
                            onClick={() => {
                              setMenuId(null);
                              downloadBlob(
                                new Blob([exportSkillMarkdown(skill)], { type: "text/markdown" }),
                                `${skill.slug || "skill"}.md`,
                              );
                            }}
                          />
                          <div className="sk-menu-sep" />
                          <MenuItem
                            icon={Trash2}
                            danger
                            label={
                              confirmDeleteId === skill.id
                                ? tx("Click again to delete", "اضغط مرة أخرى للحذف")
                                : tx("Delete", "حذف")
                            }
                            onClick={() => {
                              if (confirmDeleteId !== skill.id) {
                                setConfirmDeleteId(skill.id);
                                return;
                              }
                              setMenuId(null);
                              setConfirmDeleteId(null);
                              safely(() => deleteSkill(skill.id), tx("Skill deleted", "تم حذف المهارة"));
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </article>

      {skills.length ? <SkillTester ar={ar} /> : null}

      <article className="st-card">
        <header className="st-card-head">
          <div>
            <h3>{tx("Starter skills", "مهارات جاهزة")}</h3>
            <p>{tx("Add a ready-made skill in one click, then tailor it.", "أضف مهارة جاهزة بنقرة ثم خصّصها.")}</p>
          </div>
        </header>
        <div className="sk-starters">
          {STARTER_SKILLS.map((starter) => {
            const Icon = STARTER_ICONS[starter.icon] ?? Wand2;
            const added = installedSlugs.has(starter.slug ?? "");
            return (
              <div key={starter.slug} className="sk-starter">
                <span className="sk-item-icon">
                  <Icon size={16} />
                </span>
                <div className="sk-starter-copy">
                  <strong>{ar ? starter.nameAr : starter.name}</strong>
                  <p>{ar ? starter.descriptionAr : starter.description}</p>
                </div>
                <button
                  type="button"
                  className={cn("st-btn is-sm", added && "is-added")}
                  disabled={added}
                  onClick={() =>
                    safely(
                      () => addStarterSkill(starter, ar ? "ar" : "en"),
                      tx("Skill added", "تمت إضافة المهارة"),
                    )
                  }
                >
                  {added ? <Check size={13} /> : <Plus size={13} />}
                  {added ? tx("Added", "مضافة") : tx("Add", "إضافة")}
                </button>
              </div>
            );
          })}
        </div>
      </article>

      {dialog?.kind === "editor" ? (
        <SkillEditor
          skill={dialog.skill}
          ar={ar}
          onClose={() => setDialog(null)}
          onTry={(skill) => {
            setDialog(null);
            tryInChat(skill);
          }}
        />
      ) : null}
      {dialog?.kind === "url" ? (
        <UrlImportDialog ar={ar} onClose={() => setDialog(null)} onResult={reportImport} />
      ) : null}
      {dialog?.kind === "paste" ? (
        <PasteImportDialog ar={ar} onClose={() => setDialog(null)} onResult={reportImport} />
      ) : null}
    </section>
  );
}

function ClaudeCatalogCard({
  ar,
  installedSlugs,
  onResult,
}: {
  ar: boolean;
  installedSlugs: Set<string>;
  onResult: (result: SkillImportResult) => boolean;
}) {
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const [items, setItems] = useState<ClaudeCatalogSkill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const catalog = await fetchClaudeSkillCatalog(force);
      setItems(catalog.filter((item) => !VENDOR_BRANDED.test(`${item.slug} ${item.name} ${item.description}`)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load the catalog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const needle = query.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (item) => !needle || `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(needle),
  );
  const shown = expanded || needle ? filtered : filtered.slice(0, 6);

  const install = async (item: ClaudeCatalogSkill) => {
    setInstalling(item.slug);
    try {
      onResult(await installClaudeSkill(item));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <article className="st-card">
      <header className="st-card-head">
        <div>
          <h3>{tx("Skill library", "مكتبة المهارات")}</h3>
          <p>
            {tx(
              "Ready-made professional skills. Companions and chat use them automatically when needed — Install only if you want them listed under Your skills or need their scripts.",
              "مهارات احترافية جاهزة. يستخدمها المرافقون والمحادثة تلقائيًا عند الحاجة — ثبّتها فقط إذا أردتها في مهاراتك أو احتجت سكربتاتها.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="sk-icon-btn"
          aria-label={tx("Refresh", "تحديث")}
          title={tx("Refresh", "تحديث")}
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw size={14} className={cn(loading && "sk-spin")} />
        </button>
      </header>

      {items && items.length > 6 ? (
        <div className="sk-toolbar">
          <label className="sk-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tx("Search the library", "ابحث في المكتبة")}
              aria-label={tx("Search the library", "ابحث في المكتبة")}
            />
          </label>
          <span className="sk-toolbar-note">
            {tx(`${items.length} skills`, `${items.length} مهارة`)}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="sk-catalog-state">
          <p className="st-error">{error}</p>
          <button type="button" className="st-btn is-sm" onClick={() => void load(true)}>
            <RefreshCw size={13} />
            {tx("Try again", "أعد المحاولة")}
          </button>
        </div>
      ) : !items ? (
        <div className="sk-catalog-state">
          <Loader2 size={16} className="sk-spin" />
          <span>{tx("Loading skill library…", "جارٍ تحميل مكتبة المهارات…")}</span>
        </div>
      ) : (
        <>
          <div className="sk-starters">
            {shown.map((item) => {
              const added = installedSlugs.has(item.slug);
              const busy = installing === item.slug;
              return (
                <div key={item.path} className="sk-starter">
                  <span className="sk-item-icon">
                    <Sparkles size={16} />
                  </span>
                  <div className="sk-starter-copy">
                    <strong>{item.name}</strong>
                    <p className="sk-clamp">{item.description}</p>
                    <span className="sk-item-meta">
                      {item.files ? (
                        <span>
                          {tx(`${item.files} file${item.files === 1 ? "" : "s"}`, `${item.files} ملف`)}
                        </span>
                      ) : null}
                      {item.hasScripts ? (
                        <span className="sk-mode is-script">
                          <Terminal size={10} />
                          &nbsp;{tx("Scripts", "سكربتات")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={cn("st-btn is-sm", added && "is-added")}
                    disabled={Boolean(installing)}
                    onClick={() => void install(item)}
                    title={added ? tx("Reinstall latest version", "إعادة تثبيت أحدث نسخة") : undefined}
                  >
                    {busy ? (
                      <Loader2 size={13} className="sk-spin" />
                    ) : added ? (
                      <RefreshCw size={13} />
                    ) : (
                      <Download size={13} />
                    )}
                    {busy
                      ? tx("Installing", "جارٍ التثبيت")
                      : added
                        ? tx("Update", "تحديث")
                        : tx("Install", "تثبيت")}
                  </button>
                </div>
              );
            })}
          </div>
          {!needle && filtered.length > 6 ? (
            <button type="button" className="sk-more" onClick={() => setExpanded(!expanded)}>
              {expanded
                ? tx("Show fewer", "عرض أقل")
                : tx(`Show all ${filtered.length}`, `عرض الكل (${filtered.length})`)}
            </button>
          ) : null}
          {needle && filtered.length === 0 ? (
            <p className="st-empty">{tx("No library skills match.", "لا توجد مهارات مطابقة.")}</p>
          ) : null}
        </>
      )}
    </article>
  );
}

function SkillTester({ ar }: { ar: boolean }) {
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const skills = useSkills();
  const armed = useArmedSkillIds();
  const [text, setText] = useState("");
  const context = useMemo(
    () => (text.trim() ? buildSkillContext(text) : null),
    // Re-run when skills or active chat skills change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, skills, armed],
  );
  const reasonLabel = {
    invoked: tx("Typed /command", "أمر مكتوب"),
    armed: tx("On in chat", "مفعّلة في المحادثة"),
    always: tx("Always on", "دائمًا"),
    matched: tx("Matched your words", "طابقت كلماتك"),
  } as const;
  const autoCount = skills.filter((skill) => skill.enabled && skill.mode === "auto").length;

  return (
    <article className="st-card">
      <header className="st-card-head">
        <div>
          <h3>{tx("Test a message", "اختبر رسالة")}</h3>
          <p>
            {tx(
              "Type a message to see which skills Arrab will apply before you send it, and what they cost.",
              "اكتب رسالة لترى المهارات التي سيطبقها عرّاب قبل الإرسال وتكلفتها.",
            )}
          </p>
        </div>
      </header>
      <div className="sk-tester">
        <label className="sk-search sk-tester-input">
          <MessageSquareText size={14} />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={tx("e.g. Review this code for security bugs", "مثال: راجع هذا الكود بحثًا عن ثغرات")}
            aria-label={tx("Test message", "رسالة الاختبار")}
          />
        </label>
        {context ? (
          context.selections.length ? (
            <div className="sk-tester-results">
              {context.selections.map((selection) => {
                const sent = context.payload.find((item) => item.slug === selection.skill.slug);
                return (
                  <div key={selection.skill.id} className="sk-tester-row">
                    <Wand2 size={14} />
                    <strong>{selection.skill.name}</strong>
                    <span className={cn("sk-mode", `is-${selection.reason === "matched" ? "auto" : selection.reason}`)}>
                      {reasonLabel[selection.reason]}
                    </span>
                    <small>
                      {sent
                        ? `~${approxTokens(sent.instructions.length).toLocaleString()} ${tx("tokens", "رمز")}`
                        : tx("Over budget — skipped", "تجاوزت الحد — تم تخطيها")}
                    </small>
                  </div>
                );
              })}
              <p className="sk-hint">
                {tx(
                  `Total ≈ ${approxTokens(context.block.length).toLocaleString()} tokens added to this message.`,
                  `المجموع ≈ ${approxTokens(context.block.length).toLocaleString()} رمز يُضاف لهذه الرسالة.`,
                )}
              </p>
            </div>
          ) : (
            <p className="sk-hint sk-tester-empty">
              {autoCount
                ? tx(
                    `No skill is applied up front. On cloud models the assistant can still load any of your ${autoCount} Auto skills itself if it decides one is relevant.`,
                    `لا تُطبّق أي مهارة مسبقًا. على النماذج السحابية يمكن للمساعد تحميل أي من مهاراتك التلقائية (${autoCount}) إذا رأى أنها مناسبة.`,
                  )
                : tx("No skill would be applied to this message.", "لن تُطبّق أي مهارة على هذه الرسالة.")}
            </p>
          )
        ) : null}
      </div>
    </article>
  );
}

function ImportTile({
  icon: Icon,
  title,
  body,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="sk-tile" onClick={onClick} disabled={disabled}>
      <span className="sk-tile-icon">
        <Icon size={16} />
      </span>
      <span className="sk-tile-copy">
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
    </button>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className={cn(danger && "is-danger")} onClick={onClick}>
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  footer,
  children,
  wide,
  ar,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  wide?: boolean;
  ar: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="settings-shell st sk-overlay"
      dir={ar ? "rtl" : "ltr"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={cn("sk-dialog", wide && "is-wide")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sk-dialog-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="sk-icon-btn" onClick={onClose} aria-label={ar ? "إغلاق" : "Close"}>
            <X size={16} />
          </button>
        </header>
        <div className="sk-dialog-body">{children}</div>
        <footer className="sk-dialog-foot">{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

function SkillEditor({
  skill,
  ar,
  onClose,
  onTry,
}: {
  skill: UserSkill | null;
  ar: boolean;
  onClose: () => void;
  onTry: (skill: UserSkill) => void;
}) {
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const [name, setName] = useState(skill?.name ?? "");
  const [slug, setSlug] = useState(skill?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(skill));
  const [description, setDescription] = useState(skill?.description ?? "");
  const [mode, setMode] = useState<SkillMode>(skill?.mode ?? "auto");
  const [tags, setTags] = useState(skill?.tags.join(", ") ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [resources, setResources] = useState<SkillResource[]>(skill?.resources ?? []);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const installedPath = skill ? installedSkillPath(skill) : null;

  const effectiveSlug = slugTouched ? slugifySkill(slug) : slugifySkill(name);
  const refsChars = resources.reduce((sum, item) => sum + item.content.length, 0);

  const save = (andTry = false) => {
    setError(null);
    if (!name.trim()) return setError(tx("Give the skill a name.", "أدخل اسمًا للمهارة."));
    if (!instructions.trim()) {
      return setError(tx("Write the instructions the assistant should follow.", "اكتب التعليمات التي يجب أن يتبعها المساعد."));
    }
    const draft = {
      name: name.trim(),
      slug: effectiveSlug || undefined,
      description: description.trim(),
      mode,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      instructions,
      resources,
    };
    try {
      const saved = skill ? updateSkill(skill.id, draft) : createSkill({ ...draft, source: "created" });
      pushToast({
        title: skill ? tx("Skill saved", "تم حفظ المهارة") : tx("Skill created", "تم إنشاء المهارة"),
        body: `/${saved.slug}`,
        tone: "success",
      });
      if (andTry) onTry(saved);
      else onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tx("Couldn't save.", "تعذر الحفظ."));
    }
  };

  const addReferences = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    const next = [...resources];
    for (const file of files) {
      if (file.size > SKILL_LIMITS.importFileBytes) continue;
      const content = await file.text().catch(() => "");
      if (!content.trim()) continue;
      const path = file.webkitRelativePath || file.name;
      const existing = next.findIndex((item) => item.path === path);
      if (existing >= 0) next[existing] = { path, content };
      else next.push({ path, content });
    }
    setResources(next.slice(0, SKILL_LIMITS.resourcesPerSkill));
    if (refInput.current) refInput.current.value = "";
  };

  const modeHelp: Record<SkillMode, string> = {
    always: tx("Added to every message. Best for short, universal rules.", "تُضاف لكل رسالة. الأفضل للقواعد القصيرة العامة."),
    auto: tx(
      "Loaded when relevant. Cloud models decide from the description; local models match keywords.",
      "تُحمّل عند الحاجة. النماذج السحابية تقرر من الوصف، والمحلية تطابق الكلمات.",
    ),
    manual: tx("Only when you pick it from + in chat or type its /command.", "فقط عند اختيارها من + في المحادثة أو كتابة أمرها /."),
  };

  return (
    <Modal
      ar={ar}
      wide
      title={skill ? tx("Edit skill", "تعديل المهارة") : tx("New skill", "مهارة جديدة")}
      subtitle={tx(
        "Write it like a brief for a sharp colleague: when to use it, the steps, and the output format.",
        "اكتبها كموجز لزميل ذكي: متى تُستخدم، والخطوات، وشكل المخرجات.",
      )}
      onClose={onClose}
      footer={
        <>
          {skill ? (
            <button
              type="button"
              className="st-btn is-danger sk-foot-start"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                deleteSkill(skill.id);
                pushToast({ title: tx("Skill deleted", "تم حذف المهارة"), tone: "success" });
                onClose();
              }}
            >
              <Trash2 size={13} />
              {confirmDelete ? tx("Confirm delete", "تأكيد الحذف") : tx("Delete", "حذف")}
            </button>
          ) : null}
          <button type="button" className="st-btn" onClick={onClose}>
            {tx("Cancel", "إلغاء")}
          </button>
          <button type="button" className="st-btn" onClick={() => save(true)}>
            <MessageSquareText size={13} />
            {tx("Save & try", "حفظ وتجربة")}
          </button>
          <button type="button" className="st-btn is-primary" onClick={() => save(false)}>
            {skill ? tx("Save", "حفظ") : tx("Create skill", "إنشاء المهارة")}
          </button>
        </>
      }
    >
      <div
        className="sk-form"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save(false);
          }
        }}
      >
        <div className="sk-form-row">
          <label className="st-field">
            <span>{tx("Name", "الاسم")}</span>
            <input
              className="st-input"
              value={name}
              maxLength={SKILL_LIMITS.name}
              onChange={(event) => setName(event.target.value)}
              placeholder={tx("e.g. Brand voice", "مثال: نبرة العلامة التجارية")}
              autoFocus
            />
          </label>
          <label className="st-field">
            <span>{tx("Chat command", "أمر المحادثة")}</span>
            <span className="sk-slug">
              <em>/</em>
              <input
                className="st-input"
                value={slugTouched ? slug : effectiveSlug}
                maxLength={SKILL_LIMITS.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                placeholder="brand-voice"
                dir="ltr"
              />
            </span>
          </label>
        </div>

        <label className="st-field">
          <span>{tx("When to use it", "متى تُستخدم")}</span>
          <textarea
            className="st-input"
            rows={2}
            value={description}
            maxLength={SKILL_LIMITS.description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={tx(
              "e.g. Writing marketing copy, social posts, or product announcements.",
              "مثال: كتابة نصوص تسويقية أو منشورات أو إعلانات منتجات.",
            )}
          />
        </label>

        <div className="st-field">
          <span>{tx("Activation", "طريقة التفعيل")}</span>
          <div className="sk-mode-picker" role="radiogroup">
            {(["auto", "manual", "always"] as SkillMode[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={cn("sk-mode-option", mode === option && "is-active")}
                onClick={() => setMode(option)}
              >
                <strong>
                  {option === "always"
                    ? tx("Always on", "دائمًا")
                    : option === "auto"
                      ? tx("Auto", "تلقائي")
                      : tx("Manual", "يدوي")}
                </strong>
                <small>{modeHelp[option]}</small>
              </button>
            ))}
          </div>
        </div>

        <label className="st-field">
          <span>
            {tx("Instructions", "التعليمات")}
            <em className="sk-counter">
              {instructions.length.toLocaleString()} {tx("chars", "حرف")} · ~
              {approxTokens(instructions.length).toLocaleString()} {tx("tokens", "رمز")}
            </em>
          </span>
          <textarea
            className="st-input sk-instructions"
            rows={12}
            value={instructions}
            maxLength={SKILL_LIMITS.instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={tx(
              "# Goal\nWhat this skill achieves.\n\n# Steps\n1. …\n2. …\n\n# Output format\n- …",
              "# الهدف\nما الذي تحققه هذه المهارة.\n\n# الخطوات\n1. …\n2. …\n\n# شكل المخرجات\n- …",
            )}
            spellCheck={false}
          />
        </label>

        <label className="st-field">
          <span>{tx("Tags", "الوسوم")}</span>
          <input
            className="st-input"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={tx("writing, marketing, social", "كتابة، تسويق، منشورات")}
          />
        </label>

        <div className="st-field">
          <span>
            {tx("Reference files", "ملفات مرجعية")}
            <em className="sk-counter">
              {resources.length
                ? `${resources.length} · ~${approxTokens(refsChars).toLocaleString()} ${tx("tokens", "رمز")}`
                : tx("Optional", "اختياري")}
            </em>
          </span>
          <div className="sk-refs">
            {resources.map((resource) => {
              const script = /\.(py|sh|bash|zsh|js|cjs|mjs|ts|rb)$/i.test(resource.path);
              const open = openRef === resource.path;
              return (
                <div key={resource.path} className={cn("sk-ref-wrap", open && "is-open")}>
                  <div className="sk-ref">
                    <button
                      type="button"
                      className="sk-ref-toggle"
                      aria-expanded={open}
                      onClick={() => setOpenRef(open ? null : resource.path)}
                    >
                      {script ? <Terminal size={13} /> : <FileText size={13} />}
                      <span dir="ltr">{resource.path}</span>
                      {script ? <em className="sk-mode is-script">{tx("script", "سكربت")}</em> : null}
                      <small>{Math.max(1, Math.ceil(resource.content.length / 1000))}k</small>
                    </button>
                    <button
                      type="button"
                      className="sk-icon-btn"
                      aria-label={tx("Remove", "إزالة")}
                      onClick={() => setResources(resources.filter((item) => item.path !== resource.path))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {open ? (
                    <pre className="sk-ref-preview" dir="ltr">
                      {resource.content.slice(0, 20_000)}
                      {resource.content.length > 20_000 ? "\n…" : ""}
                    </pre>
                  ) : null}
                </div>
              );
            })}
            <button type="button" className="st-btn is-sm sk-ref-add" onClick={() => refInput.current?.click()}>
              <Plus size={13} />
              {tx("Add reference", "إضافة مرجع")}
            </button>
            <p className="sk-hint">
              {tx(
                "Cloud models open these files on demand. Local models get them when you turn the skill on or type its /command.",
                "النماذج السحابية تفتح هذه الملفات عند الحاجة. والنماذج المحلية تحصل عليها عند تفعيل المهارة أو كتابة أمرها.",
              )}
            </p>
            {installedPath ? (
              <p className="sk-hint sk-installed" dir="ltr">
                <Terminal size={12} />
                <span>{installedPath}</span>
              </p>
            ) : null}
          </div>
          <input
            ref={refInput}
            type="file"
            hidden
            multiple
            accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.py,.js,.ts,.sh,.html,.css,.sql"
            onChange={(event) => void addReferences(event.target.files)}
          />
        </div>

        {error ? <p className="st-error">{error}</p> : null}
      </div>
    </Modal>
  );
}

function UrlImportDialog({
  ar,
  onClose,
  onResult,
}: {
  ar: boolean;
  onClose: () => void;
  onResult: (result: SkillImportResult) => boolean;
}) {
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await importSkillsFromUrl(url);
    setBusy(false);
    if (result.added.length + result.updated.length > 0) {
      onResult(result);
      onClose();
    } else {
      setError(result.errors[0] ?? tx("No skills found.", "لم يتم العثور على مهارات."));
    }
  };

  return (
    <Modal
      ar={ar}
      title={tx("Import from GitHub or URL", "استيراد من GitHub أو رابط")}
      subtitle={tx(
        "Paste a public GitHub repo, folder, or SKILL.md link — or any direct .md, .json, or .zip link.",
        "الصق رابط مستودع GitHub عام أو مجلد أو ملف SKILL.md — أو أي رابط مباشر لملف .md أو .json أو .zip.",
      )}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="st-btn" onClick={onClose}>
            {tx("Cancel", "إلغاء")}
          </button>
          <button type="button" className="st-btn is-primary" disabled={!url.trim() || busy} onClick={() => void run()}>
            {busy ? <Loader2 size={13} className="sk-spin" /> : <Download size={13} />}
            {busy ? tx("Importing…", "جارٍ الاستيراد…") : tx("Import", "استيراد")}
          </button>
        </>
      }
    >
      <div className="sk-form">
        <label className="st-field">
          <span>{tx("Link", "الرابط")}</span>
          <input
            className="st-input"
            dir="ltr"
            value={url}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run();
            }}
            placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
          />
        </label>
        <ul className="sk-examples">
          <li>github.com/owner/repo — {tx("every SKILL.md in the repo", "كل ملفات SKILL.md في المستودع")}</li>
          <li>github.com/owner/repo/tree/main/skills/x — {tx("one folder", "مجلد واحد")}</li>
          <li>…/blob/main/skills/x/SKILL.md — {tx("one skill with its references", "مهارة واحدة مع مراجعها")}</li>
        </ul>
        {error ? <p className="st-error">{error}</p> : null}
      </div>
    </Modal>
  );
}

function PasteImportDialog({
  ar,
  onClose,
  onResult,
}: {
  ar: boolean;
  onClose: () => void;
  onResult: (result: SkillImportResult) => boolean;
}) {
  const tx = (en: string, arText: string) => (ar ? arText : en);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    try {
      const result = importSkillText(text);
      if (result.added.length + result.updated.length > 0) {
        onResult(result);
        onClose();
      } else {
        setError(result.errors[0] ?? tx("Nothing to import.", "لا يوجد ما يُستورد."));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tx("Import failed.", "فشل الاستيراد."));
    }
  };

  return (
    <Modal
      ar={ar}
      wide
      title={tx("Paste a skill", "الصق مهارة")}
      subtitle={tx(
        "Paste a SKILL.md (with --- name / description --- frontmatter), plain instructions, or an Arrab skills JSON export.",
        "الصق ملف SKILL.md (مع ترويسة name / description) أو تعليمات عادية أو ملف تصدير مهارات عرّاب.",
      )}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="st-btn" onClick={onClose}>
            {tx("Cancel", "إلغاء")}
          </button>
          <button type="button" className="st-btn is-primary" disabled={!text.trim()} onClick={run}>
            {tx("Import", "استيراد")}
          </button>
        </>
      }
    >
      <div className="sk-form">
        <textarea
          className="st-input sk-instructions"
          rows={14}
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          placeholder={"---\nname: brand-voice\ndescription: Use when writing marketing copy.\n---\n\n# Brand voice\n1. …"}
        />
        {error ? <p className="st-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
