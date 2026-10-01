import { invoke } from "@tauri-apps/api/core";

export type TerminalLine = {
  id: string;
  kind: "system" | "input" | "stdout" | "stderr" | "error";
  text: string;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await invoke<string | null>("pick_folder");
  return selected;
}

export async function runLocalCommand(
  command: string,
  cwd?: string | null,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return invoke("run_local_command", {
    command,
    cwd: cwd ?? null,
  });
}

export async function runSandboxCommand(
  command: string,
  companion?: string,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  sealed: boolean;
}> {
  return invoke("run_sandbox_command", { command, companion: companion ?? null });
}

export async function sandboxDesktop(companion: string): Promise<{ files: { name: string; bytes: number }[] }> {
  return invoke("sandbox_desktop", { companion });
}

export async function sandboxReadFile(companion: string, name: string): Promise<{ text: string }> {
  return invoke("sandbox_read_file", { companion, name });
}

export async function sandboxWriteFile(companion: string, name: string, text: string): Promise<void> {
  await invoke("sandbox_write_file", { companion, name, text });
}

export async function openCompanionPage(
  companion: string,
  url: string,
  title: string,
  chromeless = false,
): Promise<void> {
  await invoke("open_companion_page", { companion, url, title, chromeless });
}

export async function sandboxStoreFiles(companion: string, paths: string[]): Promise<void> {
  await invoke("sandbox_store_files", { companion, paths });
}

export async function sandboxImportFile(companion: string): Promise<{ saved: boolean; name?: string }> {
  return invoke("sandbox_import_file", { companion });
}

export async function placeCompanionPage(
  companion: string,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await invoke("place_companion_page", { companion, ...bounds });
}

export async function closeCompanionPage(companion: string): Promise<void> {
  await invoke("close_companion_page", { companion });
}

export async function openCompanionBrowser(companion: string, url: string): Promise<void> {
  await invoke("open_companion_browser", { companion, url });
}

export async function sandboxHandoff(from: string, to: string, text: string): Promise<void> {
  await invoke("sandbox_handoff", { from, to, text });
}

export async function openCompanionSandbox(): Promise<void> {
  await invoke("open_companion_sandbox");
}
