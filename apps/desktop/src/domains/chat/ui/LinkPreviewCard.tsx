import { useEffect, useState } from "react";
import { arrabApi } from "@/core/api/api";
import { safeHttpUrl } from "@/shared/lib/safe-url";

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
};

const cache = new Map<string, LinkPreview | null>();

export async function unfurlLink(rawUrl: string): Promise<LinkPreview | null> {
  const url = safeHttpUrl(rawUrl.trim());
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  try {
    const result = await arrabApi.unfurlUrl(url);
    if ("error" in result && result.error) {
      cache.set(url, null);
      return null;
    }
    const preview: LinkPreview = {
      url: result.url || url,
      title: (result.title || url).slice(0, 160),
      description: (result.description || "").slice(0, 280),
      image: result.image && safeHttpUrl(result.image) ? result.image : null,
      siteName: (result.siteName || "").slice(0, 80),
    };
    cache.set(url, preview);
    return preview;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(() =>
    cache.has(url) ? cache.get(url) : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (preview !== undefined) return;
    void unfurlLink(url).then((next) => {
      if (!cancelled) setPreview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url, preview]);

  if (preview === undefined) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="chat-link-preview is-loading">
        <span className="chat-link-preview-url">{url}</span>
      </a>
    );
  }
  if (!preview) return null;

  return (
    <a href={preview.url} target="_blank" rel="noreferrer" className="chat-link-preview">
      {preview.image ? (
        <span className="chat-link-preview-media">
          <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </span>
      ) : null}
      <span className="chat-link-preview-copy">
        {preview.siteName ? <small>{preview.siteName}</small> : null}
        <strong>{preview.title}</strong>
        {preview.description ? <em>{preview.description}</em> : null}
      </span>
    </a>
  );
}
