import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  Github,
  ImageUp,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Server,
  Smartphone,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import type { ConnectorPublic } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import { useCompanionRoom } from "@/components/companions/useCompanionRoom";
import { companionPortraitUrl } from "@/lib/companion-portrait";
import { fileToAvatarDataUrl } from "@/lib/avatar-image";
import { arrabApi } from "@/lib/api";
import { useRole } from "@/roles/RoleProvider";
import {
  addCompanion,
  archiveStudioCatalogEntry,
  getCompanionState,
  liveCompanions,
  saveStudioCatalog,
  setCompanionAvatar,
  syncCompanionPurpose,
  updateCompanion,
  useCompanionState,
  type CompanionProfile,
  type StudioCatalogEntry,
} from "@/lib/companions";
import { useSignedInAccount } from "@/lib/use-signed-in-account";
import { useFamilyProfile } from "@/lib/use-family-profile";
import {
  blankStudioEntry,
  buildFileTree,
  buildPreviewHtml,
  buildProjectZip,
  claimStudioAdmin,
  ensureStudioAdminClaim,
  downloadBlob,
  entryFromPurpose,
  filesFromDesignerReply,
  isStudioAdmin,
  localDesignFromPrompt,
  readStudioActive,
  readStudioProject,
  resolveStudioCatalog,
  resolveStudioPurposes,
  stripCodeForChat,
  studioKindById,
  writeStudioActive,
  writeStudioProject,
  type StudioFile,
  type StudioTreeNode,
} from "@/lib/studio-catalog";
import type { StudioPurposeDef } from "@/lib/companions";
import { purposeRegistryById } from "@/lib/purpose-registry";
import {
  phonePresetById,
  phonePreviewQrUrl,
  phoneSizeGroups,
  readPhoneSizeId,
  rotatePhonePreset,
  writePhoneSizeId,
  type PhoneSizePreset,
} from "@/lib/studio-phone";
import { startPhonePreview, type PhonePreviewSession } from "@/lib/desktop";
import { ARRAB_ASSISTANT_CONNECTORS } from "@/lib/connector-catalog";
import { ArrabAssistantWorkspace } from "@/components/studio/ArrabAssistantWorkspace";
import { ComposerPlusMenu } from "@/components/ComposerPlusMenu";
import { cn } from "@/lib/utils";
import { pushToast } from "@/lib/notify";
import { copyChatText } from "@/components/ChatMarkdown";
import {
  WORKPLACE_DEFAULT_KIND,
  WORKPLACE_OPEN_KIND_KEY,
} from "@/lib/workplace-handoff";

function mergeFiles(base: StudioFile[], next: StudioFile[]): StudioFile[] {
  const map = new Map(base.map((file) => [file.path, file]));
  for (const file of next) map.set(file.path, file);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function isDesignAsk(text: string) {
  return /design|website|web|site|page|ui|layout|landing|screen|mobile|phone|app|صم[مّ]|موقع|واجهة|شاشة|جوال/i.test(
    text,
  );
}

function StudioPortrait({
  entry,
  size = 56,
}: {
  entry: Pick<StudioCatalogEntry, "name" | "hue" | "faceSeed" | "avatarPhoto"> & {
    domain?: string;
  };
  size?: number;
}) {
  const faceSize = size >= 64 ? "xl" : size >= 48 ? "lg" : "md";
  const src =
    entry.avatarPhoto?.trim() ||
    companionPortraitUrl({
      seed: entry.faceSeed,
      name: entry.name,
      domain: entry.domain,
      size: size >= 64 ? 320 : 256,
    });
  return (
    <PhotoAvatar
      src={src}
      name={entry.name}
      size={faceSize}
      fallbackHue={entry.hue}
      fallbackSeed={entry.faceSeed}
    />
  );
}

/** Click the face (or button) to upload / replace a companion photo. */
function StudioPhotoPicker({
  entry,
  size = 76,
  onChange,
  error,
  compact = false,
}: {
  entry: Pick<StudioCatalogEntry, "name" | "hue" | "faceSeed" | "avatarPhoto">;
  size?: number;
  onChange: (photo: string | null) => void;
  error?: string | null;
  /** Face-only control for catalog cards. */
  compact?: boolean;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const fileRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = error ?? localError;

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    setLocalError(null);
    try {
      onChange(await fileToAvatarDataUrl(file, 320));
    } catch {
      setLocalError(ar ? "تعذر قراءة الصورة." : "Could not read that image.");
    }
  };

  const hit = (
    <button
      type="button"
      className="st-photo-hit"
      onClick={() => fileRef.current?.click()}
      aria-label={entry.avatarPhoto ? t("studioChangePhoto") : t("studioUploadPhoto")}
      title={entry.avatarPhoto ? t("studioChangePhoto") : t("studioUploadPhoto")}
    >
      <StudioPortrait entry={entry} size={size} />
      <span className="st-photo-hit-badge">
        <ImageUp size={compact ? 12 : 14} />
      </span>
    </button>
  );

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.heic"
      hidden
      onChange={(event) => {
        void onPickPhoto(event.target.files?.[0] ?? null);
        event.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <div className="st-photo-compact">
        {hit}
        {input}
        {shownError ? <p className="st-chat-error">{shownError}</p> : null}
      </div>
    );
  }

  return (
    <div className="st-admin-photo">
      {hit}
      <div>
        <button type="button" className="cp-button" onClick={() => fileRef.current?.click()}>
          <ImageUp size={14} />
          {entry.avatarPhoto ? t("studioChangePhoto") : t("studioUploadPhoto")}
        </button>
        {entry.avatarPhoto ? (
          <button type="button" className="cp-button st-ghost" onClick={() => onChange(null)}>
            {t("studioClearPhoto")}
          </button>
        ) : null}
        {input}
        {shownError ? <p className="st-chat-error">{shownError}</p> : null}
      </div>
    </div>
  );
}

function updateCatalogPhoto(id: string, avatarPhoto: string | null): void {
  const existing = resolveStudioCatalog();
  const merged = existing.map((item) => (item.id === id ? { ...item, avatarPhoto } : item));
  // If still on defaults (unpublished), publish the updated list so the photo syncs.
  saveStudioCatalog(merged);
}

function TreeRows({
  nodes,
  depth,
  activePath,
  openFolders,
  onToggleFolder,
  onOpenFile,
}: {
  nodes: StudioTreeNode[];
  depth: number;
  activePath: string | null;
  openFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const open = openFolders.has(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                className="st-tree-row"
                style={{ paddingInlineStart: 8 + depth * 12 }}
                onClick={() => onToggleFolder(node.path)}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {open ? <FolderOpen size={13} /> : <Folder size={13} />}
                <span>{node.name}</span>
              </button>
              {open && node.children?.length ? (
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  activePath={activePath}
                  openFolders={openFolders}
                  onToggleFolder={onToggleFolder}
                  onOpenFile={onOpenFile}
                />
              ) : null}
            </div>
          );
        }
        return (
          <button
            key={node.path}
            type="button"
            className={cn("st-tree-row", activePath === node.path && "is-on")}
            style={{ paddingInlineStart: 8 + depth * 12 }}
            onClick={() => onOpenFile(node.path)}
          >
            <span className="st-tree-spacer" />
            <FileCode2 size={13} />
            <span>{node.name}</span>
          </button>
        );
      })}
    </>
  );
}

function DeployDialog({
  files,
  mode,
  onClose,
}: {
  files: StudioFile[];
  mode: "github" | "ssh";
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [connectorId, setConnectorId] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [message, setMessage] = useState("Update from Arrab Studio");
  const [remoteDir, setRemoteDir] = useState("~/arrab-studio-site");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [donePath, setDonePath] = useState<string | null>(null);

  useEffect(() => {
    void arrabApi
      .connectors()
      .then((res) => {
        const list = res.items.filter(
          (item) =>
            item.status === "connected" &&
            (mode === "github" ? item.provider === "github" : item.provider === "ssh"),
        );
        setConnectors(list);
        if (list[0]) setConnectorId(list[0].id);
      })
      .catch(() =>
        setError(
          mode === "github"
            ? ar
              ? "تعذر تحميل موصلات GitHub."
              : "Could not load GitHub connectors."
            : ar
              ? "تعذر تحميل موصلات SSH."
              : "Could not load SSH connectors.",
        ),
      );
  }, [ar, mode]);

  const pushGithub = async () => {
    const [owner, name] = repo.trim().split("/");
    if (!connectorId || !owner || !name) {
      setError(ar ? "أدخل المستودع بالشكل owner/repo." : "Enter the repo as owner/repo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await arrabApi.githubCommit(owner, name, {
        connectorId,
        message: message.trim() || "Update from Arrab Studio",
        branch: branch.trim() || undefined,
        files: files
          .filter((file) => !(file.path.endsWith(".gitkeep") && !file.content))
          .map((file) => ({
            path: file.path,
            content: file.content.startsWith("data:") ? file.content : file.content,
          })),
      });
      if (result.approval) setError(t("gitAwaitingApproval"));
      else setDoneUrl(result.url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  const pushSsh = async () => {
    if (!connectorId) {
      setError(ar ? "اختر موصل SSH." : "Choose an SSH connector.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(ar ? "جاري الرفع…" : "Deploying…");
    try {
      const { deployFilesOverSsh } = await import("@/lib/studio-deploy");
      const result = await deployFilesOverSsh({
        connectorId,
        files,
        remoteDir,
        onProgress: setProgress,
      });
      if (!result.ok) setError(result.error);
      else setDonePath(result.remoteDir);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("apiUnavailable"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="st-picker-backdrop" onClick={onClose}>
      <div className="st-picker st-export-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{mode === "github" ? t("studioPushGithub") : t("studioDeploySsh")}</h2>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("close")}>
            <X size={16} />
          </button>
        </header>
        {connectors.length === 0 ? (
          <p className="cp-muted">
            {mode === "github" ? t("studioGithubNeeded") : t("studioSshNeeded")}
          </p>
        ) : (
          <div className="st-form">
            <label>
              <span>
                {mode === "github" ? t("studioGithubConnector") : t("studioSshConnector")}
              </span>
              <select value={connectorId} onChange={(event) => setConnectorId(event.target.value)}>
                {connectors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.accountLabel || item.provider}
                  </option>
                ))}
              </select>
            </label>
            {mode === "github" ? (
              <>
                <label>
                  <span>{t("studioGithubRepo")}</span>
                  <input
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    placeholder="owner/repo"
                  />
                </label>
                <label>
                  <span>{t("studioGithubBranch")}</span>
                  <input value={branch} onChange={(event) => setBranch(event.target.value)} />
                </label>
                <label>
                  <span>{t("studioGithubMessage")}</span>
                  <input value={message} onChange={(event) => setMessage(event.target.value)} />
                </label>
              </>
            ) : (
              <label>
                <span>{t("studioSshRemoteDir")}</span>
                <input
                  value={remoteDir}
                  onChange={(event) => setRemoteDir(event.target.value)}
                  placeholder="~/arrab-studio-site"
                />
              </label>
            )}
            {progress ? <p className="cp-muted">{progress}</p> : null}
            {error ? <p className="st-chat-error">{error}</p> : null}
            {doneUrl ? (
              <a className="st-link" href={doneUrl} target="_blank" rel="noreferrer">
                {t("studioGithubDone")}
              </a>
            ) : null}
            {donePath ? (
              <p className="st-link">
                {t("studioSshDone")}: {donePath}
              </p>
            ) : null}
            <button
              type="button"
              className="cp-button"
              disabled={busy}
              onClick={() => void (mode === "github" ? pushGithub() : pushSsh())}
            >
              {mode === "github" ? <Github size={14} /> : <Server size={14} />}
              {busy
                ? t("studioPushing")
                : mode === "github"
                  ? t("studioPushGithub")
                  : t("studioDeploySsh")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddCompanionPanel({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string | null;
  onClose: () => void;
  onSaved: (entry: StudioCatalogEntry) => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const purposes = resolveStudioPurposes();
  const [step, setStep] = useState<"purpose" | "details">("purpose");
  const [purpose, setPurpose] = useState<StudioPurposeDef | null>(null);
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);

  const pickPurpose = (next: StudioPurposeDef) => {
    setPurpose(next);
    setBlurb(ar ? next.blurbAr : next.blurb);
    setName("");
    setStep("details");
  };

  const save = () => {
    if (!purpose || !name.trim()) return;
    if (accountId) claimStudioAdmin(accountId);
    const entry = entryFromPurpose(purpose, {
      name,
      blurb: blurb || (ar ? purpose.blurbAr : purpose.blurb),
      avatarPhoto,
      createdBy: accountId,
    });
    const existing = resolveStudioCatalog();
    saveStudioCatalog([...existing, entry]);
    onSaved(entry);
    onClose();
  };

  const previewEntry: StudioCatalogEntry = purpose
    ? entryFromPurpose(purpose, { name: name || (ar ? purpose.nameAr : purpose.name), avatarPhoto })
    : blankStudioEntry();

  return (
    <div className="st-picker-backdrop" onClick={onClose}>
      <div className="st-picker st-add-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="cp-eyebrow">{t("studioAddEyebrow")}</p>
            <h2>{step === "purpose" ? t("studioPickPurpose") : t("studioAddCompanion")}</h2>
          </div>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("close")}>
            <X size={16} />
          </button>
        </header>

        {step === "purpose" ? (
          <>
            <p className="st-add-lead">{t("studioPickPurposeHint")}</p>
            <div className="st-purpose-grid">
              {purposes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="st-purpose-card"
                  onClick={() => pickPurpose(item)}
                >
                  <span
                    className="st-purpose-swatch"
                    style={{ background: `hsl(${item.hue} 42% 42%)` }}
                    aria-hidden="true"
                  />
                  <strong>{ar ? item.nameAr : item.name}</strong>
                  <p>{ar ? item.blurbAr : item.blurb}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="st-add-details">
            <button type="button" className="st-back-purpose" onClick={() => setStep("purpose")}>
              <ArrowLeft size={14} />
              {t("studioChangePurpose")}
              {purpose ? ` · ${ar ? purpose.nameAr : purpose.name}` : ""}
            </button>
            <StudioPhotoPicker
              entry={previewEntry}
              onChange={setAvatarPhoto}
            />
            <div className="st-form">
              <label>
                <span>{t("studioFieldName")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={
                    purpose
                      ? ar
                        ? `مثال: ${purpose.nameAr}`
                        : `e.g. ${purpose.name}`
                      : ""
                  }
                />
              </label>
              <label>
                <span>{t("studioFieldBlurb")}</span>
                <input value={blurb} onChange={(event) => setBlurb(event.target.value)} />
              </label>
              <p className="st-add-note">{t("studioAddSyncNote")}</p>
              <div className="st-form-actions">
                <button type="button" className="cp-button" disabled={!name.trim()} onClick={save}>
                  <Plus size={14} />
                  {t("studioCreateCompanion")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminEditPanel({
  initial,
  accountId,
  onClose,
}: {
  initial: StudioCatalogEntry;
  accountId: string | null;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const purposes = resolveStudioPurposes();
  const [draft, setDraft] = useState<StudioCatalogEntry>(initial);

  const save = () => {
    if (!draft.name.trim() || !accountId) return;
    claimStudioAdmin(accountId);
    const entry: StudioCatalogEntry = {
      ...draft,
      name: draft.name.trim(),
      nameAr: draft.nameAr.trim() || draft.name.trim(),
      blurb: draft.blurb.trim(),
      blurbAr: draft.blurbAr.trim() || draft.blurb.trim(),
      brief: draft.brief.trim(),
      briefAr: draft.briefAr.trim() || draft.brief.trim(),
      purposeId: draft.purposeId || "web-design",
      archivedAt: null,
    };
    const existing = resolveStudioCatalog();
    const merged = existing.some((item) => item.id === entry.id)
      ? existing.map((item) => (item.id === entry.id ? entry : item))
      : [...existing, entry];
    saveStudioCatalog(merged);
    onClose();
  };

  return (
    <div className="st-picker-backdrop" onClick={onClose}>
      <div className="st-picker st-admin-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{t("studioEditCompanion")}</h2>
          <button type="button" className="cp-icon" onClick={onClose} aria-label={t("close")}>
            <X size={16} />
          </button>
        </header>
        <StudioPhotoPicker
          entry={draft}
          onChange={(photo) => setDraft((current) => ({ ...current, avatarPhoto: photo }))}
        />
        <div className="st-form">
          <label>
            <span>{t("studioFieldPurpose")}</span>
            <select
              value={draft.purposeId}
              onChange={(event) => {
                const purpose = purposes.find((item) => item.id === event.target.value);
                setDraft((c) => ({
                  ...c,
                  purposeId: event.target.value,
                  workspace: purpose?.workspace ?? c.workspace,
                  brief: purpose?.brief ?? c.brief,
                  briefAr: purpose?.briefAr ?? c.briefAr,
                  hue: purpose?.hue ?? c.hue,
                }));
              }}
            >
              {purposes.map((item) => (
                <option key={item.id} value={item.id}>
                  {ar ? item.nameAr : item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("studioFieldName")}</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
            />
          </label>
          <label>
            <span>{t("studioFieldNameAr")}</span>
            <input
              value={draft.nameAr}
              onChange={(event) => setDraft((c) => ({ ...c, nameAr: event.target.value }))}
            />
          </label>
          <label>
            <span>{t("studioFieldBlurb")}</span>
            <input
              value={draft.blurb}
              onChange={(event) => setDraft((c) => ({ ...c, blurb: event.target.value }))}
            />
          </label>
          <label>
            <span>{t("studioFieldBrief")}</span>
            <textarea
              rows={3}
              value={draft.brief}
              onChange={(event) => setDraft((c) => ({ ...c, brief: event.target.value }))}
            />
          </label>
          <div className="st-form-actions">
            <button type="button" className="cp-button" onClick={save}>
              {t("studioSaveCompanion")}
            </button>
            <button
              type="button"
              className="cp-button st-ghost"
              onClick={() => {
                if (accountId) claimStudioAdmin(accountId);
                const next = resolveStudioCatalog()
                  .filter((item) => item.id !== initial.id)
                  .map((item) => ({ ...item }));
                if (next.length === 0) {
                  archiveStudioCatalogEntry(initial.id);
                  saveStudioCatalog([{ ...initial, archivedAt: new Date().toISOString() }]);
                } else {
                  saveStudioCatalog(next);
                }
                onClose();
              }}
            >
              {t("studioArchiveCompanion")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneStage({
  preset,
  html,
  caption,
  empty,
  emptyTitle,
  emptyHint,
}: {
  preset: PhoneSizePreset;
  html: string;
  caption: string;
  empty: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const padX = 56;
      const padY = 72;
      const availW = Math.max(140, el.clientWidth - padX);
      const availH = Math.max(160, el.clientHeight - padY);
      const frameW = preset.width + 8;
      const frameH = preset.height + 8;
      setScale(Math.min(1, availW / frameW, availH / frameH));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preset.width, preset.height]);

  return (
    <div className="st-phone-stage" ref={stageRef}>
      <div
        className="st-phone-scale"
        style={{
          width: (preset.width + 8) * scale,
          height: (preset.height + 8) * scale,
        }}
      >
        <div
          className={cn("st-phone-frame", `chrome-${preset.chrome}`, empty && "is-empty")}
          style={{
            width: preset.width,
            height: preset.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="st-phone-bezel" aria-hidden="true" />
          <div className="st-phone-chrome" aria-hidden="true" />
          <div className="st-phone-home" aria-hidden="true" />
          {empty ? (
            <div className="st-phone-empty">
              <Sparkles size={22} />
              <strong>{emptyTitle}</strong>
              <p>{emptyHint}</p>
            </div>
          ) : (
            <iframe
              title="Phone preview"
              className="st-preview-frame st-phone-screen"
              sandbox="allow-scripts"
              srcDoc={html}
            />
          )}
        </div>
      </div>
      <p className="st-phone-caption">
        {caption}
        <span className="st-phone-scale-badge">{Math.round(scale * 100)}%</span>
      </p>
    </div>
  );
}

function UiDesignerWorkspace({
  companion,
  kind,
}: {
  companion: CompanionProfile;
  kind: StudioCatalogEntry;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const isPhone = kind.purposeId === "phone-design";
  const isWeb = kind.purposeId === "web-design" || (!isPhone && kind.workspace === "ui-designer");
  const room = useCompanionRoom(companion);
  const [files, setFiles] = useState<StudioFile[]>(() => readStudioProject(companion.id));
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(["assets", "src", "components"]));
  const [surface, setSurface] = useState<"preview" | "code">("preview");
  const [exportOpen, setExportOpen] = useState(false);
  const [deployMode, setDeployMode] = useState<"github" | "ssh" | null>(null);
  const [chatFull, setChatFull] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [phoneSizeId, setPhoneSizeId] = useState(readPhoneSizeId);
  const [phoneConnect, setPhoneConnect] = useState<PhonePreviewSession | null>(null);
  const [phoneConnectBusy, setPhoneConnectBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const lastApplied = useRef<string>("");
  const pendingPrompt = useRef<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const codeUploadRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildFileTree(files), [files]);
  const previewHtml = useMemo(() => buildPreviewHtml(files), [files]);
  const activeFile = files.find((file) => file.path === activePath) ?? null;
  const phoneSize = phonePresetById(phoneSizeId);
  const phoneGroups = useMemo(() => phoneSizeGroups(ar), [ar]);
  const hasFiles = files.length > 0;

  useEffect(() => {
    writeStudioProject(companion.id, files);
  }, [companion.id, files]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.lines.length, room.busy]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportOpen]);

  const applyFiles = (harvested: StudioFile[]) => {
    if (!harvested.length) return;
    setFiles((prev) => mergeFiles(prev, harvested));
    setOpenTabs((tabs) => {
      const next = [...tabs];
      for (const file of harvested) {
        if (!next.includes(file.path) && !file.path.endsWith(".gitkeep")) next.push(file.path);
      }
      return next;
    });
    const first = harvested.find((file) => !file.path.endsWith(".gitkeep"))?.path;
    if (first) setActivePath(first);
  };

  useEffect(() => {
    if (room.busy) return;
    const last = [...room.lines].reverse().find((line) => line.who === "companion");
    const prompt = pendingPrompt.current;
    if (last && last.text !== lastApplied.current) {
      const harvested = filesFromDesignerReply(last.text);
      if (harvested.length) {
        lastApplied.current = last.text;
        pendingPrompt.current = null;
        applyFiles(harvested);
        return;
      }
    }
    if (prompt) {
      pendingPrompt.current = null;
      lastApplied.current = last?.text ?? prompt;
      applyFiles(localDesignFromPrompt(prompt));
    }
  }, [room.busy, room.lines]);

  const openFile = (path: string) => {
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
    setActivePath(path);
    setSurface("code");
  };

  const closeTab = (path: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== path);
      if (activePath === path) setActivePath(next[next.length - 1] ?? null);
      return next;
    });
  };

  const updateActiveContent = (content: string) => {
    if (!activePath) return;
    setFiles((prev) =>
      prev.map((file) => (file.path === activePath ? { ...file, content } : file)),
    );
  };

  const createBlankFile = (path: string, content = "") => {
    applyFiles([{ path, content }]);
    setSurface("code");
  };

  const ingestUploads = async (list: FileList | null) => {
    if (!list?.length) return;
    const { fileToStudioFile } = await import("@/lib/studio-deploy");
    const { notifyUploadAttached } = await import("@/lib/composer-attachments");
    const nextFiles: StudioFile[] = [];
    for (const file of [...list]) {
      nextFiles.push(await fileToStudioFile(file));
    }
    applyFiles(nextFiles);
    const names = nextFiles.map((file) => file.path);
    notifyUploadAttached({ attachedNames: names });
    room.setDraft((current) =>
      current.trim()
        ? `${current.trim()}\n\n[uploaded: ${names.join(", ")}]`
        : ar
          ? `استخدم الملفات المرفوعة: ${names.join(", ")}`
          : `Use the uploaded files: ${names.join(", ")}`,
    );
    setSurface("code");
  };

  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? room.draft).trim();
    if (!text || room.busy) return;
    if (isDesignAsk(text)) pendingPrompt.current = text;
    await room.send(text);
    setSurface("preview");
  };

  const downloadZip = () => {
    const blob = buildProjectZip(files);
    downloadBlob(blob, "arrab-studio-site.zip");
    setExportOpen(false);
  };

  const onPhoneSizeChange = (id: string) => {
    setPhoneSizeId(id);
    writePhoneSizeId(id);
  };

  const onPhoneRotate = () => {
    const next = rotatePhonePreset(phoneSizeId);
    onPhoneSizeChange(next.id);
  };

  const onOpenOnPhone = async () => {
    if (!hasFiles || !previewHtml.trim()) {
      pushToast({ title: t("phoneConnectEmpty"), tone: "info" });
      return;
    }
    setPhoneConnectBusy(true);
    try {
      const session = await startPhonePreview(previewHtml);
      setPhoneConnect(session);
      pushToast({ title: t("phoneConnectReady"), body: session.lanUrl, tone: "success" });
    } catch (err: unknown) {
      const message =
        err instanceof Error && /desktop/i.test(err.message)
          ? t("phoneConnectNeedDesktop")
          : err instanceof Error
            ? err.message
            : t("phoneConnectNeedDesktop");
      pushToast({ title: message, tone: "warn" });
    } finally {
      setPhoneConnectBusy(false);
    }
  };

  const suggestions = isPhone
    ? ar
      ? ["صمّم شاشة تسجيل دخول", "بطاقة منتج للجوال", "قائمة تنقل سفلية"]
      : ["Design a mobile login", "Product card for phone", "Bottom tab bar"]
    : ar
      ? ["صفحة هبوط عصرية", "معرض أعمال", "تسعير بثلاث خطط"]
      : ["Modern landing page", "Portfolio gallery", "Pricing with 3 plans"];

  return (
    <div className={cn("st-work st-work-ai", chatFull && "is-chat-full")}>
      <aside className="st-chat-pane">
        <header className="st-pane-head">
          <StudioPortrait entry={kind} size={28} />
          <span>{ar ? kind.nameAr : kind.name}</span>
          <button
            type="button"
            className="st-icon-btn st-pane-full"
            onClick={() => setChatFull((open) => !open)}
            aria-label={chatFull ? t("studioChatExitFull") : t("studioChatFull")}
            title={chatFull ? t("studioChatExitFull") : t("studioChatFull")}
          >
            {chatFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </header>
        <div className="st-chat-log">
          {room.lines.length === 0 ? (
            <div className="st-assist-welcome st-default-welcome">
              <div className="st-assist-welcome-face">
                <StudioPortrait entry={kind} size={72} />
              </div>
              <h3>{t("studioAssistantWelcome")}</h3>
              <p>
                {isPhone
                  ? ar
                    ? "صف الشاشة — تظهر في إطار الجوال فوراً."
                    : "Describe the screen — it appears in the phone frame."
                  : ar
                    ? "صف الموقع — المعاينة والكود يُنشآن من الصفر."
                    : "Describe the site — preview and files start from scratch."}
              </p>
              <div className="st-suggest-row is-welcome-grid">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="st-suggest-chip"
                    disabled={room.busy}
                    onClick={() => void send(undefined, item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            room.lines.map((line) => {
              const shown =
                line.who === "companion" ? stripCodeForChat(line.text) : line.text;
              if (!shown.trim() && line.who === "companion") {
                return (
                  <div key={line.id} className="st-bubble is-them is-quiet">
                    {ar ? "تم تحديث المعاينة." : "Preview updated."}
                  </div>
                );
              }
              return (
                <div
                  key={line.id}
                  className={cn("st-bubble", line.who === "me" ? "is-me" : "is-them")}
                >
                  {shown}
                </div>
              );
            })
          )}
          {room.error ? <p className="st-chat-error">{room.error}</p> : null}
          {room.busy ? <div className="st-bubble is-them is-busy">…</div> : null}
          <div ref={chatEnd} />
        </div>
        <form className="st-composer is-advanced" onSubmit={(event) => void send(event)}>
          <div className="st-attach">
            <ComposerPlusMenu
              open={attachOpen}
              onOpenChange={setAttachOpen}
              onUploadImages={() => imageUploadRef.current?.click()}
              onUploadFiles={() => fileUploadRef.current?.click()}
              onWebSearch={() =>
                room.setDraft((current) =>
                  current.trim().startsWith("/web")
                    ? current
                    : `/web ${current.trim()}`.trim() + " ",
                )
              }
              features={{ folder: false }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  createBlankFile("index.html");
                  setAttachOpen(false);
                }}
              >
                <FilePlus2 size={15} />
                {t("studioNewHtml")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  createBlankFile("styles.css");
                  setAttachOpen(false);
                }}
              >
                <FilePlus2 size={15} />
                {t("studioNewCss")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  createBlankFile("app.js");
                  setAttachOpen(false);
                }}
              >
                <FilePlus2 size={15} />
                {t("studioNewJs")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const path = window.prompt(t("studioNewFilePrompt"), "components/new.tsx");
                  if (path?.trim()) createBlankFile(path.trim().replace(/^\.?\/+/, ""));
                  setAttachOpen(false);
                }}
              >
                <FileCode2 size={15} />
                {t("studioNewFile")}
              </button>
            </ComposerPlusMenu>
            <input
              ref={imageUploadRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
              multiple
              hidden
              onChange={(event) => {
                void ingestUploads(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={fileUploadRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void ingestUploads(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          <textarea
            value={room.draft}
            onChange={(event) => room.setDraft(event.target.value)}
            placeholder={
              isPhone ? t("studioPhonePlaceholder") : t("studioDesignerPlaceholder")
            }
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {room.busy ? (
            <button
              type="button"
              className="st-send"
              onClick={() => room.stop()}
              aria-label={ar ? "إيقاف" : "Stop"}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="st-send"
              disabled={!room.draft.trim()}
              aria-label={t("send")}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </form>
      </aside>

      <section className="st-stage">
        <div className="st-stage-bar">
          <div className="st-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={surface === "preview"}
              className={cn(surface === "preview" && "is-on")}
              onClick={() => setSurface("preview")}
            >
              <Eye size={13} />
              {t("studioPreview")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={surface === "code"}
              className={cn(surface === "code" && "is-on")}
              onClick={() => setSurface("code")}
            >
              <Code2 size={13} />
              {t("studioCode")}
              {hasFiles ? <span className="st-tab-count">{files.length}</span> : null}
            </button>
          </div>
          <div className="st-stage-actions">
            {isPhone && surface === "preview" ? (
              <>
                <label className="st-phone-size">
                  <span>{t("studioPhoneSize")}</span>
                  <select
                    value={phoneSizeId}
                    onChange={(event) => onPhoneSizeChange(event.target.value)}
                  >
                    {phoneGroups.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.items.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {ar ? preset.labelAr : preset.label} · {preset.width}×{preset.height}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <button type="button" className="cp-button" onClick={onPhoneRotate}>
                  {t("phoneRotate")}
                </button>
                <button
                  type="button"
                  className="cp-button"
                  disabled={phoneConnectBusy || !hasFiles}
                  onClick={() => void onOpenOnPhone()}
                >
                  <Smartphone size={14} />
                  {phoneConnectBusy ? t("phoneConnectBusy") : t("phoneOpenOnDevice")}
                </button>
              </>
            ) : null}
            <div className="st-export" ref={exportRef}>
              <button
                type="button"
                className="cp-button"
                onClick={() => setExportOpen((open) => !open)}
                disabled={!hasFiles}
              >
                {t("studioExport")}
                <ChevronDown size={14} />
              </button>
              {exportOpen ? (
                <div className="st-export-menu">
                  <button type="button" onClick={downloadZip}>
                    <Download size={14} />
                    {t("studioDownloadZip")}
                  </button>
                  {(isWeb || isPhone) && (
                    <button
                      type="button"
                      onClick={() => {
                        setExportOpen(false);
                        setDeployMode("github");
                      }}
                    >
                      <Github size={14} />
                      {t("studioPushGithub")}
                    </button>
                  )}
                  {isWeb ? (
                    <button
                      type="button"
                      onClick={() => {
                        setExportOpen(false);
                        setDeployMode("ssh");
                      }}
                    >
                      <Server size={14} />
                      {t("studioDeploySsh")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {surface === "preview" ? (
          !hasFiles ? (
            isPhone ? (
              <PhoneStage
                preset={phoneSize}
                html=""
                caption={`${ar ? phoneSize.labelAr : phoneSize.label} · ${phoneSize.width}×${phoneSize.height}`}
                empty
                emptyTitle={t("studioEmptyPreview")}
                emptyHint={t("studioEmptyPreviewHint")}
              />
            ) : (
              <div className="st-preview-empty">
                <div className="st-preview-empty-glow" aria-hidden="true" />
                <Sparkles size={28} />
                <h3>{t("studioEmptyPreview")}</h3>
                <p>{t("studioEmptyPreviewHint")}</p>
              </div>
            )
          ) : isPhone ? (
            <PhoneStage
              preset={phoneSize}
              html={previewHtml}
              caption={`${ar ? phoneSize.labelAr : phoneSize.label} · ${phoneSize.width}×${phoneSize.height}`}
              empty={false}
              emptyTitle=""
              emptyHint=""
            />
          ) : (
            <iframe
              title={t("studioPreview")}
              className="st-preview-frame"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
            />
          )
        ) : (
          <div className="st-code-stage">
            <div className="st-tabs" role="tablist">
              {openTabs.length === 0 ? (
                <span className="st-tabs-empty">{t("studioNoOpenTabs")}</span>
              ) : (
                openTabs.map((path) => (
                  <button
                    key={path}
                    type="button"
                    role="tab"
                    aria-selected={activePath === path}
                    className={cn("st-tab", activePath === path && "is-on")}
                    onClick={() => setActivePath(path)}
                  >
                    <FileCode2 size={12} />
                    <span>{path.split("/").pop()}</span>
                    <span
                      className="st-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(path);
                      }}
                      role="presentation"
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="st-editor-body">
              <div className="st-tree">
                <div className="st-tree-head">
                  <p className="st-tree-label">{t("studioFiles")}</p>
                  <button
                    type="button"
                    className="st-icon-btn"
                    onClick={() => {
                      const path = window.prompt(t("studioNewFilePrompt"), "index.html");
                      if (path?.trim()) createBlankFile(path.trim().replace(/^\.?\/+/, ""));
                    }}
                    aria-label={t("studioNewFile")}
                    title={t("studioNewFile")}
                  >
                    <FilePlus2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="st-icon-btn"
                    onClick={() => codeUploadRef.current?.click()}
                    aria-label={t("studioUploadFile")}
                    title={t("studioUploadFile")}
                  >
                    <Upload size={13} />
                  </button>
                  <input
                    ref={codeUploadRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      void ingestUploads(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>
                {!hasFiles ? (
                  <div className="st-tree-empty">
                    <FolderOpen size={22} />
                    <strong>{t("studioNoFiles")}</strong>
                    <p>{t("studioNoFilesHint")}</p>
                    <button
                      type="button"
                      className="cp-button"
                      onClick={() => createBlankFile("index.html", "")}
                    >
                      <Plus size={14} />
                      {t("studioCreateFirstFile")}
                    </button>
                  </div>
                ) : (
                  <TreeRows
                    nodes={tree}
                    depth={0}
                    activePath={activePath}
                    openFolders={openFolders}
                    onToggleFolder={(path) =>
                      setOpenFolders((prev) => {
                        const next = new Set(prev);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })
                    }
                    onOpenFile={openFile}
                  />
                )}
              </div>
              <div className="st-code">
                {activeFile ? (
                  activeFile.content.startsWith("data:") ? (
                    <div className="st-binary-preview">
                      {activeFile.content.startsWith("data:image/") ? (
                        <img src={activeFile.content} alt={activeFile.path} />
                      ) : (
                        <p>{t("studioBinaryFile")}</p>
                      )}
                      <p className="cp-muted">{activeFile.path}</p>
                    </div>
                  ) : (
                    <textarea
                      className="st-code-input"
                      value={activeFile.content}
                      onChange={(event) => updateActiveContent(event.target.value)}
                      spellCheck={false}
                      placeholder={t("studioFilePlaceholder")}
                    />
                  )
                ) : (
                  <div className="st-empty-code-wow">
                    <Code2 size={24} />
                    <p>{hasFiles ? t("studioPickFile") : t("studioNoFilesHint")}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {deployMode ? (
        <DeployDialog files={files} mode={deployMode} onClose={() => setDeployMode(null)} />
      ) : null}

      {phoneConnect ? (
        <div
          className="st-phone-connect"
          role="dialog"
          aria-modal="true"
          aria-label={t("phoneOpenOnDevice")}
          onClick={() => setPhoneConnect(null)}
        >
          <div className="st-phone-connect-panel" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>{t("phoneOpenOnDevice")}</h3>
              <button type="button" className="cp-button" onClick={() => setPhoneConnect(null)}>
                <X size={14} />
              </button>
            </header>
            <p className="cp-muted">{t("phoneOpenOnDeviceHint")}</p>
            <img
              className="st-phone-qr"
              src={phonePreviewQrUrl(phoneConnect.lanUrl)}
              alt="QR"
              width={220}
              height={220}
            />
            <code className="st-phone-url">{phoneConnect.lanUrl}</code>
            <div className="st-phone-connect-actions">
              <button
                type="button"
                className="cp-button"
                onClick={() => void copyChatText(phoneConnect.lanUrl).then((ok) => {
                  if (ok) pushToast({ title: t("copied"), tone: "success" });
                })}
              >
                {t("phoneConnectCopy")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function studioModeLabel(kind: StudioCatalogEntry, ar: boolean): { text: string; mode: "web" | "phone" | "desk" | "work" } {
  if (kind.purposeId === "phone-design") {
    return { text: ar ? "معاينة جوال" : "Phone preview", mode: "phone" };
  }
  if (kind.purposeId === "web-design" || kind.workspace === "ui-designer") {
    return { text: ar ? "معاينة ويب" : "Web preview", mode: "web" };
  }
  if (kind.workspace === "arrab-assistant") {
    return { text: ar ? "مكتب الملفات" : "PC desk", mode: "desk" };
  }
  return { text: ar ? "غرفة عمل" : "Work room", mode: "work" };
}

function DefaultStudioChat({
  companion,
  kind,
}: {
  companion: CompanionProfile;
  kind: StudioCatalogEntry;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const room = useCompanionRoom(companion);
  const purpose = purposeRegistryById(companion.purposeId || kind.purposeId);
  const tasks = purpose?.taskTemplates?.slice(0, 4) ?? [];
  const suggestions =
    tasks.length > 0
      ? tasks.map((task) => (ar ? task.titleAr : task.title))
      : ar
        ? [`ساعدني في: ${kind.blurbAr}`, "ما أول خطوة؟", "اقترح خطة قصيرة"]
        : [`Help me with: ${kind.blurb}`, "What’s the first step?", "Suggest a short plan"];
  const [plusOpen, setPlusOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.lines.length, room.busy]);

  const ingestUploads = async (list: FileList | null) => {
    const { filesToDraftParts } = await import("@/lib/composer-attachments");
    const parts = await filesToDraftParts(list);
    if (!parts.length) return;
    room.setDraft((current) =>
      current.trim() ? `${current.trim()}\n\n${parts.join("\n\n")}` : parts.join("\n\n"),
    );
  };

  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? room.draft).trim();
    if (!text || room.busy) return;
    if (override) room.setDraft("");
    await room.send(text);
  };

  return (
    <div className="st-default-work">
      <aside className="st-default-rail">
        <StudioPortrait entry={kind} size={64} />
        <div>
          <h2>{ar ? kind.nameAr : kind.name}</h2>
          <p>{ar ? kind.blurbAr : kind.blurb}</p>
        </div>
        {suggestions.length > 0 ? (
          <div className="st-default-rail-suggest">
            <p className="st-default-rail-label">{ar ? "اقتراحات" : "Suggestions"}</p>
            <ul>
              {suggestions.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    disabled={room.busy}
                    onClick={() => void send(undefined, item)}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
      <section className="st-default-chat-pane">
        <header className="st-pane-head">
          <span>{ar ? kind.nameAr : kind.name}</span>
        </header>
        <div className="st-chat-log">
          {room.lines.length === 0 ? (
            <div className="st-assist-welcome st-default-welcome">
              <div className="st-assist-welcome-face">
                <StudioPortrait entry={kind} size={72} />
              </div>
              <h3>{t("studioAssistantWelcome")}</h3>
              <p>
                {ar
                  ? `${kind.blurbAr} — اكتب طلباً واضحاً وسأكمل العمل.`
                  : `${kind.blurb} — give a clear ask and I’ll work it through.`}
              </p>
              <div className="st-suggest-row is-welcome-grid">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="st-suggest-chip"
                    disabled={room.busy}
                    onClick={() => void send(undefined, item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            room.lines.map((line) => (
              <div key={line.id} className={cn("st-bubble", line.who === "me" ? "is-me" : "is-them")}>
                {line.text}
              </div>
            ))
          )}
          {room.error ? <p className="st-chat-error">{room.error}</p> : null}
          {room.busy ? <div className="st-bubble is-them is-busy">…</div> : null}
          <div ref={chatEnd} />
        </div>
        <form className="st-composer is-advanced" onSubmit={(event) => void send(event)}>
          <ComposerPlusMenu
            open={plusOpen}
            onOpenChange={setPlusOpen}
            onUploadImages={() => imageInputRef.current?.click()}
            onUploadFiles={() => fileInputRef.current?.click()}
            onWebSearch={() =>
              room.setDraft((current) =>
                current.trim().startsWith("/web")
                  ? current
                  : `/web ${current.trim()}`.trim() + " ",
              )
            }
            features={{ folder: false }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg"
            multiple
            hidden
            onChange={(event) => {
              void ingestUploads(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void ingestUploads(event.target.files);
              event.target.value = "";
            }}
          />
          <textarea
            value={room.draft}
            onChange={(event) => room.setDraft(event.target.value)}
            placeholder={t("studioChatPlaceholder")}
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {room.busy ? (
            <button
              type="button"
              className="st-send is-stop"
              onClick={() => room.stop()}
              aria-label={ar ? "إيقاف" : "Stop"}
            >
              <Square size={14} strokeWidth={2.2} />
            </button>
          ) : (
            <button type="submit" className="st-send" disabled={!room.draft.trim()}>
              <ArrowUp size={16} />
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

export function CompanionStudioPage({
  variant = "auto",
}: {
  /** Org Workplace embeds this as the Studios tab. */
  variant?: "auto" | "studios";
} = {}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { role } = useRole();
  const isStudiosEmbed = variant === "studios";
  const isOrgWorkplace = !isStudiosEmbed && role === "organization";
  const { signedIn, account } = useSignedInAccount();
  const { active: familyActive, isChild: isFamilyChild } = useFamilyProfile();
  const state = useCompanionState();
  const catalog = resolveStudioCatalog(state);
  /** Studios tab always opens on the roster; individual Studio may resume last companion. */
  const [activeId, setActiveId] = useState<string | null>(() =>
    variant === "studios" ? null : readStudioActive(),
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StudioCatalogEntry | null>(null);
  const [sessionCompanion, setSessionCompanion] = useState<CompanionProfile | null>(null);
  const [switcher, setSwitcher] = useState(false);

  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!signedIn || !accountId) return;
    ensureStudioAdminClaim(accountId);
  }, [signedIn, accountId]);
  const canEdit = signedIn && isStudioAdmin(accountId);
  const canAdd = canEdit;

  const activeKind = activeId ? studioKindById(activeId, state) : null;

  const ensureCompanion = (kind: StudioCatalogEntry): CompanionProfile => {
    const seatId = familyActive?.id ?? null;
    const existing = liveCompanions(state).find((person) => {
      if (person.domain !== kind.domain) return false;
      if (!seatId) return true;
      if (isFamilyChild) return person.familyMemberId === seatId;
      return !person.familyMemberId || person.familyMemberId === seatId;
    });
    const lockedPhoto =
      kind.avatarPhoto?.trim() ||
      (kind.domain === "arrab-assistant" || kind.workspace === "arrab-assistant"
        ? companionPortraitUrl({
            seed: kind.faceSeed,
            name: kind.name,
            domain: kind.domain || "arrab-assistant",
          })
        : null);
    if (existing) {
      if (lockedPhoto && existing.avatarPhoto !== lockedPhoto) {
        setCompanionAvatar(existing.id, lockedPhoto);
      }
      const patch: Partial<CompanionProfile> = {};
      if (existing.purposeId !== kind.purposeId) patch.purposeId = kind.purposeId;
      if (
        kind.workspace === "arrab-assistant" &&
        existing.connectors.length < ARRAB_ASSISTANT_CONNECTORS.length
      ) {
        patch.connectors = [...ARRAB_ASSISTANT_CONNECTORS];
        patch.brief = ar ? kind.briefAr : kind.brief;
      }
      if (Object.keys(patch).length) {
        updateCompanion(existing.id, patch);
        if (patch.purposeId) syncCompanionPurpose(existing.id, kind.purposeId);
      }
      const refreshed =
        liveCompanions(getCompanionState()).find((person) => person.id === existing.id) ?? existing;
      return {
        ...refreshed,
        avatarPhoto: lockedPhoto ?? refreshed.avatarPhoto,
        purposeId: kind.purposeId,
        connectors: patch.connectors ?? refreshed.connectors,
        brief: patch.brief ?? refreshed.brief,
      };
    }
    const created = addCompanion({
      name: ar ? kind.nameAr : kind.name,
      domain: kind.domain,
      purposeId: kind.purposeId,
      brief: ar ? kind.briefAr : kind.brief,
      toneName: kind.toneName,
      space: "work",
      familyMemberId: seatId,
      connectors:
        kind.workspace === "arrab-assistant" ? [...ARRAB_ASSISTANT_CONNECTORS] : undefined,
    });
    if (lockedPhoto) setCompanionAvatar(created.id, lockedPhoto);
    return { ...created, avatarPhoto: lockedPhoto ?? created.avatarPhoto };
  };

  const openKind = (kind: StudioCatalogEntry) => {
    const person = ensureCompanion(kind);
    if (kind.avatarPhoto) setCompanionAvatar(person.id, kind.avatarPhoto);
    setSessionCompanion({ ...person, avatarPhoto: kind.avatarPhoto ?? person.avatarPhoto });
    setActiveId(kind.id);
    writeStudioActive(kind.id);
    setSwitcher(false);
  };

  const backToRoster = () => {
    setActiveId(null);
    setSessionCompanion(null);
    writeStudioActive(null);
  };

  useEffect(() => {
    if (!isStudiosEmbed) return;
    const pendingKind = sessionStorage.getItem(WORKPLACE_OPEN_KIND_KEY);
    if (!pendingKind) return;
    sessionStorage.removeItem(WORKPLACE_OPEN_KIND_KEY);
    try {
      const kind =
        studioKindById(pendingKind, state) ??
        studioKindById(WORKPLACE_DEFAULT_KIND, state) ??
        catalog[0];
      if (kind) openKind(kind);
    } catch {
      // Never blank the Workplace roster on a bad handoff.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudiosEmbed]);

  const companion =
    (sessionCompanion && (!activeKind || sessionCompanion.domain === activeKind.domain)
      ? sessionCompanion
      : null) ??
    (activeKind
      ? liveCompanions(state).find((person) => {
          if (person.domain !== activeKind.domain) return false;
          const seatId = familyActive?.id ?? null;
          if (!seatId) return true;
          if (isFamilyChild) return person.familyMemberId === seatId;
          return !person.familyMemberId || person.familyMemberId === seatId;
        }) ?? null
      : null);

  useEffect(() => {
    if (!activeKind || companion) return;
    const person = ensureCompanion(activeKind);
    setSessionCompanion({
      ...person,
      avatarPhoto: activeKind.avatarPhoto ?? person.avatarPhoto,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKind?.id]);

  if (activeKind && companion) {
    return (
      <div className={cn("cp-ui cp-page st-page", activeKind.workspace === "arrab-assistant" && "is-assist")}>
        <header className={cn("st-top st-top-compact", activeKind.workspace === "arrab-assistant" && "is-air")}>
          <button type="button" className="cp-icon" onClick={backToRoster} aria-label={t("back")}>
            <ArrowLeft size={16} />
          </button>
          <StudioPortrait
            entry={{
              name: companion.name || activeKind.name,
              hue: companion.hue ?? activeKind.hue,
              faceSeed: companion.faceSeed ?? activeKind.faceSeed,
              avatarPhoto: companion.avatarPhoto ?? activeKind.avatarPhoto,
              domain: companion.domain || activeKind.domain,
            }}
            size={36}
          />
          <div className="st-top-copy">
            <p className="cp-eyebrow">{isStudiosEmbed ? "ARRAB / WORKPLACE" : "ARRAB / STUDIO"}</p>
            <h1>{ar ? activeKind.nameAr : activeKind.name}</h1>
          </div>
          <button type="button" className="cp-button is-quiet" onClick={() => setSwitcher(true)}>
            {t("studioSwitch")}
          </button>
        </header>
        {activeKind.workspace === "arrab-assistant" ? (
          <ArrabAssistantWorkspace companion={companion} kind={activeKind} />
        ) : activeKind.workspace === "ui-designer" ? (
          <UiDesignerWorkspace companion={companion} kind={activeKind} />
        ) : (
          <DefaultStudioChat companion={companion} kind={activeKind} />
        )}
        {switcher ? (
          <div className="st-picker-backdrop" onClick={() => setSwitcher(false)}>
            <div className="st-picker" onClick={(event) => event.stopPropagation()}>
              <header>
                <h2>{t("studioSwitch")}</h2>
                <button
                  type="button"
                  className="cp-icon"
                  onClick={() => setSwitcher(false)}
                  aria-label={t("close")}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="st-kind-grid">
                {catalog.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    className="st-kind st-kind-btn"
                    onClick={() => openKind(kind)}
                  >
                    <StudioPortrait entry={kind} size={56} />
                    <div>
                      <strong>{ar ? kind.nameAr : kind.name}</strong>
                      <p>{ar ? kind.blurbAr : kind.blurb}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cp-ui cp-page st-page">
      <header className="cp-page-header">
        <div>
          <p className="cp-eyebrow">
            {isStudiosEmbed
              ? "ARRAB / WORKPLACE"
              : isOrgWorkplace
                ? "ARRAB / WORKPLACE"
                : "ARRAB / STUDIO"}
          </p>
          <h1>
            {isStudiosEmbed
              ? t("workplace")
              : isOrgWorkplace
                ? t("workplace")
                : t("studio")}
          </h1>
          <p className="cp-muted">
            {isStudiosEmbed
              ? t("workplaceLead")
              : isOrgWorkplace
                ? t("workplaceLead")
                : ar
                  ? "ابدأ بمساعد عراب — أو اختر رفيق تصميم ويب وجوال والمزيد."
                  : "Start with Arrab Assistant — or pick web, phone, and specialist companions."}
          </p>
        </div>
        {canAdd ? (
          <button type="button" className="cp-button" onClick={() => setAdding(true)}>
            <Plus size={14} />
            {t("studioAddCompanion")}
          </button>
        ) : !signedIn ? (
          <p className="st-admin-hint">{t("studioSignInToAdd")}</p>
        ) : null}
      </header>

      <section className="st-roster">
        <div className="st-roster-advanced">
          {catalog.map((kind) => {
            const purpose = resolveStudioPurposes(state).find((item) => item.id === kind.purposeId);
            const isMain = kind.workspace === "arrab-assistant" || kind.id === "arrab-assistant";
            const mode = studioModeLabel(kind, ar);
            return (
              <article
                key={kind.id}
                className={cn(
                  "st-kind st-kind-photo is-studio-card",
                  isMain && "st-kind-main",
                )}
              >
                {isMain ? <span className="st-kind-main-badge">{t("studioAssistantMain")}</span> : null}
                <div className="st-kind-card-top">
                  {canEdit ? (
                    <StudioPhotoPicker
                      entry={kind}
                      size={isMain ? 72 : 64}
                      compact
                      onChange={(photo) => {
                        updateCatalogPhoto(kind.id, photo);
                        const person = liveCompanions(state).find(
                          (item) => item.domain === kind.domain,
                        );
                        if (person) setCompanionAvatar(person.id, photo);
                      }}
                    />
                  ) : (
                    <StudioPortrait entry={kind} size={isMain ? 72 : 64} />
                  )}
                  <div className="st-kind-copy">
                    {purpose ? (
                      <span className="st-purpose-tag">{ar ? purpose.nameAr : purpose.name}</span>
                    ) : null}
                    <strong>{ar ? kind.nameAr : kind.name}</strong>
                    <p>{ar ? kind.blurbAr : kind.blurb}</p>
                    <span className={cn("st-kind-mode", `is-${mode.mode}`)}>
                      {mode.mode === "phone" ? (
                        <Smartphone size={11} />
                      ) : mode.mode === "web" ? (
                        <Eye size={11} />
                      ) : mode.mode === "desk" ? (
                        <FolderOpen size={11} />
                      ) : (
                        <Sparkles size={11} />
                      )}
                      {mode.text}
                    </span>
                  </div>
                </div>
                <div className="st-kind-actions">
                  <button type="button" className="cp-button" onClick={() => openKind(kind)}>
                    {t("studioOpen")}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className="cp-icon"
                      aria-label={t("studioEditCompanion")}
                      onClick={() => setEditing(kind)}
                    >
                      <Pencil size={15} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {adding ? (
        <AddCompanionPanel
          accountId={accountId}
          onClose={() => setAdding(false)}
          onSaved={(entry) => openKind(entry)}
        />
      ) : null}
      {editing && canEdit ? (
        <AdminEditPanel
          initial={editing}
          accountId={accountId}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
