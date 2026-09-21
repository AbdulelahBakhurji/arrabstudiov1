import type { Agent, Team, TeamMembership } from "@arrab/shared";
import { arrabApi } from "@/lib/api";
import { companionDisplayName, isSecretCompanionBrief } from "@/lib/companion-catalog";
import {
  addCompanion,
  companionInstructions,
  getCompanionState,
  liveCompanions,
  updateCompanion,
  visibleFacts,
  type CompanionProfile,
} from "@/lib/companions";

export const COMPANION_SPECIALTY = "Companion";
export const COMPANION_CIRCLE_PREFIX = "arrab.companion:";

export function isCompanionAgent(agent: Agent): boolean {
  const specialty = (agent.specialty ?? "").trim().toLowerCase();
  const role = agent.role.trim().toLowerCase();
  return specialty === "companion" || role === "companion";
}

export function companionCirclePurpose(companionId: string): string {
  return `${COMPANION_CIRCLE_PREFIX}${companionId}`;
}

export function findCompanionCircle(
  teams: Team[],
  companionId: string,
): Team | undefined {
  const purpose = companionCirclePurpose(companionId);
  return teams.find((team) => team.purpose === purpose);
}

export function splitOrgAgents(agents: Agent[]): {
  companions: Agent[];
  employees: Agent[];
} {
  const companions: Agent[] = [];
  const employees: Agent[] = [];
  for (const agent of agents) {
    if (agent.status === "archived") continue;
    if (isCompanionAgent(agent)) companions.push(agent);
    else employees.push(agent);
  }
  return { companions, employees };
}

/** Ensure each org Companion agent has a work-space profile with a real face. */
export function syncWorkProfilesFromAgents(agents: Agent[]): CompanionProfile[] {
  const companionAgents = agents.filter(
    (agent) => agent.status !== "archived" && isCompanionAgent(agent),
  );
  for (const agent of companionAgents) {
    const state = getCompanionState();
    const people = liveCompanions(state, "work");
    const match =
      people.find((person) => person.agentId === agent.id) ??
      people.find(
        (person) => person.name.trim().toLowerCase() === agent.name.trim().toLowerCase(),
      );
    if (match) {
      if (match.agentId !== agent.id) {
        updateCompanion(match.id, { agentId: agent.id });
      }
      if (isSecretCompanionBrief(match.brief)) {
        updateCompanion(match.id, { brief: null });
      }
      continue;
    }
    const domain =
      agent.name
        .trim()
        .toLowerCase()
        .replace(/\s+companion$/i, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "work";
    const created = addCompanion({
      name: agent.name,
      domain,
      brief: null,
      space: "work",
      toneName: "measured",
    });
    updateCompanion(created.id, { agentId: agent.id });
  }
  return liveCompanions(getCompanionState(), "work").filter(
    (person) => person.domain !== "general",
  );
}

/** Bridge Solo-style CompanionProfile → org Agent (Companion specialty + connectors). */
export async function ensureOrgCompanionAgent(
  person: CompanionProfile,
  options?: { syncProfile?: boolean; knownAgents?: Agent[]; locale?: "en" | "ar" },
): Promise<Agent> {
  const syncProfile = options?.syncProfile !== false;
  const known = options?.knownAgents ?? [];
  const locale = options?.locale ?? (localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en");
  const facts = visibleFacts(getCompanionState(), person);
  const instructions = companionInstructions(person, facts, locale);
  const displayName = companionDisplayName(person, locale);

  if (person.agentId) {
    const local = known.find((agent) => agent.id === person.agentId);
    // Switching companions: reuse the linked agent with zero network.
    if (local && !syncProfile) return local;
    if (syncProfile) {
      try {
        const updated = await arrabApi.updateAgent(person.agentId, {
          name: displayName,
          role: COMPANION_SPECIALTY,
          specialty: COMPANION_SPECIALTY,
          instructions,
          status: "active",
        });
        return updated;
      } catch {
        /* recreate below */
      }
    } else if (local) {
      return local;
    }
  }

  const localMatch = known.find(
    (agent) =>
      isCompanionAgent(agent) &&
      agent.status !== "archived" &&
      agent.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
  );
  if (localMatch && !syncProfile) {
    updateCompanion(person.id, { agentId: localMatch.id });
    return localMatch;
  }

  const listed = known.length && !syncProfile ? { items: known } : await arrabApi.agents();
  const match =
    localMatch ??
    listed.items.find(
      (agent) =>
        isCompanionAgent(agent) &&
        agent.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
    );
  if (match) {
    updateCompanion(person.id, { agentId: match.id });
    if (!syncProfile) return match;
    try {
      return await arrabApi.updateAgent(match.id, {
        name: displayName,
        role: COMPANION_SPECIALTY,
        specialty: COMPANION_SPECIALTY,
        instructions,
        status: "active",
      });
    } catch {
      return match;
    }
  }

  const created = await arrabApi.createAgent({
    name: displayName,
    role: COMPANION_SPECIALTY,
    specialty: COMPANION_SPECIALTY,
    instructions,
    status: "active",
  });
  updateCompanion(person.id, { agentId: created.id });
  return created;
}

/** Resolve a companion's org agent from local state only — no network. */
export function resolveCompanionAgentId(
  person: CompanionProfile,
  agents: Agent[],
): string | null {
  if (person.agentId && agents.some((agent) => agent.id === person.agentId)) {
    return person.agentId;
  }
  const byName = agents.find(
    (agent) =>
      isCompanionAgent(agent) &&
      agent.status !== "archived" &&
      agent.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
  );
  return byName?.id ?? null;
}

export async function ensureCompanionCircle(
  companion: Agent,
  teams: Team[],
  memberships: TeamMembership[],
): Promise<{ team: Team; memberships: TeamMembership[] }> {
  let team = findCompanionCircle(teams, companion.id);
  let nextMemberships = memberships;
  if (!team) {
    team = await arrabApi.createTeam({
      name: `${companion.name}`,
      purpose: companionCirclePurpose(companion.id),
      projectId: companion.projectId,
    });
  }
  const already = nextMemberships.some(
    (item) => item.teamId === team!.id && item.agentId === companion.id,
  );
  if (!already) {
    const membership = await arrabApi.addTeamMember(team.id, { agentId: companion.id });
    nextMemberships = [...nextMemberships, membership];
  }
  return { team, memberships: nextMemberships };
}

export async function attachEmployeesToCompanion(input: {
  companion: Agent;
  employeeIds: string[];
  teams: Team[];
  memberships: TeamMembership[];
}): Promise<{ team: Team; memberships: TeamMembership[]; teams: Team[] }> {
  const ensured = await ensureCompanionCircle(
    input.companion,
    input.teams,
    input.memberships,
  );
  let memberships = ensured.memberships;
  const teams = input.teams.some((team) => team.id === ensured.team.id)
    ? input.teams
    : [ensured.team, ...input.teams];

  for (const employeeId of input.employeeIds) {
    if (
      memberships.some(
        (item) => item.teamId === ensured.team.id && item.agentId === employeeId,
      )
    ) {
      continue;
    }
    const membership = await arrabApi.addTeamMember(ensured.team.id, {
      agentId: employeeId,
    });
    memberships = [...memberships, membership];
  }

  return { team: ensured.team, memberships, teams };
}
