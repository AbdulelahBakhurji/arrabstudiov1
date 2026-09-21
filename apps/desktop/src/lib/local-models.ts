/**
 * Curated local models (Ollama) — download in Settings, not in chat.
 * Tiers: low → high (size / quality).
 */
export type LocalModelTier = "low" | "mid" | "high" | "max";

export type LocalModelCatalogEntry = {
  id: string;
  ollamaTag: string;
  name: string;
  nameAr: string;
  blurb: string;
  blurbAr: string;
  sizeLabel: string;
  params: string;
  tier: LocalModelTier;
  recommended?: boolean;
};

export const LOCAL_MODEL_CATALOG: LocalModelCatalogEntry[] = [
  // —— Low (fast / small devices) ——
  {
    id: "tinyllama",
    ollamaTag: "tinyllama",
    name: "TinyLlama",
    nameAr: "TinyLlama",
    blurb: "Smallest footprint — smoke tests and very old machines.",
    blurbAr: "أخف حجم — للاختبار والأجهزة القديمة جداً.",
    sizeLabel: "~637 MB",
    params: "1.1B",
    tier: "low",
  },
  {
    id: "gemma2-2b",
    ollamaTag: "gemma2:2b",
    name: "Gemma 2 2B",
    nameAr: "Gemma 2 ‏٢ب",
    blurb: "Very light everyday chat.",
    blurbAr: "محادثة يومية خفيفة جداً.",
    sizeLabel: "~1.6 GB",
    params: "2B",
    tier: "low",
  },
  {
    id: "qwen2.5-1.5b",
    ollamaTag: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B",
    nameAr: "Qwen 2.5 ‏١٫٥ب",
    blurb: "Tiny multilingual helper.",
    blurbAr: "مساعد متعدد اللغات صغير.",
    sizeLabel: "~986 MB",
    params: "1.5B",
    tier: "low",
  },
  {
    id: "llama3.2-1b",
    ollamaTag: "llama3.2:1b",
    name: "Llama 3.2 1B",
    nameAr: "Llama 3.2 ‏١ب",
    blurb: "Ultra-light Meta model.",
    blurbAr: "نموذج ميتا فائق الخفة.",
    sizeLabel: "~1.3 GB",
    params: "1B",
    tier: "low",
  },
  {
    id: "llama3.2-3b",
    ollamaTag: "llama3.2:3b",
    name: "Llama 3.2 3B",
    nameAr: "Llama 3.2 ‏٣ب",
    blurb: "Best low-tier default for laptops.",
    blurbAr: "أفضل خيار خفيف للابتوب.",
    sizeLabel: "~2.0 GB",
    params: "3B",
    tier: "low",
    recommended: true,
  },
  {
    id: "phi3-mini",
    ollamaTag: "phi3:mini",
    name: "Phi-3 Mini",
    nameAr: "Phi-3 Mini",
    blurb: "Sharp Q&A in a small package.",
    blurbAr: "أسئلة وأجوبة حادة بحجم صغير.",
    sizeLabel: "~2.3 GB",
    params: "3.8B",
    tier: "low",
  },
  // —— Mid ——
  {
    id: "mistral-7b",
    ollamaTag: "mistral:7b",
    name: "Mistral 7B",
    nameAr: "Mistral ‏٧ب",
    blurb: "Solid general assistant.",
    blurbAr: "مساعد عام متين.",
    sizeLabel: "~4.1 GB",
    params: "7B",
    tier: "mid",
  },
  {
    id: "qwen2.5-7b",
    ollamaTag: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    nameAr: "Qwen 2.5 ‏٧ب",
    blurb: "Strong Arabic + English on mid PCs.",
    blurbAr: "قوي بالعربية والإنجليزية على أجهزة متوسطة.",
    sizeLabel: "~4.7 GB",
    params: "7B",
    tier: "mid",
    recommended: true,
  },
  {
    id: "llama3.1-8b",
    ollamaTag: "llama3.1:8b",
    name: "Llama 3.1 8B",
    nameAr: "Llama 3.1 ‏٨ب",
    blurb: "Higher quality everyday work.",
    blurbAr: "جودة أعلى للعمل اليومي.",
    sizeLabel: "~4.7 GB",
    params: "8B",
    tier: "mid",
  },
  {
    id: "gemma2-9b",
    ollamaTag: "gemma2:9b",
    name: "Gemma 2 9B",
    nameAr: "Gemma 2 ‏٩ب",
    blurb: "Balanced Google open model.",
    blurbAr: "نموذج جوجل المفتوح المتوازن.",
    sizeLabel: "~5.4 GB",
    params: "9B",
    tier: "mid",
  },
  {
    id: "deepseek-r1-7b",
    ollamaTag: "deepseek-r1:7b",
    name: "DeepSeek R1 7B",
    nameAr: "DeepSeek R1 ‏٧ب",
    blurb: "Reasoning-focused mid model.",
    blurbAr: "يركّز على التفكير المنطقي.",
    sizeLabel: "~4.7 GB",
    params: "7B",
    tier: "mid",
  },
  {
    id: "phi4",
    ollamaTag: "phi4",
    name: "Phi-4",
    nameAr: "Phi-4",
    blurb: "Strong small-lab quality for coding and Q&A.",
    blurbAr: "جودة عالية نسبياً للبرمجة والأسئلة.",
    sizeLabel: "~9.1 GB",
    params: "14B",
    tier: "mid",
  },
  {
    id: "gemma2-27b",
    ollamaTag: "gemma2:27b",
    name: "Gemma 2 27B",
    nameAr: "Gemma 2 ‏٢٧ب",
    blurb: "Upper-mid Google open model.",
    blurbAr: "نموذج جوجل المفتوح في الطبقة العليا المتوسطة.",
    sizeLabel: "~16 GB",
    params: "27B",
    tier: "mid",
  },
  // —— High ——
  {
    id: "qwen2.5-14b",
    ollamaTag: "qwen2.5:14b",
    name: "Qwen 2.5 14B",
    nameAr: "Qwen 2.5 ‏١٤ب",
    blurb: "Strong multilingual — needs more RAM.",
    blurbAr: "متعدد اللغات قوي — يحتاج ذاكرة أكثر.",
    sizeLabel: "~9.0 GB",
    params: "14B",
    tier: "high",
  },
  {
    id: "qwen2.5-coder-14b",
    ollamaTag: "qwen2.5-coder:14b",
    name: "Qwen 2.5 Coder 14B",
    nameAr: "Qwen 2.5 Coder ‏١٤ب",
    blurb: "Code-focused mid-high model.",
    blurbAr: "مركّز على البرمجة في الطبقة العالية.",
    sizeLabel: "~9.0 GB",
    params: "14B",
    tier: "high",
  },
  {
    id: "llama3.1-70b",
    ollamaTag: "llama3.1:70b",
    name: "Llama 3.1 70B",
    nameAr: "Llama 3.1 ‏٧٠ب",
    blurb: "Near cloud quality — desktop/workstation GPU.",
    blurbAr: "قريب من السحابة — يحتاج جهاز قوي.",
    sizeLabel: "~40 GB",
    params: "70B",
    tier: "high",
  },
  {
    id: "mixtral-8x7b",
    ollamaTag: "mixtral:8x7b",
    name: "Mixtral 8×7B",
    nameAr: "Mixtral 8×7B",
    blurb: "MoE quality with higher VRAM needs.",
    blurbAr: "جودة MoE مع احتياج ذاكرة أعلى.",
    sizeLabel: "~26 GB",
    params: "46.7B",
    tier: "high",
  },
  {
    id: "command-r",
    ollamaTag: "command-r",
    name: "Command R",
    nameAr: "Command R",
    blurb: "Enterprise-style RAG and long context.",
    blurbAr: "مناسب للبحث والسياق الطويل.",
    sizeLabel: "~18 GB",
    params: "35B",
    tier: "high",
  },
  {
    id: "mistral-small",
    ollamaTag: "mistral-small",
    name: "Mistral Small",
    nameAr: "Mistral Small",
    blurb: "Capable general model for stronger machines.",
    blurbAr: "نموذج عام قوي للأجهزة الأعلى.",
    sizeLabel: "~14 GB",
    params: "22B",
    tier: "high",
  },
  // —— Max ——
  {
    id: "qwen2.5-32b",
    ollamaTag: "qwen2.5:32b",
    name: "Qwen 2.5 32B",
    nameAr: "Qwen 2.5 ‏٣٢ب",
    blurb: "Top open multilingual — high-end machines.",
    blurbAr: "من أقوى المفتوحات — لأجهزة عالية.",
    sizeLabel: "~20 GB",
    params: "32B",
    tier: "max",
  },
  {
    id: "qwen2.5-72b",
    ollamaTag: "qwen2.5:72b",
    name: "Qwen 2.5 72B",
    nameAr: "Qwen 2.5 ‏٧٢ب",
    blurb: "Largest Qwen open weights — workstation class.",
    blurbAr: "أكبر أوزان Qwen المفتوحة — فئة محطات العمل.",
    sizeLabel: "~47 GB",
    params: "72B",
    tier: "max",
  },
  {
    id: "llama3.3-70b",
    ollamaTag: "llama3.3:70b",
    name: "Llama 3.3 70B",
    nameAr: "Llama 3.3 ‏٧٠ب",
    blurb: "Flagship Meta open weights.",
    blurbAr: "أحدث أوزان ميتا المفتوحة الكبيرة.",
    sizeLabel: "~40 GB",
    params: "70B",
    tier: "max",
    recommended: true,
  },
  {
    id: "deepseek-r1-70b",
    ollamaTag: "deepseek-r1:70b",
    name: "DeepSeek R1 70B",
    nameAr: "DeepSeek R1 ‏٧٠ب",
    blurb: "Heavy reasoning — workstation class.",
    blurbAr: "تفكير ثقيل — فئة محطات العمل.",
    sizeLabel: "~40 GB",
    params: "70B",
    tier: "max",
  },
  {
    id: "command-r-plus",
    ollamaTag: "command-r-plus",
    name: "Command R+",
    nameAr: "Command R+",
    blurb: "Flagship long-context / RAG model.",
    blurbAr: "نموذج رائد للسياق الطويل والبحث.",
    sizeLabel: "~59 GB",
    params: "104B",
    tier: "max",
  },
];

export const LOCAL_TIER_ORDER: LocalModelTier[] = ["low", "mid", "high", "max"];

export const LOCAL_TIER_LABELS: Record<LocalModelTier, { en: string; ar: string }> = {
  low: { en: "Low — fast & light", ar: "منخفض — سريع وخفيف" },
  mid: { en: "Mid — balanced", ar: "متوسط — متوازن" },
  high: { en: "High — quality", ar: "عالي — جودة" },
  max: { en: "Max — flagship", ar: "أقصى — رائد" },
};

export const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";

export type OllamaStatus = {
  online: boolean;
  baseUrl: string;
  version: string | null;
  models: string[];
  error: string | null;
};

function normalizeBase(url: string): string {
  return (url.trim() || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
}

export async function fetchOllamaStatus(baseUrl = DEFAULT_OLLAMA_BASE): Promise<OllamaStatus> {
  const base = normalizeBase(baseUrl);
  try {
    const versionRes = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2500) });
    const tagsRes = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!tagsRes.ok) {
      return {
        online: false,
        baseUrl: base,
        version: null,
        models: [],
        error: `Ollama responded ${tagsRes.status}`,
      };
    }
    const tags = (await tagsRes.json()) as { models?: Array<{ name?: string }> };
    const versionJson = versionRes.ok
      ? ((await versionRes.json()) as { version?: string })
      : null;
    return {
      online: true,
      baseUrl: base,
      version: versionJson?.version ?? null,
      models: (tags.models ?? []).map((item) => item.name).filter(Boolean) as string[],
      error: null,
    };
  } catch (error: unknown) {
    return {
      online: false,
      baseUrl: base,
      version: null,
      models: [],
      error: error instanceof Error ? error.message : "Ollama is offline",
    };
  }
}

export function isCatalogModelInstalled(tag: string, installed: string[]): boolean {
  const needle = tag.toLowerCase();
  const [needleName, needleTag = "latest"] = needle.split(":");
  return installed.some((name) => {
    const n = name.toLowerCase();
    if (n === needle) return true;
    const [installedName, installedTag = "latest"] = n.split(":");
    return installedName === needleName && (needle.includes(":") ? installedTag === needleTag : true);
  });
}

export type PullProgress = {
  status: string;
  completed?: number;
  total?: number;
  percent: number | null;
};

export async function pullOllamaModel(
  tag: string,
  options: {
    baseUrl?: string;
    signal?: AbortSignal;
    onProgress?: (progress: PullProgress) => void;
  } = {},
): Promise<void> {
  const base = normalizeBase(options.baseUrl ?? DEFAULT_OLLAMA_BASE);
  const response = await fetch(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: tag, stream: true }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  if (!response.body) throw new Error("Download returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as {
          status?: string;
          completed?: number;
          total?: number;
          error?: string;
        };
        if (row.error) throw new Error(row.error);
        const percent =
          row.total && row.total > 0 && typeof row.completed === "number"
            ? Math.min(100, Math.round((row.completed / row.total) * 100))
            : null;
        options.onProgress?.({
          status: row.status || "downloading",
          completed: row.completed,
          total: row.total,
          percent,
        });
      } catch (error: unknown) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
}

export function modelsByTier(): Array<{
  tier: LocalModelTier;
  labelEn: string;
  labelAr: string;
  items: LocalModelCatalogEntry[];
}> {
  return LOCAL_TIER_ORDER.map((tier) => ({
    tier,
    labelEn: LOCAL_TIER_LABELS[tier].en,
    labelAr: LOCAL_TIER_LABELS[tier].ar,
    items: LOCAL_MODEL_CATALOG.filter((item) => item.tier === tier),
  }));
}

/** Stream a chat reply from local Ollama (works offline). */
export async function streamOllamaChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onToken: (token: string) => void,
  signal: AbortSignal,
  baseUrl = DEFAULT_OLLAMA_BASE,
): Promise<string> {
  const base = normalizeBase(baseUrl);
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Ollama chat failed (${response.status})`);
  }
  if (!response.body) throw new Error("Ollama returned an empty body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as {
          message?: { content?: string };
          error?: string;
        };
        if (row.error) throw new Error(row.error);
        const token = row.message?.content ?? "";
        if (token) {
          reply += token;
          onToken(token);
        }
      } catch (error: unknown) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
  return reply.trim();
}

