/**
 * In-app fallback when the native floating window is unavailable (web / early boot).
 * Mirrors the macOS HUD so the experience stays wow even without Tauri.
 */
import { useEffect, useMemo, useState } from "react";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import {
  getLastAgentPresence,
  subscribeAgentPresence,
  type AgentPresencePayload,
} from "@/lib/agent-presence";
import { presenceDisplayCopy } from "@/lib/approval-copy";
import { companionPortraitUrl } from "@/lib/companion-portrait";
import { isTauriRuntime } from "@/lib/terminal";
import { cn } from "@/lib/utils";
import "@/agent-presence/agent-presence.css";

function clampProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function AgentPresenceHost() {
  const [payload, setPayload] = useState<AgentPresencePayload | null>(() => getLastAgentPresence());
  const [visible, setVisible] = useState(() => Boolean(getLastAgentPresence()));

  useEffect(() => {
    return subscribeAgentPresence(
      (next) => {
        setPayload(next);
        setVisible(true);
      },
      () => setVisible(false),
    );
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

  // Native Tauri HUD owns the screen-edge presence; keep in-app host for browser only.
  if (isTauriRuntime()) {
    return null;
  }

  if (!payload || !visible) {
    return null;
  }

  const progress = clampProgress(payload.progress);
  const hue = payload.hue ?? 210;
  const seed = payload.faceSeed ?? 42;
  const ring = 2 * Math.PI * 34;
  const dash = ring * (1 - progress);
  const faceState =
    payload.state === "needs_you"
      ? "speaking"
      : payload.state === "done"
        ? "lit"
        : payload.state === "thinking"
          ? "contributing"
          : "lit";

  return (
    <div
      className={cn(
        "ap-host-fixed",
        `state-${payload.state}`,
        preview ? "has-preview" : "",
      )}
      style={{ ["--ap-hue" as string]: hue }}
      role="status"
      aria-live="polite"
    >
      <div className={`ap-root is-visible state-${payload.state}${preview ? " has-preview" : ""}`}>
        <div className="ap-card" role="presentation">
          <span className="ap-aurora" aria-hidden />
          <div className="ap-main">
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
                {payload.state.replace("_", " ")}
                {typeof payload.progress === "number" ? (
                  <span className="ap-pct">{Math.round(progress * 100)}%</span>
                ) : null}
              </span>
              <span className="ap-name">{payload.agentName}</span>
              <span className="ap-title">{copy.title}</span>
              {copy.body ? <span className="ap-body">{copy.body}</span> : null}
              {preview ? <pre className="ap-preview">{preview}</pre> : null}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
