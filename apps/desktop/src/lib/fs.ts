import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./terminal";

export type FsEntry = {
  name: string;
  path: string;
  kind: "dir" | "file" | "other";
  size: number;
};

export type SearchHit = {
  line: number;
  text: string;
};

export type SearchMatch = {
  path: string;
  hits: SearchHit[];
};

export type SearchWorkspaceResult = {
  query: string;
  filesScanned: number;
  matchCount: number;
  matches: SearchMatch[];
};

export async function listDir(
  root: string,
  relative = "",
): Promise<{ path: string; entries: FsEntry[] }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("list_dir", { root, relative: relative || null });
}

export async function readTextFile(
  root: string,
  relative: string,
): Promise<{ path: string; content: string; size: number }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("read_text_file", { root, relative });
}

export async function writeTextFile(
  root: string,
  relative: string,
  content: string,
): Promise<{ path: string; size: number; savedAt: number }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("write_text_file", { root, relative, content });
}

export async function searchWorkspace(
  root: string,
  options: {
    query: string;
    relative?: string;
    glob?: string;
    caseSensitive?: boolean;
  },
): Promise<SearchWorkspaceResult> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("search_workspace", {
    root,
    query: options.query,
    relative: options.relative || null,
    glob: options.glob || null,
    caseSensitive: options.caseSensitive ?? false,
  });
}

export async function deletePath(
  root: string,
  relative: string,
): Promise<{ path: string; deleted: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("delete_path", { root, relative });
}

export async function renamePath(
  root: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("rename_path", { root, from, to });
}

export async function createDir(
  root: string,
  relative: string,
): Promise<{ path: string; created: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("create_dir", { root, relative });
}

export async function openPath(
  root: string,
  relative = "",
): Promise<{ path: string; opened: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("Desktop app required");
  }
  return invoke("open_path", { root, relative: relative || null });
}
