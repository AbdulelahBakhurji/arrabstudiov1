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
  brainContextSnippet,
  brainLinksForNodes,
  brainNodesForScope,
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

function edgePath(from: BrainNode, to: BrainNode, w = 1000, h = 640) {
  const x1 = from.x * w;
  const y1 = from.y * h;
  const x2 = to.x * w;
  const y2 = to.y * h;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * 0.12;
  const cy = my + dx * 0.12;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

async function pullRealChats(input: {
  scope: BrainScope;
  space: "personal" | "work" | "org";
  companions: ReturnType<typeof getCompanionState>["companions"];
}) {
  const before = getSecondBrain().nodes.length;

  if (input.scope === "individual") {
    syncBrainFromCompanions(getCompanionState());
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
    const person = input.companions.find((c) => c.conversationId === chat.conversation.id);
    if (input.scope === "individual" && !person && !chat.conversation.agentId) continue;
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
    });
  }

  for (const conversation of soloRemote) {
    if (seen.has(conversation.id)) continue;
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
    const person = input.companions.find((c) => c.conversationId === conversation.id);
    ingestBrainMessages({
      scope: input.scope,
      space: input.scope === "solo" ? "org" : (person?.space ?? input.space),
      companionId: person?.id ?? conversation.agentId,
      companionName:
        person?.name ?? conversation.title ?? (input.scope === "solo" ? "Agent" : "Companion"),
      conversationId: conversation.id,
      messages,
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
  const companionState = useCompanionState();
  const brain = useSecondBrain();
  const [space, setSpace] = useCompanionSpace();
  const [filter, setFilter] = useState<BrainNodeKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const syncingRef = useRef(false);

  const effectiveScope: BrainScope = scope;
  const spaceKey = effectiveScope === "individual" ? space : ("org" as const);

  const refreshFromChats = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await pullRealChats({
        scope: effectiveScope,
        space: spaceKey === "org" ? "org" : space,
        companions: getCompanionState().companions,
      });
      setLastSyncedAt(Date.now());
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [effectiveScope, space, spaceKey]);

  useEffect(() => {
    void refreshFromChats();
    const interval = window.setInterval(() => void refreshFromChats(), SYNC_MS);
    const onFocus = () => void refreshFromChats();
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshFromChats();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshFromChats]);

  useEffect(() => {
    if (effectiveScope === "individual") {
      syncBrainFromCompanions(companionState);
    }
  }, [companionState, effectiveScope]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 40);
    return () => window.clearInterval(id);
  }, []);

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
    moveBrainNode(drag.id, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
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
          <Metric label={t("brainStatProjects")} value={stats.projects} />
          <Metric label={t("brainStatSessions")} value={stats.sessions} />
          <Metric label={t("brainStatDecisions")} value={stats.decisions} />
          <Metric label={t("brainStatFiles")} value={stats.files} />
          <Metric label={ar ? "أشخاص" : "People"} value={stats.people} />
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
              <svg
                ref={svgRef}
                className="sb-canvas"
                viewBox="0 0 1000 640"
                role="img"
                aria-label={t("brainMapAria")}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                <defs>
                  <filter id="sbGlowSoft" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <rect
                  width="1000"
                  height="640"
                  className="sb-canvas-bg"
                  onPointerDown={() => {
                    setSelectedId(null);
                    setHoverId(null);
                  }}
                />

                {links.map((link, index) => {
                  const from = nodes.find((n) => n.id === link.from);
                  const to = nodes.find((n) => n.id === link.to);
                  if (!from || !to) return null;
                  const lit = isLit("", link);
                  return (
                    <path
                      key={link.id}
                      d={edgePath(from, to)}
                      className={cn("sb-edge", lit ? "is-lit" : "is-dim")}
                      style={{ animationDelay: `${(index % 12) * 0.12}s` }}
                    />
                  );
                })}

                {nodes.map((node, index) => {
                  const breath = Math.sin(tick * 0.045 + index * 0.7) * 2.2;
                  const cx = node.x * 1000;
                  const cy = node.y * 640 + breath * 0.35;
                  const active = selectedId === node.id;
                  const lit = isLit(node.id);
                  const hub = (degree.get(node.id) ?? 0) >= 3;
                  const showLabel =
                    active || hoverId === node.id || hub || node.kind === "companion";
                  const baseR =
                    node.kind === "project" || node.kind === "companion"
                      ? 15
                      : node.kind === "session"
                        ? 11
                        : 9;
                  const r = baseR + (active ? 1.5 : 0) + breath * 0.15;
                  return (
                    <g
                      key={node.id}
                      className={cn("sb-node", active && "is-active", !lit && "is-dim")}
                      transform={`translate(${cx}, ${cy})`}
                      onPointerDown={(e) => onPointerDown(node, e)}
                      onPointerEnter={() => setHoverId(node.id)}
                      onPointerLeave={() => setHoverId(null)}
                      style={{ animationDelay: `${Math.min(index, 24) * 0.035}s` }}
                    >
                      <circle
                        r={r + 14}
                        fill={BRAIN_KIND_COLOR[node.kind]}
                        className="sb-node-aura"
                        opacity={active ? 0.22 : 0.1}
                      />
                      {active || hub ? (
                        <circle
                          r={r + 8}
                          className="sb-node-ring"
                          stroke={BRAIN_KIND_COLOR[node.kind]}
                        />
                      ) : null}
                      <circle
                        r={r}
                        fill={BRAIN_KIND_COLOR[node.kind]}
                        className="sb-node-core"
                        filter={active ? "url(#sbGlowSoft)" : undefined}
                      />
                      <circle r={Math.max(2.5, r * 0.28)} className="sb-node-dot" />
                      {showLabel ? (
                        <text y={r + 18} textAnchor="middle" className="sb-node-label">
                          {shortTitle(node.title, active ? 24 : 16)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
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
                <h3>{selected.title}</h3>
                <p className="sb-detail-body">{selected.summary || t("brainNoSummary")}</p>

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
                            <span>{shortTitle(node.title, 28)}</span>
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

            {effectiveScope === "individual" ? (
              <pre className="sb-context">
                {brainContextSnippet("individual", null, ar ? "ar" : "en", 3) ||
                  t("brainContextEmpty")}
              </pre>
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="sb-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
