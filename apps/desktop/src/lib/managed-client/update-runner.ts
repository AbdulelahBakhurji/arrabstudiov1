import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openExternalUrl } from "@/lib/desktop";
import { isTauriRuntime } from "@/lib/terminal";
import { isAllowlistedUrl } from "./allowlist";
import { storeUrlFor } from "./updates";

export type UpdatePhase = "checking" | "download" | "ready" | "install" | "restart" | "error" | "store";

export type UpdateProgress = { phase: UpdatePhase; percent: number };

export type PreparedUpdate =
  /** Signed Tauri updater: downloaded, waiting for "Install and restart". */
  | { kind: "signed"; version: string; installAndRestart: () => Promise<void> }
  /** Legacy DMG path: installs and relaunches on its own. */
  | { kind: "legacy" }
  /** Mobile / web: sent the user to the store or release page. */
  | { kind: "external" }
  | { kind: "none" };

function isDesktopShell(platform: string): boolean {
  return isTauriRuntime() && (platform === "macos" || platform === "windows" || platform === "linux");
}

async function trySignedUpdater(
  onProgress: (progress: UpdateProgress) => void,
): Promise<PreparedUpdate | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 20_000 });
    if (!update) return null;
    let total = 0;
    let received = 0;
    onProgress({ phase: "download", percent: 0 });
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        received += event.data.chunkLength;
        onProgress({
          phase: "download",
          percent: total ? Math.min(99, Math.round((received / total) * 100)) : 50,
        });
      }
      if (event.event === "Finished") onProgress({ phase: "ready", percent: 100 });
    });
    onProgress({ phase: "ready", percent: 100 });
    return {
      kind: "signed",
      version: update.version,
      installAndRestart: async () => {
        onProgress({ phase: "install", percent: 100 });
        await update.install();
        onProgress({ phase: "restart", percent: 100 });
        await invoke("managed_restart_app");
      },
    };
  } catch {
    // No signed release yet (or offline) — the caller falls back.
    return null;
  }
}

async function legacyInstaller(
  downloadUrl: string,
  onProgress: (progress: UpdateProgress) => void,
): Promise<PreparedUpdate> {
  const stop = await listen<{ phase: string; percent: number }>("app-update:progress", (event) => {
    const phase = event.payload.phase;
    onProgress({
      phase:
        phase === "install" ? "install" : phase === "restart" ? "restart" : phase === "error" ? "error" : "download",
      percent: event.payload.percent,
    });
  });
  try {
    onProgress({ phase: "download", percent: 0 });
    await invoke("install_app_update", { url: downloadUrl });
    return { kind: "legacy" };
  } finally {
    stop();
  }
}

/**
 * Desktop: signed updater first, then the DMG installer with `downloadUrl`.
 * Mobile: the right store for the vendor.
 */
export async function prepareUpdate(input: {
  platform: string;
  vendor: string;
  downloadUrl: string | null;
  onProgress: (progress: UpdateProgress) => void;
}): Promise<PreparedUpdate> {
  if (isDesktopShell(input.platform)) {
    input.onProgress({ phase: "checking", percent: 0 });
    const signed = await trySignedUpdater(input.onProgress);
    if (signed) return signed;
    if (input.downloadUrl && /^https:\/\//.test(input.downloadUrl)) {
      return legacyInstaller(input.downloadUrl, input.onProgress);
    }
    return { kind: "none" };
  }
  const url = storeUrlFor(input.platform, input.vendor, input.downloadUrl, isAllowlistedUrl);
  if (!url) return { kind: "none" };
  input.onProgress({ phase: "store", percent: 100 });
  await openExternalUrl(url);
  return { kind: "external" };
}
