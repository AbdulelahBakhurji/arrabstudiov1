/**
 * Menu-bar companion panel — photos, progress, readable approvals.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowUp, Check, Plus, Sparkles, X } from "lucide-react";
import arrabSymbol from "@/shared/assets/symbol.png";
import { arrabApi } from "@/core/api/api";
import { messages } from "@/shared/i18n/messages";
import { APP_VERSION } from "@/domains/managed/client/app-version";
import { applyCompanionPolicy, companionAvailability } from "@/domains/managed/client/companions";
import { limitStatus } from "@/domains/managed/client/limits";
import { readCachedPolicy } from "@/domains/managed/client/store";
import { maintenanceView } from "@/domains/managed/client/updates";
import type { Activity, Agent, Approval, TaskRun } from "@arrab/shared";
import { PhotoAvatar } from "@/domains/companions/ui/CompanionFace";
import {
  PRESENCE_RESOLVE_EVENT,
  type AgentPresencePayload,
  type PresenceResolveRequest,
} from "@/domains/notifications/agent-presence";
import { assignAgentTask, assignCompanionTask } from "@/domains/companions/companion-assign";
import {
  getCompanionState,
  syncCompanionsFromCloud,
  type CompanionProfile,
} from "@/domains/companions/companions";
import { companionPortraitUrl } from "@/domains/companions/companion-portrait";
import { humanizeApprovalCopy } from "@/domains/notifications/approval-copy";
import { purposeRegistryById } from "@/domains/companions/purpose-registry";
import { readStoredRole } from "@/domains/account/roles/RoleProvider";

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

/** Why the ask field is closed right now, per what Arrab Control last told the main window. */
function panelAskBlock(selected: LiveRow | null): string | null {
  const t = messages[localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en"];
  const { config, maintenance } = readCachedPolicy();
  const view = maintenanceView(APP_VERSION, maintenance, false);
  if (view.updateMode === "blocking") return t.mcUpdateRequiredBar;
  if (view.readOnly) return t.mcReadOnlySend;
  if (config?.features.menuBarAsk === false) return t.mcPanelAskOff;
  if (selected && !companionAvailability(selected, config?.companions ?? []).enabled) {
    return t.mcCompanionUnavailable;
  }
  if (limitStatus(config?.limits).level === "blocked") return t.mcUsageLimitReached;
  return null;
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
  const lastAt: string | null = run?.createdAt ?? act?.createdAt ?? null;

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

function stateLabel(state: LiveRow["state"]): string {
  if (state === "needs_you") return "Needs you";
  if (state === "working") return "Working";
  if (state === "done") return "Done";
  return "Ready";
}

function readPanelTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem("arrab.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function CompanionPanelApp() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [presence, setPresence] = useState<AgentPresencePayload | null>(null);
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [orgMode, setOrgMode] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignNote, setAssignNote] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [theme, setTheme] = useState(readPanelTheme);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const selected = liveRows.find((row) => row.id === selectedId) ?? liveRows[0] ?? null;
  const askBlock = panelAskBlock(selected);

  const refresh = useCallback(async () => {
    setTheme(readPanelTheme());
    const isOrg = readStoredRole() === "organization";
    setOrgMode(isOrg);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    try {
      const pending = await arrabApi.pendingApprovals();
      setApprovals(pending.items);
    } catch {
      // A failed approvals poll is not the same as being offline.
    }

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
      setLiveRows(applyCompanionPolicy(rows, readCachedPolicy().config?.companions ?? []).slice(0, 12));
    } else {
      // Companions live on this Mac first; the cloud sync only freshens them.
      await syncCompanionsFromCloud().catch(() => undefined);
      const state = getCompanionState();
      const comps = applyCompanionPolicy(
        state.companions.filter((c) => !c.archivedAt),
        readCachedPolicy().config?.companions ?? [],
      );
      setLiveRows(comps.map(companionProgress).slice(0, 12));
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const unsubs: Array<() => void> = [];
    const onChanged = () => void refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "arrab.theme") setTheme(readPanelTheme());
    };
    const onOnline = () => setOffline(false);
    const onNetOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onNetOffline);
    window.addEventListener("arrab:approvals-changed", onChanged);
    window.addEventListener("companion-panel:refresh", onChanged);
    window.addEventListener("storage", onStorage);
    void (async () => {
      try {
        unsubs.push(
          await listen("companion-panel:refresh", () => {
            void refresh();
            window.setTimeout(() => inputRef.current?.focus(), 40);
          }),
        );
        unsubs.push(await listen("arrab:approvals-changed", () => void refresh()));
        unsubs.push(
          await listen<AgentPresencePayload>("agent-presence:update", (event) => {
            setPresence(event.payload);
            if (event.payload.approvalId || event.payload.state === "needs_you") {
              void refresh();
            }
          }),
        );
        unsubs.push(await listen("agent-presence:hide", () => setPresence(null)));
      } catch {
        // outside Tauri
      }
    })();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onNetOffline);
      window.removeEventListener("arrab:approvals-changed", onChanged);
      window.removeEventListener("companion-panel:refresh", onChanged);
      window.removeEventListener("storage", onStorage);
      for (const off of unsubs) off();
    };
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The native window follows the content height. After a user drag it stays put.

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, a")) return;
    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }
  useEffect(() => {
    const node = stackRef.current;
    if (!node) return;
    let last = 0;
    const fit = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (Math.abs(height - last) < 2) return;
      last = height;
      void invoke("companion_panel_fit", { height }).catch(() => undefined);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!assignNote) return;
    const timer = window.setTimeout(() => setAssignNote(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [assignNote]);

  function choose(row: LiveRow) {
    setSelectedId(row.id);
    setAssignNote(null);
    setError(null);
    inputRef.current?.focus();
    const tile = stripRef.current?.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
    tile?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }

  function openStudio(target: "new-companion" | "chat") {
    void invoke("companion_panel_open_studio", { target }).catch(() => undefined);
  }

  function hidePanel() {
    void invoke("companion_panel_hide").catch(() => undefined);
  }

  async function resolve(approval: Approval, status: "approved" | "rejected") {
    setBusyId(approval.id);
    setError(null);
    const request: PresenceResolveRequest = { approvalId: approval.id, status };
    try {
      await emit(PRESENCE_RESOLVE_EVENT, request);
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
      window.setTimeout(() => void refresh(), 600);
    } catch {
      setError("That decision didn’t go through. Try again in a moment.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitTask() {
    if (askBlock) return;
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
      const reallyOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      setError(
        reallyOffline
          ? `${selected.name} will pick this up once you’re back online.`
          : err instanceof Error && err.message
            ? err.message
            : `Couldn’t reach ${selected.name}. Try again in a moment.`,
      );
    } finally {
      setAssignBusy(false);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      hidePanel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
      const row = liveRows[Number(event.key) - 1];
      if (row) {
        event.preventDefault();
        choose(row);
      }
      return;
    }
    if (!taskDraft && (event.key === "ArrowLeft" || event.key === "ArrowRight") && selected) {
      const index = liveRows.findIndex((row) => row.id === selected.id);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = liveRows[(index + step + liveRows.length) % liveRows.length];
      if (next) {
        event.preventDefault();
        choose(next);
      }
    }
  }

  const firstApproval = approvals[0] ?? null;
  const approvalCopy = firstApproval
    ? humanizeApprovalCopy({ title: firstApproval.title, detail: firstApproval.detail })
    : null;
  const noun = orgMode ? "agent" : "companion";
  const status =
    error ??
    assignNote ??
    (presence && presence.state === "needs_you" && !firstApproval
      ? `${presence.agentName} is waiting on you`
      : null);

  return (
    <div className="cp-root">
      <div className="cp-stack" ref={stackRef}>
        {firstApproval && approvalCopy ? (
          <div className="cp-permit" role="alert">
            <span className="cp-permit-pulse" aria-hidden />
            <div className="cp-permit-copy">
              <strong>{approvalCopy.title}</strong>
              <span>
                {approvals.length > 1
                  ? `${approvals.length} decisions waiting`
                  : "Waiting for your approval"}
              </span>
            </div>
            <button
              type="button"
              className="cp-btn"
              disabled={busyId === firstApproval.id}
              onClick={() => void resolve(firstApproval, "rejected")}
            >
              Decline
            </button>
            <button
              type="button"
              className="cp-btn is-primary"
              disabled={busyId === firstApproval.id}
              onClick={() => void resolve(firstApproval, "approved")}
            >
              Approve
            </button>
          </div>
        ) : null}

        <section className="cp-card">
          <header
            className="cp-head"
            data-tauri-drag-region
            title={messages[localStorage.getItem("arrab.locale") === "ar" ? "ar" : "en"].companionPanelDrag}
            onPointerDown={beginDrag}
          >
            <span className="cp-drag" data-tauri-drag-region aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <img className="cp-logo" src={arrabSymbol} alt="" draggable={false} />
            <span className="cp-title" data-tauri-drag-region>
              {orgMode ? "Your agents" : "Your companions"}
            </span>
            {liveRows.length > 0 ? (
              <span className="cp-count" data-tauri-drag-region>
                {liveRows.length}
              </span>
            ) : null}
            {offline && ready ? (
              <span
                className="cp-offline"
                data-tauri-drag-region
                title="Showing what’s saved on this Mac"
              >
                <span className="cp-offline-dot" aria-hidden />
                Offline
              </span>
            ) : null}
            <span className="cp-head-space" data-tauri-drag-region />
            <button type="button" className="cp-ghost no-drag" onClick={() => openStudio("chat")}>
              Open Studio
            </button>
            <button type="button" className="cp-icon no-drag" aria-label="Close" onClick={hidePanel}>
              <X size={14} strokeWidth={2.2} />
            </button>
          </header>

          <div
            className="cp-strip"
            ref={stripRef}
            role="listbox"
            aria-label={orgMode ? "Agents" : "Companions"}
          >
            {!ready && liveRows.length === 0
              ? [0, 1, 2, 3].map((n) => (
                  <div key={n} className="cp-tile is-skeleton" aria-hidden>
                    <span className="cp-portrait" />
                    <span className="cp-skel-line" />
                  </div>
                ))
              : liveRows.map((row, index) => {
                  const on = selected?.id === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      data-row={row.id}
                      data-state={row.state}
                      className={`cp-tile${on ? " is-on" : ""}`}
                      style={{ "--tile-hue": row.hue } as CSSProperties}
                      title={row.activity ?? row.status}
                      onClick={() => choose(row)}
                    >
                      <span className="cp-portrait">
                        <PhotoAvatar
                          src={portraitFor(row)}
                          name={row.name}
                          size="lg"
                          state={faceStateFor(row.state)}
                          fallbackHue={row.hue}
                          fallbackSeed={row.faceSeed}
                        />
                        <span className="cp-state-dot" aria-hidden />
                        {index < 9 ? <kbd className="cp-hotkey">⌘{index + 1}</kbd> : null}
                      </span>
                      <span className="cp-tile-name">{row.name}</span>
                      <span className="cp-tile-state">
                        {row.lastAt && row.state !== "idle"
                          ? `${stateLabel(row.state)} · ${formatRelative(row.lastAt)}`
                          : stateLabel(row.state)}
                      </span>
                    </button>
                  );
                })}
            {!orgMode ? (
              <button
                type="button"
                className={`cp-tile is-new${liveRows.length === 0 && ready ? " is-lonely" : ""}`}
                onClick={() => openStudio("new-companion")}
              >
                <span className="cp-portrait">
                  <span className="cp-new-ring">
                    <Plus size={20} strokeWidth={2} />
                  </span>
                </span>
                <span className="cp-tile-name">
                  {liveRows.length === 0 ? "Create your first" : "New companion"}
                </span>
                <span className="cp-tile-state">Opens in Studio</span>
              </button>
            ) : null}
          </div>

          <form
            className="cp-ask"
            onSubmit={(event) => {
              event.preventDefault();
              void submitTask();
            }}
          >
            <span className="cp-ask-who">
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
                <Sparkles size={16} strokeWidth={1.8} />
              )}
            </span>
            <input
              ref={inputRef}
              className="cp-input"
              value={taskDraft}
              autoFocus
              disabled={assignBusy || !selected || Boolean(askBlock)}
              placeholder={
                askBlock
                  ? askBlock
                  : selected
                  ? `Ask ${selected.name} anything…`
                  : ready
                    ? `Create a ${noun} to get started`
                    : `Loading ${noun}s…`
              }
              onChange={(event) => setTaskDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="submit"
              className="cp-send"
              aria-label="Send"
              disabled={assignBusy || !selected || !taskDraft.trim() || Boolean(askBlock)}
            >
              {assignBusy ? <span className="cp-spinner" aria-hidden /> : <ArrowUp size={16} strokeWidth={2.4} />}
            </button>
          </form>

          <footer className="cp-foot">
            {status ? (
              <span className={`cp-status${error ? " is-error" : " is-ok"}`} role="status">
                {error ? null : <Check size={12} strokeWidth={2.6} />}
                {status}
              </span>
            ) : (
              <span className="cp-hints">
                <kbd>↵</kbd> send
                <kbd>←</kbd>
                <kbd>→</kbd> switch
                <kbd>esc</kbd> close
              </span>
            )}
            {selected?.activity ? (
              <span className="cp-activity" title={selected.activity}>
                {selected.activity}
              </span>
            ) : null}
          </footer>
        </section>
      </div>
    </div>
  );
}

