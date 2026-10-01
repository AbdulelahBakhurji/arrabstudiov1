export type AgentSessionPolicy = "ask" | "allow";

const KEY = "arrab.agent.sessionPolicy";
const PINNED_KEY = "arrab.workforce.pinnedAgents";
const HIDDEN_KEY = "arrab.workforce.hiddenAgents";

function readMap(): Record<string, AgentSessionPolicy> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    const out: Record<string, AgentSessionPolicy> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (value === "ask" || value === "allow") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readAgentSessionPolicy(agentId: string): AgentSessionPolicy {
  if (!agentId) return "ask";
  return readMap()[agentId] ?? "ask";
}

export function writeAgentSessionPolicy(agentId: string, policy: AgentSessionPolicy): void {
  if (!agentId) return;
  try {
    const next = { ...readMap(), [agentId]: policy };
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("arrab-agent-session-policy", { detail: { agentId, policy } }));
  } catch {
    // ignore quota / private mode
  }
}

function readIdList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(ids)]));
  } catch {
    // ignore
  }
}

export function readPinnedAgents(): string[] {
  return readIdList(PINNED_KEY);
}

export function togglePinnedAgent(agentId: string): string[] {
  const current = readPinnedAgents();
  const next = current.includes(agentId)
    ? current.filter((id) => id !== agentId)
    : [agentId, ...current];
  writeIdList(PINNED_KEY, next);
  return next;
}

export function readHiddenAgents(): string[] {
  return readIdList(HIDDEN_KEY);
}

export function hideAgent(agentId: string): string[] {
  const next = [...readHiddenAgents(), agentId];
  writeIdList(HIDDEN_KEY, next);
  notifyWorkforceRosterChanged();
  return next;
}

export function unhideAgent(agentId: string): string[] {
  const next = readHiddenAgents().filter((id) => id !== agentId);
  writeIdList(HIDDEN_KEY, next);
  notifyWorkforceRosterChanged();
  return next;
}

const REMOVED_KEY = "arrab.workforce.removedAgents";

/** Local tombstones when the remote API cannot delete/archive yet. */
export function readRemovedAgents(): string[] {
  return readIdList(REMOVED_KEY);
}

export function rememberRemovedAgent(agentId: string): string[] {
  const next = [...new Set([...readRemovedAgents(), agentId])];
  writeIdList(REMOVED_KEY, next);
  notifyWorkforceRosterChanged();
  return next;
}

export function forgetRemovedAgent(agentId: string): string[] {
  const next = readRemovedAgents().filter((id) => id !== agentId);
  writeIdList(REMOVED_KEY, next);
  notifyWorkforceRosterChanged();
  return next;
}

/** Same roster rules as Workforce: drop archived, locally deleted, and hidden agents. */
export function filterLiveWorkforceAgents<T extends { id: string; status: string }>(
  agents: T[],
): T[] {
  const removed = new Set(readRemovedAgents());
  const hidden = new Set(readHiddenAgents());
  return agents.filter(
    (agent) =>
      agent.status !== "archived" && !removed.has(agent.id) && !hidden.has(agent.id),
  );
}

export function notifyWorkforceRosterChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent("arrab-workforce-roster"));
  } catch {
    // ignore
  }
}
