
import { request } from "@/core/api/http";


export const studioApi = {

  marketsQuotes: (symbols: string[]) => {
    const list = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    if (!list.length) return Promise.resolve({ items: [], source: "tradingview" as const, fetchedAt: Date.now() });
    return request<{
      items: Array<{
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
      }>;
      source: "yahoo" | "tradingview" | "merged";
      fetchedAt: number;
    }>(`/v1/markets/quotes?symbols=${encodeURIComponent(list.join(","))}`, { timeoutMs: 20_000 });
  },
  marketsCandles: (symbol: string, opts?: { range?: string; interval?: string }) => {
    const params = new URLSearchParams({ symbol: symbol.trim() });
    if (opts?.range) params.set("range", opts.range);
    if (opts?.interval) params.set("interval", opts.interval);
    return request<{
      symbol: string;
      yahooSymbol: string;
      candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
      quote: {
        symbol: string;
        last: number;
        open: number | null;
        high: number | null;
        low: number | null;
        prevClose: number | null;
        volume: number | null;
        asOf: number | null;
      } | null;
      source: "yahoo" | "tradingview" | "merged";
      fetchedAt: number;
    }>(`/v1/markets/candles?${params.toString()}`, { timeoutMs: 20_000 });
  },
};
