/**
 * Menu-bar companion panel — photos, progress, readable approvals.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import { humanizeApprovalCopy, presenceDisplayCopy } from "@/lib/approval-copy";
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

  const waitingLabel = useMemo(() => {
    if (approvals.length > 0) return `${approvals.length} waiting`;
    const live = liveRows.filter((r) => r.state === "working" || r.state === "needs_you").length;
    if (live > 0) return `${live} live`;
    return "All clear";
  }, [approvals.length, liveRows]);

  const presenceCopy = useMemo(
    () =>
      presenceDisplayCopy({
        title: presence?.title,
        body: presence?.body,
        state: presence?.state,
      }),
    [presence?.title, presence?.body, presence?.state],
  );
  const presencePreview = presence?.preview?.trim() || presenceCopy.preview || "";

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

  return (
    <div className="cp-root">
      <div className="cp-shell">
        <header className="cp-header" data-tauri-drag-region>
          <div className="cp-brand">
            <div className="cp-title">{orgMode ? "Agents" : "Companions"}</div>
            <div className="cp-sub">{waitingLabel}</div>
          </div>
          <button
            type="button"
            className="cp-icon-btn"
            aria-label="Close"
            onClick={() => void invoke("companion_panel_hide").catch(() => undefined)}
          >
            ✕
          </button>
        </header>

        {presence ? (
          <div className={`cp-presence state-${presence.state}`}>
            <PhotoAvatar
              src={
                presence.agentPhoto ||
                companionPortraitUrl({
                  seed: presence.faceSeed ?? 42,
                  name: presence.agentName,
                  size: 96,
                })
              }
              name={presence.agentName}
              size="sm"
              state={presence.state === "needs_you" ? "speaking" : "contributing"}
              fallbackHue={presence.hue ?? 210}
              fallbackSeed={presence.faceSeed ?? 42}
            />
            <span className="cp-presence-copy">
              <strong>{presence.agentName}</strong>
              <span className="cp-presence-title">{presenceCopy.title}</span>
              {presenceCopy.body ? (
                <span className="cp-presence-body">{presenceCopy.body}</span>
              ) : null}
            </span>
            {typeof presence.progress === "number" ? (
              <div className="cp-presence-bar" aria-hidden>
                <span style={{ width: `${Math.round(clamp01(presence.progress) * 100)}%` }} />
              </div>
            ) : null}
            {presencePreview ? <pre className="cp-presence-preview">{presencePreview}</pre> : null}
            <div className="cp-item-actions cp-presence-actions">
              {presence.approvalId ? (
                <>
                  <button
                    type="button"
                    className="cp-btn is-decline"
                    onClick={() => {
                      void emit(PRESENCE_RESOLVE_EVENT, {
                        approvalId: presence.approvalId!,
                        status: "rejected",
                      } satisfies PresenceResolveRequest);
                      setPresence(null);
                    }}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    className="cp-btn is-approve"
                    onClick={() => {
                      void emit(PRESENCE_RESOLVE_EVENT, {
                        approvalId: presence.approvalId!,
                        status: "approved",
                      } satisfies PresenceResolveRequest);
                      setPresence(null);
                    }}
                  >
                    Approve
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="cp-btn is-decline"
                  style={{ gridColumn: "1 / -1" }}
                  onClick={() => void invoke("agent_presence_hide").catch(() => undefined)}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        ) : null}

        <section className="cp-section">
          <div className="cp-section-label">{orgMode ? "Live" : "People"}</div>
          {liveRows.length === 0 ? (
            <div className="cp-empty is-soft">
              {ready ? (orgMode ? "No agents yet" : "No companions yet") : "Loading…"}
            </div>
          ) : (
            <ul className="cp-list">
              {liveRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`cp-live state-${row.state}${selected?.id === row.id ? " is-selected" : ""}`}
                    onClick={() => {
                      setSelected(row);
                      setAssignNote(null);
                    }}
                  >
                    <div className="cp-live-top">
                      <span className="cp-live-avatar-wrap">
                        <PhotoAvatar
                          src={portraitFor(row)}
                          name={row.name}
                          size="sm"
                          state={faceStateFor(row.state)}
                          fallbackHue={row.hue}
                          fallbackSeed={row.faceSeed}
                        />
                      </span>
                      <div className="cp-live-copy">
                        <div className="cp-item-title">{row.name}</div>
                        <div className="cp-item-status">{row.status}</div>
                        {row.activity ? (
                          <div className="cp-item-activity">{row.activity}</div>
                        ) : null}
                      </div>
                      <span className="cp-live-pct">
                        {Math.round(row.progress * 100)}%
                      </span>
                    </div>
                    <div className="cp-live-track" style={{ ["--cp-hue" as string]: row.hue }}>
                      <span style={{ width: `${Math.round(row.progress * 100)}%` }} />
                    </div>
                    {row.lastAt && row.state === "idle" ? (
                      <div className="cp-live-meta">{formatRelative(row.lastAt)}</div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <section className="cp-assign">
            <div className="cp-section-label">Task for {selected.name}</div>
            <textarea
              className="cp-assign-input"
              rows={2}
              value={taskDraft}
              placeholder="What should they do?"
              disabled={assignBusy}
              onChange={(event) => setTaskDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitTask();
                }
              }}
            />
            <div className="cp-assign-row">
              <button
                type="button"
                className="cp-btn is-decline"
                onClick={() => {
                  setSelected(null);
                  setTaskDraft("");
                  setAssignNote(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn is-approve"
                disabled={assignBusy || !taskDraft.trim()}
                onClick={() => void submitTask()}
              >
                {assignBusy ? "Sending…" : "Assign"}
              </button>
            </div>
            {assignNote ? <div className="cp-assign-note">{assignNote}</div> : null}
          </section>
        ) : null}

        <section className="cp-section cp-section-approvals">
          <div className="cp-section-label">Approvals</div>
          {!ready && approvals.length === 0 ? (
            <div className="cp-empty is-soft">Loading…</div>
          ) : error ? (
            <div className="cp-empty is-error">{error}</div>
          ) : approvals.length === 0 ? (
            <div className="cp-empty is-soft">No pending approvals</div>
          ) : (
            <ul className="cp-list">
              {approvals.map((approval) => {
                const copy = humanizeApprovalCopy({
                  title: approval.title,
                  detail: approval.detail,
                });
                return (
                  <li key={approval.id} className="cp-item cp-item-approval">
                    <div className="cp-item-top">
                      <div className="cp-item-title">{copy.title}</div>
                      <div className="cp-item-time">{formatWhen(approval.createdAt)}</div>
                    </div>
                    {copy.body ? <div className="cp-item-body">{copy.body}</div> : null}
                    {copy.preview ? <pre className="cp-approval-preview">{copy.preview}</pre> : null}
                    <div className="cp-item-actions">
                      <button
                        type="button"
                        className="cp-btn is-decline"
                        disabled={busyId === approval.id}
                        onClick={() => void resolve(approval, "rejected")}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="cp-btn is-approve"
                        disabled={busyId === approval.id}
                        onClick={() => void resolve(approval, "approved")}
                      >
                        Approve
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function clamp01(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
