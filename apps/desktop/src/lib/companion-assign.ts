/**
 * Assign a quick task to a companion or org agent from the menu-bar panel.
 * Works even when the main Studio window is hidden.
 */
import { arrabApi } from "@/lib/api";
import {
  companionInstructions,
  companionSpendSettings,
  findCompanion,
  getCompanionState,
  updateCompanion,
  visibleFacts,
  type CompanionProfile,
} from "@/lib/companions";
import { resolvePurposeIdFromDomain, purposeRegistryById } from "@/lib/purpose-registry";
import { showAgentPresence, hideAgentPresence } from "@/lib/agent-presence";
import { sanitizeCompanionAsk } from "@/lib/ask-guard";

async function ensureCompanionReady(person: CompanionProfile): Promise<CompanionProfile> {
  let ready = findCompanion(getCompanionState(), person.id) ?? person;
  const facts = visibleFacts(getCompanionState(), ready);
  const uiLocale = localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en";
  const instructions = companionInstructions(ready, facts, uiLocale);

  if (!ready.agentId) {
    const purposeId = ready.purposeId || resolvePurposeIdFromDomain(ready.domain);
    const purpose = purposeRegistryById(purposeId);
    const agent = await arrabApi.createAgent({
      name: ready.name,
      role: purpose?.name ?? ready.domain,
      specialty: purposeId,
      instructions,
      status: "active",
    });
    updateCompanion(ready.id, { agentId: agent.id, purposeId });
    ready = { ...ready, agentId: agent.id, purposeId };
  }

  if (!ready.conversationId) {
    const conversation = await arrabApi.createConversation({
      agentId: ready.agentId!,
      title: ready.name,
      spend: companionSpendSettings(ready),
    });
    updateCompanion(ready.id, { conversationId: conversation.id });
    ready = { ...ready, conversationId: conversation.id };
  }

  return ready;
}

export async function assignCompanionTask(input: {
  companionId: string;
  task: string;
}): Promise<void> {
  const text = sanitizeCompanionAsk(input.task);

  const person = findCompanion(getCompanionState(), input.companionId);
  if (!person) throw new Error("Companion not found");

  void showAgentPresence({
    agentName: person.name,
    hue: person.hue,
    faceSeed: person.faceSeed,
    agentPhoto: person.avatarPhoto,
    title: "Starting task…",
    body: text.slice(0, 90),
    progress: 0.15,
    state: "working",
  });

  try {
    const ready = await ensureCompanionReady(person);
    const result = await arrabApi.sendMessage(ready.conversationId!, {
      content: text,
      usePersistedGoal: true,
    });

    const reply = result.assistantMessage?.content ?? text;
    updateCompanion(ready.id, {
      lastLine: reply.slice(0, 160),
      lastMemory: "Task assigned",
      lastAt: new Date().toISOString(),
    });

    void showAgentPresence({
      agentName: person.name,
      hue: person.hue,
      faceSeed: person.faceSeed,
      agentPhoto: person.avatarPhoto,
      title: result.approval ? "Needs your approval" : "On it",
      body: reply.slice(0, 90),
      progress: result.approval ? 0.72 : 0.55,
      state: result.approval ? "needs_you" : "working",
      approvalId: result.approval?.id ?? null,
    });

    if (!result.approval) {
      void hideAgentPresence(4200);
    }
  } catch (err) {
    void showAgentPresence({
      agentName: person.name,
      hue: person.hue,
      title: "Couldn’t start task",
      body: err instanceof Error ? err.message.slice(0, 90) : "Try again",
      progress: 0.2,
      state: "error",
    });
    void hideAgentPresence(3600);
    throw err;
  }
}

export async function assignAgentTask(input: {
  agentId: string;
  agentName: string;
  hue?: number;
  task: string;
}): Promise<void> {
  const text = sanitizeCompanionAsk(input.task);

  void showAgentPresence({
    agentName: input.agentName,
    hue: input.hue ?? 210,
    title: "Assigning task…",
    body: text.slice(0, 90),
    progress: 0.18,
    state: "working",
  });

  try {
    const task = await arrabApi.createTask({
      title: text.slice(0, 120),
      brief: text,
      assigneeAgentId: input.agentId,
      status: "assigned",
      priority: "medium",
    });

    try {
      await arrabApi.runTask(task.id, { requireApproval: false });
    } catch {
      // Task is created even if run needs later approval / provider.
    }

    void showAgentPresence({
      agentName: input.agentName,
      hue: input.hue ?? 210,
      title: "Task assigned",
      body: text.slice(0, 90),
      progress: 0.65,
      state: "working",
    });
    void hideAgentPresence(3600);
  } catch (err) {
    void showAgentPresence({
      agentName: input.agentName,
      hue: input.hue ?? 210,
      title: "Couldn’t assign",
      body: err instanceof Error ? err.message.slice(0, 90) : "Try again",
      progress: 0.2,
      state: "error",
    });
    void hideAgentPresence(3600);
    throw err;
  }
}
