import cors from "@fastify/cors";
import {
  AnthropicMessagesAdapter,
  BedrockConverseAdapter,
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_PROVIDER_ID,
  isBedrockModel,
  OpenAiCompatibleAdapter,
  RegistryAiGateway,
  XAI_BASE_URL,
  XAI_DEFAULT_MODEL,
  XAI_PROVIDER_ID,
  isXaiGrokModel,
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
import { assertBedrockConfigured, type ApiEnv } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerSecurity } from "./plugins/security.js";
import { registerV1Routes } from "./routes/v1.js";
import { ConversationService } from "./services/conversation-service.js";
import { ConnectorService } from "./services/connector-service.js";
import { AccountService } from "./services/account-service.js";
import { GoalService } from "./services/goal-service.js";
import { TaskExecutionService } from "./services/task-execution-service.js";
import { WorkspaceCommandService } from "./services/workspace-commands.js";
import { WorkspaceQueryService } from "./services/workspace-query.js";

export interface ApiContext {
  env: ApiEnv;
  persistence: Persistence;
  postgres: DatabaseConnection | null;
  flushPersistence?: () => Promise<void>;
  aiGateway: RegistryAiGateway;
  chatRuntime: GatewayChatRuntime;
  queries: WorkspaceQueryService;
  commands: WorkspaceCommandService;
  conversations: ConversationService;
  connectors: ConnectorService;
  accounts: AccountService;
  goals: GoalService;
  taskExecution: TaskExecutionService;
}

export async function createApiContext(env: ApiEnv): Promise<ApiContext> {
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

  assertBedrockConfigured(env);

  const aiGateway = new RegistryAiGateway();
  if (env.bedrockApiKey) {
    aiGateway.register(
      new BedrockConverseAdapter({
        id: BEDROCK_PROVIDER_ID,
        apiKey: env.bedrockApiKey,
        region: env.bedrockRegion,
      }),
    );
  }
  if (env.openaiApiKey) {
    aiGateway.register(
      new OpenAiCompatibleAdapter({
        id: "openai",
        apiKey: env.openaiApiKey,
        baseUrl: env.openaiBaseUrl,
      }),
    );
  }
  if (env.anthropicApiKey) {
    aiGateway.register(
      new AnthropicMessagesAdapter({
        id: "anthropic",
        apiKey: env.anthropicApiKey,
      }),
    );
  }
  if (env.xaiApiKey) {
    aiGateway.register(
      new OpenAiCompatibleAdapter({
        id: XAI_PROVIDER_ID,
        apiKey: env.xaiApiKey,
        baseUrl: XAI_BASE_URL,
      }),
    );
  }

  const bedrockDefault = isBedrockModel(env.defaultModel, env.bedrockModels);
  const grokDefault = isXaiGrokModel(env.defaultModel);
  const defaultProviderId = bedrockDefault
    ? BEDROCK_PROVIDER_ID
    : grokDefault
      ? XAI_PROVIDER_ID
      : env.bedrockApiKey
        ? BEDROCK_PROVIDER_ID
        : env.openaiApiKey
          ? "openai"
          : env.anthropicApiKey
            ? "anthropic"
            : env.xaiApiKey
              ? XAI_PROVIDER_ID
              : "openai";
  const resolvedDefaultModel = bedrockDefault
    ? env.defaultModel
    : grokDefault
      ? env.defaultModel || XAI_DEFAULT_MODEL
      : env.bedrockApiKey
        ? env.bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL
        : env.openaiApiKey
          ? env.defaultModel
          : env.anthropicApiKey
            ? "claude-3-5-haiku-latest"
            : env.xaiApiKey
              ? XAI_DEFAULT_MODEL
              : env.defaultModel;
  const chatRuntime = new GatewayChatRuntime(defaultProviderId);
  const commands = new WorkspaceCommandService(persistence);
  const queries = new WorkspaceQueryService(persistence, commands);
  const connectors = new ConnectorService(persistence, commands);
  const accounts = new AccountService(
    persistence,
    env.publicBaseUrl,
    env.authWebUrl,
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
  );

  return {
    env,
    persistence,
    postgres,
    flushPersistence,
    aiGateway,
    chatRuntime,
    queries,
    commands,
    conversations,
    connectors,
    accounts,
    goals,
    taskExecution,
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
  });
  await registerSecurity(app);
  registerErrorHandler(app);

  app.get("/health", async () => ({
    status: "ok" as const,
    service: "arrab-api" as const,
    time: new Date().toISOString(),
  }));

  const defaultModel =
    context.aiGateway.listProviders().length > 0
      ? isBedrockModel(context.env.defaultModel, context.env.bedrockModels)
        ? context.env.defaultModel
        : isXaiGrokModel(context.env.defaultModel)
          ? context.env.defaultModel || XAI_DEFAULT_MODEL
          : context.env.bedrockApiKey
            ? context.env.bedrockModels[0] ?? BEDROCK_DEFAULT_MODEL
            : context.env.openaiApiKey
              ? context.env.defaultModel
              : context.env.anthropicApiKey
                ? "claude-3-5-haiku-latest"
                : context.env.xaiApiKey
                  ? XAI_DEFAULT_MODEL
                  : context.env.defaultModel
      : null;

  registerV1Routes(app, {
    queries: context.queries,
    commands: context.commands,
    conversations: context.conversations,
    connectors: context.connectors,
    accounts: context.accounts,
    goals: context.goals,
    taskExecution: context.taskExecution,
    gateway: context.aiGateway,
    persistence: context.persistence.kind,
    workspaceId: context.persistence.workspaceId,
    defaultModel,
    bedrockModels: context.env.bedrockModels,
    bedrockRegion: context.env.bedrockRegion,
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    arrab: ApiContext;
  }
}
