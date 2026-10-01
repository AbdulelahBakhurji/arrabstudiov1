import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import {
  AreaChart,
  BarChart2,
  CandlestickChart,
  Crosshair,
  Eraser,
  Hand,
  Maximize2,
  Minus,
  MoveDiagonal,
  Plus,
  RotateCcw,
  Spline,
  Trash2,
  TrendingUp,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  CHART_INTERVALS,
  buildCandleSeries,
  changePct,
  displaySymbol,
  formatPct,
  formatPrice,
  marketSessionBoard,
  newDrawingId,
  sessionForQuote,
  type ChartDrawing,
  type ChartDrawKind,
  type ChartIntervalKey,
  type MarketCandle,
  type MarketQuote,
} from "@/lib/studio-markets";
import { cn } from "@/lib/utils";

export type ChartPlotType = "candle" | "hollow" | "bar" | "line" | "area";

type DrawTool = "cursor" | "pan" | ChartDrawKind | "erase";

type Props = {
  quote: MarketQuote;
  candles: MarketCandle[] | null;
  liveOk: boolean;
  interval: ChartIntervalKey;
  onIntervalChange: (key: ChartIntervalKey) => void;
  onClose: () => void;
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const MIN_BARS = 12;
const MAX_BARS = 240;
/** Target candle width in CSS pixels — keeps density readable across desktop sizes. */
const TARGET_BAR_PX = 11;

function barsForPlotWidth(plotW: number, seriesLen: number): number {
  const target = Math.round(Math.max(plotW, 80) / TARGET_BAR_PX);
  const capped = Math.min(MAX_BARS, Math.max(MIN_BARS, target));
  if (!seriesLen) return capped;
  // Leave room to pan unless the series is short.
  const withPanRoom = seriesLen > MIN_BARS + 4 ? Math.min(capped, Math.max(MIN_BARS, Math.floor(seriesLen * 0.72))) : capped;
  return Math.min(seriesLen, withPanRoom);
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 960, h: 520 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(240, Math.floor(rect.width)),
        h: Math.max(160, Math.floor(rect.height)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

/** Keep the forming candle live with the latest quote print. */
function withLiveTip(candles: MarketCandle[], quote: MarketQuote): MarketCandle[] {
  if (!candles.length) return candles;
  const next = candles.slice();
  const tip = { ...next[next.length - 1]! };
  tip.c = quote.last;
  tip.h = Math.max(tip.h, tip.o, quote.last, quote.high);
  tip.l = Math.min(tip.l, tip.o, quote.last, quote.low);
  next[next.length - 1] = tip;
  return next;
}

export function MarketsFullChart({ quote, candles, liveOk, interval, onIntervalChange, onClose }: Props) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const [plot, setPlot] = useState<ChartPlotType>("candle");
  const [tool, setTool] = useState<DrawTool>("pan");
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [draft, setDraft] = useState<{ kind: ChartDrawKind; t0: number; p0: number; t1: number; p1: number } | null>(
    null,
  );
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [viewCount, setViewCount] = useState(48);
  const [viewEnd, setViewEnd] = useState(0);
  const [followLive, setFollowLive] = useState(true);
  const [pulse, setPulse] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  const dragRef = useRef<{
    mode: "pan" | "draw";
    lastClientX: number;
    accPx: number;
    pointerId: number;
  } | null>(null);
  const followRef = useRef(followLive);
  const panningRef = useRef(false);
  const userZoomedRef = useRef(false);
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();

  useEffect(() => {
    followRef.current = followLive;
  }, [followLive]);

  const baseSeries = useMemo(() => {
    if (candles && candles.length > 8) return candles;
    return buildCandleSeries(quote, plot === "line" || plot === "area" ? 160 : 120);
  }, [candles, quote.symbol, plot]); // eslint-disable-line react-hooks/exhaustive-deps -- tip applied below

  const series = useMemo(() => withLiveTip(baseSeries, quote), [baseSeries, quote.last, quote.high, quote.low, quote.open]);

  const pad = useMemo(
    () => ({
      top: Math.max(12, Math.min(22, Math.round(size.h * 0.035))),
      right: Math.max(48, Math.min(76, Math.round(size.w * 0.055))),
      bottom: Math.max(22, Math.min(34, Math.round(size.h * 0.045))),
      left: Math.max(8, Math.min(16, Math.round(size.w * 0.01))),
    }),
    [size.w, size.h],
  );
  const fitPlotW = Math.max(40, size.w - pad.left - pad.right);

  // Keep viewport attached to live tip; re-fit density on resize unless the user zoomed.
  useEffect(() => {
    const len = series.length;
    if (!len) return;
    setViewCount((count) => {
      const fitted = barsForPlotWidth(fitPlotW, len);
      if (count >= len - 1 || !userZoomedRef.current) return fitted;
      return Math.min(count, len);
    });
    if (!panningRef.current && followRef.current) {
      setViewEnd(len);
    } else {
      setViewEnd((end) => Math.min(Math.max(end || len, MIN_BARS), len));
    }
  }, [series.length, fitPlotW]);

  // Pulse the live tip so the chart visibly moves with prints.
  useEffect(() => {
    setPulse((n) => n + 1);
    if (!panningRef.current && followRef.current) {
      setViewEnd(series.length);
    }
  }, [quote.last, series.length]);

  const sessions = useMemo(() => marketSessionBoard(clock), [clock]);
  const ownSession = useMemo(() => sessionForQuote(quote, clock), [quote, clock]);
  const pct = changePct(quote);
  const up = pct >= 0;

  useEffect(() => {
    userZoomedRef.current = false;
  }, [interval, quote.symbol]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") zoomBy(0.85);
      if (event.key === "-" || event.key === "_") zoomBy(1.18);
      if (event.key === "ArrowLeft") panBy(8);
      if (event.key === "ArrowRight") panBy(-8);
      if (event.key === "Home") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const width = size.w;
  const height = size.h;
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom);

  const safeCount = Math.min(Math.max(viewCount, MIN_BARS), Math.max(series.length, MIN_BARS));
  const end = Math.min(Math.max(viewEnd || series.length, safeCount), series.length || safeCount);
  const start = Math.max(0, end - safeCount);
  const visible = series.slice(start, end);

  const priceExtent = useMemo(() => {
    if (!visible.length) return { max: quote.last * 1.01, min: quote.last * 0.99 };
    const highs = visible.map((c) => c.h);
    const lows = visible.map((c) => c.l);
    let max = Math.max(...highs, quote.last);
    let min = Math.min(...lows, quote.last);
    for (const d of drawings) {
      if (d.kind === "hline") {
        max = Math.max(max, d.price);
        min = Math.min(min, d.price);
      } else {
        max = Math.max(max, d.p0, d.p1);
        min = Math.min(min, d.p0, d.p1);
      }
    }
    const padPct = (max - min) * 0.08 || max * 0.01;
    return { max: max + padPct, min: Math.max(0, min - padPct) };
  }, [visible, quote.last, drawings]);

  const span = Math.max(priceExtent.max - priceExtent.min, 0.0001);
  const barW = plotW / Math.max(visible.length, 1);

  const xAtLocal = (localIndex: number) => pad.left + localIndex * barW + barW / 2;
  const yAt = (price: number) => pad.top + ((priceExtent.max - price) / span) * plotH;
  const priceAtY = (y: number) => priceExtent.max - ((y - pad.top) / plotH) * span;
  const localIndexAtX = (x: number) => {
    const raw = Math.floor((x - pad.left) / barW);
    return Math.max(0, Math.min(visible.length - 1, raw));
  };
  const globalIndexAtX = (x: number) => start + localIndexAtX(x);
  const timeAtGlobal = (index: number) => series[index]?.t ?? Date.now();
  const localIndexAtTime = (t: number) => {
    if (!visible.length) return 0;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < visible.length; i += 1) {
      const dist = Math.abs(visible[i]!.t - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };

  const zoomBy = (factor: number, anchorLocal?: number) => {
    const len = series.length;
    if (!len) return;
    userZoomedRef.current = true;
    const anchor = anchorLocal ?? visible.length - 1;
    const globalAnchor = start + anchor;
    setViewCount((count) => {
      const next = Math.round(Math.min(MAX_BARS, Math.max(MIN_BARS, Math.min(len, count * factor))));
      setViewEnd((endNow) => {
        const curEnd = endNow || len;
        const curStart = Math.max(0, curEnd - count);
        const ratio = count <= 1 ? 1 : (globalAnchor - curStart) / count;
        let newStart = Math.round(globalAnchor - ratio * next);
        newStart = Math.max(0, Math.min(len - next, newStart));
        const newEnd = newStart + next;
        setFollowLive(newEnd >= len - 1);
        return newEnd;
      });
      return next;
    });
  };

  const panBy = (bars: number) => {
    const len = series.length;
    if (!len) return;
    setFollowLive(false);
    followRef.current = false;
    setViewEnd((endNow) => {
      const count = Math.min(Math.max(viewCount, MIN_BARS), len);
      const cur = endNow || len;
      const next = Math.min(len, Math.max(count, cur + bars));
      if (next >= len) {
        setFollowLive(true);
        followRef.current = true;
      }
      return next;
    });
  };

  const resetView = () => {
    const len = series.length;
    userZoomedRef.current = false;
    const count = barsForPlotWidth(fitPlotW, len);
    setViewCount(count);
    setViewEnd(len);
    setFollowLive(true);
    followRef.current = true;
  };

  const pointerToPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const local = localIndexAtX(x);
    const global = start + local;
    return { x, y, local, global, t: timeAtGlobal(global), price: priceAtY(y) };
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const anchor = localIndexAtX(x);
    if (event.shiftKey) {
      panBy(event.deltaY > 0 ? 6 : -6);
      return;
    }
    // Two-finger trackpad horizontal swipe pans (common on Mac).
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      panBy(event.deltaX > 0 ? 4 : -4);
      return;
    }
    zoomBy(event.deltaY > 0 ? 1.12 : 0.9, anchor);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const pt = pointerToPoint(event);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    const wantPan = tool === "pan" || tool === "cursor" || event.button === 1 || event.shiftKey;
    if (wantPan) {
      panningRef.current = true;
      setGrabbing(true);
      setFollowLive(false);
      followRef.current = false;
      dragRef.current = {
        mode: "pan",
        lastClientX: event.clientX,
        accPx: 0,
        pointerId: event.pointerId,
      };
      return;
    }
    if (tool === "erase") return;
    if (tool === "hline") {
      setDrawings((prev) => [...prev, { id: newDrawingId(), kind: "hline", price: pt.price }]);
      return;
    }
    dragRef.current = {
      mode: "draw",
      lastClientX: event.clientX,
      accPx: 0,
      pointerId: event.pointerId,
    };
    setDraft({ kind: tool, t0: pt.t, p0: pt.price, t1: pt.t, p1: pt.price });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pt = pointerToPoint(event);
    setHover({ index: pt.global, x: pt.x, y: pt.y });

    const drag = dragRef.current;
    if (!drag) {
      if (draft) setDraft({ ...draft, t1: pt.t, p1: pt.price });
      return;
    }

    if (drag.mode === "pan") {
      const dx = event.clientX - drag.lastClientX;
      drag.lastClientX = event.clientX;
      drag.accPx += dx;
      // Drag right → older bars (history). Pixel-smooth, not stuck to bar width.
      const stepPx = Math.max(6, barW * 0.35);
      if (Math.abs(drag.accPx) >= stepPx) {
        const steps = Math.trunc(drag.accPx / stepPx);
        drag.accPx -= steps * stepPx;
        panBy(-steps);
      }
      return;
    }

    if (draft) setDraft({ ...draft, t1: pt.t, p1: pt.price });
  };

  const onPointerUp = (event?: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (event && drag && event.currentTarget.hasPointerCapture?.(drag.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      } catch {
        // ignore
      }
    }
    dragRef.current = null;
    panningRef.current = false;
    setGrabbing(false);
    if (!draft) return;
    if (drag?.mode === "draw") {
      setDrawings((prev) => [
        ...prev,
        draft.kind === "fib" || draft.kind === "trend" || draft.kind === "ray"
          ? { id: newDrawingId(), kind: draft.kind, t0: draft.t0, p0: draft.p0, t1: draft.t1, p1: draft.p1 }
          : { id: newDrawingId(), kind: "hline", price: draft.p0 },
      ]);
    }
    setDraft(null);
  };

  const onDrawingClick = (id: string) => {
    if (tool !== "erase") return;
    setDrawings((prev) => prev.filter((d) => d.id !== id));
  };

  const hoverCandle = hover && hover.index >= 0 && hover.index < series.length ? series[hover.index] : null;
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 6; i += 1) ticks.push(priceExtent.max - (span * i) / 6);
    return ticks;
  }, [priceExtent.max, span]);

  const linePath = useMemo(() => {
    if (!visible.length) return "";
    return visible
      .map((c, i) => `${i === 0 ? "M" : "L"}${xAtLocal(i).toFixed(1)},${yAt(c.c).toFixed(1)}`)
      .join(" ");
  }, [visible, width, height, priceExtent, pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaPath = useMemo(() => {
    if (!visible.length || !linePath) return "";
    const lastX = xAtLocal(visible.length - 1);
    const firstX = xAtLocal(0);
    const base = yAt(priceExtent.min);
    return `${linePath} L${lastX},${base} L${firstX},${base} Z`;
  }, [linePath, visible.length, priceExtent.min, pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderDrawing = (d: ChartDrawing | (typeof draft & { id?: string }), key: string, ghost = false) => {
    if (!d) return null;
    const stroke = ghost ? "#fbbf24" : "#38bdf8";
    const opacity = ghost ? 0.85 : 1;
    if (d.kind === "hline") {
      const price = "price" in d ? d.price : d.p0;
      const y = yAt(price);
      return (
        <g
          key={key}
          opacity={opacity}
          onClick={() => d.id && onDrawingClick(d.id)}
          style={{ cursor: tool === "erase" ? "pointer" : "default" }}
        >
          <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={stroke} strokeWidth={1.25} strokeDasharray="5 4" />
          <text x={width - pad.right + 6} y={y + 4} fill={stroke} fontSize={10}>
            {formatPrice(price, quote.assetClass)}
          </text>
        </g>
      );
    }
    const i0 = localIndexAtTime(d.t0);
    const i1 = localIndexAtTime(d.t1);
    const x0 = xAtLocal(i0);
    const x1 = xAtLocal(i1);
    const y0 = yAt(d.p0);
    const y1 = yAt(d.p1);
    if (d.kind === "trend" || d.kind === "ray") {
      let xEnd = x1;
      let yEnd = y1;
      if (d.kind === "ray" && Math.abs(x1 - x0) > 0.5) {
        xEnd = width - pad.right;
        const slope = (y1 - y0) / (x1 - x0);
        yEnd = y0 + slope * (xEnd - x0);
      }
      return (
        <g
          key={key}
          opacity={opacity}
          onClick={() => d.id && onDrawingClick(d.id)}
          style={{ cursor: tool === "erase" ? "pointer" : "default" }}
        >
          <line x1={x0} y1={y0} x2={xEnd} y2={yEnd} stroke={stroke} strokeWidth={1.5} />
          <circle cx={x0} cy={y0} r={3} fill={stroke} />
          <circle cx={x1} cy={y1} r={3} fill={stroke} />
        </g>
      );
    }
    const lo = Math.min(d.p0, d.p1);
    const hi = Math.max(d.p0, d.p1);
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1, left + 80);
    return (
      <g
        key={key}
        opacity={opacity}
        onClick={() => d.id && onDrawingClick(d.id)}
        style={{ cursor: tool === "erase" ? "pointer" : "default" }}
      >
        {FIB_LEVELS.map((level) => {
          const price = hi - (hi - lo) * level;
          const y = yAt(price);
          return (
            <g key={`${key}-${level}`}>
              <line
                x1={left}
                x2={right}
                y1={y}
                y2={y}
                stroke="#a78bfa"
                strokeWidth={1}
                strokeDasharray={level === 0 || level === 1 ? undefined : "4 3"}
              />
              <text x={right + 4} y={y + 3} fill="#c4b5fd" fontSize={9}>
                {(level * 100).toFixed(1)}% · {formatPrice(price, quote.assetClass)}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  const liveTipX = visible.length ? xAtLocal(visible.length - 1) : 0;
  const liveTipY = yAt(quote.last);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="st-mkt-fullchart"
      role="dialog"
      aria-modal="true"
      aria-label={t("studioMktFullChart")}
      dir={ar ? "rtl" : "ltr"}
    >
      <header className="st-mkt-fullchart-top">
        <div className="st-mkt-fullchart-title">
          <strong>
            {displaySymbol(quote.symbol)} · {ar ? quote.nameAr : quote.name}
          </strong>
          <span className={cn("st-mkt-fullchart-last", up ? "is-up" : "is-down")} key={pulse}>
            {formatPrice(quote.last, quote.assetClass)} {quote.currency}
            <em>{formatPct(pct)}</em>
          </span>
          <span className={cn("st-mkt-session-pill", ownSession.open ? "is-open" : "is-closed")}>
            {ownSession.open ? t("studioMktSessionOpen") : t("studioMktSessionClosed")}
            <small>{ar ? ownSession.nextHintAr : ownSession.nextHint}</small>
          </span>
          {liveOk ? <span className="st-mkt-live-pill is-live">{t("studioMktLiveFeed")}</span> : null}
        </div>
        <button type="button" className="st-mkt-fullchart-close" onClick={onClose} aria-label={t("studioMktCloseChart")}>
          <X size={16} />
        </button>
      </header>

      <div className="st-mkt-session-board" aria-label={t("studioMktSessions")}>
        {sessions.map((session) => (
          <div key={session.id} className={cn("st-mkt-session-card", session.open ? "is-open" : "is-closed")}>
            <strong>{ar ? session.labelAr : session.label}</strong>
            <span className="st-mkt-session-state">
              {session.open ? t("studioMktSessionOpen") : t("studioMktSessionClosed")}
            </span>
            <small>{ar ? session.hoursAr : session.hours}</small>
          </div>
        ))}
      </div>

      <div className="st-mkt-fullchart-toolbar">
        <div className="st-mkt-tool-group" role="group" aria-label={t("studioMktChartType")}>
          {(
            [
              ["candle", CandlestickChart, t("studioMktTypeCandle")],
              ["hollow", CandlestickChart, t("studioMktTypeHollow")],
              ["bar", BarChart2, t("studioMktTypeBar")],
              ["line", TrendingUp, t("studioMktTypeLine")],
              ["area", AreaChart, t("studioMktTypeArea")],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} type="button" className={cn(plot === id && "is-on")} onClick={() => setPlot(id)} title={label}>
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="st-mkt-tool-group" role="group" aria-label={t("studioMktInterval")}>
          {CHART_INTERVALS.map((row) => (
            <button
              key={row.key}
              type="button"
              className={cn(interval === row.key && "is-on")}
              onClick={() => onIntervalChange(row.key)}
            >
              {row.label}
            </button>
          ))}
        </div>

        <div className="st-mkt-tool-group" role="group" aria-label={t("studioMktNavTools")}>
          <button type="button" className={cn(tool === "pan" && "is-on")} onClick={() => setTool("pan")} title={t("studioMktToolPan")}>
            <Hand size={14} />
            <span>{t("studioMktToolPan")}</span>
          </button>
          <button type="button" onClick={() => zoomBy(0.85)} title={t("studioMktZoomIn")}>
            <ZoomIn size={14} />
            <span>{t("studioMktZoomIn")}</span>
          </button>
          <button type="button" onClick={() => zoomBy(1.18)} title={t("studioMktZoomOut")}>
            <ZoomOut size={14} />
            <span>{t("studioMktZoomOut")}</span>
          </button>
          <button type="button" onClick={() => panBy(12)} title={t("studioMktPanLeft")}>
            <Minus size={14} />
          </button>
          <button type="button" onClick={() => panBy(-12)} title={t("studioMktPanRight")}>
            <Plus size={14} />
          </button>
          <button type="button" className={cn(followLive && "is-on")} onClick={resetView} title={t("studioMktResetView")}>
            <RotateCcw size={14} />
            <span>{followLive ? t("studioMktFollowLive") : t("studioMktResetView")}</span>
          </button>
        </div>

        <div className="st-mkt-tool-group" role="group" aria-label={t("studioMktDrawTools")}>
          {(
            [
              ["cursor", Crosshair, t("studioMktToolCursor")],
              ["hline", Minus, t("studioMktToolHLine")],
              ["trend", MoveDiagonal, t("studioMktToolTrend")],
              ["ray", Spline, t("studioMktToolRay")],
              ["fib", TrendingUp, t("studioMktToolFib")],
              ["erase", Eraser, t("studioMktToolErase")],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} type="button" className={cn(tool === id && "is-on")} onClick={() => setTool(id)} title={label}>
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setDrawings([]);
              setDraft(null);
            }}
            title={t("studioMktClearDrawings")}
          >
            <Trash2 size={14} />
            <span>{t("studioMktClearDrawings")}</span>
          </button>
        </div>
      </div>

      <div className="st-mkt-fullchart-ohic">
        <span>
          {t("studioMktOpen")} <strong>{formatPrice(quote.open, quote.assetClass)}</strong>
        </span>
        <span>
          {t("studioMktHigh")} <strong>{formatPrice(quote.high, quote.assetClass)}</strong>
        </span>
        <span>
          {t("studioMktLow")} <strong>{formatPrice(quote.low, quote.assetClass)}</strong>
        </span>
        <span>
          {t("studioMktPrevClose")} <strong>{formatPrice(quote.prevClose, quote.assetClass)}</strong>
        </span>
        {hoverCandle ? (
          <span className="st-mkt-fullchart-hover">
            O {formatPrice(hoverCandle.o, quote.assetClass)} · H {formatPrice(hoverCandle.h, quote.assetClass)} · L{" "}
            {formatPrice(hoverCandle.l, quote.assetClass)} · C {formatPrice(hoverCandle.c, quote.assetClass)}
          </span>
        ) : null}
      </div>

      <div className="st-mkt-fullchart-stage" ref={stageRef}>
        <svg
          className="st-mkt-fullchart-svg"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => onPointerUp(event)}
          onPointerCancel={(event) => onPointerUp(event)}
          onPointerLeave={(event) => {
            if (!dragRef.current) setHover(null);
            else onPointerUp(event);
          }}
          style={{
            cursor:
              grabbing || tool === "pan"
                ? grabbing
                  ? "grabbing"
                  : "grab"
                : tool === "cursor"
                  ? "crosshair"
                  : tool === "erase"
                    ? "pointer"
                    : tool === "hline"
                      ? "ns-resize"
                      : "crosshair",
          }}
        >
          <rect x={0} y={0} width={width} height={height} fill="#0b1220" />
          {yTicks.map((price) => {
            const y = yAt(price);
            return (
              <g key={price}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#1e293b" strokeWidth={1} />
                <text x={width - pad.right + 6} y={y + 3} fill="#64748b" fontSize={10}>
                  {formatPrice(price, quote.assetClass)}
                </text>
              </g>
            );
          })}

          {plot === "area" ? <path d={areaPath} fill="rgba(56,189,248,0.16)" stroke="none" /> : null}
          {plot === "line" || plot === "area" ? <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={1.75} /> : null}

          {(plot === "candle" || plot === "hollow" || plot === "bar") &&
            visible.map((candle, index) => {
              const x = xAtLocal(index);
              const yHigh = yAt(candle.h);
              const yLow = yAt(candle.l);
              const yOpen = yAt(candle.o);
              const yClose = yAt(candle.c);
              const bull = candle.c >= candle.o;
              const color = bull ? "#34d399" : "#f87171";
              const isTip = index === visible.length - 1;
              if (plot === "bar") {
                return (
                  <g key={`${candle.t}-${index}`} opacity={isTip ? 1 : 0.95}>
                    <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={isTip ? 1.6 : 1.2} />
                    <line x1={x - Math.max(barW * 0.28, 2)} x2={x} y1={yOpen} y2={yOpen} stroke={color} strokeWidth={1.4} />
                    <line x1={x} x2={x + Math.max(barW * 0.28, 2)} y1={yClose} y2={yClose} stroke={color} strokeWidth={1.4} />
                  </g>
                );
              }
              const bodyTop = Math.min(yOpen, yClose);
              const bodyH = Math.max(Math.abs(yClose - yOpen), 1.4);
              const hollow = plot === "hollow";
              return (
                <g key={`${candle.t}-${index}`}>
                  <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
                  <rect
                    x={x - Math.max(barW * 0.3, 1.6)}
                    y={bodyTop}
                    width={Math.max(barW * 0.6, 2.2)}
                    height={bodyH}
                    fill={hollow && bull ? "transparent" : color}
                    stroke={color}
                    strokeWidth={hollow ? 1.2 : 0}
                  />
                </g>
              );
            })}

          <g key={`live-${pulse}`}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={liveTipY}
              y2={liveTipY}
              stroke={up ? "#34d399" : "#f87171"}
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.7}
            />
            {visible.length ? (
              <circle cx={liveTipX} cy={liveTipY} r={3.5} fill={up ? "#34d399" : "#f87171"}>
                <animate attributeName="r" values="3;5;3" dur="1.2s" repeatCount="indefinite" />
              </circle>
            ) : null}
            <text x={width - pad.right + 6} y={liveTipY + 3} fill={up ? "#34d399" : "#f87171"} fontSize={10} fontWeight={700}>
              {formatPrice(quote.last, quote.assetClass)}
            </text>
          </g>

          {drawings.map((d) => renderDrawing(d, d.id))}
          {draft ? renderDrawing(draft, "draft", true) : null}

          {hover ? (
            <g pointerEvents="none">
              <line x1={hover.x} x2={hover.x} y1={pad.top} y2={height - pad.bottom} stroke="#475569" strokeDasharray="3 3" />
              <line x1={pad.left} x2={width - pad.right} y1={hover.y} y2={hover.y} stroke="#475569" strokeDasharray="3 3" />
            </g>
          ) : null}
        </svg>
      </div>

      <footer className="st-mkt-fullchart-foot">
        <span>{t("studioMktChartNavHint")}</span>
        <span>
          {visible.length}/{series.length} {t("studioMktBars")} · {interval.toUpperCase()}
          {followLive ? ` · ${t("studioMktFollowLive")}` : ""}
        </span>
      </footer>
    </div>,
    document.body,
  );
}

export function OpenFullChartButton({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button type="button" className="st-mkt-open-fullchart" onClick={onClick}>
      <Maximize2 size={13} />
      {t("studioMktOpenFullChart")}
    </button>
  );
}
