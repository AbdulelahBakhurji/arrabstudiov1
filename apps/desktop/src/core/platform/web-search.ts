/** Client-side web search so chat can answer even when the API has no web tools. */

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/core/platform/terminal";

export type ClientWebSearchResult = {
  query: string;
  summary: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
};

function looksLikeUrlOrDomain(value: string): string | null {
  const trimmed = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:].*)?$/i.test(trimmed) && !trimmed.includes(" ")) {
    return `https://${trimmed.replace(/\/$/, "")}`;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // ignore
  }
  return null;
}

function cleanQuery(value: string): string | null {
  const q = value
    .replace(/^[,:\s]+/, "")
    .replace(/^(?:for|about|عن)\s+/i, "")
    .replace(/[?؟]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return q.length >= 2 ? q : null;
}

/** Detect /web, /search, “search in web”, and natural lookup asks. */
export function parseWebSearchCommand(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  const slash = text.match(/^\/(?:web|search|find)\s+(.+)$/i);
  if (slash?.[1]) return cleanQuery(slash[1]);

  const onTheWeb = text.match(
    /(?:search|google|look\s*up|find(?:\s+out)?|ابحث|بحث)\s+(?:me\s+|us\s+|لي\s+)?(?:in\s+|on\s+)?(?:the\s+)?(?:web|internet|online|الويب|الإنترنت|الانترنت)\s*(?:for|about|عن)?\s*[,:]?\s*(.+)/i,
  );
  if (onTheWeb?.[1]) return cleanQuery(onTheWeb[1]);

  const searchAbout = text.match(
    /(?:search|google|look\s*up|ابحث|بحث)\s+(?:me\s+|us\s+|لي\s+)?(?:for|about|عن)\s+(.+)/i,
  );
  if (searchAbout?.[1]) return cleanQuery(searchAbout[1]);

  const natural = text.match(
    /^(?:can you |please |pls |هل يمكنك |ممكن )?(?:who is|what(?:'s| is)|ما هو|من هو)\s+(.+)$/i,
  );
  if (natural?.[1]) return cleanQuery(natural[1]);

  const arabic = text.match(/^(?:هل يمكنك |ممكن )?(?:ابحث|بحث)(?:\s+عن)?\s+(.+)$/i);
  if (arabic?.[1]) return cleanQuery(arabic[1]);

  if (looksLikeUrlOrDomain(text)) return text.trim();
  return null;
}

async function fetchLookup(url: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("desktop_web_fetch", { url });
  }
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function duckDuckGoInstant(query: string): Promise<ClientWebSearchResult> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const raw = await fetchLookup(url.toString());
  const data = JSON.parse(raw) as {
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
  const sources: Array<{ title: string; url: string }> = [];
  if (data.Heading) lines.push(data.Heading);
  if (data.Answer) lines.push(data.Answer);
  if (data.AbstractText) {
    lines.push(data.AbstractText);
    if (data.AbstractURL) {
      sources.push({ title: data.AbstractSource || data.Heading || "Source", url: data.AbstractURL });
    }
  }
  if (data.Definition) {
    lines.push(data.Definition);
    if (data.DefinitionURL) {
      sources.push({ title: "Definition", url: data.DefinitionURL });
    }
  }
  for (const item of [...(data.RelatedTopics ?? []), ...(data.Results ?? [])].slice(0, 8)) {
    if (!item.Text) continue;
    lines.push(`• ${item.Text}`);
    if (item.FirstURL) sources.push({ title: item.Text.slice(0, 80), url: item.FirstURL });
  }

  return {
    query,
    summary: lines.join("\n").trim(),
    sources,
  };
}

async function fetchPageSnippet(target: string): Promise<ClientWebSearchResult> {
  const response = await fetch(target, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "ArrabStudio/0.12 (+desktop web lookup)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || target;
  const cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return {
    query: target,
    summary: [
      `Page: ${title}`,
      `Status: ${response.status}`,
      contentType ? `Type: ${contentType}` : null,
      cleaned || "(empty page body)",
    ]
      .filter(Boolean)
      .join("\n"),
    sources: [{ title, url: target }],
  };
}

function parseDuckDuckGoHtml(html: string, query: string): ClientWebSearchResult {
  const sources: Array<{ title: string; url: string; snippet?: string }> = [];
  const anchorRe = /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) && sources.length < 8) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref="([^"]+)"/i)?.[1] ?? "";
    const title = decodeEntities(match[2] ?? "");
    let finalUrl = href;
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      // keep href
    }
    if (!title || !finalUrl.startsWith("http")) continue;
    const after = html.slice(match.index, match.index + 1200);
    const snippet = decodeEntities(after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    sources.push({ title, url: finalUrl, snippet: snippet || undefined });
  }

  const lines = sources.map((item) => `• ${item.title}${item.snippet ? ` — ${item.snippet}` : ""}\n  ${item.url}`);
  return {
    query,
    summary: lines.join("\n"),
    sources,
  };
}

async function duckDuckGoHtml(query: string): Promise<ClientWebSearchResult> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const html = await fetchLookup(url.toString());
  return parseDuckDuckGoHtml(html, query);
}

export function formatWebSearchForModel(result: ClientWebSearchResult): string {
  const sourceLines = result.sources
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.title} — ${item.url}`);
  return [
    "LIVE WEB SEARCH (already fetched from the public web — this is the search result):",
    `Query: ${result.query}`,
    result.summary ? `Findings:\n${result.summary}` : "Findings: (none)",
    sourceLines.length ? `Sources:\n${sourceLines.join("\n")}` : null,
    "Answer now from these findings. Name the pages and include the URLs. Do not call web_search again. Do not say the search returned nothing when findings are listed above.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatWebSearchForUser(result: ClientWebSearchResult, locale: string): string {
  const ar = locale === "ar";
  const sources = result.sources
    .slice(0, 6)
    .map((item) => `- ${item.title}\n  ${item.url}`)
    .join("\n");
  if (ar) {
    return [
      `نتائج البحث عن: ${result.query}`,
      result.summary || "لا نتائج مفصّلة.",
      sources ? `مصادر:\n${sources}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `Web search: ${result.query}`,
    result.summary || "No detailed results.",
    sources ? `Sources:\n${sources}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Run instant answer + page fetch + HTML results; always returns something usable. */
export async function clientSearchWeb(query: string): Promise<ClientWebSearchResult> {
  const q = query.trim().slice(0, 300);
  if (!q) {
    return { query: "", summary: "Empty query.", sources: [] };
  }

  const direct = looksLikeUrlOrDomain(q);
  const parts: ClientWebSearchResult[] = [];

  try {
    parts.push(await duckDuckGoInstant(q));
  } catch {
    // continue
  }

  if (direct) {
    try {
      parts.push(await fetchPageSnippet(direct));
    } catch {
      // continue
    }
  }

  try {
    const html = await duckDuckGoHtml(q);
    if (html.sources.length > 0) parts.unshift(html);
    else parts.push(html);
  } catch {
    // instant answer may still be enough
  }

  if (parts.length === 0) {
    return {
      query: q,
      summary: "Search failed. Try again or open the site directly.",
      sources: direct ? [{ title: q, url: direct }] : [],
    };
  }

  const sources: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const item of part.sources) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      sources.push(item);
    }
  }
  const summary = parts
    .map((part) => part.summary.trim())
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 10_000);

  return { query: q, summary, sources };
}
