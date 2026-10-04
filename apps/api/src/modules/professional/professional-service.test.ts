import { emptyProfessionalWorkspace, normalizeProfessionalWorkspace } from "@arrab/shared";
import { describe, expect, it } from "vitest";
import { ProfessionalService } from "./professional-service.js";
import { createInMemoryPersistence } from "@arrab/database";

function stubAccounts() {
  return {
    hasAccount: async () => true,
  } as never;
}

function stubFamily() {
  return {
    isActiveChildSeat: async () => false,
  } as never;
}

describe("ProfessionalService", () => {
  it("refuses shell when a never rule matches", async () => {
    const persistence = createInMemoryPersistence();
    await persistence.professionalWorkspace.save(
      normalizeProfessionalWorkspace({
        ...emptyProfessionalWorkspace(),
        boundaries: [
          {
            id: "b1",
            label: "No rm",
            tool: "shell",
            match: "rm -rf",
            pace: "never",
            enabled: true,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    const service = new ProfessionalService(persistence, stubAccounts(), stubFamily());
    const result = await service.recordAction({
      tool: "shell",
      action: "rm -rf /tmp/x",
      companionId: "work",
      companionName: "Work",
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe("refused");
    expect(result.ruleId).toBe("b1");
  });

  it("blocks companion actions while control is taken", async () => {
    const persistence = createInMemoryPersistence();
    const service = new ProfessionalService(persistence, stubAccounts(), stubFamily());
    await service.takeControl({ companionId: "work", taken: true });
    const result = await service.recordAction({
      tool: "browser",
      action: "navigate",
      companionId: "work",
      companionName: "Work",
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe("refused");
  });

  it("stores muse ideas, watches, goals, and finance imports", async () => {
    const persistence = createInMemoryPersistence();
    const service = new ProfessionalService(persistence, stubAccounts(), stubFamily());
    await service.upsertIdea({ title: "Reply to the board", source: "mail" });
    await service.upsertWatch({ url: "https://example.com/jobs", label: "Jobs", kind: "change" });
    await service.upsertGoal({
      title: "Ship professional desk",
      milestones: [{ title: "API", done: true }, { title: "Quiet UI", done: false }],
    });
    await service.importFinance({
      csv: "category,amount\nFood,40\nTravel,120\nFood,15",
      savingsGoal: "Cut travel",
    });
    const view = await service.get();
    expect(view.ideas).toHaveLength(1);
    expect(view.ideas[0]?.title).toBe("Reply to the board");
    expect(view.watches[0]?.url).toBe("https://example.com/jobs");
    expect(view.goals[0]?.milestones).toHaveLength(2);
    expect(view.finance[0]?.transactionCount).toBe(3);
    expect(view.finance[0]?.categoryTotals.find((row) => row.category === "Food")?.amount).toBe(55);

    const watchId = view.watches[0]!.id;
    await service.observeWatch({ id: watchId, observation: "hash-a" });
    await service.observeWatch({ id: watchId, observation: "hash-b" });
    const after = await service.get();
    expect(after.watches[0]?.lastObservation).toBe("hash-b");
    expect(after.activity.some((event) => event.title.includes("Watch changed"))).toBe(true);
  });

  it("keeps 24/7 stay enabled by default and records sweeps", async () => {
    const persistence = createInMemoryPersistence();
    const service = new ProfessionalService(persistence, stubAccounts(), stubFamily());
    const before = await service.get();
    expect(before.stayEnabled).toBe(true);
    await service.upsertResponsibility({
      title: "Morning triage",
      companionId: "work",
      companionName: "Work",
      scheduleHour: Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Riyadh",
          hour: "numeric",
          hour12: false,
        }).format(new Date()),
      ),
    });
    const swept = await service.markStaySwept();
    expect(swept.lastStaySweepAt).toBeTruthy();
    expect(swept.companionStatus.some((item) => item.status === "needs_you" || item.status === "working")).toBe(
      true,
    );
    const off = await service.setStay({ enabled: false });
    expect(off.stayEnabled).toBe(false);
  });
});
