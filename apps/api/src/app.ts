import cors from "@fastify/cors";
import {
  AnthropicMessagesAdapter,
  BedrockConverseAdapter,
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_PROVIDER_ID,
  isBedrockModel,
  OpenAiCompatibleAdapter,
  OPENROUTER_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  RegistryAiGateway,
  XAI_BASE_URL,
  XAI_PROVIDER_ID,
} from "@arrab/ai";
import { GatewayChatRuntime } from "@arrab/agents";
import {
  applyMigrations,
  createFilePersistence,
  createInMemoryPersistence,
  createPostgresConnection,
  createPostgresPersistence,
  type DatabaseConnection,
  type Persistence,
} from "@arrab/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiEnv } from "./config/env.js";
import { configureFieldCrypto } from "./lib/field-crypto.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerSecurity } from "./plugins/security.js";
import { registerV1Routes } from "./routes/v1.js";
import { ConversationService } from "./services/conversation-service.js";
import { ConnectorService } from "./services/connector-service.js";
import { AccountService } from "./services/account-service.js";
import { BillingService } from "./services/billing-service.js";
import { createMoyasarClient } from "./services/moyasar.js";
import { GoalService } from "./services/goal-service.js";
import { TaskExecutionService } from "./services/task-execution-service.js";
import { OrgWorkforceService } from "./services/org-workforce-service.js";
import { FamilyHouseholdService } from "./services/family-household-service.js";
import { WorkspaceCommandService } from "./services/workspace-commands.js";
import { WorkspaceQueryService } from "./services/workspace-query.js";

export interface ApiContext {
  env: ApiEnv;
  persistence: Persistence;
  postgres: DatabaseConnection | null;
  flushPersistence?: () => Promise<void>;
  aiGateway: RegistryAiGateway;
  chatRuntime: GatewayChatRuntime;
  defaultModel: string;
  queries: WorkspaceQueryService;
  commands: WorkspaceCommandService;
  conversations: ConversationService;
  connectors: ConnectorService;
  accounts: AccountService;
  billing: BillingService;
  goals: GoalService;
  taskExecution: TaskExecutionService;
  orgWorkforce: OrgWorkforceService;
  familyHousehold: FamilyHouseholdService;
}

export async function createApiContext(env: ApiEnv): Promise<ApiContext> {
  configureFieldCrypto(env.dataEncryptionKey);
  if (env.databaseUrl && !env.dataEncryptionKey?.trim()) {
    const message =
      "[arrab-api] DATA_ENCRYPTION_KEY is required when DATABASE_URL is set. Use a 32-byte key (64 hex chars or base64). Set ARRAB_ALLOW_INSECURE_DATA_KEY=1 only for local emergencies.";
    if (process.env.ARRAB_ALLOW_INSECURE_DATA_KEY === "1") {
      console.warn(message);
    } else {
      throw new Error(message);
    }
  }

  let persistence: Persistence;
  let postgres: DatabaseConnection | null = null;
  let flushPersistence: (() => Promise<void>) | undefined;

  if (env.databaseUrl) {
    postgres = createPostgresConnection({ connectionString: env.databaseUrl });
    await postgres.ping();
    await applyMigrations(postgres.pool);
    persistence = await createPostgresPersistence(postgres.pool);
  } else if (env.dataDir) {
    const file = await createFilePersistence(env.dataDir);
    persistence = file.persistence;
    flushPersistence = file.flush;
  } else {
    persistence = createInMemoryPersistence();
  }

  const aiGateway = new RegistryAiGateway();
  // Register providers that have secrets. OpenRouter is preferred when configured
  // (Bedrock accounts are often blocked until AWS verification completes).
  if (env.openRouterApiKey?.trim()) {
    aiGateway.register(
      new OpenAiCompatibleAdapter({
        id: OPENROUTER_PROVIDER_ID,
        apiKey: env.openRouterApiKey,
        baseUrl: OPENROUTER_BASE_URL,
      }),
    );
  }
  if (env.openAiApiKey?.trim()) {
    aiGateway.register(
      new OpenAiCompatibleAdapter({
        id: "openai",
        apiKey: env.openAiApiKey,
        baseUrl: "https://api.openai.com/v1",
      }),
    );
  }
  if (env.anthropicApiKey?.trim()) {
    aiGateway.register(
      new AnthropicMessagesAdapter({
        id: "anthropic",
        apiKey: env.anthropicApiKey,
      }),
    );
  }
  if (env.xaiApiKey?.trim()) {
    aiGateway.register(
      new OpenAiCompatibleAdapter({
        id: XAI_PROVIDER_ID,
        apiKey: env.xaiApiKey,
        baseUrl: XAI_BASE_URL,
      }),
    );
  }
  if (env.bedrockApiKey?.trim()) {
    aiGateway.register(
      new BedrockConverseAdapter({
        id: BEDROCK_PROVIDER_ID,
        apiKey: env.bedrockApiKey,
        region: env.bedrockRegion,
      }),
    );
  }

  const primaryProviderId =
    env.primaryProviderId === "openrouter" && env.openRouterApiKey?.trim()
      ? OPENROUTER_PROVIDER_ID
      : env.primaryProviderId === "openai" && env.openAiApiKey?.trim()
        ? "openai"
        : env.primaryProviderId === "anthropic" && env.anthropicApiKey?.trim()
          ? "anthropic"
          : env.primaryProviderId === "xai" && env.xaiApiKey?.trim()
            ? XAI_PROVIDER_ID
            : env.bedrockApiKey?.trim()
              ? BEDROCK_PROVIDER_ID
              : env.openRouterApiKey?.trim()
                ? OPENROUTER_PROVIDER_ID
                : env.openAiApiKey?.trim()
                  ? "openai"
                  : env.anthropicApiKey?.trim()
                    ? "anthropic"
                    : env.xaiApiKey?.trim()
                      ? XAI_PROVIDER_ID
                      : BEDROCK_PROVIDER_ID;

  const resolvedDefaultModel =
    primaryProviderId === OPENROUTER_PROVIDER_ID
      ? env.defaultModel.includes("/")
        ? env.defaultModel
        : env.openRouterModels[0] ?? OPENROUTER_DEFAULT_MODEL
      : primaryProviderId === "openai"
        ? env.defaultModel || "gpt-4o-mini"
        : primaryProviderId === "anthropic"
          ? env.defaultModel || "claude-3-5-haiku-latest"
          : primaryProviderId === XAI_PROVIDER_ID
            ? env.defaultModel || "grok-3-mini"
            : isBedrockModel(env.defaultModel, env.bedrockModels)
              ? env.defaultModel
              : env.bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL;

  const chatRuntime = new GatewayChatRuntime(primaryProviderId);
  const commands = new WorkspaceCommandService(persistence);
  const queries = new WorkspaceQueryService(persistence, commands);
  const googleRedirect =
    env.googleOAuthRedirectUri?.trim() ||
    `${env.publicBaseUrl.replace(/\/$/, "")}/v1/connectors/gmail/oauth/callback`;
  const microsoftRedirect =
    env.microsoftOAuthRedirectUri?.trim() ||
    `${env.publicBaseUrl.replace(/\/$/, "")}/v1/connectors/outlook/oauth/callback`;
  const githubRedirect =
    env.githubOAuthRedirectUri?.trim() ||
    `${env.publicBaseUrl.replace(/\/$/, "")}/v1/connectors/github/oauth/callback`;
  const base = env.publicBaseUrl.replace(/\/$/, "");
  const genericOAuth = {
    ...(env.gitlabClientId?.trim() && env.gitlabClientSecret?.trim()
      ? {
          gitlab: {
            clientId: env.gitlabClientId.trim(),
            clientSecret: env.gitlabClientSecret.trim(),
            redirectUri:
              env.gitlabOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/gitlab/oauth/callback`,
          },
        }
      : {}),
    ...(env.bitbucketClientId?.trim() && env.bitbucketClientSecret?.trim()
      ? {
          bitbucket: {
            clientId: env.bitbucketClientId.trim(),
            clientSecret: env.bitbucketClientSecret.trim(),
            redirectUri:
              env.bitbucketOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/bitbucket/oauth/callback`,
          },
        }
      : {}),
    ...(env.linearClientId?.trim() && env.linearClientSecret?.trim()
      ? {
          linear: {
            clientId: env.linearClientId.trim(),
            clientSecret: env.linearClientSecret.trim(),
            redirectUri:
              env.linearOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/linear/oauth/callback`,
          },
        }
      : {}),
    ...(env.slackClientId?.trim() && env.slackClientSecret?.trim()
      ? {
          slack: {
            clientId: env.slackClientId.trim(),
            clientSecret: env.slackClientSecret.trim(),
            redirectUri:
              env.slackOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/slack/oauth/callback`,
          },
        }
      : {}),
    ...(env.notionClientId?.trim() && env.notionClientSecret?.trim()
      ? {
          notion: {
            clientId: env.notionClientId.trim(),
            clientSecret: env.notionClientSecret.trim(),
            redirectUri:
              env.notionOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/notion/oauth/callback`,
          },
        }
      : {}),
    ...(env.whoopClientId?.trim() && env.whoopClientSecret?.trim()
      ? {
          whoop: {
            clientId: env.whoopClientId.trim(),
            clientSecret: env.whoopClientSecret.trim(),
            redirectUri:
              env.whoopOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/whoop/oauth/callback`,
          },
        }
      : {}),
    ...(env.fitbitClientId?.trim() && env.fitbitClientSecret?.trim()
      ? {
          fitbit: {
            clientId: env.fitbitClientId.trim(),
            clientSecret: env.fitbitClientSecret.trim(),
            redirectUri:
              env.fitbitOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/fitbit/oauth/callback`,
          },
        }
      : {}),
    ...(env.googleDriveClientId?.trim() && env.googleDriveClientSecret?.trim()
      ? {
          google_drive: {
            clientId: env.googleDriveClientId.trim(),
            clientSecret: env.googleDriveClientSecret.trim(),
            redirectUri:
              env.googleDriveOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/google_drive/oauth/callback`,
          },
        }
      : {}),
    ...(env.googleCalendarClientId?.trim() && env.googleCalendarClientSecret?.trim()
      ? {
          google_calendar: {
            clientId: env.googleCalendarClientId.trim(),
            clientSecret: env.googleCalendarClientSecret.trim(),
            redirectUri:
              env.googleCalendarOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/google_calendar/oauth/callback`,
          },
        }
      : {}),
    ...(env.figmaClientId?.trim() && env.figmaClientSecret?.trim()
      ? {
          figma: {
            clientId: env.figmaClientId.trim(),
            clientSecret: env.figmaClientSecret.trim(),
            redirectUri:
              env.figmaOAuthRedirectUri?.trim() ||
              `${base}/v1/connectors/figma/oauth/callback`,
          },
        }
      : {}),
  };
  const connectors = new ConnectorService(
    persistence,
    commands,
    env.googleClientId?.trim() && env.googleClientSecret?.trim()
      ? {
          clientId: env.googleClientId.trim(),
          clientSecret: env.googleClientSecret.trim(),
          redirectUri: googleRedirect,
        }
      : null,
    env.siteUrl,
    env.microsoftClientId?.trim() && env.microsoftClientSecret?.trim()
      ? {
          clientId: env.microsoftClientId.trim(),
          clientSecret: env.microsoftClientSecret.trim(),
          redirectUri: microsoftRedirect,
        }
      : null,
    env.githubAppClientId?.trim() && env.githubAppClientSecret?.trim()
      ? {
          clientId: env.githubAppClientId.trim(),
          clientSecret: env.githubAppClientSecret.trim(),
          redirectUri: githubRedirect,
          appSlug: env.githubAppSlug?.trim() || undefined,
        }
      : null,
    env.whatsappWebhookVerifyToken?.trim() || null,
    env.whatsappAppSecret?.trim() || null,
    env.finnhubApiKey?.trim() || null,
    env.finnhubWebhookSecret?.trim() || null,
    genericOAuth,
  );
  const accounts = new AccountService(
    persistence,
    env.publicBaseUrl,
    env.authWebUrl,
  );
  const billing = new BillingService(
    accounts,
    createMoyasarClient(env.moyasarSecretKey),
    env.siteUrl,
  );
  const familyHousehold = new FamilyHouseholdService(persistence, accounts);
  const conversations = new ConversationService(
    persistence,
    aiGateway,
    chatRuntime,
    resolvedDefaultModel,
    connectors,
    accounts,
    familyHousehold,
  );
  const goals = new GoalService(persistence);
  const taskExecution = new TaskExecutionService(
    persistence,
    conversations,
    aiGateway,
    accounts,
  );
  const orgWorkforce = new OrgWorkforceService(persistence);

  return {
    env,
    persistence,
    postgres,
    flushPersistence,
    aiGateway,
    chatRuntime,
    defaultModel: resolvedDefaultModel,
    queries,
    commands,
    conversations,
    connectors,
    accounts,
    billing,
    goals,
    taskExecution,
    orgWorkforce,
    familyHousehold,
  };
}

export async function buildApp(context: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: context.env.logLevel === "error" ? false : { level: context.env.logLevel },
  });

  app.decorate("arrab", context);

  /**
   * Coolify public URL keeps `/r/<id>` on the request. Strip it so `/health` and
   * `/v1/*` resolve. Must run before security + routing.
   */
  const stripPrefix =
    context.env.apiRoutePrefix || "/r/nmpi6uidtpkh1bdf";
  app.addHook("onRequest", async (request) => {
    const raw = request.raw.url ?? "";
    const q = raw.indexOf("?");
    const path = q >= 0 ? raw.slice(0, q) : raw;
    const query = q >= 0 ? raw.slice(q) : "";
    if (path === stripPrefix) {
      request.raw.url = `/${query}`;
      return;
    }
    if (path.startsWith(`${stripPrefix}/`)) {
      const rest = path.slice(stripPrefix.length);
      request.raw.url = `${rest || "/"}${query}`;
    }
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const allowed =
        context.env.corsOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
        origin.startsWith("tauri://") ||
        origin.includes("tauri.localhost");
      callback(null, allowed);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Arrab-Account-Session",
      "X-Arrab-Employee-Session",
      "X-Arrab-Family-Member",
      "X-Requested-With",
    ],
  });
  await registerSecurity(
    app,
    context.accounts,
    (token) => context.orgWorkforce.resolveSession(token),
    stripPrefix,
  );
  registerErrorHandler(app);

  const routePrefix = context.env.apiRoutePrefix;
  const whatsappWebhookPaths = new Set(
    ["/v1/connectors/whatsapp/webhook"].concat(
      routePrefix ? [`${routePrefix}/v1/connectors/whatsapp/webhook`] : [],
      ["/r/nmpi6uidtpkh1bdf/v1/connectors/whatsapp/webhook"],
    ),
  );

  // Capture raw body for Meta WhatsApp webhook HMAC (X-Hub-Signature-256).
  app.addHook("preParsing", async (request, _reply, payload) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (request.method !== "POST" || !whatsappWebhookPaths.has(path)) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    (request as { rawBody?: string }).rawBody = buf.toString("utf8");
    const { Readable } = await import("node:stream");
    return Readable.from(buf);
  });

  const v1Options = {
    queries: context.queries,
    commands: context.commands,
    conversations: context.conversations,
    connectors: context.connectors,
    accounts: context.accounts,
    billing: context.billing,
    goals: context.goals,
    taskExecution: context.taskExecution,
    orgWorkforce: context.orgWorkforce,
    familyHousehold: context.familyHousehold,
    gateway: context.aiGateway,
    persistence: context.persistence.kind,
    workspaceId: context.persistence.workspaceId,
    defaultModel: context.defaultModel,
    bedrockModels: context.env.bedrockModels,
    openRouterModels: context.env.openRouterModels,
    primaryProviderId: context.env.primaryProviderId,
    bedrockRegion: context.env.bedrockRegion,
    releasesDir: context.env.releasesDir,
    publicBaseUrl: context.env.siteUrl,
  };

  const registerCoreRoutes = async (instance: FastifyInstance) => {
    instance.get("/health", async () => ({
      status: "ok" as const,
      service: "arrab-api" as const,
      time: new Date().toISOString(),
    }));
    registerV1Routes(instance, v1Options);
  };

  // Always mount at root. Coolify prefix is stripped in onRequest above.
  // Also mount under the prefix in case a proxy strip runs before us.
  await registerCoreRoutes(app);
  const mountPrefixes = new Set<string>();
  if (routePrefix) mountPrefixes.add(routePrefix);
  mountPrefixes.add("/r/nmpi6uidtpkh1bdf");
  for (const prefix of mountPrefixes) {
    await app.register(registerCoreRoutes, { prefix });
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    arrab: ApiContext;
  }
}
