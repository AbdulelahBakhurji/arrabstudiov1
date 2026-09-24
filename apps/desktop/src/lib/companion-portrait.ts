/**
 * Saudi-forward companion portraits — premium vector headshots (local PNG).
 * Mix of shumagh / modern men and hijab / uncovered women.
 * Every companion gets a unique face; new ones prefer a role-related lane.
 */

function hashSeed(parts: Array<string | number>): number {
  let h = 2166136261;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return Math.abs(h >>> 0);
}

/** Stable seed for a catalog preset id. */
export function presetPortraitSeed(id: string): number {
  return hashSeed(["preset", id]) % 4096;
}

export type PortraitLane =
  | "assistant"
  | "creative"
  | "tech"
  | "business"
  | "wellness"
  | "general";

/** Dedicated faces — one unique file per known domain. Never shared. */
const PRESET_FILES: Record<string, string> = {
  "arrab-assistant": "arrab-assistant.png",
  "web-designer": "web-designer.png",
  "phone-designer": "phone-designer.png",
  brand: "brand.png",
  copywriter: "copywriter.png",
  sleep: "saudi-wellness-01.png",
  health: "pool-03.png",
  ivy: "pool-03.png",
  money: "saudi-business-01.png",
  sam: "saudi-business-01.png",
  relationships: "saudi-copy-01.png",
  maya: "saudi-copy-01.png",
  parents: "pool-05.png",
  june: "pool-05.png",
  career: "pool-02.png",
  marcus: "pool-02.png",
  chronicler: "pool-08.png",
  work: "saudi-shumagh-02.png",
  meetings: "pool-04.png",
  colleagues: "pool-06.png",
  "decision-guard": "pool-10.png",
  meaning: "pool-11.png",
  paperwork: "pool-12.png",
  "daily-decisions": "pool-07.png",
  study: "saudi-woman-01.png",
  training: "saudi-training-01.png",
  focus: "saudi-hijab-01.png",
  coder: "saudi-tech-01.png",
  inbox: "saudi-assist-01.png",
  trader: "saudi-shumagh-01.png",
  designer: "web-designer.png",
  "ui-designer": "web-designer.png",
  "ui designer": "web-designer.png",
};

/**
 * Role lanes — preferred faces for what the companion does.
 * Includes Saudi shumagh (a couple of men), hijab + non-hijab women.
 */
const LANE_POOLS: Record<PortraitLane, readonly string[]> = {
  assistant: [
    "saudi-assist-01.png",
    "arrab-assistant.png",
    "saudi-shumagh-01.png",
    "saudi-hijab-01.png",
    "saudi-woman-01.png",
  ],
  creative: [
    "saudi-web-01.png",
    "web-designer.png",
    "saudi-brand-01.png",
    "brand.png",
    "saudi-copy-01.png",
    "copywriter.png",
    "saudi-hijab-02.png",
    "phone-designer.png",
    "saudi-woman-01.png",
  ],
  tech: [
    "saudi-tech-01.png",
    "saudi-web-01.png",
    "saudi-assist-01.png",
    "saudi-training-01.png",
    "saudi-hijab-01.png",
  ],
  business: [
    "saudi-business-01.png",
    "saudi-shumagh-01.png",
    "saudi-shumagh-02.png",
    "saudi-hijab-02.png",
  ],
  wellness: [
    "saudi-wellness-01.png",
    "saudi-hijab-01.png",
    "saudi-training-01.png",
    "saudi-woman-01.png",
  ],
  general: [
    "saudi-assist-01.png",
    "saudi-shumagh-01.png",
    "saudi-shumagh-02.png",
    "saudi-hijab-01.png",
    "saudi-hijab-02.png",
    "saudi-woman-01.png",
    "saudi-tech-01.png",
    "saudi-copy-01.png",
    "saudi-brand-01.png",
    "saudi-web-01.png",
    "saudi-wellness-01.png",
    "saudi-business-01.png",
    "saudi-training-01.png",
  ],
};

const CUSTOM_POOL = LANE_POOLS.general;

/** Same face stored under two filenames (studio lock + saudi source). */
const VISUAL_TWINS: Record<string, string[]> = {
  "arrab-assistant.png": ["saudi-assist-01.png"],
  "saudi-assist-01.png": ["arrab-assistant.png"],
  "web-designer.png": ["saudi-web-01.png"],
  "saudi-web-01.png": ["web-designer.png"],
  "phone-designer.png": ["saudi-hijab-02.png"],
  "saudi-hijab-02.png": ["phone-designer.png"],
  "brand.png": ["saudi-brand-01.png"],
  "saudi-brand-01.png": ["brand.png"],
  "copywriter.png": ["saudi-copy-01.png"],
  "saudi-copy-01.png": ["copywriter.png"],
};

const PORTRAIT_VERSION = "saudi-vector-v3";

/** Public URL for a portrait file under /companions/portraits. */
export function portraitFileUrl(file: string): string {
  return `/companions/portraits/${file}?v=${PORTRAIT_VERSION}`;
}

function portraitAssetUrl(file: string): string {
  return portraitFileUrl(file);
}

function domainKey(domain: string): string {
  return domain.toLowerCase().trim().replace(/\s+/g, "-");
}

/** Map purpose / domain text → portrait lane (what they do). */
export function portraitLaneFor(domainOrPurpose: string): PortraitLane {
  const key = domainKey(domainOrPurpose);
  if (
    key.includes("arrab-assistant") ||
    key === "assistant" ||
    key.includes("inbox") ||
    key === "general"
  ) {
    return "assistant";
  }
  if (
    key.includes("web") ||
    key.includes("phone") ||
    key.includes("brand") ||
    key.includes("copy") ||
    key.includes("design") ||
    key.includes("ui") ||
    key.includes("product")
  ) {
    return "creative";
  }
  if (key.includes("coder") || key.includes("code") || key.includes("dev") || key.includes("tech")) {
    return "tech";
  }
  if (
    key.includes("money") ||
    key.includes("trader") ||
    key.includes("work") ||
    key.includes("business") ||
    key.includes("finance") ||
    key.includes("career") ||
    key.includes("meeting") ||
    key.includes("colleague") ||
    key.includes("paperwork") ||
    key.includes("sam") ||
    key.includes("marcus")
  ) {
    return "business";
  }
  if (
    key.includes("sleep") ||
    key.includes("training") ||
    key.includes("focus") ||
    key.includes("study") ||
    key.includes("health") ||
    key.includes("wellness") ||
    key.includes("diet") ||
    key.includes("meaning") ||
    key.includes("ivy")
  ) {
    return "wellness";
  }
  return "general";
}

export function portraitFileFromUrl(url: string | null | undefined): string | null {
  const src = url?.trim() ?? "";
  const match = src.match(/\/companions\/portraits\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function normalizePortraitKey(url: string): string {
  return portraitFileFromUrl(url) ?? url.split("?")[0]!;
}

export function presetPortraitFile(domain: string): string | null {
  return PRESET_FILES[domainKey(domain)] ?? null;
}

function markTaken(takenFiles: Set<string>, file: string): void {
  takenFiles.add(file);
  for (const twin of VISUAL_TWINS[file] ?? []) takenFiles.add(twin);
}

/** All portrait files already claimed by live companions / catalog. */
export function collectTakenPortraitFiles(taken: Iterable<string>): Set<string> {
  const takenFiles = new Set<string>();
  for (const item of taken) {
    const file = portraitFileFromUrl(item) ?? item.replace(/^.*\//, "").split("?")[0];
    if (file) markTaken(takenFiles, file);
  }
  return takenFiles;
}

function pickFromPool(
  pool: readonly string[],
  takenFiles: Set<string>,
  faceSeed: number,
): string | null {
  const start = faceSeed % pool.length;
  for (let offset = 0; offset < pool.length; offset += 1) {
    const file = pool[(start + offset) % pool.length]!;
    if (!takenFiles.has(file)) return file;
  }
  return null;
}

/**
 * Pick a portrait file that no other companion is already using.
 * Prefers a role-related Saudi face (shumagh / hijab mix included).
 */
export function allocateUniquePortrait(input: {
  domain: string;
  name: string;
  faceSeed?: number;
  purposeId?: string;
  /** Portrait URLs or file names already taken by live companions. */
  taken: Iterable<string>;
}): { faceSeed: number; avatarPhoto: string; file: string } {
  const key = domainKey(input.domain);
  const takenFiles = collectTakenPortraitFiles(input.taken);

  const faceSeed =
    typeof input.faceSeed === "number"
      ? Math.abs(Math.floor(input.faceSeed)) % 4096
      : hashSeed([key, input.name, Date.now(), Math.random()]) % 4096;

  const preset = PRESET_FILES[key];
  if (preset) {
    return {
      faceSeed: input.faceSeed ?? presetPortraitSeed(key),
      avatarPhoto: portraitAssetUrl(preset),
      file: preset,
    };
  }

  const lane = portraitLaneFor(input.purposeId || key);
  const preferred = LANE_POOLS[lane];
  const fromLane = pickFromPool(preferred, takenFiles, faceSeed);
  if (fromLane) {
    return { faceSeed, avatarPhoto: portraitAssetUrl(fromLane), file: fromLane };
  }

  const fromGeneral = pickFromPool(CUSTOM_POOL, takenFiles, faceSeed + 17);
  if (fromGeneral) {
    return { faceSeed, avatarPhoto: portraitAssetUrl(fromGeneral), file: fromGeneral };
  }

  const fallbackSeed = hashSeed([faceSeed, input.name, Date.now()]) % 4096;
  const file = preferred[fallbackSeed % preferred.length]!;
  return {
    faceSeed: fallbackSeed,
    avatarPhoto: portraitAssetUrl(file),
    file,
  };
}

/** Resolve display URL for catalog presets (no ownership yet). */
export function companionPortraitUrl(input: {
  seed: number;
  name: string;
  domain?: string;
  size?: number;
  hue?: number;
}): string {
  const key = domainKey(input.domain ?? "");
  const preset = PRESET_FILES[key];
  if (preset) return portraitAssetUrl(preset);

  const lane = portraitLaneFor(key);
  const pool = LANE_POOLS[lane];
  const seed = hashSeed([PORTRAIT_VERSION, input.seed, key, input.name.trim().toLowerCase()]);
  const file = pool[seed % pool.length]!;
  return portraitAssetUrl(file);
}

/**
 * Allocate a unique face for a new Studio catalog entry.
 * Role-related when possible; never reuses a taken face.
 */
export function allocateStudioCatalogPortrait(input: {
  id: string;
  domain: string;
  name: string;
  purposeId?: string;
  faceSeed?: number;
  taken: Iterable<string>;
}): { faceSeed: number; avatarPhoto: string; file: string } {
  const key = domainKey(input.domain);
  if (PRESET_FILES[key]) {
    return allocateUniquePortrait({
      domain: input.domain,
      name: input.name,
      purposeId: input.purposeId,
      faceSeed: input.faceSeed ?? presetPortraitSeed(input.id || key),
      taken: input.taken,
    });
  }
  return allocateUniquePortrait({
    domain: `custom-${input.id || key}`,
    name: input.name,
    purposeId: input.purposeId || key,
    faceSeed: input.faceSeed ?? hashSeed([input.id, input.name, Date.now()]) % 4096,
    taken: input.taken,
  });
}

/** Prefer locked avatarPhoto; otherwise resolve from domain/seed. */
export function resolveCompanionPortraitSrc(person: {
  name: string;
  domain?: string;
  faceSeed: number;
  hue?: number;
  avatarPhoto?: string | null;
}): string {
  const uploaded = person.avatarPhoto?.trim();
  if (uploaded) return uploaded;
  return companionPortraitUrl({
    seed: person.faceSeed,
    name: person.name,
    domain: person.domain,
    hue: person.hue,
  });
}

export function isRemotePortraitUrl(value: string | null | undefined): boolean {
  const src = value?.trim() ?? "";
  if (!src) return false;
  return (
    src.includes("randomuser.me/") ||
    src.includes("pravatar.cc/") ||
    src.includes("pollinations.ai/") ||
    src.includes("dicebear.com/")
  );
}

export function isLegacyPhotoDataUrl(value: string | null | undefined): boolean {
  const src = value?.trim() ?? "";
  return (
    src.startsWith("data:image/jpeg") ||
    src.startsWith("data:image/webp") ||
    src.startsWith("data:image/png") ||
    src.startsWith("data:image/svg+xml")
  );
}

export function isVectorDataUrl(value: string | null | undefined): boolean {
  const src = value?.trim() ?? "";
  return src.startsWith("data:image/svg+xml");
}

export async function fetchPortraitDataUrl(url: string): Promise<string> {
  if (url.startsWith("/") || url.startsWith("data:")) return url;
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`portrait-http-${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("portrait-read-failed"));
    };
    reader.onerror = () => reject(new Error("portrait-read-failed"));
    reader.readAsDataURL(blob);
  });
}

export { normalizePortraitKey, CUSTOM_POOL, PRESET_FILES, LANE_POOLS };
