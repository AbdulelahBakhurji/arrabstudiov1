/**
 * Resolves Approve / Decline from the floating presence HUD into Chat / Cowork
 * when they own the pending approval; otherwise hits the Arrab API directly.
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { arrabApi } from "@/lib/api";
import {
  dispatchPresenceResolve,
  hideAgentPresence,
  PRESENCE_RESOLVE_EVENT,
  type PresenceResolveRequest,
} from "@/lib/agent-presence";
import { pushToast } from "@/lib/notify";
import { isApprovalId } from "@/lib/ask-guard";
import { isTauriRuntime } from "@/lib/terminal";

async function handleResolve(request: PresenceResolveRequest): Promise<void> {
  if (
    (request.status !== "approved" && request.status !== "rejected") ||
    !isApprovalId(request.approvalId)
  ) {
    return;
  }

  try {
    const pending = await arrabApi.pendingApprovals();
    if (!pending.items.some((item) => item.id === request.approvalId)) {
      pushToast({
        title: "That approval is no longer waiting",
        tone: "warn",
      });
      void hideAgentPresence();
      return;
    }
  } catch {
    pushToast({
      title: "Couldn’t confirm that approval",
      tone: "warn",
    });
    return;
  }

  const claimed = dispatchPresenceResolve(request);
  if (claimed) {
    void hideAgentPresence();
    return;
  }

  try {
    await arrabApi.resolveApproval(request.approvalId, { status: request.status });
    pushToast({
      title: request.status === "approved" ? "Approved" : "Declined",
      tone: request.status === "approved" ? "success" : "info",
    });
  } catch (err: unknown) {
    pushToast({
      title: "Couldn’t resolve approval",
      body: err instanceof Error ? err.message : undefined,
      tone: "warn",
    });
  } finally {
    void hideAgentPresence();
  }
}

export function PresenceApprovalBridge() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (isTauriRuntime()) {
      void listen<PresenceResolveRequest>(PRESENCE_RESOLVE_EVENT, (event) => {
        void handleResolve(event.payload);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}
