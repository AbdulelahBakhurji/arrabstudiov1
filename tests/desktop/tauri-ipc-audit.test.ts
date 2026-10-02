/**
 * Static audit of the Tauri IPC surface. A new command that forgets its window check, a capability
 * that quietly grants shell/fs/http, or a frontend call to a command that does not exist, fails here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TAURI = path.join(ROOT, "apps/desktop/src-tauri");
const lib = readFileSync(path.join(TAURI, "src/lib.rs"), "utf8");

/** { name → body } for every `#[tauri::command]` function (found by brace matching). */
function commands(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of lib.split("#[tauri::command]").slice(1)) {
    const match = part.match(/(?:async\s+)?fn\s+(\w+)/);
    if (!match) continue;
    // The signature may contain braces-free generics; the body starts at the first `{` after the closing `)` of the args.
    const argsEnd = part.indexOf(") ->");
    const open = part.indexOf("{", argsEnd);
    let depth = 0;
    let end = open;
    for (let i = open; i < part.length; i += 1) {
      const ch = part[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out[match[1]!] = part.slice(0, end + 1);
  }
  return out;
}

const GUARD = /(main_window_only|studio_client_window|allow_windows|window\.label\(\)\s*!=)/;
const handlers = (): string[] => {
  const block = lib.match(/generate_handler!\[([\s\S]*?)\]/)![1]!;
  return block
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

describe("every Tauri command checks which window is calling", () => {
  const all = commands();
  it("finds the commands", () => {
    expect(Object.keys(all).length).toBeGreaterThan(50);
  });
  it.each(Object.keys(all))("%s", (name) => {
    expect(GUARD.test(all[name]!), `${name} has no window guard`).toBe(true);
  });
  it("every registered handler is a real command and every command is registered", () => {
    expect(handlers().sort()).toEqual(Object.keys(all).sort());
  });
});

describe("capabilities stay minimal", () => {
  const dir = path.join(TAURI, "capabilities");
  const caps = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      f,
      json: JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
        windows: string[];
        permissions: string[];
      },
    }));

  it("no capability grants shell, filesystem, http, process, or window creation to the webview", () => {
    for (const { f, json } of caps) {
      for (const p of json.permissions) {
        expect(p, `${f}: ${p}`).not.toMatch(
          /^(shell|fs|http|process|opener|dialog|os|clipboard-manager|global-shortcut):/,
        );
        expect(p, `${f}: ${p}`).not.toMatch(
          /allow-create|allow-eval|allow-set-webview|allow-.*devtools/,
        );
      }
    }
  });

  it("every window with a capability denies devtools, and remote desk windows have none", () => {
    for (const { f, json } of caps)
      expect(json.permissions, f).toContain("core:webview:deny-internal-toggle-devtools");
    const windows = new Set(caps.flatMap((c) => c.json.windows));
    expect([...windows].sort()).toEqual([
      "agent-presence",
      "app-updater",
      "companion-panel",
      "main",
    ]);
    expect([...windows].some((w) => w.startsWith("desk-"))).toBe(false); // companion browser windows load remote pages: no IPC at all
  });

  it("the main window is the only one that can reach the updater plugin and notifications", () => {
    for (const { f, json } of caps) {
      const privileged = json.permissions.some((p) => /^(updater|notification|deep-link):/.test(p));
      expect(privileged, f).toBe(f === "default.json");
    }
  });
});

describe("tauri.conf.json security settings", () => {
  const conf = JSON.parse(readFileSync(path.join(TAURI, "tauri.conf.json"), "utf8")) as {
    app: { security: { csp: string }; windows: Array<{ devtools?: boolean }> };
  };
  const csp = conf.app.security.csp;
  it("CSP forbids plugins, base-uri tricks, form posts and inline/remote scripts", () => {
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|\*|https?:)/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'none'/);
    expect(csp).toMatch(/form-action 'none'/);
  });
  it("connect-src names only Arrab, GitHub (updates) and loopback", () => {
    const connect = csp.match(/connect-src ([^;]*)/)![1]!.split(/\s+/);
    for (const origin of connect) {
      expect(origin, origin).toMatch(
        /^('self'|https?:\/\/(127\.0\.0\.1|localhost)(:[\d*]+)?|wss?:\/\/(127\.0\.0\.1|localhost)(:[\d*]+)?|https:\/\/(\*\.|[\w-]+\.)*(arrabai\.com|github\.com|githubusercontent\.com|dicebear\.com|randomuser\.me|i\.pravatar\.cc))$/,
      );
    }
  });
  it("devtools are off in the shipped window", () => {
    expect(conf.app.windows.every((w) => w.devtools === false)).toBe(true);
  });
});

describe("the frontend only calls commands that exist", () => {
  const known = new Set(handlers());
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory()
        ? n === "node_modules"
          ? []
          : walk(p)
        : /\.(ts|tsx)$/.test(n)
          ? [p]
          : [];
    });
  const plugin = /^(plugin:|tauri:)/;
  it("every invoke('x') names a registered command", () => {
    const missing: string[] = [];
    for (const file of walk(path.join(ROOT, "apps/desktop/src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/invoke(?:<[^>]*>)?\(\s*["'`](\w+)["'`]/g)) {
        if (!known.has(m[1]!) && !plugin.test(m[1]!))
          missing.push(`${path.relative(ROOT, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
