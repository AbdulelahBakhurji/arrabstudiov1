import { useEffect, useRef, type FormEvent } from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { ChatMarkdown } from "@/domains/chat/ui/ChatMarkdown";
import { companionDisplayName } from "@/domains/companions/catalog/catalog";
import type { CompanionProfile } from "@/domains/companions/model/companions";
import { PersonAvatar } from "@/domains/companions/ui/CompanionUI";
import { useCompanionRoom } from "@/domains/companions/ui/hooks/useCompanionRoom";
import { useLanguage } from "@/shared/i18n/LanguageProvider";

export function SpaceChatPanel({
  person,
  spaceName,
  pageTitle,
  pageMarkdown,
  sessionKey,
}: {
  person: CompanionProfile;
  spaceName: string;
  pageTitle: string;
  pageMarkdown: string;
  /** Stable key so each Space page keeps its own thread. */
  sessionKey: string;
}) {
  const { locale } = useLanguage();
  const ar = locale === "ar";
  const room = useCompanionRoom(person, `space:${sessionKey}`);
  const {
    lines,
    draft,
    setDraft,
    busy,
    loading,
    thinkingLabel,
    error,
    notice,
    send,
    stop,
  } = room;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef({ title: pageTitle, markdown: pageMarkdown, spaceName });
  pageRef.current = { title: pageTitle, markdown: pageMarkdown, spaceName };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, busy, thinkingLabel]);

  async function sendDraft() {
    const text = draft.trim();
    if (!text || busy || loading) return;
    const page = pageRef.current;
    const excerpt = page.markdown.trim().slice(0, 6000);
    await send(text, {
      workspaceHint: {
        kind: "none",
        operatorDirectives: [
          `SPACE DOCUMENT CHAT.`,
          `Space: ${page.spaceName || "Space"}.`,
          `Page title: ${page.title || "Untitled"}.`,
          `They are editing this page in Arrab Spaces. Help with writing, structure, research, and edits.`,
          `When suggesting changes, be concrete. Prefer short revised passages they can paste.`,
          excerpt
            ? `Current page markdown (may be truncated):\n---\n${excerpt}\n---`
            : "The page body is currently empty.",
        ].join("\n"),
        sessionNotes: `Space page chat with ${companionDisplayName(person, locale)} about "${page.title || "Untitled"}".`,
        openFilePath: page.title || "Untitled",
        openFileContent: excerpt || null,
      },
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendDraft();
  }

  return (
    <div className="sp-chat" aria-label={ar ? "محادثة الصفحة" : "Page chat"}>
      <header className="sp-chat-head">
        <PersonAvatar person={person} size="sm" state={busy ? "speaking" : undefined} />
        <div>
          <strong>{companionDisplayName(person, locale)}</strong>
          <small>
            {ar ? "محادثة على هذه الصفحة" : "Chat about this page"}
          </small>
        </div>
      </header>

      <div className="sp-chat-messages" ref={scrollerRef}>
        {lines.length === 0 && !busy ? (
          <div className="sp-chat-empty">
            <p>
              {ar
                ? `اسأل ${companionDisplayName(person, locale)} عن هذا المستند — تلخيص، صياغة، أو أفكار.`
                : `Ask ${companionDisplayName(person, locale)} about this document — rewrite, outline, or ideas.`}
            </p>
          </div>
        ) : null}
        {lines.map((line) => (
          <div
            key={line.id}
            className={`sp-chat-line ${line.who === "me" ? "is-me" : "is-companion"}`}
          >
            {line.who === "companion" ? (
              <ChatMarkdown content={line.text} />
            ) : (
              <p>{line.text}</p>
            )}
          </div>
        ))}
        {busy ? (
          <div className="sp-chat-line is-companion is-busy">
            <Loader2 size={14} className="animate-spin" />
            <span>{thinkingLabel || (ar ? "يفكّر…" : "Thinking…")}</span>
          </div>
        ) : null}
        {notice ? <p className="sp-chat-notice">{notice}</p> : null}
        {error ? <p className="sp-chat-error">{error}</p> : null}
      </div>

      <form className="sp-chat-composer" onSubmit={(event) => void onSubmit(event)}>
        <textarea
          className="cp-input"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            ar
              ? `رسالة إلى ${companionDisplayName(person, locale)}…`
              : `Message ${companionDisplayName(person, locale)}…`
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendDraft();
            }
          }}
          disabled={loading}
        />
        {busy ? (
          <button type="button" className="cp-button" onClick={() => stop()} aria-label={ar ? "إيقاف" : "Stop"}>
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="cp-button cp-primary"
            disabled={!draft.trim() || loading}
            aria-label={ar ? "إرسال" : "Send"}
          >
            <ArrowUp size={14} />
          </button>
        )}
      </form>
    </div>
  );
}
