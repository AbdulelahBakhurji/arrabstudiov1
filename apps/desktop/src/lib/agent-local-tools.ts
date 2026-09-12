/**
 * Client-side execution helpers for Arrab agent tools that must run on the desk
 * (filesystem + terminal). Shared by Cowork and Chat.
 */
import { listDir, readTextFile, searchWorkspace, writeTextFile } from "./fs";
import { isTauriRuntime, runLocalCommand } from "./terminal";

export const CLIENT_EXEC_TOOLS = new Set([
  "run_terminal",
  "list_files",
  "search_code",
  "read_file",
  "write_file",
  "apply_patch",
]);

/** Read-only tools — auto-run without an approval card. */
export const AUTO_CLIENT_TOOLS = new Set(["list_files", "read_file", "search_code"]);

/** Mutating tools — respect Ask / Allow everything policy. */
export const POLICY_CLIENT_TOOLS = new Set([
  "run_terminal",
  "write_file",
  "apply_patch",
]);

export function isClientExecTool(name: string): boolean {
  return CLIENT_EXEC_TOOLS.has(name);
}

export function isAutoClientTool(name: string): boolean {
  return AUTO_CLIENT_TOOLS.has(name);
}

export function isPolicyClientTool(name: string): boolean {
  return POLICY_CLIENT_TOOLS.has(name);
}

export type LocalToolArgs = Record<string, string>;

export type LocalToolExecResult = {
  ok: boolean;
  summary: string;
  /** Full text returned to the model as TOOL_RESULT. */
  toolResult: string;
};

export type EditCheckpoint = {
  id: string;
  path: string;
  content: string;
  folderPath: string;
  createdAt: string;
  reason: "write_file" | "apply_patch";
};

const CHECKPOINT_KEY = "arrab.editCheckpoints";
const MAX_CHECKPOINTS = 40;

function normalizeRel(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

function readCheckpoints(): EditCheckpoint[] {
  try {
    return JSON.parse(localStorage.getItem(CHECKPOINT_KEY) ?? "[]") as EditCheckpoint[];
  } catch {
    return [];
  }
}

function writeCheckpoints(items: EditCheckpoint[]) {
  localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(items.slice(0, MAX_CHECKPOINTS)));
}

export function listEditCheckpoints(folderPath?: string | null): EditCheckpoint[] {
  const all = readCheckpoints();
  if (!folderPath) return all;
  return all.filter((item) => item.folderPath === folderPath);
}

export async function restoreEditCheckpoint(
  checkpointId: string,
): Promise<{ ok: boolean; path: string; message: string }> {
  const item = readCheckpoints().find((entry) => entry.id === checkpointId);
  if (!item) {
    return { ok: false, path: "", message: "Checkpoint not found" };
  }
  await writeTextFile(item.folderPath, item.path, item.content);
  return { ok: true, path: item.path, message: `Restored ${item.path}` };
}

async function pushCheckpoint(
  folderPath: string,
  relativePath: string,
  reason: EditCheckpoint["reason"],
) {
  try {
    const file = await readTextFile(folderPath, relativePath);
    const next: EditCheckpoint = {
      id: crypto.randomUUID(),
      path: relativePath,
      content: file.content,
      folderPath,
      createdAt: new Date().toISOString(),
      reason,
    };
    writeCheckpoints([next, ...readCheckpoints().filter((item) => !(item.folderPath === folderPath && item.path === relativePath))]);
  } catch {
    // new file — no prior content to checkpoint
  }
}

export async function executeLocalAgentTool(
  toolName: string,
  args: LocalToolArgs,
  folderPath: string | null,
  options?: {
    onTerminal?: (kind: "input" | "stdout" | "stderr" | "system" | "error", text: string) => void;
  },
): Promise<LocalToolExecResult> {
  if (!folderPath) {
    const msg = "ERROR: No local folder is open. Ask the operator to open a folder first.";
    return { ok: false, summary: msg, toolResult: msg };
  }
  if (!isTauriRuntime()) {
    const msg = "ERROR: Local tools require the Arrab Studio desktop app.";
    return { ok: false, summary: msg, toolResult: msg };
  }

  try {
    switch (toolName) {
      case "list_files": {
        const relative = normalizeRel(args.relative || args.path || "");
        const listed = await listDir(folderPath, relative);
        const lines = listed.entries
          .slice(0, 120)
          .map((entry) => `${entry.kind}\t${entry.path}`)
          .join("\n");
        const toolResult = [
          `Listed ${listed.entries.length} entries under ${relative || "."}`,
          lines || "(empty)",
        ].join("\n");
        return {
          ok: true,
          summary: `Listed ${listed.entries.length} files in ${relative || "."}`,
          toolResult,
        };
      }
      case "search_code": {
        const query = (args.query || "").trim();
        if (!query) {
          const msg = "ERROR: search_code requires query.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        const searched = await searchWorkspace(folderPath, {
          query,
          relative: normalizeRel(args.path || args.relative || ""),
          glob: args.glob || undefined,
          caseSensitive: args.case_sensitive === "true" || args.caseSensitive === "true",
        });
        const blocks = searched.matches.slice(0, 40).map((match) => {
          const hits = match.hits
            .map((hit) => `  L${hit.line}: ${hit.text}`)
            .join("\n");
          return `${match.path}\n${hits}`;
        });
        const toolResult = [
          `SEARCH "${query}" — ${searched.matchCount} files (scanned ${searched.filesScanned})`,
          blocks.join("\n\n") || "(no matches)",
        ].join("\n");
        return {
          ok: true,
          summary: `Found ${searched.matchCount} files for "${query.slice(0, 40)}"`,
          toolResult,
        };
      }
      case "read_file": {
        const path = normalizeRel(args.path || args.relative || "");
        if (!path) {
          const msg = "ERROR: read_file requires path.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        const file = await readTextFile(folderPath, path);
        const truncated =
          file.content.length > 40_000
            ? `${file.content.slice(0, 40_000)}\n\n…(truncated ${file.content.length - 40_000} chars)`
            : file.content;
        const toolResult = [
          `READ ${path} (${file.size} bytes)`,
          "-----",
          truncated,
        ].join("\n");
        return {
          ok: true,
          summary: `Read ${path} (${file.size} bytes)`,
          toolResult,
        };
      }
      case "write_file": {
        const path = normalizeRel(args.path || "");
        const content = args.content ?? "";
        if (!path) {
          const msg = "ERROR: write_file requires path.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        await pushCheckpoint(folderPath, path, "write_file");
        const saved = await writeTextFile(folderPath, path, content);
        const toolResult = `WROTE ${path} (${saved.size} bytes). Previous version checkpointed.`;
        return { ok: true, summary: toolResult, toolResult };
      }
      case "apply_patch": {
        const path = normalizeRel(args.path || "");
        const oldString = args.old_string ?? args.oldString ?? "";
        const newString = args.new_string ?? args.newString ?? "";
        if (!path) {
          const msg = "ERROR: apply_patch requires path.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        if (!oldString) {
          const msg = "ERROR: apply_patch requires old_string.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        const file = await readTextFile(folderPath, path);
        if (!file.content.includes(oldString)) {
          const msg = `ERROR: old_string not found in ${path}. Re-read the file and retry with an exact match.`;
          return { ok: false, summary: msg, toolResult: msg };
        }
        const occurrences = file.content.split(oldString).length - 1;
        if (occurrences > 1) {
          const msg = `ERROR: old_string matched ${occurrences} times in ${path}. Provide a more unique old_string.`;
          return { ok: false, summary: msg, toolResult: msg };
        }
        await pushCheckpoint(folderPath, path, "apply_patch");
        const next = file.content.replace(oldString, newString);
        const saved = await writeTextFile(folderPath, path, next);
        const toolResult = `PATCHED ${path} (${saved.size} bytes). Replaced ${oldString.length}→${newString.length} chars. Checkpoint saved.`;
        return { ok: true, summary: toolResult, toolResult };
      }
      case "run_terminal": {
        const command = (args.command || "").trim();
        if (!command) {
          const msg = "ERROR: run_terminal requires command.";
          return { ok: false, summary: msg, toolResult: msg };
        }
        options?.onTerminal?.("input", command);
        const result = await runLocalCommand(command, folderPath);
        if (result.stdout.trim()) {
          options?.onTerminal?.("stdout", result.stdout.trimEnd());
        }
        if (result.stderr.trim()) {
          options?.onTerminal?.("stderr", result.stderr.trimEnd());
        }
        options?.onTerminal?.("system", `exit ${result.code}`);
        const toolResult = [
          `exit_code=${result.code}`,
          result.stdout.trim()
            ? `stdout:\n${result.stdout.trim().slice(0, 12000)}`
            : "stdout: (empty)",
          result.stderr.trim()
            ? `stderr:\n${result.stderr.trim().slice(0, 4000)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          ok: result.code === 0,
          summary: `exit ${result.code}: ${command.slice(0, 80)}`,
          toolResult,
        };
      }
      default: {
        const msg = `ERROR: Unknown local tool '${toolName}'.`;
        return { ok: false, summary: msg, toolResult: msg };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    options?.onTerminal?.("error", message);
    const toolResult = `ERROR: ${message}`;
    return { ok: false, summary: toolResult, toolResult };
  }
}

export function parseToolNameFromApproval(detail: string | null, title: string): string | null {
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as { toolName?: string };
      if (parsed.toolName) return parsed.toolName;
    } catch {
      // fall through
    }
  }
  if (title.startsWith("Run:")) return "run_terminal";
  if (title.startsWith("Write:")) return "write_file";
  if (title.startsWith("Patch:")) return "apply_patch";
  if (title.startsWith("Read:")) return "read_file";
  if (title.startsWith("List:")) return "list_files";
  if (title.startsWith("Search:")) return "search_code";
  return null;
}

export function parseToolArgsFromApproval(detail: string | null): LocalToolArgs {
  if (!detail) return {};
  try {
    const parsed = JSON.parse(detail) as { arguments?: LocalToolArgs };
    return parsed.arguments ?? {};
  } catch {
    return {};
  }
}

/** Human-readable patch/write preview for approval cards. */
export function formatToolDiffPreview(toolName: string | null, args: LocalToolArgs): string {
  if (toolName === "apply_patch") {
    const path = args.path || "file";
    const oldString = args.old_string ?? args.oldString ?? "";
    const newString = args.new_string ?? args.newString ?? "";
    return [
      `File: ${path}`,
      "----- REMOVE -----",
      oldString.slice(0, 1200) || "(empty)",
      "----- ADD -----",
      newString.slice(0, 1200) || "(empty)",
    ].join("\n");
  }
  if (toolName === "write_file") {
    const path = args.path || "file";
    const content = args.content ?? "";
    return [
      `File: ${path}`,
      `Size: ${content.length} chars`,
      "----- NEW CONTENTS (preview) -----",
      content.slice(0, 1600) || "(empty)",
    ].join("\n");
  }
  if (toolName === "run_terminal") return args.command || "";
  if (toolName === "search_code") return `query: ${args.query || ""}`;
  if (toolName === "read_file" || toolName === "list_files") {
    return args.path || args.relative || "";
  }
  return "";
}
