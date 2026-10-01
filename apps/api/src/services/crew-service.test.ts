import type { AiGateway } from "@arrab/ai";
import { createInMemoryPersistence, type Persistence } from "@arrab/database";
import { describe, expect, it } from "vitest";
import type { AccountService } from "./account-service.js";
import { CrewService } from "./crew-service.js";
import type { FamilyHouseholdService } from "./family-household-service.js";
import type { PlanAudience } from "@arrab/shared";

const NOW = "2026-09-29T06:00:00.000Z";

function service(options?: {
  child?: boolean;
  model?: string | null;
  now?: string;
  audience?: PlanAudience;
  reply?: string;
  persistence?: Persistence;
}) {
  const persistence = options?.persistence ?? createInMemoryPersistence(options?.now ?? NOW);
  let n = 0;
  const gateway = {
    listProviders: () => [{ id: "openrouter", kind: "openai" }],
    complete: async () => ({
      id: "c1",
      model: { providerId: "openrouter", model: "arrab" },
      message: { role: "assistant" as const, content: options?.reply ?? "The note is ready. Nothing was sent." },
      finishReason: "stop" as const,
      usage: { inputTokens: 8, outputTokens: 12 },
    }),
  } as unknown as AiGateway;
  const accounts = { assertWithinQuota: async () => undefined, status: async () => ({ account: null }) } as unknown as AccountService;
  const family = {
    isActiveChildSeat: async () => options?.child === true,
  } as unknown as FamilyHouseholdService;
  return new CrewService(
    persistence,
    gateway,
    accounts,
    family,
    options?.model === undefined ? "arrab" : options.model,
    { next: (prefix) => `${prefix}_${++n}` },
    { isoNow: () => options?.now ?? NOW },
    options?.audience ?? null,
  );
}

describe("crew", () => {
  it("seeds an individual roster and marks the morning note due in Riyadh", async () => {
    const view = await service().get();
    expect(view.audience).toBe("individual");
    expect(view.members.map((member) => member.lane)).toEqual(["chief", "research", "maker"]);
    expect(view.fitted).toBe(true);
    const morning = view.watches.find((watch) => watch.id === "watch_seed_morning");
    expect(morning?.due).toBe(true);
    expect(view.presence.crew_chief).toBe("needs_you");
    expect(view.rules.find((rule) => rule.action === "message")?.level).toBe("handoff");
  });

  it("seeds family and organization lanes", async () => {
    const family = await service({ audience: "family" }).get();
    expect(family.members.map((member) => member.lane)).toEqual(["household", "study", "care"]);
    const org = await service({ audience: "organization" }).get();
    expect(org.members.map((member) => member.name)).toEqual(["Amal", "Huda", "Rami", "Fares"]);
  });

  it("refuses to let money, messages, or the computer run on their own", async () => {
    const crew = service();
    await expect(crew.setRule({ action: "message", level: "allow" })).rejects.toThrow(/on its own/);
    await expect(crew.setRule({ action: "spend", level: "allow" })).rejects.toThrow(/on its own/);
    await expect(crew.setRule({ action: "publish", level: "allow" })).rejects.toThrow(/on its own/);
    await expect(crew.setRule({ action: "computer", level: "allow" })).rejects.toThrow(/on its own/);
    const blocked = await crew.setRule({ action: "draft", level: "block" });
    expect(blocked.rules.find((rule) => rule.action === "draft")?.level).toBe("block");
  });

  it("sends money back to a person and lets a draft move between teammates", async () => {
    const crew = service({ audience: "organization" });
    await crew.setRule({ action: "draft", level: "allow" });
    await expect(
      crew.pass({ fromId: "crew_inbox", toId: "crew_chief", title: "Pay the invoice", note: "Rent" }),
    ).rejects.toThrow(/come back to a person/);
    const held = await crew.pass({
      fromId: "crew_inbox",
      toId: "person",
      title: "Pay the invoice",
      note: "Rent is still unpaid",
    });
    expect(held.passes[0]?.toId).toBe("person");
    expect(held.passes[0]?.action).toBe("spend");
    const moved = await crew.pass({
      fromId: "crew_inbox",
      toId: "crew_chief",
      title: "Friday summary",
      note: "Three open threads",
    });
    expect(moved.passes[0]?.toId).toBe("crew_chief");
    expect(moved.presence.crew_chief).toBe("needs_you");
  });

  it("writes a due note and keeps a handoff when research must come back", async () => {
    const crew = service({ reply: "Due today: the launch note. Nothing was sent." });
    await crew.setRule({ action: "research", level: "handoff" });
    const written = await crew.writeWatch("watch_seed_morning");
    const morning = written.watches.find((watch) => watch.id === "watch_seed_morning");
    expect(morning?.due).toBe(false);
    expect(morning?.lastNote).toContain("launch note");
    expect(written.passes[0]?.toId).toBe("person");
    expect(written.presence.crew_chief).toBe("idle");
  });

  it("blocks notes when the research rule is block", async () => {
    const crew = service();
    await crew.setRule({ action: "research", level: "block" });
    await expect(crew.writeWatch("watch_seed_morning")).rejects.toThrow(/blocks notes/);
  });

  it("hides the household from a child seat and keeps study notes", async () => {
    const crew = service({ audience: "family", child: true, reply: "Practice the three times table." });
    const view = await crew.get();
    expect(view.members.map((member) => member.lane)).toEqual(["study"]);
    expect(view.briefing).toBeNull();
    await expect(crew.setRule({ action: "draft", level: "ask" })).rejects.toThrow(/child seat/);
    await expect(crew.writeWatch("watch_seed_morning")).rejects.toThrow(/study teammate/);
    const note = await crew.writeWatch("watch_seed_study");
    expect(note.watches[0]?.lastNote).toContain("times table");
    await expect(
      crew.pass({ fromId: "crew_study", toId: "crew_household", title: "Finished", note: "Done" }),
    ).rejects.toThrow(/parent/);
  });

  it("keeps a focus, installs a pack once, and names the next routine", async () => {
    const crew = service();
    const view = await crew.get();
    expect(view.next?.id).toBe("watch_seed_morning");
    expect(view.next?.when).toBe("today");
    const focused = await crew.setFocus({ title: "Ship the studio", note: "No launch post yet." });
    expect(focused.focus?.title).toBe("Ship the studio");
    expect(focused.events[0]?.kind).toBe("focus");
    const packed = await crew.installPack("founder");
    expect(packed.watches.map((watch) => watch.title)).toEqual(
      expect.arrayContaining(["Morning note", "One source", "Unpublished draft"]),
    );
    await expect(crew.installPack("founder")).rejects.toThrow(/already/);
    const child = service({ audience: "family", child: true });
    await expect(child.setFocus({ title: "Spend the week" })).rejects.toThrow(/child seat/);
    const study = await child.installPack("school");
    expect(study.watches.map((watch) => watch.title)).toContain("Homework left");
    expect(study.watches.some((watch) => watch.memberId === "crew_household")).toBe(false);
  });

  it("composes a briefing without a model and can refit a customized crew", async () => {
    const persistence = createInMemoryPersistence(NOW);
    const first = service({ audience: "individual", model: null, persistence });
    await first.writeWatch("watch_seed_morning").catch(() => undefined);
    await first.updateMember("crew_chief", { customDuty: "Keep Fridays short." });
    const brief = await service({ audience: "individual", model: null, persistence }).briefing();
    expect(brief.briefing?.text).toContain("Nothing is waiting");
    const drifted = await service({ audience: "family", model: null, persistence }).get();
    expect(drifted.fitted).toBe(false);
    expect(drifted.members.some((member) => member.id === "crew_chief")).toBe(true);
    const fitted = await service({ audience: "family", model: null, persistence }).refit();
    expect(fitted.audience).toBe("family");
    expect(fitted.members.map((member) => member.lane)).toEqual(["household", "study", "care"]);
  });
});
