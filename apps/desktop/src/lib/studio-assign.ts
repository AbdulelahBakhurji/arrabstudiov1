import type { Agent } from "@arrab/shared";

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findAgentByName(agents: Agent[], rawName: string): Agent | null {
  const needle = normalizeName(rawName);
  if (!needle) return null;
  const exact = agents.find((agent) => normalizeName(agent.name) === needle);
  if (exact) return exact;
  const starts = agents.find((agent) => normalizeName(agent.name).startsWith(needle));
  if (starts) return starts;
  return agents.find((agent) => normalizeName(agent.name).includes(needle)) ?? null;
}

/** Parse "assign X to Mohammed", "@sam do Y", or free text + selected assignee. */
export function parseStudioAssign(
  input: string,
  agents: Agent[],
): { title: string; agent: Agent | null; nameHint: string | null } {
  const text = input.trim();
  if (!text) return { title: "", agent: null, nameHint: null };

  const atMatch = text.match(/^@([^\s]+)\s+(.+)$/s);
  if (atMatch) {
    const nameHint = atMatch[1]!.trim();
    return {
      title: atMatch[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const assignToColon = text.match(/^assign\s+to\s+([^:]+):\s*(.+)$/is);
  if (assignToColon) {
    const nameHint = assignToColon[1]!.trim();
    return {
      title: assignToColon[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const forColon = text.match(/^(?:for|to)\s+([^:]+):\s*(.+)$/is);
  if (forColon) {
    const nameHint = forColon[1]!.trim();
    return {
      title: forColon[2]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const assignTo = text.match(/^assign\s+(.+?)\s+to\s+(.+)$/is);
  if (assignTo) {
    const nameHint = assignTo[2]!.trim();
    return {
      title: assignTo[1]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  const dispatchTo = text.match(/^dispatch\s+(.+?)\s+to\s+(.+)$/is);
  if (dispatchTo) {
    const nameHint = dispatchTo[2]!.trim();
    return {
      title: dispatchTo[1]!.trim(),
      agent: findAgentByName(agents, nameHint),
      nameHint,
    };
  }

  return { title: text, agent: null, nameHint: null };
}
