import { Check } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { PersonAvatar } from "@/components/companions/CompanionUI";
import { useLanguage } from "@/i18n/LanguageProvider";
import type { AgentSessionPolicy } from "@/lib/agent-session-policy";
import {
  getCompanionState,
  liveCompanions,
  type CompanionProfile,
} from "@/lib/companions";
import { cn } from "@/lib/utils";

export type WorkforceListAgent = {
  id: string;
  name: string;
  role: string;
  live?: boolean;
  pinned?: boolean;
  policy?: AgentSessionPolicy;
};

export type WorkforceListGroup = {
  id: string;
  name: string;
  agents: WorkforceListAgent[];
};

type Props = {
  groups: WorkforceListGroup[];
  className?: string;
  /** Hide the outer title when the parent already provides one. */
  hideHead?: boolean;
  selectedAgentId?: string | null;
  onAgentClick?: (agentId: string) => void;
  onAgentDoubleClick?: (agentId: string, event: ReactMouseEvent) => void;
  onAgentContextMenu?: (agentId: string, event: ReactMouseEvent) => void;
};

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Prefer a companion photo/face; otherwise a stable AI-drawn portrait from the agent id. */
function portraitForAgent(agent: WorkforceListAgent): CompanionProfile {
  const people = liveCompanions(getCompanionState());
  const match =
    people.find((person) => person.agentId === agent.id) ??
    people.find(
      (person) => person.name.trim().toLowerCase() === agent.name.trim().toLowerCase(),
    );
  if (match) return match;
  const seed = hashSeed(agent.id || agent.name);
  return {
    id: `wf-face:${agent.id}`,
    agentId: agent.id,
    conversationId: null,
    parentConversationId: null,
    name: agent.name,
    domain: "work",
    purposeId: "work",
    brief: null,
    toneNote: null,
    connectors: [],
    hue: seed % 360,
    faceSeed: seed % 4096,
    avatarPhoto: null,
    space: "work",
    tone: {
      bluntness: 45,
      humour: 40,
      replyLength: 35,
      warmth: 55,
      formality: 35,
      criticism: 40,
      pace: 45,
    },
    toneName: "measured",
    callOut: [],
    lastMemory: null,
    lastLine: null,
    lastAt: null,
    resume: null,
    familyMemberId: null,
    createdAt: "",
    archivedAt: null,
  };
}

/** Clean grouped workforce directory rows. */
export function WorkforceList({
  groups,
  className,
  hideHead,
  selectedAgentId,
  onAgentClick,
  onAgentDoubleClick,
  onAgentContextMenu,
}: Props) {
  const { t } = useLanguage();
  const totalPeople = groups.reduce((n, group) => n + group.agents.length, 0);

  return (
    <section className={cn("wf-list", hideHead && "is-embedded", className)} aria-label={t("workforceTitle")}>
      {hideHead ? null : (
        <header className="wf-list-head">
          <div className="min-w-0">
            <h2>{t("workforceTitle")}</h2>
            <p>
              {totalPeople} {t("employees")}
              <span aria-hidden> · </span>
              {groups.length} {t("teams")}
            </p>
          </div>
        </header>
      )}

      {groups.length === 0 ? (
        <div className="wf-list-empty">
          <p>{t("hqEmptyMap")}</p>
          <p>{t("hqEmptyMapHint")}</p>
        </div>
      ) : (
        <div className="wf-list-body">
          {groups.map((group) => (
            <section key={group.id} className="wf-list-group">
              <header className="wf-list-group-head">
                <h3>{group.name}</h3>
                <span>{group.agents.length}</span>
              </header>
              {group.agents.length === 0 ? (
                <p className="wf-list-muted">{t("unassigned")}</p>
              ) : (
                <ul className="wf-list-rows">
                  {group.agents.map((agent) => {
                    const selected = selectedAgentId === agent.id;
                    const portrait = portraitForAgent(agent);
                    return (
                      <li key={agent.id}>
                        <button
                          type="button"
                          className={cn("wf-list-row", selected && "is-selected")}
                          aria-pressed={selected}
                          onClick={() => onAgentClick?.(agent.id)}
                          onDoubleClick={(event) => onAgentDoubleClick?.(agent.id, event)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onAgentContextMenu?.(agent.id, event);
                          }}
                        >
                          <span className="wf-list-avatar-face" aria-hidden>
                            <PersonAvatar person={portrait} active={selected} size="md" />
                          </span>
                          <span className="wf-list-meta">
                            <strong>
                              {agent.pinned ? (
                                <span className="wf-list-pin" aria-hidden>
                                  ·
                                </span>
                              ) : null}
                              {agent.name}
                            </strong>
                            <em>
                              {agent.role}
                              {agent.policy === "allow"
                                ? ` · ${t("coworkAllowEverything")}`
                                : ` · ${t("coworkAskApproval")}`}
                            </em>
                          </span>
                          <span className={cn("wf-list-action", selected && "is-visible")} aria-hidden>
                            <Check size={15} strokeWidth={2} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
