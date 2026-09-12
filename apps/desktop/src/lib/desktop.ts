import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  await invoke("set_always_on_top", { enabled });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
