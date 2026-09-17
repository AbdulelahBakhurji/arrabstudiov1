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
  const conversations = new ConversationService(
    persistence,
    aiGateway,
    chatRuntime,
    resolvedDefaultModel,
    connectors,
    accounts,
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
  };
}

export async function buildApp(context: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: context.env.logLevel === "error" ? false : { level: context.env.logLevel },
  });

  app.decorate("arrab", context);

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
      "X-Requested-With",
    ],
  });
  await registerSecurity(app, context.accounts, (token) =>
    context.orgWorkforce.resolveSession(token),
  );
  registerErrorHandler(app);

  app.get("/health", async () => ({
    status: "ok" as const,
    service: "arrab-api" as const,
    time: new Date().toISOString(),
  }));

  registerV1Routes(app, {
    queries: context.queries,
    commands: context.commands,
    conversations: context.conversations,
    connectors: context.connectors,
    accounts: context.accounts,
    billing: context.billing,
    goals: context.goals,
    taskExecution: context.taskExecution,
    orgWorkforce: context.orgWorkforce,
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
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    arrab: ApiContext;
  }
}
