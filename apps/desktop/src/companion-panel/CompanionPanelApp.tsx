/**
 * Menu-bar companion panel — photos, progress, readable approvals.
 */
import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUp, ChevronDown, Sparkles } from "lucide-react";
import { arrabApi } from "@/lib/api";
import type { Activity, Agent, Approval, TaskRun } from "@arrab/shared";
import { PhotoAvatar } from "@/components/companions/CompanionFace";
import {
  PRESENCE_RESOLVE_EVENT,
  type AgentPresencePayload,
  type PresenceResolveRequest,
} from "@/lib/agent-presence";
import { assignAgentTask, assignCompanionTask } from "@/lib/companion-assign";
import {
  getCompanionState,
  syncCompanionsFromCloud,
  type CompanionProfile,
} from "@/lib/companions";
import { companionPortraitUrl } from "@/lib/companion-portrait";
import { humanizeApprovalCopy } from "@/lib/approval-copy";
import { purposeRegistryById } from "@/lib/purpose-registry";
import { readStoredRole } from "@/roles/RoleProvider";

type LiveRow = {
  id: string;
  name: string;
  /** Short status — never the creation prompt */
  status: string;
  /** Optional recent activity line */
  activity?: string;
  progress: number;
  state: "working" | "needs_you" | "done" | "idle";
  hue: number;
  faceSeed: number;
  photo: string | null;
  kind: "companion" | "agent";
  lastAt?: string | null;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return formatWhen(iso);
  } catch {
    return "";
  }
}

/** Drop creation prompts / purpose essays — keep short activity only. */
function cleanActivity(text: string | null | undefined): string {
  const value = text?.trim() || "";
  if (!value) return "";
  if (
    looksLikePrompt(value) ||
    value.length > 96 ||
    value.startsWith("{") ||
    value.startsWith("[")
  ) {
    return "";
  }
  return value;
}

function looksLikePrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /i want a companion|their purpose:|hold the study|challenge weak|you are a|system prompt|roleplay/i.test(
      lower,
    ) ||
    (lower.includes("purpose") && text.length > 60) ||
    text.split(/\s+/).length > 22
  );
}

function purposeLabel(purposeId: string | null | undefined, domain: string): string {
  if (purposeId) {
    const entry = purposeRegistryById(purposeId);
    if (entry?.name) return entry.name;
  }
  if (domain && domain !== "general" && domain !== "custom") {
    return domain.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Companion";
}

function companionProgress(c: CompanionProfile): LiveRow {
  const ageMs = c.lastAt ? Date.now() - new Date(c.lastAt).getTime() : null;
  const fresh = ageMs != null && ageMs < 1000 * 60 * 30;
  const role = purposeLabel(c.purposeId, c.domain);
  const activity =
    cleanActivity(c.lastLine) ||
    cleanActivity(c.lastMemory) ||
    "";

  let state: LiveRow["state"] = "idle";
  let progress = 0.08;
  let status = `Ready · ${role}`;

  if (fresh) {
    state = "working";
    progress = 0.62;
    status = activity ? "On it" : `Active · ${role}`;
  } else if (activity) {
    status = `Standby · ${role}`;
    progress = 0.18;
  }

  return {
    id: c.id,
    name: c.name,
    status,
    activity: activity || undefined,
    progress,
    state,
    hue: c.hue || 210,
    faceSeed: c.faceSeed || 17,
    photo: c.avatarPhoto,
    kind: "companion",
    lastAt: c.lastAt,
  };
}

function agentProgress(
  agent: Agent,
  runs: TaskRun[],
  activity: Activity[],
): LiveRow {
  const run = runs.find((r) => r.agentId === agent.id);
  const act = activity.find((a) => a.actorId === agent.id);
  let state: LiveRow["state"] = "idle";
  let progress = 0.08;
  let status = agent.specialty || agent.role || "Ready";
  let activityLine = "";
  let lastAt: string | null = run?.createdAt ?? act?.createdAt ?? null;

  if (run?.status === "awaiting_approval") {
    state = "needs_you";
    progress = 0.82;
    status = "Needs approval";
    activityLine = cleanActivity(run.summary);
  } else if (run?.status === "needs_provider") {
    state = "needs_you";
    progress = 0.42;
    status = "Needs provider";
    activityLine = cleanActivity(run.summary);
  } else if (run?.status === "completed") {
    state = "done";
    progress = 1;
    status = "Completed";
    activityLine = cleanActivity(run.summary);
  } else if (run?.status === "failed") {
    state = "needs_you";
    progress = 0.28;
    status = "Blocked";
    activityLine = cleanActivity(run.summary);
  } else if (act) {
    const age = Date.now() - new Date(act.createdAt).getTime();
    if (age < 1000 * 60 * 20) {
      state = "working";
      progress = 0.55;
      status = "Working";
      activityLine = cleanActivity(act.summary);
    }
  }

  if (agent.status === "paused") {
    state = "idle";
    progress = 0;
    status = "Paused";
    activityLine = "";
  }

  const hue =
    Math.abs(
      [...agent.name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) * 17,
    ) % 360;

  return {
    id: agent.id,
    name: agent.name,
    status,
    activity: activityLine || undefined,
    progress,
    state,
    hue,
    faceSeed: hue + 11,
    photo: null,
    kind: "agent",
    lastAt,
  };
}

function portraitFor(row: LiveRow): string {
  return (
    row.photo ||
    companionPortraitUrl({
      seed: row.faceSeed,
      name: row.name,
      size: 128,
    })
  );
}

function faceStateFor(state: LiveRow["state"]) {
  if (state === "needs_you") return "speaking" as const;
  if (state === "working") return "contributing" as const;
  if (state === "done") return "lit" as const;
  return "quiet" as const;
}

export function CompanionPanelApp() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [presence, setPresence] = useState<AgentPresencePayload | null>(null);
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [orgMode, setOrgMode] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignNote, setAssignNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const isOrg = readStoredRole() === "organization";
    setOrgMode(isOrg);
    try {
      const pending = await arrabApi.pendingApprovals();
      setApprovals(pending.items);

      if (isOrg) {
        const [agentsRes, activityRes, report] = await Promise.all([
          arrabApi.agents().catch(() => ({ items: [] as Agent[] })),
          arrabApi.activity().catch(() => ({ items: [] as Activity[] })),
          arrabApi.reportSummary().catch(() => null),
        ]);
        const runs = report?.recentTaskRuns ?? [];
        const agents = agentsRes.items.filter(
          (a) => a.status === "active" || a.status === "draft" || a.status === "paused",
        );
        const rows = agents
          .map((a) => agentProgress(a, runs, activityRes.items))
          .sort((a, b) => {
            const rank = (s: LiveRow["state"]) =>
              s === "needs_you" ? 0 : s === "working" ? 1 : s === "done" ? 2 : 3;
            return rank(a.state) - rank(b.state);
          });
        setLiveRows(rows.slice(0, 12));
      } else {
        await syncCompanionsFromCloud().catch(() => undefined);
        const state = getCompanionState();
        const comps = state.companions.filter((c) => !c.archivedAt);
        setLiveRows(comps.map(companionProgress).slice(0, 10));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn’t load panel");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let unsubs: Array<() => void> = [];
    const onApprovalsChanged = () => void refresh();
    window.addEventListener("arrab:approvals-changed", onApprovalsChanged);
    window.addEventListener("companion-panel:refresh", onApprovalsChanged);
    void (async () => {
      try {
        unsubs.push(await listen("companion-panel:refresh", () => void refresh()));
        unsubs.push(await listen("arrab:approvals-changed", () => void refresh()));
        unsubs.push(
          await listen<AgentPresencePayload>("agent-presence:update", (event) => {
            setPresence(event.payload);
            if (event.payload.approvalId || event.payload.state === "needs_you") {
              void refresh();
            }
          }),
        );
        unsubs.push(
          await listen("agent-presence:hide", () => {
            setPresence(null);
          }),
        );
      } catch {
        // outside Tauri
      }
    })();
    // Silent poll — never shows Loading again after first paint.
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("arrab:approvals-changed", onApprovalsChanged);
      window.removeEventListener("companion-panel:refresh", onApprovalsChanged);
      for (const off of unsubs) off();
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected && liveRows[0]) setSelected(liveRows[0]);
  }, [liveRows, selected]);

  useEffect(() => {
    const pickerH = pickerOpen ? Math.min(Math.max(liveRows.length, 1), 6) * 56 + 12 : 0;
    const approvalH = approvals.length > 0 ? 72 : 0;
    const noteH = assignNote || error ? 28 : 0;
    const height = 96 + pickerH + approvalH + noteH;
    void invoke("companion_panel_fit", { height }).catch(() => undefined);
  }, [pickerOpen, approvals.length, assignNote, error, liveRows.length]);

  async function resolve(approval: Approval, status: "approved" | "rejected") {
    setBusyId(approval.id);
    setError(null);
    const request: PresenceResolveRequest = { approvalId: approval.id, status };
    try {
      await emit(PRESENCE_RESOLVE_EVENT, request);
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
      window.setTimeout(() => void refresh(), 600);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function submitTask() {
    if (!selected || !taskDraft.trim() || assignBusy) return;
    setAssignBusy(true);
    setAssignNote(null);
    setError(null);
    try {
      if (selected.kind === "companion") {
        await assignCompanionTask({ companionId: selected.id, task: taskDraft });
      } else {
        await assignAgentTask({
          agentId: selected.id,
          agentName: selected.name,
          hue: selected.hue,
          task: taskDraft,
        });
      }
      setAssignNote(`Sent to ${selected.name}`);
      setTaskDraft("");
      void refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn’t assign task");
    } finally {
      setAssignBusy(false);
    }
  }

  const firstApproval = approvals[0] ?? null;
  const approvalCopy = firstApproval
    ? humanizeApprovalCopy({ title: firstApproval.title, detail: firstApproval.detail })
    : null;

  return (
    <div className="ask-root">
      <form
        className="ask-bar"
        data-tauri-drag-region
        onSubmit={(event) => {
          event.preventDefault();
          void submitTask();
        }}
      >
        <button
          type="button"
          className="ask-mark"
          aria-label={pickerOpen ? "Hide companions" : "Choose companion"}
          onClick={() => setPickerOpen((open) => !open)}
        >
          {selected ? (
            <PhotoAvatar
              src={portraitFor(selected)}
              name={selected.name}
              size="sm"
              state={faceStateFor(selected.state)}
              fallbackHue={selected.hue}
              fallbackSeed={selected.faceSeed}
            />
          ) : (
            <Sparkles size={18} strokeWidth={1.8} />
          )}
        </button>
        <input
          className="ask-input"
          value={taskDraft}
          disabled={assignBusy || !selected}
          placeholder={
            selected
              ? `Ask ${selected.name}`
              : ready
                ? "What can I help you with today?"
                : "Loading companions…"
          }
          onChange={(event) => setTaskDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setPickerOpen(false);
              void invoke("companion_panel_hide").catch(() => undefined);
            }
          }}
        />
        <button
          type="button"
          className="ask-who"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span>{selected?.name ?? (orgMode ? "Agent" : "Companion")}</span>
          <ChevronDown size={14} strokeWidth={2} />
        </button>
        <button
          type="submit"
          className="ask-send"
          aria-label="Send"
          disabled={assignBusy || !selected || !taskDraft.trim()}
        >
          <ArrowUp size={16} strokeWidth={2.4} />
        </button>
      </form>

      {pickerOpen ? (
        <div className="ask-picker" role="listbox" aria-label={orgMode ? "Agents" : "Companions"}>
          {liveRows.length === 0 ? (
            <div className="ask-empty">{ready ? "No one here yet" : "Loading…"}</div>
          ) : (
            liveRows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={selected?.id === row.id}
                className={`ask-person${selected?.id === row.id ? " is-on" : ""}`}
                onClick={() => {
                  setSelected(row);
                  setPickerOpen(false);
                  setAssignNote(null);
                }}
              >
                <PhotoAvatar
                  src={portraitFor(row)}
                  name={row.name}
                  size="sm"
                  state={faceStateFor(row.state)}
                  fallbackHue={row.hue}
                  fallbackSeed={row.faceSeed}
                />
                <span className="ask-person-copy">
                  <strong>{row.name}</strong>
                  <small>{row.status}{row.lastAt ? ` · ${formatRelative(row.lastAt)}` : ""}</small>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {presence && presence.state === "needs_you" && !firstApproval ? (
        <p className="ask-note">{presence.agentName} is waiting on you</p>
      ) : null}
      {assignNote ? <p className="ask-note">{assignNote}</p> : null}
      {error ? <p className="ask-note is-error">{error}</p> : null}

      {firstApproval && approvalCopy ? (
        <div className="ask-permit">
          <div className="ask-permit-copy">
            <strong>{approvalCopy.title}</strong>
            <span>
              {approvals.length > 1 ? `${approvals.length} need a decision` : "Needs your approval"}
            </span>
          </div>
          <button
            type="button"
            className="ask-permit-btn"
            disabled={busyId === firstApproval.id}
            onClick={() => void resolve(firstApproval, "rejected")}
          >
            Decline
          </button>
          <button
            type="button"
            className="ask-permit-btn is-go"
            disabled={busyId === firstApproval.id}
            onClick={() => void resolve(firstApproval, "approved")}
          >
            Approve
          </button>
        </div>
      ) : null}
    </div>
  );
}
