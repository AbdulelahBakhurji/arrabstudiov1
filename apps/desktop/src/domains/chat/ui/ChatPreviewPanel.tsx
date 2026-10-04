/**
 * Right-side preview for a chat: a web page a message links to, or a file attached to it.
 * Remote pages: native chromeless page in the desktop app (the app CSP blocks external frames),
 * a sandboxed iframe elsewhere. Files: images, PDFs, text/code, markdown, or a details card.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  RotateCw,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { safeHttpUrl } from "@/shared/lib/safe-url";
import { closeCompanionPage, isTauriRuntime, openCompanionPage, placeCompanionPage } from "@/core/platform/terminal";
import { openExternalUrl } from "@/core/platform/desktop";
import { ChatMarkdown, copyChatText } from "@/domains/chat/ui/ChatMarkdown";
import { unfurlLink, type LinkPreview } from "@/domains/chat/ui/LinkPreviewCard";
import {
  hostOf,
  languageForName,
  rememberedFile,
  rememberedObjectUrl,
  tokenizeCodeLine,
  type AttachmentRef,
  type ChatSource,
} from "@/domains/chat/lib/chat-sources";

export type PreviewTarget = { kind: "link"; url: string } | { kind: "file"; file: AttachmentRef };

const NATIVE_SLUG = "chat-preview";
const WIDTH_KEY = "arrab.chatPreview.width";
export const PREVIEW_MIN_WIDTH = 300;

export function readPreviewWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(value) && value >= PREVIEW_MIN_WIDTH) return value;
  } catch {
    /* storage unavailable */
  }
  return 440;
}

function clampWidth(width: number): number {
  const max = Math.max(PREVIEW_MIN_WIDTH, Math.round((typeof window !== "undefined" ? window.innerWidth : 1440) * 0.6));
  return Math.min(max, Math.max(PREVIEW_MIN_WIDTH, Math.round(width)));
}

export function sourceTitle(source: ChatSource): string {
  return source.kind === "link" ? source.host : source.file.name;
}

function FileGlyph({ file, size = 15 }: { file: AttachmentRef; size?: number }) {
  if (file.kind === "image") return <ImageIcon size={size} aria-hidden />;
  if (file.kind === "text") return <FileCode2 size={size} aria-hidden />;
  return <FileText size={size} aria-hidden />;
}

/** Chip under a message that opens a link or file in the preview panel. */
export function ChatSourceChip({
  source,
  active,
  onOpen,
}: {
  source: ChatSource;
  active?: boolean;
  onOpen: (target: PreviewTarget) => void;
}) {
  const { t } = useLanguage();
  const title = sourceTitle(source);
  return (
    <button
      type="button"
      className={cn("cp-source-chip", source.kind === "link" ? "is-link" : "is-file", active && "is-active")}
      data-source-kind={source.kind}
      title={`${t("chatPreviewOpen")}: ${source.kind === "link" ? source.url : title}`}
      onClick={() => onOpen(source.kind === "link" ? { kind: "link", url: source.url } : { kind: "file", file: source.file })}
    >
      {source.kind === "link" ? <Globe size={13} aria-hidden /> : <FileGlyph file={source.file} size={13} />}
      <span dir="auto">{title}</span>
    </button>
  );
}

function WebPreview({ address }: { address: string }) {
  const { t } = useLanguage();
  const native = isTauriRuntime();
  const frameSrc = safeHttpUrl(address);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [card, setCard] = useState<LinkPreview | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setCard(undefined);
    if (!frameSrc) return;
    void unfurlLink(frameSrc).then((next) => {
      if (!cancelled) setCard(next);
    });
    return () => {
      cancelled = true;
    };
  }, [frameSrc]);

  const place = useCallback(() => {
    const node = hostRef.current;
    if (!native || !node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    void placeCompanionPage(NATIVE_SLUG, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).catch(() => undefined);
  }, [native]);

  useEffect(() => {
    if (!native || !frameSrc) return;
    let alive = true;
    void openCompanionPage(NATIVE_SLUG, frameSrc, hostOf(frameSrc), true)
      .then(() => {
        if (alive) place();
      })
      .catch(() => undefined);
    const node = hostRef.current;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place()) : null;
    if (node && observer) observer.observe(node);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      void closeCompanionPage(NATIVE_SLUG).catch(() => undefined);
    };
  }, [native, frameSrc, reloadKey, place]);

  if (!frameSrc) return null;
  return (
    <div className="cp-preview-web">
      <div className="cp-preview-addr">
        <Globe size={13} aria-hidden />
        <span dir="ltr" title={frameSrc}>
          {frameSrc}
        </span>
        <button
          type="button"
          className="cp-preview-icon"
          aria-label={t("chatPreviewReload")}
          title={t("chatPreviewReload")}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RotateCw size={13} />
        </button>
        <button
          type="button"
          className="cp-preview-icon"
          aria-label={t("chatPreviewOpenBrowser")}
          title={t("chatPreviewOpenBrowser")}
          onClick={() => void openExternalUrl(frameSrc)}
        >
          <ExternalLink size={13} />
        </button>
      </div>
      {card ? (
        <div className="cp-preview-site">
          {card.image ? <img src={card.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
          <div>
            <small>{card.siteName || hostOf(frameSrc)}</small>
            <strong dir="auto">{card.title}</strong>
            {card.description ? <em dir="auto">{card.description}</em> : null}
          </div>
        </div>
      ) : null}
      <div className="cp-preview-frame" ref={hostRef}>
        {native ? (
          <div className="cp-preview-native-note">{t("chatPreviewLoading")}</div>
        ) : (
          <iframe
            key={reloadKey}
            src={frameSrc}
            title={hostOf(frameSrc)}
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        )}
      </div>
      <div className="cp-preview-fallback">
        <span>{t("chatPreviewBlocked")}</span>
        <button type="button" onClick={() => void openExternalUrl(frameSrc)}>
          <ExternalLink size={13} aria-hidden />
          {t("chatPreviewOpenBrowser")}
        </button>
      </div>
    </div>
  );
}

function CodeView({ name, body }: { name: string; body: string }) {
  const language = languageForName(name);
  const lines = useMemo(() => body.replace(/\n$/, "").split("\n").slice(0, 4000), [body]);
  return (
    <pre className="cp-preview-code" dir="ltr" data-lang={language}>
      {lines.map((line, index) => (
        <div className="cp-preview-code-line" key={index}>
          <span className="cp-preview-ln" aria-hidden>
            {index + 1}
          </span>
          <code>
            {tokenizeCodeLine(line, language).map((token, tokenIndex) =>
              token.kind === "plain" ? (
                <span key={tokenIndex}>{token.text}</span>
              ) : (
                <span key={tokenIndex} className={`tok-${token.kind}`}>
                  {token.text}
                </span>
              ),
            )}
            {line ? null : "\u200b"}
          </code>
        </div>
      ))}
    </pre>
  );
}

function FilePreview({ file }: { file: AttachmentRef }) {
  const { t } = useLanguage();
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sessionText, setSessionText] = useState<string | null>(null);
  const local = rememberedFile(file.name);
  const isPdf = /\.pdf$/i.test(file.name) || file.mime === "application/pdf";
  const imageSrc = file.kind === "image" ? (file.dataUrl ?? rememberedObjectUrl(file.name, "image")) : null;
  const pdfSrc = isPdf ? rememberedObjectUrl(file.name, "pdf") : null;
  const body = file.text ?? sessionText;
  const language = languageForName(file.name);

  useEffect(() => {
    setRaw(false);
    setSessionText(null);
  }, [file.id]);

  const sizeKb = file.sizeKb ?? (local ? Math.max(1, Math.round(local.size / 1024)) : null);
  const mime = file.mime ?? (local?.type || null);
  const lineCount = body ? body.replace(/\n$/, "").split("\n").length : 0;

  async function copyBody() {
    if (!body) return;
    await copyChatText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="cp-preview-file">
      <div className="cp-preview-filebar">
        <FileGlyph file={file} />
        <strong dir="auto" title={file.name}>
          {file.name}
        </strong>
        <span className="cp-preview-meta">
          {[body ? language.toUpperCase() : mime, lineCount ? t("chatPreviewLines").replace("{count}", String(lineCount)) : null, sizeKb ? `${sizeKb} KB` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {body && language === "md" ? (
          <button type="button" className="cp-preview-pill" onClick={() => setRaw((value) => !value)}>
            {raw ? t("chatPreviewRendered") : t("chatPreviewRaw")}
          </button>
        ) : null}
        {body ? (
          <button
            type="button"
            className="cp-preview-icon"
            aria-label={copied ? t("copied") : t("copy")}
            title={copied ? t("copied") : t("copy")}
            onClick={() => void copyBody()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        ) : null}
      </div>
      <div className="cp-preview-filebody">
        {imageSrc ? (
          <div className="cp-preview-image">
            <img src={imageSrc} alt={file.name} />
          </div>
        ) : pdfSrc ? (
          <iframe className="cp-preview-pdf" src={pdfSrc} title={file.name} />
        ) : body ? (
          language === "md" && !raw ? (
            <div className="cp-preview-md">
              <ChatMarkdown content={body} />
            </div>
          ) : (
            <CodeView name={file.name} body={body} />
          )
        ) : (
          <div className="cp-preview-card">
            <FileGlyph file={file} size={28} />
            <strong dir="auto">{file.name}</strong>
            <dl>
              <dt>{t("chatPreviewType")}</dt>
              <dd dir="ltr">{mime || file.name.split(".").pop()?.toUpperCase() || "—"}</dd>
              <dt>{t("chatPreviewSize")}</dt>
              <dd dir="ltr">{sizeKb ? `${sizeKb} KB` : "—"}</dd>
            </dl>
            <p>{local || imageSrc ? t("chatPreviewNoInline") : t("chatPreviewSessionOnly")}</p>
            {local && !body && /^text\/|json|xml/.test(local.type) ? (
              <button type="button" className="cp-preview-pill" onClick={() => void local.text().then(setSessionText)}>
                {t("chatPreviewShowText")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatPreviewPanel({
  target,
  sources,
  width,
  onWidthChange,
  onSelect,
  onClose,
}: {
  target: PreviewTarget | null;
  sources: ChatSource[];
  width: number;
  onWidthChange: (width: number) => void;
  onSelect: (target: PreviewTarget | null) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const panelRef = useRef<HTMLElement | null>(null);
  const rtl = locale === "ar";

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (next: PointerEvent) => {
      const delta = rtl ? next.clientX - startX : startX - next.clientX;
      onWidthChange(clampWidth(startWidth + delta));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(WIDTH_KEY, String(clampWidth(panelRef.current?.offsetWidth || startWidth)));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (delta: number) => {
    const next = clampWidth(width + delta);
    onWidthChange(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  };

  const activeId =
    target?.kind === "link" ? `link:${target.url}` : target?.kind === "file" ? target.file.id : null;
  const heading =
    target?.kind === "link" ? hostOf(target.url) : target?.kind === "file" ? target.file.name : t("chatPreview");

  return (
    <aside
      ref={panelRef}
      className="cp-preview-panel"
      style={{ width }}
      aria-label={t("chatPreview")}
      data-preview-kind={target?.kind ?? "empty"}
    >
      <div
        className="cp-preview-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chatPreviewResize")}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") nudge(rtl ? -24 : 24);
          if (event.key === "ArrowRight") nudge(rtl ? 24 : -24);
        }}
      />
      <header className="cp-preview-head">
        <span className="cp-preview-kind">
          {target?.kind === "link" ? (
            <Globe size={14} aria-hidden />
          ) : target?.kind === "file" ? (
            <FileGlyph file={target.file} size={14} />
          ) : (
            <Layers size={14} aria-hidden />
          )}
        </span>
        <div className="cp-preview-title">
          <small>{target?.kind === "link" ? t("chatPreviewWeb") : target?.kind === "file" ? t("chatPreviewFile") : t("chatPreview")}</small>
          <strong dir="auto" title={heading}>
            {heading}
          </strong>
        </div>
        {sources.length > 1 || (target && sources.length) ? (
          <div className="cp-preview-tabs" role="tablist" aria-label={t("chatPreviewSources")}>
            {sources.slice(0, 6).map((source) => (
              <button
                key={source.id}
                type="button"
                role="tab"
                aria-selected={source.id === activeId}
                className={cn("cp-preview-tab", source.id === activeId && "is-active")}
                title={sourceTitle(source)}
                onClick={() =>
                  onSelect(source.kind === "link" ? { kind: "link", url: source.url } : { kind: "file", file: source.file })
                }
              >
                {source.kind === "link" ? <Globe size={12} aria-hidden /> : <FileGlyph file={source.file} size={12} />}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="cp-preview-icon"
          aria-label={t("chatPreviewClose")}
          title={t("chatPreviewClose")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <div className="cp-preview-body">
        {target?.kind === "link" ? (
          <WebPreview key={target.url} address={target.url} />
        ) : target?.kind === "file" ? (
          <FilePreview file={target.file} />
        ) : (
          <div className="cp-preview-empty">
            <Layers size={22} aria-hidden />
            <strong>{t("chatPreviewEmpty")}</strong>
            <p>{t("chatPreviewEmptyHint")}</p>
            {sources.length ? (
              <div className="cp-preview-list">
                <small>{t("chatPreviewSources")}</small>
                {sources.map((source) => (
                  <ChatSourceChip key={source.id} source={source} onOpen={onSelect} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
