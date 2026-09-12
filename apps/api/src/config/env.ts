import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parsePort, readOptionalEnv } from "@arrab/core";
import { defaultStudioDataDir } from "@arrab/database";
import {
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_DEFAULT_REGION,
  normalizeBedrockModelId,
  parseBedrockModels,
} from "@arrab/ai";

export interface ApiEnv {
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  corsOrigins: string[];
  databaseUrl: string | undefined;
  /** Local on-device data directory when Postgres is not configured. */
  dataDir: string | undefined;
  /** Amazon Bedrock long-term API key (AWS_BEARER_TOKEN_BEDROCK). */
  bedrockApiKey: string | undefined;
  bedrockRegion: string;
  /** Up to N Bedrock model IDs available in Arrab. */
  bedrockModels: string[];
  defaultModel: string;
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

  const bedrockRegion =
    readOptionalEnv("AWS_REGION", BEDROCK_DEFAULT_REGION) ?? BEDROCK_DEFAULT_REGION;
  const bedrockModels = parseBedrockModels(readOptionalEnv("BEDROCK_MODELS")).map((id) =>
    normalizeBedrockModelId(id, bedrockRegion),
  );
  const defaultModel = normalizeBedrockModelId(
    readOptionalEnv("ARRAB_DEFAULT_MODEL", bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL) ??
      BEDROCK_DEFAULT_MODEL,
    bedrockRegion,
  );

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
    bedrockApiKey:
      readOptionalEnv("AWS_BEARER_TOKEN_BEDROCK") ?? readOptionalEnv("BEDROCK_API_KEY"),
    bedrockRegion,
    bedrockModels,
    defaultModel,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    authWebUrl: readOptionalEnv("ARRAB_AUTH_WEB_URL"),
  };
}

/** Bedrock is required — Arrab AI uses only Amazon Bedrock. */
export function assertBedrockConfigured(env: ApiEnv): void {
  if (env.bedrockApiKey?.trim()) {
    return;
  }
  throw new Error(
    "AWS_BEARER_TOKEN_BEDROCK is not set. Create a long-term Bedrock API key in AWS (eu-north-1), then add it to Railway Variables.",
  );
}
