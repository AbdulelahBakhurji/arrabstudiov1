import { SyncService } from "./modules/sync/sync-service.js";
import { SealedVaultService } from "./modules/encryption/sealed-vault-service.js";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
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
import { AppError, ValidationError } from "@arrab/core";
import { orgSeatLimitForPlan } from "@arrab/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiEnv } from "./platform/config/env.js";
import { configureFieldCrypto } from "./platform/crypto/field-crypto.js";
import { Metrics } from "./platform/observability/metrics.js";
import { requestIdFrom } from "./platform/http/request-id.js";
import {
  buildModelRegistry,
  fallbackChainFor,
  type ModelRegistry,
} from "./platform/config/model-catalog.js";
import { registerErrorHandler } from "./platform/http/error-handler.js";
import { registerSecurity } from "./platform/http/security.js";
import { registerV1Routes } from "./http/v1.js";
import { registerErpRoutes } from "./modules/erp/erp.routes.js";
import { registerClientRoutes } from "./modules/control/client.routes.js";
import { ControlNotificationComposer } from "./modules/control/control-notification-composer.js";
import { ErpCompanionService } from "./modules/erp/erp-companion-service.js";
import { ControlNotificationService, ControlDeskService } from "./modules/control/control-notification-service.js";
import { ConversationService } from "./modules/conversations/conversation-service.js";
import { ConnectorService } from "./modules/connectors/connector-service.js";
import { AccountService } from "./modules/accounts/account-service.js";
import { BillingService } from "./modules/billing/billing-service.js";
import { createMoyasarClient } from "./modules/billing/moyasar.js";
import { GoalService } from "./modules/workspace/goal-service.js";
import { TaskExecutionService } from "./modules/workspace/task-execution-service.js";
import { TeamRunService } from "./modules/workspace/team-run-service.js";
import { DeskService } from "./modules/desk/desk-service.js";
import { CrewService } from "./modules/organization/crew-service.js";
import { OrgWorkforceService } from "./modules/organization/org-workforce-service.js";
import { WorkforceBlueprintService } from "./modules/organization/workforce-blueprint-service.js";
import { FamilyHouseholdService } from "./modules/family/family-household-service.js";
import { WorkspaceCommandService } from "./modules/workspace/workspace-commands.js";
import { WorkspaceQueryService } from "./modules/workspace/workspace-query.js";

/** Largest signed-webhook body we will buffer (Meta / OpenWA payloads are a few KB). */
const WEBHOOK_BODY_LIMIT_BYTES = 1_048_576;

export interface ApiContext {
  metrics: Metrics;
  env: ApiEnv;
  persistence: Persistence;
  postgres: DatabaseConnection | null;
  flushPersistence?: () => Promise<void>;
  aiGateway: RegistryAiGateway;
  chatRuntime: GatewayChatRuntime;
  defaultModel: string;
  primaryProviderId: string;
  modelRegistry: ModelRegistry;
  queries: WorkspaceQueryService;
  commands: WorkspaceCommandService;
  conversations: ConversationService;
  connectors: ConnectorService;
  accounts: AccountService;
  billing: BillingService;
  goals: GoalService;
  taskExecution: TaskExecutionService;
  teamRuns: TeamRunService;
  orgWorkforce: OrgWorkforceService;
  familyHousehold: FamilyHouseholdService;
  sealedVault: SealedVaultService;
  desk: DeskService;
  crew: CrewService;
  workforceBlueprint: WorkforceBlueprintService;
  sync: SyncService;
}

export async function createApiContext(env: ApiEnv): Promise<ApiContext> {
  configureFieldCrypto(
    env.dataEncryptionKey,
    env.dataDir,
    Boolean(env.databaseUrl) && process.env.ARRAB_ALLOW_INSECURE_DATA_KEY === "1",
  );
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
    env.openwaWebhookSecret?.trim() || null,
    env.publicBaseUrl,
    env.apiRoutePrefix,
    env.openwaBaseUrl,
    env.openwaApiKey?.trim() || null,
  );
  if (env.allowPlanCodes && env.databaseUrl) {
    console.warn(
      "[arrab-api] ARRAB_ENABLE_PLAN_CODES=1 on a database-backed API: anyone can redeem a public code for a paid plan. Disable it in production.",
    );
  }
  const accounts = new AccountService(
    persistence,
    env.publicBaseUrl,
    env.authWebUrl,
    undefined,
    undefined,
    { allowPlanCodes: env.allowPlanCodes, signupEmails: env.signupEmails },
  );
  const billing = new BillingService(
    accounts,
    createMoyasarClient(env.moyasarSecretKey),
    env.siteUrl,
  );
  const familyHousehold = new FamilyHouseholdService(persistence, accounts);
  connectors.setFamilyHousehold(familyHousehold);
  const sealedVault = new SealedVaultService(persistence);
  sealedVault.setFamilyHousehold(familyHousehold);
  accounts.onAccountReset(() => connectors.purgeAll());
  accounts.onAccountReset(() => sealedVault.purgeAll());
  const sync = new SyncService(persistence, () => sealedVault.currentOwnerKey());
  accounts.onAccountReset(() => sync.purgeAll());
  const metrics = new Metrics();
  const modelRegistry = buildModelRegistry({
    primaryProviderId,
    defaultModel: resolvedDefaultModel,
    openRouterModels: env.openRouterModels,
    bedrockModels: env.bedrockModels,
  });
  const conversations = new ConversationService(
    persistence,
    aiGateway,
    chatRuntime,
    resolvedDefaultModel,
    connectors,
    accounts,
    familyHousehold,
    undefined,
    undefined,
    new Set(modelRegistry.models.map((entry) => entry.id)),
    (model) => fallbackChainFor(modelRegistry, model).slice(1),
    metrics,
  );
  const goals = new GoalService(persistence);
  const taskExecution = new TaskExecutionService(
    persistence,
    conversations,
    aiGateway,
    accounts,
  );
  const teamRuns = new TeamRunService(persistence, commands, taskExecution);
  const desk = new DeskService(
    persistence,
    aiGateway,
    accounts,
    familyHousehold,
    resolvedDefaultModel,
    undefined,
    undefined,
    async (input) => {
      const connector = await connectors.findConnectedWhatsApp();
      if (!connector) throw new ValidationError("Connect WhatsApp before this message can leave");
      const sent = await connectors.sendWhatsApp(connector.id, { to: input.to, text: input.text });
      return { messageId: sent.messageId };
    },
  );
  const crew = new CrewService(
    persistence,
    aiGateway,
    accounts,
    familyHousehold,
    resolvedDefaultModel,
  );
  // Org seats are an organization-plan feature: 0 on individual/family plans (not the old default of 8).
  const orgWorkforce = new OrgWorkforceService(persistence, undefined, undefined, async () => {
    const plan = await accounts.planEntitlements();
    if (!plan) return null;
    return plan.orgWorkforce ? orgSeatLimitForPlan(plan.planId) : 0;
  });
  commands.setAgentLimit(async () => (await accounts.planEntitlements())?.maxAgents ?? null);
  const workforceBlueprint = new WorkforceBlueprintService(
    persistence,
    aiGateway,
    accounts,
    resolvedDefaultModel,
  );

  return {
    metrics,
    env,
    persistence,
    postgres,
    flushPersistence,
    aiGateway,
    chatRuntime,
    defaultModel: resolvedDefaultModel,
    primaryProviderId,
    modelRegistry,
    queries,
    commands,
    conversations,
    connectors,
    accounts,
    billing,
    goals,
    taskExecution,
    teamRuns,
    orgWorkforce,
    familyHousehold,
    sealedVault,
    desk,
    crew,
    workforceBlueprint,
    sync,
  };
}

export async function buildApp(context: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({
    // A hop count is valid at runtime; the typings only list boolean | string.
    trustProxy: context.env.trustProxy as boolean,
    // Bound request size / path params so hostile clients cannot OOM the process (SEC-06).
    bodyLimit: 1 * 1024 * 1024,
    routerOptions: { maxParamLength: 200 },
    // Every request has an id: the caller's `X-Request-Id` when it is well-formed (end-to-end
    // correlation from the app), otherwise a fresh UUID. It is echoed on the response and in errors.
    genReqId: (req) => requestIdFrom(req),
    logger:
      context.env.logLevel === "error"
        ? false
        : {
            level: context.env.logLevel,
            ...(context.env.logStream ? { stream: context.env.logStream } : {}),
            // Credentials never reach a log line.
            redact: {
              paths: [
                "req.headers.authorization",
                'req.headers["x-arrab-account-session"]',
                'req.headers["x-arrab-employee-session"]',
                'req.headers["x-arrab-refresh-token"]',
                "req.headers.cookie",
              ],
              censor: "[redacted]",
            },
          },
  });

  app.decorate("arrab", context);

  // Observability: request id on every response, RED metrics per route pattern.
  const metrics = context.metrics;
  metrics.describe("arrab_http_requests_total", "HTTP requests by route pattern, method and status class");
  metrics.describe("arrab_http_request_duration_ms", "HTTP request latency in milliseconds");
  metrics.describe("arrab_ai_requests_total", "AI completion attempts by provider, model and outcome");
  metrics.describe("arrab_ai_request_duration_ms", "AI completion latency in milliseconds");
  metrics.describe("arrab_ai_tokens_total", "Tokens billed by provider, model and direction");
  metrics.describe("arrab_ai_fallback_total", "AI model fallbacks after a retryable provider error");
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
  });
  app.addHook("onResponse", async (request, reply) => {
    const route = (request.routeOptions.url ?? "unmatched").replace(/^\/r\/[^/]+/, "");
    const labels = { route, method: request.method, status: `${Math.floor(reply.statusCode / 100)}xx` };
    metrics.inc("arrab_http_requests_total", labels);
    metrics.observe("arrab_http_request_duration_ms", reply.elapsedTime, { route, method: request.method });
  });

  // Route inventory: used by the authorization matrix tests, and handy for ops ("what does this API expose?").
  const routeTable: Array<{ method: string; url: string }> = [];
  app.decorate("routeTable", routeTable);
  app.addHook("onRoute", (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      if (method !== "HEAD" && method !== "OPTIONS") routeTable.push({ method, url: route.url });
    }
  });

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
      const loopbackOk = process.env.NODE_ENV !== "production";
      const allowed =
        context.env.corsOrigins.includes(origin) ||
        (loopbackOk && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) ||
        origin === "tauri://localhost" ||
        /^https?:\/\/tauri\.localhost$/i.test(origin);
      callback(null, allowed);
    },
    maxAge: 600,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Arrab-Account-Session",
      "X-Arrab-Employee-Session",
      "X-Arrab-Family-Member",
      "X-Arrab-Platform",
      "X-Arrab-App-Version",
      "X-Arrab-Device-Name",
      "X-Arrab-Refresh",
      "X-Request-Id",
      "X-Requested-With",
    ],
    // Lets browser clients read the correlation id and rate-limit hints.
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  });
  await registerSecurity(
    app,
    context.accounts,
    async (token) => {
      const employee = await context.orgWorkforce.resolveSession(token);
      if (!employee) return null;
      // A seat only means something on an organization plan: after a downgrade its sessions stop working
      // immediately instead of lingering with org access.
      const plan = await context.accounts.planEntitlements();
      return !plan || plan.orgWorkforce ? employee : null;
    },
    stripPrefix,
  );
  registerErrorHandler(app);

  // Coolify/Traefik may inject CORP:same-site which breaks Tauri (tauri.localhost).
  // Force cross-origin so desktop/browser clients can read API responses.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    // JSON API: never render, frame, sniff or cache authenticated responses.
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    // Sign-in / OAuth bridge pages carry inline script + style; JSON gets the strict policy.
    const isHtml = String(reply.getHeader("content-type") ?? "").startsWith("text/html");
    reply.header(
      "Content-Security-Policy",
      isHtml
        ? "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
        : "default-src 'none'; frame-ancestors 'none'",
    );
    reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  const routePrefix = context.env.apiRoutePrefix;
  const signedWebhookPaths = new Set(
    [
      "/v1/connectors/whatsapp/webhook",
      "/v1/connectors/openwa/webhook",
    ].concat(
      routePrefix
        ? [
            `${routePrefix}/v1/connectors/whatsapp/webhook`,
            `${routePrefix}/v1/connectors/openwa/webhook`,
          ]
        : [],
      [
        "/r/nmpi6uidtpkh1bdf/v1/connectors/whatsapp/webhook",
        "/r/nmpi6uidtpkh1bdf/v1/connectors/openwa/webhook",
      ],
    ),
  );

  // Capture raw body for signed connector webhooks (Meta + OpenWA HMAC).
  app.addHook("preParsing", async (request, _reply, payload) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (request.method !== "POST" || !signedWebhookPaths.has(path)) {
      return payload;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of payload) {
      const piece = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      received += piece.length;
      // These endpoints are public (authenticated only by signature, which needs the whole body):
      // cap what we buffer so an unauthenticated POST cannot exhaust memory.
      if (received > WEBHOOK_BODY_LIMIT_BYTES) {
        throw new AppError("PAYLOAD_TOO_LARGE", "Webhook payload is too large", 413, true);
      }
      chunks.push(piece);
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
    teamRuns: context.teamRuns,
    orgWorkforce: context.orgWorkforce,
    familyHousehold: context.familyHousehold,
    sealedVault: context.sealedVault,
    desk: context.desk,
    crew: context.crew,
    workforceBlueprint: context.workforceBlueprint,
    sync: context.sync,
    gateway: context.aiGateway,
    persistence: context.persistence.kind,
    workspaceId: context.persistence.workspaceId,
    defaultModel: context.defaultModel,
    bedrockModels: context.env.bedrockModels,
    openRouterModels: context.env.openRouterModels,
    openRouterApiKey: context.env.openRouterApiKey,
    primaryProviderId: context.primaryProviderId,
    modelRegistry: context.modelRegistry,
    bedrockRegion: context.env.bedrockRegion,
    releasesDir: context.env.releasesDir,
    publicBaseUrl: context.env.siteUrl,
    openWaServerManaged: Boolean(context.env.openwaApiKey?.trim()),
  };

  // Shared across route mounts so ack batching and dedupe see every request.
  const controlNotifications = new ControlNotificationService(context.persistence.controlNotifications);
  const controlDesk = new ControlDeskService(context.persistence.controlDesk);
  const notificationComposer = new ControlNotificationComposer(context.aiGateway, () =>
    context.aiGateway.listProviders().some((provider) => provider.id === context.primaryProviderId)
      ? { providerId: context.primaryProviderId, model: context.defaultModel }
      : null,
  );
  app.addHook("onClose", async () => {
    await controlNotifications.flushAcks();
  });

  const registerCoreRoutes = async (instance: FastifyInstance) => {
    instance.get("/health", async () => ({
      status: "ok" as const,
      service: "arrab-api" as const,
      time: new Date().toISOString(),
    }));

    // Readiness: can this instance actually serve? (liveness is /health and never touches the database)
    instance.get("/ready", async (_request, reply) => {
      try {
        if (context.postgres) await context.postgres.ping();
        else await context.persistence.getWorkspace();
        return { status: "ready" as const };
      } catch {
        return reply.status(503).send({ status: "unavailable" as const });
      }
    });

    // Prometheus scrape endpoint. Off unless ARRAB_METRICS_TOKEN is set; compares in constant time.
    instance.get("/metrics", async (request, reply) => {
      const expected = context.env.metricsToken?.trim();
      if (!expected) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
      const given = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const a = Buffer.from(given);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid metrics token" } });
      }
      return reply.type("text/plain; version=0.0.4").send(context.metrics.render());
    });
    registerV1Routes(instance, v1Options);
    registerClientRoutes(instance, {
      notifications: controlNotifications,
      desk: controlDesk,
      accounts: context.accounts,
    });
    registerErpRoutes(instance, {
      companions: new ErpCompanionService(context.persistence.erpCompanions),
      notifications: controlNotifications,
      composer: notificationComposer,
      desk: controlDesk,
      accounts: context.accounts,
      erpToken: context.env.erpToken,
      erpTokenScopes: context.env.erpTokenScopes ?? [
        "companions:read",
        "companions:write",
        "notifications:write",
        "connectors:write",
      ],
    });
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
    routeTable: Array<{ method: string; url: string }>;
  }
}
