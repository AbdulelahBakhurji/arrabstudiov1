import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cable,
  Check,
  Cpu,
  FolderOpen,
  Globe,
  HardDrive,
  Image,
  Plus,
  Settings2,
  Sparkles,
  Upload,
  WifiOff,
} from "lucide-react";
import type { AiGatewayStatusResponse } from "@arrab/shared";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { arrabApi } from "@/lib/api";
import {
  DEFAULT_OLLAMA_BASE,
  fetchOllamaStatus,
  type OllamaStatus,
} from "@/lib/local-models";
import { markGettingStartedStep } from "@/lib/getting-started";
import { pushToast } from "@/lib/notify";
import { readPrefs, subscribePrefs, updatePrefs, type StudioPrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export type ComposerPlusFeatures = {
  folder?: boolean;
  connectors?: boolean;
  localModel?: boolean;
  /** Cloud models from GET /v1/ai/status — shown only to org admins when enabled. */
  cloudModel?: boolean;
  webSearch?: boolean;
  images?: boolean;
  files?: boolean;
};

const DEFAULT_FEATURES: Required<ComposerPlusFeatures> = {
  folder: true,
  connectors: true,
  localModel: true,
  cloudModel: true,
  webSearch: true,
  images: true,
  files: true,
};

type PlusPanel = "main" | "local" | "cloud";

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

  // Any signed-in studio user can pick models (not admin-only).
  const showCloudModels = opts.cloudModel;

  useEffect(() => subscribePrefs(setPrefs), []);

  useEffect(() => {
    if (!open) {
      setPanel("main");
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
    const next = updatePrefs({ aiLocalEnabled: false });
    setPrefs(next);
    pushToast({
      title: ar ? "الوضع السحابي" : "Cloud mode",
      tone: "success",
    });
    onOpenChange(false);
  };

  const selectCloudModel = (model: string) => {
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
    <div className={cn("composer-plus", className)} ref={ref}>
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

              <div className="composer-plus-sep" />

              {opts.connectors ? (
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
