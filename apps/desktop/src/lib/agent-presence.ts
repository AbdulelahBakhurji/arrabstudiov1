import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";
import { presenceDisplayCopy, sanitizePresenceText } from "./approval-copy";

export type AgentPresenceState = "working" | "thinking" | "needs_you" | "done" | "error";

export type AgentPresencePayload = {
  id: string;
  agentName: string;
  agentPhoto?: string | null;
  hue?: number;
  faceSeed?: number;
  title: string;
  body?: string;
  /** Multi-line file/command preview — never raw JSON. */
  preview?: string;
  progress?: number | null;
  state: AgentPresenceState;
  href?: string;
  /** When set, HUD shows Approve / Decline for this pending approval. */
  approvalId?: string | null;
};

const EVENT_UPDATE = "arrab:agent-presence:update";
const EVENT_HIDE = "arrab:agent-presence:hide";
export const PRESENCE_RESOLVE_EVENT = "arrab:presence-resolve";

export type PresenceResolveRequest = {
  approvalId: string;
  status: "approved" | "rejected";
};

let lastPayload: AgentPresencePayload | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function broadcastLocal(payload: AgentPresencePayload | null): void {
  if (payload) {
    window.dispatchEvent(new CustomEvent(EVENT_UPDATE, { detail: payload }));
  } else {
    window.dispatchEvent(new CustomEvent(EVENT_HIDE));
  }
}

export function getLastAgentPresence(): AgentPresencePayload | null {
  return lastPayload;
}

export function subscribeAgentPresence(
  onUpdate: (payload: AgentPresencePayload) => void,
  onHide?: () => void,
): () => void {
  const handleUpdate = (event: Event) => {
    onUpdate((event as CustomEvent<AgentPresencePayload>).detail);
  };
  const handleHide = () => onHide?.();
  window.addEventListener(EVENT_UPDATE, handleUpdate);
  window.addEventListener(EVENT_HIDE, handleHide);
  return () => {
    window.removeEventListener(EVENT_UPDATE, handleUpdate);
    window.removeEventListener(EVENT_HIDE, handleHide);
  };
}

export type PresenceResolveListener = (
  request: PresenceResolveRequest,
) => boolean | void;

/** Returns true when a listener claimed the approval (Chat / Cowork). */
export function subscribePresenceResolve(
  listener: PresenceResolveListener,
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<PresenceResolveRequest> & {
      detail: PresenceResolveRequest;
      __claimed?: boolean;
    };
    if (custom.__claimed) return;
    if (listener(custom.detail)) {
      custom.__claimed = true;
    }
  };
  window.addEventListener(PRESENCE_RESOLVE_EVENT, handler);
  return () => window.removeEventListener(PRESENCE_RESOLVE_EVENT, handler);
}

export function dispatchPresenceResolve(request: PresenceResolveRequest): boolean {
  const event = new CustomEvent(PRESENCE_RESOLVE_EVENT, {
    detail: request,
  }) as CustomEvent<PresenceResolveRequest> & { __claimed?: boolean };
  window.dispatchEvent(event);
  return Boolean(event.__claimed);
}

function normalizePayload(
  input: Omit<AgentPresencePayload, "id"> & { id?: string },
): AgentPresencePayload {
  const copy = presenceDisplayCopy({
    title: input.title,
    body: input.body,
    state: input.state,
  });
  const preview =
    (input.preview?.trim() && !input.preview.trim().startsWith("{")
      ? input.preview.trim()
      : undefined) ||
    copy.preview ||
    undefined;
  return {
    id: input.id ?? crypto.randomUUID(),
    agentName: input.agentName,
    agentPhoto: input.agentPhoto ?? null,
    hue: input.hue,
    faceSeed: input.faceSeed,
    title: sanitizePresenceText(copy.title, "Arrab"),
    body: sanitizePresenceText(copy.body, "") || undefined,
    preview,
    progress: input.progress ?? null,
    state: input.state,
    href: input.href,
    approvalId: input.approvalId ?? null,
  };
}

export async function showAgentPresence(
  input: Omit<AgentPresencePayload, "id"> & { id?: string },
): Promise<void> {
  clearHideTimer();
  const payload = normalizePayload(input);
  lastPayload = payload;
  broadcastLocal(payload);

  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("agent_presence_show", { payload });
  } catch {
    // Window create may fail in unsupported shells — in-app host still shows.
  }
}

export async function updateAgentPresence(
  patch: Partial<AgentPresencePayload> & { id?: string },
): Promise<void> {
  const base = lastPayload;
  if (!base && !patch.title) {
    return;
  }
  const mergedTitle = patch.title ?? base?.title ?? "Arrab";
  const mergedBody = patch.body !== undefined ? patch.body : base?.body;
  const nextState = patch.state ?? base?.state ?? "working";
  const copy = presenceDisplayCopy({
    title: mergedTitle,
    body: mergedBody,
    state: nextState,
  });
  const preview =
    (patch.preview !== undefined
      ? patch.preview?.trim() || undefined
      : base?.preview) ||
    copy.preview ||
    undefined;
  const payload: AgentPresencePayload = {
    id: patch.id ?? base?.id ?? crypto.randomUUID(),
    agentName: patch.agentName ?? base?.agentName ?? "Agent",
    agentPhoto: patch.agentPhoto !== undefined ? patch.agentPhoto : (base?.agentPhoto ?? null),
    hue: patch.hue ?? base?.hue,
    faceSeed: patch.faceSeed ?? base?.faceSeed,
    title: sanitizePresenceText(copy.title, "Arrab"),
    body: sanitizePresenceText(copy.body, "") || undefined,
    preview,
    progress: patch.progress !== undefined ? patch.progress : (base?.progress ?? null),
    state: nextState,
    href: patch.href !== undefined ? patch.href : base?.href,
    approvalId:
      patch.approvalId !== undefined ? patch.approvalId : (base?.approvalId ?? null),
  };
  lastPayload = payload;
  clearHideTimer();
  broadcastLocal(payload);

  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("agent_presence_update", { payload });
  } catch {
    // ignore
  }
}

export async function hideAgentPresence(delayMs = 0): Promise<void> {
  clearHideTimer();
  const run = async () => {
    lastPayload = null;
    broadcastLocal(null);
    if (!isTauriRuntime()) return;
    try {
      await invoke("agent_presence_hide");
    } catch {
      // ignore
    }
  };
  if (delayMs > 0) {
    hideTimer = setTimeout(() => {
      void run();
    }, delayMs);
    return;
  }
  await run();
}

/** Cinematic demo: face pops in, progress climbs, then settles on done. */
export async function demoAgentPresence(input?: {
  agentName?: string;
  agentPhoto?: string | null;
  hue?: number;
  faceSeed?: number;
}): Promise<void> {
  const agentName = input?.agentName ?? "Trader";
  await showAgentPresence({
    agentName,
    agentPhoto: input?.agentPhoto ?? null,
    hue: input?.hue ?? 168,
    faceSeed: input?.faceSeed ?? 91,
    title: "Scanning markets…",
    body: "Pulling live quote and news",
    progress: 0.08,
    state: "thinking",
  });

  const steps: Array<{
    title: string;
    body: string;
    progress: number;
    state: AgentPresenceState;
  }> = [
    {
      title: "Fetching AAPL quote",
      body: "Finnhub · live price",
      progress: 0.35,
      state: "working",
    },
    {
      title: "Reading catalysts",
      body: "Company headlines loading",
      progress: 0.68,
      state: "working",
    },
    {
      title: "Needs your approval",
      body: "Send tidy-up plan to inbox",
      progress: 0.86,
      state: "needs_you",
    },
    {
      title: "Ready for you",
      body: "Tap to open the conversation",
      progress: 1,
      state: "done",
    },
  ];

  for (const [index, step] of steps.entries()) {
    await new Promise((resolve) => window.setTimeout(resolve, 700 + index * 180));
    await updateAgentPresence(step);
  }
  await hideAgentPresence(2800);
}
