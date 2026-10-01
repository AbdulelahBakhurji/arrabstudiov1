import type { AiGateway } from "@arrab/ai";
import { createInMemoryPersistence } from "@arrab/database";
import { describe, expect, it } from "vitest";
import type { AccountService } from "./account-service.js";
import { DeskService, deskBriefIsSensitive, type DeskWhatsAppSender } from "./desk-service.js";
import type { FamilyHouseholdService } from "./family-household-service.js";

function service(options?: {
  child?: boolean;
  model?: string | null;
  now?: string;
  whatsapp?: DeskWhatsAppSender | null;
  reply?: string;
}) {
  const persistence = createInMemoryPersistence(options?.now ?? "2026-09-29T00:00:00.000Z");
  const gateway = {
    listProviders: () => [{ id: "openrouter", kind: "openai" }],
    complete: async () => ({
      id: "c1",
      model: { providerId: "openrouter", model: "arrab" },
      message: { role: "assistant" as const, content: options?.reply ?? "The checklist is ready." },
      finishReason: "stop" as const,
      usage: { inputTokens: 12, outputTokens: 30 },
    }),
  } as unknown as AiGateway;
  const accounts = { assertWithinQuota: async () => undefined } as unknown as AccountService;
  const family = {
    isActiveChildSeat: async () => options?.child === true,
  } as unknown as FamilyHouseholdService;
  return new DeskService(
    persistence,
    gateway,
    accounts,
    family,
    options?.model === undefined ? "arrab" : options.model,
    { next: (prefix) => `${prefix}_${Math.random().toString(16).slice(2)}` },
    { isoNow: () => options?.now ?? "2026-09-29T00:00:00.000Z" },
    options?.whatsapp,
  );
}

describe("desk", () => {
  it("treats pay, send, and publish as sensitive in both languages", () => {
    expect(deskBriefIsSensitive("send the invoice")).toBe(true);
    expect(deskBriefIsSensitive("انشر الإعلان")).toBe(true);
    expect(deskBriefIsSensitive("finish the checklist")).toBe(false);
  });

  it("asks before a sensitive job even when the pace is allow", async () => {
    const desk = service();
    await desk.setPace("allow");
    const job = await desk.start({ title: "Pay the invoice", brief: "Send it today" });
    expect(job.status).toBe("needs_you");
    expect(job.sensitive).toBe(true);
    expect(job.result).toBeNull();
  });

  it("refuses work when the pace is never", async () => {
    const desk = service();
    await desk.setPace("never");
    await expect(desk.start({ title: "Prepare Friday" })).rejects.toThrow(/turned off/);
  });

  it("runs an allowed job and keeps the result on the desk", async () => {
    const desk = service();
    await desk.setPace("allow");
    const job = await desk.start({
      title: "Friday summary",
      brief: "List what the household still owes",
      companionName: "Layan",
    });
    expect(job.status).toBe("done");
    expect(job.result).toContain("checklist");
    const saved = await desk.get();
    expect(saved.jobs[0]?.result).toContain("checklist");
  });

  it("keeps a correction and waits again", async () => {
    const desk = service();
    const job = await desk.start({ title: "Launch note" });
    expect(job.status).toBe("needs_you");
    const revised = await desk.revise(job.id, "Keep it shorter");
    expect(revised.status).toBe("needs_you");
    const saved = await desk.get();
    expect(saved.lessons).toContain("Keep it shorter");
  });

  it("blocks a child seat", async () => {
    const desk = service({ child: true });
    await expect(desk.start({ title: "Spend the allowance" })).rejects.toThrow(/child seat/);
  });

  it("keeps a sensitive draft waiting until the same draft is approved", async () => {
    const desk = service();
    const job = await desk.start({ title: "Pay the invoice", brief: "Rent for the shop" });
    const draft = await desk.approve(job.id);
    expect(draft.status).toBe("needs_you");
    expect(draft.result).toContain("checklist");
    expect(draft.resultHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(desk.approve(job.id, { draftHash: "stale", amountSar: 40 })).rejects.toThrow(/draft changed/i);
    const released = await desk.approve(job.id, { draftHash: draft.resultHash ?? "", amountSar: 40 });
    expect(released.status).toBe("done");
    expect(released.approvedHash).toBe(draft.resultHash);
    expect((await desk.get()).spentSarToday).toBe(40);
  });

  it("blocks a release that crosses the daily cap", async () => {
    const desk = service();
    await desk.update({ spendCapSar: 25 });
    const job = await desk.start({ title: "Pay the supplier" });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "", amountSar: 40 })).rejects.toThrow(/cap/);
    expect((await desk.get()).spentSarToday).toBe(0);
  });

  it("stops waiting work and refuses new work after the kill switch", async () => {
    const desk = service();
    const job = await desk.start({ title: "Evening list" });
    const killed = await desk.kill();
    expect(killed.pace).toBe("never");
    expect(killed.jobs.find((item) => item.id === job.id)?.status).toBe("stopped");
    await expect(desk.start({ title: "Another list" })).rejects.toThrow(/turned off/);
  });

  it("holds new work during the owner's quiet hours in Riyadh", async () => {
    const desk = service({ now: "2026-09-29T00:00:00.000Z" });
    await desk.update({ quietStartHour: 2, quietEndHour: 5 });
    await expect(desk.start({ title: "Evening notes" })).rejects.toThrow(/holding/);
    const view = await desk.get();
    expect(view.hijriToday.length).toBeGreaterThan(4);
  });

  it("sends WhatsApp only after the same draft is approved", async () => {
    const sent: Array<{ to: string; text: string }> = [];
    const desk = service({
      whatsapp: async (input) => {
        sent.push(input);
        return { messageId: "wamid.1" };
      },
    });
    const job = await desk.start({
      title: "Tell the shop",
      brief: "We open at 4",
      channel: "whatsapp",
      recipient: "+966 55 123 4567",
    });
    expect(job.sensitive).toBe(true);
    expect(job.recipient).toBe("966551234567");
    expect(job.status).toBe("needs_you");
    const draft = await desk.approve(job.id);
    expect(draft.status).toBe("needs_you");
    expect(sent).toHaveLength(0);
    await expect(desk.approve(job.id, { draftHash: "stale" })).rejects.toThrow(/draft changed/i);
    expect(sent).toHaveLength(0);
    const released = await desk.approve(job.id, { draftHash: draft.resultHash ?? "" });
    expect(released.status).toBe("done");
    expect(released.sentMessageId).toBe("wamid.1");
    expect(sent).toEqual([{ to: "966551234567", text: "The checklist is ready." }]);
  });

  it("leaves the draft waiting when WhatsApp refuses the send", async () => {
    const desk = service({
      whatsapp: async () => {
        throw new Error("WhatsApp send failed");
      },
    });
    const job = await desk.start({
      title: "Tell the shop",
      channel: "whatsapp",
      recipient: "966551234567",
    });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "" })).rejects.toThrow(/send failed/i);
    const saved = (await desk.get()).jobs.find((item) => item.id === job.id);
    expect(saved?.status).toBe("needs_you");
    expect(saved?.approvedHash).toBeNull();
    expect(saved?.sentMessageId).toBeNull();
  });

  it("refuses to send when WhatsApp is not connected", async () => {
    const desk = service();
    const job = await desk.start({
      title: "Tell the shop",
      channel: "whatsapp",
      recipient: "966551234567",
    });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "" })).rejects.toThrow(/Connect WhatsApp/);
    expect((await desk.get()).jobs.find((item) => item.id === job.id)?.status).toBe("needs_you");
  });

  it("does not send WhatsApp when a payment is released", async () => {
    const sent: string[] = [];
    const desk = service({
      whatsapp: async () => {
        sent.push("sent");
        return { messageId: "wamid.no" };
      },
    });
    const job = await desk.start({ title: "Pay the invoice" });
    const draft = await desk.approve(job.id);
    const released = await desk.approve(job.id, { draftHash: draft.resultHash ?? "", amountSar: 10 });
    expect(released.status).toBe("done");
    expect(released.sentMessageId).toBeNull();
    expect(sent).toEqual([]);
  });

  it("keeps a computer command waiting until that exact line is approved", async () => {
    const desk = service({ reply: "df -h" });
    await desk.setPace("allow");
    const job = await desk.start({ title: "Free disk", channel: "computer" });
    expect(job.sensitive).toBe(true);
    expect(job.status).toBe("needs_you");
    expect(job.result).toBeNull();
    const draft = await desk.approve(job.id);
    expect(draft.status).toBe("needs_you");
    expect(draft.result).toBe("df -h");
    await expect(desk.approve(job.id, { draftHash: "stale" })).rejects.toThrow(/draft changed/i);
    const released = await desk.approve(job.id, { draftHash: draft.resultHash ?? "" });
    expect(released.status).toBe("done");
    expect(released.channel).toBe("computer");
  });

  it("keeps a sandbox command on the desk until the exact line is approved", async () => {
    const desk = service({ reply: "mkdir notes" });
    await desk.setPace("allow");
    const job = await desk.start({ title: "Sort the notes", channel: "sandbox" });
    expect(job.status).toBe("needs_you");
    expect(job.sensitive).toBe(true);
    const draft = await desk.approve(job.id);
    expect(draft.result).toBe("mkdir notes");
    const released = await desk.approve(job.id, { draftHash: draft.resultHash ?? "" });
    expect(released.status).toBe("done");
    expect(released.channel).toBe("sandbox");
  });

  it("blocks a sandbox command that can wipe the machine", async () => {
    const desk = service({ reply: "rm -rf /" });
    const job = await desk.start({ title: "Clean the sandbox", channel: "sandbox" });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "" })).rejects.toThrow(/wipe/);
    expect((await desk.get()).jobs.find((item) => item.id === job.id)?.status).toBe("needs_you");
  });

  it("blocks a computer command that can wipe the machine", async () => {
    const desk = service({ reply: "rm -rf /" });
    const job = await desk.start({ title: "Clean the disk", channel: "computer" });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "" })).rejects.toThrow(/wipe/);
    expect((await desk.get()).jobs.find((item) => item.id === job.id)?.status).toBe("needs_you");
  });

  it("keeps WhatsApp to the numbers the owner allowed", async () => {
    const desk = service();
    await desk.update({ messageList: ["966551234567"], shopHours: "4 to midnight", neverSay: "discount" });
    const saved = await desk.get();
    expect(saved.shopHours).toBe("4 to midnight");
    expect(saved.messageList).toEqual(["966551234567"]);
    await expect(
      desk.start({ title: "Tell a stranger", channel: "whatsapp", recipient: "966500000000" }),
    ).rejects.toThrow(/not on the list/);
    const job = await desk.start({
      title: "Tell the shop",
      channel: "whatsapp",
      recipient: "+966 55 123 4567",
    });
    expect(job.recipient).toBe("966551234567");
  });

  it("drafts and sends inbound WhatsApp when pace is allow", async () => {
    let sent = 0;
    const desk = service({
      reply: "Yes, we are open until 9.",
      whatsapp: async () => {
        sent += 1;
        return { messageId: "wamid.auto" };
      },
    });
    await desk.setPace("allow");
    const job = await desk.processInboundWhatsApp({
      from: "966551234567",
      text: "Are you open?",
      messageId: "wamid.auto-in",
      companionId: "reception",
      companionName: "Reception",
    });
    expect(job?.status).toBe("done");
    expect(job?.companionId).toBe("reception");
    expect(sent).toBe(1);
  });

  it("queues an incoming WhatsApp message without drafting or sending it", async () => {
    let sent = 0;
    const desk = service({
      whatsapp: async () => {
        sent += 1;
        return { messageId: "wamid.should-not-send" };
      },
    });
    const job = await desk.intakeWhatsApp({
      from: "966551234567",
      text: "Are you open?",
      messageId: "wamid.in1",
    });
    expect(job?.status).toBe("needs_you");
    expect(job?.result).toBeNull();
    expect(job?.channel).toBe("whatsapp");
    expect(job?.recipient).toBe("966551234567");
    expect(await desk.intakeWhatsApp({ from: "966551234567", text: "again", messageId: "wamid.in1" })).toBeNull();
    expect(sent).toBe(0);
    expect((await desk.get()).jobs).toHaveLength(1);
  });

  it("keeps a stranger off WhatsApp when the owner set a list", async () => {
    const desk = service();
    await desk.update({ messageList: ["966551234567"] });
    const job = await desk.intakeWhatsApp({
      from: "966500000000",
      text: "Hello",
      messageId: "wamid.out",
    });
    expect(job?.channel).toBeNull();
    expect(job?.recipient).toBeNull();
    expect(job?.title).toBe("Outside the list");
  });

  it("still queues a message while the desk is in quiet hours", async () => {
    const desk = service();
    await desk.update({ quietStartHour: 2, quietEndHour: 5 });
    const job = await desk.intakeWhatsApp({
      from: "966551234567",
      text: "Can I come by?",
      messageId: "wamid.quiet",
    });
    expect(job?.status).toBe("needs_you");
    await expect(desk.approve(job?.id ?? "")).rejects.toThrow(/holding/);
  });

  it("keeps a bill reading without paying or counting it as spend", async () => {
    let sent = 0;
    const desk = service({
      reply: "The bill is 80 SAR. I will not pay it.",
      whatsapp: async () => {
        sent += 1;
        return { messageId: "wamid.no" };
      },
    });
    const job = await desk.start({
      title: "Electricity",
      brief: "Card 4111111111111111 on the paper",
      channel: "bill",
      amountSar: 80,
    });
    expect(job.brief).not.toContain("4111111111111111");
    expect(job.brief).toContain("80 SAR");
    expect(job.sensitive).toBe(true);
    const draft = await desk.approve(job.id);
    const kept = await desk.approve(job.id, { draftHash: draft.resultHash ?? "" });
    expect(kept.status).toBe("done");
    expect((await desk.get()).spentSarToday).toBe(0);
    expect(sent).toBe(0);
    await expect(desk.start({ title: "Missing amount", channel: "bill" })).rejects.toThrow(/amount you read/);
  });

  it("places a scheduled duty on the desk without running it", async () => {
    const desk = service();
    await desk.setPace("allow");
    const saved = await desk.addSchedule({ title: "Morning check", hour: 3, repeat: "daily", brief: "What changed" });
    const job = saved.jobs.find((item) => item.title === "Morning check");
    expect(job?.status).toBe("needs_you");
    expect(job?.result).toBeNull();
    expect(job?.sensitive).toBe(true);
    const again = await desk.get();
    expect(again.jobs.filter((item) => item.title === "Morning check")).toHaveLength(1);
  });

  it("waits for the Riyadh hour and can pause a duty", async () => {
    const desk = service();
    const saved = await desk.addSchedule({ title: "Later check", hour: 4, repeat: "daily" });
    expect(saved.jobs).toHaveLength(0);
    const duty = saved.schedules[0];
    const paused = await desk.pauseSchedule(duty?.id ?? "", true);
    expect(paused.schedules[0]?.paused).toBe(true);
    expect(paused.jobs).toHaveLength(0);
    await expect(desk.addSchedule({ title: "Too late", hour: 30 })).rejects.toThrow(/clock hour/);
  });

  it("keeps a professional companion on the duty and asks again only tomorrow", async () => {
    const desk = service();
    const saved = await desk.addSchedule({
      title: "Open promises",
      hour: 3,
      repeat: "once",
      companionId: "meetings",
      companionName: "Sara",
    });
    const job = saved.jobs.find((item) => item.title === "Open promises");
    expect(job?.companionName).toBe("Sara");
    expect(job?.result).toBeNull();
    expect(saved.schedules[0]?.paused).toBe(true);
    const again = await desk.get();
    expect(again.jobs.filter((item) => item.title === "Open promises")).toHaveLength(1);
    const followed = await desk.followUp(job?.id ?? "");
    const tomorrow = followed.schedules.find((item) => item.repeat === "once" && item.paused === false);
    expect(tomorrow?.companionId).toBe("meetings");
    expect(tomorrow?.hour).toBe(8);
    expect(followed.jobs.filter((item) => item.title === "Open promises")).toHaveLength(1);
    expect(followed.runsAllowance).toBe(20);
  });

  it("refuses a draft that uses wording the owner forbade", async () => {
    const desk = service({ reply: "Take the checklist discount" });
    await desk.update({ neverSay: "discount" });
    const job = await desk.start({ title: "Friday note" });
    const draft = await desk.approve(job.id);
    await expect(desk.approve(job.id, { draftHash: draft.resultHash ?? "" })).rejects.toThrow(/never to say/);
    expect((await desk.get()).jobs.find((item) => item.id === job.id)?.status).toBe("needs_you");
  });
});
