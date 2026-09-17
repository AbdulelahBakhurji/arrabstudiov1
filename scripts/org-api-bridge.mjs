#!/usr/bin/env node
/**
 * Local org API bridge: serves real /v1/org/* from file persistence and proxies
 * every other request to the production Arrab API so Administration works before
 * the VPS is redeployed with org routes.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ARRAB_BRIDGE_PORT || 8787);
const UPSTREAM = (process.env.ARRAB_UPSTREAM || "https://api.arrabai.com").replace(/\/$/, "");
const DATA_DIR =
  process.env.ARRAB_DATA_DIR ||
  path.join(process.env.HOME || "/tmp", "Library/Application Support/com.arrab.studio/org-api");

fs.mkdirSync(DATA_DIR, { recursive: true });

const childEnv = {
  ...process.env,
  ARRAB_API_HOST: "127.0.0.1",
  ARRAB_API_PORT: String(PORT + 1),
  ARRAB_CORS_ORIGINS: "*",
  ARRAB_DATA_DIR: DATA_DIR,
  ARRAB_ALLOW_INSECURE_DATA_KEY: "1",
};
delete childEnv.DATABASE_URL;

const child = spawn(
  "pnpm",
  ["--filter", "@arrab/api", "exec", "tsx", "src/index.ts"],
  {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (buf) => process.stdout.write(`[api] ${buf}`));
child.stderr.on("data", (buf) => process.stderr.write(`[api] ${buf}`));
child.on("exit", (code) => {
  console.error(`local api exited ${code}`);
  process.exit(code || 1);
});

const LOCAL = `http://127.0.0.1:${PORT + 1}`;

function isOrgPath(urlPath) {
  return urlPath === "/v1/org" || urlPath.startsWith("/v1/org/");
}

async function proxy(req, res, targetBase) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const target = `${targetBase}${url.pathname}${url.search}`;
  const headers = { ...req.headers, host: new URL(targetBase).host };
  delete headers["content-length"];
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : body,
    redirect: "manual",
  });
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const base = isOrgPath(url.pathname) ? LOCAL : UPSTREAM;
    await proxy(req, res, base);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

async function waitLocal() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${LOCAL}/health`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("local api failed to start");
}

await waitLocal();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`org bridge on http://127.0.0.1:${PORT} (org local, rest → ${UPSTREAM})`);
});
