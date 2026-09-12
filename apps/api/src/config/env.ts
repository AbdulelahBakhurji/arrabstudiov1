import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parsePort, readOptionalEnv } from "@arrab/core";
import { defaultStudioDataDir } from "@arrab/database";
import {
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_DEFAULT_REGION,
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
  openaiApiKey: string | undefined;
  openaiBaseUrl: string;
  /** Amazon Bedrock long-term API key (AWS_BEARER_TOKEN_BEDROCK). */
  bedrockApiKey: string | undefined;
  bedrockRegion: string;
  /** Up to N Bedrock model IDs available in Arrab. */
  bedrockModels: string[];
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

  const bedrockModels = parseBedrockModels(readOptionalEnv("BEDROCK_MODELS"));
  const defaultModel =
    readOptionalEnv("ARRAB_DEFAULT_MODEL", bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL) ??
    BEDROCK_DEFAULT_MODEL;

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
    bedrockApiKey:
      readOptionalEnv("AWS_BEARER_TOKEN_BEDROCK") ?? readOptionalEnv("BEDROCK_API_KEY"),
    bedrockRegion:
      readOptionalEnv("AWS_REGION", BEDROCK_DEFAULT_REGION) ?? BEDROCK_DEFAULT_REGION,
    bedrockModels,
    defaultModel,
    anthropicApiKey: readOptionalEnv("ANTHROPIC_API_KEY"),
    googleApiKey: readOptionalEnv("GOOGLE_API_KEY"),
    xaiApiKey: readOptionalEnv("XAI_API_KEY"),
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    authWebUrl: readOptionalEnv("ARRAB_AUTH_WEB_URL"),
  };
}

/** Fail fast when a Bedrock model is selected but no API key is set. */
export function assertBedrockConfigured(env: ApiEnv): void {
  const selectedIsBedrock =
    env.bedrockModels.includes(env.defaultModel) ||
    env.defaultModel.startsWith("amazon.") ||
    env.defaultModel.startsWith("google.") ||
    env.defaultModel.startsWith("anthropic.") ||
    env.defaultModel.startsWith("meta.") ||
    env.defaultModel.startsWith("eu.") ||
    env.defaultModel.startsWith("us.") ||
    env.defaultModel.startsWith("apac.");

  if (!selectedIsBedrock) {
    return;
  }
  if (env.bedrockApiKey?.trim()) {
    return;
  }
  throw new Error(
    "AWS_BEARER_TOKEN_BEDROCK is not set. Create a long-term Bedrock API key in AWS (eu-north-1), then add it to Railway Variables.",
  );
}
