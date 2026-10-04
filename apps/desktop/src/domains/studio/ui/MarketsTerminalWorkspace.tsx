import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  Activity,
  CalendarDays,
  Gauge,
  LineChart,
  Newspaper,
  Plus,
  Radar,
  Search,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useLanguage } from "@/shared/i18n/LanguageProvider";
import { PhotoAvatar } from "@/domains/companions/ui/CompanionFace";
import { useCompanionRoom } from "@/domains/companions/ui/hooks/useCompanionRoom";
import { companionPortraitUrl } from "@/domains/companions/catalog/portrait";
import type { CompanionProfile, StudioCatalogEntry } from "@/domains/companions/model/companions";
import { MarketsFullChart, OpenFullChartButton } from "@/domains/studio/ui/MarketsFullChart";
import { arrabApi } from "@/core/api/api";
import {
  CHART_INTERVALS,
  DESK_TICK_MS,
  LIVE_QUOTE_POLL_MS,
  MARKET_CALENDAR,
  MARKET_NEWS,
  MARKET_UNIVERSE,
  applyLiveQuotes,
  buildAdvancedAnalysisPrompt,
  buildCandleSeries,
  buildHeatmap,
  buildScreener,
  buildTechSnapshot,
  changePct,
  displaySymbol,
  fetchLiveQuoteChunks,
  formatCompact,
  formatPct,
  formatPrice,
  hydrateQuote,
  listVenueInstruments,
  mergeLiveBook,
  resolveInstrument,
  searchMarketUniverse,
  seedMarketQuotes,
  sessionForQuote,
  tickMarketQuotes,
  withLiveInstrument,
  type ChartIntervalKey,
  type LiveQuotePatch,
  type MarketCandle,
  type MarketQuote,
  type MarketVenueFilter,
} from "@/domains/studio/studio-markets";
import { cn } from "@/shared/lib/utils";

type DeskTab = "news" | "fundamentals" | "screener" | "calendar" | "heatmap" | "levels";

const VENUES: MarketVenueFilter[] = ["all", "nasdaq", "nyse", "tasi", "crypto", "fx", "index"];

function StudioPortrait({
  entry,
  size,
}: {
  entry: Pick<StudioCatalogEntry, "name" | "hue" | "faceSeed" | "avatarPhoto" | "domain">;
  size: number;
}) {
  const faceSize = size >= 64 ? "xl" : size >= 48 ? "lg" : "md";
  const src =
    entry.avatarPhoto?.trim() ||
    companionPortraitUrl({
      seed: entry.faceSeed,
      name: entry.name,
      domain: entry.domain,
      size: size >= 64 ? 320 : 256,
    });
  return (
    <PhotoAvatar
      src={src}
      name={entry.name}
      size={faceSize}
      fallbackHue={entry.hue}
      fallbackSeed={entry.faceSeed}
    />
  );
}

function CandleChart({ quote, candles: liveCandles }: { quote: MarketQuote; candles?: MarketCandle[] | null }) {
  const synthetic = useMemo(() => buildCandleSeries(quote), [quote]);
  const candles = liveCandles && liveCandles.length > 8 ? liveCandles : synthetic;
  const width = 640;
  const height = 220;
  const pad = 12;
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = Math.max(max - min, 0.0001);
  const barW = (width - pad * 2) / Math.max(candles.length, 1);

  return (
    <svg className="st-mkt-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={quote.symbol}>
      {candles.map((candle, index) => {
        const x = pad + index * barW + barW / 2;
        const yHigh = pad + ((max - candle.h) / span) * (height - pad * 2);
        const yLow = pad + ((max - candle.l) / span) * (height - pad * 2);
        const yOpen = pad + ((max - candle.o) / span) * (height - pad * 2);
        const yClose = pad + ((max - candle.c) / span) * (height - pad * 2);
        const up = candle.c >= candle.o;
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(Math.abs(yClose - yOpen), 1.5);
        return (
          <g key={`${candle.t}-${index}`}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={up ? "#34d399" : "#f87171"} strokeWidth={1} />
            <rect
              x={x - Math.max(barW * 0.28, 1.5)}
              y={bodyTop}
              width={Math.max(barW * 0.56, 2)}
              height={bodyH}
              fill={up ? "#34d399" : "#f87171"}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function MarketsTerminalWorkspace({
  companion,
  kind,
}: {
  companion: CompanionProfile;
  kind: StudioCatalogEntry;
}) {
  const { t, locale } = useLanguage();
  const ar = locale === "ar";
  const room = useCompanionRoom(companion);
  const [quotes, setQuotes] = useState<MarketQuote[]>(() => seedMarketQuotes());
  const [symbol, setSymbol] = useState("2222");
  const [tab, setTab] = useState<DeskTab>("levels");
  const [venue, setVenue] = useState<MarketVenueFilter>("all");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);
  const [liveOk, setLiveOk] = useState(false);
  const [liveCandles, setLiveCandles] = useState<MarketCandle[] | null>(null);
  const [liveBook, setLiveBook] = useState<Map<string, LiveQuotePatch>>(() => new Map());
  const [chartOpen, setChartOpen] = useState(false);
  const [chartInterval, setChartInterval] = useState<ChartIntervalKey>("15m");
  const [clock, setClock] = useState(() => new Date());
  const chatEnd = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const liveOkRef = useRef(false);

  const active = quotes.find((q) => q.symbol === symbol) ?? quotes[0]!;
  const pct = changePct(active);
  const up = pct >= 0;
  const activeSession = useMemo(() => sessionForQuote(active, clock), [active, clock]);
  const tech = useMemo(() => buildTechSnapshot(active), [active]);
  const tape = useMemo(() => [...quotes, ...quotes], [quotes]);
  const screener = useMemo(() => buildScreener(quotes), [quotes]);
  const heat = useMemo(() => buildHeatmap(quotes), [quotes]);
  const results = useMemo(
    () =>
      searchMarketUniverse(search, venue === "all" ? "all" : venue, 28).map((item) =>
        withLiveInstrument(item, liveBook),
      ),
    [search, venue, liveBook],
  );
  const venueList = useMemo(
    () =>
      listVenueInstruments(venue === "all" ? "nasdaq" : venue).map((item) =>
        withLiveInstrument(item, liveBook),
      ),
    [venue, liveBook],
  );
  const news = useMemo(
    () =>
      MARKET_NEWS.filter((item) => item.symbol === active.symbol).concat(
        MARKET_NEWS.filter((item) => item.symbol !== active.symbol),
      ),
    [active.symbol],
  );

  const ingestLive = (items: LiveQuotePatch[]) => {
    if (!items.length) return;
    setLiveBook((prev) => mergeLiveBook(prev, items));
    setQuotes((prev) => applyLiveQuotes(prev, items));
    setLiveOk(true);
  };

  useEffect(() => {
    // Once we have any live print, never unlock last-price jitter (keeps list = feed / Google).
    liveOkRef.current = liveOk || liveBook.size > 0;
  }, [liveOk, liveBook]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setQuotes((prev) => tickMarketQuotes(prev, liveOkRef.current));
      setClock(new Date());
    }, DESK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const watchSymbolsKey = quotes.map((q) => q.symbol).join("|");

  useEffect(() => {
    let cancelled = false;
    const symbols = watchSymbolsKey.split("|").filter(Boolean);
    const pull = async () => {
      if (!symbols.length) return;
      const started = performance.now();
      try {
        const items = await fetchLiveQuoteChunks(symbols, (chunk) => arrabApi.marketsQuotes(chunk));
        if (cancelled) return;
        setLatencyMs(Math.max(12, Math.round(performance.now() - started)));
        if (items.length) ingestLive(items);
      } catch {
        // Keep last live book — do not unlock fake jitter on transient errors.
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), LIVE_QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [watchSymbolsKey]);

  // Prefetch real prices for the whole catalog so venue / search lists are live.
  useEffect(() => {
    let cancelled = false;
    const warm = async () => {
      const symbols = MARKET_UNIVERSE.map((item) => item.symbol);
      const items = await fetchLiveQuoteChunks(symbols, (chunk) => arrabApi.marketsQuotes(chunk));
      if (cancelled || !items.length) return;
      ingestLive(items);
    };
    void warm();
    const id = window.setInterval(() => void warm(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // When a venue list opens, refresh that venue’s symbols immediately.
  useEffect(() => {
    if (!browseOpen || venue === "all") return;
    let cancelled = false;
    const refresh = async () => {
      const symbols = listVenueInstruments(venue).map((item) => item.symbol);
      const items = await fetchLiveQuoteChunks(symbols, (chunk) => arrabApi.marketsQuotes(chunk));
      if (cancelled || !items.length) return;
      ingestLive(items);
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [browseOpen, venue]);

  useEffect(() => {
    let cancelled = false;
    const spec = CHART_INTERVALS.find((row) => row.key === chartInterval) ?? CHART_INTERVALS[1]!;
    const load = async () => {
      try {
        const res = await arrabApi.marketsCandles(symbol, { range: spec.range, interval: spec.interval });
        if (cancelled) return;
        if (res.candles.length) setLiveCandles(res.candles);
        if (res.quote) {
          ingestLive([res.quote]);
        }
      } catch {
        // keep previous candles on transient errors
      }
    };
    void load();
    // While full chart is open, refresh bars so the tip keeps moving with live prints.
    const id = window.setInterval(() => void load(), chartOpen ? 8_000 : 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, chartInterval, chartOpen]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.lines.length, room.busy]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? room.draft).trim();
    if (!text || room.busy) return;
    if (override) room.setDraft("");
    await room.send(text);
  };

  const selectInstrument = (raw: string, analyze = false) => {
    const instrument = resolveInstrument(raw);
    const live = liveBook.get(instrument.symbol.toUpperCase());
    const base = hydrateQuote(instrument);
    const seeded = live ? applyLiveQuotes([base], [live])[0]! : base;
    setQuotes((prev) => {
      if (prev.some((q) => q.symbol === instrument.symbol)) {
        return live ? applyLiveQuotes(prev, [live]) : prev;
      }
      return [seeded, ...prev];
    });
    setSymbol(instrument.symbol);
    setSearch(instrument.symbol);
    setSearchOpen(false);
    setBrowseOpen(false);
    void fetchLiveQuoteChunks([instrument.symbol], (chunk) => arrabApi.marketsQuotes(chunk)).then((items) => {
      ingestLive(items);
    });
    if (analyze) {
      void send(undefined, buildAdvancedAnalysisPrompt(seeded, ar));
    }
  };

  const analyzeActive = (mode: "quick" | "advanced" = "advanced") => {
    if (mode === "quick") {
      const prompt = ar
        ? `حلّل ${displaySymbol(active.symbol)} الآن: سعر حي، محفزات، انحياز مع إبطال ومخاطر.`
        : `Analyze ${displaySymbol(active.symbol)} now: live quote, catalysts, bias with invalidation and risk.`;
      void send(undefined, prompt);
      return;
    }
    void send(undefined, buildAdvancedAnalysisPrompt(active, ar));
  };

  const openVenue = (id: MarketVenueFilter) => {
    setVenue(id);
    if (id === "all") {
      setBrowseOpen(false);
      setSearchOpen(true);
      return;
    }
    setBrowseOpen(true);
    setSearchOpen(false);
  };

  const removeFromWatch = (sym: string) => {
    setQuotes((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((q) => q.symbol !== sym);
      if (symbol === sym) setSymbol(next[0]!.symbol);
      return next;
    });
  };

  const venueLabel = (id: MarketVenueFilter) => {
    switch (id) {
      case "all":
        return t("studioMktVenueAll");
      case "nasdaq":
        return "NASDAQ";
      case "nyse":
        return "NYSE";
      case "tasi":
        return "TASI";
      case "crypto":
        return t("studioMktVenueCrypto");
      case "fx":
        return t("studioMktVenueFx");
      case "index":
        return t("studioMktVenueIndex");
    }
  };

  const suggestions = ar
    ? [
        `تحليل متقدم لـ ${displaySymbol(active.symbol)}`,
        "قارن NVDA مع AMD و AVGO",
        "مسح تاسي: 2222 و 1120 و 7010",
        "تحليل BTC و ETH النسبي",
      ]
    : [
        `Advanced analysis on ${displaySymbol(active.symbol)}`,
        "Compare NVDA vs AMD vs AVGO",
        "TASI scan: 2222, 1120, 7010",
        "BTC vs ETH relative strength",
      ];

  return (
    <div className="st-mkt" dir={ar ? "rtl" : "ltr"}>
      <div className="st-mkt-tape" aria-hidden>
        <div className="st-mkt-tape-track">
          {tape.map((quote, index) => {
            const delta = changePct(quote);
            return (
              <span key={`${quote.symbol}-${index}`} className={cn("st-mkt-tape-item", delta >= 0 ? "is-up" : "is-down")}>
                <strong>{displaySymbol(quote.symbol)}</strong>
                {formatPrice(quote.last, quote.assetClass)}
                <em>{formatPct(delta)}</em>
              </span>
            );
          })}
        </div>
      </div>

      <div className="st-mkt-searchbar" ref={searchRef}>
        <div className="st-mkt-venues">
          {VENUES.map((id) => (
            <button
              key={id}
              type="button"
              className={cn(venue === id && "is-on")}
              onClick={() => openVenue(id)}
            >
              {venueLabel(id)}
            </button>
          ))}
        </div>
        <form
          className="st-mkt-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (!search.trim()) return;
            selectInstrument(search.trim(), true);
          }}
        >
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSearchOpen(true);
              setBrowseOpen(false);
            }}
            onFocus={() => {
              setSearchOpen(true);
              setBrowseOpen(false);
            }}
            placeholder={t("studioMktSearchPlaceholder")}
            aria-label={t("studioMktSearch")}
          />
          <button type="submit" className="st-mkt-search-go">
            <Plus size={14} />
            {t("studioMktAddAnalyze")}
          </button>
        </form>
        {browseOpen && venue !== "all" ? (
          <div className="st-mkt-venue-panel">
            <header>
              <strong>
                {venueLabel(venue)} · {t("studioMktVenueList")}
              </strong>
              <span>
                {venueList.length} {t("studioMktSymbols")}
              </span>
              <button type="button" className="st-mkt-venue-close" onClick={() => setBrowseOpen(false)} aria-label={t("close")}>
                <X size={14} />
              </button>
            </header>
            <div className="st-mkt-venue-grid">
              {venueList.map((item) => {
                const isLive = liveBook.has(item.symbol.toUpperCase());
                return (
                <div key={item.symbol} className="st-mkt-venue-row">
                  <button type="button" className="st-mkt-venue-pick" onClick={() => selectInstrument(item.symbol)}>
                    <strong>
                      {displaySymbol(item.symbol)}
                      {isLive ? <i className="st-mkt-live-dot" /> : null}
                    </strong>
                    <span>{ar ? item.nameAr : item.name}</span>
                    <em className={isLive ? "is-live-px" : undefined}>{formatPrice(item.last, item.assetClass)}</em>
                  </button>
                  <button
                    type="button"
                    className="st-mkt-venue-analyze"
                    onClick={() => selectInstrument(item.symbol, true)}
                  >
                    <Zap size={11} />
                    {t("studioMktAnalyzeAdvanced")}
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {searchOpen && !browseOpen ? (
          <div className="st-mkt-search-results">
            {results.length === 0 ? (
              <button type="button" onClick={() => selectInstrument(search || "AAPL", true)}>
                <strong>{(search || "—").toUpperCase()}</strong>
                <span>{t("studioMktAddCustom")}</span>
              </button>
            ) : (
              results.map((item) => {
                const isLive = liveBook.has(item.symbol.toUpperCase());
                return (
                <button key={item.symbol} type="button" onClick={() => selectInstrument(item.symbol)}>
                  <strong>
                    {displaySymbol(item.symbol)}
                    {isLive ? <i className="st-mkt-live-dot" /> : null}
                  </strong>
                  <span>
                    {ar ? item.nameAr : item.name} · {item.exchange}
                  </span>
                  <em className={isLive ? "is-live-px" : undefined}>{formatPrice(item.last, item.assetClass)}</em>
                </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <div className="st-mkt-shell">
        <aside className="st-mkt-watch">
          <header>
            <span>{t("studioMktWatchlist")}</span>
            <small>{clock.toLocaleTimeString(ar ? "ar-SA" : "en-US", { hour12: false })}</small>
          </header>
          <ul>
            {quotes.map((quote) => {
              const delta = changePct(quote);
              const isLive = liveBook.has(quote.symbol.toUpperCase());
              return (
                <li key={quote.symbol}>
                  <button
                    type="button"
                    className={cn(quote.symbol === active.symbol && "is-on")}
                    onClick={() => setSymbol(quote.symbol)}
                  >
                    <span className="st-mkt-sym">
                      <strong>
                        {displaySymbol(quote.symbol)}
                        {isLive ? <i className="st-mkt-live-dot" title={t("studioMktLiveFeed")} /> : null}
                      </strong>
                      <em>
                        {quote.exchange} · {ar ? quote.nameAr : quote.name}
                      </em>
                    </span>
                    <span className="st-mkt-px">
                      <strong>{formatPrice(quote.last, quote.assetClass)}</strong>
                      <em className={delta >= 0 ? "is-up" : "is-down"}>{formatPct(delta)}</em>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="st-mkt-watch-del"
                    onClick={() => removeFromWatch(quote.symbol)}
                    aria-label={t("studioMktRemove")}
                    title={t("studioMktRemove")}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="st-mkt-main">
          <div className="st-mkt-quote">
            <div className="st-mkt-quote-lead">
              <div>
                <p className="st-mkt-eyebrow">
                  {active.exchange} · {active.currency} · {ar ? active.sectorAr : active.sector}
                </p>
                <h2>
                  {displaySymbol(active.symbol)}
                  <span>{ar ? active.nameAr : active.name}</span>
                </h2>
              </div>
              <div className={cn("st-mkt-last", up ? "is-up" : "is-down")}>
                <strong>{formatPrice(active.last, active.assetClass)}</strong>
                <span>
                  {up ? "+" : ""}
                  {formatPrice(active.last - active.prevClose, active.assetClass)} ({formatPct(pct)})
                </span>
              </div>
            </div>
            <div className="st-mkt-stats">
              <div>
                <span>{t("studioMktOpen")}</span>
                <strong>{formatPrice(active.open, active.assetClass)}</strong>
              </div>
              <div>
                <span>{t("studioMktHigh")}</span>
                <strong>{formatPrice(active.high, active.assetClass)}</strong>
              </div>
              <div>
                <span>{t("studioMktLow")}</span>
                <strong>{formatPrice(active.low, active.assetClass)}</strong>
              </div>
              <div>
                <span>{t("studioMktBidAsk")}</span>
                <strong>
                  {formatPrice(active.bid, active.assetClass)} / {formatPrice(active.ask, active.assetClass)}
                </strong>
              </div>
              <div>
                <span>{t("studioMktVolume")}</span>
                <strong>{formatCompact(active.volume, 1)}</strong>
              </div>
              <div>
                <span>{t("studioMktMktCap")}</span>
                <strong>{formatCompact(active.marketCap)}</strong>
              </div>
            </div>
            <div className="st-mkt-feed-badge">
              <Gauge size={12} />
              <span className={cn("st-mkt-live-pill", liveOk && "is-live")}>
                {liveOk ? t("studioMktLiveFeed") : t("studioMktLiveDesk")}
              </span>
              <span className={cn("st-mkt-session-pill", activeSession.open ? "is-open" : "is-closed")}>
                {activeSession.open ? t("studioMktSessionOpen") : t("studioMktSessionClosed")}
              </span>
              <span className="st-mkt-latency">
                {latencyMs > 0
                  ? `${latencyMs}ms · ${liveOk ? t("studioMktYahooLive") : t("studioMktUltraLow")}`
                  : t("studioMktConnecting")}
              </span>
              <OpenFullChartButton onClick={() => setChartOpen(true)} />
              <button type="button" className="st-mkt-analyze is-quiet" onClick={() => analyzeActive("quick")}>
                <Radar size={13} />
                {t("studioMktAnalyze")}
              </button>
              <button type="button" className="st-mkt-analyze" onClick={() => analyzeActive("advanced")}>
                <Zap size={13} />
                {t("studioMktAnalyzeAdvanced")}
              </button>
            </div>
          </div>

          <div className="st-mkt-chart">
            <header>
              <LineChart size={14} />
              <strong>{t("studioMktChart")}</strong>
              <span>
                {chartInterval} · {displaySymbol(active.symbol)}
                {liveCandles?.length ? ` · ${t("studioMktLiveBars")}` : ""}
              </span>
              <OpenFullChartButton onClick={() => setChartOpen(true)} />
            </header>
            <button type="button" className="st-mkt-chart-hit" onClick={() => setChartOpen(true)} aria-label={t("studioMktOpenFullChart")}>
              <CandleChart quote={active} candles={liveCandles} />
            </button>
          </div>

          <div className="st-mkt-panels">
            <div className="st-mkt-tabs">
              {(
                [
                  ["levels", t("studioMktLevels"), Zap],
                  ["news", t("studioMktNews"), Newspaper],
                  ["fundamentals", t("studioMktFundamentals"), Activity],
                  ["screener", t("studioMktScreener"), Radar],
                  ["calendar", t("studioMktCalendar"), CalendarDays],
                  ["heatmap", t("studioMktHeatmap"), LineChart],
                ] as const
              ).map(([id, label, Icon]) => (
                <button key={id} type="button" className={cn(tab === id && "is-on")} onClick={() => setTab(id)}>
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>

            <div className="st-mkt-panel-body">
              {tab === "levels" ? (
                <div className="st-mkt-levels">
                  <div className="st-mkt-fund-grid">
                    <div>
                      <span>{t("studioMktPivot")}</span>
                      <strong>{formatPrice(tech.pivot, active.assetClass)}</strong>
                    </div>
                    <div>
                      <span>{t("studioMktSupport")}</span>
                      <strong>
                        {formatPrice(tech.support1, active.assetClass)} / {formatPrice(tech.support2, active.assetClass)}
                      </strong>
                    </div>
                    <div>
                      <span>{t("studioMktResistance")}</span>
                      <strong>
                        {formatPrice(tech.resistance1, active.assetClass)} /{" "}
                        {formatPrice(tech.resistance2, active.assetClass)}
                      </strong>
                    </div>
                    <div>
                      <span>{t("studioMktMomentum")}</span>
                      <strong className={cn(tech.momentum === "bullish" ? "is-up" : tech.momentum === "bearish" ? "is-down" : undefined)}>
                        {tech.momentum === "bullish"
                          ? t("studioMktBullish")
                          : tech.momentum === "bearish"
                            ? t("studioMktBearish")
                            : t("studioMktNeutral")}
                      </strong>
                    </div>
                    <div>
                      <span>{t("studioMktRelVol")}</span>
                      <strong>{tech.relVol}x</strong>
                    </div>
                    <div>
                      <span>ATR</span>
                      <strong>{formatPrice(tech.atrProxy, active.assetClass)}</strong>
                    </div>
                  </div>
                  <p className="st-mkt-bias">{ar ? tech.biasLineAr : tech.biasLine}</p>
                  <button type="button" className="st-mkt-analyze is-wide" onClick={() => analyzeActive("advanced")}>
                    <Zap size={14} />
                    {t("studioMktAskFaisalAdvanced")}
                  </button>
                </div>
              ) : null}

              {tab === "news" ? (
                <ul className="st-mkt-news">
                  {news.map((item) => (
                    <li key={item.id} className={`is-${item.sentiment}`}>
                      <button type="button" onClick={() => selectInstrument(item.symbol)}>
                        <strong>{displaySymbol(item.symbol)}</strong>
                        <span>{ar ? item.headlineAr : item.headline}</span>
                        <em>
                          {item.source} · {ar ? item.agoAr : item.ago}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {tab === "fundamentals" ? (
                <div className="st-mkt-fund-grid">
                  <div>
                    <span>P/E</span>
                    <strong>{active.pe ?? "—"}</strong>
                  </div>
                  <div>
                    <span>EPS</span>
                    <strong>{active.eps ?? "—"}</strong>
                  </div>
                  <div>
                    <span>{t("studioMktDivYield")}</span>
                    <strong>
                      {active.dividendYield != null ? `${active.dividendYield.toFixed(2)}%` : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Beta</span>
                    <strong>{active.beta ?? "—"}</strong>
                  </div>
                  <div>
                    <span>{t("studioMktSector")}</span>
                    <strong>{ar ? active.sectorAr : active.sector}</strong>
                  </div>
                  <div>
                    <span>{t("studioMktAvgVol")}</span>
                    <strong>{formatCompact(active.avgVolume, 1)}</strong>
                  </div>
                  <div>
                    <span>{t("studioMktPrevClose")}</span>
                    <strong>{formatPrice(active.prevClose, active.assetClass)}</strong>
                  </div>
                  <div>
                    <span>{t("studioMktRelVol")}</span>
                    <strong>{active.avgVolume ? (active.volume / active.avgVolume).toFixed(2) : "—"}x</strong>
                  </div>
                </div>
              ) : null}

              {tab === "screener" ? (
                <table className="st-mkt-table">
                  <thead>
                    <tr>
                      <th>{t("studioMktSymbol")}</th>
                      <th>{t("studioMktSector")}</th>
                      <th>{t("studioMktLast")}</th>
                      <th>{t("studioMktChange")}</th>
                      <th>{t("studioMktRelVol")}</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screener.map((row) => (
                      <tr key={row.symbol}>
                        <td>
                          <button type="button" onClick={() => setSymbol(row.symbol)}>
                            {displaySymbol(row.symbol)}
                          </button>
                        </td>
                        <td>{ar ? row.sectorAr : row.sector}</td>
                        <td>{row.last < 1 ? row.last.toFixed(4) : row.last.toFixed(2)}</td>
                        <td className={row.changePct >= 0 ? "is-up" : "is-down"}>{formatPct(row.changePct)}</td>
                        <td>{row.relVol.toFixed(2)}x</td>
                        <td>{row.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === "calendar" ? (
                <table className="st-mkt-table">
                  <thead>
                    <tr>
                      <th>{t("studioMktWhen")}</th>
                      <th>{t("studioMktEvent")}</th>
                      <th>{t("studioMktForecast")}</th>
                      <th>{t("studioMktPrevious")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MARKET_CALENDAR.map((row) => (
                      <tr key={row.id} className={`is-${row.importance}`}>
                        <td>{ar ? row.whenAr : row.when}</td>
                        <td>{ar ? row.eventAr : row.event}</td>
                        <td>{row.forecast}</td>
                        <td>{row.previous}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === "heatmap" ? (
                <div className="st-mkt-heat">
                  {heat.map((cell) => (
                    <button
                      key={cell.id}
                      type="button"
                      className={cn("st-mkt-heat-cell", cell.changePct >= 0 ? "is-up" : "is-down")}
                      style={{ opacity: 0.55 + Math.min(Math.abs(cell.changePct) / 4, 0.45) }}
                      onClick={() => setSymbol(cell.id)}
                    >
                      <strong>{cell.label}</strong>
                      <span>{formatPct(cell.changePct)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="st-mkt-chat">
          <header className="st-pane-head">
            <StudioPortrait entry={kind} size={28} />
            <span>{ar ? kind.nameAr : kind.name}</span>
            <button
              type="button"
              className="st-mkt-analyze is-head"
              disabled={room.busy}
              onClick={() => analyzeActive("advanced")}
            >
              <Zap size={12} />
              {t("studioMktAnalyzeAdvanced")}
            </button>
          </header>
          <div className="st-chat-log">
            {room.lines.length === 0 ? (
              <div className="st-assist-welcome st-default-welcome">
                <div className="st-assist-welcome-face">
                  <StudioPortrait entry={kind} size={64} />
                </div>
                <h3>{t("studioMktWelcome")}</h3>
                <p>{t("studioMktWelcomeHint")}</p>
                <div className="st-suggest-row is-welcome-grid">
                  {suggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="st-suggest-chip"
                      disabled={room.busy}
                      onClick={() => void send(undefined, item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              room.lines.map((line) => (
                <div key={line.id} className={cn("st-bubble", line.who === "me" ? "is-me" : "is-them")}>
                  {line.text}
                </div>
              ))
            )}
            {room.error ? <p className="st-chat-error">{room.error}</p> : null}
            {room.busy ? <div className="st-bubble is-them is-busy">…</div> : null}
            <div ref={chatEnd} />
          </div>
          <form className="st-composer" onSubmit={(event) => void send(event)}>
            <textarea
              value={room.draft}
              onChange={(event) => room.setDraft(event.target.value)}
              placeholder={t("studioMktPlaceholder")}
              rows={2}
              disabled={room.busy}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {room.busy ? (
              <button type="button" className="st-send is-stop" onClick={() => room.stop()} aria-label={t("chatStop")}>
                <Square size={14} />
              </button>
            ) : (
              <button type="submit" className="st-send" disabled={!room.draft.trim()} aria-label={t("send")}>
                <ArrowUp size={14} />
              </button>
            )}
          </form>
        </aside>
      </div>

      {chartOpen ? (
        <MarketsFullChart
          quote={active}
          candles={liveCandles}
          liveOk={liveOk}
          interval={chartInterval}
          onIntervalChange={setChartInterval}
          onClose={() => setChartOpen(false)}
        />
      ) : null}
    </div>
  );
}
