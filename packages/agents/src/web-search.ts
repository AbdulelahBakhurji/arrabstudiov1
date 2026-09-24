/** Lightweight web search + page scrape for agent tools (no API key required). */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "ArrabStudio/0.14 (+agent web)";
const MAX_REDIRECTS = 5;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

/** Block loopback, link-local, private, and cloud metadata targets. */
export function isBlockedIpAddress(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) {
    const a = v4[0]!;
    const b = v4[1]!;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpAddress(mapped[1]);
  return false;
}

async function assertSafePublicUrl(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error("private or metadata hosts are not allowed");
  }
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
  if (addresses.length === 0) {
    throw new Error("host could not be resolved");
  }
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new Error("private or metadata hosts are not allowed");
    }
  }
  return parsed;
}

async function fetchPublicUrl(
  rawUrl: string,
  init: RequestInit,
): Promise<Response> {
  let current = await assertSafePublicUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      ...init,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("redirect missing Location");
      }
      current = await assertSafePublicUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

async function duckDuckGoInstant(query: string): Promise<string | null> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Heading?: string;
    Answer?: string;
    Definition?: string;
    DefinitionURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const lines: string[] = [];
  if (data.Heading) lines.push(`Heading: ${data.Heading}`);
  if (data.Answer) lines.push(`Answer: ${data.Answer}`);
  if (data.AbstractText) {
    lines.push(`Summary (${data.AbstractSource || "source"}): ${data.AbstractText}`);
    if (data.AbstractURL) lines.push(`URL: ${data.AbstractURL}`);
  }
  if (data.Definition) {
    lines.push(`Definition: ${data.Definition}`);
    if (data.DefinitionURL) lines.push(`Definition URL: ${data.DefinitionURL}`);
  }

  const related = (data.RelatedTopics ?? [])
    .flatMap((topic) => (topic.Text ? [{ text: topic.Text, url: topic.FirstURL }] : []))
    .slice(0, 8);
  if (related.length > 0) {
    lines.push("Related:");
    for (const item of related) {
      lines.push(`- ${item.text}${item.url ? ` (${item.url})` : ""}`);
    }
  }

  const results = (data.Results ?? []).slice(0, 5);
  if (results.length > 0) {
    lines.push("Results:");
    for (const item of results) {
      if (item.Text) lines.push(`- ${item.Text}${item.FirstURL ? ` (${item.FirstURL})` : ""}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

async function duckDuckGoHtml(query: string): Promise<string | null> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const html = await response.text();
  const rows: string[] = [];
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && rows.length < 8) {
    const href = match[1] ?? "";
    const title = stripTags(match[2] ?? "");
    const snippet = stripTags(match[3] ?? "");
    let finalUrl = href;
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      // keep href
    }
    if (!title || !finalUrl.startsWith("http")) continue;
    rows.push(`- ${title}${snippet ? ` — ${snippet}` : ""}\n  ${finalUrl}`);
  }
  return rows.length > 0 ? `Results:\n${rows.join("\n")}` : null;
}

export async function searchWeb(query: string): Promise<string> {
  const q = query.trim();
  if (!q) {
    return "ERROR: web_search requires a non-empty query.";
  }
  if (q.length > 300) {
    return "ERROR: query is too long (max 300 chars).";
  }

  try {
    const parts: string[] = [`Query: ${q}`];
    try {
      const instant = await duckDuckGoInstant(q);
      if (instant) parts.push(instant);
    } catch {
      // continue to HTML scrape
    }
    try {
      const html = await duckDuckGoHtml(q);
      if (html) parts.push(html);
    } catch {
      // ignore
    }

    if (parts.length <= 1) {
      return [
        `Query: ${q}`,
        "No structured results. Try a more specific query, or scrape a known URL with scrape_page / fetch_url.",
      ].join("\n");
    }
    return parts.join("\n\n").slice(0, 12_000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: web_search failed — ${message}`;
  }
}

/** Fetch a public URL and return truncated readable text. */
export async function fetchUrl(rawUrl: string): Promise<string> {
  const value = rawUrl.trim();
  if (!value) {
    return "ERROR: fetch_url requires a url.";
  }
  let parsed: URL;
  try {
    parsed = await assertSafePublicUrl(value);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: fetch_url blocked — ${message}`;
  }
  try {
    const response = await fetchPublicUrl(parsed.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(18_000),
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const excerpt =
      contentType.includes("json") || contentType.includes("text/plain")
        ? body.trim().slice(0, 14_000)
        : stripTags(body).slice(0, 14_000);
    return [
      `URL: ${parsed.toString()}`,
      `status: ${response.status}`,
      `content-type: ${contentType || "(unknown)"}`,
      "-----",
      excerpt || "(empty body)",
    ].join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: fetch_url failed — ${message}`;
  }
}

export type ScrapeOptions = {
  /** Max characters of main text (default 14000). */
  maxChars?: number;
  /** Include outbound links (default true). */
  links?: boolean;
};

/**
 * Structured page scrape: title, description, headings, main text, and links.
 * Better than fetch_url when the agent needs document structure.
 */
export async function scrapePage(rawUrl: string, options: ScrapeOptions = {}): Promise<string> {
  const value = rawUrl.trim();
  if (!value) {
    return "ERROR: scrape_page requires a url.";
  }
  const maxChars = Math.min(24_000, Math.max(2_000, options.maxChars ?? 14_000));
  const includeLinks = options.links !== false;

  let parsed: URL;
  try {
    parsed = await assertSafePublicUrl(value);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: scrape_page blocked — ${message}`;
  }

  try {
    const response = await fetchPublicUrl(parsed.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const finalUrl = response.url || parsed.toString();

    if (contentType.includes("json") || contentType.includes("text/plain")) {
      return [
        `SCRAPE ${finalUrl}`,
        `status: ${response.status}`,
        `content-type: ${contentType}`,
        "-----",
        body.trim().slice(0, maxChars) || "(empty)",
      ].join("\n");
    }

    const title =
      body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ||
      "(no title)";
    const description =
      body
        .match(
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        )?.[1]
        ?.trim() ||
      body
        .match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
        )?.[1]
        ?.trim() ||
      "";
    const ogTitle =
      body
        .match(
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        )?.[1]
        ?.trim() || "";

    const headings: string[] = [];
    const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRe.exec(body)) && headings.length < 24) {
      const text = stripTags(hMatch[2] ?? "");
      if (text) headings.push(`H${hMatch[1]}: ${text.slice(0, 200)}`);
    }

    const links: string[] = [];
    if (includeLinks) {
      const linkRe = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let lMatch: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((lMatch = linkRe.exec(body)) && links.length < 20) {
        const href = (lMatch[1] ?? "").trim();
        if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
        let abs = href;
        try {
          abs = new URL(href, finalUrl).toString();
        } catch {
          continue;
        }
        if (!abs.startsWith("http") || seen.has(abs)) continue;
        seen.add(abs);
        const label = stripTags(lMatch[2] ?? "").slice(0, 80) || abs;
        links.push(`- ${label}\n  ${abs}`);
      }
    }

    // Prefer main/article body when present.
    const mainChunk =
      body.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
      body.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
      body;
    const text = stripTags(mainChunk).slice(0, maxChars);

    return [
      `SCRAPE ${finalUrl}`,
      `status: ${response.status}`,
      `title: ${ogTitle || title}`,
      description ? `description: ${description}` : null,
      headings.length ? `headings:\n${headings.join("\n")}` : null,
      links.length ? `links:\n${links.join("\n")}` : null,
      "-----",
      text || "(empty page body)",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, maxChars + 4_000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: scrape_page failed — ${message}`;
  }
}
