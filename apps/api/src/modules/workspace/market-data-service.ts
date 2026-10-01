/**
 * Live market quotes — TradingView scanner (primary) + Yahoo chart candles (fallback).
 * Desk symbols map to exchange-qualified TradingView tickers (TADAWUL:2222, NASDAQ:AAPL, …).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TV_SCAN = "https://scanner.tradingview.com/global/scan";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const QUOTE_CACHE_TTL_MS = 5_000;
const QUOTE_STALE_MS = 30 * 60_000;
const CANDLE_CACHE_TTL_MS = 45_000;
const CANDLE_STALE_MS = 30 * 60_000;

/** Desk symbol → TradingView qualified ticker. */
const STATIC_TV: Record<string, string> = {
  AAPL: "NASDAQ:AAPL",
  MSFT: "NASDAQ:MSFT",
  NVDA: "NASDAQ:NVDA",
  AMZN: "NASDAQ:AMZN",
  META: "NASDAQ:META",
  GOOGL: "NASDAQ:GOOGL",
  GOOG: "NASDAQ:GOOG",
  TSLA: "NASDAQ:TSLA",
  AVGO: "NASDAQ:AVGO",
  COST: "NASDAQ:COST",
  NFLX: "NASDAQ:NFLX",
  AMD: "NASDAQ:AMD",
  INTC: "NASDAQ:INTC",
  CRM: "NYSE:CRM",
  ORCL: "NYSE:ORCL",
  JPM: "NYSE:JPM",
  V: "NYSE:V",
  MA: "NYSE:MA",
  BAC: "NYSE:BAC",
  WMT: "NYSE:WMT",
  XOM: "NYSE:XOM",
  CVX: "NYSE:CVX",
  JNJ: "NYSE:JNJ",
  PG: "NYSE:PG",
  KO: "NYSE:KO",
  DIS: "NYSE:DIS",
  NKE: "NYSE:NKE",
  BA: "NYSE:BA",
  CAT: "NYSE:CAT",
  GS: "NYSE:GS",
  HD: "NYSE:HD",
  UNH: "NYSE:UNH",
  LLY: "NYSE:LLY",
  SPY: "AMEX:SPY",
  QQQ: "NASDAQ:QQQ",
  IWM: "AMEX:IWM",
  DIA: "AMEX:DIA",
  EEM: "AMEX:EEM",
  GLD: "AMEX:GLD",
  USO: "AMEX:USO",
  BTCUSD: "BINANCE:BTCUSDT",
  ETHUSD: "BINANCE:ETHUSDT",
  SOLUSD: "BINANCE:SOLUSDT",
  BNBUSD: "BINANCE:BNBUSDT",
  XRPUSD: "BINANCE:XRPUSDT",
  ADAUSD: "BINANCE:ADAUSDT",
  DOGEUSD: "BINANCE:DOGEUSDT",
  AVAXUSD: "BINANCE:AVAXUSDT",
  EURUSD: "FX_IDC:EURUSD",
  GBPUSD: "FX_IDC:GBPUSD",
  USDJPY: "FX_IDC:USDJPY",
  USDSAR: "FX_IDC:USDSAR",
  XAUUSD: "TVC:GOLD",
  WTI: "NYMEX:CL1!",
  TASI: "TADAWUL:TASI",
  NOMU: "TADAWUL:NOMU",
  SPX: "SP:SPX",
  IXIC: "TVC:IXIC",
  DJI: "TVC:DJI",
};

const YAHOO_FOR_CANDLES: Record<string, string> = {
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  SOLUSD: "SOL-USD",
  BNBUSD: "BNB-USD",
  XRPUSD: "XRP-USD",
  ADAUSD: "ADA-USD",
  DOGEUSD: "DOGE-USD",
  AVAXUSD: "AVAX-USD",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  USDSAR: "SAR=X",
  XAUUSD: "GC=F",
  WTI: "CL=F",
  TASI: "^TASI.SR",
  NOMU: "^NOMU.SR",
  SPX: "^GSPC",
  IXIC: "^IXIC",
  DJI: "^DJI",
};

export type LiveMarketQuote = {
  symbol: string;
  yahooSymbol: string;
  last: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  marketCap: number | null;
  currency: string | null;
  exchange: string | null;
  asOf: number | null;
};

export type LiveMarketCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type CacheEntry<T> = { at: number; value: T };

const quoteCache = new Map<string, CacheEntry<LiveMarketQuote>>();
const candleCache = new Map<string, CacheEntry<{ candles: LiveMarketCandle[]; quote: LiveMarketQuote | null }>>();

function normalizeDeskSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\.SR$/i, "")
    .replace(/^\^/, "")
    .replace(/-USD$/i, "USD")
    .replace(/=X$/i, "");
}

/** Map Arrab desk symbol → TradingView ticker. */
export function toTradingViewSymbol(deskSymbol: string): string {
  const normalized = normalizeDeskSymbol(deskSymbol);
  if (STATIC_TV[normalized]) return STATIC_TV[normalized]!;
  if (/^\d{4}$/.test(normalized)) return `TADAWUL:${normalized}`;
  if (/^[A-Z0-9]+USD$/.test(normalized)) {
    return `BINANCE:${normalized.replace(/USD$/, "")}USDT`;
  }
  if (/^[A-Z]{1,5}$/.test(normalized)) return `NASDAQ:${normalized}`;
  return normalized;
}

/** Yahoo ticker (candles / legacy). */
export function toYahooSymbol(deskSymbol: string): string {
  const normalized = normalizeDeskSymbol(deskSymbol);
  if (YAHOO_FOR_CANDLES[normalized]) return YAHOO_FOR_CANDLES[normalized]!;
  if (/^\d{4}$/.test(normalized)) return `${normalized}.SR`;
  if (/^[A-Z]{1,5}$/.test(normalized)) return normalized;
  if (/^[A-Z0-9]+USD$/.test(normalized)) {
    return `${normalized.replace(/USD$/, "")}-USD`;
  }
  return normalized;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchTradingViewQuotes(deskToTv: Map<string, string>): Promise<LiveMarketQuote[]> {
  const tickers = [...new Set([...deskToTv.values()])];
  if (!tickers.length) return [];

  const response = await fetch(TV_SCAN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      // change_abs → exact previous close (matches Google Finance day change)
      columns: ["name", "close", "change", "change_abs", "high", "low", "open", "volume", "currency", "exchange"],
    }),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    data?: Array<{ s?: string; d?: unknown[] }>;
  };

  const byTv = new Map<string, LiveMarketQuote>();
  for (const row of body.data ?? []) {
    const tvSymbol = row.s;
    const d = row.d ?? [];
    if (!tvSymbol) continue;
    const last = num(d[1]);
    if (last === null) continue;
    const changePct = num(d[2]) ?? 0;
    const changeAbs = num(d[3]);
    const high = num(d[4]);
    const low = num(d[5]);
    const open = num(d[6]);
    const volume = num(d[7]);
    const currency = typeof d[8] === "string" ? d[8] : null;
    const exchange = typeof d[9] === "string" ? d[9] : null;
    const prevClose =
      changeAbs !== null
        ? last - changeAbs
        : changePct === -100
          ? null
          : last / (1 + changePct / 100);

    for (const [desk, tv] of deskToTv) {
      if (tv !== tvSymbol) continue;
      byTv.set(desk, {
        symbol: desk,
        yahooSymbol: toYahooSymbol(desk),
        last,
        open,
        high,
        low,
        prevClose: prevClose !== null && Number.isFinite(prevClose) ? prevClose : null,
        volume,
        marketCap: null,
        currency,
        exchange,
        asOf: Date.now(),
      });
    }
  }

  return [...byTv.values()];
}

/** Yahoo spark batch — often matches Google Finance delayed prints. */
async function fetchYahooSparkQuotes(deskToYahoo: Map<string, string>): Promise<LiveMarketQuote[]> {
  const yahooSymbols = [...new Set([...deskToYahoo.values()])];
  if (!yahooSymbols.length) return [];
  const url =
    `https://query1.finance.yahoo.com/v7/finance/spark?symbols=` +
    `${yahooSymbols.map((s) => encodeURIComponent(s)).join(",")}` +
    `&range=1d&interval=5m`;

  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-A", USER_AGENT, "-H", "Accept: application/json", "--max-time", "10", url],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    if (!stdout || stdout[0] !== "{") return [];
    const body = JSON.parse(stdout) as {
      spark?: {
        result?: Array<{
          symbol?: string;
          response?: Array<{
            meta?: {
              regularMarketPrice?: number;
              previousClose?: number;
              chartPreviousClose?: number;
              regularMarketDayHigh?: number;
              regularMarketDayLow?: number;
              regularMarketVolume?: number;
              regularMarketTime?: number;
              currency?: string;
              exchangeName?: string;
            };
            indicators?: {
              quote?: Array<{
                open?: Array<number | null>;
                close?: Array<number | null>;
              }>;
            };
          }>;
        }>;
      };
    };

    const out: LiveMarketQuote[] = [];
    for (const row of body.spark?.result ?? []) {
      const yahooSymbol = row.symbol;
      const meta = row.response?.[0]?.meta;
      const bars = row.response?.[0]?.indicators?.quote?.[0];
      if (!yahooSymbol || !meta) continue;
      const last = num(meta.regularMarketPrice);
      if (last === null) continue;
      const openBar = bars?.open?.find((v) => typeof v === "number" && Number.isFinite(v)) ?? null;
      for (const [desk, yahoo] of deskToYahoo) {
        if (yahoo !== yahooSymbol) continue;
        out.push({
          symbol: desk,
          yahooSymbol,
          last,
          open: typeof openBar === "number" ? openBar : null,
          high: num(meta.regularMarketDayHigh),
          low: num(meta.regularMarketDayLow),
          prevClose: num(meta.previousClose) ?? num(meta.chartPreviousClose),
          volume: num(meta.regularMarketVolume),
          marketCap: null,
          currency: meta.currency ?? null,
          exchange: meta.exchangeName ?? null,
          asOf: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now(),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function preferFresher(a: LiveMarketQuote, b: LiveMarketQuote): LiveMarketQuote {
  // Prefer Yahoo-shaped prints (Google Finance alignment) when both exist.
  const aYahoo = a.yahooSymbol && a.asOf;
  const bYahoo = b.yahooSymbol && b.asOf;
  if ((a.asOf ?? 0) !== (b.asOf ?? 0)) {
    return (a.asOf ?? 0) >= (b.asOf ?? 0) ? a : b;
  }
  // Same age — keep Yahoo if one side came from yahoo spark (has prevClose from meta).
  if (a.prevClose != null && b.prevClose == null) return a;
  if (b.prevClose != null && a.prevClose == null) return b;
  return a;
}

/** Live quotes for desk symbols (max 50 per request). */
export async function fetchLiveQuotes(symbols: string[]): Promise<{
  items: LiveMarketQuote[];
  source: "tradingview" | "yahoo" | "merged";
  fetchedAt: number;
  stale?: boolean;
}> {
  const unique = [...new Set(symbols.map(normalizeDeskSymbol).filter(Boolean))].slice(0, 50);
  const now = Date.now();
  const fresh: LiveMarketQuote[] = [];
  const needFetch: string[] = [];

  for (const symbol of unique) {
    const hit = quoteCache.get(symbol);
    if (hit && now - hit.at < QUOTE_CACHE_TTL_MS) {
      fresh.push(hit.value);
    } else {
      needFetch.push(symbol);
    }
  }

  let stale = false;
  let source: "tradingview" | "yahoo" | "merged" = "tradingview";
  if (needFetch.length) {
    const deskToTv = new Map(needFetch.map((symbol) => [symbol, toTradingViewSymbol(symbol)]));
    const deskToYahoo = new Map(needFetch.map((symbol) => [symbol, toYahooSymbol(symbol)]));
    try {
      const [tv, yahoo] = await Promise.all([
        fetchTradingViewQuotes(deskToTv),
        fetchYahooSparkQuotes(deskToYahoo),
      ]);
      const byDesk = new Map<string, LiveMarketQuote>();
      for (const quote of tv) byDesk.set(quote.symbol, quote);
      for (const quote of yahoo) {
        const existing = byDesk.get(quote.symbol);
        byDesk.set(quote.symbol, existing ? preferFresher(quote, existing) : quote);
      }
      if (tv.length && yahoo.length) source = "merged";
      else if (yahoo.length) source = "yahoo";
      else source = "tradingview";

      if (byDesk.size) {
        for (const quote of byDesk.values()) {
          quoteCache.set(quote.symbol, { at: now, value: quote });
          fresh.push(quote);
        }
      } else {
        for (const symbol of needFetch) {
          const hit = quoteCache.get(symbol);
          if (hit && now - hit.at < QUOTE_STALE_MS) {
            fresh.push(hit.value);
            stale = true;
          }
        }
      }
    } catch {
      for (const symbol of needFetch) {
        const hit = quoteCache.get(symbol);
        if (hit && now - hit.at < QUOTE_STALE_MS) {
          fresh.push(hit.value);
          stale = true;
        }
      }
    }
  }

  return {
    items: fresh,
    source,
    fetchedAt: Date.now(),
    ...(stale ? { stale: true } : {}),
  };
}

async function curlYahooChart(yahooSymbol: string, range: string, interval: string): Promise<{
  meta?: {
    regularMarketPrice?: number;
    previousClose?: number;
    chartPreviousClose?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    regularMarketTime?: number;
    currency?: string;
    exchangeName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
} | null> {
  const url =
    `${YAHOO_CHART}/${encodeURIComponent(yahooSymbol)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-A", USER_AGENT, "-H", "Accept: application/json", "--max-time", "12", url],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    if (!stdout || stdout[0] !== "{") return null;
    const body = JSON.parse(stdout) as {
      chart?: { result?: Array<Record<string, unknown>> | null };
    };
    return (body.chart?.result?.[0] as ReturnType<typeof curlYahooChart> extends Promise<infer R> ? R : never) ?? null;
  } catch {
    return null;
  }
}

/** Intraday / multi-day candles (Yahoo) with TradingView last as quote fallback. */
export async function fetchLiveCandles(
  deskSymbol: string,
  opts?: { range?: string; interval?: string },
): Promise<{
  symbol: string;
  yahooSymbol: string;
  candles: LiveMarketCandle[];
  quote: LiveMarketQuote | null;
  source: "yahoo" | "tradingview";
  fetchedAt: number;
  stale?: boolean;
}> {
  const symbol = normalizeDeskSymbol(deskSymbol);
  const yahooSymbol = toYahooSymbol(symbol);
  const range = opts?.range ?? "5d";
  const interval = opts?.interval ?? "15m";
  const cacheKey = `${symbol}|${range}|${interval}`;
  const now = Date.now();
  const hit = candleCache.get(cacheKey);
  if (hit && now - hit.at < CANDLE_CACHE_TTL_MS) {
    return {
      symbol,
      yahooSymbol,
      candles: hit.value.candles,
      quote: hit.value.quote,
      source: "yahoo",
      fetchedAt: hit.at,
    };
  }

  const result = await curlYahooChart(yahooSymbol, range, interval);
  if (!result?.timestamp?.length) {
    // Still return a live quote from TradingView even if candles fail.
    const live = await fetchLiveQuotes([symbol]);
    const quote = live.items[0] ?? hit?.value.quote ?? null;
    if (hit && now - hit.at < CANDLE_STALE_MS) {
      return {
        symbol,
        yahooSymbol,
        candles: hit.value.candles,
        quote: quote ?? hit.value.quote,
        source: "yahoo",
        fetchedAt: hit.at,
        stale: true,
      };
    }
    return {
      symbol,
      yahooSymbol,
      candles: [],
      quote,
      source: "tradingview",
      fetchedAt: Date.now(),
    };
  }

  const timestamps = result.timestamp ?? [];
  const bars = result.indicators?.quote?.[0];
  const candles: LiveMarketCandle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const o = bars?.open?.[i];
    const h = bars?.high?.[i];
    const l = bars?.low?.[i];
    const c = bars?.close?.[i];
    if (
      typeof o !== "number" ||
      typeof h !== "number" ||
      typeof l !== "number" ||
      typeof c !== "number" ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    ) {
      continue;
    }
    candles.push({
      t: timestamps[i]! * 1000,
      o,
      h,
      l,
      c,
      v: typeof bars?.volume?.[i] === "number" ? bars.volume[i]! : 0,
    });
  }

  const meta = result.meta;
  const last = num(meta?.regularMarketPrice) ?? (candles.at(-1)?.c ?? null);
  const quote: LiveMarketQuote | null =
    last === null
      ? null
      : {
          symbol,
          yahooSymbol,
          last,
          open: candles[0]?.o ?? null,
          high: num(meta?.regularMarketDayHigh),
          low: num(meta?.regularMarketDayLow),
          prevClose: num(meta?.previousClose) ?? num(meta?.chartPreviousClose),
          volume: num(meta?.regularMarketVolume),
          marketCap: null,
          currency: typeof meta?.currency === "string" ? meta.currency : null,
          exchange: typeof meta?.exchangeName === "string" ? meta.exchangeName : null,
          asOf: typeof meta?.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now(),
        };

  if (quote) quoteCache.set(symbol, { at: now, value: quote });
  candleCache.set(cacheKey, { at: now, value: { candles, quote } });

  return {
    symbol,
    yahooSymbol,
    candles,
    quote,
    source: "yahoo",
    fetchedAt: Date.now(),
  };
}
