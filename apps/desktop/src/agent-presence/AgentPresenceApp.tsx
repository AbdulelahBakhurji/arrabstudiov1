/**
 * Floating macOS agent presence — glass card, swipe-to-dismiss,
 * quick actions on every notification.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import type { AgentPresencePayload } from "@/lib/agent-presence";
import { PRESENCE_RESOLVE_EVENT } from "@/lib/agent-presence";
import { presenceDisplayCopy } from "@/lib/approval-copy";
import { companionPortraitUrl } from "@/lib/companion-portrait";

function clampProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stateLabel(state: string): string {
  switch (state) {
    case "thinking":
      return "Thinking";
    case "needs_you":
      return "Needs you";
    case "done":
      return "Done";
    case "error":
      return "Blocked";
    default:
      return "Working";
  }
}

const SWIPE_DISMISS_PX = 96;

export function AgentPresenceApp() {
  const [payload, setPayload] = useState<AgentPresencePayload | null>(null);
  const [visible, setVisible] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ startX: number; active: boolean }>({ startX: 0, active: false });

  const hide = useCallback(() => {
    setDismissing(true);
    window.setTimeout(() => {
      setVisible(false);
      setDismissing(false);
      setDragX(0);
      void invoke("agent_presence_hide").catch(() => undefined);
    }, 220);
  }, []);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    void (async () => {
      try {
        unsubs.push(
          await listen<AgentPresencePayload>("agent-presence:update", (event) => {
            setPayload(event.payload);
            setVisible(true);
            setDismissing(false);
            setDragX(0);
            setBusy(false);
          }),
        );
        unsubs.push(
          await listen("agent-presence:hide", () => {
            setVisible(false);
            setDragX(0);
          }),
        );
      } catch {
        // Running outside Tauri — ignore
      }
    })();
    return () => {
      for (const off of unsubs) off();
    };
  }, []);

  const copy = useMemo(
    () =>
      presenceDisplayCopy({
        title: payload?.title,
        body: payload?.body,
        state: payload?.state,
      }),
    [payload?.title, payload?.body, payload?.state],
  );
  const preview = payload?.preview?.trim() || copy.preview || "";

  async function resolve(status: "approved" | "rejected") {
    if (!payload?.approvalId || busy) return;
    setBusy(true);
    const request = { approvalId: payload.approvalId, status };
    try {
      await emit(PRESENCE_RESOLVE_EVENT, request);
    } catch {
      // Main window may still pick this up via local bridge when embedded.
    }
    hide();
  }

  async function openStudio() {
    void invoke("agent_presence_focus_studio").catch(() => undefined);
    hide();
  }

  if (!payload || !visible) {
    return <div className="ap-root is-empty" />;
  }

  const progress = clampProgress(payload.progress);
  const hue = payload.hue ?? 210;
  const seed = payload.faceSeed ?? 42;
  const ring = 2 * Math.PI * 34;
  const dash = ring * (1 - progress);
  const canApprove = Boolean(payload.approvalId);
  const faceState =
    payload.state === "needs_you"
      ? "speaking"
      : payload.state === "done"
        ? "lit"
        : payload.state === "thinking"
          ? "contributing"
          : "lit";

  const opacity = dismissing ? 0 : Math.max(0.25, 1 - Math.abs(dragX) / 180);

  return (
    <div
      className={`ap-root is-visible state-${payload.state} has-actions${preview ? " has-preview" : ""}${dismissing ? " is-dismissing" : ""}`}
      style={{
        ["--ap-hue" as string]: hue,
        transform: `translateX(${dragX}px)`,
        opacity,
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button.ap-action")) return;
        dragRef.current = { startX: event.clientX, active: true };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current.active) return;
        setDragX(event.clientX - dragRef.current.startX);
      }}
      onPointerUp={() => {
        if (!dragRef.current.active) return;
        dragRef.current.active = false;
        if (Math.abs(dragX) >= SWIPE_DISMISS_PX) {
          hide();
        } else {
          setDragX(0);
        }
      }}
      onPointerCancel={() => {
        dragRef.current.active = false;
        setDragX(0);
      }}
    >
      <div className="ap-card">
        <span className="ap-glass" aria-hidden />
        <span className="ap-aurora" aria-hidden />
        <button
          type="button"
          className="ap-main"
          onClick={() => {
            if (Math.abs(dragX) > 8) return;
            void invoke("agent_presence_focus_studio").catch(() => undefined);
          }}
        >
          <span className="ap-face-wrap">
            <svg className="ap-ring" viewBox="0 0 80 80" aria-hidden>
              <circle className="ap-ring-track" cx="40" cy="40" r="34" />
              <circle
                className="ap-ring-value"
                cx="40"
                cy="40"
                r="34"
                strokeDasharray={`${ring}`}
                strokeDashoffset={dash}
              />
            </svg>
            <PhotoAvatar
              src={
                payload.agentPhoto ||
                companionPortraitUrl({
                  seed,
                  name: payload.agentName,
                  size: 256,
                })
              }
              name={payload.agentName}
              size="lg"
              state={faceState}
              fallbackHue={hue}
              fallbackSeed={seed}
            />
            <span className="ap-pulse" aria-hidden />
          </span>

          <span className="ap-copy">
            <span className="ap-kicker">
              <span className="ap-dot" />
              {stateLabel(payload.state)}
              {typeof payload.progress === "number" ? (
                <span className="ap-pct">{Math.round(progress * 100)}%</span>
              ) : null}
            </span>
            <span className="ap-name">{payload.agentName}</span>
            <span className="ap-title">{copy.title}</span>
            {copy.body ? <span className="ap-body">{copy.body}</span> : null}
            {preview ? <pre className="ap-preview">{preview}</pre> : null}
            <span className="ap-hint">Swipe to hide</span>
          </span>
        </button>

        <div className="ap-actions">
          {canApprove ? (
            <>
              <button
                type="button"
                className="ap-action is-decline"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  void resolve("rejected");
                }}
              >
                Decline
              </button>
              <button
                type="button"
                className="ap-action is-approve"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  void resolve("approved");
                }}
              >
                Approve
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ap-action is-decline"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  hide();
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="ap-action is-approve"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  void openStudio();
                }}
              >
                Open
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
