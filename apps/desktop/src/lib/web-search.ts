/** Client-side web search so chat can answer even when the API has no web tools. */

export type ClientWebSearchResult = {
  query: string;
  summary: string;
  sources: Array<{ title: string; url: string }>;
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

/** Detect /web, /search, or natural “search …” asks. */
export function parseWebSearchCommand(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  const slash = text.match(/^\/(?:web|search|find)\s+(.+)$/i);
  if (slash?.[1]?.trim()) return slash[1].trim();

  const natural = text.match(
    /^(?:can you |please |pls )?(?:search(?:\s+(?:the\s+)?web(?:\s+for)?)?|look\s*up|google|find(?:\s+out)?(?:\s+about)?|what(?:'s| is)|who is)\s+(.+)$/i,
  );
  if (natural?.[1]?.trim()) {
    const q = natural[1].trim().replace(/\?+$/, "").trim();
    return q || null;
  }

  const arabic = text.match(
    /^(?:هل يمكنك |ممكن )?(?:ابحث(?:\s+في\s+الويب)?(?:\s+عن)?|بحث(?:\s+عن)?|ما(?:\s+هو)?)\s+(.+)$/i,
  );
  if (arabic?.[1]?.trim()) {
    return arabic[1].trim().replace(/[؟?]+$/, "").trim() || null;
  }

  // Bare domain / URL as the whole message → treat as lookup.
  if (looksLikeUrlOrDomain(text)) {
    return text.trim();
  }

  return null;
}

async function duckDuckGoInstant(query: string): Promise<ClientWebSearchResult> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTTP ${response.status}`);
  }
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

async function duckDuckGoHtml(query: string): Promise<ClientWebSearchResult> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "text/html",
      "User-Agent": "ArrabStudio/0.12 (+desktop web search)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML HTTP ${response.status}`);
  }
  const html = await response.text();
  const sources: Array<{ title: string; url: string }> = [];
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && sources.length < 6) {
    const href = match[1] ?? "";
    const title = (match[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snippet = (match[3] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    let finalUrl = href;
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      // keep href
    }
    if (!title || !finalUrl.startsWith("http")) continue;
    sources.push({ title, url: finalUrl });
    if (snippet) {
      // attach snippet into title temporarily via separate list below
      (sources[sources.length - 1] as { title: string; url: string; snippet?: string }).snippet =
        snippet;
    }
  }

  const lines = sources.map((item) => {
    const extra = (item as { snippet?: string }).snippet;
    return `• ${item.title}${extra ? ` — ${extra}` : ""}\n  ${item.url}`;
  });

  return {
    query,
    summary: lines.join("\n") || "No HTML results.",
    sources: sources.map(({ title, url }) => ({ title, url })),
  };
}

export function formatWebSearchForModel(result: ClientWebSearchResult): string {
  const sourceLines = result.sources
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.title} — ${item.url}`);
  return [
    "LIVE WEB SEARCH (already fetched for you — answer from this, do not claim you cannot search):",
    `Query: ${result.query}`,
    result.summary ? `Findings:\n${result.summary}` : "Findings: (none)",
    sourceLines.length ? `Sources:\n${sourceLines.join("\n")}` : null,
    "Write a clear helpful reply now using these findings. Mention key URLs.",
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

  const hasMeat = parts.some((part) => part.summary.trim().length > 40 || part.sources.length > 0);
  if (!hasMeat) {
    try {
      parts.push(await duckDuckGoHtml(q));
    } catch {
      // continue
    }
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
