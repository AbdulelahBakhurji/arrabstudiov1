/**
 * Real-browser end-to-end harness: an isolated API (own data dir, in-memory-style studio) + the Vite
 * dev server + headless Chrome/Chromium driven by playwright-core. Skipped unless ARRAB_E2E=1.
 *
 *   ARRAB_E2E=1 pnpm vitest run tests/e2e
 *
 * Set ARRAB_E2E_CHROME to a Chrome/Chromium binary if the default is not found.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export const API_PORT = 8799;
export const APP_PORT = 1420;
export const API = `http://127.0.0.1:${API_PORT}`;
export const APP = `http://127.0.0.1:${APP_PORT}`;
const ROOT = path.resolve(import.meta.dirname, "../..");
export const E2E_ENABLED = process.env.ARRAB_E2E === "1";

const CHROME_CANDIDATES = [
  process.env.ARRAB_E2E_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean) as string[];

export function chromePath(): string {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Chromium found; set ARRAB_E2E_CHROME");
  return found;
}

const kill = (port: number) => {
  try {
    execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // nothing listening
  }
};

async function waitFor(url: string, ms = 40_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not come up`);
}

let vite: ChildProcess | null = null;
let api: ChildProcess | null = null;
let dataDir = "";

export async function startFrontend(): Promise<void> {
  kill(APP_PORT);
  vite = spawn(
    "pnpm",
    [
      "--filter",
      "@arrab/desktop",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(APP_PORT),
      "--strictPort",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, VITE_ARRAB_API_URL: API, VITE_ARRAB_API_ROUTE_PREFIX: "" },
      stdio: "ignore",
      detached: true,
    },
  );
  vite.unref();
  await waitFor(APP);
}

/** A brand-new studio (the API serves one studio per process, so every scenario restarts it). */
export async function freshStudio(): Promise<void> {
  kill(API_PORT);
  await new Promise((r) => setTimeout(r, 400));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = mkdtempSync(path.join(tmpdir(), "arrab-e2e-"));
  mkdirSync(dataDir, { recursive: true });
  api = spawn("pnpm", ["--filter", "@arrab/api", "exec", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ARRAB_DATA_DIR: dataDir,
      ARRAB_API_PORT: String(API_PORT),
      ARRAB_ENABLE_PLAN_CODES: "1",
      ARRAB_CORS_ORIGINS: APP,
      ARRAB_API_LOG_LEVEL: "error",
    },
    stdio: "ignore",
    detached: true,
  });
  api.unref();
  await waitFor(`${API}/health`);
}

export function stopAll(): void {
  kill(API_PORT);
  kill(APP_PORT);
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON fixtures
}
export async function call(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const res = await fetch(API + url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}

let counter = 0;
export interface Owner {
  token: string;
  accountId: string;
  email: string;
  auth: Record<string, string>;
}
export async function signUpOwner(planCode?: string): Promise<Owner> {
  counter += 1;
  const email = `e2e${Date.now()}${counter}@arrab.test`;
  const connected = await call("POST", "/v1/account/connect", {
    email,
    password: "securepass1",
    displayName: "E2E Owner",
  });
  if (connected.status !== 200) throw new Error(`connect: ${JSON.stringify(connected)}`);
  const token = connected.body.sessionToken as string;
  const auth = { authorization: `Bearer ${token}` };
  if (planCode) {
    const sub = await call("POST", "/v1/account/subscribe", { code: planCode }, auth);
    if (sub.status !== 200) throw new Error(`subscribe: ${JSON.stringify(sub)}`);
  }
  const status = await call("GET", "/v1/account", undefined, auth);
  return { token, accountId: status.body.account.id, email, auth };
}

export async function launch(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { browser, ctx };
}

const SETUP_DONE = JSON.stringify({
  completed: true,
  step: "ready",
  connectorDone: true,
  companionDone: true,
});

/** Open the app with the given localStorage (as if the user had signed in earlier). */
export async function openApp(
  ctx: BrowserContext,
  storage: Record<string, string>,
  pathName = "/",
): Promise<{ page: Page; errors: string[] }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });
  await page.addInitScript(
    ({ entries, setup }) => {
      if (!sessionStorage.getItem("__e2e_seeded")) {
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        localStorage.setItem("arrab.firstLaunchSetup.v3", setup);
        sessionStorage.setItem("__e2e_seeded", "1");
      }
    },
    { entries: storage, setup: SETUP_DONE },
  );
  await page.goto(APP + pathName, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  return { page, errors };
}

export const ownerStorage = (o: Owner): Record<string, string> => ({
  "arrab.account.session": o.token,
  "arrab.account.id": o.accountId,
});

/** Labels of the left navigation rail. */
export async function navLabels(page: Page): Promise<string[]> {
  return (
    await page.$$eval("nav a, nav button", (els) => els.map((e) => (e.textContent ?? "").trim()))
  ).filter(Boolean);
}
