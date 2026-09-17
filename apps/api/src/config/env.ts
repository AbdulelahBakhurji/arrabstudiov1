import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parsePort, readOptionalEnv } from "@arrab/core";
import { defaultStudioDataDir } from "@arrab/database";
import {
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_DEFAULT_REGION,
  normalizeBedrockModelId,
  OPENROUTER_DEFAULT_MODEL,
  parseBedrockModels,
  parseOpenRouterModels,
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
  /** OpenRouter API key — preferred while Bedrock invoke is blocked. */
  openRouterApiKey: string | undefined;
  openRouterModels: string[];
  /** Direct OpenAI (ChatGPT) API key. */
  openAiApiKey: string | undefined;
  /** Direct Anthropic (Claude) API key. */
  anthropicApiKey: string | undefined;
  /** xAI Grok API key. */
  xaiApiKey: string | undefined;
  /** Active chat model id (Bedrock or OpenRouter). */
  defaultModel: string;
  /** Which gateway adapter is primary for chat. */
  primaryProviderId: "openrouter" | "bedrock" | "openai" | "anthropic" | "xai";
  /** Public base URL used to build web auth links (defaults to http://host:port). */
  publicBaseUrl: string;
  /** Optional external web sign-in URL. Use {state} placeholder. */
  authWebUrl: string | undefined;
  /** Public website (testing workspace) — login, plans, downloads. */
  siteUrl: string;
  /** Moyasar secret key (sk_test_… / sk_live_…). Empty = billing checkout disabled. */
  moyasarSecretKey: string | undefined;
  /** Moyasar publishable key for hosted forms (optional). */
  moyasarPublishableKey: string | undefined;
  /**
   * AES-256 key for field encryption at rest (64 hex chars or 32-byte base64).
   * Required whenever DATABASE_URL is set (override with ARRAB_ALLOW_INSECURE_DATA_KEY=1).
   */
  dataEncryptionKey: string | undefined;
  /** Directory of published Studio installers (.dmg, .deb, .AppImage). */
  releasesDir: string;
  /** Google OAuth client for Gmail connector (optional until Connect Gmail is used). */
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  /** Override Gmail OAuth redirect URI (defaults to publicBaseUrl + /v1/connectors/gmail/oauth/callback). */
  googleOAuthRedirectUri: string | undefined;
  /** Microsoft OAuth client for Outlook connector (optional until Connect Outlook is used). */
  microsoftClientId: string | undefined;
  microsoftClientSecret: string | undefined;
  /** Override Outlook OAuth redirect URI. */
  microsoftOAuthRedirectUri: string | undefined;
  /** GitHub App OAuth client for GitHub connector (optional until Connect GitHub is used). */
  githubAppClientId: string | undefined;
  githubAppClientSecret: string | undefined;
  /** App slug from https://github.com/apps/{slug} — enables install+login flow. */
  githubAppSlug: string | undefined;
  /** Override GitHub OAuth redirect URI. */
  githubOAuthRedirectUri: string | undefined;
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
  const authWebUrl = readOptionalEnv("ARRAB_AUTH_WEB_URL");
  let siteUrl = readOptionalEnv("ARRAB_SITE_URL");
  if (!siteUrl && authWebUrl) {
    try {
      siteUrl = new URL(authWebUrl.replaceAll("{state}", "x").replaceAll("{callback}", "x")).origin;
    } catch {
      siteUrl = undefined;
    }
  }

  const bedrockRegion =
    readOptionalEnv("AWS_REGION", BEDROCK_DEFAULT_REGION) ?? BEDROCK_DEFAULT_REGION;
  const bedrockModels = parseBedrockModels(readOptionalEnv("BEDROCK_MODELS")).map((id) =>
    normalizeBedrockModelId(id, bedrockRegion),
  );
  const bedrockApiKey =
    readOptionalEnv("AWS_BEARER_TOKEN_BEDROCK") ?? readOptionalEnv("BEDROCK_API_KEY");
  const openRouterApiKey = readOptionalEnv("OPENROUTER_API_KEY");
  const openRouterModels = parseOpenRouterModels(readOptionalEnv("OPENROUTER_MODELS"));
  const openAiApiKey = readOptionalEnv("OPENAI_API_KEY");
  const anthropicApiKey = readOptionalEnv("ANTHROPIC_API_KEY");
  const xaiApiKey = readOptionalEnv("XAI_API_KEY");

  // Prefer OpenRouter when its key is set (Bedrock account may be blocked).
  // Override with ARRAB_AI_PROVIDER=bedrock|openrouter|openai|anthropic|xai.
  const providerOverride = (readOptionalEnv("ARRAB_AI_PROVIDER") ?? "").trim().toLowerCase();
  let primaryProviderId: ApiEnv["primaryProviderId"] = "bedrock";
  if (providerOverride === "openrouter" && openRouterApiKey?.trim()) {
    primaryProviderId = "openrouter";
  } else if (providerOverride === "openai" && openAiApiKey?.trim()) {
    primaryProviderId = "openai";
  } else if (providerOverride === "anthropic" && anthropicApiKey?.trim()) {
    primaryProviderId = "anthropic";
  } else if (providerOverride === "xai" && xaiApiKey?.trim()) {
    primaryProviderId = "xai";
  } else if (providerOverride === "bedrock" && bedrockApiKey?.trim()) {
    primaryProviderId = "bedrock";
  } else if (openRouterApiKey?.trim()) {
    primaryProviderId = "openrouter";
  } else if (openAiApiKey?.trim()) {
    primaryProviderId = "openai";
  } else if (anthropicApiKey?.trim()) {
    primaryProviderId = "anthropic";
  } else if (xaiApiKey?.trim()) {
    primaryProviderId = "xai";
  } else if (bedrockApiKey?.trim()) {
    primaryProviderId = "bedrock";
  } else if (providerOverride === "openrouter") {
    primaryProviderId = "openrouter";
  }

  let defaultModel: string;
  if (primaryProviderId === "openrouter") {
    defaultModel =
      readOptionalEnv("ARRAB_DEFAULT_MODEL", openRouterModels[0] ?? OPENROUTER_DEFAULT_MODEL) ??
      OPENROUTER_DEFAULT_MODEL;
    if (!defaultModel.includes("/")) {
      defaultModel = openRouterModels[0] ?? OPENROUTER_DEFAULT_MODEL;
    }
  } else if (primaryProviderId === "openai") {
    defaultModel = readOptionalEnv("ARRAB_DEFAULT_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini";
  } else if (primaryProviderId === "anthropic") {
    defaultModel =
      readOptionalEnv("ARRAB_DEFAULT_MODEL", "claude-3-5-haiku-latest") ?? "claude-3-5-haiku-latest";
  } else if (primaryProviderId === "xai") {
    defaultModel = readOptionalEnv("ARRAB_DEFAULT_MODEL", "grok-3-mini") ?? "grok-3-mini";
  } else {
    defaultModel = normalizeBedrockModelId(
      readOptionalEnv("ARRAB_DEFAULT_MODEL", bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL) ??
        BEDROCK_DEFAULT_MODEL,
      bedrockRegion,
    );
    if (defaultModel.toLowerCase().startsWith("google.gemma")) {
      defaultModel = normalizeBedrockModelId("amazon.nova-lite-v1:0", bedrockRegion);
    }
  }

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
    bedrockApiKey,
    bedrockRegion,
    bedrockModels,
    openRouterApiKey,
    openRouterModels,
    openAiApiKey,
    anthropicApiKey,
    xaiApiKey,
    defaultModel,
    primaryProviderId,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    authWebUrl,
    siteUrl: (siteUrl ?? publicBaseUrl).replace(/\/$/, ""),
    moyasarSecretKey: readOptionalEnv("MOYASAR_SECRET_KEY"),
    moyasarPublishableKey: readOptionalEnv("MOYASAR_PUBLISHABLE_KEY"),
    dataEncryptionKey: readOptionalEnv("DATA_ENCRYPTION_KEY"),
    releasesDir:
      readOptionalEnv("ARRAB_RELEASES_DIR") ?? "/var/www/testingworkspace/releases",
    googleClientId: readOptionalEnv("GOOGLE_CLIENT_ID"),
    googleClientSecret: readOptionalEnv("GOOGLE_CLIENT_SECRET"),
    googleOAuthRedirectUri: readOptionalEnv("GOOGLE_OAUTH_REDIRECT_URI"),
    microsoftClientId:
      readOptionalEnv("MICROSOFT_CLIENT_ID") ?? readOptionalEnv("OUTLOOK_CLIENT_ID"),
    microsoftClientSecret:
      readOptionalEnv("MICROSOFT_CLIENT_SECRET") ?? readOptionalEnv("OUTLOOK_CLIENT_SECRET"),
    microsoftOAuthRedirectUri: readOptionalEnv("MICROSOFT_OAUTH_REDIRECT_URI"),
    githubAppClientId:
      readOptionalEnv("GITHUB_APP_CLIENT_ID") ?? readOptionalEnv("GITHUB_CLIENT_ID"),
    githubAppClientSecret:
      readOptionalEnv("GITHUB_APP_CLIENT_SECRET") ?? readOptionalEnv("GITHUB_CLIENT_SECRET"),
    githubAppSlug: readOptionalEnv("GITHUB_APP_SLUG"),
    githubOAuthRedirectUri: readOptionalEnv("GITHUB_OAUTH_REDIRECT_URI"),
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
