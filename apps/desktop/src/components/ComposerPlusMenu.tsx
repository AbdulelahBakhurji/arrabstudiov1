import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cable,
  Check,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  Image,
  LayoutTemplate,
  Palette,
  Plus,
  Presentation,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
  WifiOff,
  X,
} from "lucide-react";
import type { AiGatewayStatusResponse } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import { canUseCloudAi } from "@/lib/guest-mode";
import {
  DEFAULT_OLLAMA_BASE,
  fetchOllamaStatus,
  type OllamaStatus,
} from "@/lib/local-models";
import { markGettingStartedStep } from "@/lib/getting-started";
import { pushToast } from "@/lib/notify";
import { readPrefs, subscribePrefs, updatePrefs, type StudioPrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { ACCOUNT_EVENT } from "@/lib/account-session";
import { GUEST_EVENT } from "@/lib/guest-mode";
import {
  clearArmedSkills,
  disarmSkill,
  importSkillFiles,
  toggleArmedSkill,
  useArmedSkillIds,
  useSkills,
} from "@/lib/user-skills";

export type ComposerPlusFeatures = {
  folder?: boolean;
  connectors?: boolean;
  localModel?: boolean;
  /** Cloud models from GET /v1/ai/status — shown only to org admins when enabled. */
  cloudModel?: boolean;
  webSearch?: boolean;
  images?: boolean;
  files?: boolean;
  /** PDF / Word / slides / image create prompts */
  create?: boolean;
};

const DEFAULT_FEATURES: Required<ComposerPlusFeatures> = {
  folder: true,
  connectors: true,
  localModel: true,
  cloudModel: true,
  webSearch: true,
  images: true,
  files: true,
  create: true,
};

export type ComposerCreateKind =
  | "pdf"
  | "docx"
  | "presentation"
  | "image"
  | "search"
  | "read";

export function composerCreatePrompt(kind: ComposerCreateKind, locale: "en" | "ar" = "en"): string {
  if (locale === "ar") {
    switch (kind) {
      case "pdf":
        return "أنشئ ملف PDF احترافي عن: ";
      case "docx":
        return "أنشئ مستند Word عن: ";
      case "presentation":
        return "أنشئ عرض تقديمي عن: ";
      case "image":
        return "أنشئ صورة / غلاف عن: ";
      case "search":
        return "ابحث في الويب عن: ";
      case "read":
        return "اقرأ هذا المستند أو الصورة على المكتب واشرحها: ";
    }
  }
  switch (kind) {
    case "pdf":
      return "Create a professional PDF about: ";
    case "docx":
      return "Create a Word document about: ";
    case "presentation":
      return "Create a presentation about: ";
    case "image":
      return "Create an image / cover about: ";
    case "search":
      return "Search the web for: ";
    case "read":
      return "Read this document or image on the desk and explain it: ";
  }
}

type PlusPanel = "main" | "local" | "cloud" | "skills";

/** Display label: "deepseek/deepseek-v4.1-flash" → "Deepseek 4.1 Flash" */
function shortModelLabel(model: string): string {
  const raw = model.trim();
  if (!raw) return raw;
  const slug = (raw.split("/").pop() || raw).replace(/_/g, "-");
  const parts = slug
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // v4.1 / v4 → 4.1 / 4
      const version = part.match(/^v?(\d+(?:\.\d+)*)$/i);
      if (version) return version[1]!;
      // 0731 dates stay as-is
      if (/^\d{3,}$/.test(part)) return part;
      // Brand-ish tokens
      const lower = part.toLowerCase();
      if (lower === "gpt") return "GPT";
      if (lower === "llm") return "LLM";
      if (lower === "ai") return "AI";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
  return parts.join(" ");
}

export function ComposerPlusMenu({
  open,
  onOpenChange,
  onUploadImages,
  onUploadFiles,
  onConnectFolder,
  onWebSearch,
  onCreate,
  features,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadImages?: () => void;
  onUploadFiles?: () => void;
  onConnectFolder?: () => void;
  onWebSearch?: () => void;
  onCreate?: (kind: ComposerCreateKind) => void;
  features?: ComposerPlusFeatures;
  className?: string;
  children?: ReactNode;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href } = useRole();
  const ref = useRef<HTMLDivElement>(null);
  const opts = { ...DEFAULT_FEATURES, ...features };
  const [panel, setPanel] = useState<PlusPanel>("main");
  const [prefs, setPrefs] = useState<StudioPrefs>(() => readPrefs());
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatusResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [cloudAllowed, setCloudAllowed] = useState(() => canUseCloudAi());
  const skills = useSkills();
  const armedIds = useArmedSkillIds();
  const [skillQuery, setSkillQuery] = useState("");
  const [importingSkills, setImportingSkills] = useState(false);
  const skillFileRef = useRef<HTMLInputElement>(null);
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const armedSkills = enabledSkills.filter((skill) => armedIds.includes(skill.id));
  const skillNeedle = skillQuery.trim().toLowerCase();
  const visibleSkills = skillNeedle
    ? enabledSkills.filter((skill) =>
        `${skill.name} ${skill.slug} ${skill.description} ${skill.tags.join(" ")}`
          .toLowerCase()
          .includes(skillNeedle),
      )
    : enabledSkills;

  const importSkillsFromPicker = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (!files.length) return;
    setImportingSkills(true);
    try {
      const result = await importSkillFiles(
        files.map((file) => ({ file, path: file.webkitRelativePath || file.name })),
      );
      const count = result.added.length + result.updated.length;
      if (count > 0) {
        if (count === 1) {
          const skill = result.added[0] ?? result.updated[0]!;
          if (!armedIds.includes(skill.id) && skill.mode !== "always") toggleArmedSkill(skill.id);
        }
        pushToast({
          title: ar
            ? count === 1
              ? "تم استيراد المهارة وتفعيلها"
              : `تم استيراد ${count} مهارات`
            : count === 1
              ? "Skill imported and turned on"
              : `${count} skills imported`,
          body: [...result.added, ...result.updated]
            .slice(0, 3)
            .map((skill) => skill.name)
            .join(" · "),
          tone: "success",
        });
        setPanel("skills");
      } else {
        pushToast({
          title: ar ? "لم يتم استيراد أي مهارة" : "No skills imported",
          body: result.errors[0],
          tone: "warn",
        });
      }
    } finally {
      setImportingSkills(false);
      if (skillFileRef.current) skillFileRef.current.value = "";
    }
  };

  // Cloud models only when signed in — guests stay on local Ollama.
  const showCloudModels = opts.cloudModel && cloudAllowed;

  useEffect(() => subscribePrefs(setPrefs), []);
  useEffect(() => {
    const sync = () => setCloudAllowed(canUseCloudAi());
    window.addEventListener(ACCOUNT_EVENT, sync);
    window.addEventListener(GUEST_EVENT, sync);
    return () => {
      window.removeEventListener(ACCOUNT_EVENT, sync);
      window.removeEventListener(GUEST_EVENT, sync);
    };
  }, []);

  const requireCloudSignIn = () => {
    pushToast({ title: t("cloudNeedsSignIn"), tone: "warn" });
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) {
      setPanel("main");
      setSkillQuery("");
      return;
    }
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || panel !== "local") return;
    let cancelled = false;
    void fetchOllamaStatus(prefs.aiLocalBaseUrl || DEFAULT_OLLAMA_BASE).then((status) => {
      if (!cancelled) setOllama(status);
    });
    return () => {
      cancelled = true;
    };
  }, [open, panel, prefs.aiLocalBaseUrl]);

  useEffect(() => {
    if (!open || !showCloudModels) return;
    if (panel !== "cloud" && panel !== "main") return;
    let cancelled = false;
    const load = (quiet = false) => {
      if (!quiet) setAiLoading(true);
      void arrabApi
        .aiStatus()
        .then((status) => {
          if (!cancelled) setAiStatus(status);
        })
        .catch(() => {
          if (!cancelled && !quiet) setAiStatus(null);
        })
        .finally(() => {
          if (!cancelled) setAiLoading(false);
        });
    };
    load(false);
    // Keep the list fresh while the picker is open — no manual refresh.
    const interval = window.setInterval(() => load(true), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open, panel, showCloudModels]);

  const selectLocal = (tag: string) => {
    const next = updatePrefs({ aiLocalEnabled: true, aiLocalModel: tag });
    setPrefs(next);
    markGettingStartedStep("local_model", true);
    pushToast({
      title: ar ? "وضع محلي · يعمل بلا إنترنت" : "Local mode · works offline",
      body: tag,
      tone: "success",
    });
    onOpenChange(false);
  };

  const useCloud = () => {
    if (!canUseCloudAi()) {
      requireCloudSignIn();
      return;
    }
    const next = updatePrefs({ aiLocalEnabled: false });
    setPrefs(next);
    pushToast({
      title: ar ? "الوضع السحابي" : "Cloud mode",
      tone: "success",
    });
    onOpenChange(false);
  };

  const selectCloudModel = (model: string) => {
    if (!canUseCloudAi()) {
      requireCloudSignIn();
      return;
    }
    const next = updatePrefs({
      aiPreferredModel: model,
      aiLocalEnabled: false,
    });
    setPrefs(next);
    pushToast({
      title: ar ? "تم اختيار النموذج" : "Model selected",
      body: shortModelLabel(model),
      tone: "success",
    });
    onOpenChange(false);
  };

  const useAutoModel = () => {
    if (!canUseCloudAi()) {
      requireCloudSignIn();
      return;
    }
    const next = updatePrefs({
      aiPreferredModel: "",
      aiPreferredFamily: "auto",
      aiLocalEnabled: false,
    });
    setPrefs(next);
    pushToast({
      title: ar ? "تلقائي" : "Auto",
      tone: "success",
    });
    onOpenChange(false);
  };

  const localActive = Boolean(prefs.aiLocalEnabled && prefs.aiLocalModel.trim());
  const preferredCloud = prefs.aiPreferredModel.trim();
  const cloudModels = (() => {
    const fromApi = aiStatus?.models?.filter(Boolean) ?? [];
    const extras = [aiStatus?.defaultModel, preferredCloud || null]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    return [...new Set([...fromApi, ...extras])];
  })();
  const installed = ollama?.models ?? [];
  const autoActive = !localActive && !preferredCloud;
  const cloudBadge = localActive
    ? null
    : preferredCloud
      ? shortModelLabel(preferredCloud)
      : ar
        ? "تلقائي"
        : "Auto";

  return (
    <div
      className={cn("composer-plus", armedSkills.length > 0 && "has-skills", className)}
      ref={ref}
    >
      <button
        type="button"
        className={cn("composer-plus-btn", open && "is-on")}
        onClick={() => onOpenChange(!open)}
        aria-label={t("studioAttach")}
        title={t("studioAttach")}
        aria-expanded={open}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
      <input
        ref={skillFileRef}
        type="file"
        hidden
        multiple
        accept=".md,.markdown,.txt,.json,.zip,.skill"
        onChange={(event) => void importSkillsFromPicker(event.target.files)}
      />
      {armedSkills.length > 0 ? (
        <span
          className="composer-skill-chip"
          title={armedSkills.map((skill) => skill.name).join(", ")}
        >
          <button
            type="button"
            className="composer-skill-chip-main"
            onClick={() => {
              setPanel("skills");
              onOpenChange(true);
            }}
          >
            <Wand2 size={12} strokeWidth={1.9} />
            <span>
              {armedSkills[0]!.name}
              {armedSkills.length > 1 ? ` +${armedSkills.length - 1}` : ""}
            </span>
          </button>
          <button
            type="button"
            className="composer-skill-chip-x"
            aria-label={ar ? "إيقاف المهارات" : "Turn skills off"}
            onClick={() => clearArmedSkills()}
          >
            <X size={11} strokeWidth={2.2} />
          </button>
        </span>
      ) : null}

      {open ? (
        <div
          className={cn("composer-plus-menu", panel === "cloud" && "is-cloud-picker")}
          role="menu"
        >
          {panel === "main" ? (
            <>
              <p className="composer-plus-label">{ar ? "أضف إلى الرسالة" : "Add to message"}</p>
              {opts.images && onUploadImages ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onUploadImages();
                    onOpenChange(false);
                  }}
                >
                  <Image size={15} strokeWidth={1.7} />
                  <span>{t("studioAttachImages")}</span>
                </button>
              ) : null}
              {opts.files && onUploadFiles ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onUploadFiles();
                    onOpenChange(false);
                  }}
                >
                  <Upload size={15} strokeWidth={1.7} />
                  <span>{t("studioAttachFiles")}</span>
                </button>
              ) : null}
              {opts.folder && onConnectFolder ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onConnectFolder();
                    onOpenChange(false);
                  }}
                >
                  <FolderOpen size={15} strokeWidth={1.7} />
                  <span>{t("composerPlusFolder")}</span>
                </button>
              ) : null}
              {opts.webSearch && onWebSearch ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onWebSearch();
                    onOpenChange(false);
                  }}
                >
                  <Globe size={15} strokeWidth={1.7} />
                  <span>{t("chatWebSearch")}</span>
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => setPanel("skills")}>
                <Wand2 size={15} strokeWidth={1.7} />
                <span>{ar ? "المهارات" : "Skills"}</span>
                <em className="composer-plus-badge">
                  {armedSkills.length > 0
                    ? ar
                      ? `${armedSkills.length} مفعّلة`
                      : `${armedSkills.length} on`
                    : enabledSkills.length > 0
                      ? String(enabledSkills.length)
                      : ar
                        ? "جديد"
                        : "New"}
                </em>
              </button>

              {opts.create && onCreate ? (
                <>
                  <div className="composer-plus-sep" />
                  <p className="composer-plus-label">
                    {ar ? "إنشاء وبحث" : "Create & research"}
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("search");
                      onOpenChange(false);
                    }}
                  >
                    <Globe size={15} strokeWidth={1.7} />
                    <span>{ar ? "بحث ويب" : "Web search"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("pdf");
                      onOpenChange(false);
                    }}
                  >
                    <FileText size={15} strokeWidth={1.7} />
                    <span>{ar ? "ملف PDF" : "PDF"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("docx");
                      onOpenChange(false);
                    }}
                  >
                    <FileText size={15} strokeWidth={1.7} />
                    <span>{ar ? "مستند Word" : "Word doc"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("presentation");
                      onOpenChange(false);
                    }}
                  >
                    <Presentation size={15} strokeWidth={1.7} />
                    <span>{ar ? "عرض تقديمي" : "Presentation"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("image");
                      onOpenChange(false);
                    }}
                  >
                    <Palette size={15} strokeWidth={1.7} />
                    <span>{ar ? "صورة" : "Image"}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCreate("read");
                      onOpenChange(false);
                    }}
                  >
                    <LayoutTemplate size={15} strokeWidth={1.7} />
                    <span>{ar ? "قراءة مستند / صورة" : "Read doc / image"}</span>
                  </button>
                </>
              ) : null}

              <div className="composer-plus-sep" />

              {opts.connectors && cloudAllowed ? (
                <Link
                  role="menuitem"
                  className="composer-plus-link"
                  to={href("/connectors")}
                  onClick={() => onOpenChange(false)}
                >
                  <Cable size={15} strokeWidth={1.7} />
                  <span>{t("composerPlusConnectors")}</span>
                </Link>
              ) : null}

              {showCloudModels ? (
                <button type="button" role="menuitem" onClick={() => setPanel("cloud")}>
                  <Sparkles size={15} strokeWidth={1.7} />
                  <span>{t("composerPlusCloudModel")}</span>
                  {cloudBadge ? <em className="composer-plus-badge">{cloudBadge}</em> : null}
                </button>
              ) : null}

              {opts.localModel ? (
                <button type="button" role="menuitem" onClick={() => setPanel("local")}>
                  <Cpu size={15} strokeWidth={1.7} />
                  <span>{t("composerPlusLocalModel")}</span>
                  {localActive ? (
                    <em className="composer-plus-badge">{prefs.aiLocalModel}</em>
                  ) : (
                    <WifiOff size={12} strokeWidth={1.8} className="composer-plus-trail" />
                  )}
                </button>
              ) : null}

              <Link
                role="menuitem"
                className="composer-plus-link"
                to={href("/settings")}
                onClick={() => onOpenChange(false)}
              >
                <Settings2 size={15} strokeWidth={1.7} />
                <span>{t("composerPlusMoreSettings")}</span>
              </Link>
              {children ? (
                <>
                  <div className="composer-plus-sep" />
                  {children}
                </>
              ) : null}
            </>
          ) : panel === "skills" ? (
            <>
              <button
                type="button"
                className="composer-plus-back"
                onClick={() => setPanel("main")}
              >
                ← {ar ? "رجوع" : "Back"}
              </button>
              <p className="composer-plus-label">{ar ? "المهارات" : "Skills"}</p>
              <p className="composer-plus-hint">
                {ar
                  ? "فعّل مهارة لرسائلك القادمة، أو اكتب /اسم-المهارة في المحادثة."
                  : "Turn a skill on for your next messages, or type /skill-name in chat."}
              </p>
              {enabledSkills.length > 5 ? (
                <input
                  className="composer-plus-search"
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder={ar ? "ابحث في المهارات" : "Search skills"}
                  aria-label={ar ? "ابحث في المهارات" : "Search skills"}
                  autoFocus
                />
              ) : null}
              <div className="composer-plus-skill-list" role="group">
                {visibleSkills.length === 0 ? (
                  <p className="composer-plus-empty">
                    {enabledSkills.length === 0
                      ? ar
                        ? "لا توجد مهارات بعد — استورد SKILL.md أو أنشئ مهارة."
                        : "No skills yet — import a SKILL.md or create one."
                      : ar
                        ? "لا توجد نتائج."
                        : "No matching skills."}
                  </p>
                ) : (
                  visibleSkills.map((skill) => {
                    const always = skill.mode === "always";
                    const on = always || armedIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={on}
                        className={cn(on && "is-active")}
                        disabled={always}
                        title={skill.description || skill.name}
                        onClick={() => toggleArmedSkill(skill.id)}
                      >
                        <Wand2 size={15} strokeWidth={1.7} />
                        <span className="composer-plus-skill-copy">
                          <strong>{skill.name}</strong>
                          <small>/{skill.slug}</small>
                        </span>
                        {always ? (
                          <em className="composer-plus-badge">{ar ? "دائمًا" : "Always"}</em>
                        ) : on ? (
                          <Check size={13} />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
              {armedSkills.length > 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => armedSkills.forEach((skill) => disarmSkill(skill.id))}
                >
                  <X size={15} strokeWidth={1.7} />
                  <span>{ar ? "إيقاف المهارات المفعّلة" : "Turn off active skills"}</span>
                </button>
              ) : null}
              <div className="composer-plus-sep" />
              <button
                type="button"
                role="menuitem"
                disabled={importingSkills}
                onClick={() => skillFileRef.current?.click()}
              >
                <Upload size={15} strokeWidth={1.7} />
                <span>
                  {importingSkills
                    ? ar
                      ? "جارٍ الاستيراد…"
                      : "Importing…"
                    : ar
                      ? "استيراد مهارة…"
                      : "Import skill…"}
                  <em className="composer-plus-sub">SKILL.md · .zip · .json</em>
                </span>
              </button>
              <Link
                role="menuitem"
                className="composer-plus-link"
                to={href("/settings?tab=skills&new=1")}
                onClick={() => onOpenChange(false)}
              >
                <Plus size={15} strokeWidth={1.7} />
                <span>{ar ? "إنشاء مهارة" : "Create skill"}</span>
              </Link>
              <Link
                role="menuitem"
                className="composer-plus-link"
                to={href("/settings?tab=skills")}
                onClick={() => onOpenChange(false)}
              >
                <Settings2 size={15} strokeWidth={1.7} />
                <span>{ar ? "إدارة المهارات" : "Manage skills"}</span>
              </Link>
            </>
          ) : panel === "cloud" ? (
            <>
              <div className="composer-plus-cloud-head">
                <button
                  type="button"
                  className="composer-plus-back"
                  onClick={() => setPanel("main")}
                >
                  ← {ar ? "رجوع" : "Back"}
                </button>
                <p className="composer-plus-label">{t("composerPlusCloudModel")}</p>
                {aiLoading || !aiStatus?.configured ? (
                  <p className="composer-plus-hint">
                    {aiLoading
                      ? ar
                        ? "جاري تحميل قائمة النماذج…"
                        : "Loading model list…"
                      : ar
                        ? "واجهة الذكاء غير مهيأة"
                        : "AI gateway not configured"}
                  </p>
                ) : cloudModels.length > 0 ? (
                  <p className="composer-plus-hint">
                    {ar
                      ? `${cloudModels.length} نموذج · مرّر للأسفل لرؤية الكل`
                      : `${cloudModels.length} models · scroll for more`}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className={cn(autoActive && "is-active")}
                  onClick={useAutoModel}
                  title={ar ? "تلقائي" : "Auto"}
                >
                  <Sparkles size={15} strokeWidth={1.7} />
                  <span>{ar ? "تلقائي" : "Auto"}</span>
                  {autoActive ? <Check size={13} /> : null}
                </button>
              </div>
              <div className="composer-plus-cloud-list" role="group" aria-label={ar ? "النماذج" : "Models"}>
                {cloudModels.length === 0 && !aiLoading ? (
                  <p className="composer-plus-empty">
                    {ar
                      ? "لا نماذج متاحة الآن — ستظهر تلقائيًا عند توفرها."
                      : "No models yet — they’ll show up automatically when available."}
                  </p>
                ) : (
                  cloudModels.map((model) => (
                    <button
                      key={model}
                      type="button"
                      role="menuitem"
                      className={cn(
                        !localActive && preferredCloud === model && "is-active",
                      )}
                      onClick={() => selectCloudModel(model)}
                      title={shortModelLabel(model)}
                    >
                      <HardDrive size={15} strokeWidth={1.7} />
                      <span>{shortModelLabel(model)}</span>
                      {!localActive && preferredCloud === model ? <Check size={13} /> : null}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="composer-plus-back"
                onClick={() => setPanel("main")}
              >
                ← {ar ? "رجوع" : "Back"}
              </button>
              <p className="composer-plus-label">
                {ar ? "نموذج محلي · بلا إنترنت" : "Local model · offline"}
              </p>
              <p className="composer-plus-hint">
                {ollama?.online
                  ? ar
                    ? `Ollama متصل${ollama.version ? ` · ${ollama.version}` : ""}`
                    : `Ollama online${ollama.version ? ` · ${ollama.version}` : ""}`
                  : ar
                    ? "Ollama غير متصل — ثبّته من الإعدادات"
                    : "Ollama offline — install from Settings"}
              </p>
              <button
                type="button"
                role="menuitem"
                className={cn(!localActive && "is-active")}
                onClick={useCloud}
              >
                <HardDrive size={15} strokeWidth={1.7} />
                <span>{ar ? "سحابي (إنترنت)" : "Cloud (internet)"}</span>
                {!localActive ? <Check size={13} /> : null}
              </button>
              {installed.length === 0 ? (
                <p className="composer-plus-empty">
                  {ar
                    ? "لا نماذج محمّلة. حمّل من الإعدادات."
                    : "No models downloaded. Get one in Settings."}
                </p>
              ) : (
                installed.slice(0, 12).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    role="menuitem"
                    className={cn(localActive && prefs.aiLocalModel === tag && "is-active")}
                    onClick={() => selectLocal(tag)}
                  >
                    <Cpu size={15} strokeWidth={1.7} />
                    <span>{tag}</span>
                    {localActive && prefs.aiLocalModel === tag ? <Check size={13} /> : null}
                  </button>
                ))
              )}
              <Link
                role="menuitem"
                className="composer-plus-link"
                to={href("/settings")}
                onClick={() => onOpenChange(false)}
              >
                <Settings2 size={15} strokeWidth={1.7} />
                <span>{ar ? "إدارة النماذج المحلية" : "Manage local models"}</span>
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
