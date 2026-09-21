/**
 * Finnhub market data — quotes, company news, and webhook secret check.
 * https://finnhub.io/docs/api
 */
import { timingSafeEqual } from "node:crypto";
import { ValidationError } from "@arrab/core";

const FINNHUB_API = "https://finnhub.io/api/v1";

export type FinnhubQuote = {
  symbol: string;
  current: number | null;
  change: number | null;
  percentChange: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  previousClose: number | null;
  timestamp: string | null;
};

export type FinnhubNewsItem = {
  id: number | string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: string | null;
  related: string;
};

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export async function verifyFinnhubApiKey(token: string): Promise<{ login: string; scopes: string[] }> {
  const key = token.trim();
  if (key.length < 8) {
    throw new ValidationError("A valid Finnhub API key is required");
  }
  const url = `${FINNHUB_API}/quote?symbol=AAPL&token=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError("Finnhub rejected this API key.");
  }
  const payload = (await response.json()) as { c?: number; error?: string };
  if (payload.error || typeof payload.c !== "number") {
    throw new ValidationError("Finnhub rejected this API key.");
  }
  return { login: "finnhub", scopes: ["market_data"] };
}

export async function fetchFinnhubQuote(apiKey: string, symbolRaw: string): Promise<FinnhubQuote> {
  const symbol = normalizeSymbol(symbolRaw);
  if (!symbol) {
    throw new ValidationError("symbol is required");
  }
  const url = `${FINNHUB_API}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError(`Finnhub quote failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    c?: number;
    d?: number;
    dp?: number;
    h?: number;
    l?: number;
    o?: number;
    pc?: number;
    t?: number;
    error?: string;
  };
  if (payload.error) {
    throw new ValidationError(payload.error);
  }
  const ts =
    typeof payload.t === "number" && payload.t > 0
      ? new Date(payload.t * 1000).toISOString()
      : null;
  return {
    symbol,
    current: typeof payload.c === "number" ? payload.c : null,
    change: typeof payload.d === "number" ? payload.d : null,
    percentChange: typeof payload.dp === "number" ? payload.dp : null,
    high: typeof payload.h === "number" ? payload.h : null,
    low: typeof payload.l === "number" ? payload.l : null,
    open: typeof payload.o === "number" ? payload.o : null,
    previousClose: typeof payload.pc === "number" ? payload.pc : null,
    timestamp: ts,
  };
}

export async function fetchFinnhubNews(
  apiKey: string,
  symbolRaw: string,
  days = 7,
): Promise<FinnhubNewsItem[]> {
  const symbol = normalizeSymbol(symbolRaw);
  if (!symbol) {
    throw new ValidationError("symbol is required");
  }
  const span = Math.min(30, Math.max(1, days));
  const to = new Date();
  const from = new Date(to.getTime() - span * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `${FINNHUB_API}/company-news?symbol=${encodeURIComponent(symbol)}` +
    `&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Arrab-Studio" },
  });
  if (!response.ok) {
    throw new ValidationError(`Finnhub news failed (${response.status})`);
  }
  const payload = (await response.json()) as Array<{
    id?: number;
    headline?: string;
    summary?: string;
    source?: string;
    url?: string;
    datetime?: number;
    related?: string;
  }>;
  if (!Array.isArray(payload)) {
    throw new ValidationError("Finnhub news returned an unexpected payload");
  }
  return payload.slice(0, 12).map((item, index) => ({
    id: item.id ?? index,
    headline: item.headline?.trim() || "(no headline)",
    summary: item.summary?.trim() || "",
    source: item.source?.trim() || "Finnhub",
    url: item.url?.trim() || "",
    datetime:
      typeof item.datetime === "number" && item.datetime > 0
        ? new Date(item.datetime * 1000).toISOString()
        : null,
    related: item.related?.trim() || symbol,
  }));
}

export function verifyFinnhubWebhookSecret(
  expectedSecret: string | null | undefined,
  headerValue: string | null | undefined,
): void {
  const expected = expectedSecret?.trim() ?? "";
  if (!expected) {
    throw new ValidationError("Finnhub webhook is not configured (FINNHUB_WEBHOOK_SECRET)");
  }
  const got = headerValue?.trim() ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ValidationError("Invalid Finnhub webhook secret");
  }
}
