/**
 * Architecture guard — enforces the layer boundaries described in docs/ARCHITECTURE.md.
 * Desktop:  shared → core → domains → app/entries   (imports only point "down")
 * API:      platform → modules → http               (imports only point "down")
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const DESKTOP = path.join(ROOT, "apps/desktop/src");
const API = path.join(ROOT, "apps/api/src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const IMPORT = /(?:from|import\()\s*["']([^"']+)["']/g;

function importsOf(file: string, alias: string | null): string[] {
  const out: string[] = [];
  for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const spec = match[1]!;
    if (alias && spec.startsWith("@/")) out.push(path.join(alias, spec.slice(2)));
    else if (spec.startsWith(".")) out.push(path.resolve(path.dirname(file), spec));
  }
  return out;
}

function topLevel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep)[0]!;
}

function violations(
  root: string,
  alias: string | null,
  forbidden: Record<string, string[]>,
  allowed: string[] = [],
): string[] {
  const found: string[] = [];
  for (const file of walk(root)) {
    const from = topLevel(root, file);
    const bans = forbidden[from];
    if (!bans) continue;
    const rel = path.relative(root, file);
    for (const target of importsOf(file, alias)) {
      const to = topLevel(root, target);
      if (bans.includes(to) && !allowed.includes(rel)) {
        found.push(`${rel} → ${path.relative(root, target)}`);
      }
    }
  }
  return found;
}

describe("desktop layers", () => {
  it("shared/ depends on nothing above it", () => {
    expect(
      violations(DESKTOP, DESKTOP, { shared: ["core", "domains", "app", "entries"] }),
    ).toEqual([]);
  });

  it("core/ never imports the app shell, entries, or (outside the API facade) domains", () => {
    expect(
      violations(
        DESKTOP,
        DESKTOP,
        { core: ["app", "entries", "domains"] },
        ["core/api/api.ts"],
      ),
    ).toEqual([]);
  });

  it("domains/ never import the app shell or window entries", () => {
    expect(violations(DESKTOP, DESKTOP, { domains: ["app", "entries"] })).toEqual([]);
  });
});

describe("api layers", () => {
  it("platform/ never imports feature modules or http wiring", () => {
    expect(
      violations(API, null, { platform: ["modules", "http"] }, [
        // The auth guard resolves sessions through the accounts/organization services (types only).
        "platform/http/security.ts",
      ]),
    ).toEqual([]);
  });

  it("modules/ never import http wiring (routes receive deps through http/deps.ts)", () => {
    const found = violations(API, null, { modules: ["http"] });
    // Route registrars type their deps from http/deps.ts — that single edge is the contract.
    expect(found.filter((line) => !line.endsWith("http/deps.js"))).toEqual([]);
  });
});
