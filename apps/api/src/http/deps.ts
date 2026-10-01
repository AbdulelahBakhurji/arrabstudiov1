import type { SealedVaultService } from "../modules/encryption/sealed-vault-service.js";
import type { AiGateway } from "@arrab/ai";
import type { DeskService } from "../modules/desk/desk-service.js";
import type { CrewService } from "../modules/organization/crew-service.js";
import type { WorkforceBlueprintService } from "../modules/organization/workforce-blueprint-service.js";
import type { PersistenceMode } from "@arrab/shared";
import type { FastifyRequest } from "fastify";
import type { ConnectorService } from "../modules/connectors/connector-service.js";
import type { FamilyHouseholdService } from "../modules/family/family-household-service.js";
import type { ConversationService } from "../modules/conversations/conversation-service.js";
import type { AccountService } from "../modules/accounts/account-service.js";
import type { BillingService } from "../modules/billing/billing-service.js";
import type { GoalService } from "../modules/workspace/goal-service.js";
import type { TaskExecutionService } from "../modules/workspace/task-execution-service.js";
import type { OrgWorkforceService } from "../modules/organization/org-workforce-service.js";
import type { WorkspaceCommandService } from "../modules/workspace/workspace-commands.js";
import type { WorkspaceQueryService } from "../modules/workspace/workspace-query.js";

export type V1Deps = {
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
    sealedVault: SealedVaultService;
    desk: DeskService;
    crew: CrewService;
    workforceBlueprint: WorkforceBlueprintService;
    gateway: AiGateway;
    persistence: PersistenceMode;
    workspaceId: string;
    defaultModel: string | null;
    bedrockModels?: string[];
    openRouterModels?: string[];
    openRouterApiKey?: string;
    primaryProviderId?: string;
    bedrockRegion?: string;
    releasesDir: string;
    publicBaseUrl: string;
    openWaServerManaged?: boolean;
  };

export type RouteHelpers = {
  assertCap: (
    request: FastifyRequest,
    capability: Parameters<OrgWorkforceService["assertCapability"]>[1],
    detail: string,
  ) => Promise<void>;
  clientIp: (request: { ip?: string; headers: Record<string, unknown> }) => string | null;
};
