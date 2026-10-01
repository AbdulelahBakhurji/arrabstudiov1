import type { CompanionBadge, CompanionPolicy } from "./types";

export type CompanionAvailability = {
  enabled: boolean;
  visible: boolean;
  pinned: boolean;
  badge: CompanionBadge | null;
  maintenance: string | null;
};

const DEFAULT_AVAILABILITY: CompanionAvailability = {
  enabled: true,
  visible: true,
  pinned: false,
  badge: null,
  maintenance: null,
};

type Identifiable = { id: string; agentId?: string | null };

function policyFor<T extends Identifiable>(
  person: T,
  byId: Map<string, CompanionPolicy>,
): CompanionPolicy | undefined {
  return byId.get(person.id) ?? (person.agentId ? byId.get(person.agentId) : undefined);
}

function indexPolicies(policies: CompanionPolicy[]): Map<string, CompanionPolicy> {
  return new Map(policies.map((policy) => [policy.id, policy]));
}

/** A companion is matched on its local id or its server `agentId`. */
export function companionAvailability(
  person: Identifiable | null | undefined,
  policies: CompanionPolicy[],
): CompanionAvailability {
  if (!person) return DEFAULT_AVAILABILITY;
  const policy = policyFor(person, indexPolicies(policies));
  if (!policy) return DEFAULT_AVAILABILITY;
  return {
    enabled: policy.enabled,
    visible: policy.visible,
    pinned: policy.pinned,
    badge: policy.badge,
    maintenance: policy.maintenance,
  };
}

/**
 * The list the user sees: disabled and hidden companions are dropped, pinned
 * ones go first, then `order` ascending. Companions without a policy keep their
 * original relative order after the ordered ones.
 */
export function applyCompanionPolicy<T extends Identifiable>(
  people: readonly T[],
  policies: CompanionPolicy[],
): T[] {
  if (!policies.length) return [...people];
  const byId = indexPolicies(policies);
  return people
    .map((person, index) => ({ person, index, policy: policyFor(person, byId) }))
    .filter(({ policy }) => !policy || (policy.enabled && policy.visible))
    .sort((a, b) => {
      const pinA = a.policy?.pinned ? 0 : 1;
      const pinB = b.policy?.pinned ? 0 : 1;
      if (pinA !== pinB) return pinA - pinB;
      const orderA = a.policy?.order ?? Number.POSITIVE_INFINITY;
      const orderB = b.policy?.order ?? Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ person }) => person);
}

/** Starting a new chat is blocked only when the companion is disabled. */
export function canStartChatWith(
  person: Identifiable | null | undefined,
  policies: CompanionPolicy[],
): boolean {
  return companionAvailability(person, policies).enabled;
}
