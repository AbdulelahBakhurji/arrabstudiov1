import { useEffect, useState } from "react";
import type { ConnectorProvider, ControlConnector } from "@arrab/shared";
import { arrabApi } from "@/lib/api";

/** Arrab Control's connector catalog — shared by every screen that lists connectors. */

const REFRESH_MS = 60_000;

let cache: ControlConnector[] = [];
let inflight: Promise<void> | null = null;
let lastFetch = 0;
const listeners = new Set<(items: ControlConnector[]) => void>();

function refresh(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - lastFetch < 5_000) return Promise.resolve();
  inflight = arrabApi
    .controlConnectors()
    .then((res) => {
      cache = Array.isArray(res.items) ? res.items : [];
      lastFetch = Date.now();
      for (const listener of listeners) listener(cache);
    })
    // Unreachable Control catalog keeps the built-in listing.
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useControlConnectors(): ControlConnector[] {
  const [items, setItems] = useState(cache);
  useEffect(() => {
    listeners.add(setItems);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refresh(true), REFRESH_MS);
    return () => {
      listeners.delete(setItems);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, []);
  return items;
}

export type CatalogConnector = {
  provider: ConnectorProvider;
  name: string;
  blurb: string;
};

export type CuratedConnector<T extends CatalogConnector> = T & {
  featured: boolean;
  logoUrl: string | null;
};

/**
 * Apply Control's catalog to a built-in connector list: drop hidden providers
 * (unless listed in `keep`, e.g. already linked), override copy and logo, and
 * sort featured first, then by Control's order, then the built-in order.
 */
export function applyControlCatalog<T extends CatalogConnector>(
  items: readonly T[],
  entries: readonly ControlConnector[],
  options: { arabic: boolean; keep?: ReadonlySet<ConnectorProvider> },
): Array<CuratedConnector<T>> {
  const byProvider = new Map(entries.map((entry) => [entry.provider, entry]));
  return items
    .map((item, index) => ({ item, index, entry: byProvider.get(item.provider) }))
    .filter(({ item, entry }) => entry?.status !== "hidden" || options.keep?.has(item.provider))
    .sort((a, b) => {
      const featured = Number(Boolean(b.entry?.featured)) - Number(Boolean(a.entry?.featured));
      if (featured) return featured;
      const orderA = a.entry?.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.entry?.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ item, entry }) => {
      const name = options.arabic ? entry?.nameAr || entry?.name : entry?.name;
      const blurb = options.arabic
        ? entry?.descriptionAr || entry?.description
        : entry?.description;
      return {
        ...item,
        name: name || item.name,
        blurb: blurb || item.blurb,
        featured: Boolean(entry?.featured),
        logoUrl: entry?.logoUrl ?? null,
      };
    });
}
