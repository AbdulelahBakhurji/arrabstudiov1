import { useEffect } from "react";
import {
  getCompanionState,
  updateCompanion,
  useCompanionState,
} from "@/lib/companions";
import { COMPANION_PRESETS } from "@/lib/companion-catalog";
import { STUDIO_DEFAULTS } from "@/lib/studio-catalog";
import {
  allocateUniquePortrait,
  collectTakenPortraitFiles,
  portraitFileFromUrl,
  presetPortraitFile,
  presetPortraitSeed,
  resolveCompanionPortraitSrc,
} from "@/lib/companion-portrait";

const PRESET_HUES: Record<string, number> = {
  "arrab-assistant": 258,
  "web-designer": 268,
  "phone-designer": 336,
  brand: 28,
  copywriter: 188,
  sleep: 248,
  money: 148,
  work: 28,
  study: 208,
  training: 336,
  focus: 188,
  coder: 268,
  inbox: 48,
  trader: 158,
  designer: 312,
  "ui-designer": 312,
};

/** Saudi-forward unique portraits (shumagh / hijab mix + role lanes). */
const MIGRATION_FLAG = "arrab.portraits.saudi-v1";

function isLegacyPoolFace(file: string | null): boolean {
  if (!file) return true;
  return file.startsWith("pool-") || file.startsWith("mena-");
}

/**
 * Ensure every live companion has a locked unique Saudi avatar.
 * Studio kinds and catalog presets never share a face.
 */
export function migrateExistingCompanionPortraits(): void {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === "1") return;
  } catch {
    /* ignore */
  }

  const state = getCompanionState();
  const live = state.companions.filter(
    (person) => !person.archivedAt && person.domain !== "general",
  );
  const taken: string[] = STUDIO_DEFAULTS.map((entry) => entry.avatarPhoto).filter(
    (url): url is string => Boolean(url?.trim()),
  );

  for (const person of live) {
    const catalogPreset = COMPANION_PRESETS.find(
      (item) => item.domain.toLowerCase() === person.domain.toLowerCase(),
    );
    const dedicated = presetPortraitFile(person.domain);

    if (dedicated) {
      const allocated = allocateUniquePortrait({
        domain: person.domain,
        name: person.name,
        purposeId: person.purposeId || person.domain,
        faceSeed: catalogPreset
          ? presetPortraitSeed(catalogPreset.id)
          : presetPortraitSeed(person.domain),
        taken: [],
      });
      updateCompanion(person.id, {
        faceSeed: allocated.faceSeed,
        avatarPhoto: allocated.avatarPhoto,
        hue: PRESET_HUES[person.domain] ?? PRESET_HUES[catalogPreset?.id ?? ""] ?? person.hue,
      });
      taken.push(allocated.avatarPhoto);
      continue;
    }

    const current = resolveCompanionPortraitSrc(person);
    const currentFile = portraitFileFromUrl(current);
    const takenFiles = collectTakenPortraitFiles(taken);
    const clash = Boolean(currentFile && takenFiles.has(currentFile));
    const missing = !person.avatarPhoto?.trim();
    const legacy = isLegacyPoolFace(currentFile);

    if (missing || clash || legacy) {
      const allocated = allocateUniquePortrait({
        domain: person.domain,
        name: person.name,
        purposeId: person.purposeId || person.domain,
        faceSeed: person.faceSeed,
        taken,
      });
      updateCompanion(person.id, {
        faceSeed: allocated.faceSeed,
        avatarPhoto: allocated.avatarPhoto,
      });
      taken.push(allocated.avatarPhoto);
    } else {
      taken.push(current);
    }
  }

  try {
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    /* ignore */
  }
}

/** Migrates existing companions so each has a unique Saudi vector face. */
export function useEnsureRealisticPortraits(): void {
  useCompanionState();

  useEffect(() => {
    migrateExistingCompanionPortraits();
  }, []);
}
