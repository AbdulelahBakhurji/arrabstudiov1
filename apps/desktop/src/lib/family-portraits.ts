import type { FamilyAgeTier, FamilyMemberRole } from "@arrab/shared";
import { portraitFileUrl } from "@/lib/companion-portrait";
import { getChildSeatPrefs } from "@/lib/guardian-store";
import { getProfilePhoto } from "@/lib/profile-photo";

/** Gender used to filter family seat portraits. */
export type FamilyPortraitGender = "boy" | "girl" | "man" | "woman";

export type FamilyPortrait = {
  /** Stable id = filename without extension (stored as avatarKey). */
  id: string;
  file: string;
  gender: FamilyPortraitGender;
  /** Adult seats only see adult; kids filter by age tier. */
  kind: "adult" | "child";
  /** Age tiers this face suits (child only). */
  ageTiers?: FamilyAgeTier[];
};

/**
 * Family seat faces.
 * Adults: companion portrait set.
 * Kids: dedicated generated child/teen portraits (not adult companion faces).
 */
export const FAMILY_PORTRAITS: FamilyPortrait[] = [
  // —— Adults (parents / partners) — companion portrait set
  { id: "saudi-shumagh-01", file: "saudi-shumagh-01.png", gender: "man", kind: "adult" },
  { id: "saudi-shumagh-02", file: "saudi-shumagh-02.png", gender: "man", kind: "adult" },
  { id: "saudi-business-01", file: "saudi-business-01.png", gender: "man", kind: "adult" },
  { id: "saudi-tech-01", file: "saudi-tech-01.png", gender: "man", kind: "adult" },
  { id: "saudi-assist-01", file: "saudi-assist-01.png", gender: "man", kind: "adult" },
  { id: "saudi-training-01", file: "saudi-training-01.png", gender: "man", kind: "adult" },
  { id: "pool-02", file: "pool-02.png", gender: "man", kind: "adult" },
  { id: "pool-04", file: "pool-04.png", gender: "man", kind: "adult" },
  { id: "pool-06", file: "pool-06.png", gender: "man", kind: "adult" },
  { id: "pool-08", file: "pool-08.png", gender: "man", kind: "adult" },
  { id: "training", file: "training.png", gender: "man", kind: "adult" },
  { id: "work", file: "work.png", gender: "man", kind: "adult" },
  { id: "focus", file: "focus.png", gender: "man", kind: "adult" },
  { id: "coder", file: "coder.png", gender: "man", kind: "adult" },
  { id: "saudi-woman-01", file: "saudi-woman-01.png", gender: "woman", kind: "adult" },
  { id: "saudi-hijab-01", file: "saudi-hijab-01.png", gender: "woman", kind: "adult" },
  { id: "saudi-hijab-02", file: "saudi-hijab-02.png", gender: "woman", kind: "adult" },
  { id: "saudi-wellness-01", file: "saudi-wellness-01.png", gender: "woman", kind: "adult" },
  { id: "pool-01", file: "pool-01.png", gender: "woman", kind: "adult" },
  { id: "pool-03", file: "pool-03.png", gender: "woman", kind: "adult" },
  { id: "pool-05", file: "pool-05.png", gender: "woman", kind: "adult" },
  { id: "saudi-brand-01", file: "saudi-brand-01.png", gender: "man", kind: "adult" },
  { id: "saudi-copy-01", file: "saudi-copy-01.png", gender: "woman", kind: "adult" },
  { id: "saudi-web-01", file: "saudi-web-01.png", gender: "woman", kind: "adult" },
  { id: "study", file: "study.png", gender: "woman", kind: "adult" },
  { id: "phone-designer", file: "phone-designer.png", gender: "woman", kind: "adult" },

  // —— Children 6–9 (4 boys + 4 girls)
  { id: "kid-boy-69-a", file: "kid-boy-69-a.png", gender: "boy", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-boy-69-b", file: "kid-boy-69-b.png", gender: "boy", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-boy-69-c", file: "kid-boy-69-c.png", gender: "boy", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-boy-69-d", file: "kid-boy-69-d.png", gender: "boy", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-girl-69-a", file: "kid-girl-69-a.png", gender: "girl", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-girl-69-b", file: "kid-girl-69-b.png", gender: "girl", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-girl-69-c", file: "kid-girl-69-c.png", gender: "girl", kind: "child", ageTiers: ["tier_6_9"] },
  { id: "kid-girl-69-d", file: "kid-girl-69-d.png", gender: "girl", kind: "child", ageTiers: ["tier_6_9"] },

  // —— Children 10–13 (4 boys + 4 girls)
  { id: "kid-boy-1013-a", file: "kid-boy-1013-a.png", gender: "boy", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-boy-1013-b", file: "kid-boy-1013-b.png", gender: "boy", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-boy-1013-c", file: "kid-boy-1013-c.png", gender: "boy", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-boy-1013-d", file: "kid-boy-1013-d.png", gender: "boy", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-girl-1013-a", file: "kid-girl-1013-a.png", gender: "girl", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-girl-1013-b", file: "kid-girl-1013-b.png", gender: "girl", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-girl-1013-c", file: "kid-girl-1013-c.png", gender: "girl", kind: "child", ageTiers: ["tier_10_13"] },
  { id: "kid-girl-1013-d", file: "kid-girl-1013-d.png", gender: "girl", kind: "child", ageTiers: ["tier_10_13"] },

  // —— Teens 14–17 (4 boys + 4 girls)
  { id: "kid-boy-1417-a", file: "kid-boy-1417-a.png", gender: "boy", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-boy-1417-b", file: "kid-boy-1417-b.png", gender: "boy", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-boy-1417-c", file: "kid-boy-1417-c.png", gender: "boy", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-boy-1417-d", file: "kid-boy-1417-d.png", gender: "boy", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-girl-1417-a", file: "kid-girl-1417-a.png", gender: "girl", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-girl-1417-b", file: "kid-girl-1417-b.png", gender: "girl", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-girl-1417-c", file: "kid-girl-1417-c.png", gender: "girl", kind: "child", ageTiers: ["tier_14_17"] },
  { id: "kid-girl-1417-d", file: "kid-girl-1417-d.png", gender: "girl", kind: "child", ageTiers: ["tier_14_17"] },
];

/** Representative faces for the Adult / Child choice cards. */
export const FAMILY_KIND_PREVIEW = {
  adult: portraitFileUrl("saudi-shumagh-01.png"),
  child: portraitFileUrl("kid-girl-1013-a.png"),
} as const;

const FALLBACK_COLORS = ["#C17B5C", "#6B8F71", "#4A6FA5", "#8B6B9E", "#5A8A8A", "#C4A35A"] as const;

export function familyPortraitUrl(portrait: FamilyPortrait | null | undefined): string | null {
  if (!portrait) return null;
  return portraitFileUrl(portrait.file);
}

export function findFamilyPortrait(id: string | null | undefined): FamilyPortrait | null {
  if (!id) return null;
  return FAMILY_PORTRAITS.find((p) => p.id === id) ?? null;
}

export function listFamilyPortraits(input: {
  kind: "adult" | "child";
  gender: FamilyPortraitGender | null;
  ageTier?: FamilyAgeTier | null;
}): FamilyPortrait[] {
  return FAMILY_PORTRAITS.filter((p) => {
    if (p.kind !== input.kind) return false;
    if (input.gender && p.gender !== input.gender) return false;
    if (input.kind === "child" && input.ageTier) {
      return Boolean(p.ageTiers?.includes(input.ageTier));
    }
    return true;
  });
}

/** Stable disc color when the API only stores a hex (portrait lives in guardian prefs). */
export function colorForPortraitId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}

export function defaultGenderForKind(kind: "adult" | "child"): FamilyPortraitGender {
  return kind === "adult" ? "man" : "boy";
}

export function defaultPortraitId(input: {
  kind: "adult" | "child";
  gender: FamilyPortraitGender;
  ageTier?: FamilyAgeTier | null;
}): string {
  const list = listFamilyPortraits(input);
  return list[0]?.id ?? FAMILY_PORTRAITS[0]!.id;
}

/** Resolve stored avatarKey (portrait id) to a display URL. */
export function familyMemberPortraitUrl(avatarKey: string | null | undefined): string | null {
  return familyPortraitUrl(findFamilyPortrait(avatarKey));
}

export type MemberFaceInput = {
  id: string;
  role?: FamilyMemberRole | null;
  ageTier?: FamilyAgeTier | null;
};

/** Stable catalog face when the seat has no uploaded photo or wizard portrait yet. */
export function stableMemberPortraitId(member: MemberFaceInput): string {
  const kind = member.role === "child" ? "child" : "adult";
  const list = listFamilyPortraits({
    kind,
    gender: null,
    ageTier: kind === "child" ? (member.ageTier ?? "tier_10_13") : null,
  });
  let h = 0;
  const seed = member.id || "seat";
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % Math.max(1, list.length)]?.id ?? FAMILY_PORTRAITS[0]!.id;
}

const HARD_FALLBACK_URL = portraitFileUrl("saudi-shumagh-01.png");

/**
 * Face for a family seat: uploaded photo → wizard portrait → stable catalog.
 * Always returns a usable image URL (never null).
 */
export function resolveMemberFaceUrl(member: MemberFaceInput | string): string {
  const meta: MemberFaceInput =
    typeof member === "string"
      ? { id: member }
      : { id: member.id, role: member.role, ageTier: member.ageTier };
  const id = typeof meta.id === "string" ? meta.id : String(meta.id ?? "");
  const uploaded = id ? getProfilePhoto(id) : null;
  if (uploaded) return uploaded;
  const fromPrefs = id ? familyMemberPortraitUrl(getChildSeatPrefs(id).avatarKey) : null;
  if (fromPrefs) return fromPrefs;
  return (
    familyMemberPortraitUrl(stableMemberPortraitId({ ...meta, id })) ?? HARD_FALLBACK_URL
  );
}
