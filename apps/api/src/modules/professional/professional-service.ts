import {
  ForbiddenError,
  ValidationError,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "@arrab/core";
import type { Persistence } from "@arrab/database";
import {
  normalizeProfessionalWorkspace,
  type AppendActivityRequest,
  type ImportMuseFinanceRequest,
  type ObserveMuseWatchRequest,
  type ProfessionalAuditEvent,
  type ProfessionalBoundaryRule,
  type ProfessionalWorkspaceState,
  type ProfessionalWorkspaceView,
  type RecordProfessionalActionRequest,
  type RecordProfessionalActionResponse,
  type SetCompanionStatusRequest,
  type SetProfessionalStayRequest,
  type SetSkillGrantRequest,
  type TakeControlRequest,
  type UpsertBoundaryRequest,
  type UpsertMcpPluginRequest,
  type UpsertMuseGoalRequest,
  type UpsertMuseIdeaRequest,
  type UpsertMuseWatchRequest,
  type UpsertReachabilityRequest,
  type UpsertResponsibilityRequest,
} from "@arrab/shared";
import type { AccountService } from "../accounts/account-service.js";
import type { FamilyHouseholdService } from "../family/family-household-service.js";

export class ProfessionalService {
  constructor(
    private readonly persistence: Persistence,
    private readonly accounts: AccountService,
    private readonly family: FamilyHouseholdService,
    private readonly ids: IdGenerator = randomIdGenerator,
    private readonly clock: Clock = systemClock,
  ) {}

  async get(): Promise<ProfessionalWorkspaceView> {
    await this.assertReadable();
    const state = await this.load();
    return { ...state, updatedAt: this.clock.isoNow() };
  }

  async upsertBoundary(input: UpsertBoundaryRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const label = input.label?.trim() ?? "";
    if (!label) throw new ValidationError("Boundary needs a label");
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("bound");
    const next: ProfessionalBoundaryRule = {
      id,
      label: label.slice(0, 120),
      tool: input.tool ?? "*",
      match: (input.match ?? "").trim().slice(0, 240),
      pace: input.pace === "allow" || input.pace === "never" ? input.pace : "ask",
      enabled: input.enabled !== false,
      createdAt: state.boundaries.find((rule) => rule.id === id)?.createdAt ?? now,
    };
    const boundaries = [...state.boundaries.filter((rule) => rule.id !== id), next].slice(0, 200);
    return this.save({ ...state, boundaries });
  }

  async removeBoundary(id: string): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const state = await this.load();
    return this.save({
      ...state,
      boundaries: state.boundaries.filter((rule) => rule.id !== id),
    });
  }

  /**
   * Fail-closed gate: evaluate boundaries, write audit, return whether the action may proceed.
   * Call this before any computer/MCP/tool side effect.
   */
  async recordAction(input: RecordProfessionalActionRequest): Promise<RecordProfessionalActionResponse> {
    await this.assertWritable();
    const state = await this.load();
    const now = this.clock.isoNow();
    const companionId = (input.companionId ?? "").trim() || "general";
    const companionName = (input.companionName ?? "").trim() || companionId;
    const action = (input.action ?? "").trim();
    if (!action) throw new ValidationError("Action is required");

    if (state.controlTaken && state.controlCompanionId === companionId) {
      const event = this.auditEvent({
        companionId,
        companionName,
        tool: input.tool,
        action,
        detail: "Refused while a person has the wheel",
        verdict: "refused",
        ruleId: "control_taken",
        initiator: input.initiator ?? "companion",
        at: now,
      });
      await this.save({ ...state, audit: [...state.audit, event].slice(-500) });
      return { allowed: false, verdict: "refused", event, ruleId: "control_taken" };
    }

    const haystack = `${action}\n${input.detail ?? ""}`.toLowerCase();
    const matching = state.boundaries.filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.tool !== "*" && rule.tool !== input.tool) return false;
      if (!rule.match.trim()) return true;
      return haystack.includes(rule.match.trim().toLowerCase());
    });

    // Deny / never first.
    const denied = matching.find((rule) => rule.pace === "never");
    if (denied) {
      const event = this.auditEvent({
        companionId,
        companionName,
        tool: input.tool,
        action,
        detail: (input.detail ?? "").slice(0, 2000),
        verdict: "refused",
        ruleId: denied.id,
        initiator: input.initiator ?? "companion",
        at: now,
      });
      await this.save({ ...state, audit: [...state.audit, event].slice(-500) });
      return { allowed: false, verdict: "refused", event, ruleId: denied.id };
    }

    const ask = matching.find((rule) => rule.pace === "ask");
    if (ask) {
      const event = this.auditEvent({
        companionId,
        companionName,
        tool: input.tool,
        action,
        detail: (input.detail ?? "").slice(0, 2000),
        verdict: "pending",
        ruleId: ask.id,
        initiator: input.initiator ?? "companion",
        at: now,
      });
      await this.save({ ...state, audit: [...state.audit, event].slice(-500) });
      return { allowed: false, verdict: "pending", event, ruleId: ask.id };
    }

    // Explicit allow, or no matching rule with ask/never — still require at least one allow for this tool or "*".
    const allowedRule = matching.find((rule) => rule.pace === "allow");
    const hasAnyRuleForTool = state.boundaries.some(
      (rule) => rule.enabled && (rule.tool === "*" || rule.tool === input.tool),
    );
    if (!allowedRule && hasAnyRuleForTool) {
      // Rules exist for this tool but none matched allow → fail closed.
      const event = this.auditEvent({
        companionId,
        companionName,
        tool: input.tool,
        action,
        detail: "No allow rule matched",
        verdict: "refused",
        ruleId: null,
        initiator: input.initiator ?? "companion",
        at: now,
      });
      await this.save({ ...state, audit: [...state.audit, event].slice(-500) });
      return { allowed: false, verdict: "refused", event, ruleId: null };
    }

    const event = this.auditEvent({
      companionId,
      companionName,
      tool: input.tool,
      action,
      detail: (input.detail ?? "").slice(0, 2000),
      verdict: "permitted",
      ruleId: allowedRule?.id ?? null,
      initiator: input.initiator ?? "companion",
      at: now,
    });
    await this.save({ ...state, audit: [...state.audit, event].slice(-500) });
    return { allowed: true, verdict: "permitted", event, ruleId: allowedRule?.id ?? null };
  }

  async appendActivity(input: AppendActivityRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const title = input.title?.trim() ?? "";
    if (!title) throw new ValidationError("Activity needs a title");
    const state = await this.load();
    const event = {
      id: this.ids.next("act"),
      at: this.clock.isoNow(),
      companionId: (input.companionId ?? "").trim() || "general",
      kind: input.kind,
      title: title.slice(0, 200),
      output: (input.output ?? "").slice(0, 4000),
    };
    return this.save({ ...state, activity: [...state.activity, event].slice(-200) });
  }

  async takeControl(input: TakeControlRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const companionId = input.companionId?.trim() ?? "";
    if (!companionId) throw new ValidationError("Companion is required");
    const state = await this.load();
    const now = this.clock.isoNow();
    const audit = [
      ...state.audit,
      this.auditEvent({
        companionId,
        companionName: companionId,
        tool: "computer",
        action: input.taken ? "computer.control_taken" : "computer.control_released",
        detail: "",
        verdict: "permitted",
        ruleId: null,
        initiator: "person",
        at: now,
      }),
    ].slice(-500);
    return this.save({
      ...state,
      controlTaken: Boolean(input.taken),
      controlCompanionId: input.taken ? companionId : null,
      audit,
    });
  }

  async upsertResponsibility(input: UpsertResponsibilityRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const title = input.title?.trim() ?? "";
    if (!title) throw new ValidationError("Responsibility needs a title");
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("resp");
    const existing = state.responsibilities.find((item) => item.id === id);
    const next = {
      id,
      companionId: (input.companionId ?? existing?.companionId ?? "general").trim() || "general",
      companionName: (input.companionName ?? existing?.companionName ?? "Companion").trim() || "Companion",
      title: title.slice(0, 160),
      instruction: (input.instruction ?? existing?.instruction ?? "").slice(0, 2000),
      successCriteria: (input.successCriteria ?? existing?.successCriteria ?? "").slice(0, 800),
      status: input.status ?? existing?.status ?? "active",
      scheduleHour:
        input.scheduleHour === undefined
          ? (existing?.scheduleHour ?? null)
          : input.scheduleHour === null
            ? null
            : Number.isInteger(input.scheduleHour) &&
                input.scheduleHour >= 0 &&
                input.scheduleHour <= 23
              ? input.scheduleHour
              : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.save({
      ...state,
      responsibilities: [...state.responsibilities.filter((item) => item.id !== id), next].slice(0, 100),
    });
  }

  async removeResponsibility(id: string): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const state = await this.load();
    return this.save({
      ...state,
      responsibilities: state.responsibilities.filter((item) => item.id !== id),
    });
  }

  async setSkillGrant(input: SetSkillGrantRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    if (!input.skillId?.trim() || !input.companionId?.trim()) {
      throw new ValidationError("Skill and companion are required");
    }
    const state = await this.load();
    const grants = state.skillGrants.filter(
      (grant) => !(grant.skillId === input.skillId && grant.companionId === input.companionId),
    );
    grants.push({
      skillId: input.skillId.trim(),
      companionId: input.companionId.trim(),
      enabled: Boolean(input.enabled),
    });
    return this.save({ ...state, skillGrants: grants.slice(0, 500) });
  }

  async upsertReachability(input: UpsertReachabilityRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const target = input.target?.trim() ?? "";
    if (!target) throw new ValidationError("Reachability needs a target");
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("reach");
    const next: import("@arrab/shared").ProfessionalReachabilityBinding = {
      id,
      companionId: (input.companionId ?? "general").trim() || "general",
      companionName: (input.companionName ?? "Companion").trim() || "Companion",
      channel: input.channel === "teams" || input.channel === "sms" ? input.channel : "slack",
      target: target.slice(0, 240),
      enabled: input.enabled !== false,
      createdAt: state.reachability.find((item) => item.id === id)?.createdAt ?? now,
    };
    return this.save({
      ...state,
      reachability: [...state.reachability.filter((item) => item.id !== id), next].slice(0, 100),
    });
  }

  async removeReachability(id: string): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const state = await this.load();
    return this.save({
      ...state,
      reachability: state.reachability.filter((item) => item.id !== id),
    });
  }

  async upsertPlugin(input: UpsertMcpPluginRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const key = input.key?.trim() ?? "";
    const name = input.name?.trim() ?? "";
    if (!key || !name) throw new ValidationError("Plugin needs a key and name");
    if (input.kind === "custom") {
      const url = (input.url ?? "").trim();
      if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
        throw new ValidationError("Custom MCP URL must be https or local loopback");
      }
    }
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("mcp");
    const existing = state.plugins.find((item) => item.id === id || item.key === key);
    const next = {
      id: existing?.id ?? id,
      key: key.slice(0, 80),
      name: name.slice(0, 120),
      kind: input.kind === "custom" ? ("custom" as const) : ("catalogue" as const),
      url: (input.url ?? existing?.url ?? "").slice(0, 500),
      enabled: input.enabled ?? existing?.enabled ?? false,
      grantedCompanionIds:
        input.grantedCompanionIds ?? existing?.grantedCompanionIds ?? [],
      createdAt: existing?.createdAt ?? now,
    };
    return this.save({
      ...state,
      plugins: [...state.plugins.filter((item) => item.id !== next.id && item.key !== key), next].slice(
        0,
        100,
      ),
    });
  }

  async setCompanionStatus(input: SetCompanionStatusRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const companionId = input.companionId?.trim() ?? "";
    if (!companionId) throw new ValidationError("Companion is required");
    const state = await this.load();
    const existing = state.companionStatus.find((item) => item.companionId === companionId);
    const next = {
      companionId,
      companionName: (input.companionName ?? existing?.companionName ?? companionId).trim(),
      status: input.status ?? existing?.status ?? "idle",
      needsYou:
        input.needsYou === undefined
          ? (existing?.needsYou ?? null)
          : input.needsYou === null
            ? null
            : input.needsYou.slice(0, 400),
      paused: input.paused ?? existing?.paused ?? false,
      updatedAt: this.clock.isoNow(),
    };
    return this.save({
      ...state,
      companionStatus: [
        ...state.companionStatus.filter((item) => item.companionId !== companionId),
        next,
      ].slice(0, 200),
    });
  }

  async upsertIdea(input: UpsertMuseIdeaRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const title = input.title?.trim() ?? "";
    if (!title) throw new ValidationError("Idea needs a title");
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("idea");
    const existing = state.ideas.find((item) => item.id === id);
    const next = {
      id,
      title: title.slice(0, 160),
      body: (input.body ?? existing?.body ?? "").slice(0, 2000),
      source: (input.source ?? existing?.source ?? "").slice(0, 240),
      status: input.status ?? existing?.status ?? ("open" as const),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.save({
      ...state,
      ideas: [...state.ideas.filter((item) => item.id !== id), next].slice(0, 100),
    });
  }

  async upsertWatch(input: UpsertMuseWatchRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const url = input.url?.trim() ?? "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new ValidationError("Watch needs an http(s) URL");
    }
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("watch");
    const existing = state.watches.find((item) => item.id === id);
    const next = {
      id,
      url: url.slice(0, 500),
      label: (input.label ?? existing?.label ?? url).slice(0, 120),
      kind: input.kind ?? existing?.kind ?? ("change" as const),
      thresholdUsd:
        input.thresholdUsd === undefined
          ? (existing?.thresholdUsd ?? null)
          : input.thresholdUsd,
      lastObservation: existing?.lastObservation ?? "",
      paused: input.paused ?? existing?.paused ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.save({
      ...state,
      watches: [...state.watches.filter((item) => item.id !== id), next].slice(0, 100),
    });
  }

  async observeWatch(input: ObserveMuseWatchRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const id = input.id?.trim() ?? "";
    if (!id) throw new ValidationError("Watch id is required");
    const observation = (input.observation ?? "").trim().slice(0, 500);
    if (!observation) throw new ValidationError("Observation is required");
    const state = await this.load();
    const existing = state.watches.find((item) => item.id === id);
    if (!existing) throw new ValidationError("Watch not found");
    const now = this.clock.isoNow();
    const changed = existing.lastObservation !== "" && existing.lastObservation !== observation;
    const priceHit =
      existing.kind === "price" &&
      existing.thresholdUsd != null &&
      typeof input.priceUsd === "number" &&
      Number.isFinite(input.priceUsd) &&
      input.priceUsd <= existing.thresholdUsd;
    const next = {
      ...existing,
      lastObservation: observation,
      updatedAt: now,
    };
    let activity = state.activity;
    if (changed || priceHit) {
      activity = [
        ...activity,
        {
          id: this.ids.next("act"),
          at: now,
          companionId: "muse",
          kind: "note" as const,
          title: priceHit
            ? `Price watch hit: ${existing.label}`
            : `Watch changed: ${existing.label}`,
          output: observation.slice(0, 400),
        },
      ].slice(-200);
    }
    return this.save({
      ...state,
      watches: state.watches.map((item) => (item.id === id ? next : item)),
      activity,
    });
  }

  async importFinance(input: ImportMuseFinanceRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const csv = input.csv?.trim() ?? "";
    if (!csv) throw new ValidationError("CSV is required");
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const totals = new Map<string, number>();
    let count = 0;
    for (const line of lines.slice(0, 5_000)) {
      const parts = line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
      if (parts.length < 2) continue;
      if (/^category$/i.test(parts[0]!) || /^date$/i.test(parts[0]!)) continue;
      let category = "Other";
      let amount = 0;
      if (parts.length >= 4) {
        amount = Number(parts[2]);
        category = parts[3] || "Other";
      } else {
        category = parts[0] || "Other";
        amount = Number(parts[1]);
      }
      if (!Number.isFinite(amount)) continue;
      count += 1;
      totals.set(category, (totals.get(category) ?? 0) + amount);
    }
    const state = await this.load();
    const now = this.clock.isoNow();
    const summary = {
      id: this.ids.next("fin"),
      title: (input.title?.trim() || "Spending summary").slice(0, 120),
      categoryTotals: [...totals.entries()]
        .map(([category, amount]) => ({ category: category.slice(0, 80), amount }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 40),
      transactionCount: count,
      savingsGoal: (input.savingsGoal ?? "").slice(0, 200),
      createdAt: now,
    };
    return this.save({
      ...state,
      finance: [...state.finance, summary].slice(-20),
    });
  }

  async upsertGoal(input: UpsertMuseGoalRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const title = input.title?.trim() ?? "";
    if (!title) throw new ValidationError("Goal needs a title");
    const state = await this.load();
    const now = this.clock.isoNow();
    const id = input.id?.trim() || this.ids.next("goal");
    const existing = state.goals.find((item) => item.id === id);
    const milestones = (input.milestones ?? existing?.milestones ?? []).map((item, index) => ({
      id: ("id" in item && item.id?.trim()) || this.ids.next("ms") || `ms_${index}`,
      title: (item.title ?? "").trim().slice(0, 160),
      done: Boolean(item.done),
    })).filter((item) => item.title).slice(0, 40);
    const next = {
      id,
      title: title.slice(0, 160),
      milestones,
      status: input.status ?? existing?.status ?? ("open" as const),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.save({
      ...state,
      goals: [...state.goals.filter((item) => item.id !== id), next].slice(0, 100),
    });
  }

  async setStay(input: SetProfessionalStayRequest): Promise<ProfessionalWorkspaceView> {
    await this.assertWritable();
    const state = await this.load();
    const enabled = Boolean(input.enabled);
    const now = this.clock.isoNow();
    const companionStatus = state.companionStatus.map((item) =>
      enabled
        ? {
            ...item,
            status: item.status === "paused" ? item.status : ("working" as const),
            updatedAt: now,
          }
        : {
            ...item,
            status: item.status === "needs_you" ? item.status : ("idle" as const),
            updatedAt: now,
          },
    );
    return this.save({
      ...state,
      stayEnabled: enabled,
      companionStatus,
    });
  }

  /** Worker path — skip seat checks; only the stay worker calls this. */
  async getForWorker(): Promise<ProfessionalWorkspaceView> {
    const state = await this.load();
    return { ...state, updatedAt: this.clock.isoNow() };
  }

  async markStaySwept(): Promise<ProfessionalWorkspaceView> {
    const state = await this.load();
    if (!state.stayEnabled) {
      return { ...state, updatedAt: this.clock.isoNow() };
    }
    const now = this.clock.isoNow();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Riyadh",
        hour: "numeric",
        hour12: false,
      }).format(new Date(now)),
    );
    const due = state.responsibilities.filter(
      (item) =>
        item.status === "active" &&
        item.scheduleHour != null &&
        item.scheduleHour === hour,
    );
    let activity = state.activity;
    let companionStatus = state.companionStatus;
    for (const duty of due.slice(0, 20)) {
      const already = activity.some(
        (event) =>
          event.kind === "note" &&
          event.title.startsWith(`Duty due: ${duty.title}`) &&
          event.at.slice(0, 13) === now.slice(0, 13),
      );
      if (already) continue;
      activity = [
        ...activity,
        {
          id: this.ids.next("act"),
          at: now,
          companionId: duty.companionId || "general",
          kind: "note" as const,
          title: `Duty due: ${duty.title}`.slice(0, 200),
          output: (duty.instruction || duty.successCriteria || "").slice(0, 4000),
        },
      ].slice(-200);
      const existing = companionStatus.find((item) => item.companionId === duty.companionId);
      companionStatus = [
        ...companionStatus.filter((item) => item.companionId !== duty.companionId),
        {
          companionId: duty.companionId,
          companionName: duty.companionName || duty.companionId,
          status: "needs_you" as const,
          needsYou: duty.title.slice(0, 400),
          paused: existing?.paused ?? false,
          updatedAt: now,
        },
      ].slice(0, 200);
    }
    const onDuty =
      state.watches.some((item) => !item.paused) ||
      state.goals.some((item) => item.status === "open") ||
      due.length > 0;
    if (onDuty && companionStatus.length === 0) {
      companionStatus = [
        {
          companionId: "general",
          companionName: "Arrab",
          status: "working",
          needsYou: null,
          paused: false,
          updatedAt: now,
        },
      ];
    } else if (onDuty) {
      companionStatus = companionStatus.map((item) =>
        item.status === "idle"
          ? { ...item, status: "working" as const, updatedAt: now }
          : item,
      );
    }
    return this.save({
      ...state,
      activity,
      companionStatus,
      lastStaySweepAt: now,
    });
  }

  private auditEvent(input: {
    companionId: string;
    companionName: string;
    tool: ProfessionalAuditEvent["tool"];
    action: string;
    detail: string;
    verdict: ProfessionalAuditEvent["verdict"];
    ruleId: string | null;
    initiator: ProfessionalAuditEvent["initiator"];
    at: string;
  }): ProfessionalAuditEvent {
    return {
      id: this.ids.next("aud"),
      at: input.at,
      companionId: input.companionId,
      companionName: input.companionName,
      tool: input.tool,
      action: input.action.slice(0, 200),
      detail: input.detail.slice(0, 2000),
      verdict: input.verdict,
      ruleId: input.ruleId,
      initiator: input.initiator,
    };
  }

  private async load(): Promise<ProfessionalWorkspaceState> {
    return normalizeProfessionalWorkspace(await this.persistence.professionalWorkspace.get());
  }

  private async save(state: ProfessionalWorkspaceState): Promise<ProfessionalWorkspaceView> {
    const next = normalizeProfessionalWorkspace(state);
    await this.persistence.professionalWorkspace.save(next);
    return { ...next, updatedAt: this.clock.isoNow() };
  }

  private async assertReadable(): Promise<void> {
    if (await this.family.isActiveChildSeat()) {
      throw new ForbiddenError("Professional desk is not available on a child seat");
    }
  }

  private async assertWritable(): Promise<void> {
    await this.assertReadable();
    void this.accounts;
  }
}
