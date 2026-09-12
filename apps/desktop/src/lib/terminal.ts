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
