import { useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import type { OrgSeatCapabilities } from "@/domains/organization/org-seat";
import { pushToast } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { Empty, Stat } from "./primitives";
import { relativeAge, type WorkforceData } from "./use-workforce-data";

const ALLOWED = /\.(txt|md|markdown|csv|json|html|htm|log)$/i;

export function WorkforceKnowledge({
  data,
  caps,
  onNew,
}: {
  data: WorkforceData;
  caps: OrgSeatCapabilities;
  onNew: () => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canEdit = caps.canAssignWork;

  const docs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...data.knowledge].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return list;
    return list.filter((doc) => `${doc.title} ${doc.content}`.toLowerCase().includes(q));
  }, [data.knowledge, query]);

  const orgWide = data.knowledge.filter((doc) => !doc.projectId).length;
  const words = data.knowledge.reduce((sum, doc) => sum + doc.content.split(/\s+/).filter(Boolean).length, 0);
  const projectName = (id: string | null) => data.projects.find((project) => project.id === id)?.name ?? null;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let saved = 0;
    for (const file of Array.from(files)) {
      if (!ALLOWED.test(file.name)) {
        pushToast({ title: t("hqKnowUploadType"), tone: "warn" });
        continue;
      }
      if (file.size > 400_000) {
        pushToast({ title: t("hqKnowUploadSize"), tone: "warn" });
        continue;
      }
      const text = (await file.text()).trim();
      if (text.length < 8) {
        pushToast({ title: t("hqKnowUploadEmpty"), tone: "warn" });
        continue;
      }
      const title = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || file.name;
      if (await data.createKnowledge(title, text.slice(0, 100_000), null)) saved += 1;
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (saved > 0) pushToast({ title: t("hqKnowUploaded").replace("{n}", String(saved)), tone: "success" });
  }

  return (
    <div className="cc-wrap">
      <div className="cc-stats cc-rise">
        <Stat label={t("wxKnowDocs")} value={data.knowledge.length} foot={t("wxKnowDocsFoot")} />
        <Stat label={t("wxKnowOrgWide")} value={orgWide} foot={t("wxKnowOrgWideFoot")} />
        <Stat label={t("wxKnowWords")} value={words.toLocaleString()} foot={t("wxKnowWordsFoot")} />
      </div>

      <div className="cc-rise flex flex-wrap items-center gap-2">
        <div className="cc-search w-full sm:w-[320px]">
          <Search />
          <input className="cc-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("wxSearchKnowledge")} />
        </div>
        {canEdit ? (
          <div className="ms-auto flex gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.log"
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <button type="button" className="cc-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" strokeWidth={1.8} />}
              {t("wxUpload")}
            </button>
            <button type="button" className="cc-btn is-primary" onClick={onNew}>
              <Plus className="size-3.5" strokeWidth={2} />
              {t("wxNewDoc")}
            </button>
          </div>
        ) : null}
      </div>

      {docs.length === 0 ? (
        <div className="cc-card cc-rise">
          <Empty
            icon={BookOpen}
            title={query ? t("wxNoMatches") : t("wxNoKnowledge")}
            body={query ? undefined : t("wxNoKnowledgeBody")}
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {docs.map((doc) => {
            const open = expanded === doc.id;
            const scope = projectName(doc.projectId);
            return (
              <article key={doc.id} className={cn("cc-card cc-rise !p-4", open && "md:col-span-2")}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setExpanded(open ? null : doc.id)}>
                    <p className="truncate text-[13.5px] font-semibold">{doc.title}</p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
                      <span className="cc-chip">{scope ?? t("wxScopeOrg")}</span>
                      {relativeAge(doc.updatedAt, t)}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      className="cc-icon-btn"
                      onClick={() => setExpanded(open ? null : doc.id)}
                      aria-label={t("wxExpand")}
                    >
                      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} strokeWidth={1.7} />
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="cc-icon-btn hover:!text-[var(--color-danger)]"
                        onClick={() => {
                          if (window.confirm(t("wxDeleteDocConfirm"))) void data.deleteKnowledge(doc.id);
                        }}
                        aria-label={t("wxDelete")}
                        title={t("wxDelete")}
                      >
                        <Trash2 className="size-[15px]" strokeWidth={1.7} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <p
                  className={cn(
                    "mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-muted)]",
                    open ? "max-h-[420px] overflow-y-auto" : "line-clamp-3",
                  )}
                >
                  {doc.content}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
