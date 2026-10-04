/**
 * Saudi-forward companion portraits — premium vector headshots (local PNG).
 * Every catalog preset locks one unique file; gender matches the name.
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

export type PortraitGender = "female" | "male";

/**
 * One unique face per catalog domain. Never reuse a file across presets.
 * Gender is the gender of the illustration (names must match).
 */
export const PRESET_PORTRAITS: Record<
  string,
  { file: string; gender: PortraitGender }
> = {
  health: { file: "pool-03.png", gender: "female" },
  relationships: { file: "saudi-copy-01.png", gender: "female" },
  sleep: { file: "sleep.png", gender: "female" },
  money: { file: "money.png", gender: "male" },
  parents: { file: "pool-01.png", gender: "female" },
  career: { file: "pool-02.png", gender: "male" },
  work: { file: "work.png", gender: "male" },
  meetings: { file: "saudi-wellness-01.png", gender: "female" },
  colleagues: { file: "pool-06.png", gender: "male" },
  chronicler: { file: "pool-08.png", gender: "male" },
  "decision-guard": { file: "saudi-shumagh-01.png", gender: "male" },
  meaning: { file: "pool-12.png", gender: "female" },
  paperwork: { file: "saudi-business-01.png", gender: "male" },
  "daily-decisions": { file: "pool-07.png", gender: "female" },
  study: { file: "study.png", gender: "female" },
  training: { file: "saudi-training-01.png", gender: "male" },
  focus: { file: "focus.png", gender: "male" },
  coder: { file: "coder.png", gender: "male" },
  inbox: { file: "inbox.png", gender: "female" },
  trader: { file: "trader.png", gender: "male" },
  designer: { file: "ui-designer.png", gender: "female" },
  "ui-designer": { file: "ui-designer.png", gender: "female" },
  "ui designer": { file: "ui-designer.png", gender: "female" },
  "arrab-assistant": { file: "arrab-assistant.png", gender: "male" },
  "web-designer": { file: "pool-05.png", gender: "female" },
  "web-design": { file: "pool-05.png", gender: "female" },
  "phone-designer": { file: "pool-10.png", gender: "female" },
  "phone-design": { file: "pool-10.png", gender: "female" },
  "game-designer": { file: "saudi-tech-01.png", gender: "male" },
  game: { file: "saudi-tech-01.png", gender: "male" },
  "3d-modeler": { file: "pool-11.png", gender: "male" },
  "3d-modeling": { file: "pool-11.png", gender: "male" },
  modeling: { file: "pool-11.png", gender: "male" },
  "markets-terminal": { file: "saudi-shumagh-02.png", gender: "male" },
  "financial-expert": { file: "saudi-shumagh-02.png", gender: "male" },
  markets: { file: "saudi-shumagh-02.png", gender: "male" },
  brand: { file: "trader.png", gender: "male" },
  "brand-identity": { file: "trader.png", gender: "male" },
  copywriter: { file: "pool-09.png", gender: "female" },
  "copy-ux": { file: "pool-09.png", gender: "female" },
};

/** @deprecated use PRESET_PORTRAITS — kept for callers that only need the file. */
export const PRESET_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(PRESET_PORTRAITS).map(([key, value]) => [key, value.file]),
);

const FEMALE_POOL = [
  "pool-03.png",
  "pool-01.png",
  "pool-05.png",
  "pool-07.png",
  "pool-09.png",
  "sleep.png",
  "study.png",
  "inbox.png",
  "saudi-copy-01.png",
  "saudi-wellness-01.png",
  "saudi-hijab-01.png",
  "saudi-hijab-02.png",
  "saudi-woman-01.png",
  "ui-designer.png",
  "web-designer.png",
  "phone-designer.png",
  "copywriter.png",
  "saudi-web-01.png",
] as const;

const MALE_POOL = [
  "pool-02.png",
  "pool-04.png",
  "pool-06.png",
  "pool-08.png",
  "pool-10.png",
  "pool-11.png",
  "pool-12.png",
  "money.png",
  "work.png",
  "coder.png",
  "focus.png",
  "trader.png",
  "training.png",
  "saudi-training-01.png",
  "saudi-business-01.png",
  "saudi-tech-01.png",
  "saudi-shumagh-01.png",
  "saudi-shumagh-02.png",
  "saudi-assist-01.png",
  "arrab-assistant.png",
  "brand.png",
  "saudi-brand-01.png",
] as const;

/**
 * Role lanes — preferred faces for what the companion does.
 */
const LANE_POOLS: Record<PortraitLane, readonly string[]> = {
  assistant: ["saudi-assist-01.png", "arrab-assistant.png", "inbox.png", "saudi-hijab-01.png"],
  creative: [
    "web-designer.png",
    "ui-designer.png",
    "phone-designer.png",
    "brand.png",
    "copywriter.png",
    "saudi-copy-01.png",
  ],
  tech: ["coder.png", "saudi-tech-01.png", "focus.png", "saudi-assist-01.png"],
  business: [
    "money.png",
    "work.png",
    "saudi-business-01.png",
    "saudi-shumagh-01.png",
    "pool-02.png",
    "pool-06.png",
  ],
  wellness: [
    "saudi-wellness-01.png",
    "sleep.png",
    "study.png",
    "saudi-training-01.png",
    "pool-03.png",
  ],
  general: [...MALE_POOL.slice(0, 8), ...FEMALE_POOL.slice(0, 8)],
};

const CUSTOM_POOL = [
  ...new Set([...LANE_POOLS.general, ...FEMALE_POOL, ...MALE_POOL]),
] as const;

/** Same face stored under two filenames (studio lock + saudi source). */
const VISUAL_TWINS: Record<string, string[]> = {
  "arrab-assistant.png": ["saudi-assist-01.png", "pool-04.png"],
  "saudi-assist-01.png": ["arrab-assistant.png", "pool-04.png"],
  "pool-04.png": ["arrab-assistant.png", "saudi-assist-01.png"],
  "web-designer.png": ["saudi-web-01.png", "ui-designer.png"],
  "saudi-web-01.png": ["web-designer.png", "ui-designer.png"],
  "ui-designer.png": ["web-designer.png", "saudi-web-01.png"],
  "phone-designer.png": ["saudi-hijab-02.png", "pool-07.png"],
  "saudi-hijab-02.png": ["phone-designer.png", "pool-07.png"],
  "pool-07.png": ["phone-designer.png", "saudi-hijab-02.png"],
  "brand.png": ["saudi-brand-01.png", "pool-11.png"],
  "saudi-brand-01.png": ["brand.png", "pool-11.png"],
  "pool-11.png": ["brand.png", "saudi-brand-01.png"],
  "copywriter.png": ["saudi-copy-01.png"],
  "saudi-copy-01.png": ["copywriter.png"],
  "training.png": ["saudi-training-01.png"],
  "saudi-training-01.png": ["training.png"],
  "pool-01.png": ["saudi-hijab-01.png"],
  "saudi-hijab-01.png": ["pool-01.png"],
  "pool-05.png": ["saudi-woman-01.png"],
  "saudi-woman-01.png": ["pool-05.png"],
  "coder.png": ["saudi-tech-01.png"],
  "saudi-tech-01.png": ["coder.png"],
};

const PORTRAIT_VERSION = "saudi-vector-v7";

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

export function portraitGenderForFile(file: string): PortraitGender | null {
  const base = file.replace(/^.*\//, "");
  const preset = Object.values(PRESET_PORTRAITS).find((item) => item.file === file || item.file === base);
  if (preset) return preset.gender;
  if (/gen-.*-f-\d+/i.test(base) || /[-_]f[-_]/i.test(base)) return "female";
  if (/gen-.*-m-\d+/i.test(base) || /[-_]m[-_]/i.test(base)) return "male";
  if ((FEMALE_POOL as readonly string[]).includes(file) || (FEMALE_POOL as readonly string[]).includes(base)) {
    return "female";
  }
  if ((MALE_POOL as readonly string[]).includes(file) || (MALE_POOL as readonly string[]).includes(base)) {
    return "male";
  }
  if (/hijab|woman|copy|wellness|sleep|study|inbox|designer|phone/i.test(base)) {
    return "female";
  }
  if (/shumagh|business|tech|training|coder|money|work|trader|focus|assist|brand/i.test(base)) {
    return "male";
  }
  return null;
}

export function portraitGenderForDomain(domain: string): PortraitGender | null {
  return PRESET_PORTRAITS[domainKey(domain)]?.gender ?? null;
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
    key.includes("paperwork")
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
    key.includes("meaning")
  ) {
    return "wellness";
  }
  return "general";
}

export function portraitFileFromUrl(url: string | null | undefined): string | null {
  const src = url?.trim() ?? "";
  const match = src.match(/\/companions\/portraits\/([^?#]+)/);
  return match?.[1]?.replace(/\/+$/, "") ?? null;
}

function normalizePortraitKey(url: string): string {
  return portraitFileFromUrl(url) ?? url.split("?")[0]!;
}

export function presetPortraitFile(domain: string): string | null {
  return PRESET_PORTRAITS[domainKey(domain)]?.file ?? null;
}

function markTaken(takenFiles: Set<string>, file: string): void {
  takenFiles.add(file);
  for (const twin of VISUAL_TWINS[file] ?? []) takenFiles.add(twin);
}

function resolveTakenPortraitFile(item: string): string | null {
  const fromUrl = portraitFileFromUrl(item);
  if (fromUrl) return fromUrl;
  const cleaned = item.trim().split("?")[0]?.replace(/^\//, "") ?? "";
  if (!cleaned) return null;
  const nested = cleaned.match(/companions\/portraits\/(.+)$/);
  if (nested?.[1]) return nested[1];
  return cleaned;
}

/** All portrait files already claimed by live companions / catalog. */
export function collectTakenPortraitFiles(taken: Iterable<string>): Set<string> {
  const takenFiles = new Set<string>();
  for (const item of taken) {
    const file = resolveTakenPortraitFile(item);
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
 * Presets lock their catalog face when still free; otherwise gender-matched pool.
 */
export function allocateUniquePortrait(input: {
  domain: string;
  name: string;
  faceSeed?: number;
  purposeId?: string;
  gender?: PortraitGender | null;
  /** Portrait URLs or file names already taken by live companions. */
  taken: Iterable<string>;
}): { faceSeed: number; avatarPhoto: string; file: string } {
  const key = domainKey(input.domain);
  const takenFiles = collectTakenPortraitFiles(input.taken);

  const faceSeed =
    typeof input.faceSeed === "number"
      ? Math.abs(Math.floor(input.faceSeed)) % 4096
      : hashSeed([key, input.name, Date.now(), Math.random()]) % 4096;

  const preset = PRESET_PORTRAITS[key];
  if (preset && !takenFiles.has(preset.file)) {
    return {
      faceSeed: input.faceSeed ?? presetPortraitSeed(key),
      avatarPhoto: portraitAssetUrl(preset.file),
      file: preset.file,
    };
  }

  const gender = input.gender ?? preset?.gender ?? null;
  const genderPool = gender === "female" ? FEMALE_POOL : gender === "male" ? MALE_POOL : null;
  if (genderPool) {
    const fromGender = pickFromPool(genderPool, takenFiles, faceSeed);
    if (fromGender) {
      return { faceSeed, avatarPhoto: portraitAssetUrl(fromGender), file: fromGender };
    }
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

  // Exhausted — mint a unique cache-busted alias so the URL stays distinct.
  const fallbackSeed = hashSeed([faceSeed, input.name, Date.now(), Math.random()]) % 4096;
  const file = preferred[fallbackSeed % preferred.length]!;
  return {
    faceSeed: fallbackSeed,
    avatarPhoto: `${portraitAssetUrl(file)}&u=${fallbackSeed}`,
    file,
  };
}

/** Resolve display URL for catalog presets (locked unique face). */
export function companionPortraitUrl(input: {
  seed: number;
  name: string;
  domain?: string;
  size?: number;
  hue?: number;
}): string {
  const key = domainKey(input.domain ?? "");
  const preset = PRESET_PORTRAITS[key];
  if (preset) return portraitAssetUrl(preset.file);

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
  if (PRESET_PORTRAITS[key]) {
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

/** Countries offered in the create-companion portrait wizard. */
export type PortraitCountryId =
  | "sa"
  | "ae"
  | "eg"
  | "jo"
  | "ma"
  | "us"
  | "gb"
  | "fr"
  | "de"
  | "in"
  | "tr";

export type PortraitLook = "gulf" | "arab" | "in" | "tr" | "eu" | "us";

export const PORTRAIT_COUNTRIES: readonly {
  id: PortraitCountryId;
  nameEn: string;
  nameAr: string;
  /** Illustrated look family — never mix (e.g. India must not get shemagh). */
  look: PortraitLook;
}[] = [
  { id: "sa", nameEn: "Saudi Arabia", nameAr: "السعودية", look: "gulf" },
  { id: "ae", nameEn: "United Arab Emirates", nameAr: "الإمارات", look: "gulf" },
  { id: "eg", nameEn: "Egypt", nameAr: "مصر", look: "arab" },
  { id: "jo", nameEn: "Jordan", nameAr: "الأردن", look: "arab" },
  { id: "ma", nameEn: "Morocco", nameAr: "المغرب", look: "arab" },
  { id: "tr", nameEn: "Türkiye", nameAr: "تركيا", look: "tr" },
  { id: "in", nameEn: "India", nameAr: "الهند", look: "in" },
  { id: "us", nameEn: "United States", nameAr: "الولايات المتحدة", look: "us" },
  { id: "gb", nameEn: "United Kingdom", nameAr: "المملكة المتحدة", look: "eu" },
  { id: "fr", nameEn: "France", nameAr: "فرنسا", look: "eu" },
  { id: "de", nameEn: "Germany", nameAr: "ألمانيا", look: "eu" },
] as const;

const G = (name: string) => `generated/${name}.jpg`;

/** Gender-locked catalog-style faces — verified local JPEGs only. */
const PRIVATE_POOLS: Record<`${PortraitLook}_${PortraitGender}`, readonly string[]> = {
  gulf_male: [
    G("gen-gulf-m-01"),
    G("gen-gulf-m-02"),
    G("gen-gulf-m-03"),
    G("gen-arab-m-01"),
    G("gen-arab-m-02"),
    "pool-04.png",
  ],
  gulf_female: [
    G("gen-gulf-f-01"),
    G("gen-gulf-f-02"),
    G("gen-gulf-f-03"),
    G("gen-arab-f-02"),
    G("gen-arab-f-01"),
  ],
  arab_male: [
    G("gen-arab-m-01"),
    G("gen-arab-m-02"),
    "pool-04.png",
    G("gen-tr-m-01"),
    G("gen-eu-m-01"),
  ],
  arab_female: [
    G("gen-arab-f-01"),
    G("gen-arab-f-02"),
    G("gen-gulf-f-01"),
    G("gen-gulf-f-03"),
    G("gen-tr-f-01"),
  ],
  in_male: [G("gen-in-m-01"), G("gen-in-m-02"), G("gen-in-m-03")],
  in_female: [G("gen-in-f-01"), G("gen-in-f-02"), G("gen-in-f-03")],
  tr_male: [G("gen-tr-m-01"), G("gen-eu-m-01"), G("gen-arab-m-01"), G("gen-eu-m-03")],
  tr_female: [G("gen-tr-f-01"), G("gen-tr-f-02"), G("gen-eu-f-01")],
  eu_male: [G("gen-eu-m-01"), G("gen-eu-m-02"), G("gen-eu-m-03"), G("gen-tr-m-01")],
  eu_female: [G("gen-eu-f-01"), G("gen-eu-f-02"), G("gen-tr-f-01"), G("gen-us-f-01")],
  us_male: [G("gen-us-m-01"), G("gen-us-m-02"), G("gen-eu-m-01"), G("gen-eu-m-02")],
  us_female: [G("gen-us-f-01"), G("gen-us-f-02"), G("gen-eu-f-01"), G("gen-eu-f-02")],
};

function poolForLook(gender: PortraitGender, look: PortraitLook): readonly string[] {
  const pool = PRIVATE_POOLS[`${look}_${gender}`];
  // Strict gender filter — never leak a wrong-gender face into the shelf.
  return pool.filter((file) => portraitGenderForFile(file) === gender);
}

function orderedPool(pool: readonly string[], faceSeed: number): readonly string[] {
  if (pool.length === 0) return pool;
  const start = faceSeed % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)];
}

/** Every catalog preset face — custom companions must never reuse these. */
export function catalogPortraitFiles(): string[] {
  return [...new Set(Object.values(PRESET_PORTRAITS).map((item) => item.file))];
}

/**
 * Mint a private companion picture — same illustrated style as the companion list.
 * Country + gender pick a verified local pool. Never reuse a live companion or catalog face.
 * Never crosses country looks (India never gets Gulf attire).
 */
export async function createPrivatePortrait(input: {
  country: PortraitCountryId;
  gender: PortraitGender;
  name: string;
  domain: string;
  purposeId?: string;
  taken: Iterable<string>;
  /** Force a new face even if the previous one is still free. */
  forceNew?: boolean;
}): Promise<{ avatarPhoto: string; faceSeed: number; file: string }> {
  const country = PORTRAIT_COUNTRIES.find((item) => item.id === input.country);
  const look: PortraitLook = country?.look ?? "eu";
  const faceSeed =
    hashSeed([
      input.country,
      look,
      input.gender,
      input.name,
      Date.now(),
      Math.random(),
      input.forceNew ? "new" : "base",
    ]) % 4096;

  // Live companions + draft + every catalog preset face.
  const takenFiles = collectTakenPortraitFiles([
    ...input.taken,
    ...catalogPortraitFiles(),
  ]);

  const countryPool = orderedPool(poolForLook(input.gender, look), faceSeed);
  if (countryPool.length === 0) {
    throw new Error("portrait-pool-empty");
  }

  const picked = pickFromPool(countryPool, takenFiles, faceSeed);
  if (picked) {
    return {
      faceSeed,
      avatarPhoto: portraitFileUrl(picked),
      file: picked,
    };
  }

  // Same look + gender only — never cross into another country look.
  const sameLookFallback = pickFromPool(
    poolForLook(input.gender, look),
    takenFiles,
    faceSeed + 31,
  );
  if (sameLookFallback) {
    return {
      faceSeed,
      avatarPhoto: portraitFileUrl(sameLookFallback),
      file: sameLookFallback,
    };
  }

  // Last resort: unused face in this look ignoring catalog locks, still unique vs live.
  const liveOnly = collectTakenPortraitFiles(input.taken);
  const relaxed = pickFromPool(countryPool, liveOnly, faceSeed + 63);
  if (relaxed) {
    return {
      faceSeed,
      avatarPhoto: portraitFileUrl(relaxed),
      file: relaxed,
    };
  }

  // Absolute last: stay inside the country look pool.
  const file = countryPool[faceSeed % countryPool.length]!;
  return {
    faceSeed,
    avatarPhoto: `${portraitFileUrl(file)}&u=${faceSeed}`,
    file,
  };
}

/** Gender-locked faces available for a country (for shelves / diagnostics). */
export function privatePortraitPool(
  country: PortraitCountryId,
  gender: PortraitGender,
): readonly string[] {
  const look = PORTRAIT_COUNTRIES.find((item) => item.id === country)?.look ?? "eu";
  return poolForLook(gender, look);
}

export { normalizePortraitKey, CUSTOM_POOL, LANE_POOLS, FEMALE_POOL, MALE_POOL };
