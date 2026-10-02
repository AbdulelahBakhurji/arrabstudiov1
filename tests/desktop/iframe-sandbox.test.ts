/**
 * Model-generated and remote content must never run with this app's origin.
 * A same-origin script can reach `window.parent.__TAURI_INTERNALS__` and invoke any command.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../apps/desktop/src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory()
      ? n === "legacy"
        ? []
        : walk(p)
      : n.endsWith(".tsx")
        ? [p]
        : [];
  });

interface Frame {
  file: string;
  tag: string;
}
const frames: Frame[] = walk(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/<iframe\b[\s\S]*?\/?>/g)].map((m) => ({
    file: path.relative(SRC, file),
    tag: m[0],
  })),
);

describe("every iframe in the app", () => {
  it("is found", () => expect(frames.length).toBeGreaterThanOrEqual(6));

  it("with generated or blob content is sandboxed without allow-same-origin", () => {
    for (const { file, tag } of frames) {
      if (/srcDoc=/.test(tag) || /src=\{previewUrl\}/.test(tag)) {
        const sandbox = tag.match(/sandbox="([^"]*)"/)?.[1];
        expect(sandbox, `${file}: generated content needs a sandbox`).toBeDefined();
        expect(sandbox, `${file}`).not.toMatch(/allow-same-origin/);
        expect(sandbox, `${file}`).not.toMatch(/allow-top-navigation|allow-modals/);
      }
    }
  });

  it("never loads a user-controlled address without validation", () => {
    // AgentsOfficeHost builds its URL from the fixed `http://127.0.0.1:4520` returned by Rust (a different
    // origin from the app, so it has no IPC) and only accepts messages whose origin matches it.
    const fixedOrigin = new Set(["domains/organization/ui/AgentsOfficeHost.tsx"]);
    for (const { file, tag } of frames) {
      if (/src=\{(browserUrl|url|address)\}/.test(tag) && !fixedOrigin.has(file))
        expect.fail(`${file}: raw user address in an iframe src`);
    }
  });
});

describe("no raw HTML injection anywhere", () => {
  it("dangerouslySetInnerHTML / innerHTML / document.write are not used", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(text))
        hits.push(path.relative(SRC, file));
    }
    expect(hits).toEqual([]);
  });
});
