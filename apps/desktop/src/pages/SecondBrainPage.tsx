import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUpRight,
  Brain,
  FileText,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Scale,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageProvider";
import { useRole } from "@/roles/RoleProvider";
import { SpaceSwitch, useCompanionSpace } from "@/components/companions/CompanionUI";
import { getCompanionState, useCompanionState } from "@/lib/companions";
import { arrabApi } from "@/lib/api";
import {
  BRAIN_KIND_COLOR,
  brainLinksForNodes,
  brainNodesForScope,
  companionsForActiveBrain,
  ensureBrainPartition,
  getSecondBrain,
  ingestBrainMessages,
  moveBrainNode,
  relayoutBrainScope,
  syncBrainFromCompanions,
  useSecondBrain,
  type BrainLink,
  type BrainNode,
  type BrainNodeKind,
  type BrainScope,
} from "@/lib/second-brain";
import { listCachedChats, loadChatHistory } from "@/lib/chat-history";
import { FAMILY_EVENT, isFamilyChild, readActiveFamilyMemberId } from "@/lib/family-session";
import { useFamilyProfile } from "@/lib/use-family-profile";
import { cn } from "@/lib/utils";

const KIND_FILTERS: Array<BrainNodeKind | "all"> = [
  "all",
  "project",
  "session",
  "decision",
  "file",
  "companion",
];

const SYNC_MS = 12_000;

function kindLabel(kind: BrainNodeKind | "all", ar: boolean): string {
  if (kind === "all") return ar ? "الكل" : "All";
  const map: Record<BrainNodeKind, [string, string]> = {
    project: ["Project", "مشروع"],
    session: ["Session", "جلسة"],
    decision: ["Decision", "قرار"],
    file: ["File", "ملف"],
    companion: ["Person", "شخص"],
    fact: ["Fact", "حقيقة"],
    work: ["Task", "مهمة"],
  };
  return ar ? map[kind][1] : map[kind][0];
}

function shortTitle(title: string, max = 18) {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

const MAP_W = 1000;
const MAP_H = 640;

/** Keep rings circular inside the wide canvas, with room for labels. */
function toCanvas(nx: number, ny: number) {
  const pad = 78;
  const size = Math.min(MAP_W, MAP_H) - pad * 2;
  const ox = (MAP_W - size) / 2;
  const oy = (MAP_H - size) / 2;
  return { x: ox + nx * size, y: oy + ny * size };
}

function fromCanvas(px: number, py: number) {
  const pad = 78;
  const size = Math.min(MAP_W, MAP_H) - pad * 2;
  const ox = (MAP_W - size) / 2;
  const oy = (MAP_H - size) / 2;
  return { x: (px - ox) / size, y: (py - oy) / size };
}

function nodeRadius(kind: BrainNodeKind, active: boolean) {
  const base = kind === "companion" ? 15 : kind === "project" ? 11 : kind === "session" ? 9 : 8;
  return base + (active ? 1.5 : 0);
}

function edgePath(from: BrainNode, to: BrainNode, r1: number, r2: number) {
  const a = toCanvas(from.x, from.y);
  const b = toCanvas(to.x, to.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const x1 = a.x + (dx / len) * (r1 + 3);
  const y1 = a.y + (dy / len) * (r1 + 3);
  const x2 = b.x - (dx / len) * (r2 + 3);
  const y2 = b.y - (dy / len) * (r2 + 3);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const cx = mx - (y2 - y1) * 0.14;
  const cy = my + (x2 - x1) * 0.14;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

const CHIP_H = 22;

function arabicTitle(text: string) {
  const letters = text.replace(/\s/g, "");
  const arabic = letters.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  return arabic >= 2 && arabic >= letters.length * 0.4;
}

function chipWidth(text: string) {
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 36);
  let width = 20;
  for (const ch of sample) {
    if (/[\u0600-\u06FF]/.test(ch)) width += 8;
    else if (ch === " ") width += 3.2;
    else width += 6.4;
  }
  return Math.min(156, Math.max(48, Math.round(width)));
}

type ChipBox = { x: number; y: number; w: number; h: number };

function boxesHit(a: ChipBox, b: ChipBox, pad = 5) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

function placeLabel(
  item: { cx: number; cy: number; r: number; title: string },
  taken: ChipBox[],
  nodes: Array<{ cx: number; cy: number; r: number }>,
  force: boolean,
): ChipBox | null {
  const w = chipWidth(item.title);
  const h = CHIP_H;
  const dx = item.cx - MAP_W / 2;
  const dy = item.cy - MAP_H / 2;
  const len = Math.hypot(dx, dy);
  const ux = len < 28 ? 0 : dx / len;
  const uy = len < 28 ? 1 : dy / len;
  const offsets: Array<[number, number]> = [];
  for (const extra of [16, 32, 50]) {
    const dist = item.r + extra;
    offsets.push([ux * dist, uy * dist], [-uy * dist * 0.85, ux * dist * 0.85], [uy * dist * 0.85, -ux * dist * 0.85]);
  }
  offsets.push([0, item.r + 18], [0, -(item.r + 18)]);

  for (const [ox, oy] of offsets) {
    const chip: ChipBox = {
      x: item.cx + ox - w / 2,
      y: item.cy + oy - h / 2,
      w,
      h,
    };
    chip.x = Math.max(8, Math.min(MAP_W - w - 8, chip.x));
    chip.y = Math.max(8, Math.min(MAP_H - h - 8, chip.y));
    const self = { x: item.cx - item.r, y: item.cy - item.r, w: item.r * 2, h: item.r * 2 };
    if (boxesHit(chip, self, 1)) continue;
    if (taken.some((box) => boxesHit(chip, box))) continue;
    if (nodes.some((node) => boxesHit(chip, { x: node.cx - node.r, y: node.cy - node.r, w: node.r * 2, h: node.r * 2 }, 2))) {
      continue;
    }
    return chip;
  }
  if (!force) return null;
  return {
    x: Math.max(8, Math.min(MAP_W - w - 8, item.cx - w / 2)),
    y: Math.max(8, Math.min(MAP_H - h - 8, item.cy + item.r + 12)),
    w,
    h,
  };
}

async function pullRealChats(input: {
  scope: BrainScope;
  space: "personal" | "work" | "org";
  companions: ReturnType<typeof getCompanionState>["companions"];
}) {
  const before = getSecondBrain().nodes.length;
  ensureBrainPartition();

  const companions = companionsForActiveBrain(input.companions);
  const allowedIds = new Set(companions.map((c) => c.id));
  const allowedConversations = new Set(
    companions.map((c) => c.conversationId).filter(Boolean) as string[],
  );
  const seatId = readActiveFamilyMemberId();
  const childSeat = isFamilyChild();

  if (input.scope === "individual") {
    syncBrainFromCompanions(getCompanionState());
  }

  // Kid with no parent-listed companions → keep partition clean (no household chat pull).
  if (input.scope === "individual" && childSeat && companions.length === 0) {
    const after = getSecondBrain().nodes.length;
    if (after !== before || before === 0) {
      relayoutBrainScope(input.scope, input.space);
    }
    return;
  }

  const cached = await listCachedChats();
  let remote: Awaited<ReturnType<typeof arrabApi.conversations>>["items"] = [];
  try {
    remote = (await arrabApi.conversations()).items;
  } catch {
    remote = [];
  }

  const soloRemote = remote.filter((c) => !c.teamId);
  const seen = new Set<string>();

  for (const chat of cached) {
    if (chat.conversation.teamId) continue;
    seen.add(chat.conversation.id);
    const person = companions.find((c) => c.conversationId === chat.conversation.id);
    if (input.scope === "individual") {
      if (!person) continue;
      if (!allowedIds.has(person.id)) continue;
      if (childSeat && person.familyMemberId !== seatId) continue;
    }
    ingestBrainMessages({
      scope: input.scope,
      space: input.scope === "solo" ? "org" : (person?.space ?? input.space),
      companionId: person?.id ?? chat.conversation.agentId,
      companionName:
        person?.name ??
        chat.conversation.title ??
        (input.scope === "solo" ? "Agent" : "Companion"),
      conversationId: chat.conversation.id,
      messages: chat.messages,
      familyMemberId: person?.familyMemberId ?? (childSeat ? seatId : null),
    });
  }

  for (const conversation of soloRemote) {
    if (seen.has(conversation.id)) continue;
    if (
      input.scope === "individual" &&
      !allowedConversations.has(conversation.id) &&
      !companions.some((c) => c.id === conversation.agentId)
    ) {
      continue;
    }
    let messages =
      (await loadChatHistory(conversation.id))?.messages ??
      [];
    if (messages.length < 2) {
      try {
        const detail = await arrabApi.conversation(conversation.id);
        messages = detail.messages;
      } catch {
        continue;
      }
    }
    if (messages.length < 2) continue;
    const person = companions.find(
      (c) => c.conversationId === conversation.id || c.id === conversation.agentId,
    );
    if (input.scope === "individual" && !person) continue;
    if (input.scope === "individual" && childSeat && person?.familyMemberId !== seatId) continue;
    ingestBrainMessages({
      scope: input.scope,
      space: input.scope === "solo" ? "org" : (person?.space ?? input.space),
      companionId: person?.id ?? conversation.agentId,
      companionName:
        person?.name ?? conversation.title ?? (input.scope === "solo" ? "Agent" : "Companion"),
      conversationId: conversation.id,
      messages,
      familyMemberId: person?.familyMemberId ?? (childSeat ? seatId : null),
    });
  }

  const after = getSecondBrain().nodes.length;
  if (after !== before || before === 0) {
    relayoutBrainScope(input.scope, input.scope === "solo" ? "org" : input.space);
  }
}

export function SecondBrainPage({ scope }: { scope: BrainScope }) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const { href } = useRole();
  const { active: familyActive } = useFamilyProfile();
  const companionState = useCompanionState();
  const brain = useSecondBrain();
  const [space, setSpace] = useCompanionSpace();
  const [filter, setFilter] = useState<BrainNodeKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const syncingRef = useRef(false);

  const effectiveScope: BrainScope = scope;
  const spaceKey = effectiveScope === "individual" ? space : ("org" as const);
  const seatKey = familyActive?.id ?? "self";

  const refreshFromChats = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      ensureBrainPartition();
      await pullRealChats({
        scope: effectiveScope,
        space: spaceKey === "org" ? "org" : space,
        companions: getCompanionState().companions,
      });
      setLastSyncedAt(Date.now());
      setSelectedId(null);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [effectiveScope, space, spaceKey, seatKey]);

  useEffect(() => {
    ensureBrainPartition();
    void refreshFromChats();
    const interval = window.setInterval(() => void refreshFromChats(), SYNC_MS);
    const onFocus = () => void refreshFromChats();
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshFromChats();
    };
    const onFamily = () => {
      ensureBrainPartition();
      void refreshFromChats();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(FAMILY_EVENT, onFamily);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(FAMILY_EVENT, onFamily);
    };
  }, [refreshFromChats]);

  useEffect(() => {
    if (effectiveScope === "individual") {
      ensureBrainPartition();
      syncBrainFromCompanions(companionState);
    }
  }, [companionState, effectiveScope, seatKey]);

  const allScoped = useMemo(
    () => brainNodesForScope(brain, effectiveScope, spaceKey),
    [brain, effectiveScope, spaceKey],
  );

  const nodes = useMemo(() => {
    if (filter === "all") return allScoped;
    return allScoped.filter((n) => n.kind === filter);
  }, [allScoped, filter]);

  const links = useMemo(() => brainLinksForNodes(brain, nodes), [brain, nodes]);

  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of links) {
      map.set(link.from, (map.get(link.from) ?? 0) + 1);
      map.set(link.to, (map.get(link.to) ?? 0) + 1);
    }
    return map;
  }, [links]);

  const selected = allScoped.find((n) => n.id === selectedId) ?? null;
  const focusId = hoverId ?? selectedId;

  const connected = useMemo(() => {
    if (!selected) return [] as BrainNode[];
    const ids = new Set<string>();
    for (const link of brain.links) {
      if (link.from === selected.id) ids.add(link.to);
      if (link.to === selected.id) ids.add(link.from);
    }
    return allScoped.filter((n) => ids.has(n.id)).slice(0, 8);
  }, [selected, brain.links, allScoped]);

  const stats = useMemo(
    () => ({
      projects: allScoped.filter((n) => n.kind === "project").length,
      decisions: allScoped.filter((n) => n.kind === "decision").length,
      files: allScoped.filter((n) => n.kind === "file").length,
      sessions: allScoped.filter((n) => n.kind === "session").length,
      people: allScoped.filter((n) => n.kind === "companion").length,
    }),
    [allScoped],
  );

  function onPointerDown(node: BrainNode, event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragRef.current = { id: node.id, pointerId: event.pointerId };
    setSelectedId((current) => (current === node.id ? null : node.id));
  }

  function onCanvasPointerDown(event: ReactPointerEvent) {
    if (event.target !== event.currentTarget) return;
    dragRef.current = null;
    setSelectedId(null);
    setHoverId(null);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const point = fromCanvas(
      ((event.clientX - rect.left) / rect.width) * MAP_W,
      ((event.clientY - rect.top) / rect.height) * MAP_H,
    );
    moveBrainNode(drag.id, point.x, point.y);
  }

  function onPointerUp(event: ReactPointerEvent) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function isLit(nodeId: string, link?: BrainLink) {
    if (!focusId) return true;
    if (link) return link.from === focusId || link.to === focusId;
    if (nodeId === focusId) return true;
    return brain.links.some(
      (l) =>
        (l.from === focusId && l.to === nodeId) || (l.to === focusId && l.from === nodeId),
    );
  }

  const shellClass =
    effectiveScope === "individual" ? "cp-ui cp-page sb-page" : "sb-org-page sb-page";

  const syncedLabel = (() => {
    if (syncing) return ar ? "مزامنة…" : "Syncing…";
    if (!lastSyncedAt) return ar ? "من المحادثات" : "From chats";
    const sec = Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1000));
    if (sec < 5) return ar ? "مباشر" : "Live";
    if (sec < 60) return ar ? `منذ ${sec}ث` : `${sec}s ago`;
    return ar ? `منذ ${Math.round(sec / 60)}د` : `${Math.round(sec / 60)}m ago`;
  })();

  return (
    <div className={shellClass}>
      <section className="sb-console">
        <header className="sb-console-head">
          <div className="sb-console-title">
            <div className="sb-mark" aria-hidden>
              <Brain strokeWidth={1.5} size={18} />
            </div>
            <div>
              <p className="sb-kicker">
                {effectiveScope === "solo" ? t("brainEyebrowSolo") : t("brainNav")}
              </p>
              <h1>{t("brainTitle")}</h1>
              <p className="sb-lead">
                {effectiveScope === "solo" ? t("brainSubtitleSolo") : t("brainSubtitle")}
              </p>
            </div>
          </div>
          <div className="sb-console-actions">
            {effectiveScope === "individual" ? (
              <SpaceSwitch value={space} onChange={setSpace} />
            ) : (
              <Link to={href("/chat")} className="sb-btn sb-btn-solid">
                <MessageSquare size={14} />
                {t("chat")}
              </Link>
            )}
            <button
              type="button"
              className="sb-sync"
              disabled={syncing}
              onClick={() => void refreshFromChats()}
              title={t("brainLearn")}
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} />
              <span className="sb-sync-dot" data-live={syncing || (!!lastSyncedAt && Date.now() - lastSyncedAt < 8000)} />
              {syncedLabel}
            </button>
          </div>
        </header>

        <div className="sb-metrics" role="group" aria-label={t("brainHeroTitle")}>
          <Metric label={t("brainStatProjects")} value={stats.projects} tone={BRAIN_KIND_COLOR.project} />
          <Metric label={t("brainStatSessions")} value={stats.sessions} tone={BRAIN_KIND_COLOR.session} />
          <Metric label={t("brainStatDecisions")} value={stats.decisions} tone={BRAIN_KIND_COLOR.decision} />
          <Metric label={t("brainStatFiles")} value={stats.files} tone={BRAIN_KIND_COLOR.file} />
          <Metric label={ar ? "أشخاص" : "People"} value={stats.people} tone={BRAIN_KIND_COLOR.companion} />
        </div>

        <div className="sb-console-bar">
          <div className="sb-seg" role="tablist" aria-label={t("brainFilter")}>
            {KIND_FILTERS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={filter === kind}
                onClick={() => setFilter(kind)}
                className={cn(filter === kind && "is-active")}
              >
                {kindLabel(kind, ar)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sb-btn sb-btn-ghost"
            onClick={() => relayoutBrainScope(effectiveScope, spaceKey)}
          >
            <GitBranch size={14} />
            {ar ? "إعادة ترتيب" : "Auto-layout"}
          </button>
        </div>

        <div className="sb-workspace">
          <div className="sb-map-shell">
            {nodes.length === 0 ? (
              <div className="sb-empty">
                <div className="sb-empty-mark">
                  <Sparkles size={20} strokeWidth={1.5} />
                </div>
                <h3>{t("brainEmptyTitle")}</h3>
                <p>{t("brainEmptyBody")}</p>
              </div>
            ) : (
              <div className="sb-stage">
              <svg
                ref={svgRef}
                className="sb-canvas"
                viewBox={`0 0 ${MAP_W} ${MAP_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t("brainMapAria")}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                <defs>
                  <pattern id="sbDots" width="28" height="28" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="0.9" className="sb-grid-dot" />
                  </pattern>
                  <radialGradient id="sbVignette" cx="50%" cy="46%" r="62%">
                    <stop offset="0%" className="sb-vignette-inner" />
                    <stop offset="100%" className="sb-vignette-outer" />
                  </radialGradient>
                  <filter id="sbGlowSoft" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <rect
                  width={MAP_W}
                  height={MAP_H}
                  className="sb-canvas-bg"
                  onPointerDown={() => {
                    setSelectedId(null);
                    setHoverId(null);
                  }}
                />
                <rect width={MAP_W} height={MAP_H} fill="url(#sbVignette)" pointerEvents="none" />
                <rect width={MAP_W} height={MAP_H} fill="url(#sbDots)" pointerEvents="none" />
                <g className="sb-cortex" pointerEvents="none">
                  <circle cx={MAP_W / 2} cy={MAP_H / 2} r={92} />
                  <circle cx={MAP_W / 2} cy={MAP_H / 2} r={168} />
                  <circle cx={MAP_W / 2} cy={MAP_H / 2} r={244} />
                </g>

                {links.map((link) => {
                  const from = nodes.find((n) => n.id === link.from);
                  const to = nodes.find((n) => n.id === link.to);
                  if (!from || !to) return null;
                  const lit = isLit("", link);
                  const d = edgePath(
                    from,
                    to,
                    nodeRadius(from.kind, selectedId === from.id),
                    nodeRadius(to.kind, selectedId === to.id),
                  );
                  const color = BRAIN_KIND_COLOR[from.kind];
                  return (
                    <g key={link.id} pointerEvents="none">
                      <path
                        d={d}
                        className={cn("sb-edge-glow", focusId && !lit && "is-dim")}
                        stroke={color}
                      />
                      <path
                        d={d}
                        className={cn(
                          "sb-edge",
                          focusId && lit ? "is-lit" : "is-quiet",
                          focusId && !lit && "is-dim",
                        )}
                        stroke={focusId && lit ? color : undefined}
                      />
                    </g>
                  );
                })}

                {nodes.map((node, index) => {
                  const point = toCanvas(node.x, node.y);
                  const active = selectedId === node.id;
                  const lit = isLit(node.id);
                  const hub = node.kind === "companion" || (degree.get(node.id) ?? 0) >= 3;
                  const r = nodeRadius(node.kind, active);
                  const color = BRAIN_KIND_COLOR[node.kind];
                  return (
                    <g
                      key={node.id}
                      className={cn("sb-node", active && "is-active", !lit && "is-dim")}
                      transform={`translate(${point.x}, ${point.y})`}
                      onPointerDown={(e) => onPointerDown(node, e)}
                      onPointerEnter={() => setHoverId(node.id)}
                      onPointerLeave={() => setHoverId(null)}
                      style={{ animationDelay: `${Math.min(index, 24) * 0.035}s` }}
                    >
                      <circle r={20} className="sb-node-hit" />
                      <circle r={r + 11} fill={color} className="sb-node-aura" opacity={active ? 0.22 : 0.1} />
                      <circle r={r + 4.5} className="sb-node-shell" stroke={color} />
                      {hub ? <circle r={r + 8} className="sb-node-ring" stroke={color} /> : null}
                      <circle r={r} fill={color} className="sb-node-core" filter={active || hub ? "url(#sbGlowSoft)" : undefined} />
                      <circle r={r * 0.42} className="sb-node-sheen" />
                      <circle r={1.7} className="sb-node-dot" />
                    </g>
                  );
                })}
              </svg>
              <div className="sb-chips">
                {(() => {
                  const points = nodes.map((node) => {
                    const point = toCanvas(node.x, node.y);
                    return {
                      node,
                      cx: point.x,
                      cy: point.y,
                      r: nodeRadius(node.kind, selectedId === node.id),
                    };
                  });
                  const taken: ChipBox[] = [];
                  const chips: Array<ChipBox & { id: string; title: string; active: boolean }> = [];
                  const ranked = [...points].sort((a, b) => {
                    const rank = (item: (typeof points)[number]) =>
                      item.node.id === selectedId
                        ? 6
                        : item.node.id === hoverId
                          ? 5
                          : item.node.kind === "companion"
                            ? 4
                            : item.node.kind === "project"
                              ? 2
                              : 1;
                    return rank(b) - rank(a);
                  });
                  for (const item of ranked) {
                    const title = item.node.title.replace(/\s+/g, " ").trim();
                    const box = placeLabel(
                      { cx: item.cx, cy: item.cy, r: item.r, title },
                      taken,
                      points
                        .filter((point) => point.node.id !== item.node.id)
                        .map((point) => ({ cx: point.cx, cy: point.cy, r: point.r })),
                      item.node.id === selectedId || item.node.id === hoverId,
                    );
                    if (!box) continue;
                    taken.push(box);
                    chips.push({ ...box, id: item.node.id, title, active: selectedId === item.node.id });
                  }
                  return chips.map((chip) => (
                    <span
                      key={chip.id}
                      className={cn("sb-chip", chip.active && "is-active")}
                      dir={arabicTitle(chip.title) ? "rtl" : "auto"}
                      lang={arabicTitle(chip.title) ? "ar" : undefined}
                      style={{
                        left: `${(chip.x / MAP_W) * 100}%`,
                        top: `${(chip.y / MAP_H) * 100}%`,
                        width: `${(chip.w / MAP_W) * 100}%`,
                        height: `${(chip.h / MAP_H) * 100}%`,
                      }}
                    >
                      <span className="sb-chip-text">{chip.title}</span>
                    </span>
                  ));
                })()}
              </div>
              </div>
            )}
          </div>

          <aside className="sb-inspector">
            <div className="sb-inspector-head">
              <p>{t("brainDetailTitle")}</p>
              <div className="sb-inspector-head-actions">
                <span>
                  {nodes.length} {ar ? "عقدة" : "nodes"}
                </span>
                {selectedId ? (
                  <button
                    type="button"
                    className="sb-deselect"
                    onClick={() => {
                      setSelectedId(null);
                      setHoverId(null);
                    }}
                  >
                    {ar ? "إلغاء التحديد" : "Deselect"}
                  </button>
                ) : null}
              </div>
            </div>

            {selected ? (
              <article className="sb-detail">
                <div className="sb-detail-top">
                  <span
                    className="sb-kind"
                    style={{
                      color: BRAIN_KIND_COLOR[selected.kind],
                      borderColor: `${BRAIN_KIND_COLOR[selected.kind]}55`,
                      background: `${BRAIN_KIND_COLOR[selected.kind]}18`,
                    }}
                  >
                    {kindLabel(selected.kind, ar)}
                  </span>
                </div>
                <h3 dir="auto">{selected.title}</h3>
                <p className="sb-detail-body" dir="auto">{selected.summary || t("brainNoSummary")}</p>

                <dl className="sb-meta">
                  <div>
                    <dt>{t("brainUpdated")}</dt>
                    <dd>
                      {new Date(selected.updatedAt).toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>{ar ? "الروابط" : "Links"}</dt>
                    <dd>{degree.get(selected.id) ?? 0}</dd>
                  </div>
                </dl>

                {selected.kind === "decision" ? (
                  <p className="sb-callout">
                    <Scale size={14} /> {t("brainDecisionHint")}
                  </p>
                ) : null}
                {selected.kind === "file" ? (
                  <p className="sb-callout">
                    <FileText size={14} /> {t("brainFileHint")}
                  </p>
                ) : null}

                {connected.length ? (
                  <div className="sb-related">
                    <p>{ar ? "متصل بـ" : "Connected to"}</p>
                    <ul>
                      {connected.map((node) => (
                        <li key={node.id}>
                          <button type="button" onClick={() => setSelectedId(node.id)}>
                            <i style={{ background: BRAIN_KIND_COLOR[node.kind] }} />
                            <span dir="auto">{shortTitle(node.title, 28)}</span>
                            <ArrowUpRight size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {effectiveScope === "solo" && selected.conversationId ? (
                  <Link to={href("/chat")} className="sb-btn sb-btn-solid sb-open-chat">
                    <MessageSquare size={14} />
                    {t("chat")}
                  </Link>
                ) : null}
              </article>
            ) : (
              <div className="sb-inspector-empty">
                <Brain size={22} strokeWidth={1.4} />
                <p>{t("brainPickNode")}</p>
                {allScoped.length ? (
                  <ul className="sb-quick">
                    {[...allScoped]
                      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
                      .slice(0, 6)
                      .map((node) => (
                        <li key={node.id}>
                          <button type="button" onClick={() => setSelectedId(node.id)}>
                            <i style={{ background: BRAIN_KIND_COLOR[node.kind] }} />
                            <span dir="auto">{shortTitle(node.title, 26)}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            )}

            <div className="sb-legend">
              <p>{t("brainLegend")}</p>
              <ul>
                {(["project", "session", "decision", "file", "companion"] as BrainNodeKind[]).map(
                  (kind) => (
                    <li key={kind}>
                      <i style={{ background: BRAIN_KIND_COLOR[kind] }} />
                      {kindLabel(kind, ar)}
                    </li>
                  ),
                )}
              </ul>
            </div>

          </aside>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="sb-metric">
      <i style={{ background: tone }} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
