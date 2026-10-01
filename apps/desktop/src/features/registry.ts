import type { PlanAudience } from "@arrab/shared";
import { isFeatureEnabled, registerFeatureFlag } from "./flags";
import { RESERVED_FEATURE_PATHS, type StudioFeature } from "./types";

type FeatureModule = { feature?: StudioFeature };

const discovered = import.meta.glob<FeatureModule>("./modules/*/index.ts", {
  eager: true,
});

function loadFeatures(): StudioFeature[] {
  const seen = new Set<string>();
  const features: StudioFeature[] = [];
  for (const [file, mod] of Object.entries(discovered)) {
    const item = mod.feature;
    if (!item) continue;
    if (RESERVED_FEATURE_PATHS.has(item.path)) {
      console.warn(`[features] skipped reserved path "${item.path}" from ${file}`);
      continue;
    }
    if (seen.has(item.id) || seen.has(item.path)) {
      console.warn(`[features] skipped duplicate "${item.id}" from ${file}`);
      continue;
    }
    seen.add(item.id);
    seen.add(item.path);
    if (item.flag) registerFeatureFlag(item.flag, false);
    features.push(item);
  }
  return features;
}

export const STUDIO_FEATURES: StudioFeature[] = loadFeatures();

export function isFeatureVisible(
  feature: StudioFeature,
  opts?: { isFamilyChild?: boolean },
): boolean {
  if (feature.flag && !isFeatureEnabled(feature.flag)) return false;
  if (opts?.isFamilyChild && feature.hideForFamilyChild) return false;
  return true;
}

export function pageFeaturesFor(
  audience: PlanAudience,
  opts?: { isFamilyChild?: boolean },
): StudioFeature[] {
  return STUDIO_FEATURES.filter(
    (feature) =>
      feature.kind === "page" &&
      feature.audiences.includes(audience) &&
      isFeatureVisible(feature, opts),
  );
}

export function navFeaturesFor(
  audience: PlanAudience,
  opts?: { isFamilyChild?: boolean },
): StudioFeature[] {
  return pageFeaturesFor(audience, opts).filter((feature) => feature.nav);
}
