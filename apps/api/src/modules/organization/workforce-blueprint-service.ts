import { ValidationError, randomIdGenerator, systemClock, type Clock, type IdGenerator } from "@arrab/core";
import type { Persistence } from "@arrab/database";
import type { AiGateway } from "@arrab/ai";
import {
  blueprintSystemPrompt,
  blueprintUserPrompt,
  brandId,
  normalizeWorkforceBlueprint,
  parseBlueprintJson,
  templateWorkforceBlueprint,
  type UsageEvent,
  type WorkforceBlueprint,
  type WorkforceBlueprintRequest,
  type WorkspaceId,
} from "@arrab/shared";
import type { AccountService } from "../accounts/account-service.js";

export class WorkforceBlueprintService {
  constructor(
    private readonly persistence: Persistence,
    private readonly gateway: AiGateway,
    private readonly accounts: AccountService,
    private readonly defaultModel: string | null,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  async draft(body: WorkforceBlueprintRequest): Promise<WorkforceBlueprint> {
    const request: WorkforceBlueprintRequest = {
      industry: typeof body?.industry === "string" ? body.industry.trim() : "",
      details: typeof body?.details === "string" ? body.details.trim() : null,
      locale: body?.locale === "ar" ? "ar" : "en",
    };
    if (request.industry.length < 2) {
      throw new ValidationError("Describe what the company does");
    }

    const provider = this.gateway.listProviders()[0];
    if (!provider || !this.defaultModel) {
      return templateWorkforceBlueprint(request);
    }
    await this.accounts.assertWithinQuota();

    try {
      const completion = await this.gateway.complete({
        model: { providerId: provider.id, model: this.defaultModel },
        maxOutputTokens: 6000,
        messages: [
          { role: "system", content: blueprintSystemPrompt(request.locale ?? "en") },
          { role: "user", content: blueprintUserPrompt(request) },
        ],
      });
      const usage: UsageEvent = {
        id: this.ids.next("use"),
        workspaceId: brandId<WorkspaceId>(this.persistence.workspaceId),
        conversationId: null,
        agentId: null,
        providerId: provider.id,
        model: this.defaultModel,
        inputTokens: completion.usage?.inputTokens ?? 0,
        outputTokens: completion.usage?.outputTokens ?? 0,
        createdAt: this.clock.isoNow(),
      };
      await this.persistence.usage.append(usage);
      const parsed = normalizeWorkforceBlueprint(
        parseBlueprintJson(completion.message.content),
        request,
      );
      return parsed ?? templateWorkforceBlueprint(request);
    } catch {
      return templateWorkforceBlueprint(request);
    }
  }
}
