import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parsePort, readOptionalEnv } from "@arrab/core";
import { defaultStudioDataDir } from "@arrab/database";
import { EXPLABS_BASE_URL, isExplabsLunaModel } from "./explabs.js";

export interface ApiEnv {
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  corsOrigins: string[];
  databaseUrl: string | undefined;
  /** Local on-device data directory when Postgres is not configured. */
  dataDir: string | undefined;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string;
  /** Experiential Labs key — required for gpt-5.6-luna. */
  explabsApiKey: string | undefined;
  explabsBaseUrl: string;
  defaultModel: string;
  anthropicApiKey: string | undefined;
  googleApiKey: string | undefined;
  xaiApiKey: string | undefined;
  /** Public base URL used to build web auth links (defaults to http://host:port). */
  publicBaseUrl: string;
  /** Optional external web sign-in URL. Use {state} placeholder. */
  authWebUrl: string | undefined;
}

const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);

export function loadDotEnv(fromDir = process.cwd()): void {
  const candidates = [path.resolve(fromDir, ".env"), path.resolve(fromDir, "../../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return;
  }
}

export function loadApiEnv(): ApiEnv {
  const logLevel = readOptionalEnv("ARRAB_API_LOG_LEVEL", "info") ?? "info";
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error("ARRAB_API_LOG_LEVEL is invalid");
  }

  const host = readOptionalEnv("ARRAB_API_HOST", "127.0.0.1") ?? "127.0.0.1";
  const port = parsePort(readOptionalEnv("ARRAB_API_PORT", "8787") ?? "8787", "ARRAB_API_PORT");
  const publicBaseUrl =
    readOptionalEnv("ARRAB_PUBLIC_BASE_URL") ?? `http://${host}:${port}`;

  return {
    host,
    port,
    logLevel: logLevel as ApiEnv["logLevel"],
    corsOrigins: parseCsv(
      readOptionalEnv(
        "ARRAB_CORS_ORIGINS",
        "http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
      ),
    ),
    databaseUrl: readOptionalEnv("DATABASE_URL"),
    dataDir: readOptionalEnv("ARRAB_DATA_DIR") ?? defaultStudioDataDir(),
    openaiApiKey: readOptionalEnv("OPENAI_API_KEY"),
    openaiBaseUrl:
      readOptionalEnv("OPENAI_BASE_URL", "https://api.openai.com/v1") ??
      "https://api.openai.com/v1",
    explabsApiKey: readOptionalEnv("EXPLABS_API_KEY"),
    explabsBaseUrl:
      readOptionalEnv("EXPLABS_BASE_URL", EXPLABS_BASE_URL) ?? EXPLABS_BASE_URL,
    defaultModel: readOptionalEnv("ARRAB_DEFAULT_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini",
    anthropicApiKey: readOptionalEnv("ANTHROPIC_API_KEY"),
    googleApiKey: readOptionalEnv("GOOGLE_API_KEY"),
    xaiApiKey: readOptionalEnv("XAI_API_KEY"),
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    authWebUrl: readOptionalEnv("ARRAB_AUTH_WEB_URL"),
  };
}

/** Fail fast when gpt-5.6-luna is selected but Experiential is not configured. */
export function assertExplabsConfigured(env: ApiEnv): void {
  if (!isExplabsLunaModel(env.defaultModel)) {
    return;
  }
  if (env.explabsApiKey?.trim()) {
    return;
  }
  throw new Error(
    "EXPLABS_API_KEY is not set. Create a key under Settings → API Keys at Experiential Labs, then export EXPLABS_API_KEY (or add it to .env).",
  );
}
