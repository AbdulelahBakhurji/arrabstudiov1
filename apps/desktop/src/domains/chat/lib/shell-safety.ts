/**
 * Helpers for the few agent tools that still build a shell command from model-supplied values.
 * A path chosen by a model is untrusted input: it must reach a shell only as a single, inert,
 * single-quoted word.
 */

/** POSIX single-quote a value so the shell treats it as one literal word (no `$()`, backticks, globs). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Accept only a workspace-relative path: no NUL/newlines, no absolute or drive-letter paths, no `..`
 * segments, and no leading `-` that a program could mistake for an option.
 */
export function assertWorkspaceRelative(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!cleaned) throw new Error("A file path is required");
  if (/[\u0000-\u001f\u007f]/.test(cleaned))
    throw new Error("That path contains control characters");
  if (cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith("~")) {
    throw new Error("Use a path inside the open folder");
  }
  if (cleaned.split("/").some((segment) => segment === "..")) {
    throw new Error("Paths may not leave the open folder");
  }
  if (cleaned.startsWith("-")) throw new Error("A path may not start with '-'");
  return cleaned;
}

/**
 * git can execute code named in a repository's own config (`core.fsmonitor`, external diff and
 * textconv drivers, pagers). Agent-run git commands switch those off, so opening an untrusted
 * checkout and asking "what changed?" cannot run the checkout's code.
 */
export const GIT_SAFE =
  "git -c core.fsmonitor=false -c core.pager=cat -c diff.external= --no-pager";
