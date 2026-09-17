import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  Cable,
  Check,
  LayoutGrid,
  ListTodo,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Scan,
  Send,
  Sparkles,
  TriangleAlert,
  UserPlus,
  Users,
  MessageCircle,
  X,
} from "lucide-react";
import type {
  Agent,
  Approval,
  ConnectorPublic,
  Message,
  OrgDepartment,
  OrgEmployeePublic,
  Task,
  TaskRun,
  Team,
} from "@arrab/shared";
import { ConnectorBrandIcon } from "@/components/ConnectorBrandIcon";
import { useLanguage } from "@/i18n/LanguageProvider";
import { arrabApi, ApiRequestError } from "@/lib/api";
import { connectorLabel } from "@/lib/connector-catalog";
import {
  OFFICE_DESK_GRID,
  resolveOfficeDept,
  type OfficeDeptTheme,
} from "@/lib/office-catalog";
import { cn } from "@/lib/utils";
import { parseStudioAssign } from "@/pages/HomePage";

type Props = {
  teams: Team[];
  membersByTeam: Map<string, Agent[]>;
  unassigned: Agent[];
  tasks: Task[];
  taskRuns: TaskRun[];
  approvals: Approval[];
  draftsNeedingRequest: Agent[];
  canAssignWork?: boolean;
  onBack?: () => void;
  onOpenAgent: (agentId: string) => void;
  onOpenCompanionChat: (agentId: string) => void;
  onOpenTeamChat: (teamId: string) => void;
  onOpenApprovals: () => void;
  onOpenConnectors: () => void;
  onHire: () => void;
  onComposeTeam?: () => void;
  onRefresh: () => void;
};

type MapDepartment = {
  id: string;
  name: string;
  agents: Agent[];
  openTasks: number;
  doneTasks: number;
  runs: number;
  waiting: number;
  connectors: ConnectorPublic[];
  parentId: string | null;
  x: number;
  y: number;
  color: string;
  theme: OfficeDeptTheme;
};

type TreeMap = Record<string, string | null>;

type ActivityRow = {
  id: string;
  who: string;
  text: string;
  state: "working" | "needs" | "done";
  agentId?: string;
};

type LayoutMap = Record<string, { x: number; y: number }>;

const TILT = 58;
const TILT_COS = Math.cos((TILT * Math.PI) / 180);
const ISLAND_W = 340;
const ISLAND_H = 280;
const DEPT_CONNECTORS_KEY = "arrab.workforce.deptConnectors";
const DEPT_LAYOUT_KEY = "arrab.workforce.deptLayout";
const DEPT_TREE_KEY = "arrab.workforce.deptTree";
const CARD_TOP = 168;
const MAX_DESKS = 8;
const RING_BASE = 360;

const DESK_SLOTS = OFFICE_DESK_GRID;

const PARTICLES = Array.from({ length: 56 }, (_, index) => {
  const angle = (index / 56) * Math.PI * 2 * 3.1;
  const radius = 18 + ((index * 41) % 72);
  return {
    id: index,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.72,
    z: ((index * 53) % 84) - 32,
    delay: (index % 14) * 0.26,
    duration: 3.4 + ((index * 17) % 9) * 0.3,
  };
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function readDeptConnectors(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(DEPT_CONNECTORS_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function readLayout(): LayoutMap {
  try {
    const raw = JSON.parse(localStorage.getItem(DEPT_LAYOUT_KEY) ?? "{}") as LayoutMap;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function readTree(): TreeMap {
  try {
    const raw = JSON.parse(localStorage.getItem(DEPT_TREE_KEY) ?? "{}") as TreeMap;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function slotBelow(parent: { x: number; y: number }, childIndex: number): { x: number; y: number } {
  return {
    x: parent.x + (childIndex % 2 === 0 ? -40 : 40),
    y: parent.y + ISLAND_H + 120 + Math.floor(childIndex / 2) * (ISLAND_H + 80),
  };
}

function defaultSlot(index: number, count: number): { x: number; y: number } {
  const n = Math.max(count, 1);
  const ring = n <= 2 ? RING_BASE : n <= 4 ? RING_BASE + 40 : RING_BASE + 90;
  const angle = -Math.PI / 2 + (index / n) * Math.PI * 2;
  return { x: Math.cos(angle) * ring * 1.28, y: Math.sin(angle) * ring };
}

/** Place a brand-new department next to existing islands, still linked to the brain. */
function nextOpenSlot(existing: Array<{ x: number; y: number }>): { x: number; y: number } {
  const count = existing.length + 1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const slot = defaultSlot(attempt % Math.max(count, 6), Math.max(count, 6));
    const radiusBump = Math.floor(attempt / 6) * 70;
    const candidate = {
      x: slot.x * (1 + radiusBump / RING_BASE),
      y: slot.y * (1 + radiusBump / RING_BASE),
    };
    const clear = existing.every((item) => Math.hypot(item.x - candidate.x, item.y - candidate.y) > 290);
    if (clear) return candidate;
  }
  return defaultSlot(existing.length, existing.length + 1);
}

export function LiveOfficeMap({
  teams,
  membersByTeam,
  unassigned,
  tasks,
  taskRuns,
  approvals,
  draftsNeedingRequest,
  canAssignWork = false,
  onBack,
  onOpenAgent,
  onOpenCompanionChat,
  onOpenTeamChat,
  onOpenApprovals,
  onOpenConnectors,
  onHire,
  onComposeTeam,
  onRefresh,
}: Props) {
  const { t, locale } = useLanguage();
  const shellRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    spin: number;
    mode: "pan" | "spin";
  } | null>(null);
  const islandDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const movedRef = useRef(false);
  const activityPinned = useRef(false);
  const layoutHydrated = useRef(false);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.72);
  const [spin, setSpin] = useState(-38);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectorPicker, setConnectorPicker] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [orgEmployees, setOrgEmployees] = useState<OrgEmployeePublic[]>([]);
  const [orgDepartments, setOrgDepartments] = useState<OrgDepartment[]>([]);
  const [brainTab, setBrainTab] = useState<"goals" | "live" | "tools">("goals");
  const [deptConnectors, setDeptConnectors] = useState<Record<string, string[]>>(() =>
    readDeptConnectors(),
  );
  const [layout, setLayout] = useState<LayoutMap>(() => readLayout());
  const [tree, setTree] = useState<TreeMap>(() => readTree());
  const [childNameDraft, setChildNameDraft] = useState("");
  const [childBusy, setChildBusy] = useState(false);
  const assignFormRef = useRef<HTMLFormElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [roomDock, setRoomDock] = useState<"companion" | "live" | "assign" | "team" | "tools">("companion");
  const [roomChatId, setRoomChatId] = useState<string | null>(null);
  const [roomChatMode, setRoomChatMode] = useState<"solo" | "team">("team");
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const [roomChatDraft, setRoomChatDraft] = useState("");
  const [roomChatBusy, setRoomChatBusy] = useState(false);
  const [roomChatError, setRoomChatError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [assignText, setAssignText] = useState("");
  const [assignTarget, setAssignTarget] = useState<"department" | string>("department");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignOk, setAssignOk] = useState<string | null>(null);
  const [focusDept, setFocusDept] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [brainText, setBrainText] = useState("");
  const [brainBusy, setBrainBusy] = useState(false);
  const [brainLog, setBrainLog] = useState<Array<{ id: string; text: string; who: string }>>([]);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      void arrabApi
        .connectors()
        .then((res) => {
          if (alive) setConnectors(res.items.filter((item) => item.status === "connected"));
        })
        .catch(() => undefined);
      void arrabApi
        .orgWorkforce()
        .then((snap) => {
          if (!alive) return;
          setOrgEmployees(snap.employees ?? []);
          setOrgDepartments(snap.departments ?? []);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => onRefresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [onRefresh]);

  useEffect(() => {
    try {
      localStorage.setItem(DEPT_CONNECTORS_KEY, JSON.stringify(deptConnectors));
    } catch {
      // ignore
    }
  }, [deptConnectors]);

  useEffect(() => {
    try {
      localStorage.setItem(DEPT_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // ignore
    }
  }, [layout]);

  useEffect(() => {
    try {
      localStorage.setItem(DEPT_TREE_KEY, JSON.stringify(tree));
    } catch {
      // ignore
    }
  }, [tree]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const groups = useMemo(() => {
    const list: Array<{ id: string; name: string; agents: Agent[] }> = teams.map((team) => ({
      id: team.id,
      name: team.name,
      agents: (membersByTeam.get(team.id) ?? []).filter((agent) => agent.status !== "archived"),
    }));
    if (unassigned.length > 0) {
      list.push({ id: "unassigned", name: t("mapUnassigned"), agents: unassigned });
    }
    return list;
  }, [membersByTeam, t, teams, unassigned]);

  // When a new department appears, seat it near the others (or under its parent).
  useEffect(() => {
    setLayout((current) => {
      const next = { ...current };
      let changed = false;
      const placed = Object.entries(next).map(([, pos]) => pos);
      for (const [index, group] of groups.entries()) {
        if (next[group.id]) continue;
        const parentId = tree[group.id] ?? null;
        const parentPos = parentId ? next[parentId] : null;
        const siblings = groups.filter((item) => (tree[item.id] ?? null) === parentId && next[item.id]);
        const slot = parentPos
          ? slotBelow(parentPos, siblings.length)
          : Object.keys(next).length === 0
            ? defaultSlot(index, Math.max(groups.length, 1))
            : nextOpenSlot(placed);
        next[group.id] = slot;
        placed.push(slot);
        changed = true;
      }
      for (const id of Object.keys(next)) {
        if (!groups.some((group) => group.id === id)) {
          delete next[id];
          changed = true;
        }
      }
      layoutHydrated.current = true;
      return changed ? next : current;
    });
    setTree((current) => {
      const next = { ...current };
      let changed = false;
      for (const group of groups) {
        if (!(group.id in next)) {
          next[group.id] = null;
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!groups.some((group) => group.id === id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [groups]);

  const departments = useMemo<MapDepartment[]>(() => {
    return groups.map((group, index) => {
      const ids = new Set(group.agents.map((agent) => String(agent.id)));
      const teamTasks = tasks.filter(
        (task) =>
          (task.teamId && String(task.teamId) === group.id) ||
          (task.assigneeAgentId && ids.has(String(task.assigneeAgentId))),
      );
      const waiting =
        approvals.filter((item) => item.agentId && ids.has(String(item.agentId))).length +
        draftsNeedingRequest.filter((agent) => ids.has(String(agent.id))).length;
      const attached = deptConnectors[group.id] ?? [];
      const saved = layout[group.id] ?? defaultSlot(index, Math.max(groups.length, 1));
      const parentId = tree[group.id] ?? null;
      const theme = resolveOfficeDept(group.name, index);
      return {
        id: group.id,
        name: group.name,
        agents: group.agents,
        openTasks: teamTasks.filter((task) => task.status !== "done").length,
        doneTasks: teamTasks.filter((task) => task.status === "done").length,
        runs: taskRuns.filter((run) => ids.has(String(run.agentId))).length,
        waiting,
        connectors: connectors.filter((item) => attached.includes(item.id)),
        parentId,
        x: saved.x,
        y: saved.y,
        color: theme.chip,
        theme,
      };
    });
  }, [
    approvals,
    connectors,
    deptConnectors,
    draftsNeedingRequest,
    groups,
    layout,
    taskRuns,
    tasks,
    tree,
  ]);

  const selectedDept = departments.find((dept) => dept.id === selected) ?? null;

  const employeeCountFor = useCallback(
    (deptId: string) => {
      if (deptId === "unassigned") {
        return orgEmployees.filter((person) => !person.departmentId).length;
      }
      const linked = orgDepartments.filter((item) => item.teamId && String(item.teamId) === deptId);
      if (linked.length === 0) return 0;
      const ids = new Set(linked.map((item) => String(item.id)));
      return orgEmployees.filter(
        (person) => person.departmentId && ids.has(String(person.departmentId)),
      ).length;
    },
    [orgDepartments, orgEmployees],
  );

  const activityFor = useCallback(
    (dept: MapDepartment | null): ActivityRow[] => {
      const agentName = (id: string | null) => {
        if (!id) return dept?.name ?? t("workforceTitle");
        if (dept) {
          const found = dept.agents.find((agent) => String(agent.id) === String(id));
          if (found) return found.name;
        }
        for (const item of departments) {
          const found = item.agents.find((agent) => String(agent.id) === String(id));
          if (found) return found.name;
        }
        return t("coworker");
      };
      const ids = new Set((dept?.agents ?? []).map((agent) => String(agent.id)));
      const inScope = (agentId: string | null | undefined) => {
        if (!dept) return true;
        if (!agentId) return Boolean(dept.id !== "unassigned");
        return ids.has(String(agentId));
      };
      const rows: ActivityRow[] = [];
      for (const approval of approvals) {
        if (!inScope(approval.agentId)) continue;
        rows.push({
          id: `approval-${approval.id}`,
          who: agentName(approval.agentId ? String(approval.agentId) : null),
          text: approval.title,
          state: "needs",
          agentId: approval.agentId ? String(approval.agentId) : undefined,
        });
      }
      for (const run of taskRuns) {
        if (!inScope(run.agentId)) continue;
        rows.push({
          id: `run-${run.id}`,
          who: agentName(String(run.agentId)),
          text: run.summary ?? t("ccTasks"),
          state:
            run.status === "completed"
              ? "done"
              : run.status === "awaiting_approval"
                ? "needs"
                : "working",
          agentId: String(run.agentId),
        });
      }
      for (const task of tasks) {
        const teamMatch = dept && task.teamId && String(task.teamId) === dept.id;
        if (dept && !teamMatch && !inScope(task.assigneeAgentId)) continue;
        rows.push({
          id: `task-${task.id}`,
          who: agentName(task.assigneeAgentId ? String(task.assigneeAgentId) : null),
          text: task.title,
          state: task.status === "done" ? "done" : "working",
          agentId: task.assigneeAgentId ? String(task.assigneeAgentId) : undefined,
        });
      }
      return rows.slice(0, dept ? 12 : 9);
    },
    [approvals, departments, t, taskRuns, tasks],
  );

  const globalActivity = useMemo(() => activityFor(null), [activityFor]);
  const deptActivity = useMemo(
    () => (selectedDept ? activityFor(selectedDept) : []),
    [activityFor, selectedDept],
  );

  const selectedDeptTasks = useMemo(() => {
    if (!selectedDept) return [];
    const ids = new Set(selectedDept.agents.map((agent) => String(agent.id)));
    return tasks
      .filter(
        (task) =>
          (task.teamId && String(task.teamId) === selectedDept.id) ||
          (task.assigneeAgentId && ids.has(String(task.assigneeAgentId))),
      )
      .slice(0, 8);
  }, [selectedDept, tasks]);

  const totalAgents = departments.reduce((sum, dept) => sum + dept.agents.length, 0);
  const totalWaiting = departments.reduce((sum, dept) => sum + dept.waiting, 0);

  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const rad = (spin * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minX = -90;
    let maxX = 90;
    let minY = -70;
    let maxY = 70;
    const swallow = (px: number, py: number) => {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    };
    for (const dept of departments) {
      for (const cx of [-ISLAND_W / 2, ISLAND_W / 2]) {
        for (const cy of [-ISLAND_H / 2, ISLAND_H / 2]) {
          const wx = dept.x + cx;
          const wy = dept.y + cy;
          swallow(wx * cos - wy * sin, (wx * sin + wy * cos) * TILT_COS);
        }
      }
    }
    const panelOpen = Boolean(selected);
    const reservedRight = (activityOpen && el.clientWidth > 760 ? 280 : 0) + (panelOpen ? 300 : 0);
    const roomTop = CARD_TOP + 40;
    const roomBottom = 76;
    const availW = Math.max(220, el.clientWidth - 180 - reservedRight);
    const availH = Math.max(180, el.clientHeight - roomTop - roomBottom);
    const next = Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY));
    const clamped = Math.min(1.35, Math.max(0.22, next));
    setZoom(clamped);
    setPan({
      x: -((minX + maxX) / 2) * clamped - reservedRight / 2,
      y: -((minY + maxY) / 2) * clamped + (roomTop - roomBottom) / 2,
    });
  }, [activityOpen, departments, selected, spin]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const autoCollapse = () => {
      if (activityPinned.current) return;
      setActivityOpen(el.clientWidth >= 1100 && !selected);
    };
    autoCollapse();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => autoCollapse());
    observer.observe(el);
    return () => observer.disconnect();
  }, [selected]);

  // Fit once departments first land (and when the roster count changes), not on every pan/zoom.
  const deptCount = departments.length;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (!layoutHydrated.current) return;
    fitRef.current();
  }, [deptCount]);

  useEffect(() => {
    if (!selectedDept) {
      setAssignTarget("department");
      setAssignText("");
      setAssignError(null);
      setAssignOk(null);
      return;
    }
    const first = selectedDept.agents.find((agent) => agent.status === "active") ?? selectedDept.agents[0];
    setAssignTarget(first ? String(first.id) : "department");
  }, [selectedDept]);

  function screenToWorldDelta(dx: number, dy: number) {
    const rad = (spin * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localX = dx / zoom;
    const localY = dy / (zoom * TILT_COS);
    return {
      x: localX * cos + localY * sin,
      y: -localX * sin + localY * cos,
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    if ((event.target as HTMLElement).closest("[data-om-ui]")) return;
    const mode = event.shiftKey || event.button === 2 ? "spin" : "pan";
    movedRef.current = false;
    islandDragRef.current = null;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, spin, mode };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onIslandPointerDown(event: ReactPointerEvent<HTMLDivElement>, dept: MapDepartment) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    event.stopPropagation();
    movedRef.current = false;
    dragRef.current = null;
    islandDragRef.current = {
      id: dept.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: dept.x,
      originY: dept.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const island = islandDragRef.current;
    if (island) {
      const dx = event.clientX - island.startX;
      const dy = event.clientY - island.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
      const delta = screenToWorldDelta(dx, dy);
      setLayout((current) => ({
        ...current,
        [island.id]: { x: island.originX + delta.x, y: island.originY + delta.y },
      }));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
    if (drag.mode === "spin") {
      setSpin(drag.spin + dx * 0.32);
      return;
    }
    setPan({ x: drag.panX + dx, y: drag.panY + dy });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    islandDragRef.current = null;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function bumpZoom(factor: number) {
    setZoom((current) => Math.min(2.2, Math.max(0.2, current * factor)));
  }

  async function toggleFullscreen() {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Browser may deny fullscreen outside a direct gesture in some shells.
    }
  }

  function toggleDeptConnector(deptId: string, connectorId: string) {
    setDeptConnectors((current) => {
      const list = current[deptId] ?? [];
      const next = list.includes(connectorId)
        ? list.filter((id) => id !== connectorId)
        : [...list, connectorId];
      return { ...current, [deptId]: next };
    });
  }

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    if (!selectedDept || !canAssignWork) return;
    setAssignError(null);
    setAssignOk(null);
    if (!assignText.trim()) {
      setAssignError(t("studioAssignEmpty"));
      return;
    }
    const title = assignText.trim().slice(0, 120);
    const brief = assignText.trim();
    const teamId = selectedDept.id === "unassigned" ? null : selectedDept.id;
    if (assignTarget === "department") {
      const roster = selectedDept.agents.filter((agent) => agent.status !== "archived");
      if (roster.length === 0) {
        setAssignError(t("studioAssignPick"));
        return;
      }
    }
    setAssignBusy(true);
    try {
      if (assignTarget === "department") {
        const roster = selectedDept.agents.filter((agent) => agent.status !== "archived");
        await Promise.all(
          roster.map((agent) =>
            arrabApi.createTask({
              title,
              brief,
              assigneeAgentId: String(agent.id),
              teamId,
              status: "assigned",
              priority: "medium",
            }),
          ),
        );
      } else {
        await arrabApi.createTask({
          title,
          brief,
          assigneeAgentId: assignTarget,
          teamId,
          status: "assigned",
          priority: "medium",
        });
      }
      setAssignOk(t("studioAssignDone"));
      setAssignText("");
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setAssignBusy(false);
    }
  }

  function focusAssign(target: string) {
    setAssignTarget(target);
    setRoomDock("assign");
    requestAnimationFrame(() => {
      assignFormRef.current?.querySelector("input")?.focus();
    });
  }

  function selectCompanion(agentId: string) {
    setAssignTarget(agentId);
    setRoomDock("companion");
  }

  async function openRoomChat(mode: "solo" | "team", agentId?: string) {
    if (!selectedDept) return;
    if (mode === "team" && selectedDept.id === "unassigned") {
      setRoomChatError(t("hqMapNoTeamChat"));
      return;
    }
    if (mode === "solo" && !agentId) {
      setRoomChatError(t("studioAssignPick"));
      return;
    }
    setRoomChatBusy(true);
    setRoomChatError(null);
    setRoomChatMode(mode);
    setRoomDock(mode === "team" ? "team" : "companion");
    if (mode === "solo" && agentId) setAssignTarget(agentId);
    try {
      const list = await arrabApi.conversations();
      let found =
        mode === "team"
          ? list.items.find((item) => item.teamId === selectedDept.id)
          : list.items.find((item) => item.agentId === agentId && !item.teamId);
      if (!found) {
        found = await arrabApi.createConversation(
          mode === "team"
            ? { teamId: selectedDept.id, title: `${selectedDept.name} · team` }
            : { agentId: agentId!, title: selectedDept.agents.find((a) => String(a.id) === agentId)?.name ?? "Chat" },
        );
      }
      const detail = await arrabApi.conversation(found.id);
      setRoomChatId(detail.conversation.id);
      setRoomMessages(detail.messages);
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err: unknown) {
      setRoomChatError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setRoomChatBusy(false);
    }
  }

  async function sendRoomChat(event: FormEvent) {
    event.preventDefault();
    if (!roomChatId || !roomChatDraft.trim() || roomChatBusy) return;
    const content = roomChatDraft.trim();
    setRoomChatDraft("");
    setRoomChatBusy(true);
    setRoomChatError(null);
    try {
      const result = await arrabApi.sendMessage(roomChatId, { content });
      setRoomMessages((rows) => [
        ...rows,
        result.userMessage,
        ...(result.assistantMessage ? [result.assistantMessage] : []),
      ]);
      onRefresh();
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err: unknown) {
      setRoomChatDraft(content);
      setRoomChatError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setRoomChatBusy(false);
    }
  }

  const allAgents = useMemo(
    () => departments.flatMap((dept) => dept.agents),
    [departments],
  );

  async function onBrainSend(event: FormEvent) {
    event.preventDefault();
    if (!brainText.trim()) return;
    setBrainBusy(true);
    try {
      const parsed = parseStudioAssign(brainText, allAgents);
      const agent =
        parsed.agent ??
        allAgents.find((item) => item.status === "active") ??
        allAgents[0] ??
        null;
      if (!agent) {
        setAssignError(t("studioAssignNeedPeople"));
        return;
      }
      const title = (parsed.title || brainText).trim().slice(0, 120);
      await arrabApi.createTask({
        title,
        brief: brainText.trim(),
        assigneeAgentId: agent.id,
        status: "assigned",
        priority: "medium",
      });
      setBrainLog((rows) => [
        { id: `${Date.now()}`, text: title, who: agent.name },
        ...rows,
      ].slice(0, 20));
      setBrainText("");
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setBrainBusy(false);
    }
  }

  function exitFocus() {
    setSelected(null);
    setFocusDept(false);
    setBrainOpen(false);
    setChildNameDraft("");
    setRoomDock("companion");
    setRoomChatId(null);
    setRoomMessages([]);
    setRoomChatDraft("");
    setRoomChatError(null);
    fit();
  }

  async function createDepartmentBelow(parent: MapDepartment) {
    const name = childNameDraft.trim() || `${parent.name} · ${t("hqMapSubDept")}`;
    setChildBusy(true);
    try {
      const team = await arrabApi.createTeam({
        name,
        purpose: t("hqMapSubDeptPurpose").replace("{parent}", parent.name),
        projectId: null,
      });
      const siblings = departments.filter((item) => item.parentId === parent.id);
      const slot = slotBelow(parent, siblings.length);
      setTree((current) => ({ ...current, [team.id]: parent.id }));
      setLayout((current) => ({ ...current, [team.id]: slot }));
      setChildNameDraft("");
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof ApiRequestError ? err.message : t("apiUnavailable"));
    } finally {
      setChildBusy(false);
    }
  }

  const worldStyle = {
    "--spin": `${spin}deg`,
    "--tilt": `${TILT}deg`,
    transform: `translate(-50%, -50%) translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotateX(${TILT}deg) rotateZ(${spin}deg)`,
  } as CSSProperties;

  return (
    <section ref={shellRef} className={cn("om-shell", isFullscreen && "is-fullscreen")} aria-label={t("hqLiveMapTitle")}>
      <header className="om-topbar" data-om-ui>
        {onBack ? (
          <button type="button" className="om-back" onClick={onBack} title={t("back")}>
            <ArrowLeft className="size-3.5" strokeWidth={1.9} />
            {t("back")}
          </button>
        ) : null}
        <div className="om-topbar-title">
          <span className="om-live-dot" />
          {t("hqMapLiveOffice")}
          <span className="om-topbar-counts">
            <strong>{departments.length}</strong> {t("hqMapDepartments")}
            <em>·</em>
            <strong>{totalAgents}</strong> {t("hqMapAgents")}
          </span>
        </div>
        <div className="om-topbar-connectors">
          <span>{t("hqMapConnectedTo")}</span>
          {connectors.slice(0, 10).map((item) => (
            <span key={item.id} className="om-brand" title={connectorLabel(item.provider, locale === "ar")}>
              <ConnectorBrandIcon provider={item.provider} size={15} />
            </span>
          ))}
          <button type="button" className="om-brand om-brand-add" onClick={onOpenConnectors} title={t("hqMapAddConnector")}>
            <Plus className="size-3" strokeWidth={2.2} />
          </button>
        </div>
        {onComposeTeam ? (
          <button type="button" className="om-warn-chip om-add-dept" onClick={onComposeTeam} title={t("workforceCompose")}>
            <Plus className="size-3.5" strokeWidth={2} />
            {t("hqMapAddDepartment")}
          </button>
        ) : null}
        {totalWaiting > 0 ? (
          <button type="button" className="om-warn-chip" onClick={onOpenApprovals}>
            <TriangleAlert className="size-3.5" strokeWidth={1.9} />
            {totalWaiting}
          </button>
        ) : null}
      </header>

      <div
        ref={stageRef}
        className="om-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="om-world" style={worldStyle}>
          <div className="om-grid" />

          {departments.map((dept) => {
            const parent = dept.parentId
              ? departments.find((item) => item.id === dept.parentId)
              : null;
            const fromX = parent ? parent.x : 0;
            const fromY = parent ? parent.y : 0;
            const dx = dept.x - fromX;
            const dy = dept.y - fromY;
            const length = Math.hypot(dx, dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <div
                key={`link-${dept.id}`}
                className={cn("om-link", selected === dept.id && "is-on", parent && "is-child")}
                style={{
                  width: `${length}px`,
                  transform: `translate3d(${fromX}px, ${fromY}px, 0) rotateZ(${angle}deg)`,
                }}
              >
                <i className="om-link-pulse" />
              </div>
            );
          })}

          <div
            className="om-brain"
            onPointerUp={(event) => {
              event.stopPropagation();
              if (movedRef.current) return;
              setBrainOpen(true);
              setFocusDept(false);
              setSelected(null);
              setActivityOpen(false);
            }}
            title={t("hqMapBrainTitle")}
          >
            {PARTICLES.map((particle) => (
              <span
                key={particle.id}
                className="om-particle"
                style={
                  {
                    transform: `translate3d(${particle.x}px, ${particle.y}px, ${particle.z}px)`,
                    animationDelay: `${particle.delay}s`,
                    animationDuration: `${particle.duration}s`,
                  } as CSSProperties
                }
              />
            ))}
            <span className="om-brain-core" />
            <span className="om-brain-ring" />
            <span className="om-brain-shadow" />
            <div
              className="om-billboard om-brain-label"
              style={{
                transform: `translate3d(-54px, -70px, 80px) rotateZ(calc(-1 * var(--spin))) rotateX(calc(-1 * var(--tilt))) scale(${1 / zoom})`,
              }}
            >
              <Sparkles className="size-3" strokeWidth={1.8} />
              {t("hqMapBrainTitle")}
            </div>
          </div>

          {departments.map((dept) => {
            const desks = dept.agents.slice(0, MAX_DESKS);
            return (
              <div
                key={dept.id}
                className={cn("om-island", selected === dept.id && "is-on")}
                style={
                  {
                    transform: `translate3d(${dept.x}px, ${dept.y}px, 0)`,
                    ["--dept-chip" as string]: dept.theme.chip,
                    ["--dept-ink" as string]: dept.theme.ink,
                    ["--dept-floor" as string]: dept.theme.floor,
                    ["--dept-dot" as string]: dept.color,
                  } as CSSProperties
                }
                onPointerDown={(event) => onIslandPointerDown(event, dept)}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => {
                  const wasDrag = movedRef.current;
                  endDrag(event);
                  if (wasDrag) return;
                  setSelected(dept.id);
                  setFocusDept(true);
                  setBrainOpen(false);
                  setActivityOpen(false);
                  setRoomDock("companion");
                  const rad = (spin * Math.PI) / 180;
                  const px = dept.x * Math.cos(rad) - dept.y * Math.sin(rad);
                  const py = dept.x * Math.sin(rad) + dept.y * Math.cos(rad);
                  setZoom(1.35);
                  setPan({ x: -px * 1.35, y: -py * 1.35 * TILT_COS + 40 });
                }}
              >
                <article
                  className={cn("om-billboard om-card om-pod-card", selected === dept.id && "is-on")}
                  style={{
                    transform: `translate3d(-58px, ${-(ISLAND_H / 2) - 96}px, 140px) rotateZ(calc(-1 * var(--spin))) rotateX(calc(-1 * var(--tilt))) scale(${1 / zoom})`,
                  }}
                >
                  <header>
                    <span className="om-card-dot" style={{ background: dept.theme.chip }} />
                    <h3>{dept.name}</h3>
                  </header>
                  <p className="om-card-count">
                    <strong>{dept.agents.length}</strong>
                    {t("hqMapAgents")}
                  </p>
                  <dl className="om-pod-metrics">
                    <div>
                      <dt>{dept.theme.metric}</dt>
                      <dd>{dept.doneTasks || dept.runs}</dd>
                    </div>
                    <div>
                      <dt>{t("hqMapOpenWork")}</dt>
                      <dd>{dept.openTasks}</dd>
                    </div>
                  </dl>
                  {dept.waiting > 0 ? (
                    <div className="om-card-warn-static">
                      <TriangleAlert className="size-3" strokeWidth={2} />
                      {t("hqMapWaiting").replace("{count}", String(dept.waiting))}
                    </div>
                  ) : null}
                  {dept.parentId ? (
                    <p className="om-card-parent">{t("hqMapReportsTo")}</p>
                  ) : null}
                </article>

                <div className="om-island-top">
                  <span className="om-island-sheen" />
                  <span className="om-island-title">{dept.theme.name}</span>
                </div>
                <div className="om-island-wall om-wall-n" />
                <div className="om-island-wall om-wall-s" />
                <div className="om-island-wall om-wall-e" />
                <div className="om-island-wall om-wall-w" />

                {desks.map((agent, index) => {
                  const slot = DESK_SLOTS[index % DESK_SLOTS.length]!;
                  const live = agent.status === "active";
                  const draft = agent.status === "draft";
                  return (
                    <div
                      key={String(agent.id)}
                      className={cn("om-desk", live && "is-live", draft && "is-draft")}
                      style={{ transform: `translate3d(${slot.x}px, ${slot.y}px, 0)` }}
                      onPointerUp={(event) => {
                        event.stopPropagation();
                        if (movedRef.current) return;
                        if (focusDept && selected === dept.id) {
                          onOpenAgent(String(agent.id));
                          return;
                        }
                        setSelected(dept.id);
                        setFocusDept(true);
                        setBrainOpen(false);
                        setActivityOpen(false);
                        const rad = (spin * Math.PI) / 180;
                        const px = dept.x * Math.cos(rad) - dept.y * Math.sin(rad);
                        const py = dept.x * Math.sin(rad) + dept.y * Math.cos(rad);
                        setZoom(1.35);
                        setPan({ x: -px * 1.35, y: -py * 1.35 * TILT_COS + 40 });
                      }}
                      title={`${agent.name} — ${agent.role}`}
                    >
                      <div className="om-desk-ped om-ped-l" />
                      <div className="om-desk-ped om-ped-r" />
                      <div className="om-desk-top" />
                      <div className="om-desk-wall" />
                      <div className="om-billboard om-monitor">
                        <span className="om-monitor-bar" style={{ background: dept.theme.chip }} />
                        <span className="om-monitor-line" />
                        <span className="om-monitor-line" />
                        <span className="om-monitor-line short" />
                      </div>
                      <div className="om-billboard om-bot" style={{ ["--dept-chip" as string]: dept.theme.chip } as CSSProperties}>
                        <span className="om-bot-head" />
                        <span className="om-bot-eye" />
                        <span className="om-bot-body" />
                      </div>
                      {draft ? (
                        <div className="om-billboard om-desk-alert">
                          <TriangleAlert className="size-3" strokeWidth={2.2} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {/* Name tags rendered after desks so they never sink behind monitors/bots. */}
                {desks.map((agent, index) => {
                  const slot = DESK_SLOTS[index % DESK_SLOTS.length]!;
                  return (
                    <div
                      key={`tag-${String(agent.id)}`}
                      className="om-billboard om-desk-tag"
                      style={{
                        transform: `translate3d(${slot.x}px, ${slot.y - 54}px, 96px) rotateZ(calc(-1 * var(--spin))) rotateX(calc(-1 * var(--tilt)))`,
                      }}
                      title={agent.name}
                    >
                      {agent.name}
                    </div>
                  );
                })}

                {dept.agents.length === 0 ? (
                  <div className="om-billboard om-island-empty">
                    <button
                      type="button"
                      onPointerUp={(event) => {
                        event.stopPropagation();
                        if (movedRef.current) return;
                        onHire();
                      }}
                    >
                      <UserPlus className="size-3" strokeWidth={1.9} />
                      {t("hireAgent")}
                    </button>
                  </div>
                ) : null}

                <div
                  className="om-billboard om-island-connectors"
                  style={{
                    transform: `translate3d(0px, ${ISLAND_H / 2 - 4}px, 0) rotateZ(calc(-1 * var(--spin))) rotateX(calc(-1 * var(--tilt)))`,
                  }}
                >
                  <span className="om-connector-kicker">{t("hqMapConnectors")}</span>
                  {dept.connectors.slice(0, 6).map((item) => (
                    <span
                      key={item.id}
                      className="om-connector-tile"
                      title={connectorLabel(item.provider, locale === "ar")}
                    >
                      <ConnectorBrandIcon provider={item.provider} size={18} />
                    </span>
                  ))}
                  <button
                    type="button"
                    className="om-connector-tile om-connector-add"
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (movedRef.current) return;
                      setConnectorPicker(dept.id);
                    }}
                    title={t("hqMapAddConnector")}
                  >
                    <Plus className="size-3.5" strokeWidth={2.2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {departments.length === 0 ? (
          <div className="om-empty" data-om-ui>
            <p>{t("hqEmptyMap")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {onComposeTeam ? (
                <button type="button" className="chat-pro-cta !h-9 !px-4 !text-[12px]" onClick={onComposeTeam}>
                  <Plus className="size-3.5" strokeWidth={1.9} />
                  {t("hqMapAddDepartment")}
                </button>
              ) : null}
              <button type="button" className="h-9 rounded-full border border-white/15 px-4 text-[12px]" onClick={onHire}>
                <UserPlus className="size-3.5" strokeWidth={1.9} />
                {t("hireAgent")}
              </button>
            </div>
          </div>
        ) : null}

        <div
          className="om-controls"
          data-om-ui
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => bumpZoom(0.85)} title={t("hqMapZoomOut")}>
            <Minus className="size-3.5" strokeWidth={2} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => bumpZoom(1.18)} title={t("hqMapZoomIn")}>
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          <i />
          <button type="button" onClick={() => setSpin((s) => s - 15)} title={t("hqMapRotate")}>
            <RotateCcw className="size-3.5" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => setSpin((s) => s + 15)} title={t("hqMapRotate")}>
            <RotateCw className="size-3.5" strokeWidth={1.8} />
          </button>
          <i />
          <button type="button" onClick={fit} title={t("hqMapFit")}>
            <Scan className="size-3.5" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} title={t("hqMapFullscreen")}>
            {isFullscreen ? (
              <Minimize2 className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Maximize2 className="size-3.5" strokeWidth={1.8} />
            )}
          </button>
          <span className="om-controls-hint">{t("hqMapDragHint")}</span>
        </div>

        <aside
          className={cn("om-activity", (!activityOpen || focusDept || brainOpen) && "is-collapsed")}
          data-om-ui
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <p>{t("hqMapRecentActivity")}</p>
            <button
              type="button"
              onClick={() => {
                activityPinned.current = true;
                setActivityOpen((open) => !open);
              }}
            >
              {activityOpen ? <X className="size-3.5" strokeWidth={1.8} /> : <Users className="size-3.5" strokeWidth={1.8} />}
            </button>
          </header>
          {activityOpen ? (
            <ul>
              {globalActivity.map((row) => (
                <li key={row.id}>
                  <span className="om-activity-face">{initials(row.who)}</span>
                  <span className="om-activity-body">
                    <strong>{row.who}</strong>
                    <small>{row.text}</small>
                  </span>
                  <span className={cn("om-activity-state", `is-${row.state}`)}>
                    {row.state === "needs"
                      ? t("hqMapNeedsYou")
                      : row.state === "done"
                        ? t("hqMapDone")
                        : t("hqMapWorking")}
                  </span>
                </li>
              ))}
              {globalActivity.length === 0 ? <li className="om-activity-empty">{t("hqMapQuiet")}</li> : null}
            </ul>
          ) : null}
        </aside>

        {selectedDept && focusDept ? (
          <div
            className="om-room-page"
            data-om-ui
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <header className="om-room-top">
              <button type="button" className="om-back" onClick={exitFocus}>
                <ArrowLeft className="size-3.5" strokeWidth={1.9} />
                {t("hqMapBackToFloor")}
              </button>
              <div className="min-w-0">
                <h2>{selectedDept.name}</h2>
                <p>
                  {selectedDept.agents.length} {t("hqMapAgents")}
                  <span aria-hidden> · </span>
                  {employeeCountFor(selectedDept.id)} {t("employees")}
                  {selectedDept.parentId ? (
                    <>
                      <span aria-hidden> · </span>
                      {t("hqMapChildDept")}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="om-room-top-actions">
                {selectedDept.id !== "unassigned" ? (
                  <button type="button" onClick={() => void openRoomChat("team")}>
                    <Users className="size-3.5" />
                    {t("hqChatTeam")}
                  </button>
                ) : null}
                <button type="button" onClick={onOpenApprovals}>
                  <TriangleAlert className="size-3.5" />
                  {selectedDept.waiting}
                </button>
              </div>
            </header>

            <div className="om-room-stage">
              <div
                className="om-room-board"
                style={
                  {
                    ["--dept-dot" as string]: selectedDept.color,
                    ["--dept-chip" as string]: selectedDept.theme.chip,
                    ["--dept-floor" as string]: selectedDept.theme.floor,
                    ["--dept-ink" as string]: selectedDept.theme.ink,
                  } as CSSProperties
                }
              >
                <p className="om-room-board-kicker">{selectedDept.theme.name}</p>
                <div className="om-room-seats">
                  {selectedDept.agents.slice(0, MAX_DESKS).map((agent) => {
                    const on = assignTarget === String(agent.id);
                    const live = agent.status === "active";
                    return (
                      <button
                        key={String(agent.id)}
                        type="button"
                        className={cn("om-room-seat", on && "is-on", live && "is-live")}
                        title={`${agent.name} — ${agent.role}`}
                        onClick={() => selectCompanion(String(agent.id))}
                      >
                        <span className="om-room-seat-label" title={agent.name}>{agent.name}</span>
                        <span className="om-room-seat-figure" aria-hidden>
                          <span className="om-room-seat-monitor">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className="om-room-seat-bot" />
                          <span className="om-room-seat-desk" />
                        </span>
                      </button>
                    );
                  })}
                  {selectedDept.agents.length === 0 ? (
                    <button type="button" className="om-room-empty" onClick={onHire}>
                      <UserPlus className="size-4" />
                      {t("hireAgent")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="om-room-dock">
              <nav className="om-dock-tabs" aria-label={t("hqMapRoomDock")}>
                <button type="button" className={cn(roomDock === "companion" && "is-on")} onClick={() => setRoomDock("companion")}>
                  <Users className="size-3.5" />
                  {t("hqMapDockCompanion")}
                </button>
                <button type="button" className={cn(roomDock === "live" && "is-on")} onClick={() => setRoomDock("live")}>
                  <Activity className="size-3.5" />
                  {t("hqMapDockLive")}
                </button>
                <button type="button" className={cn(roomDock === "assign" && "is-on")} onClick={() => setRoomDock("assign")}>
                  <ListTodo className="size-3.5" />
                  {t("hqMapDockAssign")}
                </button>
                <button
                  type="button"
                  className={cn(roomDock === "team" && "is-on")}
                  disabled={selectedDept.id === "unassigned"}
                  onClick={() => void openRoomChat("team")}
                >
                  <MessageCircle className="size-3.5" />
                  {t("hqMapDockTeamChat")}
                </button>
                <button type="button" className={cn(roomDock === "tools" && "is-on")} onClick={() => setRoomDock("tools")}>
                  <Cable className="size-3.5" />
                  {t("hqMapDockTools")}
                </button>
              </nav>

              <div className="om-dock-body">
                <aside className="om-dock-rail">
                  <p className="om-dock-kicker">{t("hqMapCompanions")}</p>
                  <div className="om-dock-people">
                    <button
                      type="button"
                      className={cn("om-dock-person is-dept", assignTarget === "department" && "is-on")}
                      onClick={() => { setAssignTarget("department"); setRoomDock("live"); }}
                    >
                      <span className="om-dock-avatar is-dept"><Users className="size-3.5" /></span>
                      <span>
                        <strong>{t("hqMapAssignDept")}</strong>
                        <em>{selectedDept.agents.length} {t("hqMapAgents")}</em>
                      </span>
                    </button>
                    {selectedDept.agents.map((agent) => (
                      <button
                        key={String(agent.id)}
                        type="button"
                        className={cn("om-dock-person", assignTarget === String(agent.id) && "is-on")}
                        onClick={() => selectCompanion(String(agent.id))}
                      >
                        <span className="om-dock-avatar" />
                        <span>
                          <strong>{agent.name}</strong>
                          <em>{agent.specialty || agent.role}</em>
                        </span>
                        <span className={cn("om-dock-status", agent.status === "active" && "is-live")}>{agent.status}</span>
                      </button>
                    ))}
                    <button type="button" className="om-dock-hire" onClick={onHire}>
                      <Plus className="size-3.5" />
                      {t("hireAgent")}
                    </button>
                  </div>
                </aside>

                <div className="om-dock-main">
                  {roomDock === "companion" ? (
                    <div className="om-dock-pane">
                      {(() => {
                        const agent =
                          assignTarget !== "department"
                            ? selectedDept.agents.find((item) => String(item.id) === assignTarget)
                            : null;
                        if (!agent) {
                          return (
                            <div className="om-dock-empty">
                              <p>{t("hqMapPickCompanion")}</p>
                              <button type="button" onClick={() => setRoomDock("live")}>{t("hqMapDockLive")}</button>
                            </div>
                          );
                        }
                        const agentTasks = selectedDeptTasks.filter(
                          (task) => task.assigneeAgentId && String(task.assigneeAgentId) === String(agent.id),
                        );
                        return (
                          <>
                            <header className="om-dock-hero">
                              <span className="om-dock-hero-bot" />
                              <div className="min-w-0 flex-1">
                                <h3>{agent.name}</h3>
                                <p>{agent.specialty || agent.role} · {agent.status}</p>
                                {agent.specialty || agent.role ? (
                                  <small className="om-dock-does">
                                    {agent.specialty || agent.role}
                                  </small>
                                ) : null}
                              </div>
                              <div className="om-dock-hero-actions">
                                <button type="button" onClick={() => void openRoomChat("solo", String(agent.id))}>
                                  <MessageCircle className="size-3.5" />
                                  {t("hqMapOpenCompanionChat")}
                                </button>
                                <button type="button" disabled={!canAssignWork} onClick={() => focusAssign(String(agent.id))}>
                                  <ListTodo className="size-3.5" />
                                  {t("hqMapAssignToCompanion")}
                                </button>
                                <button type="button" onClick={() => onOpenAgent(String(agent.id))}>
                                  <Scan className="size-3.5" />
                                  {t("hqMapOpenRoom")}
                                </button>
                              </div>
                            </header>
                            <div className="om-dock-split">
                              <section>
                                <h4>{t("hqMapOpenWork")}</h4>
                                <ul className="om-room-tasks">
                                  {agentTasks.slice(0, 6).map((task) => (
                                    <li key={String(task.id)}>
                                      <strong>{task.title || task.brief || t("hqMapOpenWork")}</strong>
                                      <em>{task.status}</em>
                                    </li>
                                  ))}
                                  {agentTasks.length === 0 ? <li className="om-activity-empty">{t("hqMapQuiet")}</li> : null}
                                </ul>
                              </section>
                              <section className="om-dock-chat">
                                <h4>{t("hqMapOpenCompanionChat")}</h4>
                                <div ref={chatScrollRef} className="om-dock-chat-log">
                                  {roomChatMode === "solo" && roomChatId ? (
                                    roomMessages.map((msg) => (
                                      <div key={String(msg.id)} className={cn("om-dock-bubble", `is-${msg.role}`)}>
                                        <p>{msg.content}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="om-activity-empty">{t("hqMapChatStartHint")}</p>
                                  )}
                                </div>
                                <form className="om-chat-composer" onSubmit={(event) => void sendRoomChat(event)}>
                                  <input
                                    value={roomChatMode === "solo" ? roomChatDraft : ""}
                                    onChange={(event) => setRoomChatDraft(event.target.value)}
                                    placeholder={t("hqMapChatPlaceholder")}
                                    disabled={roomChatBusy || roomChatMode !== "solo" || !roomChatId}
                                    onFocus={() => {
                                      if (roomChatMode !== "solo" || !roomChatId) void openRoomChat("solo", String(agent.id));
                                    }}
                                  />
                                  <button type="submit" disabled={roomChatBusy || !roomChatDraft.trim() || roomChatMode !== "solo" || !roomChatId}>
                                    <Send className="size-3.5" />
                                  </button>
                                </form>
                                {roomChatError ? <p className="om-assign-error">{roomChatError}</p> : null}
                              </section>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}

                  {roomDock === "live" ? (
                    <div className="om-dock-pane om-dock-live">
                      <section>
                        <h4><span className="om-live-dot" />{t("hqMapDeptActivity")}</h4>
                        <ul className="om-live-feed om-room-feed">
                          {deptActivity.slice(0, 12).map((row) => (
                            <li key={row.id}>
                              <button
                                type="button"
                                className="om-dept-activity-row"
                                onClick={() => {
                                  if (row.agentId) selectCompanion(row.agentId);
                                }}
                              >
                                <span className="om-activity-face">{initials(row.who)}</span>
                                <span className="om-activity-body">
                                  <strong>{row.who}</strong>
                                  <small>{row.text}</small>
                                </span>
                                <span className={cn("om-activity-state", `is-${row.state}`)}>
                                  {row.state === "needs" ? t("hqMapNeedsYou") : row.state === "done" ? t("hqMapDone") : t("hqMapWorking")}
                                </span>
                              </button>
                            </li>
                          ))}
                          {deptActivity.length === 0 ? <li className="om-activity-empty">{t("hqMapQuiet")}</li> : null}
                        </ul>
                      </section>
                      <section>
                        <h4>{t("hqMapOpenWork")}</h4>
                        <ul className="om-room-tasks">
                          {selectedDeptTasks.map((task) => (
                            <li key={String(task.id)}>
                              <strong>{task.title || task.brief || t("hqMapOpenWork")}</strong>
                              <em>{task.status}</em>
                            </li>
                          ))}
                          {selectedDeptTasks.length === 0 ? <li className="om-activity-empty">{t("hqMapQuiet")}</li> : null}
                        </ul>
                        {selectedDept.waiting > 0 ? (
                          <button type="button" className="om-room-approve" onClick={onOpenApprovals}>
                            <TriangleAlert className="size-3.5" />
                            {t("hqMapWaiting").replace("{count}", String(selectedDept.waiting))}
                          </button>
                        ) : null}
                      </section>
                    </div>
                  ) : null}

                  {roomDock === "assign" ? (
                    <div className="om-dock-pane">
                      <h4>{t("hqMapTabAssign")}</h4>
                      <p className="om-assign-hint">{t("hqMapAssignHint")}</p>
                      <form ref={assignFormRef} className="om-chat-assign" onSubmit={(event) => void onAssign(event)}>
                        <div className="om-assign-targets">
                          <button type="button" className={cn(assignTarget === "department" && "is-on")} onClick={() => setAssignTarget("department")}>
                            {t("hqMapAssignDept")}
                          </button>
                          {selectedDept.agents.map((agent) => (
                            <button
                              key={String(agent.id)}
                              type="button"
                              className={cn(assignTarget === String(agent.id) && "is-on")}
                              onClick={() => setAssignTarget(String(agent.id))}
                            >
                              {agent.name}
                            </button>
                          ))}
                        </div>
                        <div className="om-chat-composer">
                          <input
                            value={assignText}
                            onChange={(event) => setAssignText(event.target.value)}
                            placeholder={t("hqMapAssignChatPlaceholder")}
                            disabled={assignBusy || selectedDept.agents.length === 0 || !canAssignWork}
                          />
                          <button type="submit" disabled={assignBusy || !assignText.trim() || selectedDept.agents.length === 0 || !canAssignWork}>
                            <Send className="size-3.5" />
                          </button>
                        </div>
                        {assignError ? <p className="om-assign-error">{assignError}</p> : null}
                        {assignOk ? <p className="om-assign-ok">{assignOk}</p> : null}
                      </form>
                    </div>
                  ) : null}

                  {roomDock === "team" ? (
                    <div className="om-dock-pane om-dock-team">
                      <header className="om-dock-hero">
                        <div className="min-w-0 flex-1">
                          <h3>{t("hqChatTeam")}</h3>
                          <p>{selectedDept.name} · {selectedDept.agents.length} {t("hqMapAgents")}</p>
                        </div>
                        <button type="button" onClick={() => void openRoomChat("team")} disabled={roomChatBusy}>
                          <RotateCcw className="size-3.5" />
                          {t("refresh")}
                        </button>
                      </header>
                      <div ref={chatScrollRef} className="om-dock-chat-log is-tall">
                        {roomChatMode === "team" && roomChatId ? (
                          roomMessages.map((msg) => (
                            <div key={String(msg.id)} className={cn("om-dock-bubble", `is-${msg.role}`)}>
                              <p>{msg.content}</p>
                            </div>
                          ))
                        ) : (
                          <p className="om-activity-empty">{roomChatBusy ? t("loading") : t("hqMapChatStartHint")}</p>
                        )}
                      </div>
                      <form className="om-chat-composer" onSubmit={(event) => void sendRoomChat(event)}>
                        <input
                          value={roomChatMode === "team" ? roomChatDraft : ""}
                          onChange={(event) => setRoomChatDraft(event.target.value)}
                          placeholder={t("hqMapTeamChatPlaceholder")}
                          disabled={roomChatBusy || !roomChatId || roomChatMode !== "team"}
                        />
                        <button type="submit" disabled={roomChatBusy || !roomChatDraft.trim() || !roomChatId || roomChatMode !== "team"}>
                          <Send className="size-3.5" />
                        </button>
                      </form>
                      {roomChatError ? <p className="om-assign-error">{roomChatError}</p> : null}
                    </div>
                  ) : null}

                  {roomDock === "tools" ? (
                    <div className="om-dock-pane om-dock-tools">
                      <section className="om-brain-strip">
                        <div>
                          <h3>{t("hqMapSharedBrain")}</h3>
                          <p>{t("hqMapSharedBrainBody")}</p>
                        </div>
                        <button type="button" onClick={() => { setBrainOpen(true); setFocusDept(false); }}>
                          <Sparkles className="size-3.5" />
                          {t("hqMapOpenBrain")}
                        </button>
                      </section>
                      <section>
                        <div className="om-dept-section-head">
                          <h4>{t("hqMapConnectors")}</h4>
                          <button type="button" onClick={() => setConnectorPicker(selectedDept.id)}>
                            <Plus className="size-3" />
                            {t("hqMapAddConnector")}
                          </button>
                        </div>
                        <div className="om-dept-connectors">
                          {selectedDept.connectors.map((item) => (
                            <span key={item.id} className="om-dept-connector">
                              <ConnectorBrandIcon provider={item.provider} size={16} />
                              <em>{item.accountLabel || connectorLabel(item.provider, locale === "ar")}</em>
                            </span>
                          ))}
                          {selectedDept.connectors.length === 0 ? (
                            <p className="om-activity-empty">{t("hqMapNoConnectors")}</p>
                          ) : null}
                        </div>
                      </section>
                      <section>
                        <h4>{t("hqMapAddBelow")}</h4>
                        <p className="om-assign-hint">{t("hqMapAddBelowBody")}</p>
                        <div className="om-chat-composer">
                          <input
                            value={childNameDraft}
                            onChange={(event) => setChildNameDraft(event.target.value)}
                            placeholder={t("hqMapAddBelowPlaceholder")}
                            disabled={childBusy || selectedDept.id === "unassigned"}
                          />
                          <button
                            type="button"
                            disabled={childBusy || selectedDept.id === "unassigned"}
                            onClick={() => void createDepartmentBelow(selectedDept)}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </section>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {brainOpen ? (
          <aside
            className="om-brain-page"
            data-om-ui
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <header>
              <button type="button" className="om-back" onClick={exitFocus}>
                <ArrowLeft className="size-3.5" strokeWidth={1.9} />
                {t("hqMapBackToFloor")}
              </button>
              <div className="min-w-0 flex-1">
                <p className="om-dept-kicker">{t("hqMapSharedBrain")}</p>
                <h2>{t("hqMapBrainTitle")}</h2>
                <p className="om-dept-meta">{t("hqMapSharedBrainBody")}</p>
              </div>
              <button type="button" onClick={exitFocus} aria-label={t("close")}>
                <X className="size-3.5" strokeWidth={1.8} />
              </button>
            </header>

            <nav className="om-dept-tabs" aria-label={t("hqMapBrainTabs")}>
              <button
                type="button"
                className={cn(brainTab === "goals" && "is-on")}
                onClick={() => setBrainTab("goals")}
              >
                <Sparkles className="size-3.5" strokeWidth={1.8} />
                {t("hqMapBrainGoals")}
              </button>
              <button
                type="button"
                className={cn(brainTab === "live" && "is-on")}
                onClick={() => setBrainTab("live")}
              >
                <Activity className="size-3.5" strokeWidth={1.8} />
                {t("hqMapTabLive")}
              </button>
              <button
                type="button"
                className={cn(brainTab === "tools" && "is-on")}
                onClick={() => setBrainTab("tools")}
              >
                <Cable className="size-3.5" strokeWidth={1.8} />
                {t("hqMapBrainTools")}
              </button>
            </nav>

            <div className="om-brain-chat">
              {brainTab === "goals" ? (
                <>
                  <ul>
                    {brainLog.map((row) => (
                      <li key={row.id}>
                        <strong>{row.who}</strong>
                        <span>{row.text}</span>
                      </li>
                    ))}
                    {brainLog.length === 0 ? (
                      <li className="om-activity-empty">{t("hqMapBrainEmpty")}</li>
                    ) : null}
                  </ul>
                  <form onSubmit={(event) => void onBrainSend(event)} className="om-chat-composer">
                    <input
                      value={brainText}
                      onChange={(event) => setBrainText(event.target.value)}
                      placeholder={t("hqMapBrainPlaceholder")}
                      disabled={brainBusy || allAgents.length === 0}
                    />
                    <button type="submit" disabled={brainBusy || !brainText.trim() || allAgents.length === 0}>
                      <Send className="size-3.5" strokeWidth={2} />
                    </button>
                  </form>
                  {allAgents.length === 0 ? (
                    <p className="om-assign-hint">{t("studioAssignNeedPeople")}</p>
                  ) : null}
                </>
              ) : null}

              {brainTab === "live" ? (
                <ul className="om-live-feed">
                  {globalActivity.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="om-dept-activity-row"
                        onClick={() => row.agentId && onOpenAgent(row.agentId)}
                      >
                        <span className="om-activity-face">{initials(row.who)}</span>
                        <span className="om-activity-body">
                          <strong>{row.who}</strong>
                          <small>{row.text}</small>
                        </span>
                        <span className={cn("om-activity-state", `is-${row.state}`)}>
                          {row.state === "needs"
                            ? t("hqMapNeedsYou")
                            : row.state === "done"
                              ? t("hqMapDone")
                              : t("hqMapWorking")}
                        </span>
                      </button>
                    </li>
                  ))}
                  {globalActivity.length === 0 ? (
                    <li className="om-activity-empty">{t("hqMapQuiet")}</li>
                  ) : null}
                </ul>
              ) : null}

              {brainTab === "tools" ? (
                <div className="om-brain-tools">
                  <button type="button" onClick={onOpenConnectors}>
                    <Cable className="size-3.5" strokeWidth={1.8} />
                    {t("hqMapConnectNew")}
                  </button>
                  {onComposeTeam ? (
                    <button type="button" onClick={onComposeTeam}>
                      <Plus className="size-3.5" strokeWidth={1.8} />
                      {t("hqMapAddDepartment")}
                    </button>
                  ) : null}
                  <button type="button" onClick={onHire}>
                    <UserPlus className="size-3.5" strokeWidth={1.8} />
                    {t("hireAgent")}
                  </button>
                  <button type="button" onClick={onOpenApprovals}>
                    <TriangleAlert className="size-3.5" strokeWidth={1.8} />
                    {t("pendingApprovals")}
                  </button>
                  <p className="om-assign-hint">{t("hqMapBrainToolsHint")}</p>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {connectorPicker ? (
        <div className="om-picker" role="dialog" data-om-ui>
          <div className="om-picker-card">
            <header>
              <p>{t("hqMapAttachConnector")}</p>
              <button type="button" onClick={() => setConnectorPicker(null)} aria-label={t("close")}>
                <X className="size-3.5" strokeWidth={1.8} />
              </button>
            </header>
            <ul>
              {connectors.map((item) => {
                const on = (deptConnectors[connectorPicker] ?? []).includes(item.id);
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => toggleDeptConnector(connectorPicker, item.id)}>
                      <ConnectorBrandIcon provider={item.provider} size={18} />
                      <span className="min-w-0 flex-1 truncate text-start">
                        {item.accountLabel || connectorLabel(item.provider, locale === "ar")}
                      </span>
                      {on ? <Check className="size-3.5 text-emerald-400" strokeWidth={2.2} /> : null}
                    </button>
                  </li>
                );
              })}
              {connectors.length === 0 ? <li className="om-picker-empty">{t("hqMapNoConnectors")}</li> : null}
            </ul>
            <button type="button" className="om-picker-cta" onClick={onOpenConnectors}>
              <Cable className="size-3.5" strokeWidth={1.8} />
              {t("hqMapConnectNew")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
