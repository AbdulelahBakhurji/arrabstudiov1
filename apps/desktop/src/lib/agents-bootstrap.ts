import type { Agent, CreateAgentRequest } from "@arrab/shared";
import { arrabApi } from "@/lib/api";

const DEFAULT_SOLO_NAMES = new Set(["solo agent", "assistant", "المساعد"]);

let ensureSoloLock: Promise<Agent[]> | null = null;

export function isDefaultSoloClone(agent: Agent, defaultName?: string): boolean {
  if (agent.status === "archived") return false;
  const name = agent.name.trim().toLowerCase();
  const role = (agent.role ?? "").trim().toLowerCase();
  if (defaultName && name === defaultName.trim().toLowerCase()) return true;
  if (DEFAULT_SOLO_NAMES.has(name)) return true;
  return role === "desktop assistant";
}

export function defaultSoloAgentBody(
  name: string,
  role: string,
  instructions: string,
): CreateAgentRequest {
  return {
    name,
    role,
    specialty: "general",
    instructions,
    status: "active",
  };
}

/** Avoid Chat + Cowork both creating a default Solo agent on the same boot. */
export async function ensureDefaultSoloAgent(
  active: Agent[],
  body: CreateAgentRequest,
): Promise<Agent[]> {
  const present = active.filter((agent) => agent.status !== "archived");
  if (present.length > 0) {
    return collapseDefaultSoloDupes(present, body.name);
  }
  if (!ensureSoloLock) {
    ensureSoloLock = (async () => {
      const latest = await arrabApi.agents();
      const existing = latest.items.filter((agent) => agent.status !== "archived");
      if (existing.length > 0) {
        return collapseDefaultSoloDupes(existing, body.name);
      }
      const created = await arrabApi.createAgent(body);
      return [created];
    })().finally(() => {
      ensureSoloLock = null;
    });
  }
  return ensureSoloLock;
}

/**
 * Collapse accidental default Solo duplicates (boot races) so People stays tidy.
 * Keeps the oldest default; archives the rest.
 */
export async function collapseDefaultSoloDupes(
  agents: Agent[],
  defaultName: string,
): Promise<Agent[]> {
  const live = agents.filter((agent) => agent.status !== "archived");
  const defaults = live
    .filter((agent) => isDefaultSoloClone(agent, defaultName))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (defaults.length <= 1) {
    return live;
  }

  const keep = defaults[0]!;
  const extras = defaults.slice(1);
  await Promise.allSettled(
    extras.map((agent) => arrabApi.updateAgent(agent.id, { status: "archived" })),
  );
  const drop = new Set(extras.map((agent) => agent.id));
  return live.filter((agent) => agent.id === keep.id || !drop.has(agent.id));
}
