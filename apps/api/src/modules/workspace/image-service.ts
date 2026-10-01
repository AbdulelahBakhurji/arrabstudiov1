import { ServiceUnavailableError, ValidationError } from "@arrab/core";

/** Gemini 3 Flash image model. Chat stays on Arrab; photos always use this. */
export const GEMINI_FLASH_IMAGE_MODEL = "google/gemini-3.1-flash-image";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";

export type GeneratedPhoto = {
  image: string;
  mime: string;
  model: string;
};

export function extractGeneratedImage(payload: unknown): { mime: string; base64: string } | null {
  const urls: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.b64_json === "string" && record.b64_json.length > 32) {
      urls.push(`data:image/png;base64,${record.b64_json}`);
    }
    const direct = typeof record.url === "string" ? record.url : null;
    const nested =
      record.image_url && typeof record.image_url === "object"
        ? (record.image_url as { url?: unknown }).url
        : null;
    const url = direct ?? (typeof nested === "string" ? nested : null);
    if (url?.startsWith("data:image")) urls.push(url);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(payload);
  const first = urls[0];
  if (!first) return null;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(first);
  if (!match?.[1] || !match[2]) return null;
  return { mime: match[1], base64: match[2].replace(/\s/g, "") };
}

export async function generateGeminiFlashPhoto(input: {
  apiKey: string;
  prompt: string;
}): Promise<GeneratedPhoto> {
  const prompt = input.prompt.trim().slice(0, 2000);
  if (prompt.length < 2) throw new ValidationError("A photo prompt is required");
  const response = await fetch(OPENROUTER_CHAT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://arrabai.com",
      "X-Title": "Arrab Studio",
    },
    body: JSON.stringify({
      model: GEMINI_FLASH_IMAGE_MODEL,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: `Generate one photo. Do not describe it in words.\n${prompt}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new ServiceUnavailableError(
      payload?.error?.message ?? "Gemini Flash could not create the photo",
    );
  }
  const image = extractGeneratedImage(payload);
  if (!image) {
    throw new ServiceUnavailableError("Gemini Flash did not return a photo");
  }
  return { image: image.base64, mime: image.mime, model: GEMINI_FLASH_IMAGE_MODEL };
}
