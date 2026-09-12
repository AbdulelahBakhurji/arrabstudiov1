/** Lightweight web search for agent tools (no API key required). */

export async function searchWeb(query: string): Promise<string> {
  const q = query.trim();
  if (!q) {
    return "ERROR: web_search requires a non-empty query.";
  }
  if (q.length > 300) {
    return "ERROR: query is too long (max 300 chars).";
  }

  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return `ERROR: web_search HTTP ${response.status}`;
    }
    const data = (await response.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      Answer?: string;
      AnswerType?: string;
      Definition?: string;
      DefinitionURL?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown }>;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const lines: string[] = [`Query: ${q}`];
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
      .flatMap((topic) => {
        if (topic.Text) return [{ text: topic.Text, url: topic.FirstURL }];
        return [];
      })
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

    if (lines.length <= 1) {
      return [
        `Query: ${q}`,
        "No structured results. Try a more specific query, or use knowledge already in context.",
      ].join("\n");
    }
    return lines.join("\n").slice(0, 8000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: web_search failed — ${message}`;
  }
}
